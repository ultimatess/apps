import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_LOOP_MS, HOLD_OPTIONS, ShowPlayer, SignalStalk, demoDrive, direct } from "../../js/director.js";

const msg = { kind: "text", text: "THANKS" };
const eyes = { kind: "eyes", mode: "living_calm", color: "#fff", react: true };
const base = (o = {}) => ({ now: 100000, hud: "full", kmh: 0, hasSpeed: false, ...o });

test("priority: brake > hazard > signal > sensor turn > held message > speed", () => {
  const all = base({ kmh: 60, hasSpeed: true, sensorBrake: true, signal: "hazard", sensorTurn: "left", user: { scene: msg, at: 99999 } });
  assert.equal(direct(all).kind, "brake");
  assert.equal(direct({ ...all, sensorBrake: false }).kind, "hazard");
  assert.deepEqual([direct({ ...all, sensorBrake: false, signal: "right" }).kind, direct({ ...all, sensorBrake: false, signal: "right" }).dir], ["turn", "right"]);
  const sensor = direct({ ...all, sensorBrake: false, signal: null });
  assert.deepEqual([sensor.kind, sensor.dir, sensor.source], ["turn", "left", "sensor"]);
  assert.equal(direct({ ...all, sensorBrake: false, signal: null, sensorTurn: "straight" }).kind, "text");
  assert.equal(direct({ ...all, sensorBrake: false, signal: null, sensorTurn: "straight", user: { scene: msg, at: 0 } }).kind, "speed");
});

test("the manual brake and signal buttons work in every HUD mode", () => {
  for (const hud of ["off", "signals", "full"]) {
    assert.equal(direct(base({ hud, manualBrakeUntil: 100001 })).kind, "brake");
    assert.equal(direct(base({ hud, signal: "left" })).kind, "turn");
    assert.equal(direct(base({ hud, signal: "hazard" })).kind, "hazard");
  }
});

test("HUD off: sensors never take the panel", () => {
  const s = direct(base({ hud: "off", kmh: 80, hasSpeed: true, sensorBrake: true, sensorTurn: "right", user: { scene: msg, at: 0 } }));
  assert.equal(s.kind, "text");
});

test("HUD signals: brake and turns interrupt, speed never does", () => {
  const o = base({ hud: "signals", kmh: 80, hasSpeed: true, user: { scene: msg, at: 0 } });
  assert.equal(direct(o).kind, "text");
  assert.equal(direct({ ...o, sensorBrake: true }).kind, "brake");
  assert.equal(direct({ ...o, sensorTurn: "left" }).kind, "turn");
  assert.equal(direct({ ...o, sensorBrake: true, autoBrake: false }).kind, "text");
  assert.equal(direct({ ...o, sensorTurn: "left", autoTurn: false }).kind, "text");
});

test("HUD full: speed while moving, the message hold wins first, then speed returns (v2/v3 regression)", () => {
  const o = base({ kmh: 62, hasSpeed: true, holdMs: 10000 });
  assert.equal(direct({ ...o, user: { scene: msg, at: 95000 } }).kind, "text");
  const s = direct({ ...o, user: { scene: msg, at: 89999 } });
  assert.equal(s.kind, "speed");
  assert.equal(Math.round(s.value), 62);
  assert.equal(direct({ ...o, user: { scene: msg, at: 0 }, holdMs: HOLD_OPTIONS.sticky }).kind, "text", "pinned");
  assert.equal(direct({ ...o, hasSpeed: false, user: { scene: msg, at: 0 } }).kind, "text", "no GPS: content");
});

test("speed scene: units, gauge fraction and over-limit", () => {
  const kmh = direct(base({ kmh: 60, hasSpeed: true }));
  assert.deepEqual([kmh.unit, kmh.over, kmh.frac], ["KM/H", false, 0.5]);
  const mph = direct(base({ kmh: 100, hasSpeed: true, unit: "mph", limitKmh: 80 }));
  assert.equal(mph.unit, "MPH");
  assert.equal(Math.round(mph.value), 62);
  assert.equal(mph.over, true);
  assert.equal(mph.frac, 1);
  assert.equal(direct(base({ kmh: 40, hasSpeed: true, limitKmh: 80 })).frac, 0.5);
});

test("stopped: content by default, or STOPPED / clock", () => {
  const o = base({ kmh: 0, hasSpeed: true, user: { scene: msg, at: 0 } });
  assert.equal(direct(o).kind, "text");
  assert.equal(direct({ ...o, stoppedMode: "stopped" }).kind, "stopped");
  assert.equal(direct({ ...o, stoppedMode: "clock" }).kind, "clock");
});

test("a show is idle content: it yields to speed, and a tapped message interrupts it for the hold", () => {
  const show = { kind: "fx", id: "wave" };
  assert.equal(direct(base({ show })).source, "show");
  assert.equal(direct(base({ show, kmh: 50, hasSpeed: true })).kind, "speed");
  assert.equal(direct(base({ show, hud: "signals", kmh: 50, hasSpeed: true })).kind, "fx");
  assert.equal(direct(base({ show, user: { scene: msg, at: 99000 } })).kind, "text");
  assert.equal(direct(base({ show, user: { scene: msg, at: 0 } })).kind, "fx");
});

test("with nothing chosen the base scene shows", () => {
  const s = direct(base());
  assert.deepEqual([s.kind, s.source], ["eyes", "base"]);
});

test("reactive eyes look into a turn and go wide under braking when the HUD is not showing them", () => {
  const o = base({ hud: "off", user: { scene: eyes, at: 99999 } });
  assert.equal(direct({ ...o, sensorTurn: "left" }).gaze, -1);
  assert.equal(direct({ ...o, sensorTurn: "right" }).gaze, 1);
  assert.equal(direct(o).gaze, null);
  assert.equal(direct({ ...o, sensorBrake: true }).alert, true);
  const fixed = direct({ ...o, sensorTurn: "left", user: { scene: { ...eyes, react: false }, at: 99999 } });
  assert.equal(fixed.gaze, undefined);
});

test("signal stalk: toggles, switches side, cancels after the turn completes", () => {
  const s = new SignalStalk({ timeoutMs: 30000 });
  assert.equal(s.press("left", 0), "left");
  assert.equal(s.press("left", 10), null, "second press cancels");
  s.press("left", 100);
  assert.equal(s.press("right", 200), "right", "other side switches");
  assert.equal(s.update("straight", 1000), "right", "waiting for the turn");
  assert.equal(s.update("left", 2000), "right", "a wiggle the other way does not cancel");
  assert.equal(s.update("right", 3000), "right", "turning");
  assert.equal(s.update("straight", 6000), null, "straight again: cancelled");
});

test("signal stalk: times out without a turn; hazard only cancels by hand", () => {
  const s = new SignalStalk({ timeoutMs: 30000 });
  s.press("left", 0);
  assert.equal(s.update("straight", 29999), "left");
  assert.equal(s.update("straight", 30000), null);
  s.press("hazard", 40000);
  assert.equal(s.update("left", 50000), "hazard");
  assert.equal(s.update("straight", 400000), "hazard");
  assert.equal(s.press("hazard", 400001), null);
});

test("show player: walks the items by duration, loops, seeks", () => {
  const p = new ShowPlayer();
  assert.equal(p.position(0), null);
  assert.equal(p.play({ items: [] }, 0), false);
  p.play({ items: [{ ref: "a", secs: 5 }, { ref: "b", secs: 10 }, { ref: "c", secs: 2 }] }, 1000);
  assert.equal(p.position(1000).item.ref, "a");
  assert.equal(p.position(5999).item.ref, "a");
  assert.equal(p.position(6000).item.ref, "b");
  assert.equal(p.position(6000).remainingMs, 10000);
  assert.equal(p.position(16500).item.ref, "c");
  assert.equal(p.position(18000).item.ref, "a", "loops");
  p.seek(2, 50000);
  assert.equal(p.position(50000).item.ref, "c");
  assert.equal(p.position(52000).item.ref, "a");
  p.stop();
  assert.equal(p.playing, false);
});

test("demo drive: starts and ends stopped, turns, brakes and loops", () => {
  assert.equal(demoDrive(0).kmh, 0);
  assert.equal(demoDrive(DEMO_LOOP_MS - 500).kmh, 0);
  const seen = { left: 0, right: 0, brake: 0, max: 0 };
  for (let t = 0; t < DEMO_LOOP_MS; t += 100) {
    const d = demoDrive(t);
    if (d.turn !== "straight") seen[d.turn]++;
    if (d.brake) seen.brake++;
    seen.max = Math.max(seen.max, d.kmh);
    assert.ok(d.kmh >= 0 && d.kmh <= 100);
  }
  assert.ok(seen.left > 10 && seen.right > 10 && seen.brake > 10);
  assert.ok(seen.max > 90);
  assert.deepEqual(demoDrive(DEMO_LOOP_MS + 9000), demoDrive(9000));
});
