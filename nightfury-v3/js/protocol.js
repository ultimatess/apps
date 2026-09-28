// iPixel Color BLE protocol (com.wifiled.ipixels).
// Pure functions only: no DOM, no Bluetooth. Byte output is kept identical to
// nightfury v2.2.4 (hardware-validated) and is locked by tests/unit/parity.test.mjs.
//
// Framing: [LEN_LO, LEN_HI, CMD_LO, CMD_HI, ...payload]  (little endian, LEN includes header)
// Data commands (text / png) use a 15-byte header:
//   [LEN(2), CMD(2), OPTION, SIZE(4), CRC32(4), 0x00, SAVE_SLOT, ...data]

export const COLS = 96;
export const ROWS = 16;

export const UUID = {
  // iPixel primary service is 0x00FA; FA02 = write, FA03 = notify.
  service: "000000fa-0000-1000-8000-00805f9b34fb",
  write: "0000fa02-0000-1000-8000-00805f9b34fb",
  notify: "0000fa03-0000-1000-8000-00805f9b34fb",
};

const u = (short) => `0000${short}-0000-1000-8000-00805f9b34fb`;

// Services swept during discovery. CoreBluetooth (Bluefy) hides proprietary
// services unless they are requested explicitly, so every candidate is probed.
export const CANDIDATE_SERVICES = [
  UUID.service,
  ...["fa02", "fa00", "fa01", "fa03", "ae01", "ae02", "ae00", "af00", "fff0", "fff1",
    "ffe0", "ffe1", "ffe5", "ffd0", "cc01", "ee01", "1000"].map(u),
];

export const CANDIDATE_CHARACTERISTICS =
  ["fa02", "fa03", "fa01", "ae01", "ae02", "fff1", "fff2", "ffe1", "ffd1"].map(u);

export const DEVICE_NAME_PREFIXES = ["LED_BLE", "LED", "iPixel", "CoolLED"];

export const CMD = {
  PNG: 0x0002,
  TEXT: 0x0100,
  DIY: 0x0104,
  SET_PIXEL: 0x0105,
  CLOCK: 0x0106,
  POWER: 0x0107,
  TIME: 0x8001,
  RESET: 0x8003,
  BRIGHTNESS: 0x8004,
  PING: 0x8005,
};

export const ANIM = { STATIC: 0, SCROLL_LEFT: 1 };

// ---------------------------------------------------------------- CRC32 (IEEE 802.3)

let crcTable = null;
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const t = table();
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

// ---------------------------------------------------------------- helpers

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function putU32LE(arr, offset, v) {
  arr[offset] = v & 0xff;
  arr[offset + 1] = (v >>> 8) & 0xff;
  arr[offset + 2] = (v >>> 16) & 0xff;
  arr[offset + 3] = (v >>> 24) & 0xff;
}

/** "#rrggbb" / "#rgb" -> [r,g,b]. Unlike v2, a 0 channel stays 0 (v2 turned it into 255). */
export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return [255, 255, 255];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => clamp(v | 0, 0, 255).toString(16).padStart(2, "0")).join("");
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/** Parses "05 00 07 01 01", "0x05,0x00" or "0500070101". Throws on anything invalid. */
export function parseHex(str) {
  const s = String(str || "").trim();
  if (!s) throw new Error("Empty hex string");
  let tokens = s.split(/[\s,;:]+/).filter(Boolean).map((t) => t.replace(/^0x/i, ""));
  if (tokens.length === 1 && tokens[0].length > 2) {
    if (tokens[0].length % 2) throw new Error("Odd number of hex digits");
    tokens = tokens[0].match(/../g);
  }
  return Uint8Array.from(tokens, (t) => {
    if (!/^[0-9a-f]{1,2}$/i.test(t)) throw new Error(`Invalid hex byte "${t}"`);
    return parseInt(t, 16);
  });
}

/** v2 mapping of UI speed 1..10 to firmware speed 30..100. */
export function mapScrollSpeed(uiSpeed) {
  const s = clamp(parseInt(uiSpeed, 10) || 6, 1, 10);
  return Math.round((s / 10) * 70) + 30;
}

// ---------------------------------------------------------------- packet builders

export function buildPacket(cmd, payload = []) {
  const len = payload.length + 4;
  const pkt = new Uint8Array(len);
  pkt[0] = len & 0xff;
  pkt[1] = (len >> 8) & 0xff;
  pkt[2] = cmd & 0xff;
  pkt[3] = (cmd >> 8) & 0xff;
  pkt.set(payload, 4);
  return pkt;
}

function buildDataPacket(cmd, data, saveSlot = 0) {
  const len = data.length + 15;
  const pkt = new Uint8Array(len);
  pkt[0] = len & 0xff;
  pkt[1] = (len >> 8) & 0xff;
  pkt[2] = cmd & 0xff;
  pkt[3] = (cmd >> 8) & 0xff;
  pkt[4] = 0x00; // option: first window
  putU32LE(pkt, 5, data.length);
  putU32LE(pkt, 9, crc32(data));
  pkt[13] = 0x00;
  pkt[14] = saveSlot & 0xff;
  pkt.set(data, 15);
  return pkt;
}

/**
 * Text/bitmap packet (CMD 0x0100). Each chunk is 16 bytes = 16 rows x 8 columns.
 * A 96x16 frame is exactly 12 chunks; with anim=STATIC the firmware shows it as-is.
 */
export function buildTextPacket(chunks, { anim = ANIM.SCROLL_LEFT, speed = 80, rgb = [255, 255, 255], saveSlot = 0 } = {}) {
  const [r, g, b] = rgb.map((v) => v & 0xff);
  const data = [
    chunks.length & 0xff, 0x00, 0x01, 0x01,
    anim & 0xff,
    clamp(speed, 1, 100) & 0xff,
    0x00, // rainbow off
    r, g, b,
    0x00, 0x00, 0x00, 0x00, // no background colour
  ];
  for (const ch of chunks) {
    data.push(0x00, r, g, b); // opcode 0 = 16 rows, width <= 8
    for (let row = 0; row < 16; row++) data.push(ch[row] & 0xff);
  }
  return buildDataPacket(CMD.TEXT, Uint8Array.from(data), saveSlot);
}

export function buildPngPacket(pngBytes, saveSlot = 0) {
  return buildDataPacket(CMD.PNG, pngBytes, saveSlot);
}

export const timeSyncPacket = (d = new Date()) =>
  buildPacket(CMD.TIME, [d.getHours(), d.getMinutes(), d.getSeconds(), 0x00]);

export const powerPacket = (on = true) => buildPacket(CMD.POWER, [on ? 1 : 0]);

export const brightnessPacket = (level) =>
  buildPacket(CMD.BRIGHTNESS, [clamp(parseInt(level, 10) || 100, 1, 100)]);

export function clockModePacket(d = new Date(), { style = 1, format24 = true, showDate = true } = {}) {
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  return buildPacket(CMD.CLOCK, [
    clamp(style, 0, 8), format24 ? 1 : 0, showDate ? 1 : 0,
    d.getFullYear() % 100, d.getMonth() + 1, d.getDate(), dow,
  ]);
}

export const diyModePacket = (enable = true) => buildPacket(CMD.DIY, [enable ? 1 : 0]);
export const setPixelPacket = (x, y, [r, g, b]) => buildPacket(CMD.SET_PIXEL, [0, r & 0xff, g & 0xff, b & 0xff, x & 0xff, y & 0xff]);
export const resetPacket = () => buildPacket(CMD.RESET);
export const pingPacket = () => buildPacket(CMD.PING);

// ---------------------------------------------------------------- bitmap chunking

/**
 * Slice a bitmap ({width, height:16, data}) into 8-column chunks.
 * lsbFirst=true: column 0 of the chunk is bit 0 (v2 default, "normal" orientation).
 * `columns` forces a fixed chunk count (12 for a full 96-col frame).
 */
export function bitmapToChunks(bmp, { lsbFirst = true, columns } = {}) {
  const width = columns ?? bmp.width;
  const chunks = [];
  for (let x = 0; x < width; x += 8) {
    const rows = new Uint8Array(16);
    for (let r = 0; r < 16; r++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) {
        const col = x + bit;
        if (col < width && col < bmp.width && r < bmp.height && bmp.data[r * bmp.width + col]) {
          v |= lsbFirst ? 1 << bit : 1 << (7 - bit);
        }
      }
      rows[r] = v;
    }
    chunks.push(rows);
  }
  return chunks;
}

/** Inverse of bitmapToChunks (used by tests and the Lab packet inspector). */
export function chunksToBitmap(chunks, { lsbFirst = true } = {}) {
  const width = chunks.length * 8;
  const data = new Uint8Array(width * 16);
  chunks.forEach((ch, i) => {
    for (let r = 0; r < 16; r++) {
      for (let bit = 0; bit < 8; bit++) {
        const mask = lsbFirst ? 1 << bit : 1 << (7 - bit);
        if (ch[r] & mask) data[r * width + i * 8 + bit] = 1;
      }
    }
  });
  return { width, height: 16, data };
}

// ---------------------------------------------------------------- decoding

/** Split a raw byte stream (concatenated BLE writes) into length-prefixed packets. */
export function splitPackets(stream) {
  const out = [];
  let i = 0;
  while (i + 4 <= stream.length) {
    const len = stream[i] | (stream[i + 1] << 8);
    if (len < 4 || i + len > stream.length) break;
    out.push(stream.slice(i, i + len));
    i += len;
  }
  return { packets: out, rest: stream.slice(i) };
}

export function decodePacket(pkt) {
  const len = pkt[0] | (pkt[1] << 8);
  const cmd = pkt[2] | (pkt[3] << 8);
  const res = { len, cmd, lengthOk: len === pkt.length };
  if (cmd === CMD.TEXT || cmd === CMD.PNG) {
    const size = (pkt[5] | (pkt[6] << 8) | (pkt[7] << 16) | (pkt[8] << 24)) >>> 0;
    const crc = (pkt[9] | (pkt[10] << 8) | (pkt[11] << 16) | (pkt[12] << 24)) >>> 0;
    const data = pkt.slice(15);
    Object.assign(res, { size, crc, crcOk: crc32(data) === crc && size === data.length, saveSlot: pkt[14] });
    if (cmd === CMD.TEXT) {
      const count = data[0];
      Object.assign(res, { anim: data[4], speed: data[5], rgb: [data[7], data[8], data[9]] });
      const chunks = [];
      for (let c = 0; c < count; c++) {
        const off = 14 + c * 20;
        chunks.push(data.slice(off + 4, off + 20));
      }
      res.chunks = chunks;
    }
  } else {
    res.payload = pkt.slice(4);
  }
  return res;
}

/** Recognise notable notifications from the panel. */
export function describeNotification(val) {
  if (val.length >= 5 && val[0] === 0x0b && val[2] === 0x01 && val[3] === 0x80) {
    return { type: "screen", screenType: val[4], is96x16: val[4] === 0x84 };
  }
  if (val.length >= 5 && val[0] === 0x05 && val[4] === 0x01) return { type: "ack" };
  return { type: "unknown" };
}

// ---------------------------------------------------------------- legacy panels (fallbacks)

export function ae01Packets(text, { style = "scroll", speed = 6, rgb = [255, 255, 255] } = {}) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const mode = style === "static" ? 0x00 : style === "blink" ? 0x03 : 0x01;
  const payload = [0x01, mode, clamp(speed, 1, 10), ...rgb, bytes.length & 0xff, ...bytes];
  payload.push(payload.reduce((a, b) => (a + b) & 0xff, 0));
  return [Uint8Array.from([0x02, 0x01, 0x01]), Uint8Array.from(payload)];
}

export function coolled7728Packet(text, { speed = 6, rgb = [255, 255, 255] } = {}) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const pkt = [0x77, 0x28, (bytes.length + 7) & 0xff, 0x01, clamp(speed, 1, 10), ...rgb, 0x01, ...bytes];
  let sum = 0;
  for (let i = 2; i < pkt.length; i++) sum = (sum + pkt[i]) & 0xff;
  pkt.push(sum);
  return Uint8Array.from(pkt);
}
