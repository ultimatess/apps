import { installLocalNetIfRequested } from './netplay/local-peer.js';
import { generateRoomCode, sanitizeRoomCode } from './netplay/room-code.js';
import { HostSession, ClientSession, ALLOWED_AVATARS } from './netplay/peer-manager.js';
import { PartyHub, PARTY_GAMES_CATALOG } from './games/hub/party-hub.js';
import { GAME_REGISTRY } from './games/registry.js';
import { initAudio, isMuted, setMuted, playJoin } from './utils/audio.js';
import { requestWakeLock } from './utils/wake-lock.js';
import { escapeHtml, toast, confirmDialog } from './utils/ui.js';

installLocalNetIfRequested();

const AVATARS = ALLOWED_AVATARS;
const HOST_ROOM_KEY = 'np_host_room';
const JOIN_KEY = 'np_join';

function readJson(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch (e) { return null; }
}

function writeJson(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

class App {
  constructor() {
    this.container = document.getElementById('app');
    this.hostSession = null;
    this.clientSession = null;
    this.activeHostGame = null;
    this.activeHostScope = null;
    this.activeControllerGame = null;
    this.activeControllerScope = null;
    this.activeGameId = 'hub';

    this.init();
  }

  init() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = sanitizeRoomCode(params.get('room'));
    const savedJoin = readJson(sessionStorage, JOIN_KEY);
    const savedHostRoom = sessionStorage.getItem(HOST_ROOM_KEY);

    if (roomParam && savedJoin && savedJoin.room === roomParam) {
      // Refreshed phone: slide straight back into the room as the same player.
      this.startClientMode(savedJoin.room, savedJoin.name, savedJoin.avatar);
    } else if (roomParam) {
      this.renderJoinScreen(roomParam);
    } else if (savedHostRoom) {
      // Refreshed TV: reclaim the same room code so phones reconnect on their own.
      this.startHostMode(savedHostRoom);
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
          <p class="hero-subtitle">One big screen. Everyone's phone is the controller. No apps, no accounts.</p>
        </div>

        <div class="game-showcase-badge">
          <span class="badge-new">${PARTY_GAMES_CATALOG.length} MULTIPLAYER GAMES</span>
          <span class="game-title">Social Deduction • Party & Quiz • 60fps Arcade Duels</span>
        </div>

        <div class="mode-cards-grid">
          <div class="mode-card card-host" id="cardHost">
            <div class="card-icon">📺</div>
            <h2>Host on TV / Laptop</h2>
            <p>Open this on the big screen everyone can see. You get a room code and QR code to join.</p>
            <button class="btn-primary-large" id="btnStartHosting">
              <span>👑 Create Room</span>
            </button>
          </div>

          <div class="mode-card card-join" id="cardJoin">
            <div class="card-icon">📱</div>
            <h2>Join from Phone</h2>
            <p>Scan the QR code on the TV, or enter the 4-letter room code shown on the big screen.</p>
            <button class="btn-secondary-large" id="btnGoToJoin">
              <span>🎟️ Join Room</span>
            </button>
          </div>
        </div>

        <ol class="how-it-works">
          <li><strong>1.</strong> Create a room on the TV</li>
          <li><strong>2.</strong> Friends scan the QR code</li>
          <li><strong>3.</strong> Pick a game and play</li>
        </ol>
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

  renderJoinScreen(prefillRoom = '', errorMessage = '') {
    const savedAvatar = localStorage.getItem('np_player_avatar');
    const startAvatar = AVATARS.includes(savedAvatar) ? savedAvatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const savedName = localStorage.getItem('np_player_name') || '';

    this.container.innerHTML = `
      <div class="join-screen-wrapper">
        <div class="join-card glass-card">
          <div class="join-header">
            <span class="logo-icon">🎟️</span>
            <h2>Join the Party</h2>
            <p class="subtitle">Enter the room code shown on the TV</p>
          </div>

          ${errorMessage ? `<div class="join-error" role="alert">${escapeHtml(errorMessage)}</div>` : ''}

          <form id="joinForm" class="join-form" novalidate>
            <div class="form-group">
              <label for="txtRoom">Room Code</label>
              <input type="text" id="txtRoom" maxlength="6" placeholder="ABCD" value="${escapeHtml(prefillRoom)}"
                required autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" class="input-code" />
            </div>

            <div class="form-group">
              <label for="txtName">Your Name</label>
              <input type="text" id="txtName" maxlength="16" placeholder="Nickname" value="${escapeHtml(savedName)}"
                required autocomplete="nickname" enterkeyhint="go" class="input-text" />
            </div>

            <div class="form-group">
              <label>Pick an Avatar</label>
              <div class="avatar-selector" id="avatarSelector">
                ${AVATARS.map(av => `
                  <button type="button" class="avatar-btn ${av === startAvatar ? 'selected' : ''}" data-avatar="${av}" aria-label="Avatar ${av}">${av}</button>
                `).join('')}
              </div>
              <input type="hidden" id="selectedAvatar" value="${startAvatar}" />
            </div>

            <button type="submit" class="btn-primary-large" id="btnConnectRoom">
              <span>Join Game 🚀</span>
            </button>
          </form>

          <div class="join-footer">
            <button class="btn-link" id="btnBackLanding">← Back</button>
          </div>
        </div>
      </div>
    `;

    const txtRoom = document.getElementById('txtRoom');
    const txtName = document.getElementById('txtName');
    txtRoom.addEventListener('input', () => {
      txtRoom.value = sanitizeRoomCode(txtRoom.value);
    });
    (prefillRoom ? txtName : txtRoom).focus();

    document.querySelectorAll('.avatar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('selectedAvatar').value = btn.dataset.avatar;
      });
    });

    document.getElementById('btnBackLanding')?.addEventListener('click', () => {
      history.replaceState(null, '', this.urlWithoutRoom());
      this.renderLandingScreen();
    });

    document.getElementById('joinForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      initAudio();

      const roomCode = sanitizeRoomCode(txtRoom.value);
      const name = txtName.value.trim();
      if (roomCode.length < 4) {
        toast('Enter the 4-letter room code from the TV', { tone: 'warn' });
        txtRoom.focus();
        return;
      }
      if (!name) {
        toast('Enter a nickname so friends know who you are', { tone: 'warn' });
        txtName.focus();
        return;
      }
      const avatar = document.getElementById('selectedAvatar').value;

      localStorage.setItem('np_player_name', name);
      localStorage.setItem('np_player_avatar', avatar);
      this.startClientMode(roomCode, name, avatar);
    });
  }

  urlWithoutRoom() {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    return url.toString();
  }

  /* ========================================================
     HOST MODE COORDINATOR
     ======================================================== */
  async startHostMode(reclaimCode = null) {
    const roomCode = reclaimCode || generateRoomCode();
    this.container.innerHTML = `
      <div class="loading-screen">
        <div class="radar-scan"></div>
        <h2>${reclaimCode ? 'Reopening' : 'Setting up'} Room ${escapeHtml(roomCode)}...</h2>
        <p>Connecting to the peer-to-peer network...</p>
      </div>
    `;

    // A reclaimed code may still be held by the signaling server for a few seconds.
    const attempts = reclaimCode ? 5 : 3;
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      const code = reclaimCode || (i === 0 ? roomCode : generateRoomCode());
      try {
        const session = new HostSession(code);
        await session.start();
        this.hostSession = session;
        document.body.classList.add('is-host');
        sessionStorage.setItem(HOST_ROOM_KEY, code);
        // Refresh / close: tell phones right away so they start reconnecting instantly.
        window.addEventListener('pagehide', () => session.notifyReloading(), { once: true });
        this.attachHostSessionEvents();
        this.renderHostDock();
        this.launchHostHub();
        return;
      } catch (err) {
        lastErr = err;
        if (err.type !== 'unavailable-id') break;
        await new Promise(r => setTimeout(r, reclaimCode ? 1500 : 200));
      }
    }

    console.error('Failed to host room:', lastErr);
    sessionStorage.removeItem(HOST_ROOM_KEY);
    this.renderLandingScreen();
    toast(`Could not open a room: ${lastErr?.message || 'network error'}. Check your internet and try again.`, { tone: 'error', duration: 5000 });
  }

  attachHostSessionEvents() {
    const s = this.hostSession;
    s.on('playerJoin', (p) => {
      playJoin();
      toast(`${p.avatar} ${p.name} joined`);
    });
    s.on('playerReconnect', (p) => toast(`${p.avatar} ${p.name} is back`));
    s.on('playerDisconnect', (p) => toast(`${p.avatar} ${p.name} lost connection, holding their seat...`, { tone: 'warn' }));
    s.on('playerLeave', (p) => toast(`${p.avatar} ${p.name} left the room`, { tone: 'warn' }));
    s.on('rosterChange', () => this.updateHostDock());
    s.on('signalingLost', () => toast('Network hiccup: reconnecting so new players can join...', { tone: 'warn' }));
  }

  renderHostDock() {
    let dock = document.getElementById('hostDock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'hostDock';
      document.body.appendChild(dock);
    }
    dock.innerHTML = `
      <button class="dock-btn" id="dockHome" title="Back to game lobby">🏠 Lobby</button>
      <span class="dock-room" title="Room code">ROOM <strong>${escapeHtml(this.hostSession.roomCode)}</strong></span>
      <span class="dock-players" id="dockPlayers"></span>
      <button class="dock-btn" id="dockMute" title="Toggle sound">${isMuted() ? '🔇' : '🔊'}</button>
      <button class="dock-btn" id="dockFullscreen" title="Fullscreen">⛶</button>
    `;
    dock.querySelector('#dockHome').addEventListener('click', async () => {
      if (this.activeGameId === 'hub') return;
      if (await confirmDialog('Leave this game and return to the lobby? Progress in this game will be lost.', { confirmLabel: 'Back to Lobby' })) {
        this.launchHostHub();
      }
    });
    dock.querySelector('#dockMute').addEventListener('click', (e) => {
      setMuted(!isMuted());
      e.currentTarget.textContent = isMuted() ? '🔇' : '🔊';
      if (!isMuted()) initAudio();
    });
    dock.querySelector('#dockFullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    this.updateHostDock();
  }

  updateHostDock() {
    const el = document.getElementById('dockPlayers');
    if (!el || !this.hostSession) return;
    const players = this.hostSession.getPlayers();
    const offline = players.filter(p => !p.connected).length;
    el.innerHTML = `👥 ${players.length}${offline ? ` <span class="dock-offline">(${offline} reconnecting)</span>` : ''}`;
    document.getElementById('dockHome')?.classList.toggle('is-hidden', this.activeGameId === 'hub');
  }

  teardownHostGame() {
    try { this.activeHostGame?.destroy?.(); } catch (e) { console.error(e); }
    this.activeHostScope?.dispose();
    this.activeHostGame = null;
    this.activeHostScope = null;
  }

  launchHostHub() {
    this.teardownHostGame();
    this.activeGameId = 'hub';
    this.hostSession.setGame('hub');

    this.activeHostScope = this.hostSession.scope();
    this.activeHostGame = new PartyHub(this.activeHostScope, this.container, (gameId) => this.launchHostGame(gameId));
    this.activeHostGame.render();
    this.activeHostGame.syncState();
    this.updateHostDock();
  }

  launchHostGame(gameId) {
    const entry = GAME_REGISTRY[gameId];
    if (!entry) return;

    this.teardownHostGame();
    this.activeGameId = gameId;
    this.hostSession.setGame(gameId);

    this.activeHostScope = this.hostSession.scope();
    this.activeHostGame = new entry.Host(this.activeHostScope, this.container, () => this.launchHostHub());
    this.activeHostGame.render();
    // Give every phone the game's opening screen right away (and cache it for late joiners).
    this.activeHostGame.syncState?.();
    window.scrollTo(0, 0);
    this.updateHostDock();
  }

  /* ========================================================
     CLIENT / CONTROLLER MODE COORDINATOR
     ======================================================== */
  async startClientMode(roomCode, name, avatar) {
    this.container.innerHTML = `
      <div class="loading-screen">
        <div class="radar-scan"></div>
        <h2>Joining Room ${escapeHtml(roomCode)}...</h2>
        <p>Connecting to the host screen...</p>
      </div>
    `;

    this.clientSession?.destroy();
    const session = new ClientSession(roomCode, name, avatar);
    this.clientSession = session;

    session.on('connected', (ack) => {
      writeJson(sessionStorage, JOIN_KEY, { room: session.roomCode, name: session.playerName, avatar: session.avatar });
      const url = new URL(window.location.href);
      url.searchParams.set('room', session.roomCode);
      history.replaceState(null, '', url.toString());
      requestWakeLock();
      this.switchClientController(ack.gameId || 'hub');
    });

    session.on('event', (eventType, payload) => {
      if (eventType === 'SWITCH_GAME') this.switchClientController(payload.gameId);
    });

    session.on('disconnected', () => this.showNetOverlay('Connection lost', 'Reconnecting to the TV...'));
    session.on('reconnecting', (attempt) => this.showNetOverlay('Reconnecting...', `Attempt ${attempt}. Keep this screen open.`));
    session.on('reconnected', (ack) => {
      this.hideNetOverlay();
      toast('Back in the game!', { tone: 'success' });
      if ((ack.gameId || 'hub') !== this.activeGameId) this.switchClientController(ack.gameId || 'hub');
    });
    session.on('closed', (reason) => {
      sessionStorage.removeItem(JOIN_KEY);
      if (!session.everConnected) return; // join screen already shows why (e.g. room full)
      this.showNetOverlay('Disconnected', reason || 'The room is closed.', true);
    });

    try {
      await session.connect();
    } catch (err) {
      console.error('Failed to join room:', err);
      if (this.clientSession === session) {
        session.destroy();
        this.clientSession = null;
      }
      sessionStorage.removeItem(JOIN_KEY);
      this.renderJoinScreen(roomCode, err.message || `Could not join room ${roomCode}. Make sure the TV is showing the room.`);
    }
  }

  showNetOverlay(title, message, final = false) {
    let el = document.getElementById('netOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'netOverlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="net-overlay-card">
        ${final ? '<div class="net-icon">📴</div>' : '<div class="radar-scan small"></div>'}
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${final ? '<button class="btn-primary" id="btnRejoin">Rejoin</button>' : ''}
      </div>
    `;
    el.classList.add('visible');
    el.querySelector('#btnRejoin')?.addEventListener('click', () => {
      this.hideNetOverlay();
      const room = this.clientSession?.roomCode || '';
      this.teardownController();
      this.clientSession?.destroy();
      this.clientSession = null;
      this.renderJoinScreen(room);
    });
  }

  hideNetOverlay() {
    document.getElementById('netOverlay')?.classList.remove('visible');
  }

  teardownController() {
    try { this.activeControllerGame?.destroy?.(); } catch (e) { console.error(e); }
    this.activeControllerScope?.dispose();
    this.activeControllerGame = null;
    this.activeControllerScope = null;
  }

  switchClientController(gameId) {
    if (!this.clientSession) return;
    this.teardownController();
    this.activeGameId = gameId;
    window.scrollTo(0, 0);

    if (gameId === 'hub' || !GAME_REGISTRY[gameId]) {
      this.activeControllerScope = this.clientSession.scope('hub');
      this.activeControllerScope.on('stateUpdate', (state) => this.renderClientHubWait(state));
      this.renderClientHubWait(null);
      return;
    }

    this.activeControllerScope = this.clientSession.scope(gameId);
    this.activeControllerGame = new GAME_REGISTRY[gameId].Controller(this.activeControllerScope, this.container);
    this.activeControllerGame.render();
  }

  renderClientHubWait(state) {
    if (state) this.hubState = state;
    const players = this.hubState?.players || [];
    const s = this.clientSession;

    this.container.innerHTML = `
      <div class="controller-screen">
        <header class="controller-header">
          <div class="user-pill">${s.avatar} ${escapeHtml(s.playerName)}</div>
          <div class="room-pill">ROOM ${escapeHtml(s.roomCode)}</div>
        </header>

        <div class="controller-body">
          <div class="glass-card lobby-wait-card">
            <div class="pulse-ring"></div>
            <h2>You're in!</h2>
            <p class="subtitle">Look at the TV. The host is picking a game and your phone will switch automatically.</p>
          </div>

          ${players.length ? `
            <div class="glass-card">
              <h4 class="section-title">In the room (${players.length})</h4>
              <div class="roster-grid">
                ${players.map(p => `
                  <div class="roster-item ${p.id === s.playerId ? 'self' : ''} ${p.connected === false ? 'offline' : ''}">
                    <span>${p.avatar}</span>
                    <span>${escapeHtml(p.name)}${p.id === s.playerId ? ' (You)' : ''}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <button class="btn-link" id="btnLeaveRoom">Leave room</button>
        </div>
      </div>
    `;

    document.getElementById('btnLeaveRoom')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Leave this room?', { confirmLabel: 'Leave' }))) return;
      sessionStorage.removeItem(JOIN_KEY);
      this.teardownController();
      this.clientSession?.destroy();
      this.clientSession = null;
      history.replaceState(null, '', this.urlWithoutRoom());
      this.renderLandingScreen();
    });
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
