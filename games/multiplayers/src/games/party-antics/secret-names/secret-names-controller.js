import { vibrate, requestWakeLock } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader, confirmDialog } from '../../../utils/ui.js';

export class SecretNamesController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.privateState = null;
    this.isCardRevealed = false;
    this.pickingSuspect = false;

    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      if (state.phase !== 'PLAYING') this.privateState = state.phase === 'REVEAL' ? this.privateState : null;
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      const fresh = !this.privateState || this.privateState.mission !== data.mission;
      this.privateState = data;
      if (fresh) {
        this.isCardRevealed = false;
        this.pickingSuspect = false;
        vibrate([100, 50, 100]);
        requestWakeLock();
      }
      this.render();
    });
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const p = this.privateState;
    const score = (s?.players || []).find(pl => pl.id === this.session.playerId)?.score || 0;

    if (!s || s.phase === 'SETUP') {
      this.shell('', `<div class="glass-card lobby-wait-card"><h2>🎯 Secret Missions</h2><p class="subtitle">Your secret target and mission will appear here. Keep your screen private!</p></div>`);
      return;
    }

    if (s.phase === 'REVEAL') {
      const row = (s.reveal || []).find(r => r.hunterId === this.session.playerId);
      this.shell(`${score} pts`, `
        <div class="glass-card lobby-wait-card">
          <div class="big-emoji">${row?.completed ? '✅' : row?.exposed ? '🚨' : '⌛'}</div>
          <h2>${row?.completed ? 'Mission accomplished!' : row?.exposed ? 'You were exposed!' : 'Mission incomplete'}</h2>
          <p class="subtitle">Check the TV for everyone's secret missions.</p>
        </div>`);
      return;
    }

    if (!p) {
      this.shell(`${score} pts`, `<div class="glass-card lobby-wait-card"><h2>🕵️ Missions are underway</h2><p class="subtitle">You joined mid-round. You'll get a mission when the host deals the next one.</p></div>`);
      return;
    }

    const players = (s.players || []).filter(pl => pl.id !== this.session.playerId);
    const status = p.completed ? '<div class="status-banner ok">✅ Mission complete! Keep acting natural.</div>'
      : p.exposed ? '<div class="status-banner bad">🚨 Your target exposed you. Mission failed!</div>' : '';

    this.shell(`${score} pts`, `
      <div class="secret-card-wrapper">
        <button class="secret-card card-location ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="cardToggle" aria-label="${this.isCardRevealed ? 'Hide' : 'Reveal'} secret mission">
          ${this.isCardRevealed ? `
            <div class="card-content">
              <div class="card-badge">YOUR TARGET</div>
              <h1 class="card-title">${p.targetAvatar} ${escapeHtml(p.targetName)}</h1>
              <p class="card-desc">${escapeHtml(p.mission)}</p>
              <span class="btn-hide-curtain">🙈 Tap to hide</span>
            </div>
          ` : `
            <div class="curtain-content">
              <span class="eye-icon">🔒</span>
              <h3>Secret Mission</h3>
              <p>Tap to peek (shield your screen!)</p>
            </div>
          `}
        </button>
      </div>
      ${status}
      ${!p.completed && !p.exposed ? '<button class="btn-primary btn-success" id="btnDone">✅ I completed my mission</button>' : ''}
      ${p.callout ? `<div class="status-banner ${p.callout.correct ? 'ok' : 'bad'}">${p.callout.correct ? '🎯 You exposed your hunter!' : '❌ Wrong guess. No more call-outs this round.'}</div>`
        : this.pickingSuspect ? `
          <div class="glass-card">
            <h4 class="section-title">Who is hunting you?</h4>
            <div class="vote-grid">${players.map(pl => `<button class="suspect-select-btn" data-suspect="${escapeHtml(pl.id)}"><span class="avatar">${pl.avatar}</span><span class="name">${escapeHtml(pl.name)}</span></button>`).join('')}</div>
            <button class="btn-link" id="btnCancelCallout">Cancel</button>
          </div>`
        : '<button class="btn-accuse" id="btnCallout">🚨 Expose my hunter (1 guess)</button>'}
    `);

    document.getElementById('cardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });
    document.getElementById('btnDone')?.addEventListener('click', async () => {
      if (await confirmDialog('Did you really complete your mission? Be honest, secret agent!', { confirmLabel: 'Yes, done!', tone: 'ok' })) {
        vibrate([60]);
        this.session.sendAction('MISSION_DONE');
      }
    });
    document.getElementById('btnCallout')?.addEventListener('click', () => {
      this.pickingSuspect = true;
      this.render();
    });
    document.getElementById('btnCancelCallout')?.addEventListener('click', () => {
      this.pickingSuspect = false;
      this.render();
    });
    this.container.querySelectorAll('[data-suspect]').forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.querySelector('.name')?.textContent || 'this player';
      if (await confirmDialog(`Accuse ${name} of hunting you? You only get one guess.`, { confirmLabel: 'Accuse' })) {
        this.pickingSuspect = false;
        this.session.sendAction('CALL_OUT', { suspectId: btn.dataset.suspect });
      }
    }));
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right || undefined)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }
}
