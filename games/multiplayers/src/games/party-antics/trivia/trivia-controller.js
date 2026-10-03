import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader } from '../../../utils/ui.js';
import { ANSWER_SHAPES, ANSWER_COLORS } from './trivia-logic.js';

export class TriviaController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.myChoice = null;
    this.qKey = null;

    this.session.on('stateUpdate', (state) => {
      const key = `${state.qNumber}-${state.question?.q}`;
      if (key !== this.qKey) {
        this.qKey = key;
        this.myChoice = null;
        if (state.phase === 'QUESTION') vibrate([30]);
      }
      const prevPhase = this.publicState?.phase;
      this.publicState = state;
      if (state.phase === 'QUESTION' && prevPhase === 'QUESTION' && this.container.querySelector('.answer-pad, .vote-confirmed')) return;
      if (state.phase === 'REVEAL' && prevPhase !== 'REVEAL') {
        const me = this.me();
        vibrate(me?.gain ? [60, 40, 60] : [200]);
      }
      this.render();
    });
  }

  me() {
    return (this.publicState?.players || []).find(p => p.id === this.session.playerId) || null;
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const me = this.me();
    const right = me ? `${me.score} pts · #${me.rank}` : '';

    let inner;
    if (!s || s.phase === 'SETUP') {
      inner = `<div class="glass-card lobby-wait-card"><h2>🧠 Trivia Blitz</h2><p class="subtitle">Questions show on the TV. Tap the matching color here, fast!</p></div>`;
    } else if (s.phase === 'QUESTION') {
      const answered = this.myChoice !== null || (s.answeredIds || []).includes(this.session.playerId);
      inner = answered ? `
        <div class="vote-confirmed">
          <span class="check" style="background:${ANSWER_COLORS[this.myChoice] || '#64748b'};">${ANSWER_SHAPES[this.myChoice] || '✓'}</span>
          <h3>Answer locked in!</h3>
          <p>Fingers crossed...</p>
        </div>
      ` : `
        <p class="phone-question">${escapeHtml(s.question.q)}</p>
        <div class="answer-pad">
          ${s.question.a.map((text, i) => `
            <button class="answer-btn" data-choice="${i}" style="--tile:${ANSWER_COLORS[i]};">
              <span class="shape">${ANSWER_SHAPES[i]}</span><span class="text">${escapeHtml(text)}</span>
            </button>
          `).join('')}
        </div>
      `;
    } else if (s.phase === 'REVEAL') {
      const correct = this.myChoice === s.correct || (me?.gain || 0) > 0;
      const skipped = this.myChoice === null && !(me?.gain);
      inner = `
        <div class="glass-card lobby-wait-card result-card ${correct ? 'ok' : 'bad'}">
          <div class="big-emoji">${correct ? '✅' : skipped ? '⌛' : '❌'}</div>
          <h2>${correct ? `+${me?.gain || 0} points!` : skipped ? 'Too slow!' : 'Not quite!'}</h2>
          <p class="subtitle">Answer: <strong>${escapeHtml(s.question.a[s.correct])}</strong></p>
          ${me?.streak >= 2 ? `<p class="streak">🔥 ${me.streak} in a row!</p>` : ''}
          ${s.fastestId === this.session.playerId ? '<p class="fastest">⚡ Fastest finger!</p>' : ''}
          <p class="hint-text">You're #${me?.rank || '-'} with ${me?.score || 0} points</p>
        </div>
      `;
    } else {
      const won = me?.rank === 1;
      inner = `<div class="glass-card lobby-wait-card"><div class="big-emoji">${won ? '🏆' : ['🥇', '🥈', '🥉'][(me?.rank || 0) - 1] || '🎉'}</div><h2>${won ? 'Quiz Champion!' : `You finished #${me?.rank || '-'}`}</h2><p class="subtitle">${me?.score || 0} points</p></div>`;
    }

    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right || undefined)}
        <div class="controller-body">${inner}</div>
      </div>
    `;

    this.container.querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.myChoice !== null) return;
        this.myChoice = Number(btn.dataset.choice);
        vibrate([40]);
        this.session.sendAction('ANSWER', { choice: this.myChoice });
        this.render();
      });
    });
  }
}
