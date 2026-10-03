import { playRoundStart, playVictory, playBuzzer, playTick } from '../../../utils/audio.js';

const PONG_WIDTH = 700;
const PONG_HEIGHT = 400;
const PADDLE_WIDTH = 14;
const PADDLE_HEIGHT = 90;
const BALL_SIZE = 12;
const BALL_SPEED = 320;
const PADDLE_SPEED = 380;

export class PongHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'SETUP'; // 'SETUP' | 'PLAYING' | 'GAME_OVER'
    this.player1Id = null;
    this.player2Id = null;

    this.leftPaddle = PONG_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    this.rightPaddle = PONG_HEIGHT / 2 - PADDLE_HEIGHT / 2;

    this.ballX = PONG_WIDTH / 2;
    this.ballY = PONG_HEIGHT / 2;
    this.ballVx = BALL_SPEED;
    this.ballVy = 0;

    this.leftScore = 0;
    this.rightScore = 0;
    this.targetScore = 7;

    this.playerInputs = {}; // id -> { dir: -1 | 0 | 1, pos: number }
    this.loopRunning = false;
    this.lastTime = 0;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (action === 'PADDLE_INPUT') {
        this.playerInputs[playerId] = payload;
      }
    });

    // Also support keyboard on Host laptop
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  handleKeyDown(e) {
    if (this.phase !== 'PLAYING') return;
    if (e.key === 'w' || e.key === 'W') this.hostLeftDir = -1;
    if (e.key === 's' || e.key === 'S') this.hostLeftDir = 1;
    if (e.key === 'ArrowUp') this.hostRightDir = -1;
    if (e.key === 'ArrowDown') this.hostRightDir = 1;
  }

  handleKeyUp(e) {
    if (e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S') this.hostLeftDir = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') this.hostRightDir = 0;
  }

  startNewGame() {
    const players = Array.from(this.session.clients.values());
    if (players.length < 1) {
      alert('At least 1 player required to test Pong!');
      return;
    }

    this.player1Id = players[0].id;
    this.player2Id = players.length >= 2 ? players[1].id : 'HOST_OR_AI';

    this.leftScore = 0;
    this.rightScore = 0;
    this.resetBall(1);

    this.phase = 'PLAYING';
    this.loopRunning = true;
    this.lastTime = performance.now();

    playRoundStart();
    this.dispatchPlayerRoles();
    this.render();
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  resetBall(dir = 1) {
    this.ballX = PONG_WIDTH / 2;
    this.ballY = PONG_HEIGHT / 2;
    const angle = (Math.random() - 0.5) * 0.8;
    this.ballVx = BALL_SPEED * dir;
    this.ballVy = BALL_SPEED * Math.sin(angle);
  }

  dispatchPlayerRoles() {
    const p1 = this.session.clients.get(this.player1Id);
    const p2 = this.session.clients.get(this.player2Id);

    if (p1) {
      this.session.sendPrivateState(p1.id, {
        game: 'pong',
        side: 'LEFT',
        opponentName: p2?.name || 'Player 2 / AI',
        color: '#06b6d4'
      });
    }
    if (p2) {
      this.session.sendPrivateState(p2.id, {
        game: 'pong',
        side: 'RIGHT',
        opponentName: p1?.name || 'Player 1',
        color: '#ec4899'
      });
    }
  }

  gameLoop(timestamp) {
    if (!this.loopRunning || this.phase !== 'PLAYING') return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this.updatePhysics(dt);
    this.drawCanvas();

    requestAnimationFrame(this.gameLoop.bind(this));
  }

  updatePhysics(dt) {
    // 1. Move Paddles
    const p1Input = this.playerInputs[this.player1Id];
    const p2Input = this.playerInputs[this.player2Id];

    // Left Paddle
    if (p1Input && p1Input.pos != null) {
      this.leftPaddle = p1Input.pos * (PONG_HEIGHT - PADDLE_HEIGHT);
    } else {
      const dir1 = (p1Input?.dir || 0) + (this.hostLeftDir || 0);
      this.leftPaddle += dir1 * PADDLE_SPEED * dt;
    }

    // Right Paddle (Player 2 or simple tracking AI if solo)
    if (p2Input && p2Input.pos != null) {
      this.rightPaddle = p2Input.pos * (PONG_HEIGHT - PADDLE_HEIGHT);
    } else if (p2Input) {
      const dir2 = (p2Input?.dir || 0) + (this.hostRightDir || 0);
      this.rightPaddle += dir2 * PADDLE_SPEED * dt;
    } else {
      // AI tracking if solo
      const center = this.rightPaddle + PADDLE_HEIGHT / 2;
      if (this.ballY > center + 10) this.rightPaddle += PADDLE_SPEED * 0.7 * dt;
      else if (this.ballY < center - 10) this.rightPaddle -= PADDLE_SPEED * 0.7 * dt;
    }

    // Clamp paddles
    this.leftPaddle = Math.max(0, Math.min(PONG_HEIGHT - PADDLE_HEIGHT, this.leftPaddle));
    this.rightPaddle = Math.max(0, Math.min(PONG_HEIGHT - PADDLE_HEIGHT, this.rightPaddle));

    // 2. Move Ball
    this.ballX += this.ballVx * dt;
    this.ballY += this.ballVy * dt;

    // Top / Bottom Wall Bounces
    if (this.ballY <= 0) {
      this.ballY = 0;
      this.ballVy = Math.abs(this.ballVy);
      playTick(600);
    } else if (this.ballY >= PONG_HEIGHT - BALL_SIZE) {
      this.ballY = PONG_HEIGHT - BALL_SIZE;
      this.ballVy = -Math.abs(this.ballVy);
      playTick(600);
    }

    // 3. Paddle Collisions
    const leftPaddleX = 40;
    const rightPaddleX = PONG_WIDTH - 40 - PADDLE_WIDTH;

    // Left Paddle Collision
    if (
      this.ballX <= leftPaddleX + PADDLE_WIDTH &&
      this.ballX + BALL_SIZE >= leftPaddleX &&
      this.ballY + BALL_SIZE >= this.leftPaddle &&
      this.ballY <= this.leftPaddle + PADDLE_HEIGHT &&
      this.ballVx < 0
    ) {
      this.ballX = leftPaddleX + PADDLE_WIDTH;
      this.ballVx = -this.ballVx * 1.05; // slight speed increase
      const hitOffset = (this.ballY + BALL_SIZE / 2 - (this.leftPaddle + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2);
      this.ballVy = Math.abs(this.ballVx) * hitOffset * 0.9;
      playTick(900);
    }

    // Right Paddle Collision
    if (
      this.ballX + BALL_SIZE >= rightPaddleX &&
      this.ballX <= rightPaddleX + PADDLE_WIDTH &&
      this.ballY + BALL_SIZE >= this.rightPaddle &&
      this.ballY <= this.rightPaddle + PADDLE_HEIGHT &&
      this.ballVx > 0
    ) {
      this.ballX = rightPaddleX - BALL_SIZE;
      this.ballVx = -this.ballVx * 1.05;
      const hitOffset = (this.ballY + BALL_SIZE / 2 - (this.rightPaddle + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2);
      this.ballVy = Math.abs(this.ballVx) * hitOffset * 0.9;
      playTick(900);
    }

    // 4. Scoring
    if (this.ballX < 0) {
      this.rightScore++;
      playBuzzer();
      this.checkWinner();
      if (this.phase === 'PLAYING') this.resetBall(1);
    } else if (this.ballX > PONG_WIDTH) {
      this.leftScore++;
      playBuzzer();
      this.checkWinner();
      if (this.phase === 'PLAYING') this.resetBall(-1);
    }
  }

  checkWinner() {
    const p1 = this.session.clients.get(this.player1Id);
    const p2 = this.session.clients.get(this.player2Id);

    if (this.leftScore >= this.targetScore) {
      this.phase = 'GAME_OVER';
      this.loopRunning = false;
      this.winnerName = p1?.name || 'Player 1';
      playVictory();
      this.render();
    } else if (this.rightScore >= this.targetScore) {
      this.phase = 'GAME_OVER';
      this.loopRunning = false;
      this.winnerName = p2?.name || (this.player2Id === 'HOST_OR_AI' ? 'AI Bot' : 'Player 2');
      playVictory();
      this.render();
    }
  }

  drawCanvas() {
    const canvas = document.getElementById('pongCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Background with retro grid
    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, PONG_WIDTH, PONG_HEIGHT);

    // Center Dashed Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(PONG_WIDTH / 2, 0);
    ctx.lineTo(PONG_WIDTH / 2, PONG_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    // Left Paddle (Cyan)
    ctx.fillStyle = '#06b6d4';
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;
    ctx.fillRect(40, this.leftPaddle, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Right Paddle (Pink)
    ctx.fillStyle = '#ec4899';
    ctx.shadowColor = '#ec4899';
    ctx.shadowBlur = 12;
    ctx.fillRect(PONG_WIDTH - 40 - PADDLE_WIDTH, this.rightPaddle, PADDLE_WIDTH, PADDLE_HEIGHT);

    // Ball (Glowing White/Amber)
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(this.ballX + BALL_SIZE / 2, this.ballY + BALL_SIZE / 2, BALL_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Scores
    ctx.font = '800 48px Outfit, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(this.leftScore.toString(), PONG_WIDTH * 0.35, 60);
    ctx.fillText(this.rightScore.toString(), PONG_WIDTH * 0.65, 60);
  }

  render() {
    if (!this.container) return;

    const p1 = this.session.clients.get(this.player1Id);
    const p2 = this.session.clients.get(this.player2Id);
    const p2DisplayName = p2?.name || (this.player2Id === 'HOST_OR_AI' ? '🤖 AI Bot (Solo Test)' : 'Waiting for P2');

    if (this.phase === 'SETUP') {
      const players = Array.from(this.session.clients.values());
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header">
            <div class="brand-badge"><span class="pulse-dot"></span><span>NETPLAYJS PONG DUEL</span></div>
            <div class="room-code-display"><span class="code">${this.session.roomCode}</span></div>
          </header>

          <div class="glass-card" style="max-width:800px; margin:0 auto; padding:40px 24px; text-align:center;">
            <div style="font-size:54px; margin-bottom:12px;">🏓</div>
            <h2>Fast P2P Real-Time Arcade Pong</h2>
            <p style="color:var(--text-secondary); margin:12px auto 24px; max-width:550px; line-height:1.5;">
              Direct from <strong>NetplayJS</strong>! 2 players control paddles using their smartphones as touch gamepads. First to 7 points wins!
            </p>

            <div style="display:flex; justify-content:center; gap:24px; margin-bottom:28px;">
              <div class="player-chip" style="border:2px solid #06b6d4; padding:14px 20px;">
                <span class="avatar">${players[0]?.avatar || '👤'}</span>
                <div>
                  <strong style="color:#06b6d4;">PLAYER 1 (Cyan)</strong><br/>
                  <span>${players[0]?.name || 'Waiting...'}</span>
                </div>
              </div>
              <div class="player-chip" style="border:2px solid #ec4899; padding:14px 20px;">
                <span class="avatar">${players[1]?.avatar || '🤖'}</span>
                <div>
                  <strong style="color:#ec4899;">PLAYER 2 (Pink)</strong><br/>
                  <span>${players[1]?.name || 'AI Bot (Solo Mode)'}</span>
                </div>
              </div>
            </div>

            <div style="display:flex; justify-content:center; gap:12px;">
              <button class="btn-primary-large" id="btnStartPong" style="max-width:280px;">🚀 Launch Pong Duel</button>
              <button class="btn-secondary" id="btnBackDeck">Back to Party Deck</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnStartPong')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnBackDeck')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    } else if (this.phase === 'PLAYING') {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header" style="padding:10px 24px;">
            <div style="display:flex; align-items:center; gap:16px;">
              <span style="color:#06b6d4; font-weight:800;">${p1?.avatar || '👤'} ${p1?.name || 'P1'}</span>
              <span style="color:var(--text-muted); font-size:12px;">VS</span>
              <span style="color:#ec4899; font-weight:800;">${p2DisplayName}</span>
            </div>
            <div class="round-indicator">FIRST TO ${this.targetScore} PTS</div>
            <div class="room-code-mini"><button class="btn-icon" id="btnQuitPong">Exit</button></div>
          </header>

          <div style="display:flex; justify-content:center; margin-top:10px;">
            <canvas id="pongCanvas" width="${PONG_WIDTH}" height="${PONG_HEIGHT}" style="border-radius:18px; box-shadow:0 12px 40px rgba(0,0,0,0.8); max-width:100%; border:2px solid rgba(255,255,255,0.1);"></canvas>
          </div>
          <p style="text-align:center; color:var(--text-muted); font-size:12px; margin-top:10px;">
            Controls: Players slide finger on phone touch screen. (Desktop: W/S or Up/Down keys)
          </p>
        </div>
      `;

      document.getElementById('btnQuitPong')?.addEventListener('click', () => {
        this.loopRunning = false;
        if (this.onReturnToHub) this.onReturnToHub();
      });
    } else if (this.phase === 'GAME_OVER') {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <div class="glass-card" style="max-width:700px; margin:40px auto; padding:40px 24px; text-align:center;">
            <div style="font-size:54px; margin-bottom:12px;">🏆</div>
            <h1 style="font-family:var(--font-heading); font-size:40px; color:var(--accent-cyan); margin-bottom:12px;">
              ${this.winnerName} WINS!
            </h1>
            <p style="font-size:22px; color:#e2e8f0; margin-bottom:28px;">
              Final Score: <strong>${this.leftScore} - ${this.rightScore}</strong>
            </p>
            <div style="display:flex; justify-content:center; gap:12px;">
              <button class="btn-primary" id="btnRestartPong">Play Rematch</button>
              <button class="btn-secondary" id="btnHubPong">Back to Party Deck</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnRestartPong')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnHubPong')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    }
  }
}
