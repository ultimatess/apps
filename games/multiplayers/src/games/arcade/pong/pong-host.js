import { playRoundStart, playVictory, playBuzzer, playTick, playCountdown } from '../../../utils/audio.js';
import { escapeHtml, ChallengerQueue, Disposer } from '../../../utils/ui.js';

const W = 960;
const H = 540;
const PADDLE_W = 16;
const PADDLE_H = 110;
const PADDLE_X = 44;
const BALL = 16;
const SERVE_SPEED = 430;
const MAX_SPEED = 1050;
const PADDLE_SPEED = 560;
const AI_SPEED = 360;
export const AI_ID = 'AI_BOT';
const LEFT_COLOR = '#06b6d4';
const RIGHT_COLOR = '#ec4899';

export class PongHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'PLAYING' | 'GAME_OVER'
    this.queue = new ChallengerQueue();
    this.player1Id = null;
    this.player2Id = null;
    this.targetScore = 7;
    this.wins = {};
    this.resetPositions();

    this.playerInputs = {}; // id -> { pos } (0..1) or { dir }
    this.keys = { left: 0, right: 0 };
    this.frame = null;
    this.serveAt = 0;
    this.countdownShown = null;
    this.flash = 0;

    this.setupNetworkHandlers();
  }

  resetPositions() {
    this.leftPaddle = H / 2 - PADDLE_H / 2;
    this.rightPaddle = H / 2 - PADDLE_H / 2;
    this.leftScore = 0;
    this.rightScore = 0;
    this.ballX = W / 2 - BALL / 2;
    this.ballY = H / 2 - BALL / 2;
    this.ballVx = 0;
    this.ballVy = 0;
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (action !== 'PADDLE_INPUT') return;
      if (playerId !== this.player1Id && playerId !== this.player2Id) return;
      const pos = Number(payload.pos);
      const dir = Number(payload.dir);
      this.playerInputs[playerId] = Number.isFinite(pos)
        ? { pos: Math.max(0, Math.min(1, pos)) }
        : { dir: Math.max(-1, Math.min(1, dir || 0)) };
    });

    this.session.on('rosterChange', () => {
      this.queue.sync(this.session.getPlayers().map(p => p.id));
      if (this.phase === 'SETUP') this.render();
      this.syncState();
    });

    // A dropped phone shouldn't lose points while it reconnects: freeze the ball.
    this.session.on('playerDisconnect', (player) => {
      if (this.phase === 'PLAYING' && (player.id === this.player1Id || player.id === this.player2Id)) this.paused = true;
    });
    this.session.on('playerReconnect', (player) => {
      if (this.phase === 'PLAYING' && this.paused && (player.id === this.player1Id || player.id === this.player2Id)) {
        this.paused = false;
        this.serve(Math.random() < 0.5 ? 1 : -1, 2000);
      }
    });

    this.session.on('playerLeave', (player) => {
      if (this.phase !== 'PLAYING') return;
      if (player.id === this.player1Id) this.endMatch('RIGHT', true);
      else if (player.id === this.player2Id) this.endMatch('LEFT', true);
    });

    // Keyboard on the host laptop (handy for testing): W/S left paddle, arrows right paddle.
    const key = (down) => (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w') this.keys.left = down ? -1 : (this.keys.left === -1 ? 0 : this.keys.left);
      else if (k === 's') this.keys.left = down ? 1 : (this.keys.left === 1 ? 0 : this.keys.left);
      else if (e.key === 'ArrowUp') this.keys.right = down ? -1 : (this.keys.right === -1 ? 0 : this.keys.right);
      else if (e.key === 'ArrowDown') this.keys.right = down ? 1 : (this.keys.right === 1 ? 0 : this.keys.right);
      else return;
      if (this.phase === 'PLAYING') e.preventDefault();
    };
    this.disposer.listen(window, 'keydown', key(true));
    this.disposer.listen(window, 'keyup', key(false));
  }

  destroy() {
    this.stopLoop();
    this.disposer.dispose();
  }

  nameOf(id) {
    if (id === AI_ID) return '🤖 AI Bot';
    return this.session.clients.get(id)?.name || 'Player';
  }

  avatarOf(id) {
    if (id === AI_ID) return '🤖';
    return this.session.clients.get(id)?.avatar || '👤';
  }

  startMatch(seats = null) {
    this.queue.sync(this.session.getPlayers().map(p => p.id));
    const valid = (id) => id === AI_ID || this.session.clients.has(id);
    let [p1, p2] = seats && seats.every(valid) ? seats : this.queue.pair();
    if (!p1) return;
    this.player1Id = p1;
    this.player2Id = p2 || AI_ID;
    this.playerInputs = {};
    this.resetPositions();
    this.winnerSide = null;
    this.forfeit = false;
    this.paused = false;
    this.phase = 'PLAYING';

    playRoundStart();
    this.syncState();
    this.render();
    this.serve(Math.random() < 0.5 ? 1 : -1, 3000);
    this.startLoop();
  }

  serve(dir, delayMs = 1200) {
    this.ballX = W / 2 - BALL / 2;
    this.ballY = H / 2 - BALL / 2;
    this.ballVx = 0;
    this.ballVy = 0;
    this.serveDir = dir;
    this.serveAt = performance.now() + delayMs;
    this.countdownShown = null;
  }

  startLoop() {
    this.stopLoop();
    this.lastTime = performance.now();
    const loop = (t) => {
      if (this.phase !== 'PLAYING') return;
      const dt = Math.min((t - this.lastTime) / 1000, 0.05);
      this.lastTime = t;
      this.update(dt, t);
      this.draw(t);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  movePaddle(current, input, keyDir, dt) {
    if (input && input.pos != null) {
      const target = input.pos * (H - PADDLE_H);
      // Ease toward the finger so network jitter doesn't teleport the paddle.
      return current + (target - current) * Math.min(1, dt * 22);
    }
    const dir = (input?.dir || 0) + keyDir;
    return current + Math.max(-1, Math.min(1, dir)) * PADDLE_SPEED * dt;
  }

  update(dt, now) {
    if (this.paused) return;
    this.leftPaddle = this.movePaddle(this.leftPaddle, this.playerInputs[this.player1Id], this.keys.left, dt);
    if (this.player2Id === AI_ID) {
      const center = this.rightPaddle + PADDLE_H / 2;
      const target = this.ballVx > 0 ? this.ballY + BALL / 2 : H / 2;
      const delta = target - center;
      this.rightPaddle += Math.sign(delta) * Math.min(Math.abs(delta), AI_SPEED * dt);
      this.rightPaddle += this.keys.right * PADDLE_SPEED * dt;
    } else {
      this.rightPaddle = this.movePaddle(this.rightPaddle, this.playerInputs[this.player2Id], this.keys.right, dt);
    }
    this.leftPaddle = Math.max(0, Math.min(H - PADDLE_H, this.leftPaddle));
    this.rightPaddle = Math.max(0, Math.min(H - PADDLE_H, this.rightPaddle));

    if (this.serveAt) {
      const remaining = Math.ceil((this.serveAt - now) / 1000);
      if (remaining !== this.countdownShown && remaining > 0 && remaining <= 3) {
        this.countdownShown = remaining;
        playCountdown(false);
      }
      if (now >= this.serveAt) {
        this.serveAt = 0;
        playCountdown(true);
        const angle = (Math.random() - 0.5) * 0.9;
        this.ballVx = SERVE_SPEED * this.serveDir;
        this.ballVy = SERVE_SPEED * Math.sin(angle);
      }
      return;
    }

    this.ballX += this.ballVx * dt;
    this.ballY += this.ballVy * dt;

    if (this.ballY <= 0) {
      this.ballY = 0;
      this.ballVy = Math.abs(this.ballVy);
      playTick(500);
    } else if (this.ballY >= H - BALL) {
      this.ballY = H - BALL;
      this.ballVy = -Math.abs(this.ballVy);
      playTick(500);
    }

    const leftFace = PADDLE_X + PADDLE_W;
    const rightFace = W - PADDLE_X - PADDLE_W;
    if (this.ballVx < 0 && this.ballX <= leftFace && this.ballX + BALL >= PADDLE_X &&
        this.ballY + BALL >= this.leftPaddle && this.ballY <= this.leftPaddle + PADDLE_H) {
      this.ballX = leftFace;
      this.bounce(this.leftPaddle, 1);
    } else if (this.ballVx > 0 && this.ballX + BALL >= rightFace && this.ballX <= W - PADDLE_X &&
        this.ballY + BALL >= this.rightPaddle && this.ballY <= this.rightPaddle + PADDLE_H) {
      this.ballX = rightFace - BALL;
      this.bounce(this.rightPaddle, -1);
    }

    if (this.ballX + BALL < 0) this.point('RIGHT');
    else if (this.ballX > W) this.point('LEFT');
  }

  bounce(paddleY, dir) {
    const speed = Math.min(MAX_SPEED, Math.hypot(this.ballVx, this.ballVy) * 1.06);
    const offset = (this.ballY + BALL / 2 - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2);
    const angle = Math.max(-1, Math.min(1, offset)) * 1.0; // up to ~57 degrees
    this.ballVx = Math.cos(angle) * speed * dir;
    this.ballVy = Math.sin(angle) * speed;
    this.flash = 1;
    playTick(900);
  }

  point(side) {
    if (side === 'LEFT') this.leftScore++;
    else this.rightScore++;
    playBuzzer();
    if (this.leftScore >= this.targetScore) this.endMatch('LEFT');
    else if (this.rightScore >= this.targetScore) this.endMatch('RIGHT');
    else {
      this.syncState();
      this.serve(side === 'LEFT' ? 1 : -1); // loser of the point receives
    }
  }

  endMatch(side, forfeit = false) {
    this.phase = 'GAME_OVER';
    this.stopLoop();
    this.winnerSide = side;
    this.forfeit = forfeit;
    const winnerId = side === 'LEFT' ? this.player1Id : this.player2Id;
    if (winnerId !== AI_ID) this.wins[winnerId] = (this.wins[winnerId] || 0) + 1;
    playVictory();
    this.syncState();
    this.render();
  }

  nextChallenger() {
    const winnerId = this.winnerSide === 'LEFT' ? this.player1Id : this.player2Id;
    const loserId = this.winnerSide === 'LEFT' ? this.player2Id : this.player1Id;
    if (winnerId !== AI_ID && loserId !== AI_ID) this.queue.winnerStays(winnerId, loserId);
    this.startMatch();
  }

  syncState() {
    this.queue.sync(this.session.getPlayers().map(p => p.id));
    const waiting = this.queue.order.filter(id => id !== this.player1Id && id !== this.player2Id);
    this.session.broadcastPublicState({
      game: 'pong',
      phase: this.phase,
      p1Id: this.player1Id,
      p2Id: this.player2Id,
      p1Name: this.nameOf(this.player1Id),
      p2Name: this.nameOf(this.player2Id),
      leftScore: this.leftScore,
      rightScore: this.rightScore,
      targetScore: this.targetScore,
      winnerSide: this.winnerSide,
      queue: (this.phase === 'SETUP' ? this.queue.order : waiting).map(id => ({ id, name: this.nameOf(id) }))
    });
  }

  draw(now) {
    const canvas = document.getElementById('pongCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 14]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '800 84px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(6,182,212,0.35)';
    ctx.fillText(String(this.leftScore), W * 0.32, 28);
    ctx.fillStyle = 'rgba(236,72,153,0.35)';
    ctx.fillText(String(this.rightScore), W * 0.68, 28);

    const paddle = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.roundRect(x, y, PADDLE_W, PADDLE_H, 8);
      ctx.fill();
    };
    paddle(PADDLE_X, this.leftPaddle, LEFT_COLOR);
    paddle(W - PADDLE_X - PADDLE_W, this.rightPaddle, RIGHT_COLOR);

    this.flash = Math.max(0, this.flash - 0.08);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 16 + this.flash * 30;
    ctx.beginPath();
    ctx.arc(this.ballX + BALL / 2, this.ballY + BALL / 2, BALL / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (this.paused) {
      ctx.font = '800 44px Outfit, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('⏸ Waiting for a player to reconnect...', W / 2, H / 2);
    } else if (this.serveAt) {
      const remaining = Math.max(1, Math.ceil((this.serveAt - now) / 1000));
      ctx.font = '900 120px Outfit, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(String(remaining), W / 2, H / 2);
    }
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'PLAYING') this.renderPlaying();
    else this.renderGameOver();
  }

  renderSetup() {
    this.queue.sync(this.session.getPlayers().map(p => p.id));
    const [a, b] = this.queue.pair();
    const rest = this.queue.order.slice(2);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>NETPLAY PONG DUEL</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="glass-card setup-card">
          <div class="setup-icon">🏓</div>
          <h2>Real-time arcade Pong</h2>
          <p class="setup-desc">Slide your thumb on your phone to move your paddle. <strong>Winner stays on</strong> and faces the next challenger in line. Solo? Play the AI bot.</p>

          <div class="versus-row">
            <div class="player-chip big" style="border-color:${LEFT_COLOR};">
              <span class="avatar">${a ? this.avatarOf(a) : '⏳'}</span>
              <div><small style="color:${LEFT_COLOR};">LEFT PADDLE</small><br/><strong>${a ? escapeHtml(this.nameOf(a)) : 'Waiting for a player'}</strong></div>
            </div>
            <span class="vs">VS</span>
            <div class="player-chip big" style="border-color:${RIGHT_COLOR};">
              <span class="avatar">${b ? this.avatarOf(b) : '🤖'}</span>
              <div><small style="color:${RIGHT_COLOR};">RIGHT PADDLE</small><br/><strong>${b ? escapeHtml(this.nameOf(b)) : 'AI Bot (solo practice)'}</strong></div>
            </div>
          </div>
          ${rest.length ? `<p class="queue-line">Next up: ${rest.map(id => escapeHtml(this.nameOf(id))).join(' → ')}</p>` : ''}

          <div class="form-group inline-group">
            <label>First to:</label>
            <div class="timer-chips">
              ${[5, 7, 11].map(n => `<button class="chip-btn ${this.targetScore === n ? 'active' : ''}" data-target="${n}">${n} pts</button>`).join('')}
            </div>
          </div>

          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartPong" ${a ? '' : 'disabled'}>🚀 Launch Pong Duel</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
          <p class="hint-text">Keyboard on this screen: W/S (left), ↑/↓ (right)</p>
        </div>
      </div>
    `;

    this.container.querySelectorAll('[data-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.targetScore = Number(btn.dataset.target);
        this.render();
      });
    });
    document.getElementById('btnStartPong')?.addEventListener('click', () => this.startMatch());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderPlaying() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="versus-mini">
            <span style="color:${LEFT_COLOR};">${this.avatarOf(this.player1Id)} ${escapeHtml(this.nameOf(this.player1Id))}</span>
            <span class="vs">VS</span>
            <span style="color:${RIGHT_COLOR};">${escapeHtml(this.nameOf(this.player2Id))}</span>
          </div>
          <div class="round-indicator">FIRST TO ${this.targetScore}</div>
          <button class="btn-icon" id="btnQuitPong">Exit</button>
        </header>
        <div class="arena-stage">
          <canvas id="pongCanvas" class="arena-canvas" width="${W}" height="${H}"></canvas>
        </div>
      </div>
    `;
    document.getElementById('btnQuitPong')?.addEventListener('click', () => {
      this.stopLoop();
      this.onReturnToHub?.();
    });
  }

  renderGameOver() {
    const winnerId = this.winnerSide === 'LEFT' ? this.player1Id : this.player2Id;
    const waiting = this.queue.order.filter(id => id !== this.player1Id && id !== this.player2Id);
    const humanMatch = this.player1Id !== AI_ID && this.player2Id !== AI_ID;
    const color = this.winnerSide === 'LEFT' ? LEFT_COLOR : RIGHT_COLOR;

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title" style="color:${color};">${escapeHtml(this.nameOf(winnerId))} WINS!</h1>
          <p class="final-score">${this.leftScore} – ${this.rightScore}${this.forfeit ? ' · opponent left' : ''}</p>
          ${winnerId !== AI_ID && this.wins[winnerId] > 1 ? `<p class="muted">🔥 ${this.wins[winnerId]} wins this session</p>` : ''}
          <div class="setup-actions">
            ${humanMatch && waiting.length ? `<button class="btn-primary" id="btnNextPong">👑 Winner Stays: vs ${escapeHtml(this.nameOf(waiting[0]))}</button>` : ''}
            <button class="${humanMatch && waiting.length ? 'btn-secondary' : 'btn-primary'}" id="btnRestartPong">🔁 Rematch</button>
            <button class="btn-secondary" id="btnHubPong">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnNextPong')?.addEventListener('click', () => this.nextChallenger());
    document.getElementById('btnRestartPong')?.addEventListener('click', () => this.startMatch([this.player1Id, this.player2Id]));
    document.getElementById('btnHubPong')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
