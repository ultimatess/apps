import { test } from "node:test";
import assert from "node:assert/strict";
import { LED, FRAME_MS, brakeFrame, clockFrame, colorBarsFrame, gridFrame, hazardFrame, speedHud, stoppedFrame, turnFrame } from "../../js/graphics.js";
import { quantize } from "../../js/frame.js";
import { EYE_PACK, eyesBitmap, isReactive, livingEyes } from "../../js/eyes.js";
import { FX, fxFrame } from "../../js/fx.js";
import { ICON_NAMES, icon } from "../../js/icons.js";

const exact = (f) => quantize(f).equals(f);
const cols = (f, x0, x1) => { let n = 0; for (let y = 0; y < 16; y++) for (let x = x0; x < x1; x++) if (f.get(x, y)) n++; return n; };

test("every HUD frame keeps its colours on the chunk grid (shown exactly by the panel)", () => {
  const frames = [
    speedHud(7, { frac: 0.1 }), speedHud(62, { frac: 0.5 }), speedHud(188, { frac: 1, over: true, unit: "MPH" }),
    turnFrame("left"), turnFrame("right", 0), turnFrame("right", FRAME_MS), hazardFrame(), brakeFrame(), brakeFrame(FRAME_MS),
    stoppedFrame(), clockFrame(new Date(2026, 0, 1, 9, 5)), gridFrame(), colorBarsFrame(),
  ];
  frames.forEach((f, i) => assert.ok(exact(f), `frame ${i}`));
});

test("speed HUD: digits, unit and gauge live in their own zones", () => {
  const f = speedHud(62, { frac: 0.5 });
  assert.ok(cols(f, 0, 40) > 40, "digits");
  assert.ok(cols(f, 40, 64) > 20, "unit");
  const ink = (fr) => { for (let x = 0; x < 40; x++) for (let y = 0; y < 16; y++) if (fr.get(x, y)) return fr.get(x, y); return null; };
  assert.equal(ink(f), LED.white);
  // frac 0.5 lights two of four bars; the others show a dim base line only.
  assert.equal(cols(f, 64, 72), 6 * 4);
  assert.equal(cols(f, 72, 80), 6 * 7);
  assert.equal(cols(f, 80, 88), 6);
  assert.equal(cols(f, 88, 96), 6);
  const over = speedHud(140, { frac: 1, over: true });
  assert.equal(ink(over), LED.red);
  assert.equal(over.get(90, 10), LED.red);
  assert.equal(speedHud(3, { frac: 0 }).get(66, 12), null);
});

test("speed HUD clamps and never overflows its zone", () => {
  for (const v of [0, 9, 10, 99, 100, 199, 888, 999, 1500, -4]) assert.equal(cols(speedHud(v, { frac: 0 }), 39, 40), 0, `${v}`);
});

test("turn signal fills towards the turn in three stages, then goes dark", () => {
  const lit = (dir, stage) => [0, 1, 2, 3, 4, 5].map((i) => (cols(turnFrame(dir, stage * FRAME_MS), i * 16, i * 16 + 16) ? 1 : 0)).join("");
  assert.equal(lit("right", 0), "110000");
  assert.equal(lit("right", 1), "111100");
  assert.equal(lit("right", 2), "111111");
  assert.equal(lit("right", 3), "000000");
  assert.equal(lit("left", 0), "000011");
  assert.equal(lit("left", 2), "111111");
  assert.equal(lit("right", 4), lit("right", 0), "loops");
  assert.equal(turnFrame("left").litCount(), turnFrame("left", 2 * FRAME_MS).litCount(), "poster = all lit");
  // Left chevrons point left: the tip (rows 7-8) is at the lowest x.
  const f = turnFrame("left");
  const firstLit = (y) => { for (let x = 0; x < 16; x++) if (f.get(x, y)) return x; return -1; };
  assert.ok(firstLit(7) < firstLit(0));
  assert.equal(turnFrame("right").get(0, 0), null);
  assert.equal(f.dominant(), LED.amber);
});

test("brake: the slab is mostly lit and alternates with the word; hazard blinks", () => {
  const slab = brakeFrame();
  assert.ok(slab.litCount() > 96 * 16 * 0.7);
  assert.equal(slab.dominant(), LED.red);
  const word = brakeFrame(FRAME_MS);
  assert.ok(word.litCount() < slab.litCount() / 2 && word.litCount() > 100);
  assert.ok(brakeFrame(0).equals(slab));
  assert.ok(hazardFrame(0).litCount() > 200);
  assert.equal(hazardFrame(FRAME_MS).litCount(), 0);
  assert.ok(hazardFrame().equals(hazardFrame(0)));
});

test("clock shows HH:MM", () => {
  const a = clockFrame(new Date(2026, 0, 1, 9, 5));
  const b = clockFrame(new Date(2026, 0, 1, 9, 6));
  assert.ok(a.litCount() > 80);
  assert.ok(!a.equals(b));
  assert.ok(a.equals(clockFrame(new Date(2026, 0, 1, 9, 5, 59))));
});

test("living eyes: symmetric at rest, pupils follow the gaze, blinks close, poster is open", () => {
  const rest = livingEyes("calm", 1000, { gaze: 0 });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 48; x++) assert.equal(rest.get(x, y), rest.get(x + 48, y), `${x},${y}`);
  const dark = (bmp, cx) => { let sx = 0, n = 0; for (let y = 5; y <= 10; y++) for (let x = cx - 11; x <= cx + 11; x++) if (!bmp.get(x, y)) { sx += x; n++; } return sx / n; };
  const left = livingEyes("calm", 1000, { gaze: -1 });
  const right = livingEyes("calm", 1000, { gaze: 1 });
  assert.ok(dark(left, 24) < dark(rest, 24) - 2);
  assert.ok(dark(right, 24) > dark(rest, 24) + 2);
  assert.ok(livingEyes("calm", 3500 + 100).litCount() < rest.litCount() / 3, "blink");
  assert.ok(livingEyes("calm", 0, { poster: true }).equals(livingEyes("calm", 1000, { gaze: 0 })), "poster open + centred");
  assert.ok(livingEyes("calm", 1000, { gaze: 0, alert: true }).equals(livingEyes("wide", 1000, { gaze: 0 })), "alert widens");
  // The 4 fps panel stream samples multiples of 250 ms: it must catch every blink.
  let caught = 0;
  for (let t = 0; t < 14000; t += 250) if (livingEyes("calm", t, { gaze: 0 }).litCount() < rest.litCount() / 3) caught++;
  assert.equal(caught, 4);
});

test("every eye in the pack renders, stays on the panel and reports reactivity", () => {
  for (const e of EYE_PACK) {
    for (const ms of [0, 250, 1900, 3600]) {
      const bmp = eyesBitmap(e.mode, ms);
      assert.equal(bmp.width, 96);
      assert.ok(bmp.litCount() > 10, `${e.mode}@${ms}`);
    }
  }
  assert.equal(isReactive("living_calm"), true);
  assert.equal(isReactive("living_love"), false);
  assert.equal(isReactive("angry"), false);
  assert.equal(new Set(EYE_PACK.map((e) => e.mode)).size, EYE_PACK.length);
});

test("built-in art renders in colour and animates; badges are chunk-exact", () => {
  for (const id of Object.keys(FX)) {
    const a = fxFrame(id, 0), b = fxFrame(id, 250), c = fxFrame(id, 500);
    assert.ok(a.litCount() > 15, id);
    if (!["thanks", "smile"].includes(id)) assert.ok(!a.equals(b) || !a.equals(c), `${id} animates`);
  }
  for (const id of ["thanks", "love", "smile", "pass", "equalizer", "wave", "tape"]) assert.ok(exact(fxFrame(id, 500)), id);
  assert.ok(fxFrame("equalizer", 0).colors().length >= 10);
});

test("icons are at most 16 rows and mirror cleanly", () => {
  for (const n of ICON_NAMES) {
    const i = icon(n);
    assert.ok(i.height <= 16 && i.width <= 16, n);
    assert.equal(icon(n, { flip: true }).litCount(), i.litCount());
  }
  assert.equal(icon("arrow").get(13, 4), 1);
  assert.equal(icon("arrow", { flip: true }).get(0, 4), 1);
});
