import { renderQRCodeToCanvas } from '../../netplay/qrcode.js';
import { getJoinUrl } from '../../netplay/room-code.js';
import { escapeHtml, toast } from '../../utils/ui.js';

export const PARTY_GAMES_CATALOG = [
  // 1. Social Deduction
  {
    id: 'spyfall',
    category: 'social',
    title: 'Spyfall',
    badge: 'Bluffing & Interrogation',
    badgeColor: '#06b6d4',
    icon: '🕵️‍♂️',
    minPlayers: 3,
    maxPlayers: 12,
    duration: '6 min',
    desc: 'Everyone knows the secret location except the Spy. Ask clever questions without giving away where you are!'
  },
  {
    id: 'mafia',
    category: 'social',
    title: 'Mafia & Werewolf',
    badge: 'Silent Night & Hidden Roles',
    badgeColor: '#8b5cf6',
    icon: '🌙',
    minPlayers: 4,
    maxPlayers: 16,
    duration: '15 min',
    desc: 'Silent night moves on your phone. Mafia eliminates townspeople while Doctor and Detective investigate.'
  },
  {
    id: 'two-truths',
    category: 'social',
    title: 'Two Truths & a Lie',
    badge: 'Bluff Your Friends',
    badgeColor: '#14b8a6',
    icon: '🤥',
    minPlayers: 3,
    maxPlayers: 12,
    duration: '10 min',
    desc: 'Type 3 statements about yourself on your phone. One is a lie. Fool the room to score; spot lies to score more!'
  },

  // 2. Creative & Party Antics
  {
    id: 'fake-artist',
    category: 'party',
    title: 'Fake Artist',
    badge: 'Drawing & Deception',
    badgeColor: '#ec4899',
    icon: '🎨',
    minPlayers: 3,
    maxPlayers: 10,
    duration: '8 min',
    desc: 'Everyone draws a secret word together 1 stroke at a time. The Fake Artist has no idea what the word is!'
  },
  {
    id: 'trivia',
    category: 'party',
    title: 'Trivia Blitz',
    badge: 'Fastest Finger Quiz',
    badgeColor: '#3b82f6',
    icon: '🧠',
    minPlayers: 1,
    maxPlayers: 16,
    duration: '7 min',
    desc: 'Rapid-fire multiple choice on your phone. Faster correct answers earn more points, and streaks earn bonuses!'
  },
  {
    id: 'quick-draw',
    category: 'party',
    title: 'Quick Draw Showdown',
    badge: 'Reflex Duel',
    badgeColor: '#f97316',
    icon: '🤠',
    minPlayers: 2,
    maxPlayers: 16,
    duration: '4 min',
    desc: 'Wait for it... DRAW! Tap your phone the instant the TV flashes. Jump the gun and you are out for the round!'
  },
  {
    id: 'most-likely',
    category: 'party',
    title: 'Most Likely To...',
    badge: 'Social Banter & Accusations',
    badgeColor: '#f43f5e',
    icon: '🔥',
    minPlayers: 3,
    maxPlayers: 16,
    duration: '10 min',
    desc: 'Spicy, funny, and Kollywood prompts. Everyone votes simultaneously on their phone for who fits best!'
  },
  {
    id: 'fivesec',
    category: 'party',
    title: '5-Second Rule',
    badge: 'Quick Thinking & Buzzer Race',
    badgeColor: '#10b981',
    icon: '⚡',
    minPlayers: 2,
    maxPlayers: 12,
    duration: '10 min',
    desc: 'Slam the buzzer first on your phone, then name 3 items before the 5-second ticking clock runs out!'
  },
  {
    id: 'secret-names',
    category: 'party',
    title: 'Secret Missions',
    badge: 'Covert Party Missions',
    badgeColor: '#f59e0b',
    icon: '🎯',
    minPlayers: 3,
    maxPlayers: 16,
    duration: 'All night',
    desc: 'Receive a secret target person and covert challenge on your phone. Complete it before anyone catches on!'
  },

  // 3. NetplayJS Arcade & Action
  {
    id: 'pong',
    category: 'arcade',
    title: 'Netplay Pong',
    badge: 'Real-Time 60fps Duel',
    badgeColor: '#06b6d4',
    icon: '🏓',
    minPlayers: 1,
    maxPlayers: 16,
    duration: '3 min',
    desc: 'Fast 60fps paddle duel. Slide your thumb on your phone to deflect the ball. Winner stays, next challenger up!'
  },
  {
    id: 'light-cycles',
    category: 'arcade',
    title: 'Light Cycles',
    badge: 'Last Rider Standing',
    badgeColor: '#22d3ee',
    icon: '🏍️',
    minPlayers: 2,
    maxPlayers: 6,
    duration: '3 min',
    desc: 'Tron-style neon trails for up to 6 riders. Steer left and right on your phone and trap your rivals!'
  },
  {
    id: 'square-tag',
    category: 'arcade',
    title: 'Square Arena Clash',
    badge: 'Joystick Arena Battle',
    badgeColor: '#a855f7',
    icon: '🟦',
    minPlayers: 1,
    maxPlayers: 6,
    duration: '1 min',
    desc: 'Steer with a thumb joystick, grab golden stars and ram rivals with Turbo to steal their points!'
  },
  {
    id: 'connect4',
    category: 'arcade',
    title: 'Connect 4 Grid Duel',
    badge: 'Tactical Board Duel',
    badgeColor: '#ef4444',
    icon: '🔴',
    minPlayers: 1,
    maxPlayers: 16,
    duration: '5 min',
    desc: 'Classic 4-in-a-row strategy! Tap columns on your phone to drop discs. Winner stays on, next challenger up!'
  }
];

export function playerRangeLabel(game) {
  if (game.maxPlayers === game.minPlayers) return `${game.minPlayers} Players`;
  if (game.id === 'pong' || game.id === 'connect4') return '1–2 + queue';
  return `${game.minPlayers}–${game.maxPlayers} Players`;
}

export class PartyHub {
  constructor(session, container, onSelectGame) {
    this.session = session;
    this.container = container;
    this.onSelectGame = onSelectGame;
    this.activeCategory = 'all';

    this.session.on('rosterChange', () => {
      this.render();
      this.syncState();
    });
  }

  syncState() {
    this.session.broadcastPublicState({
      game: 'hub',
      players: this.session.getPlayers().map(p => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected }))
    });
  }

  render() {
    if (!this.container) return;
    const joinUrl = getJoinUrl(this.session.roomCode);
    const players = this.session.getPlayers();
    const count = players.length;

    const filteredGames = this.activeCategory === 'all'
      ? PARTY_GAMES_CATALOG
      : PARTY_GAMES_CATALOG.filter(g => g.category === this.activeCategory);

    const tab = (cat, label) => `<button class="cat-tab-btn ${this.activeCategory === cat ? 'active' : ''}" data-cat="${cat}">${label}</button>`;

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge">
            <span class="pulse-dot"></span>
            <span>NETPLAY PARTY DECK & ARCADE</span>
          </div>
          <div class="room-code-display">
            <span class="label">ROOM CODE</span>
            <span class="code">${escapeHtml(this.session.roomCode)}</span>
          </div>
        </header>

        <div class="lobby-grid hub-grid">
          <div class="glass-card qr-card">
            <h3>📱 Scan to Join</h3>
            <p class="subtitle">Point your phone camera at the code, or open the link and enter <strong>${escapeHtml(this.session.roomCode)}</strong></p>
            <div class="qr-canvas-wrapper">
              <canvas id="qrHubCanvas"></canvas>
            </div>
            <div class="join-link-box">
              <input type="text" readonly value="${escapeHtml(joinUrl)}" id="txtHubJoinLink" aria-label="Join link" />
              <button class="btn-copy" id="btnHubCopy">Copy</button>
            </div>

            <div class="hub-roster">
              <div class="hub-roster-title">👥 <strong id="hubPlayerCount">${count}</strong> ${count === 1 ? 'player' : 'players'} in the room</div>
              ${count === 0 ? `
                <div class="empty-roster"><div class="radar-scan"></div><p>Waiting for the first phone...</p></div>
              ` : `
                <div class="hub-roster-list">
                  ${players.map(p => `
                    <div class="hub-player ${p.connected ? '' : 'offline'}" title="${p.connected ? 'Connected' : 'Reconnecting...'}">
                      <span class="avatar">${p.avatar}</span>
                      <span class="name">${escapeHtml(p.name)}</span>
                      ${p.connected ? '' : '<span class="offline-tag">reconnecting</span>'}
                      <button class="btn-kick" data-kick-id="${escapeHtml(p.id)}" title="Remove ${escapeHtml(p.name)}" aria-label="Remove ${escapeHtml(p.name)}">✕</button>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>

          <div class="glass-card hub-catalog">
            <div class="hub-catalog-head">
              <div>
                <h2>Pick a Game <span class="muted">(${PARTY_GAMES_CATALOG.length})</span></h2>
                <p class="muted">Phones switch to the right controller automatically. Highlighted games fit your current group size.</p>
              </div>
              <div class="category-tabs">
                ${tab('all', 'All')}
                ${tab('social', '🎭 Social')}
                ${tab('party', '🎉 Party')}
                ${tab('arcade', '🕹️ Arcade')}
              </div>
            </div>

            <div class="games-catalog-grid">
              ${filteredGames.map(g => {
                const fits = count >= g.minPlayers && count <= g.maxPlayers;
                const need = g.minPlayers - count;
                return `
                  <button class="game-catalog-card ${fits ? 'fits' : 'no-fit'}" data-game-id="${g.id}">
                    <div class="catalog-top">
                      <span class="game-icon">${g.icon}</span>
                      <span class="cat-badge" style="background:${g.badgeColor}22; color:${g.badgeColor}; border:1px solid ${g.badgeColor}44;">${g.badge}</span>
                    </div>
                    <h3>${g.title}</h3>
                    <p class="desc">${g.desc}</p>
                    <div class="catalog-bottom">
                      <span class="players-tag">👥 ${playerRangeLabel(g)} · ⏱ ${g.duration}</span>
                      <span class="fit-tag">${fits ? 'Play ▶' : need > 0 ? `Need ${need} more` : 'Too many'}</span>
                    </div>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const qrCanvas = document.getElementById('qrHubCanvas');
    if (qrCanvas) {
      renderQRCodeToCanvas(qrCanvas, joinUrl, { size: 200, padding: 10, darkColor: '#090d16', lightColor: '#ffffff' });
    }

    document.getElementById('btnHubCopy')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(joinUrl).then(() => toast('Join link copied'), () => {});
      const b = document.getElementById('btnHubCopy');
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = 'Copy'; }, 2000);
    });

    this.container.querySelectorAll('.cat-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeCategory = btn.dataset.cat;
        this.render();
      });
    });

    this.container.querySelectorAll('.btn-kick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.session.kick?.(btn.dataset.kickId);
      });
    });

    this.container.querySelectorAll('.game-catalog-card').forEach(el => {
      el.addEventListener('click', () => {
        const game = PARTY_GAMES_CATALOG.find(g => g.id === el.dataset.gameId);
        if (!game) return;
        const n = this.session.getPlayers().length;
        if (n < game.minPlayers) {
          toast(`${game.title} needs at least ${game.minPlayers} players. Opening the setup screen; invite more friends to start.`, { tone: 'warn', duration: 3600 });
        }
        if (this.onSelectGame) this.onSelectGame(game.id);
      });
    });
  }
}
