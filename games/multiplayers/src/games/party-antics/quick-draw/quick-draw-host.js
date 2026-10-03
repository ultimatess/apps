import { playRoundStart, playVictory, playWrong, playCountdown, playExplosion, playTick } from '../../../utils/audio.js';
import { escapeHtml, Disposer } from '../../../utils/ui.js';

const DECOYS = ['DRUM!', 'DRAMA!', 'DREAM!', 'DRAGON!', 'DRIP!', 'DROP!'];
const POINTS = [3, 2, 1];

export const MIN_HUMAN_MS = 80; // faster than this is anticipation, not reaction

/**
 * Pick the reaction time to trust: the phone's own measurement (fair across wifi lag), but
 * bounded by the host clock so a tampered phone can't claim an impossible time.
 */
export function resolveReaction(phoneMs, hostMs, rttMs) {
  const rtt = rttMs || 0;
  const floor = Math.max(1, hostMs - rtt - 40);
  const ceil = hostMs + 60;
  if (!Number.isFinite(phoneMs) || phoneMs <= 0) return Math.max(1, Math.round(hostMs - rtt));
  return Math.round(Math.max(floor, Math.min(ceil, phoneMs)));
}

export class QuickDrawHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.roundDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'WAIT' | 'DECOY' | 'DRAW' | 'RESULT' | 'FINAL'
    this.totalRounds = 5;
    this.round = 0;
    this.scores = {};
    this.best = {}; // playerId -> fastest ms
    this.results = []; // [{ id, ms }]
    this.falseStarts = new Set();

    this.session.on('playerAction', (playerId, action, payload) => {
      if (action !== 'TAP' || !this.session.clients.has(playerId)) return;
      if (this.falseStarts.has(playerId) || this.results.some(r => r.id === playerId)) return;
      if (this.phase === 'WAIT' || this.phase === 'DECOY' || (this.phase === 'DRAW' && payload.early)) {
        this.falseStarts.add(playerId);
        playWrong();
        this.syncState();
        this.renderLive();
        this.checkRoundDone();
      } else if (this.phase === 'DRAW') {
        const hostMs = performance.now() - this.drawAt;
        const rtt = this.session.clients.get(playerId)?.latency || 0;
        const ms = resolveReaction(Number(payload.reactionMs), hostMs, rtt);
        if (ms < MIN_HUMAN_MS) {
          this.falseStarts.add(playerId);
          playWrong();
          this.syncState();
          this.renderLive();
          this.checkRoundDone();
          return;
        }
        this.results.push({ id: playerId, ms });
        this.results.sort((a, b) => a.ms - b.ms);
        if (!this.best[playerId] || ms < this.best[playerId]) this.best[playerId] = ms;
        playTick(1400);
        this.syncState();
        this.renderLive();
        this.checkRoundDone();
      }
    });

    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP') this.render();
      this.syncState();
    });
  }

  destroy() {
    this.roundDisposer.dispose();
    this.disposer.dispose();
  }

  startNewGame() {
    this.round = 0;
    this.scores = {};
    this.best = {};
    playRoundStart();
    this.nextRound();
  }

  nextRound() {
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    this.round++;
    if (this.round > this.totalRounds) {
      this.phase = 'FINAL';
      playVictory();
      this.syncState();
      this.render();
      return;
    }
    this.results = [];
    this.falseStarts = new Set();
    this.decoy = null;
    this.phase = 'WAIT';
    this.syncState();
    this.render();
    playCountdown(false);

    const delay = 2200 + Math.random() * 3800;
    if (Math.random() < 0.4) {
      // A decoy word flashes first: tapping on it is a false start.
      this.roundDisposer.timeout(() => {
        if (this.phase !== 'WAIT') return;
        this.phase = 'DECOY';
        this.decoy = DECOYS[Math.floor(Math.random() * DECOYS.length)];
        playTick(600);
        this.syncState();
        this.render();
        this.roundDisposer.timeout(() => {
          if (this.phase !== 'DECOY') return;
          this.phase = 'WAIT';
          this.syncState();
          this.render();
        }, 900);
      }, delay * 0.55);
      this.roundDisposer.timeout(() => this.fire(), delay + 1400);
    } else {
      this.roundDisposer.timeout(() => this.fire(), delay);
    }
  }

  fire() {
    if (this.phase !== 'WAIT') return;
    this.phase = 'DRAW';
    this.drawAt = performance.now();
    playExplosion();
    playCountdown(true);
    this.syncState();
    this.render();
    // Close the round after 3 seconds even if someone never taps.
    this.roundDisposer.timeout(() => this.endRound(), 3000);
  }

  contestants() {
    return this.session.getPlayers().filter(p => p.connected);
  }

  checkRoundDone() {
    const everyone = this.contestants();
    const doneCount = this.results.length + this.falseStarts.size;
    if (everyone.length && doneCount >= everyone.length) {
      if (this.phase === 'DRAW') this.roundDisposer.timeout(() => this.endRound(), 500);
      else if (this.phase === 'WAIT' || this.phase === 'DECOY') this.endRound(); // everyone jumped the gun
    }
  }

  endRound() {
    if (this.phase === 'RESULT' || this.phase === 'FINAL') return;
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    this.phase = 'RESULT';
    this.results.slice(0, POINTS.length).forEach((r, i) => {
      this.scores[r.id] = (this.scores[r.id] || 0) + POINTS[i];
    });
    this.syncState();
    this.render();
    this.roundDisposer.timeout(() => this.nextRound(), 5000);
  }

  ranked() {
    return this.session.getPlayers()
      .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: this.scores[p.id] || 0, best: this.best[p.id] || null }))
      .sort((a, b) => b.score - a.score || (a.best || 9e9) - (b.best || 9e9));
  }

  syncState() {
    this.session.broadcastPublicState({
      game: 'quick-draw',
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      decoy: this.phase === 'DECOY' ? this.decoy : null,
      results: this.results.map((r, i) => ({ ...r, place: i + 1, name: this.session.clients.get(r.id)?.name || 'Player' })),
      falseStarts: [...this.falseStarts],
      players: this.ranked()
    });
  }

  renderLive() {
    const el = document.getElementById('qdLive');
    if (el) el.innerHTML = this.liveHtml();
  }

  liveHtml() {
    const fs = [...this.falseStarts].map(id => this.session.clients.get(id)).filter(Boolean);
    return `
      ${this.results.map((r, i) => {
        const p = this.session.clients.get(r.id);
        return `<div class="podium-row ${i === 0 ? 'first' : ''}"><span>${['🥇', '🥈', '🥉'][i] || `#${i + 1}`} ${p?.avatar || ''} ${escapeHtml(p?.name || 'Player')}</span><strong>${r.ms} ms</strong></div>`;
      }).join('')}
      ${fs.map(p => `<div class="podium-row bad"><span>💥 ${p.avatar} ${escapeHtml(p.name)}</span><strong>FALSE START</strong></div>`).join('')}
    `;
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') return this.renderSetup();
    if (this.phase === 'FINAL') return this.renderFinal();

    const big = {
      WAIT: '<div class="qd-big wait">WAIT FOR IT...</div>',
      DECOY: `<div class="qd-big decoy">${escapeHtml(this.decoy || '')}</div>`,
      DRAW: '<div class="qd-big draw">DRAW!</div>',
      RESULT: `<div class="qd-big result">${this.results[0] ? `${escapeHtml(this.session.clients.get(this.results[0].id)?.name || '')} wins the round!` : 'Nobody drew in time!'}</div>`
    }[this.phase];

    this.container.innerHTML = `
      <div class="host-screen-wrapper qd-screen phase-${this.phase.toLowerCase()}">
        <header class="host-header compact">
          <div class="brand-badge"><span class="pulse-dot"></span><span>QUICK DRAW</span></div>
          <div class="round-indicator">ROUND ${this.round} / ${this.totalRounds}</div>
          <button class="btn-icon" id="btnExitQD">Exit</button>
        </header>
        <div class="qd-stage">
          ${big}
          <p class="muted">${this.phase === 'RESULT' ? 'Next round in a moment...' : 'Tap your phone the instant you see DRAW! Tapping early or on a fake word is a false start.'}</p>
          <div class="podium-list compact" id="qdLive">${this.liveHtml()}</div>
        </div>
      </div>
    `;
    document.getElementById('btnExitQD')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderSetup() {
    const players = this.session.getPlayers();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>QUICK DRAW SHOWDOWN</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>
        <div class="glass-card setup-card">
          <div class="setup-icon">🤠</div>
          <h2>Fastest draw in the room</h2>
          <ul class="rules-list">
            <li>⏳ The TV says <strong>WAIT FOR IT...</strong></li>
            <li>💥 When it flashes <strong>DRAW!</strong>, tap your phone as fast as you can</li>
            <li>🚫 Tap early, or on a trick word like "DRUM!", and you're out for the round</li>
            <li>🏅 Fastest 3 score 3, 2 and 1 points</li>
          </ul>
          <div class="form-group inline-group">
            <label>Rounds:</label>
            <div class="timer-chips">${[3, 5, 8].map(n => `<button class="chip-btn ${this.totalRounds === n ? 'active' : ''}" data-total="${n}">${n}</button>`).join('')}</div>
          </div>
          <div class="players-roster center">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartQD" ${players.length ? '' : 'disabled'}>🚀 Start Showdown</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    this.container.querySelectorAll('[data-total]').forEach(b => b.addEventListener('click', () => { this.totalRounds = Number(b.dataset.total); this.render(); }));
    document.getElementById('btnStartQD')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderFinal() {
    const ranked = this.ranked();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title">${ranked[0] ? `${escapeHtml(ranked[0].name)} is the fastest in the room!` : 'Showdown over'}</h1>
          <div class="podium-list">
            ${ranked.map((p, i) => `<div class="podium-row ${i === 0 ? 'first' : ''}"><span>${['🥇', '🥈', '🥉'][i] || `#${i + 1}`} ${p.avatar} ${escapeHtml(p.name)}</span><strong>${p.score} pts${p.best ? ` · best ${p.best} ms` : ''}</strong></div>`).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnAgainQD">🔁 Play Again</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnAgainQD')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
