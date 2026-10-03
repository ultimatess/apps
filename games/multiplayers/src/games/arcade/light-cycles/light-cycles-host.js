import { playRoundStart, playVictory, playCountdown, playExplosion } from '../../../utils/audio.js';
import { escapeHtml, Disposer } from '../../../utils/ui.js';
import { GRID_W, GRID_H, createGrid, spawnRiders, queueTurn, step, aiTurn, idx } from './light-cycles-logic.js';

const CELL = 10;
const W = GRID_W * CELL;
const H = GRID_H * CELL;
const MAX_RIDERS = 6;
const WINS_NEEDED = 3;
export const CYCLE_COLORS = ['#22d3ee', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c'];

export class LightCyclesHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.roundDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'COUNTDOWN' | 'RACING' | 'ROUND_OVER' | 'MATCH_OVER'
    this.riders = [];
    this.grid = createGrid();
    this.roundWins = {};
    this.roundNumber = 0;
    this.roundWinner = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (action !== 'TURN' || (this.phase !== 'RACING' && this.phase !== 'COUNTDOWN')) return;
      const rider = this.riders.find(r => r.id === playerId);
      if (rider && this.phase === 'RACING') queueTurn(rider, Number(payload.dir));
    });

    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP') this.render();
      this.syncState();
    });

    this.session.on('playerLeave', (player) => {
      const rider = this.riders.find(r => r.id === player.id);
      if (rider && rider.alive && (this.phase === 'RACING' || this.phase === 'COUNTDOWN')) {
        rider.alive = false;
        if (this.phase === 'RACING') this.checkRoundEnd();
      }
    });
  }

  destroy() {
    this.roundDisposer.dispose();
    this.disposer.dispose();
  }

  startMatch() {
    const players = this.session.getPlayers().slice(0, MAX_RIDERS);
    if (!players.length) return;
    this.lineup = players.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, color: CYCLE_COLORS[i], bot: false }));
    if (this.lineup.length === 1) {
      this.lineup.push({ id: 'BOT_1', name: 'Neon Bot', avatar: '🤖', color: CYCLE_COLORS[1], bot: true });
    }
    this.roundWins = {};
    this.lineup.forEach(r => { this.roundWins[r.id] = 0; });
    this.roundNumber = 0;
    this.startRound();
  }

  startRound() {
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    this.roundNumber++;
    // Players who left the room don't get a bike next round.
    this.lineup = this.lineup.filter(r => r.bot || this.session.clients.has(r.id));
    const humans = this.lineup.filter(r => !r.bot);
    if (humans.length === 0) {
      this.phase = 'SETUP';
      this.render();
      this.syncState();
      return;
    }
    if (humans.length === 1 && !this.lineup.some(r => r.bot)) {
      this.lineup.push({ id: 'BOT_1', name: 'Neon Bot', avatar: '🤖', color: CYCLE_COLORS[1], bot: true });
    }
    this.grid = createGrid();
    const spawns = spawnRiders(this.lineup.length);
    this.riders = this.lineup.map((r, i) => ({ ...r, ...spawns[i], index: i }));
    this.riders.forEach(r => { this.grid[idx(r.x, r.y)] = r.index + 1; });
    this.roundWinner = null;
    this.phase = 'COUNTDOWN';
    this.countdown = 3;
    this.tickMs = 85;
    this.elapsedTicks = 0;

    this.syncState();
    this.render();
    this.drawAll();
    playCountdown(false);

    this.roundDisposer.interval(() => {
      if (this.phase !== 'COUNTDOWN') return;
      this.countdown--;
      const el = document.getElementById('cycleCountdown');
      if (this.countdown <= 0) {
        if (el) el.remove();
        playCountdown(true);
        playRoundStart();
        this.phase = 'RACING';
        this.syncState();
        this.scheduleTick();
      } else {
        if (el) el.textContent = String(this.countdown);
        playCountdown(false);
      }
    }, 1000);
  }

  scheduleTick() {
    this.roundDisposer.timeout(() => {
      if (this.phase !== 'RACING') return;
      this.tick();
      if (this.phase === 'RACING') this.scheduleTick();
    }, this.tickMs);
  }

  tick() {
    this.riders.forEach(r => {
      if (r.bot && r.alive && !r.turns.length) {
        const t = aiTurn(this.grid, r);
        if (t) queueTurn(r, t);
      }
    });
    const prevHeads = this.riders.map(r => ({ x: r.x, y: r.y }));
    const crashed = step(this.grid, this.riders);
    this.elapsedTicks++;
    // Speed up every ~6 seconds so rounds never stall.
    if (this.elapsedTicks % 70 === 0) this.tickMs = Math.max(45, this.tickMs - 8);

    this.drawStep(prevHeads, crashed);
    if (crashed.length) {
      playExplosion();
      this.syncState();
      this.checkRoundEnd();
    }
  }

  checkRoundEnd() {
    const alive = this.riders.filter(r => r.alive);
    if (alive.length > 1) return;
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();

    this.roundWinner = alive[0] || null;
    if (this.roundWinner) this.roundWins[this.roundWinner.id] = (this.roundWins[this.roundWinner.id] || 0) + 1;
    const champion = this.lineup.find(r => this.roundWins[r.id] >= WINS_NEEDED);

    if (champion) {
      this.champion = champion;
      this.phase = 'MATCH_OVER';
      playVictory();
    } else {
      this.phase = 'ROUND_OVER';
      // Next round starts on its own so the party keeps moving.
      this.roundDisposer.timeout(() => {
        if (this.phase === 'ROUND_OVER') this.startRound();
      }, 3500);
    }
    this.syncState();
    this.render();
    this.drawAll();
  }

  syncState() {
    this.session.broadcastPublicState({
      game: 'light-cycles',
      phase: this.phase,
      roundNumber: this.roundNumber,
      winsNeeded: WINS_NEEDED,
      roundWinnerId: this.roundWinner?.id || null,
      roundWinnerName: this.roundWinner?.name || null,
      championId: this.champion?.id || null,
      riders: this.riders.map(r => ({ id: r.id, name: r.name, color: r.color, alive: r.alive, wins: this.roundWins[r.id] || 0 })),
      lobby: this.session.getPlayers().slice(0, MAX_RIDERS).map((p, i) => ({ id: p.id, name: p.name, color: CYCLE_COLORS[i] }))
    });
  }

  ctx() {
    return document.getElementById('cycleCanvas')?.getContext('2d') || null;
  }

  drawAll() {
    const ctx = this.ctx();
    if (!ctx) return;
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(34,211,238,0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += CELL * 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += CELL * 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const owner = this.grid[idx(x, y)];
        if (owner) {
          ctx.fillStyle = this.riders[owner - 1]?.color || '#fff';
          ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        }
      }
    }
    this.riders.forEach(r => this.drawHead(ctx, r));
  }

  drawHead(ctx, r) {
    ctx.save();
    ctx.shadowColor = r.color;
    ctx.shadowBlur = r.alive ? 18 : 0;
    ctx.fillStyle = r.alive ? '#ffffff' : '#475569';
    ctx.fillRect(r.x * CELL, r.y * CELL, CELL, CELL);
    ctx.restore();
  }

  drawStep(prevHeads, crashed) {
    const ctx = this.ctx();
    if (!ctx) return;
    this.riders.forEach((r, i) => {
      if (!r.alive && !crashed.includes(i)) return;
      const prev = prevHeads[i];
      ctx.fillStyle = r.color;
      ctx.shadowColor = r.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(prev.x * CELL + 1, prev.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.shadowBlur = 0;
      if (r.alive) this.drawHead(ctx, r);
    });
    crashed.forEach(i => {
      const r = this.riders[i];
      ctx.save();
      ctx.fillStyle = r.color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(r.x * CELL + CELL / 2, r.y * CELL + CELL / 2, CELL * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.drawHead(ctx, r);
    });
    const board = document.getElementById('cycleBoard');
    if (board && crashed.length) board.innerHTML = this.standingsHtml();
  }

  standingsHtml() {
    return this.riders.map(r => `
      <div class="mini-score ${r.alive ? '' : 'out'}" style="border-left:4px solid ${r.color};">
        <span>${r.avatar} ${escapeHtml(r.name)} ${r.alive ? '' : '💥'}</span>
        <strong>${'★'.repeat(this.roundWins[r.id] || 0)}${'☆'.repeat(Math.max(0, WINS_NEEDED - (this.roundWins[r.id] || 0)))}</strong>
      </div>
    `).join('');
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'MATCH_OVER') this.renderMatchOver();
    else this.renderArena();
  }

  renderSetup() {
    const players = this.session.getPlayers();
    const riding = players.slice(0, MAX_RIDERS);
    const benched = players.slice(MAX_RIDERS);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>LIGHT CYCLES</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="glass-card setup-card">
          <div class="setup-icon">🏍️</div>
          <h2>Last rider standing</h2>
          <ul class="rules-list">
            <li>⬅️ ➡️ Tap LEFT or RIGHT on your phone to turn 90°</li>
            <li>🧱 Your bike leaves a neon wall. Don't hit any wall, including your own</li>
            <li>🏆 Survive the round to earn a star. First to ${WINS_NEEDED} stars wins</li>
            <li>⚡ Bikes speed up the longer a round lasts</li>
          </ul>
          <div class="players-roster center">
            ${riding.map((p, i) => `<div class="player-chip" style="border:2px solid ${CYCLE_COLORS[i]};"><span>${p.avatar}</span><strong>${escapeHtml(p.name)}</strong></div>`).join('') || '<p class="muted">Waiting for riders...</p>'}
            ${riding.length === 1 ? '<div class="player-chip" style="border:2px dashed #64748b;"><span>🤖</span><strong>Neon Bot</strong></div>' : ''}
          </div>
          ${benched.length ? `<p class="queue-line">Max ${MAX_RIDERS} riders. Sitting out: ${benched.map(p => escapeHtml(p.name)).join(', ')}</p>` : ''}
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartCycles" ${riding.length ? '' : 'disabled'}>🚀 Start Engines</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnStartCycles')?.addEventListener('click', () => this.startMatch());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderArena() {
    const roundOver = this.phase === 'ROUND_OVER';
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="badge-cat">LIGHT CYCLES</span><span class="round-indicator">ROUND ${this.roundNumber}</span></div>
          <div class="round-indicator">FIRST TO ${WINS_NEEDED} ★</div>
          <button class="btn-icon" id="btnQuitCycles">Exit</button>
        </header>
        <div class="arena-layout">
          <div class="arena-canvas-wrap">
            <canvas id="cycleCanvas" class="arena-canvas" width="${W}" height="${H}"></canvas>
            ${this.phase === 'COUNTDOWN' ? `<div class="arena-overlay big" id="cycleCountdown">${this.countdown}</div>` : ''}
            ${roundOver ? `
              <div class="arena-overlay">
                <div>
                  <h2 style="color:${this.roundWinner?.color || '#fff'};">${this.roundWinner ? `${escapeHtml(this.roundWinner.name)} survives! ★` : 'Total wipeout! No star this round'}</h2>
                  <p class="muted">Next round starting...</p>
                </div>
              </div>
            ` : ''}
          </div>
          <div class="arena-side glass-card" id="cycleBoard">${this.standingsHtml()}</div>
        </div>
      </div>
    `;
    document.getElementById('btnQuitCycles')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderMatchOver() {
    const ranked = [...this.lineup].sort((a, b) => (this.roundWins[b.id] || 0) - (this.roundWins[a.id] || 0));
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title" style="color:${this.champion.color};">${escapeHtml(this.champion.name)} RULES THE GRID!</h1>
          <div class="podium-list">
            ${ranked.map((r, i) => `
              <div class="podium-row ${i === 0 ? 'first' : ''}" style="border-left:4px solid ${r.color};">
                <span>${r.avatar} ${escapeHtml(r.name)}</span><strong>${this.roundWins[r.id] || 0} ★</strong>
              </div>
            `).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnAgainCycles">🔁 New Match</button>
            <button class="btn-secondary" id="btnHubCycles">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnAgainCycles')?.addEventListener('click', () => this.startMatch());
    document.getElementById('btnHubCycles')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
