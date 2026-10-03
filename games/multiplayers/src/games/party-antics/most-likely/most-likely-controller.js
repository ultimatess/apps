import { vibrate } from '../../../utils/wake-lock.js';

export class MostLikelyController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.myVote = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('stateUpdate', (state) => {
      if (this.publicState?.prompt !== state.prompt) {
        this.myVote = null;
      }
      this.publicState = state;
      this.render();
    });
  }

  render() {
    if (!this.container || !this.publicState) return;

    const players = this.publicState.players || [];
    const isReveal = this.publicState.phase === 'REVEAL';

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill">#${this.publicState.promptNumber || 1}</div>
        </header>

        <div class="controller-body">
          <div class="glass-card">
            <h2 style="font-size:20px; line-height:1.4; margin-bottom:16px;">
              "${this.publicState.prompt}"
            </h2>

            ${isReveal ? `
              <div style="text-align:center; padding:24px 0;">
                <div style="font-size:42px;">📊</div>
                <h3>Votes Revealed!</h3>
                <p style="color:var(--text-secondary); margin-top:8px;">Look at the main screen for results!</p>
              </div>
            ` : this.myVote ? `
              <div class="vote-confirmed">
                <span class="check">✓</span>
                <h3>Vote Locked In!</h3>
                <p>Waiting for everyone to vote...</p>
              </div>
            ` : `
              <p style="color:var(--text-secondary); margin-bottom:14px;">Select the player who fits best:</p>
              <div class="suspect-picker-grid">
                ${players.map(p => `
                  <button class="suspect-select-btn btn-nominate" data-nominee-id="${p.id}">
                    <span class="avatar">${p.avatar}</span>
                    <span class="name">${p.name} ${p.id === this.session.playerId ? '(You)' : ''}</span>
                  </button>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.btn-nominate').forEach(btn => {
      btn.addEventListener('click', () => {
        vibrate([50]);
        this.myVote = btn.dataset.nomineeId;
        this.session.sendAction('CAST_VOTE', { nomineeId: this.myVote });
        this.render();
      });
    });
  }
}
