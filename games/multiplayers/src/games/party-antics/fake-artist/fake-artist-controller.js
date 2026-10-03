import { requestWakeLock, vibrate } from '../../../utils/wake-lock.js';

export class FakeArtistController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.privateState = null;
    this.isCardRevealed = true;
    this.hasDrawnThisTurn = false;

    this.isDrawing = false;
    this.canvas = null;
    this.ctx = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      if (data.game === 'fake-artist') {
        this.privateState = data;
        this.isCardRevealed = true;
        this.hasDrawnThisTurn = false;
        requestWakeLock();
        vibrate([80, 40, 80]);
        this.render();
      }
    });
  }

  render() {
    if (!this.container) return;

    if (!this.publicState || this.publicState.phase === 'SETUP') {
      this.renderLobby();
    } else if (this.publicState.phase === 'DRAWING') {
      this.renderDrawing();
    } else if (this.publicState.phase === 'VOTING') {
      this.renderVoting();
    } else if (this.publicState.phase === 'IMPOSTER_GUESS') {
      this.renderImposterGuess();
    } else if (this.publicState.phase === 'ROUND_OVER') {
      this.renderRoundOver();
    }
  }

  renderLobby() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill">${this.session.roomCode}</div>
        </header>
        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <h2>🎨 Fake Artist</h2>
            <p>Look at the TV! The host is selecting the category and starting the game.</p>
          </div>
        </div>
      </div>
    `;
  }

  renderDrawing() {
    const isMyTurn = this.publicState.activePlayerId === this.session.playerId;
    const isImposter = this.privateState?.isImposter;
    const word = this.privateState?.secretWord;
    const category = this.privateState?.category || this.publicState.categoryName;
    const myColor = this.privateState?.playerColor || '#ec4899';

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill">Round ${this.publicState.currentRound}/${this.publicState.totalRounds}</div>
        </header>

        <div class="controller-body">
          <!-- Secret Word Card -->
          <div class="secret-card-wrapper">
            <div class="secret-card ${isImposter ? 'card-spy' : 'card-location'} ${this.isCardRevealed ? 'revealed' : 'hidden'}" id="cardToggle">
              ${this.isCardRevealed ? `
                <div class="card-content">
                  <div class="card-badge">${isImposter ? '🚨 FAKE ARTIST ASSIGNMENT' : '🎨 SECRET DRAWING WORD'}</div>
                  <h1 class="card-title">${isImposter ? 'YOU ARE THE FAKE ARTIST!' : word}</h1>
                  <p class="card-desc">
                    ${isImposter 
                      ? `Category: <strong>${category}</strong>. You do NOT know the word! Pretend you know it and draw one convincing line!`
                      : `Category: <strong>${category}</strong>. Draw 1 stroke that proves you know it without giving it away to the fake!`
                    }
                  </p>
                  <button class="btn-hide-curtain" id="btnCurtain">🙈 Hide Secret</button>
                </div>
              ` : `
                <div class="curtain-content">
                  <span class="eye-icon">🔒</span>
                  <h3>Secret Hidden</h3>
                  <p>Tap to reveal your word</p>
                </div>
              `}
            </div>
          </div>

          <!-- Drawing Pad Area -->
          ${isMyTurn ? `
            <div class="glass-card" style="padding:14px; text-align:center;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <h3 style="color:${myColor}; font-size:16px;">✨ YOUR TURN TO DRAW!</h3>
                <span style="font-size:12px; color:var(--text-secondary);">Draw 1 continuous line</span>
              </div>

              <div style="background:#fff; border-radius:12px; overflow:hidden; touch-action:none; position:relative;">
                <canvas id="mobileCanvas" width="320" height="260" style="width:100%; height:260px; display:block;"></canvas>
              </div>

              <button class="btn-primary" id="btnDoneStroke" style="margin-top:12px; background:${myColor};">
                ✓ Finish My Line & Pass Turn
              </button>
            </div>
          ` : `
            <div class="glass-card" style="text-align:center; padding:30px 20px;">
              <div class="radar-scan"></div>
              <h3 style="margin-top:14px;">Waiting for ${this.publicState.activePlayerName} to draw...</h3>
              <p style="color:var(--text-muted); font-size:13px; margin-top:6px;">Look at the main screen to watch their stroke!</p>
            </div>
          `}
        </div>
      </div>
    `;

    document.getElementById('cardToggle')?.addEventListener('click', () => {
      this.isCardRevealed = !this.isCardRevealed;
      this.render();
    });

    if (isMyTurn) {
      this.initMobileCanvas(myColor);
      document.getElementById('btnDoneStroke')?.addEventListener('click', () => {
        this.session.sendAction('STROKE_END');
      });
    }
  }

  initMobileCanvas(strokeColor) {
    const canvas = document.getElementById('mobileCanvas');
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Handle high DPI
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - r.left) / r.width,
        y: (clientY - r.top) / r.height
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      this.isDrawing = true;
      const pt = getPos(e);
      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = 4;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(pt.x * canvas.width, pt.y * canvas.height);
      this.session.sendAction('STROKE_START', { point: pt });
    };

    const moveDraw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const pt = getPos(e);
      this.ctx.lineTo(pt.x * canvas.width, pt.y * canvas.height);
      this.ctx.stroke();
      this.session.sendAction('STROKE_MOVE', { point: pt });
    };

    const endDraw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      this.isDrawing = false;
    };

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw, { passive: false });
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
  }

  renderVoting() {
    const players = (this.publicState?.players || []).filter(p => p.id !== this.session.playerId);
    const myVote = this.publicState?.votes?.[this.session.playerId];

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
        </header>

        <div class="controller-body">
          <div class="glass-card">
            <h2>🕵️‍♂️ Who is the Fake Artist?</h2>
            <p style="color:var(--text-secondary); margin-bottom:16px;">
              Vote for the player who seemed clueless about the secret word!
            </p>

            ${myVote ? `
              <div class="vote-confirmed">
                <span class="check">✓</span>
                <h3>Vote Locked In!</h3>
                <p>Waiting for other players...</p>
              </div>
            ` : `
              <div class="suspect-picker-grid">
                ${players.map(p => `
                  <button class="suspect-select-btn" data-player-id="${p.id}">
                    <span class="avatar">${p.avatar}</span>
                    <span class="name">${p.name}</span>
                    <span style="width:10px; height:10px; border-radius:50%; background:${p.color};"></span>
                  </button>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.suspect-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const suspectId = btn.dataset.playerId;
        this.session.sendAction('CAST_VOTE', { suspectId });
      });
    });
  }

  renderImposterGuess() {
    const isImposter = this.privateState?.isImposter;

    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card">
            <h2>🎯 Fake Artist Was Caught!</h2>
            ${isImposter ? `
              <p style="color:#f59e0b; margin-bottom:16px;">
                You were unmasked! But if you can guess the secret word, you still <strong>WIN</strong>!
              </p>
              <form id="guessForm">
                <input type="text" id="txtGuess" placeholder="Type your guess..." class="input-text" style="margin-bottom:12px;" required />
                <button type="submit" class="btn-primary">Submit Word Guess 🚀</button>
              </form>
            ` : `
              <p style="color:var(--text-secondary); padding:20px 0;">
                The Fake Artist is making their final guess on their phone. Look at the TV!
              </p>
            `}
          </div>
        </div>
      </div>
    `;

    document.getElementById('guessForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const guess = document.getElementById('txtGuess').value.trim();
      this.session.sendAction('SUBMIT_GUESS', { guess });
    });
  }

  renderRoundOver() {
    const outcome = this.publicState?.roundOutcome;

    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card round-over-mobile">
            <h2>Round Finished!</h2>
            <div class="summary-box">
              <p>Secret Word: <strong>${outcome?.secretWord}</strong></p>
              <p>Fake Artist: <strong>${outcome?.imposterName}</strong></p>
            </div>
            <p class="subtitle" style="margin-top:16px;">Look at the main screen for results!</p>
          </div>
        </div>
      </div>
    `;
  }
}
