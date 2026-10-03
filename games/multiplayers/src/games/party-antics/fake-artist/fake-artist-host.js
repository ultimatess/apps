import { IMPOSTER_WORDS } from '../../../data/imposter-words.js';
import { playRoundStart, playVictory, playGong, playTick, playCorrect, playWrong } from '../../../utils/audio.js';
import { escapeHtml, shuffle, tallyVotes, confirmDialog, Disposer } from '../../../utils/ui.js';

export const PLAYER_COLORS = [
  '#ec4899', '#06b6d4', '#8b5cf6', '#10b981',
  '#f59e0b', '#3b82f6', '#f43f5e', '#a855f7',
  '#14b8a6', '#eab308', '#6366f1', '#84cc16'
];
const TURN_SECONDS = 40;
const GUESS_SECONDS = 30;
const CANVAS_W = 800;
const CANVAS_H = 600;
const MAX_POINTS = 600;

const round3 = (n) => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 1000) / 1000;

export function drawStrokes(ctx, strokes, w, h, { lineWidth = 6 } = {}) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach(stroke => {
    const pts = stroke.points;
    if (!pts.length) return;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = lineWidth;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * w, pts[0][1] * h, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
    ctx.stroke();
  });
}

export class FakeArtistHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.turnDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'DRAWING' | 'VOTING' | 'IMPOSTER_GUESS' | 'ROUND_OVER'
    this.selectedCategoryIndex = 0;
    this.totalRounds = 2;
    this.categoryName = '';
    this.secretWord = '';
    this.imposterId = null;
    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.currentRound = 1;
    this.strokes = [];
    this.liveStroke = null;
    this.votes = {};
    this.scores = {};
    this.usedWords = new Set();
    this.guessOptions = [];

    this.session.on('playerAction', (playerId, action, payload) => this.handlePlayerAction(playerId, action, payload));
    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP' || this.phase === 'VOTING') this.render();
      if (this.phase === 'VOTING') this.checkVotesComplete();
      this.syncState();
    });
    this.session.on('playerLeave', (player) => {
      if (this.phase !== 'DRAWING') return;
      const idx = this.turnOrder.indexOf(player.id);
      if (idx < 0) return;
      const wasActive = idx === this.currentTurnIndex;
      this.turnOrder.splice(idx, 1);
      if (idx < this.currentTurnIndex) this.currentTurnIndex--;
      if (player.id === this.imposterId || this.turnOrder.length < 2) {
        this.endRound('ABANDONED');
        return;
      }
      if (wasActive) {
        this.currentTurnIndex--;
        this.advanceTurn();
      }
    });
  }

  destroy() {
    this.turnDisposer.dispose();
    this.disposer.dispose();
  }

  get activePlayerId() {
    return this.turnOrder[this.currentTurnIndex];
  }

  handlePlayerAction(playerId, action, payload) {
    if (this.phase === 'DRAWING') {
      if (playerId !== this.activePlayerId) return;
      if (action === 'STROKE_POINTS') {
        const pts = Array.isArray(payload.points) ? payload.points : [];
        if (payload.start || !this.liveStroke) this.liveStroke = { playerId, color: this.getPlayerColor(playerId), points: [] };
        pts.slice(0, 60).forEach(p => {
          if (this.liveStroke.points.length < MAX_POINTS && Array.isArray(p)) this.liveStroke.points.push([round3(p[0]), round3(p[1])]);
        });
        this.redrawCanvas();
      } else if (action === 'STROKE_CANCEL') {
        this.liveStroke = null;
        this.redrawCanvas();
      } else if (action === 'STROKE_SUBMIT') {
        if (this.liveStroke && this.liveStroke.points.length) {
          this.strokes.push(this.liveStroke);
          this.liveStroke = null;
          this.advanceTurn();
        }
      }
    } else if (this.phase === 'VOTING' && action === 'CAST_VOTE') {
      if (!this.turnOrder.includes(playerId) || !this.turnOrder.includes(payload.suspectId) || payload.suspectId === playerId) return;
      this.votes[playerId] = payload.suspectId;
      this.syncState();
      this.render();
      this.checkVotesComplete();
    } else if (this.phase === 'IMPOSTER_GUESS' && playerId === this.imposterId && action === 'SUBMIT_GUESS') {
      this.resolveImposterGuess(String(payload.guess || ''));
    }
  }

  getPlayerColor(playerId) {
    const idx = this.colorOrder ? this.colorOrder.indexOf(playerId) : -1;
    return PLAYER_COLORS[(idx >= 0 ? idx : 0) % PLAYER_COLORS.length];
  }

  startNewGame() {
    const players = this.session.getPlayers();
    if (players.length < 2) return;

    const cat = IMPOSTER_WORDS[this.selectedCategoryIndex] || IMPOSTER_WORDS[0];
    this.categoryName = cat.category;
    let pool = cat.words.filter(w => !this.usedWords.has(w));
    if (!pool.length) {
      this.usedWords.clear();
      pool = cat.words;
    }
    this.secretWord = pool[Math.floor(Math.random() * pool.length)];
    this.usedWords.add(this.secretWord);
    this.guessOptions = shuffle([this.secretWord, ...shuffle(cat.words.filter(w => w !== this.secretWord)).slice(0, 7)]);

    const shuffled = shuffle(players);
    this.imposterId = shuffled[Math.floor(Math.random() * shuffled.length)].id;
    // Classic rule: the Fake Artist never draws first.
    this.turnOrder = shuffled.map(p => p.id);
    if (this.turnOrder[0] === this.imposterId) this.turnOrder.push(this.turnOrder.shift());
    this.colorOrder = [...this.turnOrder];

    this.currentTurnIndex = 0;
    this.currentRound = 1;
    this.strokes = [];
    this.liveStroke = null;
    this.votes = {};
    this.roundOutcome = null;
    this.roundId = (this.roundId || 0) + 1;
    this.phase = 'DRAWING';

    playRoundStart();
    this.dispatchRoles();
    this.startTurn();
  }

  dispatchRoles() {
    this.turnOrder.forEach(id => {
      const isImposter = id === this.imposterId;
      this.session.sendPrivateState(id, {
        game: 'fake-artist',
        roundId: this.roundId,
        isImposter,
        category: this.categoryName,
        secretWord: isImposter ? null : this.secretWord,
        playerColor: this.getPlayerColor(id),
        guessOptions: isImposter ? this.guessOptions : null
      });
    });
  }

  startTurn() {
    this.turnDisposer.dispose();
    this.turnDisposer = new Disposer();
    this.turnTimer = TURN_SECONDS;
    this.liveStroke = null;
    playTick(750);
    this.syncState();
    this.render();
    this.turnDisposer.interval(() => {
      if (this.phase !== 'DRAWING') return;
      this.turnTimer--;
      const el = document.getElementById('turnTimer');
      if (el) el.textContent = `${this.turnTimer}s`;
      if (this.turnTimer <= 0) {
        // Out of time: keep whatever they drew, otherwise skip their stroke.
        if (this.liveStroke?.points.length) this.strokes.push(this.liveStroke);
        this.liveStroke = null;
        this.advanceTurn();
      }
    }, 1000);
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
    this.startTurn();
  }

  startVotingPhase() {
    this.turnDisposer.dispose();
    this.phase = 'VOTING';
    this.votes = {};
    playGong();
    this.syncState();
    this.render();
  }

  checkVotesComplete() {
    if (this.phase !== 'VOTING') return;
    const voters = this.turnOrder.filter(id => this.session.clients.get(id)?.connected);
    if (voters.length && voters.every(id => this.votes[id])) this.resolveVoting();
  }

  resolveVoting() {
    if (this.phase !== 'VOTING') return;
    const { leader, counts } = tallyVotes(this.votes);
    this.voteCounts = counts;
    if (leader && leader === this.imposterId) {
      this.phase = 'IMPOSTER_GUESS';
      this.guessTimer = GUESS_SECONDS;
      playGong();
      this.syncState();
      this.render();
      this.turnDisposer = new Disposer();
      this.turnDisposer.interval(() => {
        if (this.phase !== 'IMPOSTER_GUESS') return;
        this.guessTimer--;
        const el = document.getElementById('guessTimer');
        if (el) el.textContent = `${this.guessTimer}s`;
        if (this.guessTimer <= 0) this.resolveImposterGuess('');
      }, 1000);
    } else {
      this.endRound('IMPOSTER_UNDETECTED', { accusedName: leader ? this.nameOf(leader) : null });
    }
  }

  resolveImposterGuess(guess) {
    if (this.phase !== 'IMPOSTER_GUESS') return;
    const correct = guess.trim().toLowerCase() === this.secretWord.trim().toLowerCase();
    if (correct) playCorrect(); else playWrong();
    this.endRound(correct ? 'IMPOSTER_GUESSED_WORD' : 'ARTISTS_WIN', { guess: guess || null });
  }

  nameOf(id) {
    return this.session.clients.get(id)?.name || 'Player';
  }

  endRound(outcome, details = {}) {
    this.turnDisposer.dispose();
    this.phase = 'ROUND_OVER';
    const add = (id, n) => { this.scores[id] = (this.scores[id] || 0) + n; };
    if (outcome === 'ARTISTS_WIN') {
      this.turnOrder.forEach(id => { if (id !== this.imposterId) add(id, 2); });
    } else if (outcome !== 'ABANDONED') {
      add(this.imposterId, outcome === 'IMPOSTER_UNDETECTED' ? 3 : 2);
    }
    if (outcome !== 'ABANDONED') playVictory();
    this.roundOutcome = { outcome, details, imposterName: this.nameOf(this.imposterId), secretWord: this.secretWord };
    this.syncState();
    this.render();
  }

  syncState() {
    const activeId = this.activePlayerId;
    const players = this.turnOrder.length ? this.turnOrder.map(id => this.session.clients.get(id)).filter(Boolean) : this.session.getPlayers();
    this.session.broadcastPublicState({
      game: 'fake-artist',
      phase: this.phase,
      roundId: this.roundId || 0,
      categoryName: this.categoryName,
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      activePlayerId: this.phase === 'DRAWING' ? activeId : null,
      activePlayerName: this.phase === 'DRAWING' ? this.nameOf(activeId) : null,
      turnSeconds: TURN_SECONDS,
      turnOrder: this.turnOrder,
      strokes: this.strokes,
      players: players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, color: this.getPlayerColor(p.id), score: this.scores[p.id] || 0 })),
      votedIds: Object.keys(this.votes),
      imposterId: this.phase === 'IMPOSTER_GUESS' || this.phase === 'ROUND_OVER' ? this.imposterId : null,
      roundOutcome: this.phase === 'ROUND_OVER' ? this.roundOutcome : null
    });
  }

  redrawCanvas() {
    const canvas = document.getElementById('hostDrawingCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawStrokes(ctx, this.liveStroke ? [...this.strokes, this.liveStroke] : this.strokes, canvas.width, canvas.height, { lineWidth: 7 });
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'DRAWING') this.renderDrawing();
    else if (this.phase === 'VOTING') this.renderVoting();
    else if (this.phase === 'IMPOSTER_GUESS') this.renderImposterGuess();
    else this.renderRoundOver();
    this.redrawCanvas();
  }

  renderSetup() {
    const players = this.session.getPlayers();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>FAKE ARTIST</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="lobby-grid two-col">
          <div class="glass-card">
            <h2>🎨 One line at a time</h2>
            <ul class="rules-list">
              <li>📱 Everyone gets the secret word on their phone, except the <strong>Fake Artist</strong></li>
              <li>✏️ Take turns adding <strong>ONE continuous line</strong> to the shared drawing</li>
              <li>🤔 Too obvious and the Fake learns the word. Too vague and you look fake!</li>
              <li>🗳️ Then vote. If the Fake is caught, they can still win by picking the word</li>
            </ul>
            <div class="players-roster">
              ${players.map((p, idx) => `<div class="player-chip"><span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span><span class="color-dot" style="background:${PLAYER_COLORS[idx % PLAYER_COLORS.length]};"></span></div>`).join('') || '<p class="muted">Waiting for players...</p>'}
            </div>
          </div>
          <div class="glass-card settings-card">
            <div class="form-group">
              <label for="selImposterCat">Word Pack (${IMPOSTER_WORDS.length})</label>
              <select id="selImposterCat" class="custom-select">
                ${IMPOSTER_WORDS.map((c, i) => `<option value="${i}" ${i === this.selectedCategoryIndex ? 'selected' : ''}>${c.featured ? '⭐ ' : ''}${escapeHtml(c.category)} (${c.words.length})</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Lines per player</label>
              <div class="timer-chips">${[1, 2, 3].map(n => `<button class="chip-btn ${this.totalRounds === n ? 'active' : ''}" data-rounds="${n}">${n}</button>`).join('')}</div>
            </div>
            <button class="btn-launch-game ${players.length >= 3 ? 'ready' : 'disabled'}" id="btnStartFakeArtist" ${players.length >= 2 ? '' : 'disabled'}>🎨 Start Drawing</button>
            ${players.length < 3 ? `<p class="hint-text">Needs 3+ players (${Math.max(0, 3 - players.length)} more)</p>` : ''}
            <button class="btn-secondary" id="btnBackToDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('selImposterCat')?.addEventListener('change', (e) => { this.selectedCategoryIndex = parseInt(e.target.value, 10); });
    this.container.querySelectorAll('[data-rounds]').forEach(btn => btn.addEventListener('click', () => {
      this.totalRounds = Number(btn.dataset.rounds);
      this.render();
    }));
    document.getElementById('btnStartFakeArtist')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackToDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  turnOrderHtml() {
    return this.turnOrder.map(pid => {
      const p = this.session.clients.get(pid);
      const isCurrent = pid === this.activePlayerId && this.phase === 'DRAWING';
      return `
        <div class="turn-player-chip ${isCurrent ? 'active-turn' : ''}" style="border-left:4px solid ${this.getPlayerColor(pid)};">
          <span class="avatar">${p?.avatar || '👤'}</span>
          <span class="name">${escapeHtml(p?.name || 'Player')}</span>
          ${isCurrent ? '<span class="drawing-badge">DRAWING</span>' : ''}
        </div>
      `;
    }).join('');
  }

  renderDrawing() {
    const activeColor = this.getPlayerColor(this.activePlayerId);
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header in-game-header">
          <div class="brand-badge"><span class="badge-cat">${escapeHtml(this.categoryName)}</span><span class="round-indicator">LINE ${this.currentRound} / ${this.totalRounds}</span></div>
          <div class="active-turn-pill" style="border:2px solid ${activeColor};">✏️ <strong>${escapeHtml(this.nameOf(this.activePlayerId))}</strong> is drawing · <span id="turnTimer">${this.turnTimer}s</span></div>
          <button class="btn-icon" id="btnEndDrawingEarly">Vote Now</button>
        </header>
        <div class="playing-layout">
          <div class="glass-card canvas-card">
            <canvas id="hostDrawingCanvas" class="drawing-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
          </div>
          <div class="glass-card game-sidebar">
            <h3>Turn Order</h3>
            <div class="turn-order-list">${this.turnOrderHtml()}</div>
            <p class="hint-text">Category: <strong>${escapeHtml(this.categoryName)}</strong></p>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnEndDrawingEarly')?.addEventListener('click', async () => {
      if (await confirmDialog('Stop drawing and go straight to the vote?', { confirmLabel: 'Vote Now' })) {
        if (this.phase === 'DRAWING') this.startVotingPhase();
      }
    });
  }

  renderVoting() {
    const players = this.turnOrder.map(id => this.session.clients.get(id)).filter(Boolean);
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="badge-cat">WHO IS THE FAKE?</span></div>
          <button class="btn-icon" id="btnForceTally">Tally Now</button>
        </header>
        <div class="playing-layout">
          <div class="glass-card canvas-card"><canvas id="hostDrawingCanvas" class="drawing-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas></div>
          <div class="glass-card game-sidebar">
            <h3>🗳️ Vote on your phone</h3>
            <p class="muted">Whose line looked clueless? A tie lets the Fake escape!</p>
            <div class="live-votes-grid vertical">
              ${players.map(p => `
                <div class="voter-badge ${this.votes[p.id] ? 'voted' : 'pending'}" style="border-left:4px solid ${this.getPlayerColor(p.id)};">
                  <span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span>
                  <span class="status-icon">${this.votes[p.id] ? '✓' : '⏳'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnForceTally')?.addEventListener('click', () => this.resolveVoting());
  }

  renderImposterGuess() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner amber">🎯 FAKE ARTIST CAUGHT! 🎯</div>
          <div class="trial-timer" id="guessTimer">${this.guessTimer}s</div>
        </div>
        <div class="trial-central-card glass-card">
          <h2 class="amber-text">${escapeHtml(this.nameOf(this.imposterId))} was the Fake Artist!</h2>
          <p class="trial-instructions">But they can still steal the win by picking the secret word on their phone...</p>
          <canvas id="hostDrawingCanvas" class="drawing-canvas small" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
        </div>
      </div>
    `;
  }

  renderRoundOver() {
    const o = this.roundOutcome;
    const artistsWin = o.outcome === 'ARTISTS_WIN';
    const ranked = this.session.getPlayers().map(p => ({ ...p, score: this.scores[p.id] || 0 })).sort((a, b) => b.score - a.score);
    const subtitle = {
      ARTISTS_WIN: o.details.guess ? `The Fake guessed "${o.details.guess}" and got it wrong!` : 'The Fake Artist was caught and could not name the word!',
      IMPOSTER_GUESSED_WORD: 'Caught, but the Fake Artist named the secret word and steals the win!',
      IMPOSTER_UNDETECTED: o.details.accusedName ? `The room accused ${o.details.accusedName}, who was innocent!` : 'The vote was split and the Fake Artist slipped away!',
      ABANDONED: 'Round ended early because a player left.'
    }[o.outcome];

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="round-over-card glass-card">
          <div class="victory-header ${artistsWin ? 'town-win' : 'spy-win'}">
            <h1>${o.outcome === 'ABANDONED' ? '⏹ ROUND ENDED' : artistsWin ? '🏆 REAL ARTISTS WIN!' : '🎨 FAKE ARTIST WINS!'}</h1>
            <p class="outcome-subtitle">${escapeHtml(subtitle)}</p>
          </div>
          <div class="playing-layout">
            <canvas id="hostDrawingCanvas" class="drawing-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
            <div>
              <div class="reveal-box vertical">
                <div class="reveal-item"><span class="label">SECRET WORD</span><span class="value loc">${escapeHtml(o.secretWord)}</span></div>
                <div class="reveal-item"><span class="label">FAKE ARTIST</span><span class="value spy">${escapeHtml(o.imposterName)}</span></div>
              </div>
              <div class="podium-list">${ranked.map((p, i) => `<div class="podium-row ${i === 0 ? 'first' : ''}"><span>${p.avatar} ${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div>
            </div>
          </div>
          <div class="round-over-actions">
            <button class="btn-primary" id="btnNextRoundFakeArtist">🎨 Next Round</button>
            <button class="btn-secondary" id="btnSetupFakeArtist">Change Pack</button>
            <button class="btn-secondary" id="btnReturnHubFakeArtist">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnNextRoundFakeArtist')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnSetupFakeArtist')?.addEventListener('click', () => {
      this.phase = 'SETUP';
      this.turnOrder = [];
      this.syncState();
      this.render();
    });
    document.getElementById('btnReturnHubFakeArtist')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
