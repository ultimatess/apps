// HUD arbitration, scenes, queue, store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arbitrate, HOLD_OPTIONS } from "../../js/hud.js";
import { hardwarePlan, renderPreview, sceneKey, describeScene } from "../../js/scene.js";
import { TxQueue } from "../../js/queue.js";
import { createStore, DEFAULT_SETTINGS } from "../../js/store.js";
import { Bitmap } from "../../js/bitmap.js";
import { pixelRaster } from "../../js/textraster.js";
import { isPixelFontText } from "../../js/font5x7.js";
import { mapScrollSpeed } from "../../js/protocol.js";

// Test rasteriser: pixel font where possible, otherwise a fixed-width block per char.
const rasterize = (text) => {
  if (isPixelFontText(text)) return pixelRaster(text);
  const b = new Bitmap([...text].length * 8, 16);
  b.fillRect(0, 4, b.width, 8);
  return b;
};

const msg = (text, at, extra = {}) => ({ scene: { kind: "text", text, color: "#fff", style: "static", speed: 6, ...extra }, at });

test("brake beats everything; manual brake works even with Auto HUD off", () => {
  const base = { now: 1000, kmh: 50, hasSpeed: true, turn: "left", user: msg("HI", 999) };
  assert.equal(arbitrate({ ...base, sensorBrake: true }).kind, "brake");
  assert.equal(arbitrate({ ...base, autoHud: false, sensorBrake: true }).kind, "text", "sensor brake needs Auto HUD");
  assert.equal(arbitrate({ ...base, autoHud: false, manualBrakeUntil: 2000 }).kind, "brake");
});

test("turn beats a fresh message; message beats speed while held", () => {
  const base = { now: 10_000, kmh: 50, hasSpeed: true };
  assert.equal(arbitrate({ ...base, turn: "right", user: msg("HI", 9_999) }).kind, "turn");
  assert.equal(arbitrate({ ...base, user: msg("HI", 9_000) }).kind, "text");
});

test("speed HUD returns after the hold window (v2 never returned)", () => {
  const user = msg("HI", 0);
  assert.equal(arbitrate({ now: HOLD_OPTIONS["10s"] - 1, kmh: 50, hasSpeed: true, user }).kind, "text");
  const s = arbitrate({ now: HOLD_OPTIONS["10s"] + 1, kmh: 50, hasSpeed: true, user });
  assert.equal(s.kind, "speed");
  assert.equal(s.value, 50);
  assert.equal(arbitrate({ now: 1e9, kmh: 50, hasSpeed: true, user, holdMs: HOLD_OPTIONS.sticky }).kind, "text", "pinned");
});

test("no speed source -> user message stays up", () => {
  assert.equal(arbitrate({ now: 1e9, hasSpeed: false, user: msg("HI", 0) }).kind, "text");
  assert.equal(arbitrate({ now: 1e9, hasSpeed: false }).text, "வணக்கம் 🤝", "default greeting");
});

test("stopped modes, units and speed limit", () => {
  const base = { now: 1e9, kmh: 0, hasSpeed: true, user: msg("HI", 0) };
  assert.equal(arbitrate(base).kind, "stopped");
  assert.equal(arbitrate({ ...base, stoppedMode: "clock" }).kind, "clock");
  assert.equal(arbitrate({ ...base, stoppedMode: "message" }).text, "HI");
  const mph = arbitrate({ ...base, kmh: 100, unit: "mph" });
  assert.equal(mph.unit, "MPH");
  assert.ok(Math.abs(mph.value - 62.14) < 0.01);
  const over = arbitrate({ ...base, kmh: 90, limitKmh: 80 });
  assert.equal(over.over, true);
  assert.equal(over.color, "#ef4444");
  assert.equal(arbitrate({ ...base, kmh: 80, limitKmh: 80 }).over, false);
});

test("hardware plan: static fits -> frame; long or scroll -> native scroll", () => {
  const fits = hardwarePlan({ kind: "text", text: "HI", style: "static", speed: 6 }, rasterize);
  assert.equal(fits.type, "frame");
  assert.equal(fits.bitmap.width, 96);
  const long = hardwarePlan({ kind: "text", text: "KEEP DISTANCE PLEASE", style: "static", speed: 6 }, rasterize);
  assert.equal(long.type, "text");
  const scroll = hardwarePlan({ kind: "text", text: "HI", style: "scroll", speed: 9 }, rasterize);
  assert.equal(scroll.type, "text");
  assert.equal(scroll.speed, mapScrollSpeed(9));
  for (const kind of ["brake", "stopped"]) assert.equal(hardwarePlan({ kind }, rasterize).type, "frame");
  assert.equal(hardwarePlan({ kind: "clock" }, rasterize).type, "clock");
  assert.equal(hardwarePlan({ kind: "speed", value: 42, unit: "KM/H" }, rasterize).type, "frame");
  assert.equal(hardwarePlan({ kind: "devil", mode: "angry" }, rasterize).bitmap.width, 96);
});

test("preview scroll enters from the right and moves left over time", () => {
  const scene = { kind: "text", text: "GO", style: "scroll", speed: 6 };
  const first = renderPreview(scene, 0, rasterize);
  assert.equal(first.litCount(), 0, "starts off-screen right");
  const a = renderPreview(scene, 400, rasterize).bounds();
  const b = renderPreview(scene, 800, rasterize).bounds();
  assert.ok(a && b && b.x < a.x);
  const brakeOn = renderPreview({ kind: "brake" }, 0, rasterize).litCount();
  const brakeOff = renderPreview({ kind: "brake" }, 250, rasterize).litCount();
  assert.ok(brakeOn > 0 && brakeOff === 0, "brake flashes in preview");
});

test("sceneKey dedupes identical scenes and distinguishes re-sends", () => {
  const a = { kind: "text", text: "HI", style: "static", speed: 6, color: "#fff", nonce: 1 };
  assert.equal(sceneKey(a), sceneKey({ ...a }));
  assert.notEqual(sceneKey(a), sceneKey({ ...a, nonce: 2 }));
  assert.equal(sceneKey({ kind: "speed", value: 50.2, unit: "KM/H" }), sceneKey({ kind: "speed", value: 49.8, unit: "KM/H" }));
  assert.equal(describeScene({ kind: "turn", dir: "left" }), "⬅ Turning left");
});

test("TxQueue runs jobs serially", async () => {
  const q = new TxQueue({ gapMs: 0 });
  let active = 0, maxActive = 0;
  const order = [];
  const job = (n) => async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    order.push(n); active--;
  };
  await Promise.all([1, 2, 3, 4].map((n) => q.enqueue(job(n))));
  assert.deepEqual(order, [1, 2, 3, 4]);
  assert.equal(maxActive, 1);
});

test("TxQueue coalesces pending jobs with the same key (latest wins)", async () => {
  const q = new TxQueue({ gapMs: 0 });
  const ran = [];
  const slow = q.enqueue(async () => { await new Promise((r) => setTimeout(r, 20)); ran.push("first"); }, { key: "scene" });
  const results = await Promise.all([
    slow,
    ...[1, 2, 3, 4, 5].map((n) => q.enqueue(async () => ran.push(n), { key: "scene" })),
    q.enqueue(async () => ran.push("other"), { key: "brightness" }),
  ]);
  assert.deepEqual(ran, ["first", "other", 5].sort((a, b) => ran.indexOf(a) - ran.indexOf(b)));
  assert.ok(ran.includes(5) && !ran.includes(1) && !ran.includes(4));
  assert.equal(results.filter((r) => r.superseded).length, 4);
  assert.equal(q.stats.superseded, 4);
});

test("TxQueue: failures reject the job but don't stall the queue; clear() cancels", async () => {
  const q = new TxQueue({ gapMs: 0 });
  const bad = q.enqueue(async () => { throw new Error("boom"); });
  const good = q.enqueue(async () => 42);
  await assert.rejects(bad, /boom/);
  assert.deepEqual(await good, { value: 42 });
  const blocker = q.enqueue(() => new Promise((r) => setTimeout(r, 20)));
  const cancelled = q.enqueue(async () => 1);
  q.clear("test");
  assert.equal((await cancelled).cancelled, true);
  await blocker;
  await q.idle();
  assert.equal(q.busy, false);
});

test("store persists settings, custom messages and recents", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = createStore(storage);
  assert.equal(a.settings.brightness, DEFAULT_SETTINGS.brightness);
  assert.equal(a.settings.autoRotate, false);
  a.set({ brightness: 42, unit: "mph", autoRotate: true, autoRotateInterval: "15s" });
  a.addCustom({ text: "ONE" });
  a.addCustom({ text: "TWO" });
  a.addCustom({ text: "ONE" }); // dedupe, moves to front
  for (let i = 0; i < 12; i++) a.pushRecent({ text: `R${i}` });
  const b = createStore(storage);
  assert.equal(b.settings.brightness, 42);
  assert.equal(b.settings.unit, "mph");
  assert.equal(b.settings.autoRotate, true);
  assert.equal(b.settings.autoRotateInterval, "15s");
  assert.deepEqual(b.custom.map((c) => c.text), ["ONE", "TWO"]);
  assert.equal(b.recents.length, 8);
  assert.equal(b.recents[0].text, "R11");
  b.removeCustom("ONE");
  b.reset();
  const c = createStore(storage);
  assert.deepEqual(c.custom.map((x) => x.text), ["TWO"]);
  assert.equal(c.settings.brightness, DEFAULT_SETTINGS.brightness);
  assert.equal(c.settings.autoRotate, false);
});

test("store survives broken storage", () => {
  const storage = { getItem: () => "{not json", setItem: () => { throw new Error("quota"); } };
  const s = createStore(storage);
  assert.equal(s.settings.speed, DEFAULT_SETTINGS.speed);
  s.set({ speed: 3 });
  assert.equal(s.settings.speed, 3);
});
