import { MAFIA_ROLES } from '../../../data/mafia-roles.js';
import { playRoundStart, playVictory, playGong, playTick, playBuzzer } from '../../../utils/audio.js';

export class MafiaHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'SETUP'; // 'SETUP' | 'NIGHT' | 'DAY_ANNOUNCE' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'GAME_OVER'
    this.roundNumber = 0;

    this.playerRoles = {}; // playerId -> roleName
    this.alivePlayers = new Set();
    this.eliminatedPlayers = [];

    // Night actions
    this.mafiaTarget = null;
    this.doctorTarget = null;
    this.detectiveTarget = null;
    this.vigilanteTarget = null;

    this.nightTimer = 35;
    this.dayTimer = 180;
    this.timerRemaining = 0;
    this.timerInterval = null;

    this.dayVotes = {}; // voterId -> targetId
    this.nightReport = '';
    this.winner = null;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      this.handlePlayerAction(playerId, action, payload);
    });
  }

  handlePlayerAction(playerId, action, payload) {
    if (!this.alivePlayers.has(playerId)) return;

    if (this.phase === 'NIGHT') {
      const role = this.playerRoles[playerId];
      if (role === 'Mafia' && action === 'MAFIA_KILL') {
        this.mafiaTarget = payload.targetId;
      } else if (role === 'Doctor' && action === 'DOCTOR_SAVE') {
        this.doctorTarget = payload.targetId;
      } else if (role === 'Detective' && action === 'DETECTIVE_INSPECT') {
        this.detectiveTarget = payload.targetId;
        const targetRole = this.playerRoles[payload.targetId];
        const isGuilty = targetRole === 'Mafia';
        // Send instant private result to Detective
        this.session.sendPrivateState(playerId, {
          inspectionResult: {
            targetName: this.session.clients.get(payload.targetId)?.name || 'Suspect',
            isGuilty
          }
        });
      }
    } else if (this.phase === 'DAY_VOTING') {
      if (action === 'CAST_VOTE') {
        this.dayVotes[playerId] = payload.targetId;
        this.syncState();
        this.render();
        this.checkDayVotesComplete();
      }
    }
  }

  startNewGame() {
    const players = Array.from(this.session.clients.values());
    if (players.length < 3) {
      alert('At least 3 players required for Mafia!');
      return;
    }

    this.roundNumber = 1;
    this.alivePlayers = new Set(players.map(p => p.id));
    this.eliminatedPlayers = [];
    this.assignRoles(players);

    this.startNightPhase();
  }

  assignRoles(players) {
    const n = players.length;
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    this.playerRoles = {};

    // Standard party distribution:
    // 3-4 players: 1 Mafia, 1 Doctor, 1 Detective, Rest Town
    // 5-6 players: 2 Mafia, 1 Doctor, 1 Detective, Rest Town
    // 7+ players: 2 Mafia, 1 Doctor, 1 Detective, 1 Jester, Rest Town
    const mafiaCount = n >= 5 ? 2 : 1;

    for (let i = 0; i < mafiaCount; i++) {
      this.playerRoles[shuffled[i].id] = 'Mafia';
    }

    let nextIdx = mafiaCount;
    this.playerRoles[shuffled[nextIdx++].id] = 'Doctor';
    if (nextIdx < n) this.playerRoles[shuffled[nextIdx++].id] = 'Detective';
    if (n >= 7 && nextIdx < n) this.playerRoles[shuffled[nextIdx++].id] = 'Jester';

    while (nextIdx < n) {
      this.playerRoles[shuffled[nextIdx++].id] = 'Townsperson';
    }

    // Unicast private roles
    players.forEach(p => {
      const role = this.playerRoles[p.id];
      const mafiaTeammates = role === 'Mafia' 
        ? players.filter(pl => this.playerRoles[pl.id] === 'Mafia' && pl.id !== p.id).map(pl => pl.name)
        : [];

      this.session.sendPrivateState(p.id, {
        game: 'mafia',
        role,
        mafiaTeammates,
        roleInfo: MAFIA_ROLES.find(r => r.name === role) || { desc: 'Help the town survive.' }
      });
    });
  }

  startNightPhase() {
    this.phase = 'NIGHT';
    this.mafiaTarget = null;
    this.doctorTarget = null;
    this.detectiveTarget = null;
    this.vigilanteTarget = null;
    this.timerRemaining = this.nightTimer;

    playGong();
    this.syncState();
    this.render();

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.timerRemaining--;
      const tEl = document.getElementById('mafiaTimer');
      if (tEl) tEl.textContent = `${this.timerRemaining}s`;

      if (this.timerRemaining <= 0) {
        clearInterval(this.timerInterval);
        this.resolveNight();
      }
    }, 1000);
  }

  resolveNight() {
    let killedId = null;
    if (this.mafiaTarget && this.mafiaTarget !== this.doctorTarget) {
      killedId = this.mafiaTarget;
    }

    const victim = killedId ? this.session.clients.get(killedId) : null;

    if (victim) {
      this.alivePlayers.delete(victim.id);
      this.eliminatedPlayers.push({ id: victim.id, name: victim.name, role: this.playerRoles[victim.id] });
      this.nightReport = `Tragedy struck! <strong>${victim.name}</strong> was attacked and killed in their sleep!`;
      playBuzzer();
    } else {
      this.nightReport = `A miracle occurred! The Doctor successfully protected the victim! <strong>Nobody died tonight.</strong>`;
      playRoundStart();
    }

    this.checkWinConditions();
    if (this.phase === 'GAME_OVER') return;

    this.phase = 'DAY_ANNOUNCE';
    this.syncState();
    this.render();
  }

  startDayDiscussion() {
    this.phase = 'DAY_DISCUSSION';
    this.timerRemaining = this.dayTimer;
    this.dayVotes = {};

    this.syncState();
    this.render();

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.timerRemaining--;
      const tEl = document.getElementById('mafiaTimer');
      if (tEl) {
        const m = Math.floor(this.timerRemaining / 60);
        const s = this.timerRemaining % 60;
        tEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      }

      if (this.timerRemaining <= 0) {
        clearInterval(this.timerInterval);
        this.startDayVoting();
      }
    }, 1000);
  }

  startDayVoting() {
    clearInterval(this.timerInterval);
    this.phase = 'DAY_VOTING';
    this.dayVotes = {};
    playGong();
    this.syncState();
    this.render();
  }

  checkDayVotesComplete() {
    const aliveCount = this.alivePlayers.size;
    if (Object.keys(this.dayVotes).length >= aliveCount) {
      this.resolveDayVoting();
    }
  }

  resolveDayVoting() {
    const counts = {};
    Object.values(this.dayVotes).forEach(tid => {
      counts[tid] = (counts[tid] || 0) + 1;
    });

    let topTarget = null;
    let maxVotes = -1;
    for (const [tid, count] of Object.entries(counts)) {
      if (count > maxVotes) {
        maxVotes = count;
        topTarget = tid;
      }
    }

    if (topTarget && topTarget !== 'SKIP') {
      const lynched = this.session.clients.get(topTarget);
      const role = this.playerRoles[topTarget];
      this.alivePlayers.delete(topTarget);
      this.eliminatedPlayers.push({ id: topTarget, name: lynched?.name || 'Player', role });

      if (role === 'Jester') {
        this.winner = 'JESTER';
        this.endGame('The Jester wanted to be lynched and tricked the town into executing them!');
        return;
      }

      alert(`The town voted to execute ${lynched?.name}! Their secret identity was: ${role}!`);
    } else {
      alert('The town could not reach a majority agreement. No one was executed!');
    }

    this.checkWinConditions();
    if (this.phase === 'GAME_OVER') return;

    this.roundNumber++;
    this.startNightPhase();
  }

  checkWinConditions() {
    const aliveArray = Array.from(this.alivePlayers);
    const aliveMafia = aliveArray.filter(id => this.playerRoles[id] === 'Mafia');
    const aliveTown = aliveArray.filter(id => this.playerRoles[id] !== 'Mafia');

    if (aliveMafia.length === 0) {
      this.winner = 'TOWN';
      this.endGame('All Mafia members have been eradicated! The Town is safe!');
    } else if (aliveMafia.length >= aliveTown.length) {
      this.winner = 'MAFIA';
      this.endGame('The Mafia has equaled or outnumbered the townspeople! The Mafia controls the city!');
    }
  }

  endGame(message) {
    this.phase = 'GAME_OVER';
    clearInterval(this.timerInterval);
    this.gameOverMessage = message;
    playVictory();
    this.syncState();
    this.render();
  }

  syncState() {
    const players = Array.from(this.session.clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isAlive: this.alivePlayers.has(p.id)
    }));

    this.session.broadcastPublicState({
      game: 'mafia',
      phase: this.phase,
      roundNumber: this.roundNumber,
      timerRemaining: this.timerRemaining,
      players,
      aliveCount: this.alivePlayers.size,
      eliminatedPlayers: this.eliminatedPlayers,
      nightReport: this.nightReport,
      dayVotes: this.dayVotes,
      winner: this.winner,
      gameOverMessage: this.gameOverMessage
    });
  }

  render() {
    if (!this.container) return;

    if (this.phase === 'SETUP') this.renderSetup();
    else if (this.phase === 'NIGHT') this.renderNight();
    else if (this.phase === 'DAY_ANNOUNCE') this.renderDayAnnounce();
    else if (this.phase === 'DAY_DISCUSSION') this.renderDayDiscussion();
    else if (this.phase === 'DAY_VOTING') this.renderDayVoting();
    else if (this.phase === 'GAME_OVER') this.renderGameOver();
  }

  renderSetup() {
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge"><span class="pulse-dot"></span><span>MAFIA & WEREWOLF</span></div>
          <div class="room-code-display"><span class="code">${this.session.roomCode}</span></div>
        </header>

        <div class="lobby-grid">
          <div class="glass-card" style="grid-column: span 2;">
            <h2>🌙 Silent Night Multiplayer Mafia</h2>
            <p style="color:var(--text-secondary); margin-bottom:20px; line-height:1.6;">
              No more closing eyes and awkward phone passing! All night actions (Mafia kill, Doctor save, Detective inspect) 
              take place <strong>simultaneously and silently</strong> on each player's mobile screen!
            </p>

            <div class="roles-preview-grid">
              ${MAFIA_ROLES.slice(0, 4).map(r => `
                <div class="role-preview-card">
                  <span class="role-icon">🎭</span>
                  <h4>${r.name}</h4>
                  <p>${r.desc}</p>
                </div>
              `).join('')}
            </div>

            <div style="display:flex; gap:12px; margin-top:28px;">
              <button class="btn-primary-large" id="btnStartMafia">🚀 Deal Roles & Fall Asleep</button>
              <button class="btn-secondary" id="btnBackToDeck">Back to Party Deck</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnStartMafia')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnBackToDeck')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }

  renderNight() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper night-atmosphere" style="text-align:center; padding:50px 20px;">
        <div style="font-size:72px; animation:bounce 3s infinite ease-in-out;">🌙</div>
        <h1 style="font-size:44px; font-family:var(--font-heading); margin:16px 0;">Night Falls on the City...</h1>
        <p style="color:#94a3b8; font-size:18px; margin-bottom:24px;">
          Everyone look at your phones in silence! Mafia, Doctor, and Detective are choosing their moves.
        </p>
        <div class="trial-timer" id="mafiaTimer" style="font-size:48px;">${this.timerRemaining}s</div>
        <div class="radar-scan" style="margin:24px auto;"></div>
      </div>
    `;
  }

  renderDayAnnounce() {
    this.container.innerHTML = `
      <div class="host-screen-wrapper" style="text-align:center; padding:40px 20px;">
        <div class="glass-card" style="max-width:700px; margin:0 auto; padding:40px;">
          <div style="font-size:54px;">☀️</div>
          <h1 style="font-size:36px; margin:16px 0;">Morning Sun Rises...</h1>
          <div style="background:rgba(255,255,255,0.06); padding:20px; border-radius:16px; margin:24px 0; font-size:20px; line-height:1.5;">
            ${this.nightReport}
          </div>
          <button class="btn-primary-large" id="btnStartDayDiscussion">🗣️ Begin Town Discussion</button>
        </div>
      </div>
    `;

    document.getElementById('btnStartDayDiscussion')?.addEventListener('click', () => {
      this.startDayDiscussion();
    });
  }

  renderDayDiscussion() {
    const players = Array.from(this.session.clients.values());

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header in-game-header">
          <div class="brand-badge"><span class="badge-cat">DAY DISCUSSION</span></div>
          <div class="central-timer">
            <span class="timer-digits" id="mafiaTimer">${Math.floor(this.timerRemaining / 60)}:${this.timerRemaining % 60 < 10 ? '0' : ''}${this.timerRemaining % 60}</span>
          </div>
          <div class="room-code-mini"><button class="btn-icon" id="btnCallVoteNow">Vote Now ⚖️</button></div>
        </header>

        <div class="playing-layout">
          <div class="glass-card">
            <h3>Living Townspeople (${this.alivePlayers.size})</h3>
            <div class="players-roster" style="margin-top:16px;">
              ${players.filter(p => this.alivePlayers.has(p.id)).map(p => `
                <div class="player-chip">
                  <span class="avatar">${p.avatar}</span>
                  <span class="name">${p.name}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="glass-card">
            <h3>Graveyard (${this.eliminatedPlayers.length})</h3>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
              ${this.eliminatedPlayers.map(p => `
                <div style="display:flex; justify-content:space-between; padding:8px 12px; background:rgba(0,0,0,0.3); border-radius:8px;">
                  <span>🪦 ${p.name}</span>
                  <span style="color:var(--text-muted);">${p.role}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnCallVoteNow')?.addEventListener('click', () => this.startDayVoting());
  }

  renderDayVoting() {
    const alive = Array.from(this.session.clients.values()).filter(p => this.alivePlayers.has(p.id));

    this.container.innerHTML = `
      <div class="host-screen-wrapper accusation-spotlight">
        <div class="spotlight-header">
          <div class="siren-banner">⚖️ TOWN LYNCH TRIAL ⚖️</div>
        </div>
        <div class="trial-central-card glass-card">
          <h2>Cast Your Vote on Your Phone!</h2>
          <p style="color:var(--text-secondary); margin-bottom:24px;">Who does the town condemn to death?</p>
          <div class="live-votes-grid">
            ${alive.map(p => `
              <div class="voter-badge ${this.dayVotes[p.id] ? 'voted' : 'pending'}">
                <span class="avatar">${p.avatar}</span>
                <span class="name">${p.name}</span>
                <span class="status-icon">${this.dayVotes[p.id] ? '✓ Ballot In' : '⏳ Choosing...'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  renderGameOver() {
    const isTown = this.winner === 'TOWN';
    const isJester = this.winner === 'JESTER';

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <div class="round-over-card glass-card">
          <div class="victory-header ${isTown ? 'town-win' : 'spy-win'}">
            <h1>${isTown ? '🏆 TOWN WINS!' : isJester ? '🃏 JESTER WINS!' : '💀 MAFIA WINS!'}</h1>
            <p class="outcome-subtitle">${this.gameOverMessage}</p>
          </div>

          <div style="display:flex; justify-content:center; gap:12px; margin-top:24px;">
            <button class="btn-primary" id="btnRestartMafia">Play Another Round</button>
            <button class="btn-secondary" id="btnReturnHubMafia">Return to Party Deck</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnRestartMafia')?.addEventListener('click', () => this.startNewGame());
    document.getElementById('btnReturnHubMafia')?.addEventListener('click', () => {
      if (this.onReturnToHub) this.onReturnToHub();
    });
  }
}
