// High-level iPixel panel driver: handshake, frames, text, settings commands.
// Every write goes through the TxQueue so GATT sees one operation at a time.
import {
  ANIM, COLS, bitmapToChunks, brightnessPacket, buildTextPacket, clockModePacket, diyModePacket,
  hexToRgb, pingPacket, powerPacket, resetPacket, timeSyncPacket, toHex, ae01Packets, coolled7728Packet,
} from "./protocol.js";
import { Bitmap } from "./bitmap.js";
import { TxQueue } from "./queue.js";

export const PROTOCOLS = {
  ipixel: "iPixel auto (scroll / frame)",
  frame: "Static 96×16 frame",
  clock: "Firmware clock",
  diy: "DIY mode",
  ae01: "Legacy AE01",
  coolled: "Legacy CoolLED 7728",
};

const preview = (bytes, max = 24) => toHex(bytes.slice(0, max)) + (bytes.length > max ? ` … (${bytes.length}B)` : "");

export class IPixelPanel {
  constructor({ transport, log = () => {}, options = () => ({}), queue } = {}) {
    this.transport = transport;
    this.log = log;
    this.options = options; // () => ({ lsbFirst, protocol })
    this.queue = queue ?? new TxQueue({ gapMs: 15 });
    this.heartbeat = null;
    this.handshaken = false;
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
  send(bytes, { key = null, label = "TX" } = {}) {
    if (!this.connected) return Promise.resolve({ skipped: true });
    return this.queue
      .enqueue(async () => {
        this.log(`${label} → ${preview(bytes)}`, "tx");
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

  pushFrame(bitmap, color, { key = "scene", label = "Frame 96×16" } = {}) {
    const { lsbFirst = true } = this.options();
    const chunks = bitmapToChunks(bitmap, { lsbFirst, columns: COLS });
    const pkt = buildTextPacket(chunks, { anim: ANIM.STATIC, speed: 80, rgb: hexToRgb(color) });
    return this.send(pkt, { key, label });
  }

  pushScroll(raster, color, speed, { key = "scene", label = "Scroll text" } = {}) {
    const { lsbFirst = true } = this.options();
    const chunks = bitmapToChunks(raster, { lsbFirst });
    const pkt = buildTextPacket(chunks, { anim: ANIM.SCROLL_LEFT, speed, rgb: hexToRgb(color) });
    return this.send(pkt, { key, label: `${label} (${chunks.length} chunks)` });
  }

  /** Send a hardwarePlan() result, honouring the Lab protocol override for text. */
  pushPlan(plan, scene, { key = "scene" } = {}) {
    const color = scene.color;
    if (plan.type === "clock") return this.clock();
    const protocol = this.options().protocol ?? "ipixel";
    if (plan.type === "text" || (scene.kind === "text" && protocol !== "ipixel")) {
      switch (protocol) {
        case "frame": {
          const raster = plan.raster ?? plan.bitmap;
          const bmp = new Bitmap();
          bmp.blit(raster, raster.width <= COLS ? Math.floor((COLS - raster.width) / 2) : 2, 0);
          return this.pushFrame(bmp, color, { key, label: "Frame (text)" });
        }
        case "clock": return this.clock();
        case "diy": return this.send(diyModePacket(true), { key, label: "DIY mode" });
        case "ae01": {
          const [pre, body] = ae01Packets(scene.text, { style: scene.style, speed: scene.speed, rgb: hexToRgb(color) });
          this.send(pre, { label: "AE01 enter" });
          return this.send(body, { key, label: "AE01 text" });
        }
        case "coolled":
          return this.send(coolled7728Packet(scene.text, { speed: scene.speed, rgb: hexToRgb(color) }), { key, label: "7728 text" });
        default:
          if (plan.type === "text") return this.pushScroll(plan.raster, color, plan.speed, { key });
      }
    }
    return this.pushFrame(plan.bitmap, color, { key, label: `Frame · ${scene.kind}` });
  }

  brightness(level) {
    return this.send(brightnessPacket(level), { key: "brightness", label: `Brightness ${level}%` });
  }

  clock(style = 1) {
    return this.send(clockModePacket(new Date(), { style, format24: true, showDate: true }), { key: "scene", label: "Clock mode" });
  }

  power(on = true) { return this.send(powerPacket(on), { label: `Power ${on ? "on" : "off"}` }); }
  timeSync() { return this.send(timeSyncPacket(), { label: "Time sync" }); }
  diy(on = true) { return this.send(diyModePacket(on), { label: "DIY mode" }); }
  reset() { return this.send(resetPacket(), { label: "Reset" }); }
  raw(bytes) { return this.send(bytes, { label: "Raw" }); }

  startHeartbeat(ms = 15000) {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.connected && !this.queue.busy) this.send(pingPacket(), { key: "ping", label: "Ping" });
    }, ms);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
