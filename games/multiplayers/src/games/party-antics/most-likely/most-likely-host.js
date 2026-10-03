import { MOST_LIKELY_PROMPTS } from '../../../data/most-likely-prompts.js';
import { playRoundStart, playVictory, playGong, playTick } from '../../../utils/audio.js';
import { escapeHtml, shuffle, tallyVotes, Disposer } from '../../../utils/ui.js';

const VOTE_SECONDS = 30;

export class MostLikelyHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.roundDisposer = new Disposer();

    this.promptsDeck = shuffle(MOST_LIKELY_PROMPTS);
    this.promptIndex = 0;
    this.totalPrompts = 8;
    this.roundNumber = 0;
    this.currentPrompt = '';

    this.phase = 'SETUP'; // 'SETUP' | 'VOTING' | 'REVEAL' | 'AWARDS'
    this.votes = {};
    this.tallies = {};
    this.titles = {}; // playerId -> [prompt titles won]
    this.totalVotes = {}; // playerId -> votes received overall

    this.session.on('playerAction', (playerId, action, payload) => {
      if (this.phase !== 'VOTING' || action !== 'CAST_VOTE') return;
      if (!this.session.clients.has(payload.nomineeId)) return;
      this.votes[playerId] = payload.nomineeId;
      this.syncState();
      this.renderVoterStatus();
      this.checkVotesComplete();
    });

    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP') this.render();
      else if (this.phase === 'VOTING') {
        this.renderVoterStatus();
        this.checkVotesComplete();
      }
      this.syncState();
    });
  }

  destroy() {
    this.roundDisposer.dispose();
    this.disposer.dispose();
  }

  startNewGame() {
    this.roundNumber = 0;
    this.titles = {};
    this.totalVotes = {};
    this.nextPrompt();
  }

  nextPrompt() {
    if (this.roundNumber >= this.totalPrompts) {
      this.showAwards();
      return;
    }
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    if (this.promptIndex >= this.promptsDeck.length) {
      this.promptsDeck = shuffle(MOST_LIKELY_PROMPTS);
      this.promptIndex = 0;
    }
    this.currentPrompt = this.promptsDeck[this.promptIndex++];
    this.roundNumber++;
    this.phase = 'VOTING';
    this.votes = {};
    this.tallies = {};
    this.timer = VOTE_SECONDS;

    playRoundStart();
    this.syncState();
    this.render();

    this.roundDisposer.interval(() => {
      if (this.phase !== 'VOTING') return;
      this.timer--;
      const el = document.getElementById('mlTimer');
      if (el) el.textContent = `${this.timer}s`;
      if (this.timer <= 5 && this.timer > 0) playTick(900);
      if (this.timer <= 0) this.revealResults();
    }, 1000);
  }

  voters() {
    return this.session.getPlayers().filter(p => p.connected);
  }

  checkVotesComplete() {
    const voters = this.voters();
    if (voters.length && voters.every(p => this.votes[p.id])) {
      // Tiny pause so the last voter sees their tick land on the TV.
      this.roundDisposer.timeout(() => this.revealResults(), 600);
    }
  }

  revealResults() {
    if (this.phase !== 'VOTING') return;
    this.phase = 'REVEAL';
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    playGong();

    const { leader, counts } = tallyVotes(this.votes);
    this.tallies = counts;
    this.winnerId = leader;
    Object.entries(counts).forEach(([id, n]) => { this.totalVotes[id] = (this.totalVotes[id] || 0) + n; });
    if (leader) (this.titles[leader] ||= []).push(this.currentPrompt);
    const max = Math.max(0, ...Object.values(counts));
    this.tiedIds = leader ? [] : Object.keys(counts).filter(id => counts[id] === max && max > 0);

    this.syncState();
    this.render();
  }

  showAwards() {
    this.phase = 'AWARDS';
    playVictory();
    this.syncState();
    this.render();
  }

  syncState() {
    const players = this.session.getPlayers().map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
    this.session.broadcastPublicState({
      game: 'most-likely',
      phase: this.phase,
      prompt: this.currentPrompt,
      roundNumber: this.roundNumber,
      totalPrompts: this.totalPrompts,
      players,
      votedIds: Object.keys(this.votes),
      tallies: this.phase === 'REVEAL' ? this.tallies : {},
      winnerId: this.phase === 'REVEAL' ? this.winnerId : null,
      tiedIds: this.phase === 'REVEAL' ? this.tiedIds : [],
      titles: this.phase === 'AWARDS' ? this.titles : {}
    });
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'VOTING') this.renderVoting();
    else if (this.phase === 'REVEAL') this.renderReveal();
    else this.renderAwards();
  }

  header() {
    return `
      <header class="host-header compact">
        <div class="brand-badge"><span class="pulse-dot"></span><span>MOST LIKELY TO...</span></div>
        <div class="round-indicator">PROMPT ${this.roundNumber} / ${this.totalPrompts}</div>
        <button class="btn-icon" id="btnBackDeck">Exit</button>
      </header>
    `;
  }

  bindCommon() {
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderSetup() {
    const players = this.session.getPlayers();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>MOST LIKELY TO...</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>
        <div class="glass-card setup-card">
          <div class="setup-icon">🔥</div>
          <h2>Who in this room is most likely to...?</h2>
          <ul class="rules-list">
            <li>📺 A prompt appears on the TV</li>
            <li>📱 Everyone secretly votes on their phone (yes, you can vote for yourself)</li>
            <li>📊 The room's verdict is revealed. Top pick earns the title</li>
            <li>🏅 Superlative awards ceremony at the end!</li>
          </ul>
          <div class="form-group inline-group">
            <label>Prompts:</label>
            <div class="timer-chips">
              ${[5, 8, 12].map(n => `<button class="chip-btn ${this.totalPrompts === n ? 'active' : ''}" data-total="${n}">${n}</button>`).join('')}
            </div>
          </div>
          <div class="players-roster center">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartML" ${players.length >= 2 ? '' : 'disabled'}>🚀 Start Voting</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
          ${players.length < 2 ? '<p class="hint-text">Needs at least 2 players (3+ is way more fun)</p>' : ''}
        </div>
      </div>
    `;
    this.container.querySelectorAll('[data-total]').forEach(btn => btn.addEventListener('click', () => {
      this.totalPrompts = Number(btn.dataset.total);
      this.render();
    }));
    document.getElementById('btnStartML')?.addEventListener('click', () => this.startNewGame());
    this.bindCommon();
  }

  voterStatusHtml() {
    return this.session.getPlayers().map(p => `
      <div class="voter-badge ${this.votes[p.id] ? 'voted' : 'pending'}">
        <span class="avatar">${p.avatar}</span>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="status-icon">${this.votes[p.id] ? '✓ Voted' : '⏳'}</span>
      </div>
    `).join('');
  }

  renderVoterStatus() {
    const el = document.getElementById('mlVoters');
    if (el) el.innerHTML = this.voterStatusHtml();
  }

  renderVoting() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header()}
        <div class="glass-card prompt-stage">
          <div class="eyebrow">WHO IN THIS ROOM IS...</div>
          <h1 class="prompt-text">${escapeHtml(this.currentPrompt)}</h1>
          <p class="muted">Vote secretly on your phone · <strong id="mlTimer">${this.timer}s</strong></p>
          <div class="live-votes-grid" id="mlVoters">${this.voterStatusHtml()}</div>
          <div class="setup-actions">
            <button class="btn-secondary" id="btnForceReveal">Reveal Now</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnForceReveal')?.addEventListener('click', () => this.revealResults());
    this.bindCommon();
  }

  renderReveal() {
    const players = this.session.getPlayers();
    const max = Math.max(1, ...Object.values(this.tallies));
    const sorted = [...players].sort((a, b) => (this.tallies[b.id] || 0) - (this.tallies[a.id] || 0));
    const winner = this.session.clients.get(this.winnerId);
    const tiedNames = (this.tiedIds || []).map(id => this.session.clients.get(id)?.name).filter(Boolean);
    const last = this.roundNumber >= this.totalPrompts;

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header()}
        <div class="glass-card prompt-stage">
          <h2 class="muted">${escapeHtml(this.currentPrompt)}</h2>
          <h1 class="verdict">${winner ? `${winner.avatar} ${escapeHtml(winner.name)}!` : tiedNames.length ? `It's a tie: ${tiedNames.map(escapeHtml).join(' & ')}` : 'Nobody voted!'}</h1>
          <div class="bar-chart">
            ${sorted.map((p, i) => {
              const n = this.tallies[p.id] || 0;
              return `
                <div class="bar-row ${p.id === this.winnerId ? 'winner' : ''}" style="--delay:${i * 120}ms;">
                  <span class="bar-label">${p.avatar} ${escapeHtml(p.name)}</span>
                  <div class="bar-track"><div class="bar-fill" style="--pct:${(n / max) * 100}%;"></div></div>
                  <span class="bar-count">${n}</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnNextPrompt">${last ? '🏅 Awards Ceremony' : 'Next Prompt ➡️'}</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnNextPrompt')?.addEventListener('click', () => this.nextPrompt());
    this.bindCommon();
  }

  renderAwards() {
    const players = this.session.getPlayers();
    const ranked = [...players].sort((a, b) => (this.titles[b.id]?.length || 0) - (this.titles[a.id]?.length || 0) || (this.totalVotes[b.id] || 0) - (this.totalVotes[a.id] || 0));
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card wide">
          <div class="setup-icon">🏅</div>
          <h1 class="winner-title">The Superlative Awards</h1>
          <div class="awards-grid">
            ${ranked.map(p => `
              <div class="award-card">
                <div class="award-head"><span class="avatar">${p.avatar}</span><strong>${escapeHtml(p.name)}</strong><span class="muted">${this.totalVotes[p.id] || 0} votes</span></div>
                ${(this.titles[p.id] || []).map(t => `<div class="award-title">🏆 ${escapeHtml(t)}</div>`).join('') || '<div class="muted">Flew under the radar 🕶️</div>'}
              </div>
            `).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnAgainML">🔁 Play Again</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnAgainML')?.addEventListener('click', () => this.startNewGame());
    this.bindCommon();
  }
}
