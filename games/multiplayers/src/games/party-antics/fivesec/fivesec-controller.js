import { vibrate } from '../../../utils/wake-lock.js';

export class FiveSecController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      this.render();
    });
  }

  render() {
    if (!this.container || !this.publicState) return;

    const isWaiting = this.publicState.phase === 'BUZZER_WAIT';
    const isMe = this.publicState.activeBuzzerPlayerId === this.session.playerId;

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill">5-Sec Rule</div>
        </header>

        <div class="controller-body" style="justify-content:center; align-items:center;">
          <div class="glass-card" style="width:100%; text-align:center; padding:24px 16px;">
            <p style="font-size:16px; font-weight:700; color:var(--text-secondary); margin-bottom:12px;">
              "${this.publicState.prompt}"
            </p>

            ${isWaiting ? `
              <div style="margin:24px 0;">
                <button class="btn-giant-buzzer" id="btnBuzzer">
                  <span>⚡</span>
                  <span class="buzzer-label">BUZZ IN!</span>
                </button>
              </div>
              <p style="color:var(--text-muted); font-size:13px;">First person to tap gets 5 seconds to answer!</p>
            ` : isMe ? `
              <div style="padding:20px 0; animation:pulseGreen 1s infinite alternate;">
                <div style="font-size:54px; margin-bottom:8px;">🎯</div>
                <h2 style="color:var(--accent-emerald); font-size:24px;">YOU BUZZED IN!</h2>
                <div class="timer-digits" style="font-size:48px; margin:12px 0;">0${this.publicState.timerRemaining}</div>
                <p style="font-size:16px; font-weight:700;">SPEAK YOUR 3 ANSWERS OUT LOUD!</p>
              </div>
            ` : `
              <div style="padding:30px 0;">
                <div style="font-size:42px; margin-bottom:8px;">🔒</div>
                <h3>${this.publicState.activeBuzzerPlayerName || 'Someone'} buzzed first!</h3>
                <div class="timer-digits" style="font-size:40px; margin:12px 0;">0${this.publicState.timerRemaining}</div>
                <p style="color:var(--text-muted); font-size:13px;">Listen to their answers...</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnBuzzer')?.addEventListener('click', () => {
      vibrate([100]);
      this.session.sendAction('BUZZ_IN');
    });
  }
}
