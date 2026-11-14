// Decides which scene owns the panel. Pure and time-injected.
//
// Priority, highest first:
//   brake  >  hazard  >  turn signal  >  held message  >  speed HUD  >  idle content
//
// HUD modes:
//   off      the drive never takes the panel (the manual brake and signal buttons still do)
//   signals  brake light and turn arrows interrupt; otherwise your content stays up
//   full     as "signals", plus the speed readout while moving
//
// v3 had one Auto-HUD switch, and its auto-rotate re-armed the message hold on every
// step, so with a rotation running the speed readout never came back. Here a show is
// idle content: it never holds the panel against the HUD.
import { kmhToMph } from "./telemetry.js";
import { LED } from "./graphics.js";

export const HOLD_OPTIONS = { "5s": 5000, "10s": 10000, "20s": 20000, "30s": 30000, sticky: Infinity };

export const DEFAULT_SCENE = { kind: "eyes", mode: "living_calm", color: "#a3e635", react: true };

export function direct({
  now,
  hud = "signals",
  kmh = 0,
  hasSpeed = false,
  sensorTurn = "straight",
  autoTurn = true,
  sensorBrake = false,
  autoBrake = true,
  manualBrakeUntil = 0,
  signal = null, // "left" | "right" | "hazard" | null (from the SignalStalk)
  user = null, // { scene, at }
  holdMs = HOLD_OPTIONS["10s"],
  show = null, // scene from a playing show
  base = DEFAULT_SCENE,
  unit = "kmh",
  limitKmh = 0,
  stoppedMode = "content", // content | stopped | clock
}) {
  const driving = hud !== "off";
  const braking = now < manualBrakeUntil || (driving && autoBrake && sensorBrake);
  if (braking) return { kind: "brake", color: LED.red, source: "brake" };
  if (signal === "hazard") return { kind: "hazard", color: LED.amber, source: "signal" };
  if (signal === "left" || signal === "right") return { kind: "turn", dir: signal, color: LED.amber, source: "signal" };

  const turning = sensorTurn === "left" || sensorTurn === "right";
  if (driving && autoTurn && turning) return { kind: "turn", dir: sensorTurn, color: LED.amber, source: "sensor" };

  // Eyes that react to the drive look into the turn when the arrows are not shown.
  const react = (scene) => (scene.kind === "eyes" && scene.react
    ? { ...scene, gaze: turning ? (sensorTurn === "left" ? -1 : 1) : null, alert: sensorBrake }
    : scene);

  if (user && now - user.at < holdMs) return { ...react(user.scene), source: "user" };

  const idle = show ? { ...react(show), source: "show" } : { ...react(user?.scene ?? base), source: user ? "user" : "base" };
  if (hud !== "full" || !hasSpeed) return idle;

  if (kmh >= 1) {
    const over = limitKmh > 0 && kmh > limitKmh;
    const mph = unit === "mph";
    const top = limitKmh > 0 ? limitKmh : 120;
    return {
      kind: "speed",
      value: mph ? kmhToMph(kmh) : kmh,
      unit: mph ? "MPH" : "KM/H",
      frac: Math.min(1, kmh / top),
      over,
      color: over ? LED.red : LED.white,
      source: "speed",
    };
  }
  if (stoppedMode === "clock") return { kind: "clock", color: LED.amber, source: "clock" };
  if (stoppedMode === "stopped") return { kind: "stopped", color: LED.red, source: "stopped" };
  return idle;
}

/**
 * Manual indicator stalk. A turn signal cancels itself, like a car's:
 *  - once the sensors saw a turn in that direction and the car is straight again,
 *  - or after `timeoutMs` with no turn,
 *  - or when pressed again. Hazard only cancels by hand.
 */
export class SignalStalk {
  constructor({ timeoutMs = 30000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.active = null;
    this.since = 0;
    this.sawTurn = false;
  }

  press(which, now) {
    if (this.active === which) this.active = null;
    else {
      this.active = which;
      this.since = now;
      this.sawTurn = false;
    }
    return this.active;
  }

  cancel() {
    this.active = null;
  }

  /** Call every tick. Returns the active signal after auto-cancel rules. */
  update(sensorTurn, now) {
    if (this.active === "left" || this.active === "right") {
      if (sensorTurn === this.active) this.sawTurn = true;
      else if (this.sawTurn && sensorTurn === "straight") this.active = null;
      if (this.active && now - this.since >= this.timeoutMs) this.active = null;
    }
    return this.active;
  }
}

/** Plays a show (a list of { ref, secs }) on a loop. `resolve(ref)` turns a ref into a scene. */
export class ShowPlayer {
  constructor() {
    this.show = null;
    this.startedAt = 0;
  }

  play(show, now) {
    this.show = show?.items?.length ? show : null;
    this.startedAt = now;
    return !!this.show;
  }

  stop() {
    this.show = null;
  }

  get playing() {
    return !!this.show;
  }

  /** { index, item, remainingMs, totalMs } for `now`, or null. */
  position(now) {
    if (!this.show) return null;
    const durs = this.show.items.map((it) => Math.round(Math.max(1, Number(it.secs) || 8) * 1000));
    const total = durs.reduce((a, b) => a + b, 0);
    let p = (now - this.startedAt) % total;
    if (p < 0) p += total;
    for (let i = 0; i < durs.length; i++) {
      if (p < durs[i]) return { index: i, item: this.show.items[i], remainingMs: durs[i] - p, totalMs: total };
      p -= durs[i];
    }
    return null;
  }

  /** Jump so that item `index` starts now. */
  seek(index, now) {
    if (!this.show) return;
    const durs = this.show.items.map((it) => Math.round(Math.max(1, Number(it.secs) || 8) * 1000));
    const i = ((index % durs.length) + durs.length) % durs.length;
    this.startedAt = now - durs.slice(0, i).reduce((a, b) => a + b, 0);
  }
}

/**
 * A scripted drive for the demo: pull away, turn, cruise, brake to a stop.
 * Returns { kmh, turn, brake } for time t (loops).
 */
export const DEMO_LOOP_MS = 52000;
export function demoDrive(tMs) {
  const t = ((tMs % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS / 1000;
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  let kmh = 0, turn = "straight", brake = false;
  if (t < 4) kmh = 0;
  else if (t < 12) kmh = lerp(0, 46, (t - 4) / 8);
  else if (t < 17) { kmh = lerp(46, 28, (t - 12) / 2); turn = t > 12.6 && t < 16.2 ? "right" : "straight"; }
  else if (t < 27) kmh = lerp(28, 78, (t - 17) / 8);
  else if (t < 33) kmh = lerp(78, 96, (t - 27) / 6);
  else if (t < 37) { kmh = lerp(96, 40, (t - 33) / 3.2); brake = t < 36.4; }
  else if (t < 43) { kmh = lerp(40, 32, (t - 37) / 2); turn = t > 37.8 && t < 41.6 ? "left" : "straight"; }
  else if (t < 48) { kmh = lerp(32, 0, (t - 43) / 4.2); brake = t > 44.5 && t < 47.6; }
  else kmh = 0;
  return { kmh: Math.round(kmh), turn, brake };
}
