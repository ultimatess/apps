import { vibrate } from '../../../utils/wake-lock.js';

export class SquareTagController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.color = '#06b6d4';
    this.dx = 0;
    this.dy = 0;
    this.isBoost = false;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('privatePayload', (data) => {
      if (data.game === 'square-tag') {
        this.color = data.color || '#06b6d4';
        this.render();
      }
    });
  }

  sendMove(dx, dy, boost = false) {
    this.dx = dx;
    this.dy = dy;
    this.isBoost = boost;
    this.session.sendAction('MOVE_INPUT', { dx, dy, boost });
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill" style="border-color:${this.color}; color:${this.color};">
            ARENA FIGHTER
          </div>
        </header>

        <div class="controller-body" style="padding:10px 0; justify-content:space-between;">
          <div style="text-align:center;">
            <h3 style="color:${this.color};">🕹️ VIRTUAL GAMEPAD</h3>
            <p style="font-size:12px; color:var(--text-muted); margin-top:4px;">Use D-pad to steer your square on the TV</p>
          </div>

          <!-- Virtual D-Pad -->
          <div class="dpad-container" style="display:grid; grid-template-columns: repeat(3, 80px); grid-template-rows: repeat(3, 80px); gap: 10px; margin: 20px auto;">
            <div></div>
            <button class="dpad-btn" id="dpadUp" style="background:${this.color};">▲</button>
            <div></div>

            <button class="dpad-btn" id="dpadLeft" style="background:${this.color};">◀</button>
            <div style="background:rgba(255,255,255,0.06); border-radius:12px;"></div>
            <button class="dpad-btn" id="dpadRight" style="background:${this.color};">▶</button>

            <div></div>
            <button class="dpad-btn" id="dpadDown" style="background:${this.color};">▼</button>
            <div></div>
          </div>

          <!-- Turbo Boost Button -->
          <div style="width:100%; padding:0 20px;">
            <button class="btn-primary" id="btnTurboBoost" style="background:linear-gradient(135deg, #f59e0b, #d97706); padding:18px; font-size:18px; border-radius:16px;">
              ⚡ TURBO BOOST
            </button>
          </div>
        </div>
      </div>
    `;

    this.attachDpadEvents();
  }

  attachDpadEvents() {
    const bindBtn = (id, dx, dy) => {
      const el = document.getElementById(id);
      if (!el) return;

      const start = (e) => {
        e.preventDefault();
        vibrate([20]);
        this.sendMove(dx, dy, this.isBoost);
      };
      const end = (e) => {
        e.preventDefault();
        this.sendMove(0, 0, this.isBoost);
      };

      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
    };

    bindBtn('dpadUp', 0, -1);
    bindBtn('dpadDown', 0, 1);
    bindBtn('dpadLeft', -1, 0);
    bindBtn('dpadRight', 1, 0);

    const boostBtn = document.getElementById('btnTurboBoost');
    if (boostBtn) {
      boostBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        vibrate([40]);
        this.isBoost = true;
        this.sendMove(this.dx, this.dy, true);
      });
      boostBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.isBoost = false;
        this.sendMove(this.dx, this.dy, false);
      });
    }
  }
}
