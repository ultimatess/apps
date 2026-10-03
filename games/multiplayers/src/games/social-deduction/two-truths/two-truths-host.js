import { playRoundStart, playVictory, playGong, playCorrect, playTick } from '../../../utils/audio.js';
import { escapeHtml, shuffle, Disposer } from '../../../utils/ui.js';

const VOTE_SECONDS = 40;
const MAX_LEN = 120;
const LETTERS = ['A', 'B', 'C'];

export function sanitizeStatement(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
}

export class TwoTruthsHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.turnDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'WRITING' | 'VOTING' | 'REVEAL' | 'FINAL'
    this.submissions = {}; // playerId -> { statements: [3], lieIndex }
    this.order = [];
    this.turnIndex = -1;
    this.votes = {};
    this.scores = {};
    this.fooled = {};
    this.detected = {};

    this.session.on('playerAction', (playerId, action, payload) => this.handleAction(playerId, action, payload));
    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP' || this.phase === 'WRITING') this.render();
      if (this.phase === 'WRITING') {
        const everyone = this.session.getPlayers().filter(p => p.connected);
        if (everyone.length >= 2 && everyone.every(p => this.submissions[p.id])) this.turnDisposer.timeout(() => this.beginTurns(), 800);
      }
      if (this.phase === 'VOTING') {
        this.renderVoteStatus();
        this.checkVotesComplete();
      }
      this.syncState();
    });
  }

  destroy() {
    this.turnDisposer.dispose();
    this.disposer.dispose();
  }

  handleAction(playerId, action, payload) {
    if (action === 'SUBMIT_STATEMENTS' && this.phase === 'WRITING') {
      const statements = (Array.isArray(payload.statements) ? payload.statements : []).slice(0, 3).map(sanitizeStatement);
      const lieIndex = Number(payload.lieIndex);
      if (statements.length !== 3 || statements.some(s => s.length < 3) || ![0, 1, 2].includes(lieIndex)) return;
      this.submissions[playerId] = { statements, lieIndex };
      playTick(1200);
      this.syncState();
      this.render();
      const everyone = this.session.getPlayers().filter(p => p.connected);
      if (everyone.length >= 2 && everyone.every(p => this.submissions[p.id])) {
        this.turnDisposer.timeout(() => this.beginTurns(), 800);
      }
    } else if (action === 'VOTE_LIE' && this.phase === 'VOTING') {
      const author = this.order[this.turnIndex];
      const choice = Number(payload.choice);
      if (playerId === author || ![0, 1, 2].includes(choice)) return;
      this.votes[playerId] = choice;
      this.syncState();
      this.renderVoteStatus();
      this.checkVotesComplete();
    }
  }

  startWriting() {
    this.submissions = {};
    this.scores = {};
    this.fooled = {};
    this.detected = {};
    this.phase = 'WRITING';
    playRoundStart();
    this.syncState();
    this.render();
  }

  beginTurns() {
    if (this.phase !== 'WRITING') return;
    this.order = shuffle(Object.keys(this.submissions).filter(id => this.session.clients.has(id)));
    if (this.order.length < 2) return;
    this.turnIndex = -1;
    this.nextTurn();
  }

  nextTurn() {
    this.turnDisposer.dispose();
    this.turnDisposer = new Disposer();
    this.turnIndex++;
    // Skip authors who left the room.
    while (this.turnIndex < this.order.length && !this.session.clients.has(this.order[this.turnIndex])) this.turnIndex++;
    if (this.turnIndex >= this.order.length) {
      this.phase = 'FINAL';
      playVictory();
      this.syncState();
      this.render();
      return;
    }
    const sub = this.submissions[this.order[this.turnIndex]];
    // Shuffle display order so the lie isn't always in the same slot.
    this.display = shuffle([0, 1, 2]).map(i => ({ text: sub.statements[i], isLie: i === sub.lieIndex }));
    this.votes = {};
    this.phase = 'VOTING';
    this.timer = VOTE_SECONDS;
    playGong();
    this.syncState();
    this.render();
    this.turnDisposer.interval(() => {
      if (this.phase !== 'VOTING') return;
      this.timer--;
      const el = document.getElementById('ttTimer');
      if (el) el.textContent = `${this.timer}s`;
      if (this.timer <= 0) this.reveal();
    }, 1000);
  }

  voters() {
    const author = this.order[this.turnIndex];
    return this.session.getPlayers().filter(p => p.id !== author && p.connected);
  }

  checkVotesComplete() {
    const v = this.voters();
    if (v.length && v.every(p => this.votes[p.id] !== undefined)) this.turnDisposer.timeout(() => this.reveal(), 500);
  }

  reveal() {
    if (this.phase !== 'VOTING') return;
    this.turnDisposer.dispose();
    this.turnDisposer = new Disposer();
    const author = this.order[this.turnIndex];
    const lieSlot = this.display.findIndex(d => d.isLie);
    let fooledCount = 0;
    Object.entries(this.votes).forEach(([voter, choice]) => {
      if (choice === lieSlot) {
        this.scores[voter] = (this.scores[voter] || 0) + 1;
        this.detected[voter] = (this.detected[voter] || 0) + 1;
      } else {
        fooledCount++;
      }
    });
    this.scores[author] = (this.scores[author] || 0) + fooledCount;
    this.fooled[author] = (this.fooled[author] || 0) + fooledCount;
    this.lastFooled = fooledCount;
    this.phase = 'REVEAL';
    playCorrect();
    this.syncState();
    this.render();
  }

  nameOf(id) {
    return this.session.clients.get(id)?.name || 'Player';
  }

  ranked() {
    return this.session.getPlayers()
      .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: this.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  syncState() {
    const author = this.order[this.turnIndex];
    const inTurn = this.phase === 'VOTING' || this.phase === 'REVEAL';
    this.session.broadcastPublicState({
      game: 'two-truths',
      phase: this.phase,
      submittedIds: Object.keys(this.submissions),
      authorId: inTurn ? author : null,
      authorName: inTurn ? this.nameOf(author) : null,
      turnNumber: this.turnIndex + 1,
      totalTurns: this.order.length,
      statements: inTurn ? this.display.map(d => d.text) : null,
      lieSlot: this.phase === 'REVEAL' ? this.display.findIndex(d => d.isLie) : null,
      votedIds: Object.keys(this.votes),
      votes: this.phase === 'REVEAL' ? this.votes : null,
      players: this.ranked()
    });
  }

  renderVoteStatus() {
    const el = document.getElementById('ttVoters');
    if (el) el.innerHTML = this.voters().map(p => `<span class="player-chip ${this.votes[p.id] !== undefined ? 'highlight' : ''}">${p.avatar} ${escapeHtml(p.name)} ${this.votes[p.id] !== undefined ? '✓' : '⏳'}</span>`).join('');
  }

  render() {
    if (!this.container) return;
    const fn = { SETUP: this.renderSetup, WRITING: this.renderWriting, VOTING: this.renderTurn, REVEAL: this.renderTurn, FINAL: this.renderFinal }[this.phase];
    fn.call(this);
    document.getElementById('btnExitTT')?.addEventListener('click', () => this.onReturnToHub?.());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderSetup() {
    const players = this.session.getPlayers();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>TWO TRUTHS & A LIE</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>
        <div class="glass-card setup-card">
          <div class="setup-icon">🤥</div>
          <h2>How well do you really know each other?</h2>
          <ul class="rules-list">
            <li>✍️ Everyone secretly types 2 true facts and 1 believable lie about themselves</li>
            <li>📺 One by one, each player's 3 statements appear on the TV</li>
            <li>🗳️ Everyone else votes on which one is the lie</li>
            <li>🏅 +1 for spotting the lie · the author gets +1 for every person fooled</li>
          </ul>
          <div class="players-roster center">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartTT" ${players.length >= 2 ? '' : 'disabled'}>✍️ Start Writing</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
          ${players.length < 3 ? '<p class="hint-text">Best with 3+ players</p>' : ''}
        </div>
      </div>
    `;
    document.getElementById('btnStartTT')?.addEventListener('click', () => this.startWriting());
  }

  renderWriting() {
    const players = this.session.getPlayers();
    const done = players.filter(p => this.submissions[p.id]).length;
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="pulse-dot"></span><span>TWO TRUTHS & A LIE</span></div>
          <div class="round-indicator">${done} / ${players.length} READY</div>
          <button class="btn-icon" id="btnExitTT">Exit</button>
        </header>
        <div class="glass-card prompt-stage">
          <div class="setup-icon">✍️</div>
          <h1 class="prompt-text">Write 2 truths and 1 lie on your phone</h1>
          <p class="muted">Make the lie believable, and the truths surprising!</p>
          <div class="live-votes-grid">
            ${players.map(p => `
              <div class="voter-badge ${this.submissions[p.id] ? 'voted' : 'pending'}">
                <span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span>
                <span class="status-icon">${this.submissions[p.id] ? '✓ Ready' : '✍️ Writing'}</span>
              </div>
            `).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnBeginTT" ${done >= 2 ? '' : 'disabled'}>▶ Start with ${done} ready</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnBeginTT')?.addEventListener('click', () => this.beginTurns());
  }

  renderTurn() {
    const reveal = this.phase === 'REVEAL';
    const author = this.session.clients.get(this.order[this.turnIndex]);
    const lieSlot = this.display.findIndex(d => d.isLie);
    const counts = [0, 0, 0];
    Object.values(this.votes).forEach(c => { counts[c]++; });
    const last = this.turnIndex + 1 >= this.order.length;

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="pulse-dot"></span><span>TWO TRUTHS & A LIE</span></div>
          <div class="round-indicator">PLAYER ${this.turnIndex + 1} / ${this.order.length}${reveal ? '' : ` · <span id="ttTimer">${this.timer}s</span>`}</div>
          <button class="btn-icon" id="btnExitTT">Exit</button>
        </header>
        <div class="glass-card prompt-stage">
          <div class="author-banner">${author?.avatar || '👤'} <strong>${escapeHtml(author?.name || 'Player')}</strong> says...</div>
          <div class="statement-list">
            ${this.display.map((d, i) => `
              <div class="statement ${reveal ? (d.isLie ? 'lie' : 'truth') : ''}">
                <span class="letter">${LETTERS[i]}</span>
                <span class="text">${escapeHtml(d.text)}</span>
                ${reveal ? `<span class="verdict-tag">${d.isLie ? '🤥 LIE' : '✓ TRUE'} · ${counts[i]} vote${counts[i] === 1 ? '' : 's'}</span>` : ''}
              </div>
            `).join('')}
          </div>
          ${reveal ? `
            <p class="fastest">${this.lastFooled ? `${escapeHtml(author?.name || '')} fooled ${this.lastFooled} player${this.lastFooled > 1 ? 's' : ''}! 😈` : 'Nobody was fooled! 🕵️'}</p>
            <div class="score-strip">
              ${Object.entries(this.votes).filter(([, c]) => c === lieSlot).map(([id]) => `<span class="player-chip highlight">🎯 ${escapeHtml(this.nameOf(id))}</span>`).join('')}
            </div>
            <div class="setup-actions"><button class="btn-primary" id="btnNextTT">${last ? '🏆 Final Scores' : 'Next Player ▶'}</button></div>
          ` : `
            <p class="muted">Which one is the lie? Vote on your phone!</p>
            <div class="score-strip" id="ttVoters"></div>
            <div class="setup-actions"><button class="btn-secondary" id="btnRevealTT">Reveal Now</button></div>
          `}
        </div>
      </div>
    `;
    if (!reveal) this.renderVoteStatus();
    document.getElementById('btnNextTT')?.addEventListener('click', () => this.nextTurn());
    document.getElementById('btnRevealTT')?.addEventListener('click', () => this.reveal());
  }

  renderFinal() {
    const ranked = this.ranked();
    const liar = [...ranked].sort((a, b) => (this.fooled[b.id] || 0) - (this.fooled[a.id] || 0))[0];
    const detector = [...ranked].sort((a, b) => (this.detected[b.id] || 0) - (this.detected[a.id] || 0))[0];
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title">${ranked[0] ? `${escapeHtml(ranked[0].name)} wins!` : 'Game over'}</h1>
          <div class="awards-grid two">
            ${liar && this.fooled[liar.id] ? `<div class="award-card"><div class="award-head">😈 Best Liar</div><strong>${liar.avatar} ${escapeHtml(liar.name)}</strong><span class="muted">fooled ${this.fooled[liar.id]}</span></div>` : ''}
            ${detector && this.detected[detector.id] ? `<div class="award-card"><div class="award-head">🕵️ Lie Detector</div><strong>${detector.avatar} ${escapeHtml(detector.name)}</strong><span class="muted">${this.detected[detector.id]} spotted</span></div>` : ''}
          </div>
          <div class="podium-list">${ranked.map((p, i) => `<div class="podium-row ${i === 0 ? 'first' : ''}"><span>${['🥇', '🥈', '🥉'][i] || `#${i + 1}`} ${p.avatar} ${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnAgainTT">🔁 New Round</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnAgainTT')?.addEventListener('click', () => this.startWriting());
  }
}
