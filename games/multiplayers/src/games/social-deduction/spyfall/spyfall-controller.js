import { requestWakeLock, vibrate } from '../../../utils/wake-lock.js';

export class SpyfallController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    // Local controller state
    this.publicState = null;
    this.privateState = null; // { isSpy, secretLocation, category, allLocations, players }
    this.isCardRevealed = true;

    // Cross-out notes (local to this player's device)
    this.crossedLocations = new Set();
    this.clearedPlayers = new Set();

    this.selectedAccusationSuspect = null;
    this.hasVoted = false;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      this.privateState = data;
      this.isCardRevealed = true;
      this.crossedLocations.clear();
      this.clearedPlayers.clear();
      requestWakeLock();
      vibrate([100, 50, 100]);
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

    if (!this.publicState || this.publicState.phase === 'LOBBY') {
      this.renderLobby();
    } else if (this.publicState.phase === 'PLAYING') {
      this.renderPlaying();
    } else if (this.publicState.phase === 'ACCUSATION') {
      this.renderAccusation();
    } else if (this.publicState.phase === 'SPY_GUESS') {
      this.renderSpyGuess();
    } else if (this.publicState.phase === 'ROUND_OVER') {
      this.renderRoundOver();
    }
  }

  renderLobby() {
    const players = this.publicState?.players || [];

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">
            <span class="avatar">${this.session.avatar}</span>
            <span class="name">${this.session.playerName}</span>
          </div>
          <div class="room-pill">Room: <strong>${this.session.roomCode}</strong></div>
        </header>

        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <div class="pulse-ring"></div>
            <h2>You're In the Game!</h2>
            <p class="subtitle">Look at the main screen. The host will start when everyone has joined.</p>

            <div class="player-roster-mini">
              <h4>Connected Players (${players.length}):</h4>
              <div class="roster-grid">
                ${players.map(p => `
                  <div class="roster-item ${p.id === this.session.playerId ? 'self' : ''}">
                    <span>${p.avatar}</span>
                    <span>${p.name} ${p.id === this.session.playerId ? '(You)' : ''}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderPlaying() {
    const isSpy = this.privateState?.isSpy;
    const location = this.privateState?.secretLocation;
    const category = this.privateState?.category || this.publicState?.categoryName;
    const allLocations = this.privateState?.allLocations || this.publicState?.allLocations || [];
    const players = (this.publicState?.players || []).filter(p => p.id !== this.session.playerId);

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">
            <span class="avatar">${this.session.avatar}</span>
            <span class="name">${this.session.playerName}</span>
          </div>
          <div class="timer-pill">
            ⏱️ ${this.formatTime(this.publicState?.timerRemaining)}
          </div>
        </header>

        <div class="controller-body">
          <!-- Secret Role Card -->
          <div class="secret-card-wrapper">
            <div class="secret-card ${isSpy ? 'card-spy' : 'card-location'} ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="secretCardToggle">
              ${this.isCardRevealed ? `
                <div class="card-content">
                  <div class="card-badge">${isSpy ? '🚨 SECRET ASSIGNMENT' : '📍 SECRET LOCATION'}</div>
                  <h1 class="card-title">${isSpy ? 'YOU ARE THE SPY!' : location}</h1>
                  <p class="card-desc">
                    ${isSpy 
                      ? 'You do not know the location! Listen closely to what other players say, blend in, and figure out where you are!'
                      : `Category: <strong>${category}</strong>. Blend in and ask subtle questions to unmask the Spy!`
                    }
                  </p>
                  <button class="btn-hide-curtain" id="btnToggleCurtain">🙈 Tap to Hide Secret</button>
                </div>
              ` : `
                <div class="curtain-content">
                  <span class="eye-icon">🔒</span>
                  <h3>Secret Hidden</h3>
                  <p>Tap here to reveal your secret card</p>
                </div>
              `}
            </div>
          </div>

          <!-- Accusation Action Button -->
          <div class="action-bar">
            <button class="btn-accuse" id="btnOpenAccusationModal">
              🚨 Call Accusation Against a Player
            </button>
          </div>

          <!-- Interactive Deduction Notepad -->
          <div class="glass-card notepad-card">
            <div class="notepad-header">
              <h4>📝 Deduction Notepad (Tap to cross out)</h4>
              <span class="sub-hint">Eliminate locations & cleared suspects</span>
            </div>

            <div class="notepad-section">
              <span class="section-title">Suspects:</span>
              <div class="tag-chips">
                ${players.map(p => `
                  <button class="tag-chip ${this.clearedPlayers.has(p.id) ? 'crossed' : ''}" data-player-id="${p.id}">
                    ${p.avatar} ${p.name}
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="notepad-section">
              <span class="section-title">Possible Locations:</span>
              <div class="tag-chips">
                ${allLocations.map(loc => `
                  <button class="tag-chip ${this.crossedLocations.has(loc) ? 'crossed' : ''}" data-loc="${loc}">
                    ${loc}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Accusation Modal -->
        <div class="modal-overlay" id="accusationModal" style="display:none;">
          <div class="modal-card">
            <h3>🚨 Call an Accusation</h3>
            <p>Select the player you believe is the <strong>Secret Spy</strong>:</p>
            <div class="suspect-picker-grid">
              ${players.map(p => `
                <button class="suspect-select-btn" data-suspect-id="${p.id}">
                  <span class="avatar">${p.avatar}</span>
                  <span class="name">${p.name}</span>
                </button>
              `).join('')}
            </div>
            <button class="btn-secondary" id="btnCloseAccusationModal" style="margin-top:16px;">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Event Listeners
    document.getElementById('secretCardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });

    document.querySelectorAll('.tag-chip[data-loc]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const loc = btn.dataset.loc;
        if (this.crossedLocations.has(loc)) {
          this.crossedLocations.delete(loc);
        } else {
          this.crossedLocations.add(loc);
        }
        btn.classList.toggle('crossed');
      });
    });

    document.querySelectorAll('.tag-chip[data-player-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = btn.dataset.playerId;
        if (this.clearedPlayers.has(pid)) {
          this.clearedPlayers.delete(pid);
        } else {
          this.clearedPlayers.add(pid);
        }
        btn.classList.toggle('crossed');
      });
    });

    // Accusation modal triggers
    const modal = document.getElementById('accusationModal');
    document.getElementById('btnOpenAccusationModal')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'flex';
    });

    document.getElementById('btnCloseAccusationModal')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });

    document.querySelectorAll('.suspect-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const suspectId = btn.dataset.suspectId;
        if (confirm(`Are you sure you want to formally accuse this player?`)) {
          this.session.sendAction('CALL_ACCUSATION', { suspectId });
          if (modal) modal.style.display = 'none';
        }
      });
    });
  }

  renderAccusation() {
    const acc = this.publicState?.accusation;
    if (!acc) return;

    const isSuspect = acc.suspectId === this.session.playerId;
    const isAccuser = acc.accuserId === this.session.playerId;
    const myVote = acc.votes[this.session.playerId];

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">
            <span class="avatar">${this.session.avatar}</span>
            <span class="name">${this.session.playerName}</span>
          </div>
          <div class="timer-pill siren">
            ⏱️ ${acc.timer || 45}s
          </div>
        </header>

        <div class="controller-body">
          <div class="glass-card accusation-vote-card">
            <div class="alert-icon">⚖️</div>
            <h2>Accusation Trial</h2>
            <div class="statement-box">
              <strong>${acc.accuserName}</strong> has accused <br/>
              <span class="target-name">${acc.suspectName}</span> of being the <strong>SPY!</strong>
            </div>

            ${isSuspect ? `
              <div class="suspect-notice">
                <h3>🚨 You Are The Accused!</h3>
                <p>Speak to the room and defend your innocence! Other players are voting right now.</p>
              </div>
            ` : myVote ? `
              <div class="vote-confirmed">
                <span class="check">✓</span>
                <h3>Vote Locked In: ${myVote}</h3>
                <p>Waiting for remaining players to vote...</p>
              </div>
            ` : `
              <div class="ballot-actions">
                <p class="ballot-prompt">Is ${acc.suspectName} the Spy?</p>
                <button class="btn-vote-guilty" id="btnVoteGuilty">
                  🔨 GUILTY (Convict)
                </button>
                <button class="btn-vote-innocent" id="btnVoteInnocent">
                  🤝 INNOCENT (Acquit)
                </button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnVoteGuilty')?.addEventListener('click', () => {
      vibrate([50]);
      this.session.sendAction('VOTE_ACCUSATION', { vote: 'GUILTY' });
    });

    document.getElementById('btnVoteInnocent')?.addEventListener('click', () => {
      vibrate([50]);
      this.session.sendAction('VOTE_ACCUSATION', { vote: 'INNOCENT' });
    });
  }

  renderSpyGuess() {
    const isSpy = this.privateState?.isSpy;
    const allLocations = this.privateState?.allLocations || this.publicState?.allLocations || [];

    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card spy-guess-card">
            <div class="alert-icon">🎯</div>
            <h2>The Spy Has Been Caught!</h2>

            ${isSpy ? `
              <div class="spy-guess-active">
                <p class="highlight-prompt">You were caught! But you can still WIN if you guess the secret location right now:</p>
                <div class="guess-locations-grid">
                  ${allLocations.map(loc => `
                    <button class="guess-loc-btn" data-loc="${loc}">
                      ${loc}
                    </button>
                  `).join('')}
                </div>
              </div>
            ` : `
              <div class="spectate-notice">
                <p>The Spy is making their final guess on their phone. Look at the TV screen!</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    if (isSpy) {
      document.querySelectorAll('.guess-loc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const loc = btn.dataset.loc;
          if (confirm(`Submit "${loc}" as your secret location guess?`)) {
            this.session.sendAction('SPY_GUESS', { location: loc });
          }
        });
      });
    }
  }

  renderRoundOver() {
    const outcome = this.publicState?.roundOutcome;
    const isSpy = this.privateState?.isSpy;

    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card round-over-mobile">
            <h2>Round Finished!</h2>
            <div class="summary-box">
              <p>Secret Location: <strong>${outcome?.secretLocation || 'Revealed'}</strong></p>
              <p>The Spy: <strong>${outcome?.spyNames?.join(', ') || 'Spy'}</strong></p>
            </div>
            <p class="subtitle" style="margin-top:16px;">Look at the main screen for the next round!</p>
          </div>
        </div>
      </div>
    `;
  }
}
