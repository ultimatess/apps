import { vibrate } from '../../../utils/wake-lock.js';

export class PongController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.side = 'LEFT';
    this.color = '#06b6d4';
    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('privatePayload', (data) => {
      if (data.game === 'pong') {
        this.side = data.side;
        this.color = data.color || '#06b6d4';
        this.render();
      }
    });
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill" style="border-color:${this.color}; color:${this.color};">
            ${this.side} PADDLE
          </div>
        </header>

        <div class="controller-body" style="padding:10px 0;">
          <div class="glass-card" style="flex-grow:1; display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:20px 16px;">
            <div style="text-align:center;">
              <h3 style="color:${this.color};">🏓 PONG TOUCH CONTROLLER</h3>
              <p style="font-size:12px; color:var(--text-muted); margin-top:4px;">Drag paddle up/down or tap buttons</p>
            </div>

            <!-- Giant Touch Slider Track -->
            <div id="paddleTouchTrack" style="width:100%; height:280px; background:rgba(0,0,0,0.5); border:2px dashed ${this.color}44; border-radius:18px; position:relative; touch-action:none; display:flex; align-items:center; justify-content:center;">
              <div id="visualPaddleThumb" style="position:absolute; width:80%; height:50px; background:${this.color}; border-radius:12px; box-shadow:0 0 20px ${this.color}; pointer-events:none; transition:top 0.05s ease;"></div>
              <span style="color:rgba(255,255,255,0.2); font-weight:800; font-size:14px; letter-spacing:2px;">SLIDE THUMB HERE</span>
            </div>

            <!-- Up / Down Large Buttons -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; width:100%; margin-top:16px;">
              <button class="btn-primary" id="btnPaddleUp" style="padding:16px; font-size:22px; background:${this.color};">
                ▲ UP
              </button>
              <button class="btn-primary" id="btnPaddleDown" style="padding:16px; font-size:22px; background:${this.color};">
                ▼ DOWN
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachControls();
  }

  attachControls() {
    const track = document.getElementById('paddleTouchTrack');
    const thumb = document.getElementById('visualPaddleThumb');

    if (track && thumb) {
      const handleTouch = (e) => {
        e.preventDefault();
        const rect = track.getBoundingClientRect();
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const normY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

        thumb.style.top = `${normY * (rect.height - 50)}px`;
        this.session.sendAction('PADDLE_INPUT', { pos: normY });
      };

      track.addEventListener('touchstart', handleTouch, { passive: false });
      track.addEventListener('touchmove', handleTouch, { passive: false });
      track.addEventListener('mousedown', handleTouch);
    }

    const btnUp = document.getElementById('btnPaddleUp');
    const btnDown = document.getElementById('btnPaddleDown');

    if (btnUp && btnDown) {
      const sendDir = (dir) => {
        vibrate([30]);
        this.session.sendAction('PADDLE_INPUT', { dir });
      };

      btnUp.addEventListener('touchstart', (e) => { e.preventDefault(); sendDir(-1); });
      btnUp.addEventListener('touchend', (e) => { e.preventDefault(); sendDir(0); });
      btnUp.addEventListener('mousedown', () => sendDir(-1));
      btnUp.addEventListener('mouseup', () => sendDir(0));

      btnDown.addEventListener('touchstart', (e) => { e.preventDefault(); sendDir(1); });
      btnDown.addEventListener('touchend', (e) => { e.preventDefault(); sendDir(0); });
      btnDown.addEventListener('mousedown', () => sendDir(1));
      btnDown.addEventListener('mouseup', () => sendDir(0));
    }
  }
}
