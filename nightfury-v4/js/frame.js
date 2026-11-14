// Colour frame: a grid of palette indices (0 = off). Everything the panel or the
// preview shows is a Frame. The hardware-validated packet carries one colour per
// 8-column chunk, so `frameToChunks` picks each chunk's dominant colour and
// `quantize` returns the frame exactly as the panel will show it - the preview
// always draws the quantized frame, never the ideal one.
import { COLS, ROWS, hexToRgb } from "./protocol.js";
import { Bitmap } from "./bitmap.js";

const norm = (hex) => {
  let h = String(hex || "#ffffff").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  return /^#[0-9a-f]{6}$/.test(h) ? h : "#ffffff";
};

export class Frame {
  constructor(width = COLS, height = ROWS) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height);
    this.pal = [null]; // index 0 = off
  }

  /** Palette index for a colour, adding it when new (at most 255 colours). */
  ink(hex) {
    const h = norm(hex);
    let i = this.pal.indexOf(h, 1);
    if (i < 0) {
      if (this.pal.length >= 256) return 1;
      i = this.pal.push(h) - 1;
    }
    return i;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.pal[this.px[y * this.width + x]] ?? null;
  }

  set(x, y, hex) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = hex ? this.ink(hex) : 0;
  }

  fillRect(x, y, w, h, hex) {
    const i = hex ? this.ink(hex) : 0;
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) this.px[yy * this.width + xx] = i;
    }
    return this;
  }

  /** Draw the lit pixels of a 1-bit bitmap in one colour (or a colour per pixel via fn(x, y)). */
  paint(bmp, color, dx = 0, dy = 0) {
    const fn = typeof color === "function" ? color : null;
    const fixed = fn ? 0 : this.ink(color);
    for (let y = 0; y < bmp.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < bmp.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width || !bmp.data[y * bmp.width + x]) continue;
        this.px[ty * this.width + tx] = fn ? this.ink(fn(tx, ty)) : fixed;
      }
    }
    return this;
  }

  /** Copy another frame's lit pixels with its top-left at (dx, dy). */
  blit(src, dx = 0, dy = 0) {
    const map = src.pal.map((h) => (h ? this.ink(h) : 0));
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x;
        const v = src.px[y * src.width + x];
        if (v && tx >= 0 && tx < this.width) this.px[ty * this.width + tx] = map[v];
      }
    }
    return this;
  }

  /** Lit pixels as a 1-bit bitmap. */
  mask() {
    const bmp = new Bitmap(this.width, this.height);
    for (let i = 0; i < this.px.length; i++) bmp.data[i] = this.px[i] ? 1 : 0;
    return bmp;
  }

  litCount() {
    let n = 0;
    for (const v of this.px) if (v) n++;
    return n;
  }

  clone() {
    const f = new Frame(this.width, this.height);
    f.px.set(this.px);
    f.pal = this.pal.slice();
    return f;
  }

  /** Colours actually used by lit pixels, most common first. */
  colors() {
    const counts = new Map();
    for (const v of this.px) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => this.pal[i]);
  }

  dominant(fallback = "#ffffff") {
    return this.colors()[0] ?? fallback;
  }

  /** Stable identity (pixels + colours) for change detection. */
  key() {
    let s = "";
    const px = this.px;
    for (let i = 0; i < px.length; i += 64) s += String.fromCharCode(...px.subarray(i, i + 64));
    return `${this.width}x${this.height}|${this.pal.join(",")}|${s}`;
  }

  equals(other) {
    if (!other || other.width !== this.width || other.height !== this.height) return false;
    for (let i = 0; i < this.px.length; i++) {
      if ((this.pal[this.px[i]] ?? null) !== (other.pal[other.px[i]] ?? null)) return false;
    }
    return true;
  }

  toAscii() {
    const lines = [];
    for (let y = 0; y < this.height; y++) {
      let l = "";
      for (let x = 0; x < this.width; x++) l += this.px[y * this.width + x] ? String.fromCharCode(48 + (this.px[y * this.width + x] % 10)) : ".";
      lines.push(l);
    }
    return lines.join("\n");
  }

  static fromBitmap(bmp, color) {
    return new Frame(bmp.width, bmp.height).paint(bmp, color);
  }
}

/** Centre `src` on a new 96x16 frame. */
export function centerFrame(src) {
  return new Frame().blit(src, Math.floor((COLS - src.width) / 2), Math.floor((ROWS - src.height) / 2));
}

/**
 * Frame -> hardware chunks. Returns { chunks, colors, rgb }:
 *  chunks  16-byte column blocks (same layout as v3's bitmapToChunks),
 *  colors  one [r,g,b] per chunk (its dominant colour; `rgb` when the chunk is empty),
 *  rgb     the frame's overall dominant colour (packet header colour).
 * multi=false paints every chunk in `rgb`, which is exactly v3's output.
 */
export function frameToChunks(frame, { lsbFirst = true, columns, multi = true, fallback = "#ffffff" } = {}) {
  const width = columns ?? frame.width;
  const main = frame.dominant(fallback);
  const rgb = hexToRgb(main);
  const chunks = [];
  const colors = [];
  for (let x = 0; x < width; x += 8) {
    const rows = new Uint8Array(16);
    const counts = new Map();
    for (let r = 0; r < 16; r++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) {
        const col = x + bit;
        if (col >= width || col >= frame.width || r >= frame.height) continue;
        const idx = frame.px[r * frame.width + col];
        if (!idx) continue;
        v |= lsbFirst ? 1 << bit : 1 << (7 - bit);
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
      rows[r] = v;
    }
    chunks.push(rows);
    let best = 0, bestN = 0;
    for (const [idx, n] of counts) if (n > bestN) { best = idx; bestN = n; }
    colors.push(multi && best ? hexToRgb(frame.pal[best]) : rgb);
  }
  return { chunks, colors, rgb, main };
}

/** The frame as the panel will actually show it (one colour per 8-column chunk, or one overall). */
export function quantize(frame, { multi = true } = {}) {
  const used = frame.colors();
  if (used.length <= 1) return frame;
  const out = new Frame(frame.width, frame.height);
  const main = used[0];
  for (let x = 0; x < frame.width; x += 8) {
    const counts = new Map();
    const end = Math.min(frame.width, x + 8);
    for (let y = 0; y < frame.height; y++) {
      for (let c = x; c < end; c++) {
        const idx = frame.px[y * frame.width + c];
        if (idx) counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
    }
    if (!counts.size) continue;
    let best = 0, bestN = 0;
    for (const [idx, n] of counts) if (n > bestN) { best = idx; bestN = n; }
    const ink = out.ink(multi ? frame.pal[best] : main);
    for (let y = 0; y < frame.height; y++) {
      for (let c = x; c < end; c++) if (frame.px[y * frame.width + c]) out.px[y * out.width + c] = ink;
    }
  }
  return out;
}

// ---------------------------------------------------------------- compact storage (pixel art)

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Frame -> { w, pal, d } with one base-36 digit per pixel (at most 35 colours). */
export function packFrame(frame) {
  const used = frame.colors().slice(0, 35);
  const index = new Map(used.map((h, i) => [h, i + 1]));
  let d = "";
  for (let i = 0; i < frame.px.length; i++) d += DIGITS[index.get(frame.pal[frame.px[i]]) ?? 0];
  return { w: frame.width, pal: used, d: rle(d) };
}

export function unpackFrame(packed) {
  const w = packed?.w ?? COLS;
  const f = new Frame(w, ROWS);
  const d = unrle(String(packed?.d ?? ""));
  const pal = (packed?.pal ?? []).map((h) => f.ink(h));
  for (let i = 0; i < Math.min(d.length, f.px.length); i++) {
    const v = DIGITS.indexOf(d[i]);
    f.px[i] = v > 0 ? pal[v - 1] ?? 0 : 0;
  }
  return f;
}

// Run-length: a run of 4+ identical digits becomes "~<count>:<digit>".
function rle(s) {
  return s.replace(/(.)\1{3,}/g, (run, ch) => `~${run.length}:${ch}`);
}
function unrle(s) {
  return s.replace(/~(\d+):(.)/g, (_, n, ch) => ch.repeat(Number(n)));
}

/** HSL (h in degrees, s/l in 0..1) -> "#rrggbb". Used for rainbow paints. */
export function hsl(h, s = 1, l = 0.5) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Scale a colour's brightness (0..1) - LEDs have no "grey", only dimmer. */
export function dim(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  return "#" + [r, g, b].map((v) => Math.round(v * k).toString(16).padStart(2, "0")).join("");
}
