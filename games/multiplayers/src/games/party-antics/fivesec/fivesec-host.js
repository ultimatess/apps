import { FIVESEC_PROMPTS } from '../../../data/fivesec-prompts.js';
import { playRoundStart, playVictory, playBuzzer, playTick, playCorrect, playWrong } from '../../../utils/audio.js';
import { escapeHtml, shuffle, Disposer } from '../../../utils/ui.js';

const ARM_DELAY_MS = 1500; // time to read the prompt before buzzers go live
const ANSWER_SECONDS = 5;

export class FiveSecHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.roundDisposer = new Disposer();

    this.promptsDeck = shuffle(FIVESEC_PROMPTS);
    this.promptIndex = 0;
    this.currentPrompt = '';
    this.targetScore = 5;

    this.phase = 'SETUP'; // 'SETUP' | 'READING' | 'BUZZER_WAIT' | 'COUNTDOWN' | 'GRADING' | 'GAME_OVER'
    this.activeBuzzerPlayerId = null;
    this.timerRemaining = ANSWER_SECONDS;
    this.scores = {};
    this.lastResult = null;

    this.session.on('playerAction', (playerId, action) => {
      if (action === 'BUZZ_IN' && this.phase === 'BUZZER_WAIT') this.handleBuzzerPress(playerId);
    });
    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP' || this.phase === 'BUZZER_WAIT' || this.phase === 'READING') this.render();
      this.syncState();
    });
  }

  destroy() {
    this.roundDisposer.dispose();
    this.disposer.dispose();
  }

  startNewGame() {
    this.scores = {};
    this.lastResult = null;
    this.winnerId = null;
    this.nextPrompt();
  }

  nextPrompt() {
    this.roundDisposer.dispose();
    this.roundDisposer = new Disposer();
    if (this.promptIndex >= this.promptsDeck.length) {
      this.promptsDeck = shuffle(FIVESEC_PROMPTS);
      this.promptIndex = 0;
    }
    this.currentPrompt = this.promptsDeck[this.promptIndex++];
    this.phase = 'READING';
    this.activeBuzzerPlayerId = null;
    this.timerRemaining = ANSWER_SECONDS;

    playRoundStart();
    this.syncState();
    this.render();
    this.roundDisposer.timeout(() => {
      this.phase = 'BUZZER_WAIT';
      playTick(1400);
      this.syncState();
      this.render();
    }, ARM_DELAY_MS);
  }

  handleBuzzerPress(playerId) {
    if (this.activeBuzzerPlayerId || !this.session.clients.has(playerId)) return;
    this.activeBuzzerPlayerId = playerId;
    this.phase = 'COUNTDOWN';
    this.timerRemaining = ANSWER_SECONDS;
    playBuzzer();
    this.syncState();
    this.render();

    this.roundDisposer.interval(() => {
      if (this.phase !== 'COUNTDOWN') return;
      this.timerRemaining--;
      if (this.timerRemaining > 0) {
        playTick(900 + (ANSWER_SECONDS - this.timerRemaining) * 150);
        const tEl = document.getElementById('fiveSecTimer');
        if (tEl) tEl.textContent = String(this.timerRemaining);
        document.getElementById('fiveSecRing')?.style.setProperty('--pct', String(this.timerRemaining / ANSWER_SECONDS));
        this.syncState();
      } else {
        playBuzzer();
        this.phase = 'GRADING';
        this.syncState();
        this.render();
      }
    }, 1000);
  }

  gradeAnswer(passed) {
    const id = this.activeBuzzerPlayerId;
    if (id) {
      const current = this.scores[id] || 0;
      this.scores[id] = passed ? current + 1 : Math.max(0, current - 1);
      this.lastResult = { name: this.session.clients.get(id)?.name || 'Player', passed };
    }
    if (passed) playCorrect(); else playWrong();

    if (id && this.scores[id] >= this.targetScore) {
      this.phase = 'GAME_OVER';
      this.winnerId = id;
      playVictory();
      this.syncState();
      this.render();
      return;
    }
    this.nextPrompt();
  }

  rankedPlayers() {
    return this.session.getPlayers()
      .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: this.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  syncState() {
    const activePlayer = this.session.clients.get(this.activeBuzzerPlayerId);
    this.session.broadcastPublicState({
      game: 'fivesec',
      phase: this.phase,
      prompt: this.currentPrompt,
      promptNumber: this.promptIndex,
      activeBuzzerPlayerId: this.activeBuzzerPlayerId,
      activeBuzzerPlayerName: activePlayer?.name || null,
      timerRemaining: this.timerRemaining,
      targetScore: this.targetScore,
      lastResult: this.lastResult,
      winnerId: this.winnerId || null,
      players: this.rankedPlayers()
    });
  }

  scoreboardHtml() {
    return `
      <div class="score-strip">
        ${this.rankedPlayers().map((p, i) => `
          <div class="player-chip ${p.id === this.activeBuzzerPlayerId ? 'highlight' : ''}">
            <span>${i === 0 && p.score > 0 ? '👑' : p.avatar}</span>
            <span>${escapeHtml(p.name)}</span>
            <strong class="pts">${p.score}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') {
      this.renderSetup();
      return;
    }
    if (this.phase === 'GAME_OVER') {
      this.renderGameOver();
      return;
    }

    const activePlayer = this.session.clients.get(this.activeBuzzerPlayerId);
    const name = escapeHtml(activePlayer?.name || 'Player');
    let stage = '';

    if (this.phase === 'READING') {
      stage = `<div class="stage-msg"><h3>Read it... buzzers unlock in a moment</h3></div>`;
    } else if (this.phase === 'BUZZER_WAIT') {
      stage = `
        <div class="stage-msg">
          <div class="buzz-live">⚡ BUZZERS LIVE ⚡</div>
          <p class="muted">First to slam their phone buzzer gets ${ANSWER_SECONDS} seconds to name all 3 out loud!</p>
          <button class="btn-link" id="btnSkip">Skip this prompt</button>
        </div>`;
    } else if (this.phase === 'COUNTDOWN') {
      stage = `
        <div class="stage-msg">
          <div class="buzzed-name">🎯 ${activePlayer?.avatar || ''} ${name}</div>
          <div class="ring-timer" id="fiveSecRing" style="--pct:${this.timerRemaining / ANSWER_SECONDS};">
            <span id="fiveSecTimer">${this.timerRemaining}</span>
          </div>
          <p class="muted">Say 3 answers out loud, fast!</p>
        </div>`;
    } else if (this.phase === 'GRADING') {
      stage = `
        <div class="stage-msg">
          <div class="buzzed-name">⏰ Time! Did ${name} name all 3?</div>
          <div class="setup-actions">
            <button class="btn-primary btn-success" id="btnPass">✓ YES (+1)</button>
            <button class="btn-secondary btn-danger-outline" id="btnFail">✗ NO (−1)</button>
          </div>
        </div>`;
    }

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="pulse-dot"></span><span>5-SECOND RULE</span></div>
          <div class="round-indicator">PROMPT #${this.promptIndex} · FIRST TO ${this.targetScore}</div>
          <button class="btn-icon" id="btnBackDeck">Exit</button>
        </header>

        <div class="glass-card prompt-stage">
          ${this.lastResult && (this.phase === 'READING' || this.phase === 'BUZZER_WAIT') ? `<div class="last-result ${this.lastResult.passed ? 'ok' : 'bad'}">${this.lastResult.passed ? '✓' : '✗'} ${escapeHtml(this.lastResult.name)} ${this.lastResult.passed ? 'nailed it' : 'ran out of time'}</div>` : ''}
          <h1 class="prompt-text">${escapeHtml(this.currentPrompt)}</h1>
          ${stage}
          ${this.scoreboardHtml()}
        </div>
      </div>
    `;

    document.getElementById('btnPass')?.addEventListener('click', () => this.gradeAnswer(true));
    document.getElementById('btnFail')?.addEventListener('click', () => this.gradeAnswer(false));
    document.getElementById('btnSkip')?.addEventListener('click', () => this.nextPrompt());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderSetup() {
    const players = this.session.getPlayers();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>5-SECOND RULE</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>
        <div class="glass-card setup-card">
          <div class="setup-icon">⚡</div>
          <h2>Name 3 things in 5 seconds</h2>
          <ul class="rules-list">
            <li>📺 A prompt appears on the TV ("Name 3 yellow fruits")</li>
            <li>📱 Slam the buzzer on your phone first</li>
            <li>🗣️ Shout 3 answers before the clock hits zero</li>
            <li>✅ The host judges: +1 for success, −1 for failure</li>
          </ul>
          <div class="form-group inline-group">
            <label>First to:</label>
            <div class="timer-chips">
              ${[3, 5, 7].map(n => `<button class="chip-btn ${this.targetScore === n ? 'active' : ''}" data-target="${n}">${n} pts</button>`).join('')}
            </div>
          </div>
          <div class="players-roster center">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartFive" ${players.length ? '' : 'disabled'}>🚀 Start</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    this.container.querySelectorAll('[data-target]').forEach(btn => btn.addEventListener('click', () => {
      this.targetScore = Number(btn.dataset.target);
      this.render();
    }));
    document.getElementById('btnStartFive')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderGameOver() {
    const ranked = this.rankedPlayers();
    const winner = this.session.clients.get(this.winnerId);
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title">${escapeHtml(winner?.name || 'Winner')} WINS!</h1>
          <div class="podium-list">
            ${ranked.map((p, i) => `<div class="podium-row ${i === 0 ? 'first' : ''}"><span>${['🥇', '🥈', '🥉'][i] || `#${i + 1}`} ${p.avatar} ${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnAgainFive">🔁 Play Again</button>
            <button class="btn-secondary" id="btnHubFive">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnAgainFive')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnHubFive')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
