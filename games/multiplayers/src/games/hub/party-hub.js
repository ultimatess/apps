import { renderQRCodeToCanvas } from '../../netplay/qrcode.js';
import { getJoinUrl } from '../../netplay/room-code.js';

export const PARTY_GAMES_CATALOG = [
  // 1. Social Deduction
  {
    id: 'spyfall',
    category: 'social',
    title: 'Spyfall',
    badge: 'Bluffing & Interrogation',
    badgeColor: '#06b6d4',
    icon: '🕵️‍♂️',
    players: '3–12 Players',
    desc: 'Everyone knows the secret location except the Spy. Ask clever questions without giving away where you are!'
  },
  {
    id: 'mafia',
    category: 'social',
    title: 'Mafia & Werewolf',
    badge: 'Silent Night & Hidden Roles',
    badgeColor: '#8b5cf6',
    icon: '🌙',
    players: '3–16 Players',
    desc: 'Silent night moves on your phone. Mafia eliminates townspeople while Doctor and Detective investigate.'
  },

  // 2. Creative & Party Antics
  {
    id: 'fake-artist',
    category: 'party',
    title: 'Fake Artist',
    badge: 'Drawing & Deception',
    badgeColor: '#ec4899',
    icon: '🎨',
    players: '3–10 Players',
    desc: 'Everyone draws a secret word together 1 stroke at a time. The Fake Artist has no idea what the word is!'
  },
  {
    id: 'most-likely',
    category: 'party',
    title: 'Most Likely To...',
    badge: 'Social Banter & Accusations',
    badgeColor: '#f43f5e',
    icon: '🔥',
    players: '3+ Players',
    desc: 'Spicy, funny, and Kollywood prompts. Everyone votes simultaneously on their phone for who fits best!'
  },
  {
    id: 'fivesec',
    category: 'party',
    title: '5-Second Rule',
    badge: 'Quick Thinking & Buzzer Race',
    badgeColor: '#10b981',
    icon: '⚡',
    players: '2–12 Players',
    desc: 'Slam the buzzer first on your phone, then name 3 items before the 5-second ticking clock runs out!'
  },
  {
    id: 'secret-names',
    category: 'party',
    title: 'Secret Names',
    badge: 'Covert Party Missions',
    badgeColor: '#f59e0b',
    icon: '🎯',
    players: '2–16 Players',
    desc: 'Receive a secret target person and private party challenge on your phone. Blend in and complete your mission!'
  },

  // 3. NetplayJS Arcade & Action
  {
    id: 'pong',
    category: 'arcade',
    title: 'Netplay Pong',
    badge: 'Real-Time 60fps Duel',
    badgeColor: '#06b6d4',
    icon: '🏓',
    players: '2 Players',
    desc: 'From NetplayJS! Fast 60fps paddle duel. Slide your thumb on your mobile screen to deflect the ball and score!'
  },
  {
    id: 'square-tag',
    category: 'arcade',
    title: 'Square Arena Clash',
    badge: 'NetplayJS Arena Battle',
    badgeColor: '#a855f7',
    icon: '🟦',
    players: '2–4 Players',
    desc: 'Steer your square with mobile D-pad controls, collect golden stars, and tag opponents in a 45-second clash!'
  },
  {
    id: 'connect4',
    category: 'arcade',
    title: 'Connect 4 Grid Duel',
    badge: 'Tactical Board Duel',
    badgeColor: '#ef4444',
    icon: '🔴🟡',
    players: '2 Players',
    desc: 'Classic 4-in-a-row strategy! Tap columns on your phone to drop discs and outsmart your opponent on the TV.'
  }
];

export class PartyHub {
  constructor(session, container, onSelectGame) {
    this.session = session;
    this.container = container;
    this.onSelectGame = onSelectGame;
    this.activeCategory = 'all';

    this.setupNetworkHandlers();
  }

  setupNetworkHandlers() {
    this.session.on('playerJoin', () => this.render());
    this.session.on('playerLeave', () => this.render());
  }

  render() {
    if (!this.container) return;
    const joinUrl = getJoinUrl(this.session.roomCode);
    const players = Array.from(this.session.clients.values());

    const filteredGames = this.activeCategory === 'all'
      ? PARTY_GAMES_CATALOG
      : PARTY_GAMES_CATALOG.filter(g => g.category === this.activeCategory);

    this.container.innerHTML = `
      <div class="host-screen-wrapper">
        <header class="host-header">
          <div class="brand-badge">
            <span class="pulse-dot"></span>
            <span>NETPLAY PARTY DECK & ARCADE</span>
          </div>
          <div class="room-code-display">
            <span class="label">ROOM CODE</span>
            <span class="code">${this.session.roomCode}</span>
          </div>
        </header>

        <div class="lobby-grid">
          <!-- Left: QR Code -->
          <div class="glass-card qr-card">
            <h3><i class="icon">📱</i> Scan to Join</h3>
            <p class="subtitle">Open camera or visit<br><strong>${window.location.host}${window.location.pathname}</strong></p>
            <div class="qr-canvas-wrapper">
              <canvas id="qrHubCanvas"></canvas>
            </div>
            <div class="join-link-box">
              <input type="text" readonly value="${joinUrl}" id="txtHubJoinLink" />
              <button class="btn-copy" id="btnHubCopy">Copy</button>
            </div>
            <div style="margin-top:16px; font-size:13px; color:var(--text-muted);">
              👥 <strong>${players.length}</strong> Players Connected
            </div>
          </div>

          <!-- Center & Right: Game Catalog -->
          <div class="glass-card" style="grid-column: span 2;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
              <div>
                <h2>Game Catalog (${PARTY_GAMES_CATALOG.length} Games)</h2>
                <p style="color:var(--text-secondary); font-size:13px;">Phones automatically switch to the chosen game controller.</p>
              </div>

              <!-- Category Filter Tabs -->
              <div class="category-tabs" style="display:flex; gap:8px;">
                <button class="cat-tab-btn ${this.activeCategory === 'all' ? 'active' : ''}" data-cat="all">All</button>
                <button class="cat-tab-btn ${this.activeCategory === 'social' ? 'active' : ''}" data-cat="social">🎭 Social</button>
                <button class="cat-tab-btn ${this.activeCategory === 'party' ? 'active' : ''}" data-cat="party">🎨 Party</button>
                <button class="cat-tab-btn ${this.activeCategory === 'arcade' ? 'active' : ''}" data-cat="arcade">🕹️ NetplayJS</button>
              </div>
            </div>

            <div class="games-catalog-grid">
              ${filteredGames.map(g => `
                <div class="game-catalog-card" data-game-id="${g.id}">
                  <div class="catalog-top">
                    <span class="game-icon">${g.icon}</span>
                    <span class="cat-badge" style="background:${g.badgeColor}22; color:${g.badgeColor}; border:1px solid ${g.badgeColor}44;">
                      ${g.badge}
                    </span>
                  </div>
                  <h3>${g.title}</h3>
                  <p class="desc">${g.desc}</p>
                  <div class="catalog-bottom">
                    <span class="players-tag">👥 ${g.players}</span>
                    <button class="btn-select-game" data-game-id="${g.id}">Play ➡️</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Render Canvas QR Code
    const qrCanvas = document.getElementById('qrHubCanvas');
    if (qrCanvas) {
      renderQRCodeToCanvas(qrCanvas, joinUrl, {
        size: 180,
        padding: 10,
        darkColor: '#090d16',
        lightColor: '#ffffff'
      });
    }

    document.getElementById('btnHubCopy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(joinUrl);
      const b = document.getElementById('btnHubCopy');
      b.textContent = 'Copied!';
      setTimeout(() => b.textContent = 'Copy', 2000);
    });

    document.querySelectorAll('.cat-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.activeCategory = e.target.dataset.cat;
        this.render();
      });
    });

    document.querySelectorAll('.btn-select-game, .game-catalog-card').forEach(el => {
      el.addEventListener('click', () => {
        const gameId = el.dataset.gameId || el.closest('.game-catalog-card')?.dataset.gameId;
        if (gameId && this.onSelectGame) {
          this.onSelectGame(gameId);
        }
      });
    });
  }
}
