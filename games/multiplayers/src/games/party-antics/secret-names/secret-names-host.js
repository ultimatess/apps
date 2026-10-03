import { playRoundStart, playVictory, playGong } from '../../../utils/audio.js';

const MISSIONS = [
  "Get your target to say the word 'Biryani' or 'Coffee' in casual conversation.",
  "Make your target laugh without touching them or telling a direct joke.",
  "Discover your target's favorite Tamil movie or childhood memory discreetly.",
  "Get your target to high-five or fist-bump you naturally.",
  "Find out what your target had for breakfast without asking directly.",
  "Get your target to look at their phone clock or check the time.",
  "Subtly compliment your target's outfit or hairstyle so they say 'Thank you'."
];

export class SecretNamesHost {
  constructor(session, container, onReturnToHub) {
    this.session = session;
    this.container = container;
    this.onReturnToHub = onReturnToHub;

    this.phase = 'PLAYING'; // 'PLAYING' | 'REVEAL'
    this.assignments = {}; // playerId -> { targetId, targetName, mission }
    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerAction', (playerId, action, payload) => {
      // Future expansion for player claims
    });
  }

  startNewGame() {
    const players = Array.from(this.session.clients.values());
    if (players.length < 2) {
      alert('At least 2 players required for Secret Names!');
      return;
    }

    // Derangement: ensure no one gets themselves
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    for (let i = 0; i < shuffled.length; i++) {
      if (shuffled[i].id === players[i].id) {
        const next = (i + 1) % shuffled.length;
        [shuffled[i], shuffled[next]] = [shuffled[next], shuffled[i]];
      }
    }

    this.assignments = {};
    players.forEach((p, idx) => {
      const target = shuffled[idx];
      const mission = MISSIONS[idx % MISSIONS.length];
      this.assignments[p.id] = { targetId: target.id, targetName: target.name, mission };

      this.session.sendPrivateState(p.id, {
        game: 'secret-names',
        targetName: target.name,
        targetAvatar: target.avatar,
        mission
      });
    });

    this.phase = 'PLAYING';
    playRoundStart();
    this.syncState();
    this.render();
  }

  syncState() {
    const players = Array.from(this.session.clients.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar
    }));

    this.session.broadcastPublicState({
      game: 'secret-names',
      phase: this.phase,
      players
    });
  }

  render() {
    if (!this.container) return;
    const players = Array.from(this.session.clients.values());

    if (this.phase === 'PLAYING') {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header">
            <div class="brand-badge"><span class="pulse-dot"></span><span>SECRET NAMES & MISSIONS</span></div>
            <div class="room-code-mini"><button class="btn-icon" id="btnBackDeck">Exit</button></div>
          </header>

          <div class="glass-card" style="text-align:center; padding:40px 24px; max-width:850px; margin:0 auto; width:100%;">
            <div style="font-size:54px; margin-bottom:12px;">🕵️‍♂️</div>
            <h1 style="font-family:var(--font-heading); font-size:36px; margin-bottom:12px;">Missions in Progress!</h1>
            <p style="color:var(--text-secondary); font-size:16px; max-width:600px; margin:0 auto 28px; line-height:1.6;">
              Every player has received a secret target person and mission on their phone! 
              Socialize and complete your covert objective without raising suspicion.
            </p>

            <div class="players-roster" style="justify-content:center; margin-bottom:32px;">
              ${players.map(p => `
                <div class="player-chip">
                  <span>${p.avatar}</span>
                  <span>${p.name}</span>
                </div>
              `).join('')}
            </div>

            <button class="btn-primary" id="btnEndMissions" style="max-width:300px; margin:0 auto;">
              🏁 Conclude Missions & Reveal
            </button>
          </div>
        </div>
      `;

      document.getElementById('btnEndMissions')?.addEventListener('click', () => {
        this.phase = 'REVEAL';
        playGong();
        this.syncState();
        this.render();
      });
      document.getElementById('btnBackDeck')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    } else {
      this.container.innerHTML = `
        <div class="host-screen-wrapper">
          <header class="host-header">
            <div class="brand-badge"><span class="badge-cat">MISSION REVEALS</span></div>
            <div class="room-code-mini"><button class="btn-icon" id="btnBackDeck">Exit</button></div>
          </header>

          <div class="glass-card" style="max-width:850px; margin:0 auto; width:100%;">
            <h2 style="font-family:var(--font-heading); text-align:center; margin-bottom:24px;">Secret Assignments Roster</h2>
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${players.map(p => {
                const a = this.assignments[p.id];
                return `
                  <div style="background:rgba(255,255,255,0.05); padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <strong>${p.name}</strong> was assigned to target: <span style="color:var(--accent-cyan); font-weight:800;">${a?.targetName}</span>
                      <p style="color:var(--text-muted); font-size:13px; margin-top:4px;">Mission: "${a?.mission}"</p>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <div style="display:flex; justify-content:center; gap:12px; margin-top:28px;">
              <button class="btn-primary" id="btnRestartSecret">New Missions</button>
              <button class="btn-secondary" id="btnReturnDeck">Return to Party Deck</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnRestartSecret')?.addEventListener('click', () => this.startNewGame());
      document.getElementById('btnReturnDeck')?.addEventListener('click', () => {
        if (this.onReturnToHub) this.onReturnToHub();
      });
    }
  }
}
