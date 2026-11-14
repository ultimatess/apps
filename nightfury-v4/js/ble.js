// Web Bluetooth transport: pairing, GATT discovery, chunked writes, notifications and
// automatic reconnection. `bluetooth` is injected so tests can pass a mock.
import { CANDIDATE_CHARACTERISTICS, CANDIDATE_SERVICES, DEVICE_NAME_PREFIXES } from "./protocol.js";

const SYSTEM_SERVICES = ["00001800", "00001801", "0000180a"];
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 15000];

// The timer is cleared once the race settles (v3 left it pending for the full timeout).
const withTimeout = (p, ms, what) => {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

export class BleTransport {
  constructor({ bluetooth, log = () => {}, chunkSize = 20, chunkDelay = 15, sleep } = {}) {
    this.bluetooth = bluetooth;
    this.log = log;
    this._chunkSize = chunkSize; // number, or () => number (Lab setting)
    this.chunkDelay = chunkDelay;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.listeners = new Map();
    this.state = "idle";
    this.device = null;
    this.server = null;
    this.writeChars = [];
    this.notifyChars = [];
    this.userDisconnect = false;
    this.reconnectAttempt = 0;
    this.bytesSent = 0;
    this.writes = 0;
    this._onGattDisconnected = () => this.handleDrop();
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  emit(type, detail) {
    for (const fn of this.listeners.get(type) ?? []) {
      try { fn(detail); } catch (e) { console.error(e); }
    }
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit("state", { state, ...extra });
  }

  get connected() {
    return this.state === "connected";
  }

  get supported() {
    return !!this.bluetooth;
  }

  /** Bytes per GATT write. 20 fits every BLE link; larger values are a Lab experiment. */
  get chunkSize() {
    const v = typeof this._chunkSize === "function" ? this._chunkSize() : this._chunkSize;
    return Math.max(1, Math.min(244, Math.floor(Number(v)) || 20));
  }

  get writeChar() {
    return this.writeChars.find((c) => c.uuid.toLowerCase().includes("fa02")) ?? this.writeChars[0] ?? null;
  }

  async pair({ acceptAll = false } = {}) {
    if (!this.bluetooth) throw new Error("Web Bluetooth unavailable. Use Chrome (Android/desktop) or Bluefy on iPhone.");
    this.userDisconnect = false;
    this.setState("requesting");
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES }
      : { filters: DEVICE_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), optionalServices: CANDIDATE_SERVICES };
    let device;
    try {
      this.log(`Requesting device (${acceptAll ? "all devices" : "LED/iPixel filter"})…`, "ble");
      device = await this.bluetooth.requestDevice(options);
    } catch (err) {
      this.setState(this.device ? "disconnected" : "idle");
      throw err;
    }
    this.adopt(device);
    this.log(`Selected "${device.name || device.id}"`, "ok");
    try {
      await this.connect();
    } catch (err) {
      this.userDisconnect = true; // don't auto-retry a pairing that never succeeded
      if (device.gatt?.connected) device.gatt.disconnect();
      this.setState("disconnected", { reason: "failed" });
      throw err;
    }
    return device;
  }

  adopt(device) {
    if (this.device && this.device !== device) this.device.removeEventListener?.("gattserverdisconnected", this._onGattDisconnected);
    this.device = device;
    device.addEventListener("gattserverdisconnected", this._onGattDisconnected);
  }

  /**
   * Reconnect to a panel this browser was already allowed to use, without the chooser.
   * Needs navigator.bluetooth.getDevices(); where that is missing this does nothing.
   * Returns true when connected.
   */
  async resume({ timeoutMs = 6000 } = {}) {
    if (!this.bluetooth?.getDevices || this.device) return false;
    let device;
    try {
      const known = await this.bluetooth.getDevices();
      device = known.find((d) => DEVICE_NAME_PREFIXES.some((p) => d.name?.startsWith(p))) ?? known[0];
    } catch {
      return false;
    }
    if (!device?.gatt) return false;
    this.userDisconnect = false;
    this.adopt(device);
    this.log(`Looking for "${device.name || device.id}"…`, "ble");
    try {
      await this.connect({ timeoutMs, state: "resuming" });
      return true;
    } catch (e) {
      this.log(`Panel not in range (${e.message})`, "info");
      this.userDisconnect = true;
      if (device.gatt.connected) device.gatt.disconnect();
      this.setState("disconnected", { reason: "resume" });
      return false;
    }
  }

  async connect({ timeoutMs = 12000, state } = {}) {
    if (!this.device?.gatt) throw new Error("No device selected");
    this.setState(state ?? (this.reconnectAttempt ? "reconnecting" : "connecting"), { attempt: this.reconnectAttempt });
    this.log("Connecting to GATT server…", "ble");
    this.server = await withTimeout(this.device.gatt.connect(), timeoutMs, "GATT connect");
    await this.discover();
    if (!this.writeChars.length) throw new Error("No writable characteristic found on this device");
    await this.subscribe();
    this.reconnectAttempt = 0;
    this.log(`Connected. Write endpoint ${short(this.writeChar.uuid)} (${this.writeChars.length} writable)`, "ok");
    this.setState("connected", { name: this.device.name || "LED panel" });
  }

  async discover() {
    const server = this.server;
    const services = [];
    const addService = (s) => {
      if (s && !services.some((x) => x.uuid.toLowerCase() === s.uuid.toLowerCase())) services.push(s);
    };
    try {
      (await server.getPrimaryServices()).forEach(addService);
    } catch (e) {
      this.log(`getPrimaryServices: ${e.message}`, "info");
    }
    // CoreBluetooth hides vendor services unless asked for by UUID.
    for (const uuid of CANDIDATE_SERVICES) {
      try { addService(await server.getPrimaryService(uuid)); } catch { /* not present */ }
    }

    this.writeChars = [];
    this.notifyChars = [];
    const addChar = (c) => {
      if (!c) return;
      const p = c.properties;
      if ((p.write || p.writeWithoutResponse) && !this.writeChars.some((x) => x.uuid === c.uuid)) this.writeChars.push(c);
      if ((p.notify || p.indicate) && !this.notifyChars.some((x) => x.uuid === c.uuid)) this.notifyChars.push(c);
    };
    for (const s of services) {
      if (SYSTEM_SERVICES.some((id) => s.uuid.toLowerCase().startsWith(id))) continue;
      try { (await s.getCharacteristics()).forEach(addChar); } catch { /* ignore */ }
      if (!this.writeChars.length) {
        for (const cu of CANDIDATE_CHARACTERISTICS) {
          try { addChar(await s.getCharacteristic(cu)); } catch { /* ignore */ }
        }
      }
    }
    this.log(`Discovered ${services.length} service(s), ${this.writeChars.length} writable, ${this.notifyChars.length} notify`, "info");
  }

  async subscribe() {
    for (const c of this.notifyChars) {
      try {
        await c.startNotifications();
        if (!c.__nfListening) {
          c.addEventListener("characteristicvaluechanged", (e) => {
            const v = e.target.value;
            this.emit("rx", { uuid: c.uuid, bytes: new Uint8Array(v.buffer, v.byteOffset, v.byteLength) });
          });
          c.__nfListening = true;
        }
      } catch { /* notifications optional */ }
    }
  }

  async writeChunk(char, chunk) {
    if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) {
      try {
        await char.writeValueWithoutResponse(chunk);
        return;
      } catch (err) {
        if (!char.properties.write) throw err;
      }
    }
    if (char.writeValueWithResponse) await char.writeValueWithResponse(chunk);
    else await char.writeValue(chunk);
  }

  /** Write a full packet, split into BLE-sized chunks. Caller serialises via TxQueue. */
  async write(bytes) {
    const char = this.writeChar;
    if (!this.connected || !char) throw new Error("Not connected");
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const size = this.chunkSize;
    for (let i = 0; i < data.length; i += size) {
      await this.writeChunk(char, data.slice(i, i + size));
      this.bytesSent += Math.min(size, data.length - i);
      this.writes++;
      if (this.chunkDelay > 0 && i + size < data.length) await this.sleep(this.chunkDelay);
    }
  }

  disconnect() {
    this.userDisconnect = true;
    this.reconnectAttempt = 0;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.writeChars = [];
    this.setState("disconnected", { reason: "user" });
  }

  async handleDrop() {
    if (this.userDisconnect || this.state === "reconnecting") return;
    this.writeChars = [];
    this.log("Panel connection lost", "error");
    this.emit("drop", {});
    while (!this.userDisconnect && this.reconnectAttempt < RECONNECT_DELAYS.length) {
      const delay = RECONNECT_DELAYS[this.reconnectAttempt++];
      this.setState("reconnecting", { attempt: this.reconnectAttempt, delay });
      this.log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt}/${RECONNECT_DELAYS.length})…`, "ble");
      await this.sleep(delay);
      if (this.userDisconnect) return;
      try {
        await this.connect();
        this.emit("reconnected", {});
        return;
      } catch (e) {
        this.log(`Reconnect failed: ${e.message}`, "error");
      }
    }
    if (!this.userDisconnect) {
      this.reconnectAttempt = 0;
      this.setState("disconnected", { reason: "lost" });
    }
  }

  /** Called when the page returns to the foreground. */
  async ensureConnected() {
    if (this.device && !this.userDisconnect && this.state === "disconnected") {
      try {
        await this.connect();
        this.emit("reconnected", {});
      } catch (e) {
        this.log(`Foreground reconnect failed: ${e.message}`, "error");
        this.setState("disconnected", { reason: "lost" });
      }
    }
  }
}

export const short = (uuid) => uuid.slice(4, 8);
