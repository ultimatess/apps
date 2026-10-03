import { MOST_LIKELY_PROMPTS } from '../../../data/most-likely-prompts.js';
import { playRoundStart, playVictory, playGong } from '../../../utils/audio.js';

export class MostLikelyHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.promptsDeck = [...MOST_LIKELY_PROMPTS].sort(() => 0.5 - Math.random());
    this.promptIndex = 0;
    this.currentPrompt = '';

    this.phase = 'VOTING'; // 'VOTING' | 'REVEAL'
    this.votes = {}; // voterId -> nomineeId
    this.scores = {}; // nomineeId -> totalVotesReceived

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (this.phase === 'VOTING' && action === 'CAST_VOTE') {
        this.votes[playerId] = payload.nomineeId;
        this.syncState();
        this.render();
        this.checkVotesComplete();
      }
    });
  }

  startNewGame() {
    this.promptIndex = 0;
    this.scores = {};
    this.nextPrompt();
  }

  nextPrompt() {
    if (this.promptIndex >= this.promptsDeck.length) {
      this.promptsDeck = [...MOST_LIKELY_PROMPTS].sort(() => 0.5 - Math.random());
      this.promptIndex = 0;
    }

    this.currentPrompt = this.promptsDeck[this.promptIndex++];
    this.phase = 'VOTING';
    this.votes = {};

    playRoundStart();
    this.syncState();
    this.render();
  }

  checkVotesComplete() {
    const players = Array.from(this.session.clients.values());
    if (Object.keys(this.votes).length >= players.length) {
      this.revealResults();
    }
  }

  revealResults() {
    this.phase = 'REVEAL';
    playGong();

    // Tally votes
    const counts = {};
    Object.values(this.votes).forEach(nid => {
      counts[nid] = (counts[nid] || 0) + 1;
      this.scores[nid] = (this.scores[nid] || 0) + 1;
    });

    this.currentTallies = counts;
    this.syncState();
    this.render();
  }

  syncState() {
    const players = Array.from(this.session.clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: this.scores[p.id] || 0
    }));

    this.session.broadcastPublicState({
      game: 'most-likely',
      phase: this.phase,
      prompt: this.currentPrompt,
      promptNumber: this.promptIndex,
      players,
      votes: this.votes,
      tallies: this.currentTallies || {}
    });
  }

  render() {
    if (!this.container) return;

    if (this.phase === 'VOTING') {
      this.renderVoting();
    } else if (this.phase === 'REVEAL') {
      this.renderReveal();
    }
  }

  renderVoting() {
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>MOST LIKELY TO...</span></div>
          <div class="round-indicator">PROMPT #${this.promptIndex}</div>
          <div class="room-code-mini"><button class="btn-icon" id="btnBackDeck">Exit to Deck</button></div>
        </header>

        <div class="glass-card" style="text-align:center; padding:50px 24px; max-width:900px; margin:0 auto; width:100%;">
          <div style="font-size:14px; font-weight:800; color:var(--accent-pink); letter-spacing:2px; margin-bottom:12px;">
            POINT & ACCUSE
          </div>
          <h1 style="font-size:clamp(28px, 4vw, 44px); font-family:var(--font-heading); line-height:1.3; margin-bottom:32px;">
            "${this.currentPrompt}"
          </h1>
          <p style="color:var(--text-secondary); font-size:18px; margin-bottom:36px;">
            Everyone vote on your phone secretly! Who fits this prompt best?
          </p>

          <div class="live-votes-grid">
            ${players.map(p => `
              <div class="voter-badge ${this.votes[p.id] ? 'voted' : 'pending'}">
                <span class="avatar">${p.avatar}</span>
                <span class="name">${p.name}</span>
                <span class="status-icon">${this.votes[p.id] ? '✓ Ballot In' : '⏳ Choosing...'}</span>
              </div>
            `).join('')}
          </div>

          <div style="margin-top:32px;">
            <button class="btn-secondary" id="btnForceReveal">Reveal Votes Now</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnForceReveal')?.addEventListener('click', () => this.revealResults());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }

  renderReveal() {
    const players = Array.from(this.session.clients.values());
    const tallies = this.currentTallies || {};
    const maxVotes = Math.max(...Object.values(tallies), 1);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="badge-cat">VOTE RESULTS</span></div>
          <div class="round-indicator">PROMPT #${this.promptIndex}</div>
          <div class="room-code-mini"><button class="btn-icon" id="btnBackDeck">Exit</button></div>
        </header>

        <div class="glass-card" style="text-align:center; padding:40px 24px; max-width:900px; margin:0 auto; width:100%;">
          <h2 style="font-size:24px; color:var(--text-secondary); margin-bottom:8px;">"${this.currentPrompt}"</h2>
          <h1 style="font-family:var(--font-heading); font-size:36px; color:var(--accent-pink); margin-bottom:32px;">
            The Room Has Spoken! 📢
          </h1>

          <div style="display:flex; flex-direction:column; gap:16px; margin-bottom:36px;">
            ${players.map(p => {
              const voteCount = tallies[p.id] || 0;
              const pct = (voteCount / maxVotes) * 100;
              return `
                <div style="display:flex; align-items:center; gap:16px; text-align:left;">
                  <span style="font-size:24px; width:36px;">${p.avatar}</span>
                  <span style="font-weight:700; width:120px;">${p.name}</span>
                  <div style="flex-grow:1; background:rgba(255,255,255,0.06); height:28px; border-radius:14px; overflow:hidden; position:relative;">
                    <div style="width:${pct}%; height:100%; background:linear-gradient(90deg, #ec4899, #8b5cf6); border-radius:14px; transition:width 1s cubic-bezier(0.16,1,0.3,1);"></div>
                  </div>
                  <span style="font-weight:800; font-size:16px; width:60px; text-align:right;">${voteCount} votes</span>
                </div>
              `;
            }).join('')}
          </div>

          <div style="display:flex; justify-content:center; gap:12px;">
            <button class="btn-primary" id="btnNextPrompt">Next Prompt ➡️</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnNextPrompt')?.addEventListener('click', () => this.nextPrompt());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }
}
