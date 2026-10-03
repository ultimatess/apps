import { playRoundStart, playVictory, playBuzzer, playTick } from '../../../utils/audio.js';

const ARENA_WIDTH = 700;
const ARENA_HEIGHT = 420;
const PLAYER_SIZE = 28;
const BASE_SPEED = 240;

const COLORS = ['#06b6d4', '#ec4899', '#8b5cf6', '#10b981'];

export class SquareTagHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'SETUP'; // 'SETUP' | 'PLAYING' | 'GAME_OVER'
    this.players = []; // [{ id, name, avatar, color, x, y, vx, vy, score, isTagger }]
    this.coins = []; // [{ x, y, size }]

    this.roundDuration = 45; // 45 seconds
    this.timerRemaining = 45;
    this.timerInterval = null;

    this.loopRunning = false;
    this.lastTime = 0;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      const p = this.players.find(pl => pl.id === playerId);
      if (!p) return;

      if (action === 'MOVE_INPUT') {
        const speed = (payload.boost ? BASE_SPEED * 1.5 : BASE_SPEED);
        p.vx = (payload.dx || 0) * speed;
        p.vy = (payload.dy || 0) * speed;
      }
    });
  }

  startNewGame() {
    const clients = Array.from(this.session.clients.values());
    if (clients.length < 1) {
      alert('At least 1 player required!');
      return;
    }

    this.players = clients.slice(0, 4).map((c, i) => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      color: COLORS[i % COLORS.length],
      x: 80 + (i % 2) * (ARENA_WIDTH - 160),
      y: 80 + Math.floor(i / 2) * (ARENA_HEIGHT - 160),
      vx: 0,
      vy: 0,
      score: 0
    }));

    // Spawn 5 initial coins
    this.coins = [];
    for (let i = 0; i < 6; i++) this.spawnCoin();

    this.timerRemaining = this.roundDuration;
    this.phase = 'PLAYING';
    this.loopRunning = true;
    this.lastTime = performance.now();

    playRoundStart();
    this.dispatchRoles();
    this.render();

    // Round countdown
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.timerRemaining--;
      if (this.timerRemaining <= 5 && this.timerRemaining > 0) {
        playTick(800 + (5 - this.timerRemaining) * 100);
      }
      if (this.timerRemaining <= 0) {
        clearInterval(this.timerInterval);
        this.endGame();
      }
    }, 1000);

    requestAnimationFrame(this.gameLoop.bind(this));
  }

  spawnCoin() {
    this.coins.push({
      x: 40 + Math.random() * (ARENA_WIDTH - 80),
      y: 40 + Math.random() * (ARENA_HEIGHT - 80),
      size: 14
    });
  }

  dispatchRoles() {
    this.players.forEach(p => {
      this.session.sendPrivateState(p.id, {
        game: 'square-tag',
        color: p.color
      });
    });
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
    this.players.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Arena boundary collision
      p.x = Math.max(0, Math.min(ARENA_WIDTH - PLAYER_SIZE, p.x));
      p.y = Math.max(0, Math.min(ARENA_HEIGHT - PLAYER_SIZE, p.y));

      // Coin collection collision
      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i];
        const dist = Math.hypot(p.x + PLAYER_SIZE / 2 - c.x, p.y + PLAYER_SIZE / 2 - c.y);
        if (dist < PLAYER_SIZE / 2 + c.size / 2) {
          p.score += 10;
          this.coins.splice(i, 1);
          playTick(1200);
          this.spawnCoin();
        }
      }
    });
  }

  drawCanvas() {
    const canvas = document.getElementById('arenaCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Arena Floor
    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // Glowing Arena Border
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, ARENA_WIDTH - 4, ARENA_HEIGHT - 4);

    // Draw Coins / Stars
    this.coins.forEach(c => {
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '12px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', c.x, c.y);
    });

    // Draw Players
    this.players.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, 8);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw avatar
      ctx.font = '16px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.avatar, p.x + PLAYER_SIZE / 2, p.y + PLAYER_SIZE / 2);

      // Name & score above head
      ctx.font = '700 11px Outfit';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${p.name} (${p.score})`, p.x + PLAYER_SIZE / 2, p.y - 8);
    });
  }

  endGame() {
    this.phase = 'GAME_OVER';
    this.loopRunning = false;
    this.players.sort((a, b) => b.score - a.score);
    playVictory();
    this.render();
  }

  render() {
    if (!this.container) return;

    if (this.phase === 'SETUP') {
      const clients = Array.from(this.session.clients.values());
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header">
            <div class="brand-badge"><span class="pulse-dot"></span><span>SQUARE ARENA CLASH</span></div>
            <div class="room-code-display"><span class="code">${this.session.roomCode}</span></div>
          </header>

          <div class="glass-card" style="max-width:800px; margin:0 auto; padding:40px 24px; text-align:center;">
            <div style="font-size:54px; margin-bottom:12px;">🟦</div>
            <h2>Fast P2P Multiplayer Arena Battle</h2>
            <p style="color:var(--text-secondary); margin:12px auto 24px; max-width:550px; line-height:1.5;">
              Based on the <strong>NetplayJS Simple Square Demo</strong>! 2–4 players use their mobile touch D-pads to collect stars and outscore opponents in a frantic 45-second showdown.
            </p>

            <div class="players-roster" style="justify-content:center; margin-bottom:28px;">
              ${clients.slice(0, 4).map((p, i) => `
                <div class="player-chip" style="border:2px solid ${COLORS[i % COLORS.length]};">
                  <span>${p.avatar}</span>
                  <strong>${p.name}</strong>
                </div>
              `).join('')}
            </div>

            <div style="display:flex; justify-content:center; gap:12px;">
              <button class="btn-primary-large" id="btnStartTag" style="max-width:280px;">🚀 Launch Arena</button>
              <button class="btn-secondary" id="btnBackDeck">Back to Party Deck</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnStartTag')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnBackDeck')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    } else if (this.phase === 'PLAYING') {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header" style="padding:10px 24px;">
            <div class="brand-badge"><span class="badge-cat">ARENA CLASH</span></div>
            <div class="central-timer">
              <span class="timer-digits" style="font-size:32px;">⏱️ ${this.timerRemaining}s</span>
            </div>
            <div class="room-code-mini"><button class="btn-icon" id="btnQuitTag">Exit</button></div>
          </header>

          <div style="display:flex; justify-content:center; margin-top:10px;">
            <canvas id="arenaCanvas" width="${ARENA_WIDTH}" height="${ARENA_HEIGHT}" style="border-radius:18px; box-shadow:0 12px 40px rgba(0,0,0,0.8); max-width:100%; border:2px solid rgba(255,255,255,0.1);"></canvas>
          </div>
        </div>
      `;

      document.getElementById('btnQuitTag')?.addEventListener('click', () => {
        this.loopRunning = false;
        clearInterval(this.timerInterval);
        if (this.onReturnToHub) this.onReturnToHub();
      });
    } else if (this.phase === 'GAME_OVER') {
      const winner = this.players[0];
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <div class="glass-card" style="max-width:700px; margin:40px auto; padding:40px 24px; text-align:center;">
            <div style="font-size:54px; margin-bottom:12px;">🏆</div>
            <h1 style="font-family:var(--font-heading); font-size:40px; color:${winner?.color || 'var(--accent-cyan)'}; margin-bottom:12px;">
              ${winner?.name} WINS!
            </h1>
            <p style="font-size:20px; color:#e2e8f0; margin-bottom:28px;">
              Top Score: <strong>${winner?.score || 0} pts</strong>
            </p>

            <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:28px;">
              ${this.players.map((p, i) => `
                <div style="display:flex; justify-content:space-between; padding:10px 16px; background:rgba(255,255,255,0.05); border-radius:10px;">
                  <span>#${i + 1} ${p.avatar} ${p.name}</span>
                  <strong>${p.score} pts</strong>
                </div>
              `).join('')}
            </div>

            <div style="display:flex; justify-content:center; gap:12px;">
              <button class="btn-primary" id="btnRestartTag">Play Again</button>
              <button class="btn-secondary" id="btnHubTag">Back to Party Deck</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnRestartTag')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnHubTag')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    }
  }
}
