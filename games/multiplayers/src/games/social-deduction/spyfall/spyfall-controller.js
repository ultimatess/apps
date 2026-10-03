import { requestWakeLock, vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader, confirmDialog } from '../../../utils/ui.js';

export class SpyfallController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.privateState = null; // { isSpy, secretLocation, category, allLocations, round }
    this.isCardRevealed = false;
    this.crossedLocations = new Set();
    this.clearedPlayers = new Set();
    this.accusing = false;

    this.session.on('stateUpdate', (state) => {
      const prev = this.publicState;
      this.publicState = state;
      if (state.phase === 'ACCUSATION' && prev?.phase !== 'ACCUSATION') vibrate([200, 100, 200]);
      // Timer ticks while playing: patch the clock instead of rebuilding the notepad,
      // unless the roster or used accusations changed.
      const sig = (st) => `${(st?.players || []).map(p => p.id).join(',')}|${(st?.accusationsUsed || []).join(',')}`;
      if (state.phase === 'PLAYING' && prev?.phase === 'PLAYING' && sig(prev) === sig(state) && this.container.querySelector('#phoneTimer')) {
        this.container.querySelector('#phoneTimer').textContent = `⏱️ ${this.formatTime(state.timerRemaining)}`;
        return;
      }
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      if (this.privateState?.round !== data.round) {
        this.crossedLocations.clear();
        this.clearedPlayers.clear();
        this.isCardRevealed = false;
        this.accusing = false;
        vibrate([100, 50, 100]);
      }
      this.privateState = data;
      requestWakeLock();
      this.render();
    });
  }

  formatTime(seconds) {
    if (!seconds && seconds !== 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  render() {
    if (!this.container) return;
    // A card from an earlier round (e.g. after a long disconnect) must never be shown.
    // (The card is sent just before the round's state, so only an older round counts as stale.)
    if (this.privateState && this.publicState && this.privateState.round < this.publicState.roundNumber) this.privateState = null;
    const phase = this.publicState?.phase;
    if (!phase || phase === 'LOBBY') this.renderLobby();
    else if (phase === 'PLAYING') this.renderPlaying();
    else if (phase === 'ACCUSATION') this.renderAccusation();
    else if (phase === 'SPY_GUESS') this.renderSpyGuess();
    else if (phase === 'ROUND_OVER') this.renderRoundOver();
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }

  renderLobby() {
    const players = this.publicState?.players || [];
    this.shell('', `
      <div class="glass-card lobby-wait-card">
        <div class="pulse-ring"></div>
        <h2>🕵️ Spyfall</h2>
        <p class="subtitle">The host will deal secret cards soon. Keep your screen hidden from others!</p>
        ${players.length ? `<p class="hint-text">${players.length} players in the room</p>` : ''}
      </div>
    `);
  }

  renderPlaying() {
    const ps = this.privateState;
    if (!ps) {
      this.shell(`<span id="phoneTimer">⏱️ ${this.formatTime(this.publicState.timerRemaining)}</span>`, `
        <div class="glass-card lobby-wait-card"><h2>Round in progress</h2><p class="subtitle">You joined mid-round. You'll get a card next round. Listen in and enjoy!</p></div>`);
      return;
    }

    const isSpy = ps.isSpy;
    const allLocations = ps.allLocations || this.publicState.allLocations || [];
    const players = (this.publicState.players || []).filter(p => p.id !== this.session.playerId);
    const usedAccusation = (this.publicState.accusationsUsed || []).includes(this.session.playerId);

    this.shell(`<span id="phoneTimer">⏱️ ${this.formatTime(this.publicState.timerRemaining)}</span>`, `
      <div class="secret-card-wrapper">
        <button class="secret-card ${isSpy ? 'card-spy' : 'card-location'} ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="secretCardToggle" aria-label="${this.isCardRevealed ? 'Hide' : 'Show'} secret card">
          ${this.isCardRevealed ? `
            <div class="card-content">
              <div class="card-badge">${isSpy ? '🚨 SECRET ROLE' : '📍 SECRET LOCATION'}</div>
              <h1 class="card-title">${isSpy ? 'YOU ARE THE SPY!' : escapeHtml(ps.secretLocation)}</h1>
              <p class="card-desc">${isSpy
                ? `You don't know the location. Listen, blend in, and figure it out!${ps.spyCount > 1 ? ' (There are 2 spies this round.)' : ''}`
                : `Pack: <strong>${escapeHtml(ps.category)}</strong>. Ask subtle questions to unmask the Spy!`}</p>
              <span class="btn-hide-curtain">🙈 Tap to hide</span>
            </div>
          ` : `
            <div class="curtain-content">
              <span class="eye-icon">🔒</span>
              <h3>Secret Card</h3>
              <p>Tap to peek (shield your screen!)</p>
            </div>
          `}
        </button>
      </div>

      <div class="action-bar">
        ${isSpy ? '<button class="btn-primary btn-amber" id="btnSpyReveal">🎯 I know the location! (reveal & guess)</button>' : ''}
        ${usedAccusation
          ? '<p class="hint-text">You already used your accusation this round.</p>'
          : '<button class="btn-accuse" id="btnOpenAccusation">🚨 Accuse a Player</button>'}
      </div>

      ${this.accusing ? `
        <div class="glass-card">
          <h4 class="section-title">Who is the Spy?</h4>
          <div class="vote-grid">
            ${players.map(p => `<button class="suspect-select-btn" data-suspect-id="${escapeHtml(p.id)}"><span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span></button>`).join('')}
          </div>
          <button class="btn-link" id="btnCancelAccusation">Cancel</button>
        </div>
      ` : ''}

      <div class="glass-card notepad-card">
        <div class="notepad-header">
          <h4>📝 Notepad</h4>
          <span class="sub-hint">Tap to cross out</span>
        </div>
        <div class="notepad-section">
          <span class="section-title">Suspects</span>
          <div class="tag-chips">
            ${players.map(p => `<button class="tag-chip ${this.clearedPlayers.has(p.id) ? 'crossed' : ''}" data-player-id="${escapeHtml(p.id)}">${p.avatar} ${escapeHtml(p.name)}</button>`).join('')}
          </div>
        </div>
        <div class="notepad-section">
          <span class="section-title">Locations</span>
          <div class="tag-chips">
            ${allLocations.map((loc, i) => `<button class="tag-chip ${this.crossedLocations.has(loc) ? 'crossed' : ''}" data-loc-idx="${i}">${escapeHtml(loc)}</button>`).join('')}
          </div>
        </div>
      </div>
    `);

    document.getElementById('secretCardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });

    this.container.querySelectorAll('.tag-chip[data-loc-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const loc = allLocations[Number(btn.dataset.locIdx)];
        if (this.crossedLocations.has(loc)) this.crossedLocations.delete(loc);
        else this.crossedLocations.add(loc);
        btn.classList.toggle('crossed');
      });
    });
    this.container.querySelectorAll('.tag-chip[data-player-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.playerId;
        if (this.clearedPlayers.has(pid)) this.clearedPlayers.delete(pid);
        else this.clearedPlayers.add(pid);
        btn.classList.toggle('crossed');
      });
    });

    document.getElementById('btnOpenAccusation')?.addEventListener('click', () => {
      this.accusing = true;
      this.render();
    });
    document.getElementById('btnCancelAccusation')?.addEventListener('click', () => {
      this.accusing = false;
      this.render();
    });
    this.container.querySelectorAll('[data-suspect-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.querySelector('.name')?.textContent || 'this player';
        if (await confirmDialog(`Formally accuse ${name}? Everyone will vote. You only get one accusation per round.`, { confirmLabel: 'Accuse!' })) {
          this.accusing = false;
          this.session.sendAction('CALL_ACCUSATION', { suspectId: btn.dataset.suspectId });
        }
      });
    });
    document.getElementById('btnSpyReveal')?.addEventListener('click', async () => {
      if (await confirmDialog('Reveal yourself as the Spy and guess the location? A wrong guess loses the round.', { confirmLabel: 'Reveal & Guess' })) {
        this.session.sendAction('SPY_REVEAL');
      }
    });
  }

  renderAccusation() {
    const acc = this.publicState?.accusation;
    if (!acc) return;
    const isSuspect = acc.suspectId === this.session.playerId;
    const myVote = acc.votes[this.session.playerId];

    this.shell('<span class="siren">⚖️ TRIAL</span>', `
      <div class="glass-card accusation-vote-card">
        <div class="alert-icon">⚖️</div>
        <div class="statement-box">
          <strong>${escapeHtml(acc.accuserName)}</strong> accuses<br/>
          <span class="target-name">${escapeHtml(acc.suspectName)}</span> of being the <strong>SPY!</strong>
        </div>
        ${isSuspect ? `
          <div class="suspect-notice">
            <h3>🚨 You're on trial!</h3>
            <p>Defend yourself out loud. Everyone else is voting now.</p>
          </div>
        ` : myVote ? `
          <div class="vote-confirmed">
            <span class="check">✓</span>
            <h3>You voted ${myVote === 'GUILTY' ? '🔨 GUILTY' : '🤝 INNOCENT'}</h3>
            <p>Waiting for the others...</p>
          </div>
        ` : `
          <div class="ballot-actions">
            <p class="ballot-prompt">Is ${escapeHtml(acc.suspectName)} the Spy?</p>
            <button class="btn-vote-guilty" id="btnVoteGuilty">🔨 GUILTY</button>
            <button class="btn-vote-innocent" id="btnVoteInnocent">🤝 INNOCENT</button>
          </div>
        `}
      </div>
    `);

    const vote = (v) => () => {
      vibrate([50]);
      this.session.sendAction('VOTE_ACCUSATION', { vote: v });
    };
    document.getElementById('btnVoteGuilty')?.addEventListener('click', vote('GUILTY'));
    document.getElementById('btnVoteInnocent')?.addEventListener('click', vote('INNOCENT'));
  }

  renderSpyGuess() {
    const guesser = this.publicState?.spyGuess;
    const isGuesser = guesser?.spyId === this.session.playerId;
    const allLocations = this.privateState?.allLocations || this.publicState?.allLocations || [];

    this.shell('<span class="siren">🎯 SPY GUESS</span>', isGuesser ? `
      <div class="glass-card spy-guess-card">
        <h2>Name the secret location!</h2>
        <p class="highlight-prompt">Pick correctly and the Spy wins.</p>
        <div class="guess-locations-grid">
          ${allLocations.filter(l => !this.crossedLocations.has(l)).concat(allLocations.filter(l => this.crossedLocations.has(l))).map(loc => `
            <button class="guess-loc-btn ${this.crossedLocations.has(loc) ? 'crossed' : ''}" data-loc-idx="${allLocations.indexOf(loc)}">${escapeHtml(loc)}</button>
          `).join('')}
        </div>
      </div>
    ` : `
      <div class="glass-card lobby-wait-card">
        <div class="alert-icon">🎯</div>
        <h2>${escapeHtml(guesser?.spyName || 'The Spy')} is the Spy!</h2>
        <p class="subtitle">They're guessing the location right now. Watch the TV!</p>
      </div>
    `);

    if (isGuesser) {
      this.container.querySelectorAll('.guess-loc-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const loc = allLocations[Number(btn.dataset.locIdx)];
          if (await confirmDialog(`Final answer: "${loc}"?`, { confirmLabel: 'Lock it in', tone: 'ok' })) {
            this.session.sendAction('SPY_GUESS', { location: loc });
          }
        });
      });
    }
  }

  renderRoundOver() {
    const o = this.publicState?.roundOutcome;
    const isSpy = this.privateState?.isSpy;
    const townWon = o?.outcome === 'SPY_CAUGHT';
    const iWon = isSpy ? !townWon : townWon;
    const me = (this.publicState.players || []).find(p => p.id === this.session.playerId);

    this.shell(me ? `${me.score} pts` : '', `
      <div class="glass-card round-over-mobile">
        <div class="big-emoji">${this.privateState ? (iWon ? '🏆' : '😵') : '🎬'}</div>
        <h2>${this.privateState ? (iWon ? 'You win this round!' : 'You lost this round') : 'Round finished'}</h2>
        <div class="summary-box">
          <p>Location: <strong>${escapeHtml(o?.secretLocation || '')}</strong></p>
          <p>Spy: <strong>${(o?.spyNames || []).map(escapeHtml).join(', ')}</strong></p>
        </div>
        <p class="subtitle">Next round starts from the TV.</p>
      </div>
    `);
  }
}
