import { vibrate } from '../../../utils/wake-lock.js';
import { controllerHeader } from '../../../utils/ui.js';

export class QuickDrawController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.drawSeenAt = null;
    this.tapped = false;
    this.roundKey = null;

    this.session.on('stateUpdate', (state) => {
      if (state.round !== this.roundKey) {
        this.roundKey = state.round;
        this.tapped = false;
        this.drawSeenAt = null;
      }
      if (state.phase === 'DRAW' && this.drawSeenAt === null) {
        this.drawSeenAt = performance.now();
      }
      const prevPhase = this.publicState?.phase;
      this.publicState = state;
      // Mid-DRAW updates (other players' times) must not rebuild the tap zone under a finger.
      if (state.phase === prevPhase && (state.phase === 'DRAW' || state.phase === 'WAIT') && this.container.querySelector('#tapZone')) {
        this.updateStatus();
        return;
      }
      this.render();
    });
  }

  me() {
    return (this.publicState?.players || []).find(p => p.id === this.session.playerId);
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const me = this.me();
    const right = me ? `${me.score} pts` : '';

    if (!s || s.phase === 'SETUP' || s.phase === 'FINAL') {
      const rank = (s?.players || []).findIndex(p => p.id === this.session.playerId) + 1;
      this.container.innerHTML = `
        <div class="controller-screen">
          ${controllerHeader(this.session, right || undefined)}
          <div class="controller-body">
            <div class="glass-card lobby-wait-card">
              <div class="big-emoji">${s?.phase === 'FINAL' ? (rank === 1 ? '🏆' : '🤠') : '🤠'}</div>
              <h2>${s?.phase === 'FINAL' ? (rank === 1 ? 'Fastest in the room!' : `You finished #${rank}`) : 'Quick Draw'}</h2>
              <p class="subtitle">${s?.phase === 'FINAL' ? `${me?.score || 0} points${me?.best ? ` · best ${me.best} ms` : ''}` : 'Keep a finger hovering over your screen...'}</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div class="controller-screen no-scroll">
        ${controllerHeader(this.session, right || undefined)}
        <button class="tap-zone phase-${s.phase.toLowerCase()}" id="tapZone" aria-label="Tap to draw">
          <span class="tap-label" id="tapLabel"></span>
          <span class="tap-sub" id="tapSub"></span>
        </button>
      </div>
    `;
    this.updateStatus();

    document.getElementById('tapZone').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const st = this.publicState;
      if (this.tapped || !st || st.phase === 'RESULT') return;
      this.tapped = true;
      const early = st.phase !== 'DRAW';
      const reactionMs = early || this.drawSeenAt === null ? null : performance.now() - this.drawSeenAt;
      vibrate(early ? [300] : [30]);
      this.session.sendAction('TAP', { early, reactionMs });
      this.localResult = early ? 'early' : Math.round(reactionMs);
      this.updateStatus();
    });
  }

  updateStatus() {
    const s = this.publicState;
    const zone = document.getElementById('tapZone');
    const label = document.getElementById('tapLabel');
    const sub = document.getElementById('tapSub');
    if (!zone || !label || !s) return;
    zone.className = `tap-zone phase-${s.phase.toLowerCase()}`;
    const mine = (s.results || []).find(r => r.id === this.session.playerId);
    const fs = (s.falseStarts || []).includes(this.session.playerId);

    if (fs) {
      zone.classList.add('out');
      label.textContent = '💥 FALSE START';
      sub.textContent = 'Out for this round. Patience, cowboy!';
    } else if (mine) {
      zone.classList.add('done');
      label.textContent = `${mine.ms} ms`;
      sub.textContent = mine.place <= 3 ? `${['🥇', '🥈', '🥉'][mine.place - 1]} Place #${mine.place}` : `Place #${mine.place}`;
    } else if (this.tapped) {
      label.textContent = this.localResult === 'early' ? '💥 TOO EARLY' : `${this.localResult} ms`;
      sub.textContent = 'Checking with the TV...';
    } else if (s.phase === 'WAIT') {
      label.textContent = 'WAIT...';
      sub.textContent = `Round ${s.round}/${s.totalRounds} · don't tap yet!`;
    } else if (s.phase === 'DECOY') {
      label.textContent = s.decoy || '';
      sub.textContent = "That's not DRAW! Don't tap!";
    } else if (s.phase === 'DRAW') {
      label.textContent = 'DRAW!';
      sub.textContent = 'TAP NOW!';
    } else {
      const winner = s.results?.[0];
      label.textContent = winner ? `${winner.name} wins` : 'Too slow!';
      sub.textContent = 'Next round coming up...';
    }
  }
}
