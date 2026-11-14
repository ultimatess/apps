// The engine: one tick() turns telemetry + user actions into the current scene and
// keeps the panel in step with it. No DOM in here; time, panel, settings and the
// library are injected, so the whole loop is unit-tested with a fake clock.
//
// v3 ran this logic inside requestAnimationFrame, which stops when the screen locks
// or the tab is hidden - the panel then froze on a stale speed. tick() is driven by
// a timer instead (see ticker.js); only the on-screen preview uses animation frames.
import { direct, HOLD_OPTIONS, ShowPlayer, SignalStalk, demoDrive, DEFAULT_SCENE } from "./director.js";
import { sceneKey, sceneTint } from "./scene.js";
import { quantize } from "./frame.js";
import { TripMeter } from "./trip.js";

export class Engine {
  constructor({ panel, scenes, drive, settings, resolve = () => null, fontsReady = async () => {}, epoch = () => 0, wall = () => Date.now(), trip = null } = {}) {
    this.panel = panel;
    this.scenes = scenes;
    this.drive = drive;
    this.settings = settings; // () => settings object
    this.resolve = resolve; // show item ref -> scene
    this.fontsReady = fontsReady;
    this.epoch = epoch;
    this.wall = wall;
    this.trip = trip ?? new TripMeter();

    this.user = null; // { scene, at }
    this.nonce = 0;
    this.manualBrakeUntil = 0;
    this.stalk = new SignalStalk({ timeoutMs: 30000 });
    this.player = new ShowPlayer();
    this.sim = null; // { kmh, turn, brake } overrides the sensors (Lab)
    this.demoAt = null; // start time of the scripted demo drive
    this.draft = null; // { scene, at }: shown in the preview only, never sent
    this.scene = { ...DEFAULT_SCENE, source: "base" };
    this.key = "";
    this.sceneStart = 0;
    this.tele = { kmh: 0, hasSpeed: false, turn: "straight", brake: false, yaw: null, horizG: null, accuracy: null, source: "gps" };
    this.hw = { id: null, at: -Infinity, kind: null, key: null };
    this.fontOk = new Set();
    this.fontPending = new Set();
    this.flags = { over: false, braking: false, signal: null };
    this.listeners = new Map();
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  emit(type, detail) {
    for (const fn of this.listeners.get(type) ?? []) {
      try { fn(detail); } catch (e) { console.error(e); }
    }
  }

  // ------------------------------------------------------------------ actions

  /** Put a scene on the panel as a user message (held, then the HUD or show returns). */
  show(scene, now) {
    this.user = { scene: { ...scene, nonce: ++this.nonce }, at: now };
    this.draft = null;
    return this.user.scene;
  }

  clearUser() {
    this.user = null;
  }

  brake(now, ms = 3000) {
    this.manualBrakeUntil = now + ms;
  }

  /** Toggle "left" | "right" | "hazard". Returns the active signal. */
  signal(which, now) {
    this.stalk.timeoutMs = Math.max(5, this.settings().signalTimeout ?? 30) * 1000;
    return this.stalk.press(which, now);
  }

  playShow(show, now) {
    const ok = this.player.play(show, now);
    if (ok) this.user = null; // otherwise a pinned message would hide the show
    this.emit("show", this.player.show);
    return ok;
  }

  stopShow() {
    this.player.stop();
    this.emit("show", null);
  }

  setDraft(scene, now) {
    this.draft = scene ? { scene, at: now, key: sceneKey(scene) } : null;
  }

  startDemo(now) {
    this.demoAt = now;
    this.sim = null;
  }

  stopDemo() {
    this.demoAt = null;
  }

  // ------------------------------------------------------------------ tick

  telemetry(now) {
    if (this.sim) return { kmh: this.sim.kmh, hasSpeed: true, turn: this.sim.turn ?? "straight", brake: !!this.sim.brake, yaw: null, horizG: null, accuracy: null, source: "sim" };
    if (this.demoAt !== null) {
      const d = demoDrive(now - this.demoAt);
      return { kmh: d.kmh, hasSpeed: true, turn: d.turn, brake: d.brake, yaw: null, horizG: null, accuracy: null, source: "demo" };
    }
    return { ...this.drive.read(now), source: "gps" };
  }

  tick(now) {
    const S = this.settings();
    const t = this.telemetry(now);
    this.tele = t;
    const signal = this.stalk.update(t.turn, now);
    const pos = this.player.position(now);
    const show = pos ? pos.item.scene ?? this.resolve(pos.item.ref) : null; // modes carry their scenes inline

    const scene = direct({
      now,
      hud: S.hud,
      kmh: t.kmh,
      hasSpeed: t.hasSpeed,
      sensorTurn: t.turn,
      autoTurn: S.autoTurn,
      sensorBrake: t.brake,
      autoBrake: S.autoBrake,
      manualBrakeUntil: this.manualBrakeUntil,
      signal,
      user: this.user,
      holdMs: HOLD_OPTIONS[S.holdKey] ?? HOLD_OPTIONS["10s"],
      show,
      unit: S.unit,
      limitKmh: S.limitKmh,
      stoppedMode: S.stoppedMode,
    });

    const key = sceneKey(scene);
    const changed = key !== this.key;
    if (changed) {
      this.key = key;
      this.sceneStart = now;
    }
    this.scene = scene;
    if (changed) this.emit("scene", scene);

    // Edge events for sounds / haptics.
    const over = S.limitKmh > 0 && t.hasSpeed && t.kmh > S.limitKmh;
    if (over !== this.flags.over) { this.flags.over = over; this.emit("over", over); }
    const braking = scene.kind === "brake";
    if (braking !== this.flags.braking) { this.flags.braking = braking; this.emit("brake", braking); }
    if (signal !== this.flags.signal) { this.flags.signal = signal; this.emit("signal", signal); }

    if (t.source === "gps" && t.hasSpeed) this.trip.update({ kmh: t.kmh, braking: t.brake }, this.wall());

    this.sync(now);
    return scene;
  }

  // ------------------------------------------------------------------ hardware

  resync() {
    this.hw = { id: null, at: -Infinity, kind: null, key: null };
  }

  /** True once the web font needed by a text scene is loaded (kicks the load off on first sight). */
  textReady(scene) {
    if (scene.kind !== "text") return true;
    const text = scene.text;
    if (this.fontOk.has(text)) return true;
    if (!this.fontPending.has(text)) {
      this.fontPending.add(text);
      Promise.resolve(this.fontsReady(text)).catch(() => {}).then(() => {
        this.fontPending.delete(text);
        if (this.fontOk.size > 300) this.fontOk.clear();
        this.fontOk.add(text);
      });
    }
    return false;
  }

  sync(now) {
    const panel = this.panel;
    if (!panel?.ready) {
      if (this.hw.id !== null) this.resync();
      return;
    }
    const scene = this.scene;
    if (!this.textReady(scene)) return;
    const S = this.settings();
    const opts = `${S.lsbFirst ? "l" : "m"}${S.multiColor ? "c" : "1"}`;
    const plan = this.scenes.plan(scene);
    const tint = sceneTint(scene);
    const done = (id) => (res) => { if (res?.error && this.hw.id === id) this.hw.id = null; };

    if (plan.mode === "scroll") {
      const id = `scroll|${this.key}|${this.epoch()}|${opts}`;
      if (id === this.hw.id) return;
      this.hw = { id, at: now, kind: scene.kind, key: this.key };
      panel.pushScroll(plan.raster, plan.speed, { fallback: tint, anim: plan.anim }).then(done(id));
      this.emit("push", { scene, mode: "scroll" });
      return;
    }

    const elapsed = now - this.sceneStart;
    const t = plan.animated ? Math.floor(elapsed / plan.stepMs) * plan.stepMs : 0;
    const frame = quantize(this.scenes.render(scene, t, { poster: !plan.animated, date: new Date(this.wall()) }), { multi: S.multiColor });
    const id = `${frame.key()}|${opts}`;
    const sameScene = this.hw.key === this.key;
    // A new scene is always sent, even if it looks the same (re-tapping a message re-sends it).
    if (id === this.hw.id && sameScene) return;
    // Rate limits apply inside one scene (speed digits, animation); a scene change goes out at once.
    if (sameScene && now - this.hw.at < plan.minGapMs) return;
    if (sameScene && plan.animated && panel.queue.busy) return;
    this.hw = { id, at: now, kind: scene.kind, key: this.key };
    panel.pushFrame(frame, { fallback: tint, label: `Frame · ${scene.kind}`, quiet: sameScene && plan.animated }).then(done(id));
    this.emit("push", { scene, mode: "frame" });
  }

  // ------------------------------------------------------------------ preview

  /** The frame to draw on screen right now (draft wins; quantized like the panel). */
  previewFrame(now) {
    const S = this.settings();
    const d = this.draft;
    const scene = d ? d.scene : this.scene;
    const start = d ? d.at : this.sceneStart;
    return quantize(this.scenes.render(scene, now - start, { date: new Date(this.wall()) }), { multi: S.multiColor });
  }

  /** 0..1 of the message hold that is left, or null when nothing is waiting to take over. */
  holdLeft(now) {
    const hold = HOLD_OPTIONS[this.settings().holdKey] ?? HOLD_OPTIONS["10s"];
    if (!this.user || !Number.isFinite(hold) || this.scene.source !== "user") return null;
    const left = 1 - (now - this.user.at) / hold;
    if (left <= 0) return null;
    const waiting = this.player.playing || (this.settings().hud === "full" && this.tele.hasSpeed);
    return waiting ? left : null;
  }

  get status() {
    if (this.draft) return "draft";
    if (!this.panel?.ready) return "preview";
    return this.panel.queue.busy ? "sending" : "live";
  }
}

/** Brightness to send right now: the slider value, capped at night when night dim is on. */
export function effectiveBrightness(settings, date = new Date()) {
  const base = Math.max(1, Math.min(100, settings.brightness ?? 85));
  if (!settings.nightDim) return base;
  const h = date.getHours();
  const night = h >= 19 || h < 6;
  return night ? Math.min(base, Math.max(1, settings.nightLevel ?? 35)) : base;
}
