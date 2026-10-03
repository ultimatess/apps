import { vibrate } from '../../../utils/wake-lock.js';

export class Connect4Controller {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.playerNum = 1;
    this.color = '#ef4444';
    this.publicState = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('privatePayload', (data) => {
      if (data.game === 'connect4') {
        this.playerNum = data.playerNum;
        this.color = data.color || '#ef4444';
        this.render();
      }
    });

    this.session.on('stateUpdate', (state) => {
      if (state.game === 'connect4') {
        this.publicState = state;
        this.render();
      }
    });
  }

  render() {
    if (!this.container) return;

    const isMyTurn = this.publicState?.currentTurn === this.playerNum;
    const isGameOver = this.publicState?.phase === 'GAME_OVER';

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill" style="border-color:${this.color}; color:${this.color};">
            PLAYER ${this.playerNum} (${this.playerNum === 1 ? 'RED' : 'YELLOW'})
          </div>
        </header>

        <div class="controller-body" style="padding:10px 0; justify-content:space-between;">
          <div style="text-align:center;">
            <h3 style="color:${this.color};">🔴 CONNECT 4 CONTROLLER</h3>
            <p style="font-size:14px; margin-top:6px;">
              ${isGameOver ? 'Match Finished!' : isMyTurn ? '✨ YOUR TURN! Tap a column to drop disc' : 'Waiting for opponent to move...'}
            </p>
          </div>

          <!-- Column Selection Buttons -->
          <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin:20px 0;">
            <span style="font-size:12px; color:var(--text-muted); text-align:center;">SELECT COLUMN TO DROP (1 - 7):</span>
            <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px;">
              ${[0, 1, 2, 3, 4, 5, 6].map(col => `
                <button class="c4-col-btn ${isMyTurn ? 'active' : 'disabled'}" data-col="${col}" style="${isMyTurn ? `background:${this.color};` : ''}">
                  ${col + 1}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="glass-card" style="text-align:center; padding:16px;">
            <p style="font-size:13px; color:var(--text-secondary);">
              Connect 4 discs horizontally, vertically, or diagonally on the TV to win!
            </p>
          </div>
        </div>
      </div>
    `;

    if (isMyTurn && !isGameOver) {
      document.querySelectorAll('.c4-col-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          vibrate([40]);
          const col = parseInt(btn.dataset.col);
          this.session.sendAction('DROP_COL', { col });
        });
      });
    }
  }
}
