import { requestWakeLock, vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader } from '../../../utils/ui.js';

export class MafiaController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.privateState = null;
    this.isCardRevealed = false;
    this.nightKey = null;
    this.nightChoice = null;
    this.dayVote = null;

    this.session.on('stateUpdate', (state) => {
      const prev = this.publicState;
      this.publicState = state;
      const key = `${state.gameNumber}-${state.phase}-${state.roundNumber}`;
      if (state.phase === 'NIGHT' && key !== this.nightKey) {
        this.nightKey = key;
        this.nightChoice = null;
        vibrate([80, 60, 80]);
      }
      if (prev && prev.gameNumber !== state.gameNumber) {
        this.nightChoice = null;
        this.dayVote = null;
        this.isCardRevealed = false;
      }
      if (state.phase === 'DAY_VOTING' && prev?.phase !== 'DAY_VOTING') {
        this.dayVote = null;
        vibrate([60]);
      }
      // Timer-only syncs during night/discussion shouldn't rebuild the picker.
      if (prev && prev.phase === state.phase && (state.phase === 'NIGHT' || state.phase === 'DAY_DISCUSSION') && this.amAlive() === this.wasAlive) {
        const el = document.getElementById('phaseTimer');
        if (el) el.textContent = state.phase === 'NIGHT' ? `${state.timerRemaining}s` : 'Discuss';
        return;
      }
      this.wasAlive = this.amAlive();
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      const newGame = !this.privateState || data.gameNumber !== this.privateState.gameNumber;
      this.privateState = data;
      if (newGame) {
        this.isCardRevealed = false;
        requestWakeLock();
      }
      if (data.inspectionResult) vibrate([40, 40, 40]);
      this.render();
    });
  }

  amAlive() {
    return !!(this.publicState?.players || []).find(p => p.id === this.session.playerId)?.isAlive;
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }

  roleCard() {
    const p = this.privateState;
    if (!p) return '';
    const isMafia = p.role === 'Mafia';
    return `
      <button class="secret-card compact ${isMafia ? 'card-spy' : 'card-location'} ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="roleCardToggle">
        ${this.isCardRevealed ? `
          <div class="card-content">
            <div class="card-badge">YOUR SECRET ROLE</div>
            <h1 class="card-title">${p.roleInfo?.icon || ''} ${escapeHtml(p.role)}</h1>
            <p class="card-desc">${escapeHtml(p.roleInfo?.desc || '')}</p>
            ${isMafia && p.mafiaTeammates?.length ? `<p class="card-desc mafia-team">Your crew: ${p.mafiaTeammates.map(t => `<strong>${escapeHtml(t.name)}</strong>${t.alive ? '' : ' 🪦'}`).join(', ')}</p>` : ''}
            <span class="btn-hide-curtain">🙈 Tap to hide</span>
          </div>
        ` : `
          <div class="curtain-content"><span class="eye-icon">🔒</span><h3>Role hidden</h3><p>Tap to peek</p></div>
        `}
      </button>
    `;
  }

  bindRoleCard() {
    document.getElementById('roleCardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    if (!s || s.phase === 'SETUP' || !this.privateState) {
      this.shell('', `
        <div class="glass-card lobby-wait-card">
          <h2>🌙 Mafia</h2>
          <p class="subtitle">${s && s.phase !== 'SETUP' ? 'A game is in progress. You will be dealt in next game.' : 'The host will deal secret roles soon. Keep your screen private!'}</p>
        </div>
      `);
      return;
    }

    if (s.phase === 'GAME_OVER') return this.renderGameOver();
    if (!this.amAlive()) return this.renderGhost();

    if (s.phase === 'NIGHT') this.renderNight();
    else if (s.phase === 'DAY_VOTING') this.renderDayVoting();
    else this.renderDay();
  }

  targetGrid(players, cls, selectedId) {
    return `
      <div class="vote-grid">
        ${players.map(p => `
          <button class="suspect-select-btn ${cls} ${p.id === selectedId ? 'selected' : ''}" data-target-id="${escapeHtml(p.id)}">
            <span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}${p.id === this.session.playerId ? ' (You)' : ''}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  renderNight() {
    const s = this.publicState;
    const p = this.privateState;
    const role = p.role;
    const alive = (s.players || []).filter(pl => pl.isAlive);
    const others = alive.filter(pl => pl.id !== this.session.playerId);
    const nameOf = (id) => alive.find(pl => pl.id === id)?.name || '';
    let action;

    if (role === 'Mafia') {
      const teammateNames = new Set((p.mafiaTeammates || []).map(t => t.name));
      const victims = others.filter(pl => !teammateNames.has(pl.name));
      const picks = (p.mafiaTeammates || []).filter(t => t.alive && t.pick);
      action = `
        <h3>🔪 Choose tonight's victim</h3>
        ${picks.length ? `<p class="hint-text">Crew picks: ${picks.map(t => `${escapeHtml(t.name)} → <strong>${escapeHtml(t.pick)}</strong>`).join(' · ')}</p>` : ''}
        ${this.targetGrid(victims, 'night-pick', this.nightChoice)}
        ${this.nightChoice ? `<p class="hint-text">✓ You picked ${escapeHtml(nameOf(this.nightChoice))}. You can change until morning.</p>` : ''}
      `;
    } else if (role === 'Doctor') {
      const options = alive.filter(pl => pl.id !== p.lastDoctorTarget);
      action = this.nightChoice ? this.done(`Protecting ${escapeHtml(nameOf(this.nightChoice))} tonight.`) : `
        <h3>💉 Who will you protect?</h3>
        ${p.lastDoctorTarget ? '<p class="hint-text">You cannot protect the same person two nights in a row.</p>' : ''}
        ${this.targetGrid(options, 'night-pick')}
      `;
    } else if (role === 'Detective') {
      const r = p.inspectionResult;
      action = r ? `
        <div class="inspection ${r.isGuilty ? 'guilty' : 'innocent'}">
          <h4>🔍 Investigation result</h4>
          <p><strong>${escapeHtml(r.targetName)}</strong> is ${r.isGuilty ? '🚨 MAFIA' : '🛡️ NOT Mafia'}</p>
        </div>
      ` : this.nightChoice ? this.done('Investigating...') : `
        <h3>🔍 Who will you investigate?</h3>
        ${this.targetGrid(others, 'night-pick')}
      `;
    } else if (role === 'Vigilante' && !p.vigilanteUsed) {
      action = this.nightChoice ? this.done(this.nightChoice === 'HOLD' ? 'Holding your fire tonight.' : `Aiming at ${escapeHtml(nameOf(this.nightChoice))}...`) : `
        <h3>🎯 Use your single bullet?</h3>
        ${this.targetGrid(others, 'night-pick')}
        <button class="btn-secondary" id="btnHoldFire">🕊️ Hold fire tonight</button>
      `;
    } else {
      // Cover action: identical tapping for everyone hides who has a real power.
      action = this.nightChoice ? this.done('Sweet dreams. Keep your phone face down until morning.') : `
        <h3>🤔 Who do you suspect?</h3>
        <p class="hint-text">Everyone taps at night so nobody can tell who has a power.</p>
        ${this.targetGrid(others, 'night-pick')}
      `;
    }

    this.shell(`<span class="siren">🌙 <span id="phaseTimer">${s.timerRemaining}s</span></span>`, `
      ${this.roleCard()}
      <div class="glass-card night-card">${action}</div>
    `);
    this.bindRoleCard();

    const actionName = { Mafia: 'MAFIA_KILL', Doctor: 'DOCTOR_SAVE', Detective: 'DETECTIVE_INSPECT', Vigilante: p.vigilanteUsed ? 'NIGHT_DONE' : 'VIGILANTE_SHOOT' }[role] || 'NIGHT_DONE';
    this.container.querySelectorAll('.night-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        vibrate([30]);
        this.nightChoice = btn.dataset.targetId;
        this.session.sendAction(actionName, { targetId: btn.dataset.targetId });
        this.render();
      });
    });
    document.getElementById('btnHoldFire')?.addEventListener('click', () => {
      this.nightChoice = 'HOLD';
      this.session.sendAction('VIGILANTE_SHOOT', { targetId: null });
      this.render();
    });
  }

  done(text) {
    return `<div class="vote-confirmed"><span class="check">✓</span><p>${text}</p></div>`;
  }

  renderDay() {
    const s = this.publicState;
    let main;
    if (s.phase === 'DAY_ANNOUNCE') {
      main = `<div class="glass-card lobby-wait-card"><div class="big-emoji">☀️</div><h2>Morning</h2><div class="report-box small">${s.nightReport}</div></div>`;
    } else if (s.phase === 'DAY_RESULT') {
      const l = s.lastLynch;
      main = `<div class="glass-card lobby-wait-card"><div class="big-emoji">${l ? '⚰️' : '🤷'}</div><h2>${l ? `${escapeHtml(l.name)} was eliminated` : 'Nobody was eliminated'}</h2>${l ? `<p class="subtitle">They were ${escapeHtml(l.role)}</p>` : ''}</div>`;
    } else {
      main = `<div class="glass-card lobby-wait-card"><div class="big-emoji">🗣️</div><h2>Discuss!</h2><p class="subtitle">Who's acting suspicious? Voting opens soon.</p></div>`;
    }
    this.shell(`<span id="phaseTimer">${s.phase === 'DAY_DISCUSSION' ? 'Discuss' : 'Day'}</span>`, `${main}${this.roleCard()}`);
    this.bindRoleCard();
  }

  renderDayVoting() {
    const s = this.publicState;
    const candidates = (s.players || []).filter(p => p.isAlive && p.id !== this.session.playerId);
    const chosen = candidates.find(p => p.id === this.dayVote);

    this.shell('<span class="siren">⚖️ VOTE</span>', `
      <div class="glass-card">
        <h2>Who should leave town?</h2>
        ${this.dayVote ? `
          <div class="vote-confirmed">
            <span class="check">✓</span>
            <h3>${this.dayVote === 'SKIP' ? '🕊️ You skipped' : `You voted ${escapeHtml(chosen?.name || '')}`}</h3>
            <button class="btn-link" id="btnChangeVote">Change vote</button>
          </div>
        ` : `
          ${this.targetGrid(candidates, 'day-pick')}
          <button class="suspect-select-btn day-pick skip-btn" data-target-id="SKIP"><span>🕊️</span><span>Skip vote</span></button>
        `}
      </div>
    `);
    this.container.querySelectorAll('.day-pick').forEach(btn => btn.addEventListener('click', () => {
      vibrate([40]);
      this.dayVote = btn.dataset.targetId;
      this.session.sendAction('CAST_VOTE', { targetId: this.dayVote });
      this.render();
    }));
    document.getElementById('btnChangeVote')?.addEventListener('click', () => {
      this.dayVote = null;
      this.render();
    });
  }

  renderGhost() {
    this.shell('🪦 Ghost', `
      <div class="glass-card lobby-wait-card">
        <div class="big-emoji">👻</div>
        <h2>You have been eliminated</h2>
        <p class="subtitle">Stay quiet and enjoy the show. No hints for the living!</p>
      </div>
      ${this.roleCard()}
    `);
    this.bindRoleCard();
  }

  renderGameOver() {
    const s = this.publicState;
    const role = this.privateState?.role;
    const team = role === 'Mafia' ? 'MAFIA' : role === 'Jester' ? 'JESTER' : 'TOWN';
    const won = s.winner === team;
    this.shell('', `
      <div class="glass-card round-over-mobile">
        <div class="big-emoji">${won ? '🏆' : '💀'}</div>
        <h2>${won ? 'Your side wins!' : 'Your side lost'}</h2>
        <p class="subtitle">${escapeHtml(s.gameOverMessage || '')}</p>
        <p class="hint-text">You were ${escapeHtml(role || '')}</p>
      </div>
    `);
  }
}
