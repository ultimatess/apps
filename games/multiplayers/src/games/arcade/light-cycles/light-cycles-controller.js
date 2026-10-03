import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader } from '../../../utils/ui.js';

export class LightCyclesController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.wasAlive = null;

    this.session.on('stateUpdate', (state) => {
      const prevPhase = this.publicState?.phase;
      this.publicState = state;
      const me = this.me();
      if (me && this.wasAlive && !me.alive) vibrate([200, 80, 200]);
      this.wasAlive = me ? me.alive : null;
      // Keep the steering pad mounted during a race so taps are never dropped.
      if (state.phase === 'RACING' && prevPhase === 'RACING' && me?.alive && this.container.querySelector('.steer-pad')) {
        this.updateStatus();
        return;
      }
      this.render();
    });
  }

  me() {
    return (this.publicState?.riders || []).find(r => r.id === this.session.playerId) || null;
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const me = this.me();

    if (!s || s.phase === 'SETUP' || !me) {
      const lobby = (s?.lobby || []).find(p => p.id === this.session.playerId);
      this.renderCard('🏍️ Light Cycles', s && s.phase !== 'SETUP'
        ? 'The grid is full (6 riders). Watch the TV, you are in next match!'
        : lobby ? `Your bike is <strong style="color:${lobby.color}">this color</strong>. Get ready to ride!` : 'Waiting for the host to start engines...');
      return;
    }

    if (s.phase === 'MATCH_OVER') {
      const champ = s.championId === me.id;
      this.renderCard(champ ? '🏆 Grid Champion!' : '🏁 Match over', `${champ ? 'You' : escapeHtml((s.riders.find(r => r.id === s.championId) || {}).name || 'Someone')} reached ${s.winsNeeded} stars. You got ${me.wins} ★`);
      if (champ) vibrate([100, 50, 100, 50, 300]);
      return;
    }

    if (s.phase === 'ROUND_OVER') {
      const won = s.roundWinnerId === me.id;
      this.renderCard(won ? '★ You survived!' : '💥 Round over', `${won ? 'Star earned!' : s.roundWinnerName ? `${escapeHtml(s.roundWinnerName)} survived.` : 'Everyone crashed.'} You have ${me.wins}/${s.winsNeeded} ★. Next round is coming...`);
      return;
    }

    if (!me.alive) {
      this.renderCard('💥 CRASHED', 'Watch the TV and cheer. Last rider standing takes the star!');
      return;
    }

    this.container.innerHTML = `
      <div class="controller-screen no-scroll">
        ${controllerHeader(this.session, `<span id="cycleStatus"></span>`, `border-color:${me.color}; color:${me.color};`)}
        <div class="steer-pad" style="--accent:${me.color};">
          <button class="steer-btn" data-dir="-1" aria-label="Turn left"><span>⟲</span>LEFT</button>
          <button class="steer-btn" data-dir="1" aria-label="Turn right"><span>⟳</span>RIGHT</button>
        </div>
      </div>
    `;
    this.updateStatus();

    this.container.querySelectorAll('.steer-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        vibrate([15]);
        btn.classList.add('pressed');
        this.session.sendAction('TURN', { dir: Number(btn.dataset.dir) });
      });
      const up = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  updateStatus() {
    const s = this.publicState;
    const me = this.me();
    const el = document.getElementById('cycleStatus');
    if (!el || !me) return;
    const alive = s.riders.filter(r => r.alive).length;
    el.textContent = s.phase === 'COUNTDOWN' ? 'GET READY' : `${me.wins}★ · ${alive} riding`;
  }

  renderCard(title, message) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session)}
        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <h2>${title}</h2>
            <p class="subtitle">${message}</p>
          </div>
        </div>
      </div>
    `;
  }
}
