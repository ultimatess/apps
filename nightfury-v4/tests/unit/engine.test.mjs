// The engine loop against a recording panel and a fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, effectiveBrightness } from "../../js/engine.js";
import { createScenes } from "../../js/scene.js";
import { DriveModel } from "../../js/drive.js";
import { pixelOnlyRasterizer } from "../../js/text.js";
import { FRAME_MS, brakeFrame, speedHud, turnFrame } from "../../js/graphics.js";
import { DEFAULT_SETTINGS } from "../../js/store.js";

function setup(over = {}) {
  const S = { ...DEFAULT_SETTINGS, ...over };
  const pushes = [];
  const panel = {
    ready: true,
    queue: { busy: false },
    fail: false,
    pushFrame(frame, o) { pushes.push({ type: "frame", frame, o }); return Promise.resolve(this.fail ? { error: new Error("x") } : { value: 1 }); },
    pushScroll(raster, speed, o) { pushes.push({ type: "scroll", raster, speed, o }); return Promise.resolve({ value: 1 }); },
  };
  let wall = new Date(2026, 0, 1, 9, 5, 0).getTime();
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer, options: () => S });
  const drive = new DriveModel({ options: () => S });
  const items = { a: { kind: "fx", id: "wave" }, b: { kind: "text", text: "HI", color: "#ff0000" } };
  const engine = new Engine({ panel, scenes, drive, settings: () => S, resolve: (ref) => items[ref] ?? null, wall: () => wall });
  // Fonts resolve on a microtask; let them settle.
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { S, pushes, panel, engine, scenes, settle, setWall: (v) => { wall = v; } };
}

const text = (t, o = {}) => ({ kind: "text", text: t, color: "#00ff00", effect: "auto", ...o });

test("a still scene is pushed once, however many ticks pass", async () => {
  const { engine, pushes, settle } = setup({ hud: "off" });
  engine.show(text("THANKS"), 0);
  engine.tick(0);
  await settle();
  for (let t = 100; t < 3000; t += 100) engine.tick(t);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].type, "frame");
  assert.ok(pushes[0].frame.litCount() > 50);
});

test("text waits for its font before the first push", async () => {
  const { engine, pushes, settle } = setup({ hud: "off" });
  engine.show(text("HELLO"), 0);
  engine.tick(0);
  assert.equal(pushes.length, 0, "font not ready yet");
  await settle();
  engine.tick(100);
  assert.equal(pushes.length, 1);
});

test("long text goes out once as a firmware scroll with the mapped speed", async () => {
  const { engine, pushes, settle } = setup({ hud: "off" });
  engine.show(text("KEEP YOUR DISTANCE PLEASE", { speed: 6 }), 0);
  engine.tick(0);
  await settle();
  for (let t = 100; t < 2000; t += 100) engine.tick(t);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].type, "scroll");
  assert.equal(pushes[0].speed, 72);
  assert.ok(pushes[0].raster.width > 96);
});

test("sending the same message again re-sends it", async () => {
  const { engine, pushes, settle } = setup({ hud: "off" });
  engine.show(text("HI"), 0);
  engine.tick(0);
  await settle();
  engine.tick(100);
  engine.show(text("HI"), 200);
  engine.tick(200);
  assert.equal(pushes.length, 2);
});

test("speed HUD: pushed on change, at most every 700 ms; a scene change is immediate", () => {
  const { engine, pushes } = setup({ hud: "full" });
  engine.sim = { kmh: 50, turn: "straight" };
  engine.tick(0);
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].frame.equals(speedHud(50, { frac: 50 / 120 })));
  engine.sim.kmh = 51; engine.tick(100);
  engine.sim.kmh = 52; engine.tick(400);
  assert.equal(pushes.length, 1, "rate limited");
  engine.tick(700);
  assert.equal(pushes.length, 2);
  assert.ok(pushes[1].frame.equals(speedHud(52, { frac: 52 / 120 })), "latest value, not a stale one");
  engine.sim.brake = true;
  engine.tick(750);
  assert.equal(pushes.length, 3, "brake does not wait for the speed rate limit");
  assert.ok(pushes[2].frame.equals(brakeFrame(0)));
});

test("signals animate on the panel in FRAME_MS steps and skip frames while the link is busy", () => {
  const { engine, pushes, panel } = setup({ hud: "signals" });
  engine.signal("right", 0);
  for (let t = 0; t <= FRAME_MS * 4; t += 50) engine.tick(t);
  assert.equal(pushes.length, 5);
  [0, 1, 2, 3, 4].forEach((i) => assert.ok(pushes[i].frame.equals(turnFrame("right", i * FRAME_MS)), `stage ${i}`));
  panel.queue.busy = true;
  for (let t = FRAME_MS * 5; t <= FRAME_MS * 8; t += 50) engine.tick(t);
  assert.equal(pushes.length, 5, "no stacking behind a slow link");
  panel.queue.busy = false;
  engine.tick(FRAME_MS * 9);
  assert.equal(pushes.length, 6);
});

test("panel animation off: signals are a single poster frame", () => {
  const { engine, pushes } = setup({ hud: "signals", motion: "off" });
  engine.signal("left", 0);
  for (let t = 0; t <= 3000; t += 50) engine.tick(t);
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].frame.equals(turnFrame("left")));
});

test("eyes: animate when motion is 'all', otherwise a still that only changes with the gaze", () => {
  const eyes = { kind: "eyes", mode: "living_calm", color: "#a3e635", react: true };
  const a = setup({ hud: "off", motion: "all" });
  a.engine.show(eyes, 0);
  for (let t = 0; t <= 8000; t += 50) a.engine.tick(t);
  assert.ok(a.pushes.length >= 4, `animated: ${a.pushes.length} frames`);
  assert.ok(a.pushes.length <= 33, "never more than 4 fps");

  const b = setup({ hud: "off", motion: "signals" });
  b.engine.show(eyes, 0);
  b.engine.sim = { kmh: 30, turn: "straight" };
  for (let t = 0; t <= 4000; t += 50) b.engine.tick(t);
  assert.equal(b.pushes.length, 1);
  b.engine.sim.turn = "left";
  for (let t = 4050; t <= 6000; t += 50) b.engine.tick(t);
  assert.equal(b.pushes.length, 2, "looks into the turn");
  b.engine.sim.turn = "straight";
  for (let t = 6050; t <= 7000; t += 50) b.engine.tick(t);
  assert.equal(b.pushes.length, 3, "and back");
});

test("clock is re-sent when the minute changes, not every tick", () => {
  const { engine, pushes, setWall } = setup({ hud: "off" });
  engine.show({ kind: "clock", color: "#ff9000" }, 0);
  for (let t = 0; t < 5000; t += 100) engine.tick(t);
  assert.equal(pushes.length, 1);
  setWall(new Date(2026, 0, 1, 9, 6, 0).getTime());
  engine.tick(5000);
  assert.equal(pushes.length, 2);
});

test("a draft is preview-only", async () => {
  const { engine, pushes, settle } = setup({ hud: "off" });
  engine.show(text("ONE"), 0);
  engine.tick(0);
  await settle();
  engine.tick(50);
  engine.setDraft(text("DRAFT TEXT", { effect: "static" }), 100);
  engine.tick(100);
  assert.equal(pushes.length, 1);
  assert.equal(engine.status, "draft");
  assert.ok(!engine.previewFrame(150).equals(pushes[0].frame));
  engine.setDraft(null, 200);
  assert.ok(engine.previewFrame(250).equals(pushes[0].frame));
  assert.equal(engine.status, "live");
});

test("nothing is sent before the panel is ready; everything is re-sent after a reconnect", () => {
  const { engine, pushes, panel } = setup({ hud: "full" });
  panel.ready = false;
  engine.sim = { kmh: 40, turn: "straight" };
  engine.tick(0);
  assert.equal(pushes.length, 0);
  assert.equal(engine.status, "preview");
  panel.ready = true;
  engine.tick(100);
  assert.equal(pushes.length, 1);
  panel.ready = false; engine.tick(200);
  panel.ready = true; engine.tick(300);
  assert.equal(pushes.length, 2, "same frame, sent again");
});

test("a failed write is retried on a later tick", async () => {
  const { engine, pushes, panel } = setup({ hud: "full" });
  engine.sim = { kmh: 40, turn: "straight" };
  panel.fail = true;
  engine.tick(0);
  await new Promise((r) => setTimeout(r, 0));
  panel.fail = false;
  engine.tick(800);
  assert.equal(pushes.length, 2);
});

test("changing bit order or colour mode re-sends the current frame", () => {
  const { engine, pushes, S } = setup({ hud: "full" });
  engine.sim = { kmh: 40, turn: "straight" };
  engine.tick(0);
  S.lsbFirst = false; engine.tick(800);
  S.multiColor = false; engine.tick(1600);
  assert.equal(pushes.length, 3);
  assert.equal(pushes[2].frame.colors().length, 1, "single-colour mode collapses the HUD to one colour");
});

test("shows play as idle content, yield to speed and to a tapped message, then resume", async () => {
  const { engine, settle } = setup({ hud: "full", holdKey: "5s" });
  engine.show(text("PINNED"), 0);
  assert.equal(engine.playShow({ items: [{ ref: "a", secs: 5 }, { ref: "b", secs: 5 }, { ref: "missing", secs: 5 }] }, 0), true);
  assert.equal(engine.user, null, "starting a show clears the old message");
  assert.equal(engine.tick(100).kind, "fx");
  assert.equal(engine.tick(5100).kind, "text");
  assert.equal(engine.tick(10100).source, "base", "an item that no longer exists falls back to the base scene");
  engine.show(text("TAP"), 16000);
  assert.equal(engine.tick(16100).text, "TAP");
  assert.ok(engine.holdLeft(16100) > 0.9);
  assert.equal(engine.tick(21100).source, "show");
  assert.equal(engine.holdLeft(21100), null);
  engine.sim = { kmh: 50, turn: "straight" };
  assert.equal(engine.tick(21200).kind, "speed");
  engine.stopShow();
  await settle();
  assert.equal(engine.player.playing, false);
});

test("edge events: brake, over-limit and signal each fire once per change", () => {
  const { engine } = setup({ hud: "full", limitKmh: 60 });
  const seen = [];
  engine.on("brake", (v) => seen.push(`brake:${v}`));
  engine.on("over", (v) => seen.push(`over:${v}`));
  engine.on("signal", (v) => seen.push(`signal:${v}`));
  engine.sim = { kmh: 50, turn: "straight" };
  engine.tick(0); engine.tick(100);
  engine.sim.kmh = 70; engine.tick(200); engine.tick(300);
  engine.brake(400, 1000); engine.tick(400); engine.tick(900); engine.tick(1500);
  engine.signal("left", 1600); engine.tick(1600); engine.tick(1700);
  engine.signal("left", 1800); engine.tick(1800);
  assert.deepEqual(seen, ["over:true", "brake:true", "brake:false", "signal:left", "signal:null"]);
});

test("the demo drive feeds telemetry but never the trip computer", () => {
  const { engine } = setup({ hud: "full" });
  engine.startDemo(0);
  const kinds = new Set();
  for (let t = 0; t < 52000; t += 100) kinds.add(engine.tick(t).kind);
  for (const k of ["speed", "turn", "brake"]) assert.ok(kinds.has(k), k);
  assert.equal(engine.trip.distanceM, 0);
  engine.stopDemo();
  assert.equal(engine.telemetry(60000).source, "gps");
});

test("real GPS speed feeds the trip computer", () => {
  const { engine, setWall } = setup({ hud: "full" });
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i <= 60; i++) {
    const now = i * 1000;
    setWall(t0 + now);
    engine.drive.fix({ latitude: 13, longitude: 80 + i * 0.0002, speed: 20, heading: 90, accuracy: 5, timestamp: t0 + now }, now);
    engine.tick(now);
  }
  assert.ok(Math.abs(engine.trip.distanceM - 1200) < 60, `${engine.trip.distanceM} m`);
  assert.ok(engine.trip.maxKmh >= 70);
});

test("night dim caps brightness between 19:00 and 06:00 only", () => {
  const s = { brightness: 85, nightDim: true, nightLevel: 30 };
  assert.equal(effectiveBrightness(s, new Date(2026, 0, 1, 12)), 85);
  assert.equal(effectiveBrightness(s, new Date(2026, 0, 1, 22)), 30);
  assert.equal(effectiveBrightness(s, new Date(2026, 0, 1, 5)), 30);
  assert.equal(effectiveBrightness({ ...s, brightness: 20 }, new Date(2026, 0, 1, 22)), 20);
  assert.equal(effectiveBrightness({ ...s, nightDim: false }, new Date(2026, 0, 1, 22)), 85);
});
