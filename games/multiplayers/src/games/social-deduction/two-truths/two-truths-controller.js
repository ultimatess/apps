import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader, toast } from '../../../utils/ui.js';

const LETTERS = ['A', 'B', 'C'];
const DRAFT_KEY = 'np_two_truths_draft';
const IDEAS = [
  'I have met a famous celebrity', 'I can speak 3 languages', 'I have never seen the sea',
  'I broke a bone as a kid', 'I once won a cooking contest', 'I have been on TV',
  "I've eaten 10 idlis in one sitting", 'I was born in a different country', 'I can juggle',
  'I have a hidden tattoo', 'I once got lost in a mall for hours', 'I have climbed a mountain',
  'I sleepwalk', 'I have never ridden a bicycle', 'I hate chocolate'
];

export class TwoTruthsController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.myVote = null;
    this.turnKey = null;
    this.draft = this.loadDraft();

    this.session.on('stateUpdate', (state) => {
      const key = `${state.phase === 'VOTING' || state.phase === 'REVEAL' ? state.turnNumber : 'x'}`;
      if (key !== this.turnKey) {
        this.turnKey = key;
        this.myVote = null;
        if (state.phase === 'VOTING') vibrate([40]);
      }
      const prevPhase = this.publicState?.phase;
      if (state.phase === 'WRITING' && prevPhase && prevPhase !== 'WRITING') {
        this.draft = { statements: ['', '', ''], lieIndex: null };
        this.saveDraft();
      }
      this.publicState = state;
      // Never rebuild the form while someone is typing.
      if (state.phase === 'WRITING' && prevPhase === 'WRITING' && this.container.querySelector('#ttForm') && !(state.submittedIds || []).includes(this.session.playerId)) return;
      if (state.phase === 'VOTING' && prevPhase === 'VOTING' && this.container.querySelector('.lie-pad, .vote-confirmed')) return;
      this.render();
    });
  }

  loadDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || { statements: ['', '', ''], lieIndex: null };
    } catch (e) {
      return { statements: ['', '', ''], lieIndex: null };
    }
  }

  saveDraft() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(this.draft)); } catch (e) { /* ignore */ }
  }

  me() {
    return (this.publicState?.players || []).find(p => p.id === this.session.playerId);
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right || undefined)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const me = this.me();
    const right = me && s?.phase !== 'SETUP' && s?.phase !== 'WRITING' ? `${me.score} pts` : '';

    if (!s || s.phase === 'SETUP') {
      this.shell(right, `<div class="glass-card lobby-wait-card"><h2>🤥 Two Truths & a Lie</h2><p class="subtitle">Start thinking of 2 surprising truths and 1 believable lie about yourself...</p></div>`);
      return;
    }

    if (s.phase === 'WRITING') {
      const submitted = (s.submittedIds || []).includes(this.session.playerId);
      if (submitted) {
        this.shell(right, `<div class="vote-confirmed"><span class="check">✓</span><h3>Statements locked in!</h3><p>Waiting for everyone else to finish writing...</p></div>`);
        return;
      }
      this.renderForm();
      return;
    }

    const isAuthor = s.authorId === this.session.playerId;

    if (s.phase === 'VOTING') {
      if (isAuthor) {
        this.shell(right, `<div class="glass-card lobby-wait-card"><div class="big-emoji">😐</div><h2>It's your turn on the TV!</h2><p class="subtitle">Keep a poker face while everyone votes on your lie...</p></div>`);
        return;
      }
      if (!(s.players || []).some(p => p.id === this.session.playerId)) return;
      const voted = this.myVote !== null || (s.votedIds || []).includes(this.session.playerId);
      this.shell(right, voted ? `
        <div class="vote-confirmed"><span class="check">${this.myVote !== null ? LETTERS[this.myVote] : '✓'}</span><h3>Vote locked in!</h3><p>Let's see if you caught ${escapeHtml(s.authorName)}...</p></div>
      ` : `
        <h3 class="phone-question">Which is ${escapeHtml(s.authorName)}'s lie?</h3>
        <div class="lie-pad">
          ${s.statements.map((t, i) => `<button class="lie-btn" data-choice="${i}"><span class="letter">${LETTERS[i]}</span><span class="text">${escapeHtml(t)}</span></button>`).join('')}
        </div>
      `);
      this.container.querySelectorAll('.lie-btn').forEach(btn => btn.addEventListener('click', () => {
        this.myVote = Number(btn.dataset.choice);
        vibrate([40]);
        this.session.sendAction('VOTE_LIE', { choice: this.myVote });
        this.render();
      }));
      return;
    }

    if (s.phase === 'REVEAL') {
      const myChoice = s.votes?.[this.session.playerId];
      const correct = myChoice === s.lieSlot;
      const fooledCount = Object.values(s.votes || {}).filter(c => c !== s.lieSlot).length;
      this.shell(right, isAuthor ? `
        <div class="glass-card lobby-wait-card"><div class="big-emoji">${fooledCount ? '😈' : '😅'}</div><h2>You fooled ${fooledCount}!</h2><p class="subtitle">+${fooledCount} points</p></div>
      ` : `
        <div class="glass-card lobby-wait-card result-card ${correct ? 'ok' : 'bad'}">
          <div class="big-emoji">${myChoice === undefined ? '⌛' : correct ? '🎯' : '🤦'}</div>
          <h2>${myChoice === undefined ? 'No vote' : correct ? 'You spotted the lie! +1' : 'You got fooled!'}</h2>
          <p class="subtitle">The lie was: <strong>${escapeHtml(s.statements[s.lieSlot])}</strong></p>
        </div>
      `);
      return;
    }

    const rank = (s.players || []).findIndex(p => p.id === this.session.playerId) + 1;
    this.shell(right, `<div class="glass-card lobby-wait-card"><div class="big-emoji">${rank === 1 ? '🏆' : '🎉'}</div><h2>${rank === 1 ? 'You win!' : `You finished #${rank}`}</h2><p class="subtitle">${me?.score || 0} points</p></div>`);
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  renderForm() {
    const d = this.draft;
    this.shell('', `
      <form id="ttForm" class="glass-card tt-form">
        <h3>Write 3 statements about you</h3>
        <p class="hint-text">Then tap 🤥 on the one that's the LIE.</p>
        ${[0, 1, 2].map(i => `
          <div class="tt-row ${d.lieIndex === i ? 'is-lie' : ''}">
            <textarea class="input-text tt-input" data-idx="${i}" maxlength="120" rows="2" placeholder="Statement ${LETTERS[i]}">${escapeHtml(d.statements[i])}</textarea>
            <button type="button" class="lie-toggle ${d.lieIndex === i ? 'active' : ''}" data-lie="${i}" aria-label="Mark statement ${LETTERS[i]} as the lie">${d.lieIndex === i ? '🤥 LIE' : 'truth'}</button>
          </div>
        `).join('')}
        <button type="button" class="btn-link" id="btnIdea">💡 Need an idea?</button>
        <button type="submit" class="btn-primary">✓ Lock In</button>
      </form>
    `);

    this.container.querySelectorAll('.tt-input').forEach(el => el.addEventListener('input', () => {
      this.draft.statements[Number(el.dataset.idx)] = el.value;
      this.saveDraft();
    }));
    this.container.querySelectorAll('.lie-toggle').forEach(btn => btn.addEventListener('click', () => {
      this.draft.lieIndex = Number(btn.dataset.lie);
      this.saveDraft();
      this.container.querySelectorAll('.tt-row').forEach((row, i) => row.classList.toggle('is-lie', i === this.draft.lieIndex));
      this.container.querySelectorAll('.lie-toggle').forEach((b, i) => {
        b.classList.toggle('active', i === this.draft.lieIndex);
        b.textContent = i === this.draft.lieIndex ? '🤥 LIE' : 'truth';
      });
      vibrate([20]);
    }));
    document.getElementById('btnIdea')?.addEventListener('click', () => {
      const idx = this.draft.statements.findIndex(t => !t.trim());
      if (idx < 0) {
        toast('All 3 are filled in. Nice!');
        return;
      }
      const idea = IDEAS[Math.floor(Math.random() * IDEAS.length)];
      this.draft.statements[idx] = idea;
      this.saveDraft();
      const el = this.container.querySelector(`.tt-input[data-idx="${idx}"]`);
      if (el) el.value = idea;
    });
    document.getElementById('ttForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const statements = this.draft.statements.map(t => t.trim());
      if (statements.some(t => t.length < 3)) {
        toast('Fill in all 3 statements', { tone: 'warn' });
        return;
      }
      if (this.draft.lieIndex === null) {
        toast('Tap 🤥 on the statement that is your lie', { tone: 'warn' });
        return;
      }
      vibrate([60]);
      this.session.sendAction('SUBMIT_STATEMENTS', { statements, lieIndex: this.draft.lieIndex });
    });
  }
}
