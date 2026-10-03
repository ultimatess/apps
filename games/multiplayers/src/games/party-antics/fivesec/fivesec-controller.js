import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader } from '../../../utils/ui.js';

export class FiveSecController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;

    this.session.on('stateUpdate', (state) => {
      const prev = this.publicState;
      this.publicState = state;
      if (state.phase === 'COUNTDOWN' && prev?.phase === 'COUNTDOWN' && this.container.querySelector('#phoneTimer')) {
        this.container.querySelector('#phoneTimer').textContent = String(state.timerRemaining);
        if (state.activeBuzzerPlayerId === this.session.playerId) vibrate([20]);
        return;
      }
      if (state.phase === 'BUZZER_WAIT' && prev?.phase !== 'BUZZER_WAIT') vibrate([40]);
      this.render();
    });
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const me = (s?.players || []).find(p => p.id === this.session.playerId);
    const myScore = me ? `${me.score} pts` : '5-SEC RULE';

    if (!s || s.phase === 'SETUP') {
      this.shell(myScore, `
        <div class="glass-card lobby-wait-card">
          <h2>⚡ 5-Second Rule</h2>
          <p class="subtitle">Get your thumb ready. When the buzzer lights up, smash it before anyone else!</p>
        </div>`);
      return;
    }

    if (s.phase === 'GAME_OVER') {
      const won = s.winnerId === this.session.playerId;
      const rank = s.players.findIndex(p => p.id === this.session.playerId) + 1;
      this.shell(myScore, `
        <div class="glass-card lobby-wait-card">
          <div class="big-emoji">${won ? '🏆' : '🎉'}</div>
          <h2>${won ? 'You win!' : `You finished #${rank}`}</h2>
        </div>`);
      return;
    }

    const isMe = s.activeBuzzerPlayerId === this.session.playerId;
    let body;
    if (s.phase === 'READING') {
      body = `
        <button class="btn-giant-buzzer armed-wait" disabled><span>⏳</span><span class="buzzer-label">GET READY</span></button>
        <p class="hint-text">Read the prompt...</p>`;
    } else if (s.phase === 'BUZZER_WAIT') {
      body = `
        <button class="btn-giant-buzzer" id="btnBuzzer"><span>⚡</span><span class="buzzer-label">BUZZ!</span></button>
        <p class="hint-text">First tap wins the turn</p>`;
    } else if (s.phase === 'COUNTDOWN') {
      body = isMe ? `
        <div class="buzz-result me">
          <div class="big-emoji">🎯</div>
          <h2>YOU'RE UP!</h2>
          <div class="timer-digits huge" id="phoneTimer">${s.timerRemaining}</div>
          <p>Shout 3 answers out loud!</p>
        </div>` : `
        <div class="buzz-result">
          <div class="big-emoji">🔒</div>
          <h3>${escapeHtml(s.activeBuzzerPlayerName || 'Someone')} buzzed first</h3>
          <div class="timer-digits huge" id="phoneTimer">${s.timerRemaining}</div>
          <p class="muted">Listen carefully: did they get all 3?</p>
        </div>`;
    } else {
      body = `
        <div class="buzz-result">
          <div class="big-emoji">⚖️</div>
          <h3>${isMe ? 'Judging your answer...' : `Judging ${escapeHtml(s.activeBuzzerPlayerName || '')}`}</h3>
        </div>`;
    }

    this.shell(myScore, `
      <div class="glass-card prompt-card">
        <p class="phone-prompt">${escapeHtml(s.prompt)}</p>
      </div>
      <div class="buzzer-area">${body}</div>
    `);

    const btn = document.getElementById('btnBuzzer');
    btn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('pressed');
      vibrate([120]);
      this.session.sendAction('BUZZ_IN');
    });
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }
}
