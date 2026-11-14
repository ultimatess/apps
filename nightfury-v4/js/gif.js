// Minimal GIF89a encoder (global palette, LZW, looping). Used only by the
// experimental "upload animation to the panel" feature in the Lab.

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = [];
  let cur = 0, shift = 0;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();
  const emit = (code) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) out.push(cur & 0xff);
  return out;
}

/** Frames (Frame objects of equal size) -> GIF bytes. Black is colour 0. */
export function encodeGif(frames, { delayMs = 100, loop = 0 } = {}) {
  if (!frames.length) throw new Error("No frames");
  const { width, height } = frames[0];
  const palette = ["#000000"];
  const index = new Map([["#000000", 0]]);
  for (const f of frames) {
    for (const hex of f.colors()) {
      if (!index.has(hex) && palette.length < 256) {
        index.set(hex, palette.length);
        palette.push(hex);
      }
    }
  }
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const size = 1 << bits;
  const bytes = [];
  const u16 = (v) => bytes.push(v & 0xff, (v >> 8) & 0xff);
  for (const ch of "GIF89a") bytes.push(ch.charCodeAt(0));
  u16(width);
  u16(height);
  bytes.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < size; i++) {
    const hex = palette[i] ?? "#000000";
    bytes.push(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  }
  if (frames.length > 1) {
    bytes.push(0x21, 0xff, 0x0b);
    for (const ch of "NETSCAPE2.0") bytes.push(ch.charCodeAt(0));
    bytes.push(0x03, 0x01);
    u16(loop);
    bytes.push(0x00);
  }
  const delay = Math.max(2, Math.round(delayMs / 10));
  const minCode = Math.max(2, bits);
  for (const f of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    u16(delay);
    bytes.push(0x00, 0x00);
    bytes.push(0x2c);
    u16(0); u16(0); u16(width); u16(height);
    bytes.push(0x00);
    const idx = new Uint8Array(width * height);
    for (let i = 0; i < idx.length; i++) idx[i] = f.px[i] ? index.get(f.pal[f.px[i]]) ?? 0 : 0;
    const data = lzw(idx, minCode);
    bytes.push(minCode);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0x00);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
