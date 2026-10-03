import { FIVESEC_PROMPTS } from '../../../data/fivesec-prompts.js';
import { playRoundStart, playVictory, playBuzzer, playTick } from '../../../utils/audio.js';

export class FiveSecHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.promptsDeck = [...FIVESEC_PROMPTS].sort(() => 0.5 - Math.random());
    this.promptIndex = 0;
    this.currentPrompt = '';

    this.phase = 'BUZZER_WAIT'; // 'BUZZER_WAIT' | 'COUNTDOWN' | 'GRADING'
    this.activeBuzzerPlayerId = null;
    this.timerRemaining = 5;
    this.timerInterval = null;

    this.scores = {}; // playerId -> score

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      if (this.phase === 'BUZZER_WAIT' && action === 'BUZZ_IN') {
        this.handleBuzzerPress(playerId);
      }
    });
  }

  startNewGame() {
    this.promptIndex = 0;
    this.scores = {};
    this.nextPrompt();
  }

  nextPrompt() {
    if (this.promptIndex >= this.promptsDeck.length) {
      this.promptsDeck = [...FIVESEC_PROMPTS].sort(() => 0.5 - Math.random());
      this.promptIndex = 0;
    }

    this.currentPrompt = this.promptsDeck[this.promptIndex++];
    this.phase = 'BUZZER_WAIT';
    this.activeBuzzerPlayerId = null;
    this.timerRemaining = 5;
    clearInterval(this.timerInterval);

    playRoundStart();
    this.syncState();
    this.render();
  }

  handleBuzzerPress(playerId) {
    if (this.activeBuzzerPlayerId) return; // already locked
    this.activeBuzzerPlayerId = playerId;
    this.phase = 'COUNTDOWN';
    this.timerRemaining = 5;

    this.syncState();
    this.render();

    // 5-second countdown with ticking
    this.timerInterval = setInterval(() => {
      this.timerRemaining--;
      if (this.timerRemaining > 0) {
        playTick(900 + (5 - this.timerRemaining) * 150);
      }
      const tEl = document.getElementById('fiveSecTimer');
      if (tEl) tEl.textContent = `0${this.timerRemaining}`;

      if (this.timerRemaining <= 0) {
        clearInterval(this.timerInterval);
        playBuzzer();
        this.phase = 'GRADING';
        this.syncState();
        this.render();
      }
    }, 1000);
  }

  gradeAnswer(passed) {
    if (this.activeBuzzerPlayerId) {
      const current = this.scores[this.activeBuzzerPlayerId] || 0;
      this.scores[this.activeBuzzerPlayerId] = passed ? current + 1 : Math.max(0, current - 1);
    }
    if (passed) playVictory();
    this.nextPrompt();
  }

  syncState() {
    const activePlayer = this.session.clients.get(this.activeBuzzerPlayerId);
    const players = Array.from(this.session.clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: this.scores[p.id] || 0
    }));

    this.session.broadcastPublicState({
      game: 'fivesec',
      phase: this.phase,
      prompt: this.currentPrompt,
      activeBuzzerPlayerId: this.activeBuzzerPlayerId,
      activeBuzzerPlayerName: activePlayer?.name || null,
      timerRemaining: this.timerRemaining,
      players
    });
  }

  render() {
    if (!this.container) return;

    const activePlayer = this.session.clients.get(this.activeBuzzerPlayerId);
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>5-SECOND RULE</span></div>
          <div class="round-indicator">PROMPT #${this.promptIndex}</div>
          <div class="room-code-mini"><button class="btn-icon" id="btnBackDeck">Exit</button></div>
        </header>

        <div class="glass-card" style="text-align:center; padding:40px 24px; max-width:850px; margin:0 auto; width:100%;">
          <div style="font-size:13px; font-weight:800; color:var(--accent-emerald); letter-spacing:2px; margin-bottom:12px;">
            QUICK THINKING & BUZZER
          </div>
          <h1 style="font-size:clamp(26px, 4vw, 40px); font-family:var(--font-heading); margin-bottom:30px;">
            "${this.currentPrompt}"
          </h1>

          ${this.phase === 'BUZZER_WAIT' ? `
            <div style="padding:30px 0;">
              <div class="radar-scan" style="margin:0 auto 16px;"></div>
              <h3>Waiting for someone to slam the buzzer on their phone!</h3>
              <p style="color:var(--text-muted); font-size:14px; margin-top:6px;">Whoever buzzes first gets 5 seconds to answer 3 items!</p>
            </div>
          ` : `
            <div style="margin-bottom:24px;">
              <div style="font-size:20px; font-weight:800; color:var(--accent-cyan); margin-bottom:12px;">
                🎯 ${activePlayer?.name || 'Player'} BUZZED IN!
              </div>
              <div class="timer-box" style="display:inline-block; padding:12px 36px; border-color:${this.timerRemaining <= 2 ? 'var(--accent-rose)' : 'var(--accent-emerald)'};">
                <span class="timer-digits" id="fiveSecTimer" style="font-size:54px;">0${this.timerRemaining}</span>
              </div>
            </div>
          `}

          ${this.phase === 'GRADING' ? `
            <div style="margin-top:20px;">
              <p style="font-size:16px; margin-bottom:14px;">Did ${activePlayer?.name} successfully name all 3 before the buzzer?</p>
              <div style="display:flex; justify-content:center; gap:16px;">
                <button class="btn-primary" id="btnPass" style="background:linear-gradient(135deg, #10b981, #059669); padding:14px 28px;">
                  ✓ PASS (+1 Point)
                </button>
                <button class="btn-secondary" id="btnFail" style="padding:14px 28px;">
                  ✗ FAIL (0 Points)
                </button>
              </div>
            </div>
          ` : ''}

          <!-- Scoreboard -->
          <div style="margin-top:36px; border-top:1px solid rgba(255,255,255,0.08); padding-top:20px;">
            <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
              ${players.map(p => `
                <div class="player-chip">
                  <span>${p.avatar}</span>
                  <span>${p.name}:</span>
                  <strong style="color:var(--accent-amber);">${this.scores[p.id] || 0} pts</strong>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnPass')?.addEventListener('click', () => this.gradeAnswer(true));
    document.getElementById('btnFail')?.addEventListener('click', () => this.gradeAnswer(false));
    document.getElementById('btnBackDeck')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }
}
