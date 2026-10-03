/**
 * LocalPeer: a drop-in stand-in for the subset of the PeerJS API that peer-manager uses,
 * carried over BroadcastChannel. Enable with `?net=local` to play across tabs of one
 * browser with no internet / signaling server (offline demos and automated E2E tests).
 */

const CHANNEL = 'netplay-party-local-net';
const PROBE_MS = 150;
const CONNECT_TIMEOUT_MS = 3000;

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

class Emitter {
  constructor() {
    this.handlers = {};
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
    return this;
  }

  emit(event, ...args) {
    (this.handlers[event] || []).slice().forEach(fn => fn(...args));
  }
}

class LocalDataConnection extends Emitter {
  constructor(peer, connId, remoteId) {
    super();
    this.localPeer = peer;
    this.connectionId = connId;
    this.peer = remoteId;
    this.open = false;
  }

  send(payload) {
    if (!this.open) return;
    this.localPeer.post({ t: 'data', connId: this.connectionId, to: this.peer, from: this.localPeer.id, payload });
  }

  close() {
    if (!this.open && this.closed) return;
    this.localPeer.post({ t: 'close', connId: this.connectionId, to: this.peer, from: this.localPeer.id });
    this.markClosed();
  }

  markClosed() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.localPeer.connections.delete(this.connectionId);
    this.emit('close');
  }
}

export class LocalPeer extends Emitter {
  constructor(id, options) {
    super();
    if (typeof id === 'object' && id !== null) {
      options = id;
      id = undefined;
    }
    this.options = options || {};
    this.id = id || randomId('local');
    this.open = false;
    this.destroyed = false;
    this.disconnected = false;
    this.connections = new Map();
    this.pendingConnects = new Map();
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e) => this.handle(e.data);

    this.idTaken = false;
    this.post({ t: 'probe', id: this.id, nonce: this.nonce = Math.random() });
    setTimeout(() => {
      if (this.destroyed) return;
      if (this.idTaken) {
        const err = new Error(`ID "${this.id}" is taken`);
        err.type = 'unavailable-id';
        this.emit('error', err);
        return;
      }
      this.open = true;
      this.emit('open', this.id);
    }, PROBE_MS);
  }

  post(msg) {
    if (this.destroyed) return;
    try {
      this.channel.postMessage(msg);
    } catch (e) { /* channel closed */ }
  }

  handle(msg) {
    if (!msg || this.destroyed) return;
    switch (msg.t) {
      case 'probe':
        if (msg.id === this.id && msg.nonce !== this.nonce && this.open) this.post({ t: 'taken', id: this.id, nonce: msg.nonce });
        break;
      case 'taken':
        if (msg.id === this.id && msg.nonce === this.nonce) this.idTaken = true;
        break;
      case 'connect': {
        if (msg.to !== this.id || !this.open || this.disconnected) return;
        const conn = new LocalDataConnection(this, msg.connId, msg.from);
        this.connections.set(msg.connId, conn);
        this.emit('connection', conn);
        this.post({ t: 'accept', connId: msg.connId, to: msg.from, from: this.id });
        setTimeout(() => {
          conn.open = true;
          conn.emit('open');
        }, 0);
        break;
      }
      case 'accept': {
        if (msg.to !== this.id) return;
        const pending = this.pendingConnects.get(msg.connId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingConnects.delete(msg.connId);
        pending.conn.open = true;
        pending.conn.emit('open');
        break;
      }
      case 'data': {
        if (msg.to !== this.id) return;
        const conn = this.connections.get(msg.connId);
        if (conn && conn.open) conn.emit('data', msg.payload);
        break;
      }
      case 'close':
      case 'gone': {
        if (msg.t === 'close' && msg.to !== this.id) return;
        for (const conn of [...this.connections.values()]) {
          if ((msg.t === 'close' && conn.connectionId === msg.connId) || (msg.t === 'gone' && conn.peer === msg.from)) {
            conn.markClosed();
          }
        }
        break;
      }
      default:
        break;
    }
  }

  connect(remoteId) {
    const connId = randomId('conn');
    const conn = new LocalDataConnection(this, connId, remoteId);
    this.connections.set(connId, conn);
    const timer = setTimeout(() => {
      this.pendingConnects.delete(connId);
      this.connections.delete(connId);
      const err = new Error(`Could not connect to peer ${remoteId}`);
      err.type = 'peer-unavailable';
      this.emit('error', err);
    }, CONNECT_TIMEOUT_MS);
    this.pendingConnects.set(connId, { conn, timer });
    this.post({ t: 'connect', connId, to: remoteId, from: this.id });
    return conn;
  }

  reconnect() {
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
  }

  destroy() {
    if (this.destroyed) return;
    this.post({ t: 'gone', from: this.id });
    [...this.connections.values()].forEach(conn => conn.markClosed());
    this.destroyed = true;
    this.open = false;
    this.channel.close();
  }
}

export function installLocalNetIfRequested() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('net') !== 'local') return false;
  window.Peer = LocalPeer;
  window.__NETPLAY_LOCAL__ = true;
  return true;
}
