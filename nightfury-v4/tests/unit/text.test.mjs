import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSpeed, describeLayout, layoutFrameAt, layoutText, paceOf, pixelOnlyRasterizer as R, scrollDurationMs, scrollFrameAt } from "../../js/text.js";
import { quantize } from "../../js/frame.js";
import { Bitmap } from "../../js/bitmap.js";

const spec = (o) => ({ text: "HI", color: "#ff0000", color2: "#00ff00", paint: "solid", effect: "auto", size: "big", speed: 6, ...o });

test("auto: short text is one centred still, long text scrolls", () => {
  const a = layoutText(spec({ text: "THANKS!" }), R);
  assert.equal(a.kind, "frames");
  assert.equal(a.frames.length, 1);
  const b = a.frames[0].mask().bounds();
  assert.ok(Math.abs(b.x - (96 - b.x - b.w)) <= 1, "centred");
  assert.equal(describeLayout(a).fits, true);
  const l = layoutText(spec({ text: "KEEP YOUR DISTANCE PLEASE" }), R);
  assert.equal(l.kind, "scroll");
  assert.ok(l.raster.width > 96);
  assert.equal(describeLayout(l).fits, false);
});

test("static falls back to scroll when it cannot fit; scroll always scrolls", () => {
  assert.equal(layoutText(spec({ text: "KEEP YOUR DISTANCE", effect: "static" }), R).kind, "scroll");
  assert.equal(layoutText(spec({ text: "HI", effect: "scroll" }), R).kind, "scroll");
});

test("words: one centred word per frame plus a pause; falls back when a word is too wide", () => {
  const l = layoutText(spec({ text: "KEEP YOUR DISTANCE", effect: "words" }), R);
  assert.equal(l.kind, "frames");
  assert.equal(l.frames.length, 4);
  assert.equal(l.frames[3].litCount(), 0);
  assert.ok(l.durations[2] > l.durations[0], "longer words stay longer");
  assert.ok(layoutFrameAt(l, 0).equals(l.frames[0]));
  assert.ok(layoutFrameAt(l, l.durations[0] + 1).equals(l.frames[1]));
  assert.ok(layoutFrameAt(l, l.loopMs + 1).equals(l.frames[0]), "loops");
  assert.equal(layoutText(spec({ text: "SUPERCALIFRAGILISTIC NO", effect: "words" }), R).kind, "scroll");
  assert.equal(layoutText(spec({ text: "SOLO", effect: "words" }), R).frames.length, 1);
});

test("blink alternates the frame with darkness", () => {
  const l = layoutText(spec({ text: "HAZARD", effect: "blink" }), R);
  assert.equal(l.frames.length, 2);
  assert.ok(layoutFrameAt(l, 100).litCount() > 0);
  assert.equal(layoutFrameAt(l, 700).litCount(), 0);
});

test("panel animation off: never returns multi-frame layouts", () => {
  for (const effect of ["words", "blink"]) {
    const l = layoutText(spec({ text: "KEEP CLEAR", effect }), R, { allowMotion: false });
    assert.ok(l.kind === "scroll" || l.frames.length === 1, effect);
  }
  const small = layoutText(spec({ text: "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN", size: "small" }), R, { allowMotion: false });
  assert.equal(small.frames.length, 1);
});

test("small size: two lines per page, pages cycle, non-Latin falls back to big", () => {
  const one = layoutText(spec({ text: "BABY ON BOARD", size: "small" }), R);
  assert.equal(one.frames.length, 1);
  const b = one.frames[0].mask().bounds();
  assert.equal(b.h, 7, "single line");
  const two = layoutText(spec({ text: "BABY ON BOARD PLEASE KEEP BACK", size: "small" }), R);
  assert.equal(two.frames.length, 1);
  assert.equal(two.frames[0].mask().bounds().h, 16, "two lines fill the height");
  const many = layoutText(spec({ text: "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE", size: "small" }), R);
  assert.ok(many.frames.length >= 2);
  assert.ok(!layoutFrameAt(many, 0).equals(layoutFrameAt(many, 2700)));
  const long = layoutText(spec({ text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", size: "small" }), R);
  assert.ok(long.frames.every((f) => f.mask().bounds().w <= 96), "hard-wraps a long word");
});

test("rainbow and duo paints are chunk-exact", () => {
  const rb = layoutText(spec({ text: "RAINBOW", paint: "rainbow" }), R).frames[0];
  assert.ok(rb.colors().length >= 6);
  assert.ok(quantize(rb).equals(rb));
  const duo = layoutText(spec({ text: "GO SLOW NOW PLEASE", paint: "duo" }), R);
  assert.equal(duo.kind, "scroll");
  assert.deepEqual(duo.raster.colors().sort(), ["#00ff00", "#ff0000"]);
  assert.ok(quantize(duo.raster).equals(duo.raster));
  // Short words would share a chunk unless each one starts on a chunk boundary.
  // (Canvas-rendered Tamil words have arbitrary widths; a 9-pixel block stands in for them here.)
  const block = () => { const b = new Bitmap(9, 16); b.fillRect(0, 0, 9, 16); return b; };
  const tight = layoutText(spec({ text: "A B C D E F G H", paint: "duo", effect: "scroll" }), block).raster;
  assert.ok(quantize(tight).equals(tight), "short duo words stay exact");
  for (let x = 0; x < tight.width; x += 8) {
    const seen = new Set();
    for (let y = 0; y < 16; y++) for (let c = x; c < Math.min(tight.width, x + 8); c++) if (tight.get(c, y)) seen.add(tight.get(c, y));
    assert.ok(seen.size <= 1, `chunk at ${x} mixes colours`);
  }
  const rbScroll = layoutText(spec({ text: "RAINBOW RIBBON OF TEXT", paint: "rainbow" }), R);
  assert.ok(quantize(rbScroll.raster).equals(rbScroll.raster));
});

test("scroll preview enters from the right and leaves on the left", () => {
  const l = layoutText(spec({ text: "KEEP YOUR DISTANCE PLEASE" }), R);
  assert.equal(scrollFrameAt(l, 0).litCount(), 0);
  const early = scrollFrameAt(l, 300).mask().bounds();
  assert.ok(early.x > 40);
  assert.ok(scrollFrameAt(l, 2000).litCount() > 100);
});

test("empty text is a blank still", () => {
  const l = layoutText(spec({ text: "   " }), R);
  assert.equal(l.frames[0].litCount(), 0);
});

test("speed: 6 is normal, slower stretches and faster shortens every frame, never below 300 ms", () => {
  assert.equal(paceOf(6), 1);
  assert.equal(paceOf(1), 2);
  assert.equal(paceOf(10), 0.6);
  assert.equal(paceOf(undefined), 1, "no speed means normal");
  for (let s = 1; s < 10; s++) assert.ok(paceOf(s) > paceOf(s + 1), `pace falls from ${s} to ${s + 1}`);
  assert.deepEqual([0, -3, 99, "4", 6.4, null].map(clampSpeed), [6, 1, 10, 4, 6, 6]);

  const at = (speed) => layoutText(spec({ text: "KEEP YOUR DISTANCE", effect: "words", speed }), R).durations;
  assert.deepEqual(at(6), [920, 920, 1240, 450], "normal pace is unchanged");
  assert.deepEqual(at(1), [1840, 1840, 2480, 900]);
  assert.deepEqual(at(10), [552, 552, 744, 300], "the pause is held at the 300 ms floor");
  assert.deepEqual(layoutText(spec({ effect: "blink", speed: 10 }), R).durations, [360, 300]);
  assert.deepEqual(layoutText(spec({ effect: "blink", speed: 2 }), R).durations, [1080, 540]);
  const pages = (speed) => layoutText(spec({ text: "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN", size: "small", speed }), R).durations[0];
  assert.equal(pages(6), 2600);
  assert.equal(pages(3), 4160);
});

test("speed: scrolling carries the clamped speed, and a faster one finishes sooner", () => {
  const long = (speed) => layoutText(spec({ text: "KEEP YOUR DISTANCE PLEASE", speed }), R);
  assert.equal(long(3).speed, 3);
  assert.equal(long(40).speed, 10);
  assert.equal(long(undefined).speed, 6);
  assert.ok(scrollDurationMs(long(9)) < scrollDurationMs(long(6)));
  assert.ok(scrollDurationMs(long(2)) > 2.5 * scrollDurationMs(long(6)));
});
