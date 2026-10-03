import { vibrate } from '../../../utils/wake-lock.js';
import { escapeHtml, controllerHeader } from '../../../utils/ui.js';

export class MostLikelyController {
  constructor(session, container) {
    this.session = session;
    this.container = container;
    this.publicState = null;
    this.myVote = null;
    this.roundKey = null;

    this.session.on('stateUpdate', (state) => {
      const key = `${state.roundNumber}-${state.prompt}`;
      if (key !== this.roundKey) {
        this.roundKey = key;
        this.myVote = state.votedIds?.includes(this.session.playerId) ? this.myVote : null;
        if (state.phase === 'VOTING') vibrate([40]);
      }
      const phaseChanged = this.publicState?.phase !== state.phase;
      this.publicState = state;
      // While voting, only re-render on phase change so a choice in progress isn't wiped.
      if (state.phase === 'VOTING' && !phaseChanged && this.container.querySelector('.vote-grid, .vote-confirmed')) return;
      this.render();
    });
  }

  render() {
    if (!this.container) return;
    const s = this.publicState;
    const players = s?.players || [];

    if (!s || s.phase === 'SETUP') {
      this.shell('', `
        <div class="glass-card lobby-wait-card">
          <h2>🔥 Most Likely To...</h2>
          <p class="subtitle">Get ready to judge your friends. Votes are secret!</p>
        </div>`);
      return;
    }

    if (s.phase === 'AWARDS') {
      const mine = s.titles?.[this.session.playerId] || [];
      this.shell('', `
        <div class="glass-card lobby-wait-card">
          <div class="big-emoji">${mine.length ? '🏆' : '🕶️'}</div>
          <h2>${mine.length ? `You won ${mine.length} title${mine.length > 1 ? 's' : ''}!` : 'You flew under the radar'}</h2>
          ${mine.map(t => `<p class="award-title">${escapeHtml(t)}</p>`).join('')}
        </div>`);
      return;
    }

    if (s.phase === 'REVEAL') {
      const got = s.tallies?.[this.session.playerId] || 0;
      const won = s.winnerId === this.session.playerId;
      if (won) vibrate([80, 40, 80]);
      this.shell(`#${s.roundNumber}`, `
        <div class="glass-card prompt-card"><p class="phone-prompt">${escapeHtml(s.prompt)}</p></div>
        <div class="glass-card lobby-wait-card">
          <div class="big-emoji">${won ? '😱' : got ? '👀' : '😇'}</div>
          <h2>${won ? 'The room picked YOU!' : got ? `You got ${got} vote${got > 1 ? 's' : ''}` : 'No votes for you'}</h2>
          <p class="subtitle">Check the TV for the full results</p>
        </div>`);
      return;
    }

    const chosen = players.find(p => p.id === this.myVote);
    this.shell(`#${s.roundNumber}/${s.totalPrompts}`, `
      <div class="glass-card prompt-card">
        <div class="eyebrow">WHO IS MOST LIKELY TO...</div>
        <p class="phone-prompt">${escapeHtml(s.prompt.replace(/^Most likely to /i, ''))}</p>
      </div>
      ${chosen ? `
        <div class="vote-confirmed">
          <span class="check">✓</span>
          <h3>You voted ${chosen.avatar} ${escapeHtml(chosen.name)}</h3>
          <p>Waiting for everyone else...</p>
          <button class="btn-link" id="btnChangeVote">Change my vote</button>
        </div>
      ` : `
        <div class="vote-grid">
          ${players.map(p => `
            <button class="suspect-select-btn" data-nominee-id="${escapeHtml(p.id)}">
              <span class="avatar">${p.avatar}</span>
              <span class="name">${escapeHtml(p.name)}${p.id === this.session.playerId ? ' (You)' : ''}</span>
            </button>
          `).join('')}
        </div>
      `}
    `);

    this.container.querySelectorAll('[data-nominee-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        vibrate([50]);
        this.myVote = btn.dataset.nomineeId;
        this.session.sendAction('CAST_VOTE', { nomineeId: this.myVote });
        this.render();
      });
    });
    document.getElementById('btnChangeVote')?.addEventListener('click', () => {
      this.myVote = null;
      this.render();
    });
  }

  shell(right, inner) {
    this.container.innerHTML = `
      <div class="controller-screen">
        ${controllerHeader(this.session, right || undefined)}
        <div class="controller-body">${inner}</div>
      </div>
    `;
  }
}
