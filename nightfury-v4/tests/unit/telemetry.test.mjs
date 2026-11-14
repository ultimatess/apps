import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../../js/telemetry.js";

test("headingDelta wraps around north", () => {
  assert.equal(T.headingDelta(350, 10), 20);
  assert.equal(T.headingDelta(10, 350), -20);
  assert.equal(T.headingDelta(90, 270), -180);
  assert.equal(T.headingDelta(0, 0), 0);
});

test("haversine / bearing sanity", () => {
  const d = T.haversineMeters(13.0827, 80.2707, 13.0827, 80.2807); // ~1.08 km east in Chennai
  assert.ok(d > 1000 && d < 1150, `${d}`);
  assert.ok(Math.abs(T.bearingDeg(13, 80, 13, 80.01) - 90) < 1);
  assert.ok(Math.abs(T.bearingDeg(13, 80, 13.01, 80) - 0) < 1);
});

test("SpeedTracker uses GPS speed, smooths, and zeroes jitter at rest", () => {
  const s = new T.SpeedTracker({ smoothing: 1 });
  assert.equal(s.update({ latitude: 13, longitude: 80, speed: 20, accuracy: 5, timestamp: 0 }).kmh, 72);
  assert.equal(s.update({ latitude: 13, longitude: 80, speed: 0.3, accuracy: 5, timestamp: 1000 }).kmh, 0);
});

test("SpeedTracker derives speed from positions when coords.speed is null", () => {
  const s = new T.SpeedTracker({ smoothing: 1 });
  s.update({ latitude: 13, longitude: 80, speed: null, accuracy: 5, timestamp: 0 });
  // ~0.000253 deg lon at lat 13 ≈ 27.4 m in 1 s ≈ 98.7 km/h
  const r = s.update({ latitude: 13, longitude: 80.000253, speed: null, accuracy: 5, timestamp: 1000 });
  assert.ok(r.kmh > 90 && r.kmh < 105, `${r.kmh}`);
  assert.ok(Math.abs(r.heading - 90) < 2);
  assert.ok(!s.isStale(2000));
  assert.ok(s.isStale(8000));
});

test("SpeedTracker ignores low-accuracy fixes for derived speed", () => {
  const s = new T.SpeedTracker({ smoothing: 1 });
  s.update({ latitude: 13, longitude: 80, speed: null, accuracy: 5, timestamp: 0 });
  assert.equal(s.update({ latitude: 13.01, longitude: 80, speed: null, accuracy: 400, timestamp: 1000 }).kmh, 0);
});

function runTurn(det, samples) {
  const out = [];
  for (const [yaw, t, kmh] of samples) out.push(det.update(yaw, t, kmh));
  return out;
}

test("TurnDetector: needs sustained yaw to enter, hysteresis to exit", () => {
  const det = new T.TurnDetector();
  const s = [];
  let t = 0;
  for (let i = 0; i < 10; i++) s.push([0, (t += 50), 40]); // straight
  for (let i = 0; i < 3; i++) s.push([30, (t += 50), 40]); // brief blip (150ms) - should not trigger yet
  const early = runTurn(det, s);
  assert.equal(early.at(-1), "straight");
  const more = [];
  for (let i = 0; i < 10; i++) more.push([30, (t += 50), 40]); // sustained left
  assert.equal(runTurn(det, more).at(-1), "left");
  const mid = [];
  for (let i = 0; i < 20; i++) mid.push([8, (t += 50), 40]); // easing (between exit and enter)
  assert.equal(runTurn(det, mid).at(-1), "left", "stays in turn inside hysteresis band");
  const done = [];
  for (let i = 0; i < 20; i++) done.push([0, (t += 50), 40]);
  assert.equal(runTurn(det, done).at(-1), "straight");
});

test("TurnDetector: right turns, direct left->right switch, suppressed when stopped", () => {
  const det = new T.TurnDetector();
  let t = 0;
  const seq = (yaw, n, kmh = 30) => runTurn(det, Array.from({ length: n }, () => [yaw, (t += 50), kmh])).at(-1);
  assert.equal(seq(-25, 12), "right");
  assert.equal(seq(25, 14), "left");
  assert.equal(seq(25, 5, 0), "straight", "parked phone rotation ignored");
  assert.equal(seq(25, 12, null), "left", "unknown speed still allows turns");
});

test("MotionProcessor: yaw is mount-independent", () => {
  // Phone flat (up = +z) turning left at 20 deg/s about z.
  const flat = new T.MotionProcessor();
  let r;
  for (let i = 0; i < 20; i++) r = flat.process({ acc: [0, 0, 0], accG: [0, 0, 9.81], rot: { alpha: 20, beta: 0, gamma: 0 } });
  assert.ok(Math.abs(r.yawLeft - 20) < 0.5);
  // Phone upright in a mount (up = +y): the same car rotation appears on the y axis (gamma).
  const upright = new T.MotionProcessor();
  for (let i = 0; i < 20; i++) r = upright.process({ acc: [0, 0, 0], accG: [0, 9.81, 0], rot: { alpha: 0, beta: 0, gamma: 20 } });
  assert.ok(Math.abs(r.yawLeft - 20) < 0.5);
  // Tilted 45deg.
  const tilted = new T.MotionProcessor();
  const k = Math.SQRT1_2;
  for (let i = 0; i < 20; i++) r = tilted.process({ acc: [0, 0, 0], accG: [0, 9.81 * k, 9.81 * k], rot: { alpha: 20 * k, beta: 0, gamma: 20 * k } });
  assert.ok(Math.abs(r.yawLeft - 20) < 0.5);
});

test("MotionProcessor: horizontal accel excludes vertical bumps", () => {
  const m = new T.MotionProcessor();
  let r;
  for (let i = 0; i < 30; i++) r = m.process({ acc: [0, 0, 6], accG: [0, 0, 15.81], rot: null }); // pure vertical bump
  assert.ok(r.horiz < 0.2, `${r.horiz}`);
  for (let i = 0; i < 30; i++) r = m.process({ acc: [4, 0, 0], accG: [4, 0, 9.81], rot: null }); // braking along x
  assert.ok(Math.abs(r.horiz - 4) < 0.2, `${r.horiz}`);
  assert.equal(m.process({ acc: null, accG: null, rot: null }).ready, false);
});

test("MotionProcessor works without linear acceleration (low-pass gravity)", () => {
  const m = new T.MotionProcessor();
  let r;
  for (let i = 0; i < 200; i++) r = m.process({ acc: null, accG: [0, 0, 9.81], rot: { alpha: 10, beta: 0, gamma: 0 } });
  assert.ok(Math.abs(r.yawLeft - 10) < 0.5);
  assert.ok(r.horiz < 0.1);
});

test("YawCalibrator flips sign only after consistent disagreement", () => {
  const c = new T.YawCalibrator({ minSamples: 6 });
  for (let i = 0; i < 4; i++) c.observe(15, -15);
  assert.equal(c.sign, 1, "not enough samples");
  for (let i = 0; i < 4; i++) c.observe(15, -15);
  assert.equal(c.sign, -1);
  const ok = new T.YawCalibrator();
  for (let i = 0; i < 10; i++) ok.observe(15, 12);
  ok.observe(3, -40); // ignored: gyro below noise floor
  assert.equal(ok.sign, 1);
});

test("BrakeDetector: sustained hard decel triggers and holds", () => {
  const b = new T.BrakeDetector({ sensitivity: "medium", holdMs: 2500 });
  b.updateSpeed(60, 0);
  assert.equal(b.updateMotion(0.5 * T.G, 0, 1000), false, "needs to be sustained");
  assert.equal(b.updateMotion(0.5 * T.G, 0, 1150), false);
  assert.equal(b.updateMotion(0.5 * T.G, 0, 1250), true);
  assert.equal(b.isBraking(3000), true, "held");
  assert.equal(b.isBraking(3800), false, "released");
});

test("BrakeDetector: ignores spikes, cornering, crawling and acceleration", () => {
  const spike = new T.BrakeDetector();
  spike.updateSpeed(60, 0);
  spike.updateMotion(1.2 * T.G, 0, 1000);
  assert.equal(spike.updateMotion(0, 0, 1050), false, "pothole spike");
  assert.equal(spike.updateMotion(0.2 * T.G, 0, 1300), false);

  const corner = new T.BrakeDetector();
  corner.updateSpeed(50, 0);
  for (let t = 1000; t < 1600; t += 50) corner.updateMotion(0.5 * T.G, 35, t);
  assert.equal(corner.isBraking(1600), false, "lateral g while turning");

  const slow = new T.BrakeDetector();
  slow.updateSpeed(5, 0);
  for (let t = 1000; t < 1600; t += 50) slow.updateMotion(0.6 * T.G, 0, t);
  assert.equal(slow.isBraking(1600), false, "parking manoeuvre");

  const accel = new T.BrakeDetector();
  accel.updateSpeed(30, 0);
  accel.updateSpeed(45, 1000); // speeding up 4 m/s^2
  for (let t = 1000; t < 1600; t += 50) accel.updateMotion(0.45 * T.G, 0, t);
  assert.equal(accel.isBraking(1600), false, "hard launch is not braking");
});

test("BrakeDetector: GPS speed drop alone triggers", () => {
  const b = new T.BrakeDetector({ sensitivity: "medium" });
  b.updateSpeed(80, 0);
  assert.equal(b.updateSpeed(62, 1000), true); // 5 m/s^2
  const gentle = new T.BrakeDetector({ sensitivity: "medium" });
  gentle.updateSpeed(80, 0);
  assert.equal(gentle.updateSpeed(75, 1000), false); // 1.4 m/s^2
});

test("BrakeDetector sensitivity levels order correctly", () => {
  const s = T.BRAKE_SENSITIVITY;
  assert.ok(s.high.accelG < s.medium.accelG && s.medium.accelG < s.low.accelG);
  const b = new T.BrakeDetector({ sensitivity: "high" });
  b.updateSpeed(50, 0);
  for (let t = 1000; t < 1400; t += 50) b.updateMotion(0.33 * T.G, 0, t);
  assert.equal(b.isBraking(1400), true);
});

test("classifyDrive buckets", () => {
  assert.equal(T.classifyDrive(0).id, "stopped");
  assert.equal(T.classifyDrive(20).id, "slow");
  assert.equal(T.classifyDrive(60).id, "cruise");
  assert.equal(T.classifyDrive(110).id, "highway");
  assert.ok(Math.abs(T.kmhToMph(100) - 62.1371) < 1e-3);
});
