import { playRoundStart, playVictory, playTick, playCountdown, playExplosion } from '../../../utils/audio.js';
import { escapeHtml, Disposer } from '../../../utils/ui.js';

const W = 960;
const H = 560;
const SIZE = 34;
const SPEED = 250;
const BOOST_MULT = 1.75;
const ROUND_SECONDS = 60;
const MAX_PLAYERS = 6;
const STEAL = 15;

export const TAG_COLORS = ['#06b6d4', '#ec4899', '#a855f7', '#10b981', '#f59e0b', '#ef4444'];

export class SquareTagHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.roundDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'COUNTDOWN' | 'PLAYING' | 'GAME_OVER'
    this.players = [];
    this.stars = [];
    this.popups = [];
    this.timerRemaining = ROUND_SECONDS;
    this.frame = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (action !== 'MOVE_INPUT') return;
      const p = this.players.find(pl => pl.id === playerId);
      if (!p) return;
      const clamp = (v) => (Number.isFinite(Number(v)) ? Math.max(-1, Math.min(1, Number(v))) : 0);
      let x = clamp(payload.x);
      let y = clamp(payload.y);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      p.inputX = x;
      p.inputY = y;
      p.wantsBoost = !!payload.boost;
    });

    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP') this.render();
      this.syncState();
    });

    // A dropped phone must not leave its square charging around on the last input.
    this.session.on('playerDisconnect', (player) => {
      const p = this.players.find(pl => pl.id === player.id);
      if (p) { p.inputX = 0; p.inputY = 0; p.wantsBoost = false; }
    });
    this.session.on('playerLeave', (player) => {
      this.players = this.players.filter(pl => pl.id !== player.id);
    });
  }

  destroy() {
    this.stopLoop();
    this.roundDisposer.dispose();
    this.disposer.dispose();
  }

  startNewGame() {
    const clients = this.session.getPlayers().slice(0, MAX_PLAYERS);
    if (!clients.length) return;

    const spawn = [[0.12, 0.18], [0.88, 0.82], [0.88, 0.18], [0.12, 0.82], [0.5, 0.12], [0.5, 0.88]];
    this.players = clients.map((c, i) => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      color: TAG_COLORS[i % TAG_COLORS.length],
      x: spawn[i][0] * (W - SIZE),
      y: spawn[i][1] * (H - SIZE),
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      wantsBoost: false,
      energy: 1,
      score: 0,
      stunUntil: 0,
      steals: 0
    }));

    this.stars = [];
    for (let i = 0; i < 7; i++) this.spawnStar();
    this.popups = [];
    this.timerRemaining = ROUND_SECONDS;
    this.phase = 'COUNTDOWN';
    this.countdown = 3;

    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    this.syncState();
    this.render();
    this.startLoop();
    playCountdown(false);

    this.roundDisposer.interval(() => {
      if (this.phase === 'COUNTDOWN') {
        this.countdown--;
        if (this.countdown <= 0) {
          this.phase = 'PLAYING';
          playCountdown(true);
          playRoundStart();
          this.syncState();
        } else {
          playCountdown(false);
        }
        return;
      }
      if (this.phase !== 'PLAYING') return;
      this.timerRemaining--;
      if (this.timerRemaining <= 10 && this.timerRemaining > 0) playTick(800 + (10 - this.timerRemaining) * 60);
      if (this.timerRemaining % 12 === 0 && this.timerRemaining > 0) this.spawnStar(true);
      this.updateHud();
      this.syncState();
      if (this.timerRemaining <= 0) this.endGame();
    }, 1000);
  }

  spawnStar(big = false) {
    this.stars.push({
      x: 40 + Math.random() * (W - 80),
      y: 40 + Math.random() * (H - 80),
      r: big ? 16 : 10,
      value: big ? 30 : 10,
      big,
      born: performance.now()
    });
  }

  startLoop() {
    this.stopLoop();
    this.lastTime = performance.now();
    const loop = (t) => {
      if (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN') return;
      const dt = Math.min((t - this.lastTime) / 1000, 0.05);
      this.lastTime = t;
      if (this.phase === 'PLAYING') this.update(dt, t);
      this.draw(t);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  update(dt, now) {
    const doubleTime = this.timerRemaining <= 10;

    this.players.forEach(p => {
      const stunned = now < p.stunUntil;
      p.boosting = p.wantsBoost && p.energy > 0.05 && !stunned;
      p.energy = p.boosting ? Math.max(0, p.energy - dt * 0.7) : Math.min(1, p.energy + dt * 0.22);
      const speed = stunned ? 0 : SPEED * (p.boosting ? BOOST_MULT : 1);
      // Smooth acceleration feels much better than instant velocity changes.
      const ax = p.inputX * speed;
      const ay = p.inputY * speed;
      const k = Math.min(1, dt * 10);
      p.vx += (ax - p.vx) * k;
      p.vy += (ay - p.vy) * k;
      p.x = Math.max(0, Math.min(W - SIZE, p.x + p.vx * dt));
      p.y = Math.max(0, Math.min(H - SIZE, p.y + p.vy * dt));

      for (let i = this.stars.length - 1; i >= 0; i--) {
        const s = this.stars[i];
        if (Math.hypot(p.x + SIZE / 2 - s.x, p.y + SIZE / 2 - s.y) < SIZE / 2 + s.r) {
          const value = s.value * (doubleTime ? 2 : 1);
          p.score += value;
          this.popups.push({ x: s.x, y: s.y, text: `+${value}`, color: '#facc15', born: now });
          this.stars.splice(i, 1);
          playTick(s.big ? 1500 : 1200);
          if (!s.big) this.spawnStar();
        }
      }
    });

    // Ramming: a boosting square steals points from anyone it hits.
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i];
        const b = this.players[j];
        const dx = (b.x - a.x);
        const dy = (b.y - a.y);
        if (Math.abs(dx) >= SIZE || Math.abs(dy) >= SIZE) continue;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        // Separate the pair and knock them apart.
        const push = Math.max(0, (SIZE - dist) / 2) + 1;
        a.x = Math.max(0, Math.min(W - SIZE, a.x - nx * push));
        a.y = Math.max(0, Math.min(H - SIZE, a.y - ny * push));
        b.x = Math.max(0, Math.min(W - SIZE, b.x + nx * push));
        b.y = Math.max(0, Math.min(H - SIZE, b.y + ny * push));

        const ram = (attacker, victim, dirX, dirY) => {
          if (now < victim.stunUntil) return;
          const stolen = Math.min(STEAL, victim.score);
          victim.score -= stolen;
          attacker.score += stolen;
          attacker.steals++;
          victim.stunUntil = now + 900;
          victim.vx = dirX * 700;
          victim.vy = dirY * 700;
          this.popups.push({ x: victim.x + SIZE / 2, y: victim.y, text: stolen ? `-${stolen}` : 'BONK!', color: '#f87171', born: now });
          playExplosion();
        };
        if (a.boosting && !b.boosting) ram(a, b, nx, ny);
        else if (b.boosting && !a.boosting) ram(b, a, -nx, -ny);
        else {
          a.vx -= nx * 260; a.vy -= ny * 260;
          b.vx += nx * 260; b.vy += ny * 260;
        }
      }
    }

    this.popups = this.popups.filter(pp => now - pp.born < 900);
  }

  draw(now) {
    const canvas = document.getElementById('arenaCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(139,92,246,0.10)';
    ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = this.timerRemaining <= 10 && this.phase === 'PLAYING' ? 'rgba(250,204,21,0.8)' : 'rgba(139,92,246,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    this.stars.forEach(s => {
      const pulse = 1 + Math.sin((now - s.born) / 200) * 0.12;
      ctx.fillStyle = s.big ? '#fde047' : '#f59e0b';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = s.big ? 26 : 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = `${s.big ? 20 : 13}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', s.x, s.y + 1);
    });

    this.players.forEach(p => {
      const stunned = now < p.stunUntil;
      ctx.globalAlpha = stunned && Math.floor(now / 90) % 2 ? 0.4 : 1;
      if (p.boosting) {
        ctx.fillStyle = `${p.color}55`;
        ctx.beginPath();
        ctx.roundRect(p.x - p.vx * 0.04, p.y - p.vy * 0.04, SIZE, SIZE, 10);
        ctx.fill();
      }
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.boosting ? 30 : 14;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, SIZE, SIZE, 10);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.avatar, p.x + SIZE / 2, p.y + SIZE / 2 + 1);

      ctx.font = '700 13px Outfit, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${p.name} · ${p.score}`, p.x + SIZE / 2, p.y - 12);
      // energy bar
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(p.x, p.y + SIZE + 5, SIZE, 4);
      ctx.fillStyle = p.energy > 0.3 ? '#facc15' : '#f87171';
      ctx.fillRect(p.x, p.y + SIZE + 5, SIZE * p.energy, 4);
    });

    this.popups.forEach(pp => {
      const age = (now - pp.born) / 900;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = pp.color;
      ctx.font = '800 22px Outfit, sans-serif';
      ctx.fillText(pp.text, pp.x, pp.y - age * 40);
      ctx.globalAlpha = 1;
    });

    if (this.phase === 'COUNTDOWN') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '900 140px Outfit, sans-serif';
      ctx.fillText(String(this.countdown), W / 2, H / 2);
    }
  }

  updateHud() {
    const t = document.getElementById('tagTimer');
    if (t) {
      t.textContent = `${this.timerRemaining}s`;
      t.classList.toggle('danger', this.timerRemaining <= 10);
    }
    const board = document.getElementById('tagBoard');
    if (board) board.innerHTML = this.leaderboardHtml();
    const banner = document.getElementById('tagBanner');
    if (banner) banner.textContent = this.timerRemaining <= 10 ? '⚡ FINAL 10 SECONDS: DOUBLE STAR POINTS!' : 'Grab ⭐ stars · Turbo-ram rivals to steal points';
  }

  leaderboardHtml() {
    return [...this.players].sort((a, b) => b.score - a.score).map((p, i) => `
      <div class="mini-score" style="border-left:4px solid ${p.color};">
        <span>${i === 0 ? '👑' : `#${i + 1}`} ${p.avatar} ${escapeHtml(p.name)}</span><strong>${p.score}</strong>
      </div>
    `).join('');
  }

  endGame() {
    this.phase = 'GAME_OVER';
    this.stopLoop();
    this.roundDisposer.dispose();
    playVictory();
    this.syncState();
    this.render();
  }

  syncState() {
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    this.session.broadcastPublicState({
      game: 'square-tag',
      phase: this.phase,
      timerRemaining: this.timerRemaining,
      players: this.players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score,
        rank: ranked.findIndex(r => r.id === p.id) + 1
      })),
      lobby: this.session.getPlayers().slice(0, MAX_PLAYERS).map((p, i) => ({ id: p.id, name: p.name, color: TAG_COLORS[i] }))
    });
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'GAME_OVER') this.renderGameOver();
    else this.renderArena();
  }

  renderSetup() {
    const clients = this.session.getPlayers();
    const playing = clients.slice(0, MAX_PLAYERS);
    const benched = clients.slice(MAX_PLAYERS);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>SQUARE ARENA CLASH</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="glass-card setup-card">
          <div class="setup-icon">🟦</div>
          <h2>60-second star scramble</h2>
          <ul class="rules-list">
            <li>🕹️ Steer with the thumb joystick on your phone</li>
            <li>⭐ Grab stars for points. Big stars are worth 30</li>
            <li>⚡ Hold <strong>TURBO</strong> and ram rivals to steal ${STEAL} points</li>
            <li>🔥 Final 10 seconds: double points!</li>
          </ul>

          <div class="players-roster center">
            ${playing.map((p, i) => `
              <div class="player-chip" style="border:2px solid ${TAG_COLORS[i]};"><span>${p.avatar}</span><strong>${escapeHtml(p.name)}</strong></div>
            `).join('') || '<p class="muted">Waiting for players to join...</p>'}
          </div>
          ${benched.length ? `<p class="queue-line">Arena holds ${MAX_PLAYERS}. Sitting out: ${benched.map(p => escapeHtml(p.name)).join(', ')}</p>` : ''}

          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartTag" ${playing.length ? '' : 'disabled'}>🚀 Launch Arena</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnStartTag')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderArena() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="badge-cat">ARENA CLASH</span></div>
          <div class="central-timer"><span class="timer-digits" id="tagTimer">${this.timerRemaining}s</span></div>
          <button class="btn-icon" id="btnQuitTag">Exit</button>
        </header>
        <p class="arena-banner" id="tagBanner">Grab ⭐ stars · Turbo-ram rivals to steal points</p>
        <div class="arena-layout">
          <canvas id="arenaCanvas" class="arena-canvas" width="${W}" height="${H}"></canvas>
          <div class="arena-side glass-card" id="tagBoard">${this.leaderboardHtml()}</div>
        </div>
      </div>
    `;

    document.getElementById('btnQuitTag')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderGameOver() {
    const ranked = [...this.players].sort((a, b) => b.score - a.score);
    const winner = ranked[0];
    const tie = ranked[1] && ranked[1].score === winner.score;
    const thief = [...this.players].sort((a, b) => b.steals - a.steals)[0];

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title" style="color:${winner?.color};">${tie ? "IT'S A TIE!" : `${escapeHtml(winner?.name)} WINS!`}</h1>
          <div class="podium-list">
            ${ranked.map((p, i) => `
              <div class="podium-row ${i === 0 ? 'first' : ''}" style="border-left:4px solid ${p.color};">
                <span>${['🥇', '🥈', '🥉'][i] || `#${i + 1}`} ${p.avatar} ${escapeHtml(p.name)}</span>
                <strong>${p.score} pts</strong>
              </div>
            `).join('')}
          </div>
          ${thief && thief.steals > 0 ? `<p class="muted">🦹 Most rams: ${escapeHtml(thief.name)} (${thief.steals})</p>` : ''}
          <div class="setup-actions">
            <button class="btn-primary" id="btnRestartTag">🔁 Play Again</button>
            <button class="btn-secondary" id="btnHubTag">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnRestartTag')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnHubTag')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
