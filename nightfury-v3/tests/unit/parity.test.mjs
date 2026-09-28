// Byte/pixel parity with nightfury v2.2.4 (the hardware-validated build).
// v2's own functions are extracted from ../nightfury/index.html and run in a VM,
// then compared with v3 output for the same inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as P from "../../js/protocol.js";
import { Bitmap } from "../../js/bitmap.js";
import { devilEyes, turnArrows } from "../../js/graphics.js";

const V2_PATH = fileURLToPath(new URL("../../../nightfury/index.html", import.meta.url));
const hasV2 = existsSync(V2_PATH);

function extract(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`v2 function ${name} not found`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

function loadV2() {
  const html = readFileSync(V2_PATH, "utf8");
  const names = ["getCrc32Table", "computeIpixelCrc32", "buildIpixelPacket", "buildIpixelTextPacket", "buildIpixelPngPacket",
    "chunkRasterTo16x8", "bufferTo12Chunks", "drawTurningArrowsToBuffer", "drawDevilEyesToBuffer"];
  const code = `const COLS = 96, ROWS = 16; let crcTable32 = null; var textBitOrderInverted = false;\n${names.map((n) => extract(html, n)).join("\n")}\n` +
    `this.api = { ${names.join(", ")}, setInverted: (v) => { textBitOrderInverted = v; } };`;
  const ctx = { Uint8Array, Uint32Array, Math, Array };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.api;
}

const v2 = hasV2 ? loadV2() : null;
const opts = { skip: hasV2 ? false : "v2 source (../nightfury/index.html) not present" };

const buf2d = () => Array.from({ length: 16 }, () => new Uint8Array(96));
const toBitmap = (rows) => Bitmap.from2D(rows.map((r) => Array.from(r)));
const bytes = (u8) => Array.from(u8);

function randomBitmap(seed, width = 96) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = Array.from({ length: 16 }, () => Uint8Array.from({ length: width }, () => (rnd() > 0.6 ? 1 : 0)));
  return { rows, bmp: toBitmap(rows) };
}

test("CRC32 matches v2 and the IEEE check value", opts, () => {
  assert.equal(P.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  for (let n = 0; n < 50; n++) {
    const data = Uint8Array.from({ length: n * 7 }, (_, i) => (i * 31 + n) & 0xff);
    assert.equal(P.crc32(data), v2.computeIpixelCrc32(data));
  }
});

test("simple command packets match v2", opts, () => {
  const cases = [[0x8001, [12, 30, 5, 0]], [0x0107, [1]], [0x0107, [0]], [0x8004, [100]], [0x0104, [1]], [0x8003, []], [0x0106, [1, 1, 1, 26, 9, 28, 7]]];
  for (const [cmd, payload] of cases) assert.deepEqual(bytes(P.buildPacket(cmd, payload)), bytes(v2.buildIpixelPacket(cmd, payload)));
  // Known hardware byte strings from the v2 Hex Lab presets.
  assert.equal(P.toHex(P.powerPacket(true)), "05 00 07 01 01");
  assert.equal(P.toHex(P.powerPacket(false)), "05 00 07 01 00");
  assert.equal(P.toHex(P.brightnessPacket(100)), "05 00 04 80 64");
  assert.equal(P.toHex(P.diyModePacket(true)), "05 00 04 01 01");
  assert.equal(P.toHex(P.resetPacket()), "04 00 03 80");
  assert.equal(P.toHex(P.pingPacket()), "04 00 05 80");
  assert.equal(P.toHex(P.timeSyncPacket(new Date(2026, 8, 28, 12, 30, 0))), "08 00 01 80 0C 1E 00 00");
});

test("chunking matches v2 for both bit orders (full frames and variable-width rasters)", opts, () => {
  for (const inverted of [false, true]) {
    v2.setInverted(inverted);
    for (let seed = 1; seed < 20; seed++) {
      const { rows, bmp } = randomBitmap(seed);
      const mine = P.bitmapToChunks(bmp, { lsbFirst: !inverted, columns: 96 });
      assert.deepEqual(mine.map(bytes), Array.from(v2.bufferTo12Chunks(rows), bytes));

      const width = 5 + seed * 7;
      const r = randomBitmap(seed * 3, width);
      const raster = { width, map: r.rows };
      assert.deepEqual(P.bitmapToChunks(r.bmp, { lsbFirst: !inverted }).map(bytes), Array.from(v2.chunkRasterTo16x8(raster), bytes));
    }
  }
  v2.setInverted(false);
});

test("text/frame packets are byte-identical to v2", opts, () => {
  const colors = [[6, 182, 212], [239, 68, 68], [16, 185, 129], [255, 255, 255]];
  for (let seed = 1; seed < 12; seed++) {
    const { rows, bmp } = randomBitmap(seed);
    const rgb = colors[seed % colors.length];
    const chunksV2 = v2.bufferTo12Chunks(rows);
    const chunksV3 = P.bitmapToChunks(bmp, { columns: 96 });
    for (const [anim, speed] of [[0, 80], [1, 30], [1, 100], [1, 72]]) {
      assert.deepEqual(
        bytes(P.buildTextPacket(chunksV3, { anim, speed, rgb })),
        bytes(v2.buildIpixelTextPacket(chunksV2, anim, speed, rgb, 0)),
      );
    }
  }
});

test("PNG packet matches v2", opts, () => {
  const png = Uint8Array.from({ length: 333 }, (_, i) => (i * 13) & 0xff);
  assert.deepEqual(bytes(P.buildPngPacket(png)), bytes(v2.buildIpixelPngPacket(png, 0)));
});

test("turn chevrons are pixel-identical to v2 across animation ticks", opts, () => {
  for (const dir of ["left", "right", "straight"]) {
    for (let tick = 0; tick < 64; tick += 3) {
      const b = buf2d();
      v2.drawTurningArrowsToBuffer(b, dir, tick);
      assert.ok(turnArrows(dir, tick).equals(toBitmap(b)), `${dir} tick ${tick}`);
    }
  }
});

test("devil eyes are pixel-identical to v2 across frames", opts, () => {
  for (const mode of ["angry", "cyan_cyber", "cylon", "winking"]) {
    for (let frame = 0; frame < 240; frame += 7) {
      const b = buf2d();
      v2.drawDevilEyesToBuffer(b, mode, frame);
      assert.ok(devilEyes(mode, frame).equals(toBitmap(b)), `${mode} frame ${frame}`);
    }
  }
});

test("scroll speed mapping matches v2 (1..10 -> 30..100)", () => {
  const v2map = (s) => Math.round((Math.max(1, Math.min(10, parseInt(s) || 6)) / 10) * 70) + 30;
  for (const s of [1, 2, 5, 6, 9, 10, 0, 99, "7", undefined]) assert.equal(P.mapScrollSpeed(s), v2map(s));
});
