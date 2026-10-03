import { requestWakeLock, vibrate } from '../../../utils/wake-lock.js';

export class MafiaController {
  constructor(session, container) {
    this.session = session;
    this.container = container;

    this.publicState = null;
    this.privateState = null;
    this.isCardRevealed = true;
    this.inspectionResult = null;

    this.nightActionDone = false;
    this.dayVoteDone = false;

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('stateUpdate', (state) => {
      this.publicState = state;
      if (state.phase === 'NIGHT') {
        this.nightActionDone = false;
        this.inspectionResult = null;
      } else if (state.phase === 'DAY_VOTING') {
        this.dayVoteDone = false;
      }
      this.render();
    });

    this.session.on('privatePayload', (data) => {
      if (data.game === 'mafia') {
        this.privateState = data;
        this.isCardRevealed = true;
        requestWakeLock();
        vibrate([100, 50, 100]);
        this.render();
      } else if (data.inspectionResult) {
        this.inspectionResult = data.inspectionResult;
        vibrate([50, 50]);
        this.render();
      }
    });
  }

  render() {
    if (!this.container) return;

    if (!this.publicState || this.publicState.phase === 'SETUP') {
      this.renderLobby();
    } else if (this.publicState.phase === 'NIGHT') {
      this.renderNight();
    } else if (this.publicState.phase === 'DAY_ANNOUNCE') {
      this.renderDayAnnounce();
    } else if (this.publicState.phase === 'DAY_DISCUSSION') {
      this.renderDayDiscussion();
    } else if (this.publicState.phase === 'DAY_VOTING') {
      this.renderDayVoting();
    } else if (this.publicState.phase === 'GAME_OVER') {
      this.renderGameOver();
    }
  }

  renderLobby() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill">${this.session.roomCode}</div>
        </header>
        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <h2>🌙 Mafia & Werewolf</h2>
            <p>Wait for the host to deal secret roles to all players!</p>
          </div>
        </div>
      </div>
    `;
  }

  renderNight() {
    const isAlive = (this.publicState?.players || []).find(p => p.id === this.session.playerId)?.isAlive;
    const role = this.privateState?.role || 'Townsperson';
    const players = (this.publicState?.players || []).filter(p => p.isAlive && p.id !== this.session.playerId);

    if (!isAlive) {
      this.renderGhostScreen();
      return;
    }

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="room-pill siren">🌙 NIGHT (${this.publicState.timerRemaining}s)</div>
        </header>

        <div class="controller-body">
          <!-- Role Banner -->
          <div class="secret-card ${role === 'Mafia' ? 'card-spy' : 'card-location'}" style="margin-bottom:16px;">
            <div class="card-badge">YOUR SECRET ROLE</div>
            <h1 class="card-title">${role}</h1>
            <p class="card-desc">${this.privateState?.roleInfo?.desc || ''}</p>
            ${role === 'Mafia' && this.privateState?.mafiaTeammates?.length ? `
              <p style="color:#fca5a5; font-size:12px; margin-top:8px;">
                Fellow Mafia: <strong>${this.privateState.mafiaTeammates.join(', ')}</strong>
              </p>
            ` : ''}
          </div>

          <!-- Night Action Form -->
          <div class="glass-card">
            ${role === 'Mafia' ? `
              <h3>💀 Choose a Victim to Eliminate:</h3>
              ${this.nightActionDone ? `
                <div class="vote-confirmed"><span class="check">✓</span><p>Kill target selected.</p></div>
              ` : `
                <div class="suspect-picker-grid">
                  ${players.map(p => `
                    <button class="suspect-select-btn btn-mafia-kill" data-target-id="${p.id}">
                      <span>${p.avatar}</span><span>${p.name}</span>
                    </button>
                  `).join('')}
                </div>
              `}
            ` : role === 'Doctor' ? `
              <h3>💉 Choose Someone to Protect Tonight:</h3>
              ${this.nightActionDone ? `
                <div class="vote-confirmed"><span class="check">✓</span><p>Protection assigned.</p></div>
              ` : `
                <div class="suspect-picker-grid">
                  ${players.map(p => `
                    <button class="suspect-select-btn" data-target-id="${p.id}">
                      <span>${p.avatar}</span><span>${p.name}</span>
                    </button>
                  `).join('')}
                </div>
              `}
            ` : role === 'Detective' ? `
              <h3>🔍 Select a Suspect to Investigate:</h3>
              ${this.inspectionResult ? `
                <div style="background:rgba(255,255,255,0.1); border-radius:12px; padding:16px; margin-top:12px; text-align:center;">
                  <h4>Investigation File:</h4>
                  <p style="font-size:18px; margin-top:6px;">
                    <strong>${this.inspectionResult.targetName}</strong> is: 
                    <span style="color:${this.inspectionResult.isGuilty ? '#ef4444' : '#10b981'}; font-weight:800;">
                      ${this.inspectionResult.isGuilty ? 'GUILTY (Mafia) 🚨' : 'INNOCENT (Townsperson) 🛡️'}
                    </span>
                  </p>
                </div>
              ` : this.nightActionDone ? `
                <div class="vote-confirmed"><span class="check">✓</span><p>Investigating...</p></div>
              ` : `
                <div class="suspect-picker-grid">
                  ${players.map(p => `
                    <button class="suspect-select-btn btn-detective-inspect" data-target-id="${p.id}">
                      <span>${p.avatar}</span><span>${p.name}</span>
                    </button>
                  `).join('')}
                </div>
              `}
            ` : `
              <div style="text-align:center; padding:24px 0;">
                <div style="font-size:42px; margin-bottom:12px;">💤</div>
                <h3>You are asleep...</h3>
                <p style="color:var(--text-muted); font-size:13px; line-height:1.5;">
                  Keep your eyes on your screen and stay quiet. Morning comes soon!
                </p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.btn-mafia-kill').forEach(btn => {
      btn.addEventListener('click', () => {
        this.nightActionDone = true;
        this.session.sendAction('MAFIA_KILL', { targetId: btn.dataset.targetId });
        this.render();
      });
    });

    document.querySelectorAll('.suspect-select-btn:not(.btn-mafia-kill):not(.btn-detective-inspect)').forEach(btn => {
      btn.addEventListener('click', () => {
        this.nightActionDone = true;
        this.session.sendAction('DOCTOR_SAVE', { targetId: btn.dataset.targetId });
        this.render();
      });
    });

    document.querySelectorAll('.btn-detective-inspect').forEach(btn => {
      btn.addEventListener('click', () => {
        this.nightActionDone = true;
        this.session.sendAction('DETECTIVE_INSPECT', { targetId: btn.dataset.targetId });
        this.render();
      });
    });
  }

  renderDayAnnounce() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card" style="text-align:center; padding:32px 16px;">
            <div style="font-size:48px;">☀️</div>
            <h2>Daytime Arrives</h2>
            <div style="background:rgba(255,255,255,0.06); padding:16px; border-radius:12px; margin:20px 0;">
              ${this.publicState.nightReport}
            </div>
            <p style="color:var(--text-muted); font-size:13px;">Look at the main screen for details!</p>
          </div>
        </div>
      </div>
    `;
  }

  renderDayDiscussion() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="timer-pill">Discussion</div>
        </header>

        <div class="controller-body">
          <div class="glass-card" style="text-align:center; padding:30px 20px;">
            <div style="font-size:36px; margin-bottom:10px;">🗣️</div>
            <h2>Town Discussion</h2>
            <p style="color:var(--text-secondary); line-height:1.6; margin-top:8px;">
              Debate, question suspects, and look for inconsistencies. Voting will open shortly!
            </p>
          </div>
        </div>
      </div>
    `;
  }

  renderDayVoting() {
    const isAlive = (this.publicState?.players || []).find(p => p.id === this.session.playerId)?.isAlive;
    const candidates = (this.publicState?.players || []).filter(p => p.isAlive && p.id !== this.session.playerId);

    if (!isAlive) {
      this.renderGhostScreen();
      return;
    }

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.session.avatar} ${this.session.playerName}</div>
          <div class="timer-pill siren">VOTE</div>
        </header>

        <div class="controller-body">
          <div class="glass-card">
            <h2>⚖️ Cast Your Lynch Vote</h2>
            <p style="color:var(--text-secondary); margin-bottom:16px;">Who do you vote to eliminate from town?</p>

            ${this.dayVoteDone ? `
              <div class="vote-confirmed">
                <span class="check">✓</span>
                <h3>Vote Submitted!</h3>
                <p>Waiting for other townspeople...</p>
              </div>
            ` : `
              <div class="suspect-picker-grid">
                ${candidates.map(p => `
                  <button class="suspect-select-btn btn-cast-lynch" data-target-id="${p.id}">
                    <span>${p.avatar}</span><span>${p.name}</span>
                  </button>
                `).join('')}
                <button class="suspect-select-btn btn-cast-lynch" data-target-id="SKIP" style="border-style:dashed;">
                  <span>🕊️</span><span>Abstain / Skip Vote</span>
                </button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.btn-cast-lynch').forEach(btn => {
      btn.addEventListener('click', () => {
        this.dayVoteDone = true;
        this.session.sendAction('CAST_VOTE', { targetId: btn.dataset.targetId });
        this.render();
      });
    });
  }

  renderGhostScreen() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card" style="text-align:center; padding:40px 20px;">
            <div style="font-size:48px;">🪦</div>
            <h2>You Have Been Eliminated</h2>
            <p style="color:var(--text-muted); margin-top:8px; line-height:1.5;">
              You are now a spectator ghost. Do not reveal secrets to living players!
            </p>
          </div>
        </div>
      </div>
    `;
  }

  renderGameOver() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <div class="controller-body">
          <div class="glass-card round-over-mobile">
            <h2>Game Over!</h2>
            <p style="color:#e2e8f0; margin-top:8px;">${this.publicState.gameOverMessage}</p>
          </div>
        </div>
      </div>
    `;
  }
}
