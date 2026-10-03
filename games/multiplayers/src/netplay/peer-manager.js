import { getPeerIdForRoom, sanitizeRoomCode } from './room-code.js';

/**
 * Netplay-Party WebRTC Peer Manager (based on PeerJS)
 * Provides Star-Topology Host Authority and Private Unicast State Distribution.
 */

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

export class HostSession {
  constructor(roomCode, options = {}) {
    this.roomCode = sanitizeRoomCode(roomCode);
    this.peerId = getPeerIdForRoom(this.roomCode);
    this.options = options;
    this.peer = null;
    this.clients = new Map(); // peerId -> { id, name, avatar, conn, lastPing }
    this.eventHandlers = {
      playerJoin: [],
      playerLeave: [],
      playerAction: [],
      open: [],
      error: []
    };
    this.pingInterval = null;
  }

  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }

  emit(event, ...args) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(fn => fn(...args));
    }
  }

  async start() {
    if (!window.Peer) {
      throw new Error('PeerJS is not loaded. Ensure peerjs.min.js is included.');
    }

    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(this.peerId, {
        debug: 1,
        config: { iceServers: DEFAULT_STUN }
      });

      this.peer.on('open', (id) => {
        console.log(`[HostSession] Room open: ${this.roomCode} (PeerID: ${id})`);
        this.emit('open', { roomCode: this.roomCode, peerId: id });
        this.startHeartbeat();
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('[HostSession] Peer error:', err);
        this.emit('error', err);
        // If room code ID is taken, notify host
        if (err.type === 'unavailable-id') {
          reject(new Error(`Room code ${this.roomCode} is already active. Please pick another code.`));
        } else {
          reject(err);
        }
      });
    });
  }

  handleIncomingConnection(conn) {
    console.log(`[HostSession] Incoming connection from: ${conn.peer}`);

    conn.on('open', () => {
      // Waiting for HANDSHAKE message with player info
    });

    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;

      if (data.type === 'HANDSHAKE') {
        const player = {
          id: conn.peer,
          name: (data.name || 'Player').slice(0, 16),
          avatar: data.avatar || '👤',
          conn: conn,
          latency: 0,
          score: 0
        };

        this.clients.set(conn.peer, player);
        conn.send({
          type: 'HANDSHAKE_ACK',
          playerId: player.id,
          roomCode: this.roomCode
        });

        this.emit('playerJoin', player);
      } else if (data.type === 'PONG') {
        const player = this.clients.get(conn.peer);
        if (player && data.ts) {
          player.latency = Math.round(Date.now() - data.ts);
        }
      } else if (data.type === 'ACTION') {
        this.emit('playerAction', conn.peer, data.action, data.payload);
      }
    });

    conn.on('close', () => {
      console.log(`[HostSession] Client disconnected: ${conn.peer}`);
      const player = this.clients.get(conn.peer);
      this.clients.delete(conn.peer);
      if (player) {
        this.emit('playerLeave', player);
      }
    });

    conn.on('error', (err) => {
      console.warn(`[HostSession] Client connection error (${conn.peer}):`, err);
    });
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const [_, client] of this.clients.entries()) {
        try {
          if (client.conn && client.conn.open) {
            client.conn.send({ type: 'PING', ts: now });
          }
        } catch (e) {}
      }
    }, 4000);
  }

  /**
   * Broadcast sanitized public state to all connected players
   */
  broadcastPublicState(state) {
    const packet = { type: 'STATE_UPDATE', state };
    for (const [_, client] of this.clients.entries()) {
      if (client.conn && client.conn.open) {
        try {
          client.conn.send(packet);
        } catch (e) {
          console.warn(`Failed to broadcast to ${client.id}:`, e);
        }
      }
    }
  }

  /**
   * Send private secret information strictly to ONE player's DataChannel
   */
  sendPrivateState(playerId, privateData) {
    const client = this.clients.get(playerId);
    if (client && client.conn && client.conn.open) {
      try {
        client.conn.send({ type: 'PRIVATE_PAYLOAD', data: privateData });
      } catch (e) {
        console.warn(`Failed to send private state to ${playerId}:`, e);
      }
    }
  }

  /**
   * Broadcast an event (sound effect trigger, animation cue, round over)
   */
  broadcastEvent(eventType, payload = {}) {
    const packet = { type: 'EVENT', eventType, payload };
    for (const [_, client] of this.clients.entries()) {
      if (client.conn && client.conn.open) {
        try {
          client.conn.send(packet);
        } catch (e) {}
      }
    }
  }

  destroy() {
    clearInterval(this.pingInterval);
    for (const [_, client] of this.clients.entries()) {
      try {
        client.conn.close();
      } catch (e) {}
    }
    this.clients.clear();
    if (this.peer) {
      this.peer.destroy();
    }
  }
}

export class ClientSession {
  constructor(roomCode, playerName, avatar = '👤') {
    this.roomCode = sanitizeRoomCode(roomCode);
    this.hostPeerId = getPeerIdForRoom(this.roomCode);
    this.playerName = playerName.trim() || 'Player';
    this.avatar = avatar;
    this.peer = null;
    this.hostConn = null;
    this.playerId = null;
    this.isConnected = false;
    this.eventHandlers = {
      connected: [],
      stateUpdate: [],
      privatePayload: [],
      event: [],
      disconnected: [],
      error: []
    };
  }

  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }

  emit(event, ...args) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(fn => fn(...args));
    }
  }

  async connect() {
    if (!window.Peer) {
      throw new Error('PeerJS is not loaded.');
    }

    return new Promise((resolve, reject) => {
      this.peer = new window.Peer({
        debug: 1,
        config: { iceServers: DEFAULT_STUN }
      });

      this.peer.on('open', (id) => {
        this.playerId = id;
        console.log(`[ClientSession] Connected to signaling with ID: ${id}. Connecting to host: ${this.hostPeerId}...`);

        this.hostConn = this.peer.connect(this.hostPeerId, {
          reliable: true
        });

        this.hostConn.on('open', () => {
          console.log(`[ClientSession] DataChannel connected to Host! Sending handshake...`);
          this.isConnected = true;
          this.hostConn.send({
            type: 'HANDSHAKE',
            name: this.playerName,
            avatar: this.avatar
          });
        });

        this.hostConn.on('data', (data) => {
          if (!data || typeof data !== 'object') return;

          if (data.type === 'HANDSHAKE_ACK') {
            console.log(`[ClientSession] Handshake acknowledged by Host!`);
            this.emit('connected', { playerId: this.playerId, roomCode: this.roomCode });
            resolve();
          } else if (data.type === 'PING') {
            this.hostConn.send({ type: 'PONG', ts: data.ts });
          } else if (data.type === 'STATE_UPDATE') {
            this.emit('stateUpdate', data.state);
          } else if (data.type === 'PRIVATE_PAYLOAD') {
            this.emit('privatePayload', data.data);
          } else if (data.type === 'EVENT') {
            this.emit('event', data.eventType, data.payload);
          }
        });

        this.hostConn.on('close', () => {
          console.log('[ClientSession] Host connection closed');
          this.isConnected = false;
          this.emit('disconnected');
        });

        this.hostConn.on('error', (err) => {
          console.error('[ClientSession] Host connection error:', err);
          this.emit('error', err);
        });
      });

      this.peer.on('error', (err) => {
        console.error('[ClientSession] Peer error:', err);
        this.emit('error', err);
        reject(err);
      });
    });
  }

  sendAction(action, payload = {}) {
    if (!this.isConnected || !this.hostConn) {
      console.warn('Cannot send action: not connected to host');
      return;
    }
    this.hostConn.send({
      type: 'ACTION',
      action,
      payload
    });
  }

  destroy() {
    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch (e) {}
    }
    if (this.peer) {
      this.peer.destroy();
    }
    this.isConnected = false;
  }
}
