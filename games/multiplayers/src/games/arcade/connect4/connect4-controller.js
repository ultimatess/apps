import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader } from '../../../utils/ui.js';

const COLORS = { 1: '#ef4444', 2: '#facc15' };

export class Connect4Controller {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.lastTurnKey = null;

    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      const seat = this.mySeat();
      const turnKey = `${state.lastMove?.n || 0}-${state.currentTurn}`;
      if (state.phase === 'PLAYING' && seat && state.currentTurn === seat && turnKey !== this.lastTurnKey) {
        vibrate([60, 40, 60]); // nudge: your move
      }
      this.lastTurnKey = turnKey;
      this.render();
    });
  }

  mySeat() {
    const s = this.publicState;
    if (!s) return 0;
    if (s.p1Id === this.session.playerId) return 1;
    if (s.p2Id === this.session.playerId) return 2;
    return 0;
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const seat = this.mySeat();

    if (!s || s.phase === 'SETUP' || !seat) {
      this.renderWaiting(seat);
      return;
    }

    const isMyTurn = s.phase === 'PLAYING' && s.currentTurn === seat;
    const color = COLORS[seat];
    const opponent = seat === 1 ? s.p2Name : s.p1Name;
    let status;
    if (s.phase === 'GAME_OVER') {
      status = s.winner === 'DRAW' ? "🤝 It's a draw!" : s.winner === seat ? '🏆 YOU WIN!' : `😵 ${escapeHtml(opponent)} wins`;
    } else {
      status = isMyTurn ? '✨ YOUR TURN: tap a column' : `⏳ ${escapeHtml(opponent)} is thinking...`;
    }

    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, seat === 1 ? '🔴 RED' : '🟡 YELLOW', `border-color:${color}; color:${color};`)}
        <div class="controller-body">
          <div class="turn-banner ${isMyTurn ? 'my-turn' : ''}" style="--accent:${color};">${status}</div>
          <div class="c4-pad ${isMyTurn ? 'active' : ''}">
            ${Array.from({ length: 7 }, (_, col) => {
              const full = s.board[0][col] !== 0;
              return `
                <button class="c4-pad-col" data-col="${col}" ${!isMyTurn || full ? 'disabled' : ''} aria-label="Drop in column ${col + 1}">
                  ${s.board.map(row => `<span class="c4-pad-cell ${row[col] ? `p${row[col]}` : ''}"></span>`).join('')}
                  <span class="c4-pad-arrow" style="color:${color};">${full ? '✕' : '▲'}</span>
                </button>
              `;
            }).join('')}
          </div>
          <p class="hint-text">vs ${escapeHtml(opponent)} · Watch the TV for the full board</p>
        </div>
      </div>
    `;

    if (isMyTurn) {
      this.container.querySelectorAll('.c4-pad-col:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
          vibrate([40]);
          this.container.querySelectorAll('.c4-pad-col').forEach(b => { b.disabled = true; });
          this.session.sendAction('DROP_COL', { col: Number(btn.dataset.col) });
        });
      });
    }
  }

  renderWaiting(seat) {
    const s = this.publicState;
    const queue = s?.queue || [];
    const pos = queue.findIndex(q => q.id === this.session.playerId);
    let title = '🔴🟡 Connect 4';
    let message = 'The host is setting up the match. Watch the TV!';
    if (s && s.phase !== 'SETUP' && !seat) {
      title = '👀 Spectating';
      message = pos >= 0 ? `You're #${pos + 1} in line. Winner stays on, so get ready!` : 'Watch the match on the TV.';
    } else if (s?.phase === 'SETUP' && pos >= 0) {
      message = pos < 2 ? `You're playing ${pos === 0 ? 'RED (first move)' : 'YELLOW'} in the first match!` : `You're #${pos - 1} in the challenger line.`;
    }

    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session)}
        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <h2>${title}</h2>
            <p class="subtitle">${message}</p>
            ${s && s.phase !== 'SETUP' ? `<p class="hint-text">${escapeHtml(s.p1Name)} 🔴 vs 🟡 ${escapeHtml(s.p2Name)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }
}
