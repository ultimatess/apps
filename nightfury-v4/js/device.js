// High-level iPixel panel driver: handshake, colour frames, firmware scroll and
// settings commands. Every write goes through the TxQueue so GATT sees one
// operation at a time.
import {
  ANIM, COLS, brightnessPacket, buildGifPacket, buildTextPacket, clockModePacket, deleteSlotPacket, diyModePacket,
  pingPacket, powerPacket, resetPacket, showSlotPacket, timeSyncPacket, toHex,
} from "./protocol.js";
import { frameToChunks } from "./frame.js";
import { TxQueue } from "./queue.js";

const preview = (bytes, max = 24) => toHex(bytes.slice(0, max)) + (bytes.length > max ? ` … (${bytes.length}B)` : "");

export class IPixelPanel {
  constructor({ transport, log = () => {}, options = () => ({}), queue } = {}) {
    this.transport = transport;
    this.log = log;
    this.options = options; // () => ({ lsbFirst, multiColor })
    this.queue = queue ?? new TxQueue({ gapMs: 15 });
    this.heartbeat = null;
    this.handshaken = false;
    this.framesSent = 0;
    transport.on?.("state", ({ state }) => { if (state !== "connected") this.handshaken = false; });
  }

  get connected() {
    return this.transport.connected;
  }

  /** Connected and initialised: scene frames may be sent. */
  get ready() {
    return this.connected && this.handshaken;
  }

  /** Queue a raw packet. Returns the queue result; never throws when disconnected. */
  send(bytes, { key = null, label = "TX", quiet = false } = {}) {
    if (!this.connected) return Promise.resolve({ skipped: true });
    return this.queue
      .enqueue(async () => {
        if (!quiet) this.log(`${label} → ${preview(bytes)}`, "tx");
        await this.transport.write(bytes);
      }, { key })
      .catch((err) => {
        this.log(`Write failed: ${err.message || err}`, "error");
        return { error: err };
      });
  }

  async handshake(brightness = 85) {
    this.handshaken = false;
    const pause = () => new Promise((r) => setTimeout(r, 60));
    this.log("Handshake: time → power → brightness → DIY", "ble");
    await this.send(timeSyncPacket(), { label: "Time sync" }); await pause();
    await this.send(powerPacket(true), { label: "Power on" }); await pause();
    await this.send(brightnessPacket(brightness), { label: `Brightness ${brightness}%` }); await pause();
    await this.send(diyModePacket(true), { label: "DIY mode" }); await pause();
    this.handshaken = this.connected;
  }

  /** Static 96x16 frame. `fallback` is the header colour when the frame is blank. */
  pushFrame(frame, { key = "scene", label = "Frame 96×16", fallback = "#ffffff", quiet = false, saveSlot = 0 } = {}) {
    const { lsbFirst = true, multiColor = true } = this.options();
    const { chunks, colors, rgb } = frameToChunks(frame, { lsbFirst, columns: COLS, multi: multiColor, fallback });
    const pkt = buildTextPacket(chunks, { anim: ANIM.STATIC, speed: 80, rgb, colors, saveSlot });
    this.framesSent++;
    return this.send(pkt, { key, label, quiet });
  }

  /** Firmware scroll of a raster wider than the panel. `speed` is the firmware value (30..100). */
  pushScroll(raster, speed, { key = "scene", label = "Scroll text", fallback = "#ffffff", anim = ANIM.SCROLL_LEFT, rainbow = 0, saveSlot = 0 } = {}) {
    const { lsbFirst = true, multiColor = true } = this.options();
    const { chunks, colors, rgb } = frameToChunks(raster, { lsbFirst, multi: multiColor, fallback });
    const pkt = buildTextPacket(chunks, { anim, speed, rgb, colors, rainbow, saveSlot });
    return this.send(pkt, { key, label: `${label} (${chunks.length} chunks)` });
  }

  /** EXPERIMENTAL: upload a GIF for the panel to play by itself. */
  uploadGif(bytes, slot = 1) {
    return this.send(buildGifPacket(bytes, slot), { key: "scene", label: `GIF upload (${bytes.length} B)` });
  }

  /**
   * Keep `stored` ({ mode: "frame", frame } | { mode: "scroll", raster, speed }) in panel slot `slot`
   * (1..255). Each slot has its own queue key, so a later live frame never cancels it.
   */
  saveToSlot(stored, slot, { fallback = "#ffffff", label = "" } = {}) {
    const key = `slot-${slot}`;
    const text = `Save to slot ${slot}${label ? ` · ${label}` : ""}`;
    if (stored.mode === "scroll") return this.pushScroll(stored.raster, stored.speed, { key, label: text, fallback, saveSlot: slot });
    return this.pushFrame(stored.frame, { key, label: text, fallback, saveSlot: slot });
  }

  deleteSlot(slot) { return this.send(deleteSlotPacket(slot), { key: `slot-${slot}`, label: `Delete slot ${slot}` }); }
  showSlot(slot) { return this.send(showSlotPacket(slot), { label: `Show slot ${slot}` }); }

  brightness(level) {
    return this.send(brightnessPacket(level), { key: "brightness", label: `Brightness ${level}%` });
  }

  /** The firmware's own clock face (not the app-rendered clock scene). */
  clock(style = 1) {
    return this.send(clockModePacket(new Date(), { style, format24: true, showDate: true }), { key: "scene", label: "Firmware clock" });
  }

  power(on = true) { return this.send(powerPacket(on), { label: `Power ${on ? "on" : "off"}` }); }
  timeSync() { return this.send(timeSyncPacket(), { label: "Time sync" }); }
  diy(on = true) { return this.send(diyModePacket(on), { label: "DIY mode" }); }
  reset() { return this.send(resetPacket(), { label: "Reset" }); }
  raw(bytes) { return this.send(bytes, { label: "Raw" }); }

  startHeartbeat(ms = 15000) {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.connected && !this.queue.busy) this.send(pingPacket(), { key: "ping", label: "Ping", quiet: true });
    }, ms);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
