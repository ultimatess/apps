import { SPYFALL_CATEGORIES } from '../../../data/locations.js';
import { renderQRCodeToCanvas } from '../../../netplay/qrcode.js';
import { getJoinUrl } from '../../../netplay/room-code.js';
import { playTick, playGong, playRoundStart, playVictory, playBuzzer } from '../../../utils/audio.js';

export class SpyfallHost {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    // Master Game State
    this.phase = 'LOBBY'; // 'LOBBY' | 'PLAYING' | 'ACCUSATION' | 'SPY_GUESS' | 'ROUND_OVER'
    this.selectedCategoryIndex = 0; // default to first (Tamil Cinema) or customizable
    this.roundDuration = 360; // 6 minutes in seconds
    this.timerRemaining = 360;
    this.timerInterval = null;
    this.timerActive = false;

    this.roundNumber = 0;
    this.secretLocation = null;
    this.currentLocationsList = [];
    this.spyIds = [];
    this.scores = {}; // playerId -> score
    this.usedLocations = new Set();

    this.accusation = null;
    this.firstQuestioner = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerJoin', (player) => {
      if (!this.scores[player.id]) this.scores[player.id] = 0;
      this.render();
      this.syncState();
    });

    this.session.on('playerLeave', (player) => {
      this.render();
      this.syncState();
    });

    this.session.on('playerAction', (playerId, action, payload) => {
      this.handlePlayerAction(playerId, action, payload);
    });
  }

  handlePlayerAction(playerId, action, payload) {
    console.log(`[Host] Action from ${playerId}:`, action, payload);

    if (action === 'CALL_ACCUSATION' && this.phase === 'PLAYING') {
      const suspectId = payload.suspectId;
      if (!suspectId || suspectId === playerId) return;
      this.initiateAccusation(playerId, suspectId);
    } else if (action === 'VOTE_ACCUSATION' && this.phase === 'ACCUSATION') {
      if (!this.accusation) return;
      this.accusation.votes[playerId] = payload.vote; // 'GUILTY' or 'INNOCENT'
      this.syncState();
      this.render();
      this.checkAccusationVotesComplete();
    } else if (action === 'SPY_GUESS' && this.phase === 'SPY_GUESS') {
      if (this.spyIds.includes(playerId)) {
        this.resolveSpyGuess(payload.location);
      }
    }
  }

  startNewGame() {
    const players = Array.from(this.session.clients.values());
    if (players.length < 1) {
      alert('At least 1 player required to test!');
      return;
    }

    this.roundNumber++;
    this.determineLocationAndSpies();
    this.timerRemaining = this.roundDuration;
    this.timerActive = true;
    this.phase = 'PLAYING';
    this.accusation = null;

    // Pick random first questioner
    this.firstQuestioner = players[Math.floor(Math.random() * players.length)];

    playRoundStart();
    this.startTimer();
    this.dispatchRoles();
    this.syncState();
    this.render();
  }

  determineLocationAndSpies() {
    const players = Array.from(this.session.clients.values());
    const cat = SPYFALL_CATEGORIES[this.selectedCategoryIndex] || SPYFALL_CATEGORIES[0];
    const availableLocs = cat.locations;
    this.currentLocationsList = [...availableLocs];

    // Pick location avoiding immediate repeats
    let pool = availableLocs.filter(loc => !this.usedLocations.has(loc));
    if (pool.length === 0) {
      this.usedLocations.clear();
      pool = availableLocs;
    }
    this.secretLocation = pool[Math.floor(Math.random() * pool.length)];
    this.usedLocations.add(this.secretLocation);

    // Pick 1 Spy (or 2 if >= 7 players)
    const spyCount = players.length >= 7 ? 2 : 1;
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    this.spyIds = shuffled.slice(0, spyCount).map(p => p.id);
  }

  dispatchRoles() {
    const cat = SPYFALL_CATEGORIES[this.selectedCategoryIndex] || SPYFALL_CATEGORIES[0];
    const players = Array.from(this.session.clients.values());

    players.forEach(p => {
      const isSpy = this.spyIds.includes(p.id);
      this.session.sendPrivateState(p.id, {
        isSpy,
        secretLocation: isSpy ? null : this.secretLocation,
        category: cat.category,
        allLocations: this.currentLocationsList,
        players: players.map(pl => ({ id: pl.id, name: pl.name, avatar: pl.avatar }))
      });
    });
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.timerActive && this.timerRemaining > 0) {
        this.timerRemaining--;
        if (this.timerRemaining <= 10 && this.timerRemaining > 0) {
          playTick(1000 + (10 - this.timerRemaining) * 80);
        }
        if (this.timerRemaining === 0) {
          this.handleTimerExpired();
        }
        // Update timer on screen every second
        const timerEl = document.getElementById('hostTimerDisplay');
        if (timerEl) timerEl.textContent = this.formatTime(this.timerRemaining);
        // Periodic sync to clients
        if (this.timerRemaining % 3 === 0) this.syncState();
      }
    }, 1000);
  }

  handleTimerExpired() {
    this.timerActive = false;
    playBuzzer();
    // Round time up -> group must vote on who the spy is
    this.endRound('TIME_EXPIRED', null);
  }

  initiateAccusation(accuserId, suspectId) {
    this.timerActive = false;
    playGong();

    const accuser = this.session.clients.get(accuserId) || { name: 'Player' };
    const suspect = this.session.clients.get(suspectId) || { name: 'Suspect' };

    this.phase = 'ACCUSATION';
    this.accusation = {
      accuserId,
      accuserName: accuser.name,
      suspectId,
      suspectName: suspect.name,
      votes: { [accuserId]: 'GUILTY' }, // accuser votes guilty automatically
      timer: 45
    };

    this.syncState();
    this.render();

    // Accusation timeout countdown
    if (this.accusationInterval) clearInterval(this.accusationInterval);
    this.accusationInterval = setInterval(() => {
      if (this.phase === 'ACCUSATION' && this.accusation) {
        this.accusation.timer--;
        const accTimerEl = document.getElementById('accusationTimer');
        if (accTimerEl) accTimerEl.textContent = `${this.accusation.timer}s`;
        if (this.accusation.timer <= 0) {
          clearInterval(this.accusationInterval);
          this.resolveAccusation();
        }
      }
    }, 1000);
  }

  checkAccusationVotesComplete() {
    if (!this.accusation) return;
    const players = Array.from(this.session.clients.values());
    const voters = players.filter(p => p.id !== this.accusation.suspectId);
    const voteCount = Object.keys(this.accusation.votes).length;

    if (voteCount >= voters.length) {
      if (this.accusationInterval) clearInterval(this.accusationInterval);
      this.resolveAccusation();
    }
  }

  resolveAccusation() {
    if (!this.accusation) return;
    const votes = Object.values(this.accusation.votes);
    const guiltyVotes = votes.filter(v => v === 'GUILTY').length;
    const innocentVotes = votes.filter(v => v === 'INNOCENT').length;

    const suspectIsSpy = this.spyIds.includes(this.accusation.suspectId);

    if (guiltyVotes > innocentVotes) {
      // Majority voted GUILTY!
      if (suspectIsSpy) {
        // Suspect IS the Spy! Spy gets chance to guess location
        this.phase = 'SPY_GUESS';
        this.syncState();
        this.render();
      } else {
        // Suspect was INNOCENT! Spy wins
        this.endRound('INNOCENT_ACCUSED', {
          accuser: this.accusation.accuserName,
          suspect: this.accusation.suspectName
        });
      }
    } else {
      // Accusation failed -> Resume game with small penalty
      this.phase = 'PLAYING';
      this.timerActive = true;
      this.accusation = null;
      this.syncState();
      this.render();
    }
  }

  resolveSpyGuess(guessedLocation) {
    const isCorrect = guessedLocation.toLowerCase().trim() === this.secretLocation.toLowerCase().trim();
    if (isCorrect) {
      this.endRound('SPY_GUESSED_LOCATION', { guess: guessedLocation });
    } else {
      this.endRound('SPY_CAUGHT', { guess: guessedLocation });
    }
  }

  endRound(outcome, details = {}) {
    this.phase = 'ROUND_OVER';
    this.timerActive = false;
    clearInterval(this.timerInterval);

    const players = Array.from(this.session.clients.values());
    const spyNames = this.spyIds.map(id => this.session.clients.get(id)?.name || 'Spy');

    if (outcome === 'SPY_CAUGHT') {
      // Town wins!
      players.forEach(p => {
        if (!this.spyIds.includes(p.id)) this.scores[p.id] = (this.scores[p.id] || 0) + 1;
      });
      if (this.accusation && this.accusation.accuserId) {
        this.scores[this.accusation.accuserId] = (this.scores[this.accusation.accuserId] || 0) + 1; // bonus for accuser
      }
      playVictory();
    } else if (outcome === 'SPY_GUESSED_LOCATION' || outcome === 'INNOCENT_ACCUSED' || outcome === 'TIME_EXPIRED') {
      // Spy wins!
      this.spyIds.forEach(id => {
        this.scores[id] = (this.scores[id] || 0) + 3;
      });
      playVictory();
    }

    this.roundOutcome = { outcome, details, spyNames, secretLocation: this.secretLocation };
    this.syncState();
    this.render();
  }

  syncState() {
    const players = Array.from(this.session.clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: this.scores[p.id] || 0,
      latency: p.latency || 0
    }));

    const cat = SPYFALL_CATEGORIES[this.selectedCategoryIndex] || SPYFALL_CATEGORIES[0];

    this.session.broadcastPublicState({
      phase: this.phase,
      roundNumber: this.roundNumber,
      categoryName: cat.category,
      timerRemaining: this.timerRemaining,
      timerActive: this.timerActive,
      players: players,
      allLocations: this.currentLocationsList,
      accusation: this.accusation,
      firstQuestioner: this.firstQuestioner ? this.firstQuestioner.name : null,
      roundOutcome: this.phase === 'ROUND_OVER' ? this.roundOutcome : null
    });
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  render() {
    if (!this.container) return;

    if (this.phase === 'LOBBY') {
      this.renderLobby();
    } else if (this.phase === 'PLAYING') {
      this.renderPlaying();
    } else if (this.phase === 'ACCUSATION') {
      this.renderAccusation();
    } else if (this.phase === 'SPY_GUESS') {
      this.renderSpyGuess();
    } else if (this.phase === 'ROUND_OVER') {
      this.renderRoundOver();
    }
  }

  renderLobby() {
    const joinUrl = getJoinUrl(this.session.roomCode);
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge">
            <span class="pulse-dot"></span>
            <span>NETPLAY SPYFALL</span>
          </div>
          <div class="room-code-display">
            <span class="label">ROOM CODE</span>
            <span class="code" id="lblRoomCode">${this.session.roomCode}</span>
          </div>
        </header>

        <div class="lobby-grid">
          <!-- Left Column: Join Instructions & QR Code -->
          <div class="glass-card qr-card">
            <h3><i class="icon">📱</i> Scan to Join from Phone</h3>
            <p class="subtitle">Open mobile camera or visit <br><strong>${window.location.host}${window.location.pathname}</strong></p>
            <div class="qr-canvas-wrapper">
              <canvas id="qrCanvas"></canvas>
            </div>
            <div class="join-link-box">
              <input type="text" readonly value="${joinUrl}" id="txtJoinLink" />
              <button class="btn-copy" id="btnCopyLink">Copy</button>
            </div>
          </div>

          <!-- Middle Column: Connected Players -->
          <div class="glass-card players-card">
            <div class="card-header">
              <h3><i class="icon">👥</i> Players in Room (<span id="playerCount">${players.length}</span>)</h3>
              <span class="badge ${players.length >= 3 ? 'badge-success' : 'badge-warning'}">
                ${players.length >= 3 ? 'Ready to Play' : 'Waiting for Players (min 3)'}
              </span>
            </div>
            <div class="players-roster" id="rosterList">
              ${players.length === 0 ? `
                <div class="empty-roster">
                  <div class="radar-scan"></div>
                  <p>Waiting for players to scan QR code...</p>
                </div>
              ` : players.map(p => `
                <div class="player-chip">
                  <span class="avatar">${p.avatar}</span>
                  <span class="name">${p.name}</span>
                  <span class="ping-badge">${p.latency || 15}ms</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Right Column: Settings & Launch -->
          <div class="glass-card settings-card">
            <h3><i class="icon">⚙️</i> Game Setup</h3>

            <div class="form-group">
              <label>Location Pack (${SPYFALL_CATEGORIES.length} Packs Available):</label>
              <select id="selCategory" class="custom-select">
                ${SPYFALL_CATEGORIES.map((cat, idx) => `
                  <option value="${idx}" ${idx === this.selectedCategoryIndex ? 'selected' : ''}>
                    ${cat.featured ? '⭐ ' : ''}${cat.category} (${cat.locations.length} locs)
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Round Timer:</label>
              <div class="timer-chips">
                <button class="chip-btn ${this.roundDuration === 300 ? 'active' : ''}" data-time="300">5 Mins</button>
                <button class="chip-btn ${this.roundDuration === 360 ? 'active' : ''}" data-time="360">6 Mins</button>
                <button class="chip-btn ${this.roundDuration === 480 ? 'active' : ''}" data-time="480">8 Mins</button>
              </div>
            </div>

            <button class="btn-launch-game ${players.length >= 1 ? 'ready' : 'disabled'}" id="btnLaunchGame">
              <span>🚀 Launch Spyfall</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Render Canvas QR Code
    const qrCanvas = document.getElementById('qrCanvas');
    if (qrCanvas) {
      renderQRCodeToCanvas(qrCanvas, joinUrl, {
        size: 190,
        padding: 10,
        darkColor: '#090d16',
        lightColor: '#ffffff'
      });
    }

    // Attach Event Listeners
    document.getElementById('btnCopyLink')?.addEventListener('click', () => {
      navigator.clipboard.writeText(joinUrl);
      const btn = document.getElementById('btnCopyLink');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });

    document.getElementById('selCategory')?.addEventListener('change', (e) => {
      this.selectedCategoryIndex = parseInt(e.target.value);
    });

    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.roundDuration = parseInt(e.target.dataset.time);
      });
    });

    document.getElementById('btnLaunchGame')?.addEventListener('click', () => {
      this.startNewGame();
    });
  }

  renderPlaying() {
    const cat = SPYFALL_CATEGORIES[this.selectedCategoryIndex] || SPYFALL_CATEGORIES[0];
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header in-game-header">
          <div class="brand-badge">
            <span class="badge-cat">${cat.category}</span>
            <span class="round-indicator">ROUND ${this.roundNumber}</span>
          </div>

          <div class="central-timer">
            <div class="timer-box">
              <span class="timer-digits" id="hostTimerDisplay">${this.formatTime(this.timerRemaining)}</span>
            </div>
            <div class="timer-controls">
              <button class="btn-icon" id="btnToggleTimer" title="${this.timerActive ? 'Pause' : 'Resume'}">
                ${this.timerActive ? '⏸️' : '▶️'}
              </button>
              <button class="btn-icon" id="btnAddTime" title="+1 Minute">+1m</button>
            </div>
          </div>

          <div class="room-code-mini">
            Room: <strong>${this.session.roomCode}</strong>
          </div>
        </header>

        <div class="playing-layout">
          <!-- Central Board: All Locations in Play -->
          <div class="glass-card locations-board">
            <div class="board-header">
              <h3><i class="icon">🗺️</i> Possible Locations Board (Reference for Room)</h3>
              <p class="hint">The Spy does not know which location is real!</p>
            </div>
            <div class="locations-grid">
              ${this.currentLocationsList.map(loc => `
                <div class="location-tile">
                  <span class="loc-name">${loc}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Right Sidebar: Players & Question Tracker -->
          <div class="glass-card game-sidebar">
            <div class="card-header">
              <h3><i class="icon">🕵️‍♂️</i> Suspect Roster</h3>
            </div>
            <div class="sidebar-players">
              ${players.map(p => `
                <div class="suspect-chip">
                  <span class="avatar">${p.avatar}</span>
                  <div class="suspect-info">
                    <span class="name">${p.name}</span>
                    <span class="score">${this.scores[p.id] || 0} pts</span>
                  </div>
                </div>
              `).join('')}
            </div>

            ${this.firstQuestioner ? `
              <div class="questioner-banner">
                <span class="starter-label">🎲 First Question:</span>
                <strong>${this.firstQuestioner.name}</strong> asks first!
              </div>
            ` : ''}

            <div class="host-actions">
              <button class="btn-secondary" id="btnHostEndEarly">End Round Early</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnToggleTimer')?.addEventListener('click', () => {
      this.timerActive = !this.timerActive;
      this.render();
      this.syncState();
    });

    document.getElementById('btnAddTime')?.addEventListener('click', () => {
      this.timerRemaining += 60;
      this.syncState();
      this.render();
    });

    document.getElementById('btnHostEndEarly')?.addEventListener('click', () => {
      if (confirm('End this round now?')) {
        this.endRound('TIME_EXPIRED');
      }
    });
  }

  renderAccusation() {
    const players = Array.from(this.session.clients.values());
    const voters = players.filter(p => p.id !== this.accusation.suspectId);
    const votes = this.accusation.votes;

    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner">🚨 EMERGENCY ACCUSATION TRIAL 🚨</div>
          <div class="trial-timer" id="accusationTimer">${this.accusation.timer}s</div>
        </div>

        <div class="trial-central-card glass-card">
          <div class="accuser-statement">
            <span class="highlight-accuser">${this.accusation.accuserName}</span>
            <span class="accuses-text">has formally accused</span>
            <span class="highlight-suspect">${this.accusation.suspectName}</span>
            <span class="accuses-text">of being the <strong>SECRET SPY!</strong></span>
          </div>

          <p class="trial-instructions">
            All players: Cast your vote on your phone right now! <br/>
            (Is <strong>${this.accusation.suspectName}</strong> GUILTY or INNOCENT?)
          </p>

          <div class="live-votes-grid">
            ${voters.map(v => {
              const hasVoted = votes[v.id] != null;
              return `
                <div class="voter-badge ${hasVoted ? 'voted' : 'pending'}">
                  <span class="avatar">${v.avatar}</span>
                  <span class="name">${v.name}</span>
                  <span class="status-icon">${hasVoted ? '✓ Locked In' : '⏳ Thinking...'}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  renderSpyGuess() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner" style="background:#f59e0b;">🎯 SPY WAS UNMASKED! 🎯</div>
        </div>

        <div class="trial-central-card glass-card">
          <h2 style="color:#f59e0b; font-size:28px; margin-bottom:12px;">The Spy has been caught!</h2>
          <p style="font-size:18px; color:#e2e8f0; line-height:1.6; margin-bottom:24px;">
            The accused suspect <strong>${this.accusation.suspectName}</strong> is indeed the SPY! <br/>
            However, the Spy now has a chance to <strong>STEAL THE VICTORY</strong> by guessing the secret location on their phone!
          </p>
          <div class="radar-scan"></div>
          <p style="color:#94a3b8; font-style:italic;">Awaiting Spy's final guess...</p>
        </div>
      </div>
    `;
  }

  renderRoundOver() {
    const outcome = this.roundOutcome;
    const isTownWin = outcome.outcome === 'SPY_CAUGHT';

    const rankedPlayers = Array.from(this.session.clients.values())
      .map(p => ({ ...p, score: this.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="round-over-card glass-card">
          <div class="victory-header ${isTownWin ? 'town-win' : 'spy-win'}">
            <h1>${isTownWin ? '🏆 TOWN WINS!' : '🕵️‍♂️ THE SPY WINS!'}</h1>
            <p class="outcome-subtitle">
              ${outcome.outcome === 'SPY_CAUGHT' ? `The town unmasked the Spy and the Spy failed to guess the secret location!` : ''}
              ${outcome.outcome === 'SPY_GUESSED_LOCATION' ? `The Spy correctly guessed the secret location: <strong>${outcome.secretLocation}</strong>!` : ''}
              ${outcome.outcome === 'INNOCENT_ACCUSED' ? `An innocent townsperson was convicted! The Spy went completely undetected!` : ''}
              ${outcome.outcome === 'TIME_EXPIRED' ? `Time ran out before the town could uncover the Spy!` : ''}
            </p>
          </div>

          <div class="reveal-box">
            <div class="reveal-item">
              <span class="label">SECRET LOCATION:</span>
              <span class="value loc">${outcome.secretLocation}</span>
            </div>
            <div class="reveal-item">
              <span class="label">SECRET SPY:</span>
              <span class="value spy">${outcome.spyNames.join(', ')}</span>
            </div>
          </div>

          <div class="scoreboard-section">
            <h3>Leaderboard</h3>
            <div class="leaderboard-grid">
              ${rankedPlayers.map((p, idx) => `
                <div class="score-card rank-${idx + 1}">
                  <span class="rank-pos">#${idx + 1}</span>
                  <span class="avatar">${p.avatar}</span>
                  <span class="player-name">${p.name}</span>
                  <span class="player-pts">${p.score} pts</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="round-over-actions">
            <button class="btn-primary" id="btnNextRound">Play Next Round (Rotate Spy & Location)</button>
            <button class="btn-secondary" id="btnReturnLobby">Return to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnNextRound')?.addEventListener('click', () => {
      this.startNewGame();
    });

    document.getElementById('btnReturnLobby')?.addEventListener('click', () => {
      this.phase = 'LOBBY';
      this.render();
      this.syncState();
    });
  }
}
