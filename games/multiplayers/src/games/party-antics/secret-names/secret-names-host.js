import { playRoundStart, playGong, playCorrect, playWrong } from '../../../utils/audio.js';
import { escapeHtml, shuffle } from '../../../utils/ui.js';

export const MISSIONS = [
  "Get your target to say the word 'Biryani' or 'Coffee' in casual conversation.",
  'Make your target laugh without touching them or telling a direct joke.',
  "Discover your target's favorite movie without asking about movies directly.",
  'Get your target to high-five or fist-bump you naturally.',
  'Find out what your target had for breakfast without asking directly.',
  'Get your target to check the time on their phone or watch.',
  "Compliment your target's outfit so that they say 'Thank you'.",
  'Get your target to stand up and move to a different spot.',
  'Make your target say the name of a city or country.',
  "Get your target to tell you about a trip they've taken.",
  'Get your target to hum or sing part of a song.',
  'Make your target say "Seriously?" or "No way!".',
  'Get your target to hand you an object (a glass, phone, snack...).',
  'Learn the name of your target\'s first pet or dream pet.',
  'Get your target to agree with an obviously wrong fact.',
  'Make your target use the word "actually" twice in one conversation.',
  'Get your target to show you a photo on their phone.',
  'Get your target to recommend a restaurant or dish.',
  'Make your target copy a gesture you do (cross arms, scratch head...).',
  'Get your target to say your name out loud.',
  'Get your target to talk about the weather for at least 3 sentences.',
  'Find out which superpower your target would pick.',
  'Get your target to taste or try something you offer them.',
  'Make your target say a number bigger than one hundred.',
  'Get your target to give you advice about something.',
  'Get your target to do a quick stretch or yawn.',
  'Find out your target\'s go-to karaoke song.',
  'Get your target to say "Wait, what?".'
];

/** Random single cycle: everyone hunts exactly one person and is hunted by exactly one. */
export function assignTargets(playerIds) {
  const order = shuffle(playerIds);
  const map = {};
  order.forEach((id, i) => { map[id] = order[(i + 1) % order.length]; });
  return map;
}

export class SecretNamesHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'SETUP'; // 'SETUP' | 'PLAYING' | 'REVEAL'
    this.assignments = {}; // hunterId -> { targetId, mission, completed, exposed }
    this.callouts = {}; // playerId -> { suspectId, correct }
    this.scores = {};
    this.feed = [];

    this.session.on('playerAction', (playerId, action, payload) => this.handleAction(playerId, action, payload));
    this.session.on('playerLeave', (player) => {
      if (this.phase !== 'PLAYING' || !this.assignments[player.id]) return;
      // Whoever hunted the leaver inherits the leaver's target, keeping one unbroken cycle.
      const hunter = Object.keys(this.assignments).find(h => this.assignments[h].targetId === player.id);
      const inherited = this.assignments[player.id].targetId;
      delete this.assignments[player.id];
      if (hunter && hunter !== player.id && inherited !== hunter) {
        this.assignments[hunter].targetId = inherited;
        this.sendPrivate(hunter);
      } else if (hunter) {
        delete this.assignments[hunter];
      }
    });
    this.session.on('rosterChange', () => {
      if (this.phase !== 'REVEAL') this.render();
      this.syncState();
    });
  }

  handleAction(playerId, action, payload) {
    if (this.phase !== 'PLAYING') return;
    const mine = this.assignments[playerId];
    if (!mine) return;

    if (action === 'MISSION_DONE' && !mine.completed && !mine.exposed) {
      mine.completed = true;
      mine.completedAt = Date.now();
      this.addScore(playerId, 2);
      this.feed.unshift('🕵️ A secret agent just completed their mission!');
      playCorrect();
      this.sendPrivate(playerId);
    } else if (action === 'CALL_OUT' && !this.callouts[playerId] && this.session.clients.has(payload.suspectId) && payload.suspectId !== playerId) {
      const hunterId = Object.keys(this.assignments).find(h => this.assignments[h].targetId === playerId);
      const correct = hunterId === payload.suspectId;
      this.callouts[playerId] = { suspectId: payload.suspectId, correct };
      const accuser = this.session.clients.get(playerId);
      const suspect = this.session.clients.get(payload.suspectId);
      if (correct) {
        this.addScore(playerId, 1);
        const hunted = this.assignments[hunterId];
        if (!hunted.completed) hunted.exposed = true;
        this.feed.unshift(`🚨 ${accuser.name} exposed their hunter: ${suspect.name}!`);
        playCorrect();
        this.sendPrivate(hunterId);
      } else {
        this.feed.unshift(`❌ ${accuser.name} wrongly accused ${suspect.name}`);
        playWrong();
      }
      this.sendPrivate(playerId);
    } else {
      return;
    }
    this.feed = this.feed.slice(0, 6);
    this.syncState();
    this.render();
  }

  addScore(id, n) {
    this.scores[id] = (this.scores[id] || 0) + n;
  }

  startNewGame() {
    const players = this.session.getPlayers();
    if (players.length < 2) return;

    const targets = assignTargets(players.map(p => p.id));
    const missions = shuffle(MISSIONS);
    this.assignments = {};
    this.callouts = {};
    this.feed = [];
    players.forEach((p, i) => {
      this.assignments[p.id] = { targetId: targets[p.id], mission: missions[i % missions.length], completed: false, exposed: false };
    });

    this.phase = 'PLAYING';
    playRoundStart();
    players.forEach(p => this.sendPrivate(p.id));
    this.syncState();
    this.render();
  }

  sendPrivate(playerId) {
    const a = this.assignments[playerId];
    if (!a) return;
    const target = this.session.clients.get(a.targetId);
    this.session.sendPrivateState(playerId, {
      game: 'secret-names',
      targetId: a.targetId,
      targetName: target?.name || 'Your target',
      targetAvatar: target?.avatar || '🎯',
      mission: a.mission,
      completed: a.completed,
      exposed: a.exposed,
      callout: this.callouts[playerId] || null
    });
  }

  syncState() {
    const players = this.session.getPlayers().map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: this.scores[p.id] || 0 }));
    const values = Object.values(this.assignments);
    this.session.broadcastPublicState({
      game: 'secret-names',
      phase: this.phase,
      players,
      completedCount: values.filter(a => a.completed).length,
      totalMissions: values.length,
      feed: this.feed,
      reveal: this.phase === 'REVEAL' ? this.revealRows() : null
    });
  }

  revealRows() {
    return Object.entries(this.assignments).map(([hunterId, a]) => ({
      hunterId,
      hunterName: this.session.clients.get(hunterId)?.name || 'Agent',
      targetName: this.session.clients.get(a.targetId)?.name || 'Target',
      mission: a.mission,
      completed: a.completed,
      exposed: a.exposed
    }));
  }

  render() {
    if (!this.container) return;
    const players = this.session.getPlayers();

    if (this.phase === 'SETUP') {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header">
            <div class="brand-badge"><span class="pulse-dot"></span><span>SECRET MISSIONS</span></div>
            <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
          </header>
          <div class="glass-card setup-card">
            <div class="setup-icon">🎯</div>
            <h2>Everyone is a spy. Everyone is a target.</h2>
            <ul class="rules-list">
              <li>📱 Your phone shows a secret <strong>target</strong> and a sneaky <strong>mission</strong></li>
              <li>🎭 Keep partying and complete it without anyone noticing (+2)</li>
              <li>🚨 Think someone is working on YOU? Expose your hunter (+1, and their mission fails). One guess only!</li>
              <li>🏁 The host ends the round whenever you like and the TV reveals all</li>
            </ul>
            <div class="players-roster center">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('')}</div>
            <div class="setup-actions">
              <button class="btn-primary-large" id="btnDealMissions" ${players.length >= 2 ? '' : 'disabled'}>🕵️ Deal Secret Missions</button>
              <button class="btn-secondary" id="btnBackDeck">Back to Lobby</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('btnDealMissions')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
      return;
    }

    if (this.phase === 'PLAYING') {
      const values = Object.values(this.assignments);
      const done = values.filter(a => a.completed).length;
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header compact">
            <div class="brand-badge"><span class="pulse-dot"></span><span>SECRET MISSIONS</span></div>
            <div class="round-indicator">${done} / ${values.length} MISSIONS COMPLETE</div>
            <button class="btn-icon" id="btnBackDeck">Exit</button>
          </header>
          <div class="glass-card prompt-stage">
            <div class="setup-icon">🕵️‍♂️</div>
            <h1 class="prompt-text">Missions are live</h1>
            <p class="muted">Check your phone for your target. Act natural...</p>
            <div class="progress-bar"><div class="progress-fill" style="width:${values.length ? (done / values.length) * 100 : 0}%"></div></div>
            <div class="feed">${this.feed.map(f => `<div class="feed-item">${escapeHtml(f)}</div>`).join('') || '<div class="feed-item muted">No activity yet...</div>'}</div>
            <div class="setup-actions">
              <button class="btn-primary" id="btnEndMissions">🏁 End Round & Reveal</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('btnEndMissions')?.addEventListener('click', () => {
        this.phase = 'REVEAL';
        playGong();
        this.syncState();
        this.render();
      });
      document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
      return;
    }

    const ranked = [...players].sort((a, b) => (this.scores[b.id] || 0) - (this.scores[a.id] || 0));
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header compact">
          <div class="brand-badge"><span class="badge-cat">MISSION DEBRIEF</span></div>
          <button class="btn-icon" id="btnBackDeck">Exit</button>
        </header>
        <div class="glass-card setup-card wide">
          <h2>Mission Debrief</h2>
          <div class="reveal-rows">
            ${this.revealRows().map(r => `
              <div class="reveal-row ${r.completed ? 'ok' : r.exposed ? 'bad' : ''}">
                <div><strong>${escapeHtml(r.hunterName)}</strong> → <span class="accent">${escapeHtml(r.targetName)}</span>
                <p class="muted">${escapeHtml(r.mission)}</p></div>
                <span class="status">${r.completed ? '✅ Done' : r.exposed ? '🚨 Exposed' : '⌛ Failed'}</span>
              </div>
            `).join('')}
          </div>
          <h3 class="section-title">Scores</h3>
          <div class="score-strip">${ranked.map((p, i) => `<div class="player-chip">${i === 0 && this.scores[p.id] ? '👑' : p.avatar} ${escapeHtml(p.name)} <strong class="pts">${this.scores[p.id] || 0}</strong></div>`).join('')}</div>
          <div class="setup-actions">
            <button class="btn-primary" id="btnRestartSecret">🔁 New Missions</button>
            <button class="btn-secondary" id="btnReturnDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnRestartSecret')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnReturnDeck')?.addEventListener('click', () => this.onReturnToHub?.());
    document.getElementById('btnBackDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
