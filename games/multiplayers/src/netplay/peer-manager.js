import { getPeerIdForRoom, sanitizeRoomCode } from './room-code.js';
import { cleanText } from '../utils/ui.js';

/**
 * Netplay-Party WebRTC Peer Manager (based on PeerJS)
 * Star topology: the host screen is the single authority. Players are keyed by a stable
 * client id (kept in sessionStorage) so a refreshed / sleeping phone rejoins as the same
 * player, and the host replays the current game + state to anyone who (re)joins.
 */

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

const MAX_PLAYERS = 16;
const HEARTBEAT_MS = 3000;
const STALE_MS = 12000; // no traffic for this long => treat as disconnected
const LEAVE_GRACE_MS = 45000; // disconnected players keep their seat this long
const HOST_SILENCE_MS = 10000; // phone gives up on a silent host after this long
export const ALLOWED_AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐨', '🐸', '🐙', '🦄', '🐲', '🚀', '⚡', '🕵️‍♂️', '🦖', '🐧', '👽', '🤖'];

class Emitter {
  constructor(events) {
    this.eventHandlers = {};
    events.forEach(e => { this.eventHandlers[e] = []; });
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) return () => {};
    this.eventHandlers[event].push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const list = this.eventHandlers[event];
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  emit(event, ...args) {
    (this.eventHandlers[event] || []).slice().forEach(fn => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[Netplay] "${event}" handler failed:`, err);
      }
    });
  }
}

export class HostSession extends Emitter {
  constructor(roomCode, options = {}) {
    super(['playerJoin', 'playerLeave', 'playerDisconnect', 'playerReconnect', 'playerAction', 'rosterChange', 'open', 'error', 'signalingLost']);
    this.roomCode = sanitizeRoomCode(roomCode);
    this.peerId = getPeerIdForRoom(this.roomCode);
    this.options = options;
    this.peer = null;
    this.clients = new Map(); // playerId -> { id, name, avatar, conn, latency, connected, lastSeen }
    this.pingInterval = null;
    this.currentGameId = 'hub';
    this.lastPublicState = null;
    this.lastPrivateState = new Map();
    this.leaveTimers = new Map();
  }

  async start() {
    if (!window.Peer) {
      throw new Error('PeerJS is not loaded. Check your internet connection and reload.');
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      this.peer = new window.Peer(this.peerId, {
        debug: 1,
        config: { iceServers: DEFAULT_STUN }
      });

      this.peer.on('open', (id) => {
        console.log(`[HostSession] Room open: ${this.roomCode} (PeerID: ${id})`);
        this.emit('open', { roomCode: this.roomCode, peerId: id });
        if (!this.pingInterval) this.startHeartbeat();
        if (!settled) {
          settled = true;
          resolve(id);
        }
      });

      this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));

      // Lost the signaling server (wifi blip). Existing data channels keep working,
      // but new players can't join until we re-register.
      this.peer.on('disconnected', () => {
        if (this.destroyed) return;
        this.emit('signalingLost');
        setTimeout(() => {
          try {
            if (!this.destroyed && this.peer && this.peer.disconnected) this.peer.reconnect();
          } catch (e) { /* ignore */ }
        }, 1500);
      });

      this.peer.on('error', (err) => {
        console.error('[HostSession] Peer error:', err);
        this.emit('error', err);
        if (settled) return;
        settled = true;
        if (err.type === 'unavailable-id') {
          const e = new Error(`Room code ${this.roomCode} is already active.`);
          e.type = 'unavailable-id';
          reject(e);
        } else {
          reject(err);
        }
      });
    });
  }

  handleIncomingConnection(conn) {
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;

      if (data.type === 'HANDSHAKE') {
        this.handleHandshake(conn, data);
        return;
      }

      const player = this.findPlayerByConn(conn);
      if (!player) return;
      player.lastSeen = Date.now();

      if (data.type === 'PONG') {
        if (data.ts) player.latency = Math.max(1, Math.round(Date.now() - data.ts));
      } else if (data.type === 'ACTION' && typeof data.action === 'string') {
        this.emit('playerAction', player.id, data.action, data.payload && typeof data.payload === 'object' ? data.payload : {});
      }
    });

    conn.on('close', () => this.handleConnClosed(conn));
    conn.on('error', (err) => console.warn(`[HostSession] Connection error (${conn.peer}):`, err));
  }

  findPlayerByConn(conn) {
    for (const player of this.clients.values()) {
      if (player.conn === conn) return player;
    }
    return null;
  }

  handleHandshake(conn, data) {
    let id = cleanText(data.clientId || conn.peer, 64) || conn.peer;
    let existing = this.clients.get(id);
    // Reclaiming a seat requires the private resume token issued to that seat; ids are
    // public (they are in every roster broadcast), so an id alone must never be enough.
    if (existing && (!data.resumeToken || data.resumeToken !== existing.resumeToken)) {
      id = `${id.slice(0, 40)}-${randomToken(6)}`;
      existing = null;
    }

    if (!existing && this.clients.size >= MAX_PLAYERS) {
      this.safeSend(conn, { type: 'REJECTED', reason: `Room is full (${MAX_PLAYERS} players max).` });
      setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 300);
      return;
    }

    const avatar = ALLOWED_AVATARS.includes(data.avatar) ? data.avatar : '👤';
    const requestedName = cleanText(data.name, 16) || 'Player';

    if (existing) {
      if (existing.conn && existing.conn !== conn) {
        try { existing.conn.close(); } catch (e) { /* ignore */ }
      }
      existing.conn = conn;
      existing.connected = true;
      existing.lastSeen = Date.now();
      existing.avatar = avatar;
      this.clearLeaveTimer(id);
    } else {
      this.clients.set(id, {
        id,
        name: this.uniqueName(requestedName),
        avatar,
        conn,
        latency: 0,
        score: 0,
        connected: true,
        lastSeen: Date.now(),
        joinedAt: Date.now(),
        resumeToken: randomToken(16)
      });
    }

    const player = this.clients.get(id);
    this.safeSend(conn, {
      type: 'HANDSHAKE_ACK',
      playerId: player.id,
      resumeToken: player.resumeToken,
      name: player.name,
      roomCode: this.roomCode,
      gameId: this.currentGameId
    });

    // Replay the current screen so late joiners / reconnecting phones are never stuck.
    if (this.lastPublicState) this.safeSend(conn, { type: 'STATE_UPDATE', state: this.lastPublicState });
    if (this.lastPrivateState.has(id)) this.safeSend(conn, { type: 'PRIVATE_PAYLOAD', data: this.lastPrivateState.get(id) });

    this.emit(existing ? 'playerReconnect' : 'playerJoin', player);
    this.emit('rosterChange');
  }

  uniqueName(name) {
    const taken = new Set([...this.clients.values()].map(p => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 100; n++) {
      const candidate = `${name.slice(0, 13)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  handleConnClosed(conn) {
    const player = this.findPlayerByConn(conn);
    if (!player) return;
    this.markDisconnected(player);
  }

  markDisconnected(player) {
    if (!player.connected) return;
    player.connected = false;
    const staleConn = player.conn;
    player.conn = null;
    // Close a half-dead channel so the phone notices and reconnects.
    try { staleConn?.close(); } catch (e) { /* ignore */ }
    this.emit('playerDisconnect', player);
    this.emit('rosterChange');
    this.clearLeaveTimer(player.id);
    this.leaveTimers.set(player.id, setTimeout(() => this.removePlayer(player.id), LEAVE_GRACE_MS));
  }

  clearLeaveTimer(id) {
    if (this.leaveTimers.has(id)) {
      clearTimeout(this.leaveTimers.get(id));
      this.leaveTimers.delete(id);
    }
  }

  removePlayer(id) {
    const player = this.clients.get(id);
    if (!player) return;
    this.clearLeaveTimer(id);
    if (player.conn) {
      this.safeSend(player.conn, { type: 'KICKED' });
      try { player.conn.close(); } catch (e) { /* ignore */ }
    }
    this.clients.delete(id);
    this.lastPrivateState.delete(id);
    this.emit('playerLeave', player);
    this.emit('rosterChange');
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const client of this.clients.values()) {
        if (!client.connected) continue;
        if (now - client.lastSeen > STALE_MS) {
          this.markDisconnected(client);
          continue;
        }
        this.safeSend(client.conn, { type: 'PING', ts: now });
      }
    }, HEARTBEAT_MS);
  }

  safeSend(conn, packet) {
    if (!conn || !conn.open) return false;
    try {
      conn.send(packet);
      return true;
    } catch (e) {
      console.warn('[HostSession] send failed:', e);
      return false;
    }
  }

  /** Players currently in the room (connected or within their reconnect grace period). */
  getPlayers() {
    return Array.from(this.clients.values());
  }

  /** Switch every phone to a new game and reset the replay cache. */
  setGame(gameId) {
    this.currentGameId = gameId;
    this.lastPublicState = null;
    this.lastPrivateState.clear();
    this.broadcastEvent('SWITCH_GAME', { gameId });
  }

  /** Broadcast sanitized public state to all connected players */
  broadcastPublicState(state) {
    this.lastPublicState = state;
    const packet = { type: 'STATE_UPDATE', state };
    for (const client of this.clients.values()) this.safeSend(client.conn, packet);
  }

  /** Send private secret information strictly to ONE player's DataChannel */
  sendPrivateState(playerId, privateData) {
    this.lastPrivateState.set(playerId, privateData);
    const client = this.clients.get(playerId);
    if (client) this.safeSend(client.conn, { type: 'PRIVATE_PAYLOAD', data: privateData });
  }

  /** Broadcast an event (sound effect trigger, animation cue, round over) */
  broadcastEvent(eventType, payload = {}) {
    const packet = { type: 'EVENT', eventType, payload };
    for (const client of this.clients.values()) this.safeSend(client.conn, packet);
  }

  kick(playerId) {
    this.removePlayer(playerId);
  }

  /**
   * A per-game view of the session. Every listener registered through it is removed by
   * dispose(), so a game that has been left can never react to (or render over) the next one.
   */
  scope() {
    const base = this;
    const offs = [];
    return {
      get roomCode() { return base.roomCode; },
      get clients() { return base.clients; },
      getPlayers: () => base.getPlayers(),
      on(event, handler) {
        const off = base.on(event, handler);
        offs.push(off);
        return off;
      },
      broadcastPublicState: (state) => base.broadcastPublicState(state),
      sendPrivateState: (id, data) => base.sendPrivateState(id, data),
      broadcastEvent: (type, payload) => base.broadcastEvent(type, payload),
      kick: (id) => base.kick(id),
      dispose() {
        offs.splice(0).forEach(off => off());
      }
    };
  }

  /** The TV is refreshing: phones should reconnect rather than give up. */
  notifyReloading() {
    for (const client of this.clients.values()) this.safeSend(client.conn, { type: 'HOST_RELOADING' });
    this.destroyed = true;
    clearInterval(this.pingInterval);
    try { this.peer?.destroy(); } catch (e) { /* ignore */ }
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.pingInterval);
    for (const client of this.clients.values()) {
      this.safeSend(client.conn, { type: 'ROOM_CLOSED' });
      try { client.conn?.close(); } catch (e) { /* ignore */ }
    }
    this.leaveTimers.forEach(t => clearTimeout(t));
    this.clients.clear();
    if (this.peer) this.peer.destroy();
  }
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return Array.from(bytes, b => (b % 36).toString(36)).join('');
}

function getStableClientId() {
  const KEY = 'np_client_id';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = `p-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    return `p-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export class ClientSession extends Emitter {
  constructor(roomCode, playerName, avatar = '👤') {
    super(['connected', 'stateUpdate', 'privatePayload', 'event', 'disconnected', 'reconnecting', 'reconnected', 'closed', 'error']);
    this.roomCode = sanitizeRoomCode(roomCode);
    this.hostPeerId = getPeerIdForRoom(this.roomCode);
    this.playerName = cleanText(playerName, 16) || 'Player';
    this.avatar = avatar;
    this.clientId = getStableClientId();
    this.playerId = this.clientId;
    this.peer = null;
    this.hostConn = null;
    this.isConnected = false;
    this.everConnected = false;
    this.closed = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.currentGameId = 'hub';
    this.lastHostMessageAt = 0;

    // Watchdog: the host pings every few seconds. Silence means the TV died or the wifi
    // dropped without a clean close, so start reconnecting instead of hanging forever.
    this.watchdog = setInterval(() => {
      if (this.isConnected && Date.now() - this.lastHostMessageAt > HOST_SILENCE_MS) {
        try { this.hostConn?.close(); } catch (e) { /* ignore */ }
        this.handleLostConnection();
      }
    }, 2000);

    this.onVisibility = () => {
      if (document.visibilityState === 'visible' && !this.isConnected && this.everConnected && !this.closed) {
        this.scheduleReconnect(0);
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Resolves with the HANDSHAKE_ACK payload ({ playerId, gameId, ... }). */
  connect() {
    if (!window.Peer) {
      return Promise.reject(new Error('PeerJS is not loaded. Check your internet connection and reload.'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };
      const timeout = setTimeout(() => fail(new Error('Timed out reaching the host screen.')), 12000);

      const openConnection = () => {
        const conn = this.peer.connect(this.hostPeerId, { reliable: true });
        this.hostConn = conn;

        conn.on('open', () => {
          conn.send({ type: 'HANDSHAKE', clientId: this.clientId, resumeToken: this.loadResumeToken(), name: this.playerName, avatar: this.avatar });
        });

        conn.on('data', (data) => {
          if (!data || typeof data !== 'object' || conn !== this.hostConn) return;
          this.lastHostMessageAt = Date.now();
          switch (data.type) {
            case 'HANDSHAKE_ACK': {
              const firstTime = !this.everConnected;
              this.isConnected = true;
              this.everConnected = true;
              this.reconnectAttempts = 0;
              this.playerId = data.playerId;
              this.clientId = data.playerId;
              this.saveResumeToken(data.playerId, data.resumeToken);
              if (data.name) this.playerName = data.name;
              this.currentGameId = data.gameId || 'hub';
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(data);
              }
              this.emit(firstTime ? 'connected' : 'reconnected', data);
              break;
            }
            case 'REJECTED':
              this.closed = true;
              fail(new Error(data.reason || 'The host rejected the connection.'));
              this.emit('closed', data.reason);
              break;
            case 'PING':
              conn.send({ type: 'PONG', ts: data.ts });
              break;
            case 'STATE_UPDATE':
              this.emit('stateUpdate', data.state);
              break;
            case 'PRIVATE_PAYLOAD':
              this.emit('privatePayload', data.data);
              break;
            case 'EVENT':
              if (data.eventType === 'SWITCH_GAME') this.currentGameId = data.payload?.gameId || 'hub';
              this.emit('event', data.eventType, data.payload);
              break;
            case 'HOST_RELOADING':
              this.handleLostConnection();
              break;
            case 'KICKED':
            case 'ROOM_CLOSED':
              this.closed = true;
              this.isConnected = false;
              this.emit('closed', data.type === 'KICKED' ? 'You were removed from the room.' : 'The host closed the room.');
              break;
            default:
              break;
          }
        });

        conn.on('close', () => {
          if (conn !== this.hostConn) return;
          this.handleLostConnection();
        });

        conn.on('error', (err) => {
          console.error('[ClientSession] Host connection error:', err);
          this.emit('error', err);
        });
      };

      const createPeer = () => {
        const peer = new window.Peer({ debug: 1, config: { iceServers: DEFAULT_STUN } });
        this.peer = peer;
        this.peer.on('open', () => openConnection());
        this.peer.on('error', (err) => {
          console.error('[ClientSession] Peer error:', err);
          this.emit('error', err);
          if (!settled) {
            fail(err.type === 'peer-unavailable'
              ? new Error(`Room ${this.roomCode} was not found. Check the code on the TV.`)
              : err);
          }
        });
        // Bound to this specific peer: destroy() fires 'disconnected' too, and reconnecting a
        // peer that is being torn down would leak a signaling socket on every retry.
        peer.on('disconnected', () => {
          try { if (!this.closed && peer === this.peer && !peer.destroyed) peer.reconnect(); } catch (e) { /* ignore */ }
        });
      };

      if (this.peer && !this.peer.destroyed && this.peer.open) {
        openConnection();
      } else {
        try { this.peer?.destroy(); } catch (e) { /* ignore */ }
        createPeer();
      }
    });
  }

  handleLostConnection() {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    if (wasConnected) {
      const stale = this.hostConn;
      this.hostConn = null;
      try { stale?.close(); } catch (e) { /* ignore */ }
    }
    if (this.closed) return;
    if (wasConnected) this.emit('disconnected');
    this.scheduleReconnect(1000);
  }

  scheduleReconnect(delay) {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.closed || this.isConnected) return;
      this.reconnectAttempts++;
      this.emit('reconnecting', this.reconnectAttempts);
      try {
        // A fresh Peer is the most reliable way back after a phone sleeps.
        this.hostConn = null;
        const old = this.peer;
        this.peer = null;
        try { old?.destroy(); } catch (e) { /* ignore */ }
        await this.connect();
      } catch (err) {
        if (this.reconnectAttempts >= 40) {
          this.closed = true;
          this.emit('closed', 'Lost connection to the host screen.');
          return;
        }
        this.scheduleReconnect(Math.min(5000, 1000 + this.reconnectAttempts * 500));
      }
    }, delay);
  }

  loadResumeToken() {
    try { return sessionStorage.getItem(`np_resume_${this.roomCode}_${this.clientId}`) || null; } catch (e) { return null; }
  }

  saveResumeToken(playerId, token) {
    if (!token) return;
    try {
      sessionStorage.setItem('np_client_id', playerId);
      sessionStorage.setItem(`np_resume_${this.roomCode}_${playerId}`, token);
    } catch (e) { /* ignore */ }
  }

  sendAction(action, payload = {}) {
    if (!this.isConnected || !this.hostConn || !this.hostConn.open) return false;
    try {
      this.hostConn.send({ type: 'ACTION', action, payload });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Per-controller view. Drops state/private payloads tagged for a different game and
   * removes every listener on dispose().
   */
  scope(gameId) {
    const base = this;
    const offs = [];
    const matches = (data) => !data || typeof data !== 'object' || !data.game || data.game === gameId;
    return {
      get roomCode() { return base.roomCode; },
      get playerId() { return base.playerId; },
      get playerName() { return base.playerName; },
      get avatar() { return base.avatar; },
      get isConnected() { return base.isConnected; },
      on(event, handler) {
        const wrapped = (event === 'stateUpdate' || event === 'privatePayload')
          ? (data) => { if (matches(data)) handler(data); }
          : handler;
        const off = base.on(event, wrapped);
        offs.push(off);
        return off;
      },
      sendAction: (action, payload) => base.sendAction(action, payload),
      dispose() {
        offs.splice(0).forEach(off => off());
      }
    };
  }

  destroy() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    document.removeEventListener('visibilitychange', this.onVisibility);
    try { this.hostConn?.close(); } catch (e) { /* ignore */ }
    try { this.peer?.destroy(); } catch (e) { /* ignore */ }
    this.isConnected = false;
  }
}
