import { IMPOSTER_WORDS } from '../../../data/imposter-words.js';
import { playRoundStart, playVictory, playGong, playTick } from '../../../utils/audio.js';

const PLAYER_COLORS = [
  '#ec4899', '#06b6d4', '#8b5cf6', '#10b981', 
  '#f59e0b', '#3b82f6', '#f43f5e', '#a855f7',
  '#14b8a6', '#eab308', '#6366f1', '#84cc16'
];

export class FakeArtistHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'SETUP'; // 'SETUP' | 'DRAWING' | 'VOTING' | 'IMPOSTER_GUESS' | 'ROUND_OVER'
    this.selectedCategoryIndex = 0;
    this.categoryName = '';
    this.secretWord = '';
    this.imposterId = null;

    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.totalRounds = 2; // Each player draws 2 strokes total
    this.currentRound = 1;

    this.strokes = []; // Array of { playerId, color, points: [{x, y}] }
    this.currentStroke = null;
    this.votes = {}; // voterId -> suspectId

    this.scores = {};
    this.usedWords = new Set();

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      this.handlePlayerAction(playerId, action, payload);
    });
  }

  handlePlayerAction(playerId, action, payload) {
    if (this.phase === 'DRAWING') {
      const activePlayerId = this.turnOrder[this.currentTurnIndex];
      if (playerId !== activePlayerId) return;

      if (action === 'STROKE_START') {
        const color = this.getPlayerColor(playerId);
        this.currentStroke = { playerId, color, points: [payload.point] };
        this.renderStrokeLive(payload.point, true, color);
      } else if (action === 'STROKE_MOVE') {
        if (this.currentStroke) {
          this.currentStroke.points.push(payload.point);
          this.renderStrokeLive(payload.point, false, this.currentStroke.color);
        }
      } else if (action === 'STROKE_END') {
        if (this.currentStroke) {
          this.strokes.push(this.currentStroke);
          this.currentStroke = null;
          this.advanceTurn();
        }
      }
    } else if (this.phase === 'VOTING') {
      if (action === 'CAST_VOTE') {
        this.votes[playerId] = payload.suspectId;
        this.syncState();
        this.render();
        this.checkVotesComplete();
      }
    } else if (this.phase === 'IMPOSTER_GUESS') {
      if (playerId === this.imposterId && action === 'SUBMIT_GUESS') {
        this.resolveImposterGuess(payload.guess);
      }
    }
  }

  getPlayerColor(playerId) {
    const idx = this.turnOrder.indexOf(playerId);
    return PLAYER_COLORS[idx % PLAYER_COLORS.length] || '#ffffff';
  }

  startNewGame() {
    const players = Array.from(this.session.clients.values());
    if (players.length < 1) {
      alert('At least 1 player required to test!');
      return;
    }

    const cat = IMPOSTER_WORDS[this.selectedCategoryIndex] || IMPOSTER_WORDS[0];
    this.categoryName = cat.category;

    // Pick random non-repeating word
    let pool = cat.words.filter(w => !this.usedWords.has(w));
    if (pool.length === 0) {
      this.usedWords.clear();
      pool = cat.words;
    }
    this.secretWord = pool[Math.floor(Math.random() * pool.length)];
    this.usedWords.add(this.secretWord);

    // Pick 1 Imposter (Fake Artist)
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    this.imposterId = shuffled[0].id;
    this.turnOrder = shuffled.map(p => p.id);

    this.currentTurnIndex = 0;
    this.currentRound = 1;
    this.strokes = [];
    this.votes = {};
    this.phase = 'DRAWING';

    playRoundStart();
    this.dispatchRoles();
    this.syncState();
    this.render();
  }

  dispatchRoles() {
    const players = Array.from(this.session.clients.values());
    players.forEach(p => {
      const isImposter = p.id === this.imposterId;
      const color = this.getPlayerColor(p.id);

      this.session.sendPrivateState(p.id, {
        game: 'fake-artist',
        isImposter,
        category: this.categoryName,
        secretWord: isImposter ? null : this.secretWord,
        playerColor: color,
        turnOrder: this.turnOrder.map(id => this.session.clients.get(id)?.name || 'Player')
      });
    });
  }

  advanceTurn() {
    this.currentTurnIndex++;
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
      this.currentRound++;
      if (this.currentRound > this.totalRounds) {
        this.startVotingPhase();
        return;
      }
    }
    playTick(750);
    this.syncState();
    this.render();
  }

  startVotingPhase() {
    this.phase = 'VOTING';
    this.votes = {};
    playGong();
    this.syncState();
    this.render();
  }

  checkVotesComplete() {
    const players = Array.from(this.session.clients.values());
    if (Object.keys(this.votes).length >= players.length) {
      this.resolveVoting();
    }
  }

  resolveVoting() {
    // Tally votes
    const counts = {};
    Object.values(this.votes).forEach(suspectId => {
      counts[suspectId] = (counts[suspectId] || 0) + 1;
    });

    let topSuspect = null;
    let maxVotes = -1;
    for (const [id, count] of Object.entries(counts)) {
      if (count > maxVotes) {
        maxVotes = count;
        topSuspect = id;
      }
    }

    const imposterCaught = topSuspect === this.imposterId;
    const accusedPlayer = this.session.clients.get(topSuspect) || { name: 'Suspect' };

    if (imposterCaught) {
      // Imposter was identified! Give them a chance to guess the secret word
      this.phase = 'IMPOSTER_GUESS';
      this.syncState();
      this.render();
    } else {
      // Imposter escaped! Imposter wins
      this.endRound('IMPOSTER_UNDETECTED', { accusedName: accusedPlayer.name });
    }
  }

  resolveImposterGuess(guessText) {
    const cleanGuess = (guessText || '').trim().toLowerCase();
    const cleanWord = this.secretWord.trim().toLowerCase();
    const isClose = cleanWord.includes(cleanGuess) || cleanGuess.includes(cleanWord);

    if (isClose && cleanGuess.length >= 3) {
      this.endRound('IMPOSTER_GUESSED_WORD', { guess: guessText });
    } else {
      this.endRound('ARTISTS_WIN', { guess: guessText });
    }
  }

  endRound(outcome, details = {}) {
    this.phase = 'ROUND_OVER';
    const players = Array.from(this.session.clients.values());
    const imposter = this.session.clients.get(this.imposterId) || { name: 'Fake Artist' };

    if (outcome === 'ARTISTS_WIN') {
      players.forEach(p => {
        if (p.id !== this.imposterId) this.scores[p.id] = (this.scores[p.id] || 0) + 2;
      });
      playVictory();
    } else {
      this.scores[this.imposterId] = (this.scores[this.imposterId] || 0) + 3;
      playVictory();
    }

    this.roundOutcome = { outcome, details, imposterName: imposter.name, secretWord: this.secretWord };
    this.syncState();
    this.render();
  }

  syncState() {
    const activePlayerId = this.turnOrder[this.currentTurnIndex];
    const activePlayer = this.session.clients.get(activePlayerId);

    const players = Array.from(this.session.clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: this.getPlayerColor(p.id),
      score: this.scores[p.id] || 0
    }));

    this.session.broadcastPublicState({
      game: 'fake-artist',
      phase: this.phase,
      categoryName: this.categoryName,
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      activePlayerId,
      activePlayerName: activePlayer?.name || 'Player',
      activePlayerColor: this.getPlayerColor(activePlayerId),
      turnOrder: this.turnOrder,
      players,
      votes: this.votes,
      roundOutcome: this.phase === 'ROUND_OVER' ? this.roundOutcome : null
    });
  }

  renderStrokeLive(point, isStart, color) {
    const canvas = document.getElementById('hostDrawingCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const px = point.x * canvas.width;
    const py = point.y * canvas.height;

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isStart) {
      ctx.beginPath();
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
      ctx.stroke();
    }
  }

  redrawAllStrokes() {
    const canvas = document.getElementById('hostDrawingCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Canvas background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height);
      }
      ctx.stroke();
    });
  }

  render() {
    if (!this.container) return;

    if (this.phase === 'SETUP') {
      this.renderSetup();
    } else if (this.phase === 'DRAWING') {
      this.renderDrawing();
    } else if (this.phase === 'VOTING') {
      this.renderVoting();
    } else if (this.phase === 'IMPOSTER_GUESS') {
      this.renderImposterGuess();
    } else if (this.phase === 'ROUND_OVER') {
      this.renderRoundOver();
    }
  }

  renderSetup() {
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge">
            <span class="pulse-dot"></span>
            <span>FAKE ARTIST GOES TO NEW YORK</span>
          </div>
          <div class="room-code-display">
            <span class="label">ROOM</span>
            <span class="code">${this.session.roomCode}</span>
          </div>
        </header>

        <div class="lobby-grid">
          <div class="glass-card" style="grid-column: span 2;">
            <h2>🎨 Collaborative Drawing & Deception</h2>
            <p style="color:var(--text-secondary); margin-bottom:20px; line-height:1.6;">
              Everyone draws a secret word together on a shared canvas — but each person only draws <strong>ONE line per turn</strong>! 
              One player is the <strong>Fake Artist</strong> who doesn't know the word and must bluff!
            </p>

            <div class="form-group">
              <label>Select Category Pack (${IMPOSTER_WORDS.length} Packs Available):</label>
              <select id="selImposterCat" class="custom-select">
                ${IMPOSTER_WORDS.map((c, i) => `
                  <option value="${i}" ${i === this.selectedCategoryIndex ? 'selected' : ''}>
                    ${c.featured ? '⭐ ' : ''}${c.category} (${c.words.length} items)
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="players-roster" style="margin-top:20px;">
              ${players.map((p, idx) => `
                <div class="player-chip">
                  <span class="avatar">${p.avatar}</span>
                  <span class="name">${p.name}</span>
                  <span style="width:12px; height:12px; border-radius:50%; background:${PLAYER_COLORS[idx % PLAYER_COLORS.length]}; display:inline-block;"></span>
                </div>
              `).join('')}
            </div>

            <div style="display:flex; gap:12px; margin-top:24px;">
              <button class="btn-primary-large" id="btnStartFakeArtist">🚀 Start Drawing Game</button>
              <button class="btn-secondary" id="btnBackToDeck">Back to Party Deck</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('selImposterCat')?.addEventListener('change', (e) => {
      this.selectedCategoryIndex = parseInt(e.target.value);
    });

    document.getElementById('btnStartFakeArtist')?.addEventListener('click', () => {
      this.startNewGame();
    });

    document.getElementById('btnBackToDeck')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }

  renderDrawing() {
    const activePlayerId = this.turnOrder[this.currentTurnIndex];
    const activePlayer = this.session.clients.get(activePlayerId) || { name: 'Player' };
    const activeColor = this.getPlayerColor(activePlayerId);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header in-game-header">
          <div class="brand-badge">
            <span class="badge-cat">${this.categoryName}</span>
            <span class="round-indicator">ROUND ${this.currentRound} / ${this.totalRounds}</span>
          </div>

          <div class="central-timer">
            <div class="active-turn-pill" style="border:2px solid ${activeColor};">
              <span style="font-size:20px;">✏️</span>
              <span>Turn: <strong>${activePlayer.name}</strong></span>
              <span class="turn-color-dot" style="background:${activeColor};"></span>
            </div>
          </div>

          <div class="room-code-mini">
            Room: <strong>${this.session.roomCode}</strong>
          </div>
        </header>

        <div class="playing-layout">
          <!-- Shared Big Canvas -->
          <div class="glass-card" style="display:flex; flex-direction:column; align-items:center; padding:16px;">
            <canvas id="hostDrawingCanvas" width="640" height="500" style="background:#fff; border-radius:16px; width:100%; max-width:640px; box-shadow:0 8px 30px rgba(0,0,0,0.5);"></canvas>
            <p style="color:var(--text-muted); font-size:13px; margin-top:10px;">
              Watch ${activePlayer.name} draw their single stroke on their phone touch screen!
            </p>
          </div>

          <!-- Turn Order & Players Sidebar -->
          <div class="glass-card game-sidebar">
            <h3>Turn Order</h3>
            <div class="turn-order-list">
              ${this.turnOrder.map(pid => {
                const p = this.session.clients.get(pid);
                const isCurrent = pid === activePlayerId;
                const col = this.getPlayerColor(pid);
                return `
                  <div class="turn-player-chip ${isCurrent ? 'active-turn' : ''}" style="border-left:4px solid ${col};">
                    <span class="avatar">${p?.avatar || '👤'}</span>
                    <span class="name">${p?.name || 'Player'}</span>
                    ${isCurrent ? '<span class="drawing-badge">DRAWING...</span>' : ''}
                  </div>
                `;
              }).join('')}
            </div>

            <div style="margin-top:auto; padding-top:16px;">
              <button class="btn-secondary" id="btnEndDrawingEarly">End Drawing & Vote Now</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.redrawAllStrokes();

    document.getElementById('btnEndDrawingEarly')?.addEventListener('click', () => {
      if (confirm('Move to voting now?')) {
        this.startVotingPhase();
      }
    });
  }

  renderVoting() {
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner">🕵️‍♂️ WHO IS THE FAKE ARTIST? 🕵️‍♂️</div>
        </div>

        <div class="trial-central-card glass-card">
          <h2>Drawing Finished! Time to Vote!</h2>
          <p style="color:var(--text-secondary); margin-bottom:24px;">
            Look at the drawing on screen. Everyone vote on your phone: <strong>Which player's lines were clueless or suspicious?</strong>
          </p>

          <canvas id="hostDrawingCanvas" width="500" height="380" style="background:#fff; border-radius:16px; margin-bottom:24px; box-shadow:0 8px 30px rgba(0,0,0,0.5);"></canvas>

          <div class="live-votes-grid">
            ${players.map(p => `
              <div class="voter-badge ${this.votes[p.id] ? 'voted' : 'pending'}">
                <span class="avatar">${p.avatar}</span>
                <span class="name">${p.name}</span>
                <span class="status-icon">${this.votes[p.id] ? '✓ Vote Locked' : '⏳ Thinking...'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    this.redrawAllStrokes();
  }

  renderImposterGuess() {
    const imposter = this.session.clients.get(this.imposterId) || { name: 'The Fake Artist' };

    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner" style="background:#f59e0b;">🎯 FAKE ARTIST UNMASKED! 🎯</div>
        </div>

        <div class="trial-central-card glass-card">
          <h2 style="color:#f59e0b; font-size:32px;">${imposter.name} was caught as the Fake Artist!</h2>
          <p style="font-size:18px; color:#e2e8f0; margin:16px 0 24px;">
            Category: <strong>${this.categoryName}</strong><br/>
            The Fake Artist has <strong>30 seconds</strong> to type their final guess of the secret word on their phone!
          </p>
          <div class="radar-scan"></div>
          <p style="color:#94a3b8; font-style:italic;">Awaiting guess from ${imposter.name}'s phone...</p>
        </div>
      </div>
    `;
  }

  renderRoundOver() {
    const outcome = this.roundOutcome;
    const isArtistsWin = outcome.outcome === 'ARTISTS_WIN';

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="round-over-card glass-card">
          <div class="victory-header ${isArtistsWin ? 'town-win' : 'spy-win'}">
            <h1>${isArtistsWin ? '🏆 REAL ARTISTS WIN!' : '🎨 FAKE ARTIST WINS!'}</h1>
            <p class="outcome-subtitle">
              ${outcome.outcome === 'ARTISTS_WIN' ? `The Fake Artist was caught and could not guess the secret word!` : ''}
              ${outcome.outcome === 'IMPOSTER_GUESSED_WORD' ? `The Fake Artist was caught, but correctly guessed: <strong>"${outcome.secretWord}"</strong> to steal the victory!` : ''}
              ${outcome.outcome === 'IMPOSTER_UNDETECTED' ? `An innocent artist (${outcome.details.accusedName}) was accused! The Fake Artist went undetected!` : ''}
            </p>
          </div>

          <div class="reveal-box">
            <div class="reveal-item">
              <span class="label">SECRET WORD:</span>
              <span class="value loc">${outcome.secretWord}</span>
            </div>
            <div class="reveal-item">
              <span class="label">THE FAKE ARTIST:</span>
              <span class="value spy">${outcome.imposterName}</span>
            </div>
          </div>

          <div style="display:flex; justify-content:center; gap:12px;">
            <button class="btn-primary" id="btnNextRoundFakeArtist">Play Another Round</button>
            <button class="btn-secondary" id="btnReturnHubFakeArtist">Return to Party Deck</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnNextRoundFakeArtist')?.addEventListener('click', () => {
      this.startNewGame();
    });

    document.getElementById('btnReturnHubFakeArtist')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }
}
