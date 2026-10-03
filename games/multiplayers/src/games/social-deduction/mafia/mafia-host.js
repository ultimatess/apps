import { MAFIA_ROLES, roleInfo, buildRoleDeck } from '../../../data/mafia-roles.js';
import { playRoundStart, playVictory, playGong, playTick, playBuzzer } from '../../../utils/audio.js';
import { narrate, stopNarration } from '../../../utils/narrator.js';
import { escapeHtml, shuffle, tallyVotes, Disposer } from '../../../utils/ui.js';

const NIGHT_SECONDS = 45;

export class MafiaHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;
    this.disposer = new Disposer();
    this.phaseDisposer = new Disposer();

    this.phase = 'SETUP'; // 'SETUP' | 'NIGHT' | 'DAY_ANNOUNCE' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'DAY_RESULT' | 'GAME_OVER'
    this.roundNumber = 0;
    this.dayTimer = 150;
    this.narration = true;

    this.playerRoles = {};
    this.alivePlayers = new Set();
    this.eliminatedPlayers = [];
    this.resetNight();
    this.lastDoctorTarget = null;
    this.vigilanteUsed = false;
    this.dayVotes = {};
    this.nightReport = '';
    this.winner = null;

    this.session.on('playerAction', (playerId, action, payload) => this.handlePlayerAction(playerId, action, payload));
    this.session.on('rosterChange', () => {
      if (this.phase === 'SETUP') this.render();
      if (this.phase === 'DAY_VOTING') {
        this.render();
        this.checkDayVotesComplete();
      }
      if (this.phase === 'NIGHT') this.checkNightComplete();
      this.syncState();
    });
  }

  destroy() {
    stopNarration();
    this.phaseDisposer.dispose();
    this.disposer.dispose();
  }

  say(text) {
    if (this.narration) narrate(text);
  }

  resetNight() {
    this.mafiaVotes = {};
    this.doctorTarget = null;
    this.detectiveTarget = null;
    this.vigilanteTarget = null;
    this.nightActed = new Set();
  }

  nameOf(id) {
    return this.session.clients.get(id)?.name || this.eliminatedPlayers.find(e => e.id === id)?.name || 'Player';
  }

  aliveIds() {
    return [...this.alivePlayers].filter(id => this.session.clients.has(id));
  }

  handlePlayerAction(playerId, action, payload) {
    if (!this.alivePlayers.has(playerId)) return;
    const targetId = payload.targetId;
    const validTarget = targetId && this.alivePlayers.has(targetId);

    if (this.phase === 'NIGHT') {
      const role = this.playerRoles[playerId];
      if (action === 'MAFIA_KILL' && role === 'Mafia' && validTarget && this.playerRoles[targetId] !== 'Mafia') {
        this.mafiaVotes[playerId] = targetId;
        this.sendRole(this.mafiaIds()); // teammates see each other's picks live
      } else if (action === 'DOCTOR_SAVE' && role === 'Doctor' && validTarget && targetId !== this.lastDoctorTarget) {
        this.doctorTarget = targetId;
      } else if (action === 'DETECTIVE_INSPECT' && role === 'Detective' && validTarget && !this.detectiveTarget && targetId !== playerId) {
        this.detectiveTarget = targetId;
        this.sendRole([playerId], {
          inspectionResult: { targetName: this.nameOf(targetId), isGuilty: this.playerRoles[targetId] === 'Mafia' }
        });
      } else if (action === 'VIGILANTE_SHOOT' && role === 'Vigilante' && !this.vigilanteUsed) {
        this.vigilanteTarget = validTarget && targetId !== playerId ? targetId : null; // null = hold fire
      } else if (action === 'NIGHT_DONE') {
        // Everyone (including plain townsfolk) taps something at night so phone activity reveals nothing.
      } else {
        return;
      }
      this.nightActed.add(playerId);
      this.renderNightProgress();
      this.checkNightComplete();
    } else if (this.phase === 'DAY_VOTING' && action === 'CAST_VOTE') {
      if (targetId !== 'SKIP' && !validTarget) return;
      this.dayVotes[playerId] = targetId;
      this.syncState();
      this.render();
      this.checkDayVotesComplete();
    }
  }

  mafiaIds() {
    return Object.keys(this.playerRoles).filter(id => this.playerRoles[id] === 'Mafia');
  }

  startNewGame() {
    const players = this.session.getPlayers();
    if (players.length < 4) return;

    this.roundNumber = 1;
    this.gameNumber = (this.gameNumber || 0) + 1;
    this.alivePlayers = new Set(players.map(p => p.id));
    this.eliminatedPlayers = [];
    this.lastDoctorTarget = null;
    this.vigilanteUsed = false;
    this.winner = null;
    this.gameOverMessage = '';
    this.lastLynch = null;

    const deck = shuffle(buildRoleDeck(players.length));
    this.playerRoles = {};
    players.forEach((p, i) => { this.playerRoles[p.id] = deck[i]; });

    playRoundStart();
    this.startNightPhase();
  }

  /** (Re)send each player's private role card plus any extra info. */
  sendRole(ids, extra = {}) {
    ids.forEach(id => {
      const role = this.playerRoles[id];
      if (!role) return;
      const teammates = role === 'Mafia'
        ? this.mafiaIds().filter(m => m !== id).map(m => ({ name: this.nameOf(m), alive: this.alivePlayers.has(m), pick: this.mafiaVotes[m] ? this.nameOf(this.mafiaVotes[m]) : null }))
        : [];
      this.session.sendPrivateState(id, {
        game: 'mafia',
        gameNumber: this.gameNumber,
        night: this.roundNumber,
        role,
        roleInfo: roleInfo(role),
        mafiaTeammates: teammates,
        lastDoctorTarget: role === 'Doctor' ? this.lastDoctorTarget : null,
        vigilanteUsed: role === 'Vigilante' ? this.vigilanteUsed : undefined,
        ...extra
      });
    });
  }

  startNightPhase() {
    this.phaseDisposer.dispose();
    this.phaseDisposer = new Disposer();
    this.phase = 'NIGHT';
    this.resetNight();
    this.timerRemaining = NIGHT_SECONDS;

    playGong();
    this.say(this.roundNumber === 1 ? 'Night falls on the city. Everyone, look at your phones.' : 'Night falls again. Everyone, look at your phones.');
    this.sendRole(Object.keys(this.playerRoles));
    this.syncState();
    this.render();

    this.phaseDisposer.interval(() => {
      if (this.phase !== 'NIGHT') return;
      this.timerRemaining--;
      const tEl = document.getElementById('mafiaTimer');
      if (tEl) tEl.textContent = `${this.timerRemaining}s`;
      if (this.timerRemaining <= 5 && this.timerRemaining > 0) playTick(700);
      if (this.timerRemaining % 5 === 0) this.syncState();
      if (this.timerRemaining <= 0) this.resolveNight();
    }, 1000);
  }

  checkNightComplete() {
    if (this.phase !== 'NIGHT') return;
    const alive = this.aliveIds().filter(id => this.session.clients.get(id)?.connected);
    if (alive.length && alive.every(id => this.nightActed.has(id))) {
      this.phaseDisposer.timeout(() => this.resolveNight(), 1200);
    }
  }

  renderNightProgress() {
    const el = document.getElementById('nightProgress');
    if (!el) return;
    const alive = this.aliveIds();
    const done = alive.filter(id => this.nightActed.has(id)).length;
    el.style.width = `${alive.length ? (done / alive.length) * 100 : 0}%`;
  }

  resolveNight() {
    if (this.phase !== 'NIGHT') return;
    const { leader } = tallyVotes(this.mafiaVotes);
    // Split mafia vote: the first mafia pick wins so a kill still happens.
    const mafiaTarget = leader || Object.values(this.mafiaVotes)[0] || null;
    const deaths = [];
    let saved = false;

    if (mafiaTarget) {
      if (mafiaTarget === this.doctorTarget) saved = true;
      else deaths.push({ id: mafiaTarget, cause: 'mafia' });
    }
    if (this.vigilanteTarget) {
      this.vigilanteUsed = true;
      if (this.vigilanteTarget === this.doctorTarget && this.vigilanteTarget !== mafiaTarget) saved = true;
      else if (!deaths.some(d => d.id === this.vigilanteTarget)) deaths.push({ id: this.vigilanteTarget, cause: 'vigilante' });
    }
    this.lastDoctorTarget = this.doctorTarget;

    deaths.forEach(d => this.eliminate(d.id, d.cause));
    if (deaths.length) {
      const names = deaths.map(d => `<strong>${escapeHtml(this.nameOf(d.id))}</strong> (${escapeHtml(this.playerRoles[d.id])})`).join(' and ');
      this.nightReport = `${names} ${deaths.length > 1 ? 'were' : 'was'} found dead this morning.`;
      this.say(`Morning comes. ${deaths.map(d => this.nameOf(d.id)).join(' and ')} did not survive the night.`);
      playBuzzer();
    } else if (saved) {
      this.nightReport = 'The Doctor saved a life tonight! <strong>Nobody died.</strong>';
      this.say('Morning comes. The doctor saved a life. Nobody died.');
      playRoundStart();
    } else {
      this.nightReport = 'A quiet night. <strong>Nobody died.</strong>';
      this.say('Morning comes. It was a quiet night.');
      playRoundStart();
    }

    if (this.checkWinConditions()) return;
    this.phaseDisposer.dispose();
    this.phaseDisposer = new Disposer();
    this.phase = 'DAY_ANNOUNCE';
    this.syncState();
    this.render();
  }

  eliminate(id, cause) {
    if (!this.alivePlayers.has(id)) return;
    this.alivePlayers.delete(id);
    this.eliminatedPlayers.push({ id, name: this.nameOf(id), role: this.playerRoles[id], cause, round: this.roundNumber });
  }

  startDayDiscussion() {
    this.phaseDisposer.dispose();
    this.phaseDisposer = new Disposer();
    this.phase = 'DAY_DISCUSSION';
    this.timerRemaining = this.dayTimer;
    this.dayVotes = {};
    this.say('Discuss. Who among you is Mafia?');
    this.syncState();
    this.render();

    this.phaseDisposer.interval(() => {
      if (this.phase !== 'DAY_DISCUSSION') return;
      this.timerRemaining--;
      const tEl = document.getElementById('mafiaTimer');
      if (tEl) tEl.textContent = this.formatTime(this.timerRemaining);
      if (this.timerRemaining % 10 === 0) this.syncState();
      if (this.timerRemaining <= 0) this.startDayVoting();
    }, 1000);
  }

  formatTime(t) {
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  startDayVoting() {
    this.phaseDisposer.dispose();
    this.phaseDisposer = new Disposer();
    this.phase = 'DAY_VOTING';
    this.dayVotes = {};
    playGong();
    this.say('Time to vote. Cast your vote on your phone.');
    this.syncState();
    this.render();
  }

  checkDayVotesComplete() {
    if (this.phase !== 'DAY_VOTING') return;
    const voters = this.aliveIds().filter(id => this.session.clients.get(id)?.connected);
    if (voters.length && voters.every(id => this.dayVotes[id])) {
      this.phaseDisposer.timeout(() => this.resolveDayVoting(), 800);
    }
  }

  resolveDayVoting() {
    if (this.phase !== 'DAY_VOTING') return;
    const { leader, counts } = tallyVotes(this.dayVotes, { ignore: ['SKIP'] });
    this.voteCounts = counts;

    if (leader) {
      const role = this.playerRoles[leader];
      this.eliminate(leader, 'town');
      this.lastLynch = { id: leader, name: this.nameOf(leader), role, votes: counts[leader] };
      this.say(`The town has voted out ${this.nameOf(leader)}. They were ${role === 'Mafia' ? 'Mafia' : `the ${role}`}.`);
      if (role === 'Jester') {
        this.winner = 'JESTER';
        this.endGame(`${this.nameOf(leader)} was the Jester and tricked the town into voting them out!`);
        return;
      }
    } else {
      this.lastLynch = null;
      this.say('The town could not agree. Nobody is eliminated.');
    }

    if (this.checkWinConditions()) return;
    this.phase = 'DAY_RESULT';
    playBuzzer();
    this.syncState();
    this.render();
  }

  checkWinConditions() {
    const alive = this.aliveIds();
    const aliveMafia = alive.filter(id => this.playerRoles[id] === 'Mafia');
    const others = alive.filter(id => this.playerRoles[id] !== 'Mafia');

    if (aliveMafia.length === 0) {
      this.winner = 'TOWN';
      this.endGame('Every member of the Mafia has been eliminated. The town is safe!');
      return true;
    }
    if (aliveMafia.length >= others.length) {
      this.winner = 'MAFIA';
      this.endGame('The Mafia now equals the rest of the town. The city belongs to them!');
      return true;
    }
    return false;
  }

  endGame(message) {
    this.phaseDisposer.dispose();
    this.phaseDisposer = new Disposer();
    this.phase = 'GAME_OVER';
    this.gameOverMessage = message;
    playVictory();
    this.say(this.winner === 'TOWN' ? 'The town wins!' : this.winner === 'MAFIA' ? 'The Mafia wins!' : 'The Jester wins!');
    this.syncState();
    this.render();
  }

  syncState() {
    const players = this.session.getPlayers().map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isAlive: this.alivePlayers.has(p.id)
    }));

    this.session.broadcastPublicState({
      game: 'mafia',
      phase: this.phase,
      gameNumber: this.gameNumber || 0,
      roundNumber: this.roundNumber,
      timerRemaining: this.timerRemaining,
      players,
      aliveCount: this.alivePlayers.size,
      eliminatedPlayers: this.eliminatedPlayers,
      nightReport: this.nightReport,
      votedIds: Object.keys(this.dayVotes),
      lastLynch: this.phase === 'DAY_RESULT' || this.phase === 'GAME_OVER' ? this.lastLynch : null,
      winner: this.winner,
      gameOverMessage: this.gameOverMessage,
      allRoles: this.phase === 'GAME_OVER' ? this.playerRoles : null
    });
  }

  render() {
    if (!this.container) return;
    const map = {
      SETUP: () => this.renderSetup(),
      NIGHT: () => this.renderNight(),
      DAY_ANNOUNCE: () => this.renderDayAnnounce(),
      DAY_DISCUSSION: () => this.renderDayDiscussion(),
      DAY_VOTING: () => this.renderDayVoting(),
      DAY_RESULT: () => this.renderDayResult(),
      GAME_OVER: () => this.renderGameOver()
    };
    map[this.phase]?.();
    document.getElementById('btnQuitMafia')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  header(label, center = '') {
    return `
      <header class="host-header compact">
        <div class="brand-badge"><span class="badge-cat">${label}</span><span class="round-indicator">DAY ${this.roundNumber}</span></div>
        <div class="central-timer">${center}</div>
        <button class="btn-icon" id="btnQuitMafia">Exit</button>
      </header>
    `;
  }

  renderSetup() {
    const players = this.session.getPlayers();
    const n = players.length;
    const deck = n >= 3 ? buildRoleDeck(n) : [];
    const counts = deck.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>MAFIA & WEREWOLF</span></div>
          <div class="room-code-display"><span class="label">ROOM</span><span class="code">${escapeHtml(this.session.roomCode)}</span></div>
        </header>

        <div class="lobby-grid two-col">
          <div class="glass-card">
            <h2>🌙 Silent-night Mafia</h2>
            <p class="setup-desc">No moderator needed and no closing eyes. Every night <strong>everyone</strong> taps their phone, so nobody can tell who has a power. The TV narrates.</p>
            <div class="roles-preview-grid">
              ${MAFIA_ROLES.map(r => `
                <div class="role-preview-card ${counts[r.name] ? '' : 'dim'}">
                  <span class="role-icon">${r.icon}</span>
                  <h4>${r.name}${counts[r.name] ? ` ×${counts[r.name]}` : ''}</h4>
                  <p>${r.desc}</p>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="glass-card settings-card">
            <h3>👥 Players (${n})</h3>
            <div class="players-roster">${players.map(p => `<div class="player-chip"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span></div>`).join('') || '<p class="muted">Waiting for players...</p>'}</div>
            <div class="form-group">
              <label>Day discussion</label>
              <div class="timer-chips">
                ${[[90, '1.5 min'], [150, '2.5 min'], [240, '4 min']].map(([t, l]) => `<button class="chip-btn ${this.dayTimer === t ? 'active' : ''}" data-time="${t}">${l}</button>`).join('')}
              </div>
            </div>
            <label class="toggle-row"><input type="checkbox" id="chkNarration" ${this.narration ? 'checked' : ''}/> 🗣️ Spoken narrator</label>
            <button class="btn-launch-game ${n >= 4 ? 'ready' : 'disabled'}" id="btnStartMafia" ${n >= 4 ? '' : 'disabled'}>🌙 Deal Roles & Begin Night</button>
            ${n < 4 ? `<p class="hint-text">Needs 4+ players (${Math.max(0, 4 - n)} more). 6+ is best.</p>` : ''}
            <button class="btn-secondary" id="btnBackToDeck">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;

    this.container.querySelectorAll('[data-time]').forEach(btn => btn.addEventListener('click', () => {
      this.dayTimer = Number(btn.dataset.time);
      this.render();
    }));
    document.getElementById('chkNarration')?.addEventListener('change', (e) => { this.narration = e.target.checked; });
    document.getElementById('btnStartMafia')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackToDeck')?.addEventListener('click', () => this.onReturnToHub?.());
  }

  renderNight() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper night-atmosphere">
        ${this.header('NIGHT', `<span class="timer-digits" id="mafiaTimer">${this.timerRemaining}s</span>`)}
        <div class="night-stage">
          <div class="moon">🌙</div>
          <h1>Night ${this.roundNumber} falls on the city...</h1>
          <p class="muted">Everyone: look at your phone and make your move in silence.</p>
          <div class="progress-bar"><div class="progress-fill" id="nightProgress"></div></div>
          <p class="hint-text">Morning comes as soon as everyone has tapped.</p>
        </div>
      </div>
    `;
    this.renderNightProgress();
  }

  graveyardHtml() {
    if (!this.eliminatedPlayers.length) return '<p class="muted">Nobody yet...</p>';
    return this.eliminatedPlayers.map(p => `
      <div class="grave-row"><span>🪦 ${escapeHtml(p.name)}</span><span class="muted">${escapeHtml(p.role)}</span></div>
    `).join('');
  }

  renderDayAnnounce() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header('MORNING')}
        <div class="glass-card setup-card">
          <div class="setup-icon">☀️</div>
          <h1>Morning ${this.roundNumber}</h1>
          <div class="report-box">${this.nightReport}</div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnStartDayDiscussion">🗣️ Begin Discussion</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnStartDayDiscussion')?.addEventListener('click', () => this.startDayDiscussion());
  }

  renderDayDiscussion() {
    const alive = this.session.getPlayers().filter(p => this.alivePlayers.has(p.id));
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header('DISCUSSION', `<span class="timer-digits" id="mafiaTimer">${this.formatTime(this.timerRemaining)}</span>`)}
        <div class="playing-layout">
          <div class="glass-card">
            <h3>Alive (${alive.length})</h3>
            <div class="players-roster">${alive.map(p => `<div class="player-chip"><span class="avatar">${p.avatar}</span><span class="name">${escapeHtml(p.name)}</span></div>`).join('')}</div>
            <div class="setup-actions">
              <button class="btn-primary" id="btnCallVoteNow">⚖️ Start the Vote Now</button>
            </div>
          </div>
          <div class="glass-card">
            <h3>Graveyard (${this.eliminatedPlayers.length})</h3>
            ${this.graveyardHtml()}
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnCallVoteNow')?.addEventListener('click', () => this.startDayVoting());
  }

  renderDayVoting() {
    const alive = this.session.getPlayers().filter(p => this.alivePlayers.has(p.id));
    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        ${this.header('VOTE')}
        <div class="trial-central-card glass-card">
          <h2>⚖️ Vote on your phone</h2>
          <p class="muted">Who does the town eliminate? A tie means nobody goes.</p>
          <div class="live-votes-grid">
            ${alive.map(p => `
              <div class="voter-badge ${this.dayVotes[p.id] ? 'voted' : 'pending'}">
                <span class="avatar">${p.avatar}</span>
                <span class="name">${escapeHtml(p.name)}</span>
                <span class="status-icon">${this.dayVotes[p.id] ? '✓ Voted' : '⏳'}</span>
              </div>
            `).join('')}
          </div>
          <div class="setup-actions"><button class="btn-secondary" id="btnCloseVotes">Close Voting Now</button></div>
        </div>
      </div>
    `;
    document.getElementById('btnCloseVotes')?.addEventListener('click', () => this.resolveDayVoting());
  }

  renderDayResult() {
    const l = this.lastLynch;
    const counts = this.voteCounts || {};
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        ${this.header('VERDICT')}
        <div class="glass-card setup-card">
          <div class="setup-icon">${l ? '⚰️' : '🤷'}</div>
          <h1>${l ? `${escapeHtml(l.name)} is eliminated` : 'No one is eliminated'}</h1>
          ${l ? `<div class="role-reveal ${l.role === 'Mafia' ? 'mafia' : 'town'}">They were: <strong>${roleInfo(l.role).icon} ${escapeHtml(l.role)}</strong></div>` : '<p class="muted">The vote was tied or the town chose to skip.</p>'}
          <div class="vote-breakdown">
            ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => `<span class="player-chip">${id === 'SKIP' ? '🕊️ Skip' : escapeHtml(this.nameOf(id))}: <strong>${n}</strong></span>`).join('')}
          </div>
          <div class="setup-actions">
            <button class="btn-primary-large" id="btnNextNight">🌙 Night Falls</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnNextNight')?.addEventListener('click', () => {
      this.roundNumber++;
      this.startNightPhase();
    });
  }

  renderGameOver() {
    const isTown = this.winner === 'TOWN';
    const isJester = this.winner === 'JESTER';
    const everyone = Object.keys(this.playerRoles);
    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="round-over-card glass-card">
          <div class="victory-header ${isTown ? 'town-win' : 'spy-win'}">
            <h1>${isTown ? '🏆 TOWN WINS!' : isJester ? '🃏 JESTER WINS!' : '🔪 MAFIA WINS!'}</h1>
            <p class="outcome-subtitle">${escapeHtml(this.gameOverMessage)}</p>
          </div>
          <h3 class="section-title">Everyone's secret role</h3>
          <div class="roles-reveal-grid">
            ${everyone.map(id => `
              <div class="role-reveal-chip ${this.playerRoles[id] === 'Mafia' ? 'mafia' : ''} ${this.alivePlayers.has(id) ? '' : 'dead'}">
                <span>${roleInfo(this.playerRoles[id]).icon}</span>
                <strong>${escapeHtml(this.nameOf(id))}</strong>
                <span class="muted">${escapeHtml(this.playerRoles[id])}${this.alivePlayers.has(id) ? '' : ' 🪦'}</span>
              </div>
            `).join('')}
          </div>
          <div class="round-over-actions">
            <button class="btn-primary" id="btnRestartMafia">🔁 New Game (new roles)</button>
            <button class="btn-secondary" id="btnReturnHubMafia">Back to Lobby</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('btnRestartMafia')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnReturnHubMafia')?.addEventListener('click', () => this.onReturnToHub?.());
  }
}
