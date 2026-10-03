import { TRIVIA_QUESTIONS } from '../../../data/trivia-questions.js';
import { playRoundStart, playVictory, playTick, playCorrect, playGong } from '../../../utils/audio.js';
import { escapeHtml, shuffle, Disposer } from '../../../utils/ui.js';
import { QUESTION_SECONDS, ANSWER_SHAPES, ANSWER_COLORS, scoreAnswer } from './trivia-logic.js';

const AUTO_NEXT_SECONDS = 8;

export class TriviaHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.qDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'QUESTION' | 'REVEAL' | 'FINAL'
    this.totalQuestions = 10;
    this.categoryFilter = 'All';
    this.questions = [];
    this.qIndex = -1;
    this.answers = {}; // playerId -> { choice, ms }
    this.scores = {};
    this.streaks = {};
    this.lastGain = {};

    this.session.on('playerAction', (playerId, action, payload) => {
      if (action !== 'ANSWER' || this.phase !== 'QUESTION' || this.answers[playerId]) return;
      const choice = Number(payload.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
      this.answers[playerId] = { choice, msLeft: Math.max(0, this.deadline - performance.now()) };
      playTick(1200);
      this.renderAnswerCount();
      this.syncState();
      const everyone = this.session.getPlayers().filter(p => p.connected);
      if (everyone.length && everyone.every(p => this.answers[p.id])) this.qDisposer.timeout(() => this.reveal(), 400);
    });

    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP') this.render();
      if (this.phase === 'QUESTION') {
        const everyone = this.session.getPlayers().filter(p => p.connected);
        if (everyone.length && everyone.every(p => this.answers[p.id])) this.qDisposer.timeout(() => this.reveal(), 400);
      }
      this.syncState();
    });
  }

  destroy() {
    this.qDisposer.dispose();
    this.disposer.dispose();
  }

  categories() {
    return ['All', ...new Set(TRIVIA_QUESTIONS.map(q => q.cat))];
  }

  startNewGame() {
    const pool = this.categoryFilter === 'All' ? TRIVIA_QUESTIONS : TRIVIA_QUESTIONS.filter(q => q.cat === this.categoryFilter);
    // Shuffle answer order too, so memorising positions doesn't help on replays.
    this.questions = shuffle(pool).slice(0, this.totalQuestions).map(q => {
      const order = shuffle([0, 1, 2, 3]);
      return { cat: q.cat, q: q.q, a: order.map(i => q.a[i]), c: order.indexOf(q.c) };
    });
    this.qIndex = -1;
    this.scores = {};
    this.streaks = {};
    playRoundStart();
    this.nextQuestion();
  }

  get current() {
    return this.questions[this.qIndex];
  }

  nextQuestion() {
    this.qDisposer.dispose();
    this.qDisposer = new Disposer();
    this.qIndex++;
    if (this.qIndex >= this.questions.length) {
      this.finish();
      return;
    }
    this.phase = 'QUESTION';
    this.answers = {};
    this.lastGain = {};
    this.deadline = performance.now() + QUESTION_SECONDS * 1000;
    this.timeLeft = QUESTION_SECONDS;
    this.syncState();
    this.render();

    this.qDisposer.interval(() => {
      if (this.phase !== 'QUESTION') return;
      this.timeLeft = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
      const el = document.getElementById('triviaTimer');
      if (el) el.textContent = String(this.timeLeft);
      document.getElementById('triviaTimeBar')?.style.setProperty('--pct', String(this.timeLeft / QUESTION_SECONDS));
      if (this.timeLeft <= 3 && this.timeLeft > 0) playTick(800);
      if (this.timeLeft <= 0) this.reveal();
    }, 250);
  }

  reveal() {
    if (this.phase !== 'QUESTION') return;
    this.qDisposer.dispose();
    this.qDisposer = new Disposer();
    this.phase = 'REVEAL';
    const q = this.current;
    let fastest = null;

    this.session.getPlayers().forEach(p => {
      const ans = this.answers[p.id];
      const correct = ans && ans.choice === q.c;
      this.streaks[p.id] = correct ? (this.streaks[p.id] || 0) + 1 : 0;
      const gain = scoreAnswer({ correct, msLeft: ans?.msLeft || 0, msTotal: QUESTION_SECONDS * 1000, streak: this.streaks[p.id] });
      this.lastGain[p.id] = gain;
      this.scores[p.id] = (this.scores[p.id] || 0) + gain;
      if (correct && (!fastest || ans.msLeft > fastest.msLeft)) fastest = { id: p.id, msLeft: ans.msLeft };
    });
    this.fastestId = fastest?.id || null;
    playGong();
    if (fastest) playCorrect();
    this.autoNext = AUTO_NEXT_SECONDS;
    this.syncState();
    this.render();

    this.qDisposer.interval(() => {
      this.autoNext--;
      const el = document.getElementById('autoNext');
      if (el) el.textContent = String(this.autoNext);
      if (this.autoNext <= 0) this.nextQuestion();
    }, 1000);
  }

  finish() {
    this.phase = 'FINAL';
    playVictory();
    this.syncState();
    this.render();
  }

  ranked() {
    return this.session.getPlayers()
      .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: this.scores[p.id] || 0, streak: this.streaks[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  syncState() {
    const q = this.current;
    const ranked = this.ranked();
    this.session.broadcastPublicState({
      game: 'trivia',
      phase: this.phase,
      qNumber: this.qIndex + 1,
      totalQuestions: this.questions.length || this.totalQuestions,
      question: q && this.phase !== 'SETUP' ? { q: q.q, a: q.a, cat: q.cat } : null,
      correct: this.phase === 'REVEAL' ? q.c : null,
      deadlineIn: this.phase === 'QUESTION' ? Math.max(0, this.deadline - performance.now()) : 0,
      answeredIds: Object.keys(this.answers),
      players: ranked.map((p, i) => ({ ...p, rank: i + 1, gain: this.lastGain[p.id] || 0 })),
      fastestId: this.phase === 'REVEAL' ? this.fastestId : null
    });
  }

  renderAnswerCount() {
    const el = document.getElementById('answerCount');
    if (el) el.textContent = `${Object.keys(this.answers).length} / ${this.session.getPlayers().length} answered`;
  }

  render() {
    if (!this.container) return;
    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'QUESTION') this.renderQuestion();
    else if (this.phase === 'REVEAL') this.renderReveal();
    else this.renderFinal();
    document.getElementById('btnExitTrivia')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  header() {
    return `
      <header class="host-header compact">
        <div class="brand-badge"><span class="pulse-dot"></span><span>TRIVIA BLITZ</span></div>
        <div class="round-indicator">QUESTION ${this.qIndex + 1} / ${this.questions.length}</div>
        <button class="btn-icon" id="btnExitTrivia">Exit</button>
      </header>
    `;
  }

  renderSetup() {
    const players = this.session.getPlayers();
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>TRIVIA BLITZ</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>
        <div class="glass-card setup-card">
          <div class="setup-icon">🧠</div>
          <h2>Fastest correct answer wins</h2>
          <ul class="rules-list">
            <li>📺 Questions appear on the TV with 4 colored answers</li>
            <li>📱 Tap the matching color on your phone</li>
            <li>⚡ Faster correct answers score more (up to 1000)</li>
            <li>🔥 Answer streaks earn bonus points</li>
          </ul>
          <div class="form-group inline-group">
            <label>Questions:</label>
            <div class="timer-chips">${[5, 10, 15].map(n => `<button class="chip-btn ${this.totalQuestions === n ? 'active' : ''}" data-total="${n}">${n}</button>`).join('')}</div>
          </div>
          <div class="form-group inline-group">
            <label>Topic:</label>
            <div class="timer-chips wrap">${this.categories().map(c => `<button class="chip-btn ${this.categoryFilter === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>
          </div>
          <div class="players-roster center">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartTrivia" ${players.length ? '' : 'disabled'}>🚀 Start Quiz</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    this.container.querySelectorAll('[data-total]').forEach(b => b.addEventListener('click', () => { this.totalQuestions = Number(b.dataset.total); this.render(); }));
    this.container.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { this.categoryFilter = b.dataset.cat; this.render(); }));
    document.getElementById('btnStartTrivia')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  answersHtml(showResult) {
    const q = this.current;
    const counts = [0, 0, 0, 0];
    Object.values(this.answers).forEach(a => { counts[a.choice]++; });
    return `
      <div class="answer-grid">
        ${q.a.map((text, i) => `
          <div class="answer-tile ${showResult ? (i === q.c ? 'correct' : 'wrong') : ''}" style="--tile:${ANSWER_COLORS[i]};">
            <span class="shape">${ANSWER_SHAPES[i]}</span>
            <span class="text">${escapeHtml(text)}</span>
            ${showResult ? `<span class="count">${counts[i]}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  renderQuestion() {
    const q = this.current;
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header()}
        <div class="glass-card prompt-stage">
          <div class="eyebrow">${escapeHtml(q.cat)}</div>
          <h1 class="prompt-text">${escapeHtml(q.q)}</h1>
          <div class="time-bar" id="triviaTimeBar" style="--pct:1;"><span id="triviaTimer">${this.timeLeft}</span></div>
          ${this.answersHtml(false)}
          <p class="muted" id="answerCount">0 / ${this.session.getPlayers().length} answered</p>
        </div>
      </div>
    `;
  }

  renderReveal() {
    const ranked = this.ranked().slice(0, 5);
    const fastest = this.session.clients.get(this.fastestId);
    const last = this.qIndex + 1 >= this.questions.length;
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header()}
        <div class="glass-card prompt-stage">
          <h2 class="prompt-text small">${escapeHtml(this.current.q)}</h2>
          ${this.answersHtml(true)}
          ${fastest ? `<p class="fastest">⚡ Fastest finger: <strong>${fastest.avatar} ${escapeHtml(fastest.name)}</strong></p>` : '<p class="muted">Nobody got that one! 😅</p>'}
          <div class="podium-list compact">
            ${ranked.map((p, i) => `
              <div class="podium-row ${i === 0 ? 'first' : ''}">
                <span>${i + 1}. ${p.avatar} ${escapeHtml(p.name)} ${p.streak >= 2 ? `<span class="streak">🔥${p.streak}</span>` : ''}</span>
                <strong>${p.score}${this.lastGain[p.id] ? ` <small class="gain">+${this.lastGain[p.id]}</small>` : ''}</strong>
              </div>
            `).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnNextQ">${last ? '🏆 Final Results' : 'Next Question ▶'} <small>(<span id="autoNext">${this.autoNext ?? AUTO_NEXT_SECONDS}</span>)</small></button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnNextQ')?.addEventListener('click', () => this.nextQuestion());
  }

  renderFinal() {
    const ranked = this.ranked();
    const [first, second, third] = ranked;
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="glass-card setup-card wide">
          <div class="setup-icon">🏆</div>
          <h1 class="winner-title">${first ? `${escapeHtml(first.name)} is the Quiz Champion!` : 'Quiz complete'}</h1>
          <div class="podium">
            ${second ? `<div class="podium-step second"><span class="avatar">${second.avatar}</span><strong>${escapeHtml(second.name)}</strong><span>${second.score}</span><div class="step">2</div></div>` : ''}
            ${first ? `<div class="podium-step first"><span class="avatar">${first.avatar}</span><strong>${escapeHtml(first.name)}</strong><span>${first.score}</span><div class="step">1</div></div>` : ''}
            ${third ? `<div class="podium-step third"><span class="avatar">${third.avatar}</span><strong>${escapeHtml(third.name)}</strong><span>${third.score}</span><div class="step">3</div></div>` : ''}
          </div>
          <div class="podium-list compact">${ranked.slice(3).map((p, i) => `<div class="podium-row"><span>${i + 4}. ${p.avatar} ${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnAgainTrivia">🔁 New Quiz</button>
            <button class="btn-secondary" id="btnSetupTrivia">Change Topic</button>
            <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnAgainTrivia')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnSetupTrivia')?.addEventListener('click', () => {
      this.phase = 'SETUP';
      this.syncState();
      this.render();
    });
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
