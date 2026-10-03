import { generateRoomCode, sanitizeRoomCode } from './netplay/room-code.js';
import { HostSession, ClientSession } from './netplay/peer-manager.js';

// Hub
import { PartyHub } from './games/hub/party-hub.js';

// Category 1: Social Deduction
import { SpyfallHost } from './games/social-deduction/spyfall/spyfall-host.js';
import { SpyfallController } from './games/social-deduction/spyfall/spyfall-controller.js';
import { MafiaHost } from './games/social-deduction/mafia/mafia-host.js';
import { MafiaController } from './games/social-deduction/mafia/mafia-controller.js';

// Category 2: Creative & Party Antics
import { FakeArtistHost } from './games/party-antics/fake-artist/fake-artist-host.js';
import { FakeArtistController } from './games/party-antics/fake-artist/fake-artist-controller.js';
import { MostLikelyHost } from './games/party-antics/most-likely/most-likely-host.js';
import { MostLikelyController } from './games/party-antics/most-likely/most-likely-controller.js';
import { FiveSecHost } from './games/party-antics/fivesec/fivesec-host.js';
import { FiveSecController } from './games/party-antics/fivesec/fivesec-controller.js';
import { SecretNamesHost } from './games/party-antics/secret-names/secret-names-host.js';
import { SecretNamesController } from './games/party-antics/secret-names/secret-names-controller.js';

// Category 3: NetplayJS Arcade & Action
import { PongHost } from './games/arcade/pong/pong-host.js';
import { PongController } from './games/arcade/pong/pong-controller.js';
import { SquareTagHost } from './games/arcade/square-tag/tag-host.js';
import { SquareTagController } from './games/arcade/square-tag/tag-controller.js';
import { Connect4Host } from './games/arcade/connect4/connect4-host.js';
import { Connect4Controller } from './games/arcade/connect4/connect4-controller.js';

import { initAudio } from './utils/audio.js';

const AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐨', '🐸', '🐙', '🦄', '🐲', '🚀', '⚡', '🕵️‍♂️'];

class App {
  constructor() {
    this.container = document.getElementById('app');
    this.hostSession = null;
    this.clientSession = null;
    this.activeHostGame = null;
    this.activeControllerGame = null;
    this.activeGameId = 'hub';

    this.init();
  }

  init() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');

    if (roomParam) {
      this.renderJoinScreen(sanitizeRoomCode(roomParam));
    } else {
      this.renderLandingScreen();
    }
  }

  renderLandingScreen() {
    this.container.innerHTML = `
      <div class="landing-hero">
        <div class="hero-header">
          <div class="logo-mark">🎭</div>
          <h1 class="hero-title">NETPLAY PARTY & ARCADE</h1>
          <p class="hero-subtitle">Zero-Server WebRTC Party & Arcade Games for Big Screens & Mobile Phones</p>
        </div>

        <div class="game-showcase-badge">
          <span class="badge-new">9 MULTIPLAYER GAMES</span>
          <span class="game-title">Social Deduction • Party Antics • NetplayJS 60fps Arcade Duels</span>
        </div>

        <div class="mode-cards-grid">
          <div class="mode-card card-host" id="cardHost">
            <div class="card-icon">📺</div>
            <h2>Host on TV / Screen</h2>
            <p>Generate room code & QR code on your TV, laptop, or tablet. Run the game board, arcade arena, and audio.</p>
            <button class="btn-primary-large" id="btnStartHosting">
              <span>👑 Create Room</span>
            </button>
          </div>

          <div class="mode-card card-join" id="cardJoin">
            <div class="card-icon">📱</div>
            <h2>Join from Phone</h2>
            <p>Enter 4-letter room code to play with your phone as your private controller, gamepad, drawing pad & buzzer.</p>
            <button class="btn-secondary-large" id="btnGoToJoin">
              <span>🎟️ Join Room</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnStartHosting')?.addEventListener('click', () => {
      initAudio();
      this.startHostMode();
    });

    document.getElementById('btnGoToJoin')?.addEventListener('click', () => {
      initAudio();
      this.renderJoinScreen();
    });
  }

  renderJoinScreen(prefillRoom = '') {
    const randomAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    this.container.innerHTML = `
      <div class="join-screen-wrapper">
        <div class="join-card glass-card">
          <div class="join-header">
            <span class="logo-icon">🎟️</span>
            <h2>Join Party Room</h2>
            <p class="subtitle">Connect to the host screen using WebRTC</p>
          </div>

          <form id="joinForm" class="join-form">
            <div class="form-group">
              <label for="txtRoom">4-Letter Room Code:</label>
              <input 
                type="text" 
                id="txtRoom" 
                maxlength="6" 
                placeholder="e.g. LION" 
                value="${prefillRoom}" 
                required 
                autocomplete="off" 
                autocapitalize="characters" 
                class="input-code"
              />
            </div>

            <div class="form-group">
              <label for="txtName">Your Name:</label>
              <input 
                type="text" 
                id="txtName" 
                maxlength="16" 
                placeholder="Enter nickname" 
                value="${localStorage.getItem('np_player_name') || ''}" 
                required 
                class="input-text"
              />
            </div>

            <div class="form-group">
              <label>Choose Avatar:</label>
              <div class="avatar-selector" id="avatarSelector">
                ${AVATARS.map(av => `
                  <button type="button" class="avatar-btn ${av === randomAvatar ? 'selected' : ''}" data-avatar="${av}">
                    ${av}
                  </button>
                `).join('')}
              </div>
              <input type="hidden" id="selectedAvatar" value="${randomAvatar}" />
            </div>

            <button type="submit" class="btn-primary-large" id="btnConnectRoom">
              <span>Connect to Game 🚀</span>
            </button>
          </form>

          <div class="join-footer">
            <button class="btn-link" id="btnBackLanding">← Back to Main Menu</button>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.avatar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('selectedAvatar').value = btn.dataset.avatar;
      });
    });

    document.getElementById('btnBackLanding')?.addEventListener('click', () => {
      this.renderLandingScreen();
    });

    document.getElementById('joinForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      initAudio();

      const roomCode = sanitizeRoomCode(document.getElementById('txtRoom').value);
      const name = document.getElementById('txtName').value.trim() || 'Player';
      const avatar = document.getElementById('selectedAvatar').value;

      localStorage.setItem('np_player_name', name);
      await this.startClientMode(roomCode, name, avatar);
    });
  }

  /* ========================================================
     HOST MODE COORDINATOR
     ======================================================== */
  async startHostMode() {
    const roomCode = generateRoomCode();
    this.container.innerHTML = `
      <div class="loading-screen">
        <div class="radar-scan"></div>
        <h2>Setting up Room ${roomCode}...</h2>
        <p>Connecting to WebRTC peer signaling...</p>
      </div>
    `;

    try {
      this.hostSession = new HostSession(roomCode);
      await this.hostSession.start();

      this.launchHostHub();
    } catch (err) {
      console.error('Failed to host room:', err);
      alert('Could not start room: ' + err.message);
      this.renderLandingScreen();
    }
  }

  launchHostHub() {
    this.activeGameId = 'hub';
    this.hostSession.broadcastEvent('SWITCH_GAME', { gameId: 'hub' });

    this.activeHostGame = new PartyHub(this.hostSession, this.container, (selectedGameId) => {
      this.launchHostGame(selectedGameId);
    });
    this.activeHostGame.render();
  }

  launchHostGame(gameId) {
    this.activeGameId = gameId;
    this.hostSession.broadcastEvent('SWITCH_GAME', { gameId });

    const returnHub = () => this.launchHostHub();

    // 1. Social Deduction
    if (gameId === 'spyfall') {
      this.activeHostGame = new SpyfallHost(this.hostSession, this.container, returnHub);
    } else if (gameId === 'mafia') {
      this.activeHostGame = new MafiaHost(this.hostSession, this.container, returnHub);
    } 
    // 2. Party Antics
    else if (gameId === 'fake-artist') {
      this.activeHostGame = new FakeArtistHost(this.hostSession, this.container, returnHub);
    } else if (gameId === 'most-likely') {
      this.activeHostGame = new MostLikelyHost(this.hostSession, this.container, returnHub);
    } else if (gameId === 'fivesec') {
      this.activeHostGame = new FiveSecHost(this.hostSession, this.container, returnHub);
    } else if (gameId === 'secret-names') {
      this.activeHostGame = new SecretNamesHost(this.hostSession, this.container, returnHub);
    }
    // 3. NetplayJS Arcade & Action
    else if (gameId === 'pong') {
      this.activeHostGame = new PongHost(this.hostSession, this.container, returnHub);
    } else if (gameId === 'square-tag') {
      this.activeHostGame = new SquareTagHost(this.hostSession, this.container, returnHub);
    } else if (gameId === 'connect4') {
      this.activeHostGame = new Connect4Host(this.hostSession, this.container, returnHub);
    }

    if (this.activeHostGame) {
      this.activeHostGame.render();
    }
  }

  /* ========================================================
     CLIENT / CONTROLLER MODE COORDINATOR
     ======================================================== */
  async startClientMode(roomCode, name, avatar) {
    this.container.innerHTML = `
      <div class="loading-screen">
        <div class="radar-scan"></div>
        <h2>Connecting to Room ${roomCode}...</h2>
        <p>Handshaking with host screen...</p>
      </div>
    `;

    try {
      this.clientSession = new ClientSession(roomCode, name, avatar);

      this.clientSession.on('event', (eventType, payload) => {
        if (eventType === 'SWITCH_GAME') {
          this.switchClientController(payload.gameId);
        }
      });

      this.clientSession.on('stateUpdate', (state) => {
        if (state.game && state.game !== this.activeGameId) {
          this.switchClientController(state.game);
        }
      });

      this.clientSession.on('privatePayload', (data) => {
        if (data.game && data.game !== this.activeGameId) {
          this.switchClientController(data.game);
        }
      });

      await this.clientSession.connect();

      this.switchClientController('hub');
    } catch (err) {
      console.error('Failed to join room:', err);
      alert('Could not join room ' + roomCode + '. Make sure the host screen is open and room code is correct.');
      this.renderJoinScreen(roomCode);
    }
  }

  switchClientController(gameId) {
    this.activeGameId = gameId;

    if (gameId === 'hub') {
      this.renderClientHubWait();
    } 
    // Social
    else if (gameId === 'spyfall') {
      this.activeControllerGame = new SpyfallController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } else if (gameId === 'mafia') {
      this.activeControllerGame = new MafiaController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } 
    // Party
    else if (gameId === 'fake-artist') {
      this.activeControllerGame = new FakeArtistController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } else if (gameId === 'most-likely') {
      this.activeControllerGame = new MostLikelyController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } else if (gameId === 'fivesec') {
      this.activeControllerGame = new FiveSecController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } else if (gameId === 'secret-names') {
      this.activeControllerGame = new SecretNamesController(this.clientSession, this.container);
      this.activeControllerGame.render();
    }
    // Arcade
    else if (gameId === 'pong') {
      this.activeControllerGame = new PongController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } else if (gameId === 'square-tag') {
      this.activeControllerGame = new SquareTagController(this.clientSession, this.container);
      this.activeControllerGame.render();
    } else if (gameId === 'connect4') {
      this.activeControllerGame = new Connect4Controller(this.clientSession, this.container);
      this.activeControllerGame.render();
    }
  }

  renderClientHubWait() {
    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${this.clientSession.avatar} ${this.clientSession.playerName}</div>
          <div class="room-pill">${this.clientSession.roomCode}</div>
        </header>

        <div class="controller-body" style="justify-content:center; align-items:center;">
          <div class="glass-card lobby-wait-card" style="text-align:center; padding:36px 20px; width:100%;">
            <div class="pulse-ring"></div>
            <h2>You're In the Room!</h2>
            <p style="color:var(--text-secondary); margin-top:8px;">
              Look at the main screen. The host is picking the game!
            </p>
          </div>
        </div>
      </div>
    `;
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
