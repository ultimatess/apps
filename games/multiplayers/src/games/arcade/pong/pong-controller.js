import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader, Disposer } from '../../../utils/ui.js';

const LEFT_COLOR = '#06b6d4';
const RIGHT_COLOR = '#ec4899';

export class PongController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.disposer = new Disposer();
    this.pendingPos = null;
    this.sendScheduled = false;
    this.lastScore = null;

    this.session.on('stateUpdate', (state) => {
      const prevSide = this.mySide();
      const prevPhase = this.publicState?.phase;
      this.publicState = state;
      const score = `${state.leftScore}-${state.rightScore}`;
      // Re-render only when the layout changes so an active drag isn't interrupted.
      if (prevSide !== this.mySide() || prevPhase !== state.phase || !this.container.querySelector('#paddleTouchTrack')) {
        this.render();
      } else {
        const el = this.container.querySelector('#pongScore');
        if (el) el.textContent = `${state.leftScore} – ${state.rightScore}`;
      }
      if (this.lastScore && score !== this.lastScore) vibrate([30]);
      this.lastScore = score;
    });
  }

  destroy() {
    this.disposer.dispose();
  }

  mySide() {
    const s = this.publicState;
    if (!s) return null;
    if (s.p1Id === this.session.playerId) return 'LEFT';
    if (s.p2Id === this.session.playerId) return 'RIGHT';
    return null;
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const side = this.mySide();

    if (!s || s.phase === 'SETUP' || !side || s.phase === 'GAME_OVER') {
      this.renderWaiting(side);
      return;
    }

    const color = side === 'LEFT' ? LEFT_COLOR : RIGHT_COLOR;
    const opponent = side === 'LEFT' ? s.p2Name : s.p1Name;

    this.container.innerHTML = `
      <div class="controller-screen no-scroll">
        ${controllerHeader(this.session, `${side} PADDLE`, `border-color:${color}; color:${color};`)}
        <div class="controller-body pad-body">
          <div class="pad-info">
            <span>vs ${escapeHtml(opponent)}</span>
            <strong id="pongScore">${s.leftScore} – ${s.rightScore}</strong>
          </div>
          <div id="paddleTouchTrack" class="paddle-track" style="--accent:${color};">
            <div id="visualPaddleThumb" class="paddle-thumb"></div>
            <span class="track-label">SLIDE UP & DOWN</span>
          </div>
        </div>
      </div>
    `;

    this.attachControls();
  }

  attachControls() {
    const track = document.getElementById('paddleTouchTrack');
    const thumb = document.getElementById('visualPaddleThumb');
    if (!track || !thumb) return;

    const place = (normY) => {
      const travel = track.clientHeight - thumb.offsetHeight;
      thumb.style.transform = `translateY(${normY * travel}px)`;
    };
    place(0.5);

    const flush = () => {
      this.sendScheduled = false;
      if (this.pendingPos == null) return;
      this.session.sendAction('PADDLE_INPUT', { pos: this.pendingPos });
      this.pendingPos = null;
    };

    const handle = (e) => {
      e.preventDefault();
      const rect = track.getBoundingClientRect();
      const half = thumb.offsetHeight / 2;
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top - half) / (rect.height - half * 2)));
      place(normY);
      this.pendingPos = normY;
      // At most one packet per frame keeps the data channel clear.
      if (!this.sendScheduled) {
        this.sendScheduled = true;
        requestAnimationFrame(flush);
      }
    };

    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture?.(e.pointerId);
      track.classList.add('active');
      handle(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.buttons || e.pointerType === 'touch') handle(e);
    });
    const release = () => track.classList.remove('active');
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
  }

  renderWaiting(side) {
    const s = this.publicState;
    const queue = s?.queue || [];
    const pos = queue.findIndex(q => q.id === this.session.playerId);
    let title = '🏓 Netplay Pong';
    let msg = 'Waiting for the host to launch the duel...';

    if (s?.phase === 'GAME_OVER' && side) {
      const won = s.winnerSide === side;
      title = won ? '🏆 You won!' : '😵 Good game!';
      msg = `Final score ${s.leftScore} – ${s.rightScore}. ${won ? 'Winner stays on!' : 'Back of the line for a rematch.'}`;
    } else if (s?.phase === 'SETUP' && pos >= 0) {
      msg = pos < 2 ? `You're up first on the ${pos === 0 ? 'LEFT' : 'RIGHT'} paddle. Get ready!` : `You're #${pos - 1} in the challenger line.`;
    } else if (s && s.phase !== 'SETUP' && !side) {
      title = '👀 Spectating';
      msg = pos >= 0 ? `You're #${pos + 1} in line. Winner stays on!` : 'Watch the duel on the TV.';
    }

    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session)}
        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <h2>${title}</h2>
            <p class="subtitle">${msg}</p>
            ${s && s.p1Id ? `<p class="hint-text">${escapeHtml(s.p1Name)} ${s.leftScore} – ${s.rightScore} ${escapeHtml(s.p2Name)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }
}
