import { vibrate } from '../../../utils/wake-lock.js';
import { controllerHeader } from '../../../utils/ui.js';

export class SquareTagController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.input = { x: 0, y: 0, boost: false };
    this.sendScheduled = false;

    this.session.on('stateUpdate', (state) => {
      const prevPhase = this.publicState?.phase;
      this.publicState = state;
      const me = this.me();
      const active = me && (state.phase === 'PLAYING' || state.phase === 'COUNTDOWN');
      if (active && (prevPhase === 'PLAYING' || prevPhase === 'COUNTDOWN') && this.container.querySelector('#joyBase')) {
        this.updateStatus();
      } else {
        this.render();
      }
    });
  }

  me() {
    return (this.publicState?.players || []).find(p => p.id === this.session.playerId) || null;
  }

  queueSend() {
    if (this.sendScheduled) return;
    this.sendScheduled = true;
    requestAnimationFrame(() => {
      this.sendScheduled = false;
      this.session.sendAction('MOVE_INPUT', this.input);
    });
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const me = this.me();

    if (!s || s.phase === 'SETUP' || !me) {
      const inLobby = (s?.lobby || []).find(p => p.id === this.session.playerId);
      this.container.innerHTML = `
        <div class="controller-screen">
          ${controllerHeader(this.session)}
          <div class="controller-body">
            <div class="glass-card lobby-wait-card">
              <h2>🟦 Square Arena Clash</h2>
              <p class="subtitle">${s && s.phase !== 'SETUP' ? 'The arena is full this round. Watch the TV, you are in next time!' : inLobby ? `You're the <strong style="color:${inLobby.color}">colored square</strong>. Get ready to grab stars!` : 'Waiting for the host to launch the arena...'}</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (s.phase === 'GAME_OVER') {
      const ranked = [...s.players].sort((a, b) => b.score - a.score);
      const rank = ranked.findIndex(p => p.id === me.id) + 1;
      this.container.innerHTML = `
        <div class="controller-screen">
          ${controllerHeader(this.session)}
          <div class="controller-body">
            <div class="glass-card lobby-wait-card">
              <div class="big-emoji">${rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎮'}</div>
              <h2>${rank === 1 ? 'You won the arena!' : `You finished #${rank}`}</h2>
              <p class="subtitle">${me.score} points</p>
            </div>
          </div>
        </div>
      `;
      if (rank === 1) vibrate([100, 50, 100, 50, 200]);
      return;
    }

    this.container.innerHTML = `
      <div class="controller-screen no-scroll">
        ${controllerHeader(this.session, `<span id="tagStatus"></span>`, `border-color:${me.color}; color:${me.color};`)}
        <div class="gamepad-layout" style="--accent:${me.color};">
          <div class="joy-zone" id="joyZone">
            <div class="joy-base" id="joyBase"><div class="joy-knob" id="joyKnob"></div></div>
            <span class="zone-label">MOVE</span>
          </div>
          <button class="turbo-btn" id="btnTurbo" aria-label="Turbo boost">⚡<span>TURBO</span></button>
        </div>
      </div>
    `;
    this.updateStatus();
    this.attachControls();
  }

  updateStatus() {
    const s = this.publicState;
    const me = this.me();
    const el = document.getElementById('tagStatus');
    if (!el || !me) return;
    el.textContent = s.phase === 'COUNTDOWN' ? 'GET READY' : `${me.score} pts · #${me.rank} · ${s.timerRemaining}s`;
  }

  attachControls() {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    const turbo = document.getElementById('btnTurbo');
    if (!zone || !base || !knob || !turbo) return;

    let joyPointer = null;
    let origin = null;
    const radius = () => base.offsetWidth / 2;

    const setStick = (x, y) => {
      const r = radius();
      knob.style.transform = `translate(${x * r * 0.6}px, ${y * r * 0.6}px)`;
      // Small dead zone so a resting thumb doesn't drift.
      const len = Math.hypot(x, y);
      this.input.x = len < 0.15 ? 0 : Math.round(x * 100) / 100;
      this.input.y = len < 0.15 ? 0 : Math.round(y * 100) / 100;
      this.queueSend();
    };

    zone.addEventListener('pointerdown', (e) => {
      if (joyPointer !== null) return;
      e.preventDefault();
      joyPointer = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      const rect = base.getBoundingClientRect();
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      vibrate([10]);
      move(e);
    });
    const move = (e) => {
      if (e.pointerId !== joyPointer) return;
      e.preventDefault();
      const r = radius();
      let dx = (e.clientX - origin.x) / r;
      let dy = (e.clientY - origin.y) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      setStick(dx, dy);
    };
    const end = (e) => {
      if (e.pointerId !== joyPointer) return;
      joyPointer = null;
      setStick(0, 0);
    };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const boost = (on) => (e) => {
      e.preventDefault();
      if (this.input.boost === on) return;
      this.input.boost = on;
      turbo.classList.toggle('active', on);
      if (on) vibrate([30]);
      this.queueSend();
    };
    turbo.addEventListener('pointerdown', (e) => { turbo.setPointerCapture?.(e.pointerId); boost(true)(e); });
    turbo.addEventListener('pointerup', boost(false));
    turbo.addEventListener('pointercancel', boost(false));
    turbo.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
