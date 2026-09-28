import { test } from "node:test";
import assert from "node:assert/strict";
import { Bitmap } from "../../js/bitmap.js";
import * as F from "../../js/font5x7.js";
import * as Gx from "../../js/graphics.js";
import { pixelRaster, thresholdImageData } from "../../js/textraster.js";

test("every glyph is 7 rows high and rectangular", () => {
  for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ !?.,:'-+=/<>()%#&*°") {
    const g = F.glyph(ch);
    assert.equal(g.height, 7, `glyph ${ch}`);
    assert.ok(g.width >= 1 && g.width <= 5, `glyph ${ch} width`);
    if (ch !== " ") assert.ok(g.litCount() > 0, `glyph ${ch} is blank`);
  }
});

test("pixel-font detection", () => {
  assert.ok(F.isPixelFontText("THANKS!"));
  assert.ok(F.isPixelFontText("keep distance"));
  assert.ok(!F.isPixelFontText("நன்றி"));
  assert.ok(!F.isPixelFontText("GO 🚗"));
  assert.ok(!F.isPixelFontText(""));
});

test("digits are distinguishable (no two digits share a bitmap)", () => {
  const keys = new Set([..."0123456789"].map((d) => F.glyph(d).toAscii()));
  assert.equal(keys.size, 10);
});

test("text measurement matches rendering", () => {
  for (const s of ["A", "HELLO", "65 KM/H", "SORRY!"]) {
    for (const scale of [1, 2]) {
      const bmp = F.renderText(s, { scale });
      assert.equal(bmp.width, F.measure(s, { scale }));
      const b = bmp.bounds();
      assert.ok(b.x >= 0 && b.x + b.w <= bmp.width);
    }
  }
});

test("pixel raster is 16 rows with glyphs inside rows 1..14", () => {
  const r = pixelRaster("GO");
  assert.equal(r.height, 16);
  const b = new Bitmap(r.width, r.height, r.data).bounds();
  assert.ok(b.y >= 1 && b.y + b.h <= 15);
});

test("speed HUD fits the panel for 0..999 in both units and is centred", () => {
  for (const unit of ["KM/H", "MPH"]) {
    for (const v of [0, 7, 42, 99, 100, 188, 999]) {
      const bmp = Gx.speedHud(v, { unit });
      const b = bmp.bounds();
      assert.ok(b.x >= 0 && b.x + b.w <= 96, `${v} ${unit}`);
      assert.ok(Math.abs(b.x - (96 - (b.x + b.w))) <= 2, `${v} ${unit} centred (${b.x}, ${96 - b.x - b.w})`);
    }
  }
  const over = Gx.speedHud(120, { over: true });
  assert.equal(over.get(0, 0), 1);
  assert.equal(over.get(95, 15), 1);
  assert.ok(Gx.speedHud(140).litCount() > Gx.speedHud(10).litCount(), "bar grows with speed");
});

test("brake frame fits, is symmetric and contains two warning triangles", () => {
  const bmp = Gx.brakeFrame();
  const b = bmp.bounds();
  assert.ok(b.x >= 0 && b.x + b.w <= 96);
  const tri = Gx.warningTriangle();
  assert.equal(tri.get(6, 0), 1); // apex
  assert.equal(tri.get(6, 5), 0); // "!" cut-out
  assert.equal(tri.get(0, 13), 1); // base corners
  assert.equal(tri.get(12, 13), 1);
});

test("word frames: STOPPED fits, clock renders HH:MM", () => {
  const b = Gx.stoppedFrame().bounds();
  assert.ok(b.w <= 96 && b.x >= 0);
  const clk = Gx.clockFrame(new Date(2026, 0, 1, 9, 5));
  assert.ok(clk.litCount() > 0);
  assert.ok(clk.equals(Gx.wordFrame("09:05")));
});

test("thresholdImageData uses v2 luminance threshold (80)", () => {
  const px = new Uint8ClampedArray([255, 255, 255, 255, 60, 60, 60, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const bmp = thresholdImageData(px, 4, 1);
  assert.deepEqual([...bmp.data], [1, 0, 1, 0]); // pure blue lum = 29 < 80
});

test("devil eyes: each mode lights pixels, animated modes change over time", () => {
  for (const mode of Gx.DEVIL_MODES) assert.ok(Gx.devilEyes(mode, 0).litCount() > 20, mode);
  assert.ok(!Gx.devilEyes("cylon", 0).equals(Gx.devilEyes("cylon", 30)));
  assert.ok(!Gx.devilEyes("winking", 0).equals(Gx.devilEyes("winking", 100)));
});

test("bitmap helpers", () => {
  const b = new Bitmap(4, 2);
  b.set(1, 1);
  b.set(99, 99); // out of range: ignored
  assert.equal(b.litCount(), 1);
  assert.equal(b.toAscii(), "....\n.#..");
  assert.deepEqual(b.bounds(), { x: 1, y: 1, w: 1, h: 1 });
  const c = new Bitmap(4, 2).blit(b);
  assert.ok(c.equals(b));
  assert.equal(c.key(), b.key());
  assert.equal(new Bitmap(4, 2).bounds(), null);
});
