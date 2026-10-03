import { SPYFALL_CATEGORIES } from '../../../data/locations.js';
import { playTick, playGong, playRoundStart, playVictory, playBuzzer } from '../../../utils/audio.js';
import { escapeHtml, shuffle, confirmDialog, Disposer } from '../../../utils/ui.js';

const ACCUSATION_SECONDS = 45;
const SPY_GUESS_SECONDS = 40;

export class SpyfallHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.roundDisposer = new Disposer();

    this.phase = 'LOBBY'; // 'LOBBY' | 'PLAYING' | 'ACCUSATION' | 'SPY_GUESS' | 'ROUND_OVER'
    this.selectedCategoryIndex = 0;
    this.roundDuration = 360;
    this.timerRemaining = 360;
    this.timerActive = false;

    this.roundNumber = 0;
    this.secretLocation = null;
    this.currentLocationsList = [];
    this.spyIds = [];
    this.scores = {};
    this.usedLocations = new Set();

    this.accusation = null;
    this.accusationsUsed = new Set();
    this.firstQuestioner = null;
    this.spyGuess = null;

    this.session.on('rosterChange', () => {
      if (this.phase === 'LOBBY' || this.phase === 'PLAYING') this.render();
      if (this.phase === 'ACCUSATION') {
        this.render();
        this.checkAccusationVotesComplete();
      }
      this.syncState();
    });

    this.session.on('playerAction', (playerId, action, payload) => this.handlePlayerAction(playerId, action, payload));

    this.session.on('playerLeave', () => {
      const inRound = ['PLAYING', 'ACCUSATION', 'SPY_GUESS'].includes(this.phase);
      if (inRound && this.spyIds.every(id => !this.session.clients.has(id))) this.endRound('ABANDONED');
    });
  }

  destroy() {
    this.roundDisposer.dispose();
    this.disposer.dispose();
  }

  handlePlayerAction(playerId, action, payload) {
    // Only players dealt into this round can accuse or vote.
    if (!this.dealtIds?.has(playerId)) return;
    if (action === 'CALL_ACCUSATION' && this.phase === 'PLAYING') {
      const suspectId = payload.suspectId;
      if (!suspectId || suspectId === playerId || !this.dealtIds.has(suspectId) || !this.session.clients.has(suspectId)) return;
      if (this.accusationsUsed.has(playerId)) return;
      this.initiateAccusation(playerId, suspectId);
    } else if (action === 'VOTE_ACCUSATION' && this.phase === 'ACCUSATION') {
      if (!this.accusation || playerId === this.accusation.suspectId) return;
      if (payload.vote !== 'GUILTY' && payload.vote !== 'INNOCENT') return;
      this.accusation.votes[playerId] = payload.vote;
      this.syncState();
      this.render();
      this.checkAccusationVotesComplete();
    } else if (action === 'SPY_REVEAL' && this.phase === 'PLAYING' && this.spyIds.includes(playerId)) {
      // The spy stops the clock to steal the win by naming the location.
      this.startSpyGuess(playerId, true);
    } else if (action === 'SPY_GUESS' && this.phase === 'SPY_GUESS' && playerId === this.spyGuess?.spyId) {
      this.resolveSpyGuess(String(payload.location || ''));
    }
  }

  get category() {
    return SPYFALL_CATEGORIES[this.selectedCategoryIndex] || SPYFALL_CATEGORIES[0];
  }

  startNewGame() {
    const players = this.session.getPlayers();
    if (players.length < 1) return;

    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    this.roundNumber++;
    this.determineLocationAndSpies(players);
    this.timerRemaining = this.roundDuration;
    this.timerActive = true;
    this.phase = 'PLAYING';
    this.accusation = null;
    this.accusationsUsed = new Set();
    this.spyGuess = null;
    this.roundOutcome = null;
    this.lastAcquittal = null;
    this.firstQuestioner = players[Math.floor(Math.random() * players.length)];

    playRoundStart();
    this.startTimer();
    this.dispatchRoles(players);
    this.syncState();
    this.render();
  }

  determineLocationAndSpies(players) {
    const availableLocs = this.category.locations;
    this.currentLocationsList = [...availableLocs];

    let pool = availableLocs.filter(loc => !this.usedLocations.has(loc));
    if (pool.length === 0) {
      this.usedLocations.clear();
      pool = availableLocs;
    }
    this.secretLocation = pool[Math.floor(Math.random() * pool.length)];
    this.usedLocations.add(this.secretLocation);

    const spyCount = players.length >= 8 ? 2 : 1;
    this.spyIds = shuffle(players).slice(0, spyCount).map(p => p.id);
  }

  dispatchRoles(players) {
    this.dealtIds = new Set(players.map(p => p.id));
    players.forEach(p => {
      const isSpy = this.spyIds.includes(p.id);
      this.session.sendPrivateState(p.id, {
        game: 'spyfall',
        round: this.roundNumber,
        isSpy,
        spyCount: this.spyIds.length,
        secretLocation: isSpy ? null : this.secretLocation,
        category: this.category.category,
        allLocations: this.currentLocationsList
      });
    });
  }

  startTimer() {
    this.roundDisposer.interval(() => {
      if (!this.timerActive || this.timerRemaining <= 0) return;
      this.timerRemaining--;
      if (this.timerRemaining <= 10 && this.timerRemaining > 0) playTick(1000 + (10 - this.timerRemaining) * 80);
      const timerEl = document.getElementById('hostTimerDisplay');
      if (timerEl) {
        timerEl.textContent = this.formatTime(this.timerRemaining);
        timerEl.classList.toggle('danger', this.timerRemaining <= 30);
      }
      if (this.timerRemaining === 0) {
        this.timerActive = false;
        playBuzzer();
        this.endRound('TIME_EXPIRED');
        return;
      }
      if (this.timerRemaining % 5 === 0) this.syncState();
    }, 1000);
  }

  initiateAccusation(accuserId, suspectId) {
    this.timerActive = false;
    this.accusationsUsed.add(accuserId);
    playGong();

    const accuser = this.session.clients.get(accuserId);
    const suspect = this.session.clients.get(suspectId);

    this.phase = 'ACCUSATION';
    this.accusation = {
      accuserId,
      accuserName: accuser?.name || 'Player',
      suspectId,
      suspectName: suspect?.name || 'Suspect',
      votes: { [accuserId]: 'GUILTY' },
      timer: ACCUSATION_SECONDS
    };

    this.syncState();
    this.render();
    this.checkAccusationVotesComplete();
    if (this.phase !== 'ACCUSATION') return;

    this.accusationTimer = this.roundDisposer.interval(() => {
      if (this.phase !== 'ACCUSATION' || !this.accusation) return;
      this.accusation.timer--;
      const el = document.getElementById('accusationTimer');
      if (el) el.textContent = `${this.accusation.timer}s`;
      if (this.accusation.timer <= 0) this.resolveAccusation();
    }, 1000);
  }

  checkAccusationVotesComplete() {
    if (!this.accusation || this.phase !== 'ACCUSATION') return;
    const voters = this.session.getPlayers().filter(p => p.id !== this.accusation.suspectId && p.connected && this.dealtIds.has(p.id));
    if (voters.every(p => this.accusation.votes[p.id])) this.resolveAccusation();
  }

  resolveAccusation() {
    if (!this.accusation || this.phase !== 'ACCUSATION') return;
    clearInterval(this.accusationTimer);
    const votes = Object.values(this.accusation.votes);
    const guilty = votes.filter(v => v === 'GUILTY').length;
    const innocent = votes.filter(v => v === 'INNOCENT').length;
    const suspectIsSpy = this.spyIds.includes(this.accusation.suspectId);

    if (guilty > innocent) {
      if (suspectIsSpy) {
        this.startSpyGuess(this.accusation.suspectId, false);
      } else {
        this.endRound('INNOCENT_ACCUSED');
      }
    } else {
      this.lastAcquittal = `${this.accusation.suspectName} was acquitted (${guilty}–${innocent}). The clock is running again!`;
      this.phase = 'PLAYING';
      this.timerActive = true;
      this.accusation = null;
      this.syncState();
      this.render();
    }
  }

  startSpyGuess(spyId, voluntary) {
    this.timerActive = false;
    this.phase = 'SPY_GUESS';
    this.spyGuess = {
      spyId,
      spyName: this.session.clients.get(spyId)?.name || 'The Spy',
      voluntary,
      timer: SPY_GUESS_SECONDS
    };
    playGong();
    this.syncState();
    this.render();
    this.roundDisposer.interval(() => {
      if (this.phase !== 'SPY_GUESS') return;
      this.spyGuess.timer--;
      const el = document.getElementById('spyGuessTimer');
      if (el) el.textContent = `${this.spyGuess.timer}s`;
      if (this.spyGuess.timer <= 0) this.resolveSpyGuess('');
    }, 1000);
  }

  resolveSpyGuess(guessedLocation) {
    if (this.phase !== 'SPY_GUESS') return;
    const isCorrect = guessedLocation.toLowerCase().trim() === this.secretLocation.toLowerCase().trim();
    this.endRound(isCorrect ? 'SPY_GUESSED_LOCATION' : 'SPY_CAUGHT', { guess: guessedLocation || null, voluntary: this.spyGuess?.voluntary });
  }

  endRound(outcome, details = {}) {
    this.phase = 'ROUND_OVER';
    this.timerActive = false;
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();

    const players = this.session.getPlayers();
    const spyNames = this.spyIds.map(id => this.session.clients.get(id)?.name || 'Spy');
    const add = (id, n) => { this.scores[id] = (this.scores[id] || 0) + n; };

    if (outcome === 'SPY_CAUGHT') {
      players.forEach(p => { if (!this.spyIds.includes(p.id)) add(p.id, 1); });
      if (this.accusation?.accuserId && !details.voluntary) add(this.accusation.accuserId, 1);
    } else if (outcome === 'SPY_GUESSED_LOCATION') {
      this.spyIds.forEach(id => add(id, details.voluntary ? 4 : 3));
    } else if (outcome !== 'ABANDONED') {
      this.spyIds.forEach(id => add(id, 2));
    }
    if (outcome !== 'ABANDONED') playVictory();

    this.roundOutcome = { outcome, details, spyNames, secretLocation: this.secretLocation, accusation: this.accusation };
    this.syncState();
    this.render();
  }

  syncState() {
    const players = this.session.getPlayers().map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: this.scores[p.id] || 0,
      connected: p.connected
    }));

    this.session.broadcastPublicState({
      game: 'spyfall',
      phase: this.phase,
      roundNumber: this.roundNumber,
      categoryName: this.category.category,
      timerRemaining: this.timerRemaining,
      timerActive: this.timerActive,
      players,
      allLocations: this.currentLocationsList,
      accusation: this.accusation,
      accusationsUsed: [...this.accusationsUsed],
      spyGuess: this.spyGuess ? { spyId: this.spyGuess.spyId, spyName: this.spyGuess.spyName, voluntary: this.spyGuess.voluntary } : null,
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
    if (this.phase === 'LOBBY') this.renderLobby();
    else if (this.phase === 'PLAYING') this.renderPlaying();
    else if (this.phase === 'ACCUSATION') this.renderAccusation();
    else if (this.phase === 'SPY_GUESS') this.renderSpyGuess();
    else if (this.phase === 'ROUND_OVER') this.renderRoundOver();
  }

  renderLobby() {
    const players = this.session.getPlayers();
    const ready = players.length >= 3;

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>NETPLAY SPYFALL</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="lobby-grid two-col">
          <div class="glass-card">
            <h3>🕵️ How to play</h3>
            <ul class="rules-list">
              <li>📱 Everyone's phone shows the secret <strong>location</strong>, except the <strong>Spy</strong></li>
              <li>❓ Take turns asking each other questions about the place</li>
              <li>🚨 Suspicious answer? Call an accusation from your phone (once per round)</li>
              <li>🎯 The Spy wins by surviving the clock, or by naming the location at any time</li>
            </ul>
            <h3 class="section-title">👥 Players (${players.length})</h3>
            <div class="players-roster">
              ${players.map(p => `<div class="player-chip"><span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span>${this.scores[p.id] ? `<strong class="pts">${this.scores[p.id]}</strong>` : ''}</div>`).join('') || '<p class="muted">Waiting for players...</p>'}
            </div>
          </div>

          <div class="glass-card settings-card">
            <h3>⚙️ Game Setup</h3>
            <div class="form-group">
              <label for="selCategory">Location Pack (${SPYFALL_CATEGORIES.length} packs)</label>
              <select id="selCategory" class="custom-select">
                ${SPYFALL_CATEGORIES.map((cat, idx) => `
                  <option value="${idx}" ${idx === this.selectedCategoryIndex ? 'selected' : ''}>${cat.featured ? '⭐ ' : ''}${escapeHtml(cat.category)} (${cat.locations.length})</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Round Timer</label>
              <div class="timer-chips">
                ${[[300, '5 min'], [360, '6 min'], [480, '8 min']].map(([t, l]) => `<button class="chip-btn ${this.roundDuration === t ? 'active' : ''}" data-time="${t}">${l}</button>`).join('')}
              </div>
            </div>
            <button class="btn-launch-game ${ready ? 'ready' : 'disabled'}" id="btnLaunchGame" ${players.length ? '' : 'disabled'}>
              <span>🚀 Deal Secret Cards</span>
            </button>
            ${ready ? '' : `<p class="hint-text">Best with 3+ players (${Math.max(0, 3 - players.length)} more needed)</p>`}
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('selCategory')?.addEventListener('change', (e) => {
      this.selectedCategoryIndex = parseInt(e.target.value, 10);
    });
    this.container.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.roundDuration = parseInt(btn.dataset.time, 10);
        this.render();
      });
    });
    document.getElementById('btnLaunchGame')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderPlaying() {
    const players = this.session.getPlayers();

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header in-game-header">
          <div class="brand-badge">
            <span class="badge-cat">${escapeHtml(this.category.category)}</span>
            <span class="round-indicator">ROUND ${this.roundNumber}</span>
          </div>
          <div class="central-timer">
            <div class="timer-box"><span class="timer-digits ${this.timerRemaining <= 30 ? 'danger' : ''}" id="hostTimerDisplay">${this.formatTime(this.timerRemaining)}</span></div>
            <div class="timer-controls">
              <button class="btn-icon" id="btnToggleTimer" title="${this.timerActive ? 'Pause' : 'Resume'}">${this.timerActive ? '⏸️' : '▶️'}</button>
              <button class="btn-icon" id="btnAddTime" title="+1 Minute">+1m</button>
            </div>
          </div>
          <button class="btn-icon" id="btnHostEndEarly">End Round</button>
        </header>

        ${this.lastAcquittal ? `<div class="last-result ok">⚖️ ${escapeHtml(this.lastAcquittal)}</div>` : ''}

        <div class="playing-layout">
          <div class="glass-card locations-board">
            <div class="board-header">
              <h3>🗺️ Possible Locations</h3>
              <p class="hint">One of these is real. The Spy doesn't know which!</p>
            </div>
            <div class="locations-grid">
              ${this.currentLocationsList.map(loc => `<div class="location-tile"><span class="loc-name">${escapeHtml(loc)}</span></div>`).join('')}
            </div>
          </div>

          <div class="glass-card game-sidebar">
            ${this.firstQuestioner ? `<div class="questioner-banner"><span class="starter-label">🎲 First question:</span> <strong>${escapeHtml(this.firstQuestioner.name)}</strong></div>` : ''}
            <h3>🕵️ Suspects</h3>
            <div class="sidebar-players">
              ${players.map(p => `
                <div class="suspect-chip ${p.connected ? '' : 'offline'}">
                  <span class="avatar">${p.avatar}</span>
                  <div class="suspect-info">
                    <span class="name">${escapeHtml(p.name)}</span>
                    <span class="score">${this.scores[p.id] || 0} pts ${this.accusationsUsed.has(p.id) ? '· accused already' : ''}</span>
                  </div>
                </div>
              `).join('')}
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
    document.getElementById('btnHostEndEarly')?.addEventListener('click', async () => {
      if (await confirmDialog('End this round now? The Spy wins if nobody has been caught.', { confirmLabel: 'End Round' })) {
        if (this.phase === 'PLAYING') this.endRound('TIME_EXPIRED');
      }
    });
  }

  renderAccusation() {
    const voters = this.session.getPlayers().filter(p => p.id !== this.accusation.suspectId);
    const votes = this.accusation.votes;

    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner">🚨 ACCUSATION TRIAL 🚨</div>
          <div class="trial-timer" id="accusationTimer">${this.accusation.timer}s</div>
        </div>
        <div class="trial-central-card glass-card">
          <div class="accuser-statement">
            <span class="highlight-accuser">${escapeHtml(this.accusation.accuserName)}</span>
            <span class="accuses-text">accuses</span>
            <span class="highlight-suspect">${escapeHtml(this.accusation.suspectName)}</span>
            <span class="accuses-text">of being the <strong>SPY!</strong></span>
          </div>
          <p class="trial-instructions">${escapeHtml(this.accusation.suspectName)}, defend yourself! Everyone else: vote on your phone. Majority decides.</p>
          <div class="live-votes-grid">
            ${voters.map(v => `
              <div class="voter-badge ${votes[v.id] ? 'voted' : 'pending'}">
                <span class="avatar">${v.avatar}</span>
                <span class="name">${escapeHtml(v.name)}</span>
                <span class="status-icon">${votes[v.id] ? '✓ Voted' : '⏳ Thinking...'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  renderSpyGuess() {
    const g = this.spyGuess;
    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner amber">🎯 ${g.voluntary ? 'THE SPY REVEALS THEMSELF!' : 'SPY UNMASKED!'} 🎯</div>
          <div class="trial-timer" id="spyGuessTimer">${g.timer}s</div>
        </div>
        <div class="trial-central-card glass-card">
          <h2 class="amber-text">${escapeHtml(g.spyName)} is the Spy!</h2>
          <p class="trial-instructions">${g.voluntary
            ? 'They stopped the clock to steal the win. If they name the secret location correctly, the Spy wins big!'
            : 'Caught! But they can still steal the victory by naming the secret location on their phone.'}</p>
          <div class="radar-scan"></div>
          <p class="muted">Waiting for the Spy's guess...</p>
        </div>
      </div>
    `;
  }

  renderRoundOver() {
    const o = this.roundOutcome;
    const isTownWin = o.outcome === 'SPY_CAUGHT';
    const ranked = this.session.getPlayers()
      .map(p => ({ ...p, score: this.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
    const subtitle = {
      SPY_CAUGHT: o.details?.guess ? `The Spy guessed "${o.details.guess}" and was wrong!` : 'The Spy was caught and could not name the location!',
      SPY_GUESSED_LOCATION: `The Spy named the secret location: ${o.secretLocation}!`,
      INNOCENT_ACCUSED: `${o.accusation?.suspectName || 'An innocent player'} was convicted, but they were innocent!`,
      TIME_EXPIRED: 'Time ran out before the town found the Spy!',
      ABANDONED: 'The Spy left the room, so this round is void. No points awarded.'
    }[o.outcome];

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="round-over-card glass-card">
          <div class="victory-header ${isTownWin ? 'town-win' : 'spy-win'}">
            <h1>${o.outcome === 'ABANDONED' ? '⏹ ROUND VOID' : isTownWin ? '🏆 TOWN WINS!' : '🕵️‍♂️ THE SPY WINS!'}</h1>
            <p class="outcome-subtitle">${escapeHtml(subtitle)}</p>
          </div>
          <div class="reveal-box">
            <div class="reveal-item"><span class="label">SECRET LOCATION</span><span class="value loc">${escapeHtml(o.secretLocation)}</span></div>
            <div class="reveal-item"><span class="label">THE SPY</span><span class="value spy">${o.spyNames.map(escapeHtml).join(', ')}</span></div>
          </div>
          <div class="scoreboard-section">
            <h3>Leaderboard</h3>
            <div class="leaderboard-grid">
              ${ranked.map((p, idx) => `
                <div class="score-card rank-${idx + 1}">
                  <span class="rank-pos">#${idx + 1}</span>
                  <span class="avatar">${p.avatar}</span>
                  <span class="player-name">${escapeHtml(p.name)}</span>
                  <span class="player-pts">${p.score} pts</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="round-over-actions">
            <button class="btn-primary" id="btnNextRound">▶ Next Round (new Spy & location)</button>
            <button class="btn-secondary" id="btnReturnLobby">Change Settings</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnNextRound')?.addEventListener('click', () => {
      this.lastAcquittal = null;
      this.startNewGame();
    });
    document.getElementById('btnReturnLobby')?.addEventListener('click', () => {
      this.phase = 'LOBBY';
      this.lastAcquittal = null;
      this.render();
      this.syncState();
    });
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
