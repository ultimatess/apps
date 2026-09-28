// Mock Web Bluetooth iPixel panel. Self-contained (no imports / Node APIs) so the
// same function can be stringified and injected into the browser for e2e tests.
export function createMockBluetooth(opts = {}) {
  const o = Object.assign({ name: "LED_BLE_E1A2", writeWithoutResponse: true, failWrites: 0, cancel: false, screenType: 0x84 }, opts);
  const SERVICE = "000000fa-0000-1000-8000-00805f9b34fb";
  const WRITE = "0000fa02-0000-1000-8000-00805f9b34fb";
  const NOTIFY = "0000fa03-0000-1000-8000-00805f9b34fb";
  const log = { writes: [], requests: [], connects: 0 };

  const notFound = (what) => Object.assign(new Error(`No ${what} matching UUID`), { name: "NotFoundError" });
  const listeners = () => {
    const map = new Map();
    return {
      addEventListener(t, fn) { (map.get(t) ?? map.set(t, new Set()).get(t)).add(fn); },
      removeEventListener(t, fn) { map.get(t)?.delete(fn); },
      dispatch(t, ev) { for (const fn of map.get(t) ?? []) fn(ev); },
    };
  };

  const notifyChar = Object.assign(listeners(), {
    uuid: NOTIFY,
    properties: { notify: true, write: false, writeWithoutResponse: false },
    notifying: false,
    async startNotifications() { this.notifying = true; return this; },
    emit(bytes) {
      if (!this.notifying) return;
      const buf = new Uint8Array(bytes).buffer;
      this.dispatch("characteristicvaluechanged", { target: { value: new DataView(buf) } });
    },
  });

  let pendingFailures = o.failWrites;
  const record = async (value, mode) => {
    if (!gatt.connected) throw Object.assign(new Error("GATT Server is disconnected."), { name: "NetworkError" });
    if (pendingFailures > 0) { pendingFailures--; throw Object.assign(new Error("GATT operation failed"), { name: "NotSupportedError" }); }
    const bytes = Array.from(value instanceof Uint8Array ? value : new Uint8Array(value.buffer ?? value));
    if (bytes.length > 20) throw new Error(`Write of ${bytes.length}B exceeds 20B MTU`);
    log.writes.push({ bytes, mode, t: Date.now() });
    // Panel answers the 0x8005 ping / power-on with notifications like real hardware.
    if (bytes.length === 5 && bytes[2] === 0x07 && bytes[3] === 0x01) setTimeout(() => notifyChar.emit([0x05, 0x00, 0x07, 0x01, 0x01]), 5);
    if (bytes.length === 4 && bytes[2] === 0x05 && bytes[3] === 0x80) setTimeout(() => notifyChar.emit([0x0b, 0x00, 0x01, 0x80, o.screenType, 0, 0, 0, 0, 0, 0]), 5);
  };

  const writeChar = {
    uuid: WRITE,
    properties: { write: true, writeWithoutResponse: o.writeWithoutResponse, notify: false },
    writeValueWithoutResponse: (v) => record(v, "noresp"),
    writeValueWithResponse: (v) => record(v, "resp"),
    writeValue: (v) => record(v, "legacy"),
  };

  const service = {
    uuid: SERVICE,
    async getCharacteristics() { return [writeChar, notifyChar]; },
    async getCharacteristic(u) {
      const c = [writeChar, notifyChar].find((x) => x.uuid === u);
      if (!c) throw notFound("characteristic");
      return c;
    },
  };

  const device = Object.assign(listeners(), { id: "mock-1", name: o.name });
  const gatt = {
    device,
    connected: false,
    async connect() {
      log.connects++;
      if (o.refuseConnect) throw Object.assign(new Error("Connection failed"), { name: "NetworkError" });
      this.connected = true;
      return gatt;
    },
    disconnect() {
      if (!this.connected) return;
      this.connected = false;
      device.dispatch("gattserverdisconnected", { target: device });
    },
    async getPrimaryServices() { return [service]; },
    async getPrimaryService(u) {
      if (u === SERVICE) return service;
      throw notFound("service");
    },
  };
  device.gatt = gatt;

  return {
    log,
    device,
    notifyChar,
    options: o,
    /** Simulate the panel dropping off (out of range / power loss). */
    drop() {
      gatt.connected = false;
      device.dispatch("gattserverdisconnected", { target: device });
    },
    /** Concatenated bytes of every write (for packet reassembly). */
    stream() { return log.writes.flatMap((w) => w.bytes); },
    reset() { log.writes.length = 0; },
    bluetooth: {
      async getAvailability() { return true; },
      async requestDevice(options) {
        log.requests.push(options);
        if (o.cancel) throw Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" });
        return device;
      },
    },
  };
}
