// 1-bit bitmap used for every frame shown on the 96x16 panel and in the preview.
import { COLS, ROWS } from "./protocol.js";

export class Bitmap {
  constructor(width = COLS, height = ROWS, data) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height);
  }

  get(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height ? this.data[y * this.width + x] : 0;
  }

  set(x, y, v = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.data[y * this.width + x] = v ? 1 : 0;
  }

  clear() {
    this.data.fill(0);
    return this;
  }

  fillRect(x, y, w, h, v = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, v);
  }

  /** Copy `src` into this bitmap with its top-left at (dx, dy). Only lit pixels are drawn. */
  blit(src, dx = 0, dy = 0) {
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        if (src.data[y * src.width + x]) this.data[ty * this.width + tx] = 1;
      }
    }
    return this;
  }

  litCount() {
    let n = 0;
    for (const v of this.data) n += v;
    return n;
  }

  equals(other) {
    if (!other || other.width !== this.width || other.height !== this.height) return false;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== other.data[i]) return false;
    return true;
  }

  /** Stable string key for change detection. */
  key() {
    let s = "";
    for (let i = 0; i < this.data.length; i += 4) {
      s += ((this.data[i] << 3) | (this.data[i + 1] << 2) | (this.data[i + 2] << 1) | this.data[i + 3]).toString(16);
    }
    return s;
  }

  /** Bounding box of lit pixels, or null. */
  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[y * this.width + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  toAscii() {
    const lines = [];
    for (let y = 0; y < this.height; y++) {
      let l = "";
      for (let x = 0; x < this.width; x++) l += this.data[y * this.width + x] ? "#" : ".";
      lines.push(l);
    }
    return lines.join("\n");
  }

  static from2D(rows) {
    const bmp = new Bitmap(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) bmp.data[y * bmp.width + x] = row[x] ? 1 : 0;
    });
    return bmp;
  }
}
