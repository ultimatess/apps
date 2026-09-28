// NightFury v3 — UI wiring. Logic lives in the pure modules; this file connects
// them to the DOM, sensors and the Bluetooth panel.
import { BUILD } from "./version.js";
import { COLS, describeNotification, parseHex, toHex, hexToRgb } from "./protocol.js";
import { Bitmap } from "./bitmap.js";
import { BleTransport } from "./ble.js";
import { IPixelPanel, PROTOCOLS } from "./device.js";
import { createRasterizer } from "./textraster.js";
import { createPreview } from "./preview.js";
import { COLORS, describeScene, hardwarePlan, isAnimatedStill, renderPreview, sceneKey } from "./scene.js";
import { arbitrate, HOLD_OPTIONS } from "./hud.js";
import { BrakeDetector, MotionProcessor, SpeedTracker, TurnDetector, YawCalibrator, classifyDrive, headingDelta, kmhToMph, G } from "./telemetry.js";
import { createSensors } from "./sensors.js";
import { createStore } from "./store.js";
import { BOARDS, EYES, PALETTE, QUICK } from "./presets.js";
import { devilEyes, turnArrows, speedHud, brakeFrame } from "./graphics.js";

const $ = (id) => document.getElementById(id);
const store = createStore();
const S = store.settings;

// ------------------------------------------------------------------ logging

const LOG_MAX = 400;
const logLines = [];
function log(msg, level = "info") {
  const t = new Date().toTimeString().slice(0, 8);
  logLines.push(`[${t}] ${msg}`);
  if (logLines.length > LOG_MAX) logLines.shift();
  const el = $("console");
  if (el) {
    const row = document.createElement("div");
    row.className = `log-${level}`;
    const ts = document.createElement("span");
    ts.className = "t";
    ts.textContent = `${t} `;
    row.append(ts, msg);
    el.append(row);
    while (el.childElementCount > LOG_MAX) el.firstElementChild.remove();
    el.scrollTop = el.scrollHeight;
  }
  if (level === "error") console.warn(`[nightfury] ${msg}`);
}

// ------------------------------------------------------------------ feedback

let audioCtx = null;
function audio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function sound(type = "tick") {
  if (!S.sound) return;
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(ctx.destination);
  const t = ctx.currentTime;
  const [wave, f0, f1, vol, dur] = type === "brake" ? ["sawtooth", 360, 110, 0.22, 0.3] : type === "ok" ? ["sine", 660, 990, 0.1, 0.09] : ["sine", 1200, 500, 0.1, 0.03];
  osc.type = wave;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.start(t);
  osc.stop(t + dur);
}

function haptic(pattern = 20) {
  if (S.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

const tap = () => { sound("tick"); haptic(15); };

// ------------------------------------------------------------------ core objects

const rasterizer = createRasterizer({ pixelFont: () => S.pixelFont });
const rasterize = rasterizer.rasterize;
const transport = new BleTransport({ bluetooth: navigator.bluetooth, log });
const panel = new IPixelPanel({ transport, log, options: () => ({ lsbFirst: S.lsbFirst, protocol: S.protocol }) });
const preview = createPreview($("matrix"));

const speedTracker = new SpeedTracker();
const motion = new MotionProcessor();
const calibrator = new YawCalibrator();
const turnDetector = new TurnDetector();
const brakeDetector = new BrakeDetector({ sensitivity: S.brakeSensitivity });

const state = {
  user: null, // { scene, at }
  nonce: 0,
  gpsKmh: 0,
  gpsAt: -Infinity,
  heading: null,
  headingAt: 0,
  lastMotionAt: -Infinity,
  yaw: 0,
  horizG: 0,
  sensorTurn: "straight",
  manualBrakeUntil: 0,
  sim: false,
  simKmh: 0,
  simTurn: "straight",
  scene: null,
  sceneKey: "",
  sceneStart: 0,
  hwKey: null,
  hwAt: 0,
  hwTimer: null,
  animAt: 0,
  animTick: 0,
  activeTab: "drive",
  board: "road",
};

// ------------------------------------------------------------------ telemetry

const sensors = createSensors({
  log,
  onStatus: renderSensorStatus,
  onFix(fix) {
    const now = performance.now();
    const { kmh, heading } = speedTracker.update(fix);
    state.gpsKmh = kmh;
    state.gpsAt = now;
    brakeDetector.updateSpeed(kmh, now);
    if (heading !== null) {
      if (state.heading !== null && now > state.headingAt) {
        const dt = (now - state.headingAt) / 1000;
        const gpsYawLeft = -headingDelta(state.heading, heading) / dt; // heading is clockwise
        calibrator.observe(state.yaw, gpsYawLeft);
        // Without a gyroscope, GPS heading rate drives turn detection.
        if (now - state.lastMotionAt > 1500) state.sensorTurn = turnDetector.update(gpsYawLeft * (S.invertTurns ? -1 : 1), now, kmh);
      }
      state.heading = heading;
      state.headingAt = now;
    }
  },
  onMotion(m) {
    const now = performance.now();
    const out = motion.process(m);
    if (!out.ready) return;
    state.lastMotionAt = now;
    const yaw = out.yawLeft * calibrator.sign * (S.invertTurns ? -1 : 1);
    state.yaw = yaw;
    state.horizG = out.horiz / G;
    const kmh = hasGpsSpeed(now) ? state.gpsKmh : null;
    state.sensorTurn = turnDetector.update(yaw, now, kmh);
    if (S.brakeLight) brakeDetector.updateMotion(out.horiz, Math.abs(yaw), now);
  },
});

const hasGpsSpeed = (now) => now - state.gpsAt < 6000;

function telemetry(now) {
  if (state.sim) return { kmh: state.simKmh, hasSpeed: true, turn: state.simTurn, sensorBrake: false };
  return {
    kmh: state.gpsKmh,
    hasSpeed: hasGpsSpeed(now),
    turn: state.sensorTurn,
    sensorBrake: S.brakeLight && brakeDetector.isBraking(now),
  };
}

// ------------------------------------------------------------------ scene + hardware sync

function computeScene(now) {
  const t = telemetry(now);
  return arbitrate({
    now,
    autoHud: S.autoHud,
    ...t,
    manualBrakeUntil: state.manualBrakeUntil,
    user: state.user,
    holdMs: HOLD_OPTIONS[S.holdKey] ?? HOLD_OPTIONS["10s"],
    unit: S.unit,
    limitKmh: S.limitKmh,
    stoppedMode: S.stoppedMode,
  });
}

function setTag(text, cls = "") {
  const tag = $("syncTag");
  if (tag.textContent !== text) tag.textContent = text;
  tag.className = `tag ${cls}`;
}

async function syncHardware() {
  const scene = state.scene;
  if (!panel.ready || !scene) return;
  const key = sceneKey(scene);
  if (key === state.hwKey) return;
  const now = performance.now();
  // Rate-limit speed updates; everything else (brake, turns, messages) goes out immediately.
  const gap = scene.kind === "speed" && state.hwKey?.startsWith("speed") ? 700 : 0;
  if (now - state.hwAt < gap) {
    if (!state.hwTimer) state.hwTimer = setTimeout(() => { state.hwTimer = null; syncHardware(); }, gap - (now - state.hwAt));
    return;
  }
  state.hwKey = key;
  state.hwAt = now;
  if (scene.kind === "text") await rasterizer.ready(scene.text);
  if (state.scene !== scene && sceneKey(state.scene) !== key) return; // superseded while fonts loaded
  setTag("SENDING", "sending");
  const res = await panel.pushPlan(hardwarePlan(scene, rasterize), scene);
  if (res?.error) state.hwKey = null; // retry on next frame
  if (!panel.queue.busy) setTag("SYNCED", "synced");
}

function streamAnimation(now) {
  if (!S.liveAnimation || !panel.ready || !isAnimatedStill(state.scene)) return;
  if (panel.queue.busy || now - state.animAt < 250) return;
  state.animAt = now;
  state.animTick += 15; // ~0.25 s of preview animation per streamed frame
  const plan = hardwarePlan(state.scene, rasterize, { frameTick: state.animTick });
  panel.pushPlan(plan, state.scene, { key: "anim" });
}

// ------------------------------------------------------------------ main loop

let uiAt = -Infinity;
function loop() {
  const now = performance.now();
  const scene = computeScene(now);
  const key = sceneKey(scene);
  if (key !== state.sceneKey) {
    state.sceneKey = key;
    state.sceneStart = now;
    state.animTick = 0;
    const label = describeScene(scene);
    $("sceneLabel").textContent = label;
    $("dmScene").textContent = label;
  }
  state.scene = scene;
  if (panel.ready && key !== state.hwKey) syncHardware();
  streamAnimation(now);

  const bmp = renderPreview(scene, now - state.sceneStart, rasterize);
  preview.draw(bmp, scene.color, S.brightness);

  if (now - uiAt > 120) {
    uiAt = now;
    renderTelemetry(now);
    renderHoldBar(now);
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ actions

function showUser(scene, label) {
  state.user = { scene: { ...scene, nonce: ++state.nonce }, at: performance.now() };
  if (label) toast(label);
}

function sendMessage(item, { remember = true } = {}) {
  tap();
  const scene = { kind: "text", text: item.text, color: item.color ?? S.color, style: item.style ?? S.style, speed: item.speed ?? S.speed };
  showUser(scene, panel.connected ? `Sent · ${item.label ?? item.text}` : `Preview · ${item.label ?? item.text}`);
  if (remember) {
    store.pushRecent({ text: scene.text, color: scene.color, style: scene.style, speed: scene.speed });
    renderQuick();
  }
  markActivePreset();
}

function showEyes(eye) {
  tap();
  showUser({ kind: "devil", mode: eye.mode, color: eye.color }, `Eyes · ${eye.label}`);
}

function manualBrake() {
  sound("brake");
  haptic([80, 50, 80]);
  state.manualBrakeUntil = performance.now() + 3000;
  toast("⛔ Brake light");
}

async function connect({ acceptAll = false } = {}) {
  tap();
  if (transport.connected || transport.state === "reconnecting") {
    transport.disconnect();
    panel.stopHeartbeat();
    return;
  }
  if (!transport.supported) {
    toast("Bluetooth needs Chrome, Edge or Bluefy (iPhone)");
    log("navigator.bluetooth is not available in this browser", "error");
    return;
  }
  try {
    await transport.pair({ acceptAll });
  } catch (err) {
    if (err?.name === "NotFoundError" && /cancel/i.test(err.message)) {
      log("Pairing cancelled", "info");
      return;
    }
    log(`Pairing failed: ${err.message || err}`, "error");
    toast(`Bluetooth: ${err.message || "failed"}`);
  }
}

async function onConnected() {
  sound("ok");
  haptic([20, 40, 20]);
  toast(`Connected · ${transport.device?.name || "LED panel"}`);
  keepAwake();
  await panel.handshake(S.brightness);
  state.hwKey = null; // force a fresh push
  panel.startHeartbeat();
}

// ------------------------------------------------------------------ wake lock / background

let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch { /* not allowed right now */ }
  // A near-silent oscillator keeps iOS/Bluefy from suspending the page while driving.
  try {
    const ctx = audio();
    if (ctx && !keepAwake.osc) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 15;
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      keepAwake.osc = osc;
    }
  } catch { /* ignore */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (panel.connected || transport.device) keepAwake();
  transport.ensureConnected();
});

// ------------------------------------------------------------------ rendering

const CONNECT_LABELS = {
  idle: "Connect panel",
  requesting: "Choose panel…",
  connecting: "Connecting…",
  disconnected: "Reconnect",
};

transport.on("state", ({ state: st, attempt, name }) => {
  const btn = $("connectBtn");
  btn.dataset.state = st;
  $("connectLabel").textContent =
    st === "connected" ? name || "Connected" : st === "reconnecting" ? `Reconnecting ${attempt ?? ""}…` : CONNECT_LABELS[st] ?? "Connect panel";
  $("devInfo").textContent = st === "connected"
    ? `${transport.device?.name || "Panel"} · ${transport.writeChars.length} write / ${transport.notifyChars.length} notify`
    : st;
  if (st === "connected") onConnected();
  else {
    panel.stopHeartbeat();
    setTag("PREVIEW");
    state.hwKey = null;
  }
});
transport.on("drop", () => { toast("Panel disconnected — reconnecting"); panel.queue.clear("drop"); });
transport.on("rx", ({ uuid, bytes }) => {
  log(`RX ${uuid.slice(4, 8)} ← ${toHex(bytes)}`, "rx");
  const n = describeNotification(bytes);
  if (n.type === "screen" && n.is96x16) toast("Panel identified: 96×16");
});

function renderSensorStatus(st) {
  const gps = st.gps === "ok" ? `±${st.accuracy}m` : st.gps;
  $("statGps").textContent = gps;
  const on = st.gps === "ok" || st.motion === "ok";
  $("sensorsBtn").classList.toggle("on", on);
  $("sensorsLabel").textContent = sensors.active ? (st.motion === "ok" ? "GPS & motion on" : "GPS on") : "Start GPS & motion";
}

function renderTelemetry(now) {
  const t = telemetry(now);
  const shown = S.unit === "mph" ? kmhToMph(t.kmh) : t.kmh;
  const unit = S.unit === "mph" ? "mph" : "km/h";
  const over = S.limitKmh > 0 && t.kmh > S.limitKmh;
  $("speedNum").textContent = t.hasSpeed ? Math.round(shown) : "--";
  $("speedNum").classList.toggle("nodata", !t.hasSpeed);
  $("speedUnit").textContent = unit;
  $("speedNum").parentElement.classList.toggle("over", over);
  $("dmSpeed").textContent = t.hasSpeed ? Math.round(shown) : "--";
  $("dmSpeed").classList.toggle("nodata", !t.hasSpeed);
  $("dmUnit").textContent = unit;
  $("dmSpeed").parentElement.classList.toggle("over", over);
  const cls = classifyDrive(t.hasSpeed ? t.kmh : 0);
  const pill = $("drivePill");
  const braking = state.scene?.kind === "brake";
  pill.textContent = braking ? "Braking" : over ? "Over limit" : t.hasSpeed ? cls.label : "No speed";
  pill.className = `pill tone-${braking || over ? "red" : t.hasSpeed ? cls.tone : "muted"}`;
  for (const [id, dir] of [["turnLeft", "left"], ["turnRight", "right"], ["dmLeft", "left"], ["dmRight", "right"]]) {
    $(id).classList.toggle("on", t.turn === dir);
  }
  if (now - state.lastMotionAt < 2000) {
    $("statYaw").textContent = `${state.yaw >= 0 ? "↺" : "↻"} ${Math.abs(state.yaw).toFixed(0)}°/s`;
    $("statG").textContent = `${state.horizG.toFixed(2)} g`;
  }
  $("txStats").textContent = `${(transport.bytesSent / 1024).toFixed(1)} KB sent · ${panel.queue.stats.run} writes · ${panel.queue.stats.superseded} coalesced`;
}

function renderHoldBar(now) {
  const bar = $("holdBar");
  const hold = HOLD_OPTIONS[S.holdKey];
  const active = S.autoHud && state.user && state.scene?.source === "user" && Number.isFinite(hold) && now - state.user.at < hold;
  bar.hidden = !active;
  if (active) bar.firstElementChild.style.transform = `scaleX(${1 - (now - state.user.at) / hold})`;
}

function presetButton(item, { removable = false } = {}) {
  const b = document.createElement("button");
  b.className = "preset";
  b.style.setProperty("--c", item.color);
  b.dataset.text = item.text;
  const title = document.createElement("b");
  title.textContent = item.label ?? item.text;
  const hint = document.createElement("small");
  hint.textContent = `${item.hint ?? "Custom"} · ${item.style === "static" ? "static" : `scroll ${item.speed ?? S.speed}×`}`;
  b.append(title, hint);
  b.addEventListener("click", () => sendMessage(item));
  if (removable) {
    const del = document.createElement("span");
    del.className = "del";
    del.textContent = "×";
    del.setAttribute("role", "button");
    del.setAttribute("aria-label", `Delete ${item.text}`);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      store.removeCustom(item.text);
      renderBoard();
    });
    b.append(del);
  }
  return b;
}

function renderBoardTabs() {
  const tabs = $("boardTabs");
  tabs.replaceChildren();
  for (const b of [...BOARDS, { id: "mine", title: "Mine" }]) {
    const btn = document.createElement("button");
    btn.textContent = b.title;
    btn.dataset.board = b.id;
    btn.setAttribute("role", "tab");
    btn.classList.toggle("on", b.id === state.board);
    btn.addEventListener("click", () => { tap(); state.board = b.id; renderBoardTabs(); renderBoard(); });
    tabs.append(btn);
  }
}

function renderBoard() {
  const grid = $("presetGrid");
  grid.replaceChildren();
  const mine = state.board === "mine";
  const items = mine ? store.custom : BOARDS.find((b) => b.id === state.board).items;
  items.forEach((it) => grid.append(presetButton(it, { removable: mine })));
  $("mineEmpty").hidden = !(mine && items.length === 0);
  markActivePreset();
}

function markActivePreset() {
  const text = state.user?.scene.kind === "text" ? state.user.scene.text : null;
  document.querySelectorAll(".preset").forEach((b) => b.classList.toggle("active", b.dataset.text === text));
}

function renderQuick() {
  const row = $("quickRow");
  row.replaceChildren();
  const seen = new Set();
  const items = [...QUICK, ...store.recents].filter((i) => !seen.has(i.text) && seen.add(i.text)).slice(0, 6);
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label ?? it.text;
    b.className = "tamil";
    b.style.setProperty("--c", it.color);
    b.addEventListener("click", () => sendMessage(it));
    row.append(b);
  }
  // Drive mode: the three quick messages, eyes and brake.
  const dm = $("dmButtons");
  dm.replaceChildren();
  for (const it of QUICK) {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.style.setProperty("--c", it.color);
    b.addEventListener("click", () => sendMessage(it, { remember: false }));
    dm.append(b);
  }
  const eyes = document.createElement("button");
  eyes.textContent = "😈 Eyes";
  eyes.style.setProperty("--c", COLORS.red);
  eyes.addEventListener("click", () => showEyes(EYES[0]));
  const brake = document.createElement("button");
  brake.textContent = "⛔ BRAKE";
  brake.className = "danger";
  brake.addEventListener("click", manualBrake);
  dm.append(eyes, brake);
}

function miniCanvas(bmp, color) {
  const scale = 3;
  const c = document.createElement("canvas");
  c.width = COLS * scale;
  c.height = 16 * scale;
  const g = c.getContext("2d");
  const [r, gg, b] = hexToRgb(color);
  g.fillStyle = `rgb(${r},${gg},${b})`;
  for (let y = 0; y < 16; y++) for (let x = 0; x < COLS; x++) if (bmp.get(x, y)) g.fillRect(x * scale, y * scale, scale - 0.6, scale - 0.6);
  return c;
}

function renderEyes() {
  const grid = $("eyesGrid");
  grid.replaceChildren();
  for (const eye of EYES) {
    const b = document.createElement("button");
    b.className = "preset eye-card";
    b.style.setProperty("--c", eye.color);
    const title = document.createElement("b");
    title.textContent = `${eye.icon} ${eye.label}`;
    const hint = document.createElement("small");
    hint.textContent = eye.hint;
    b.append(miniCanvas(devilEyes(eye.mode, 0), eye.color), title, hint);
    b.addEventListener("click", () => showEyes(eye));
    grid.append(b);
  }
}

function renderPalette() {
  const pal = $("palette");
  pal.replaceChildren();
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.setProperty("--c", c);
    b.dataset.color = c;
    b.setAttribute("aria-label", `Colour ${c}`);
    b.addEventListener("click", () => setColor(c));
    pal.append(b);
  }
  const custom = document.createElement("label");
  custom.className = "swatch swatch-custom";
  custom.title = "Custom colour";
  const input = document.createElement("input");
  input.type = "color";
  input.value = S.color;
  input.setAttribute("aria-label", "Custom colour");
  input.addEventListener("input", () => setColor(input.value));
  custom.append(input);
  pal.append(custom);
  markColor();
}

function markColor() {
  document.querySelectorAll(".swatch[data-color]").forEach((s) => s.classList.toggle("on", s.dataset.color === S.color));
}

function setColor(c) {
  tap();
  store.set({ color: c });
  markColor();
  if (state.user?.scene.kind === "text") showUser({ ...state.user.scene, color: c });
}

function updateFitHint() {
  const text = $("composeInput").value.trim();
  const hint = $("fitHint");
  if (!text) { hint.textContent = "Type something"; hint.classList.remove("warn"); return; }
  const w = rasterize(text).width;
  const fits = w <= COLS;
  hint.textContent = fits ? `Fits the panel · ${w}px` : `${w}px — will scroll`;
  hint.classList.toggle("warn", !fits && S.style === "static");
}

function markSeg(container, attr, value) {
  container.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle("on", b.dataset[attr] === value));
}

// ------------------------------------------------------------------ navigation

function showTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  if (tab === "studio") updateFitHint();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

// ------------------------------------------------------------------ settings

function bindSettings() {
  const dlg = $("settings");
  $("settingsBtn").addEventListener("click", () => { tap(); syncSettingsUI(); dlg.showModal(); });

  dlg.querySelectorAll(".seg[data-setting]").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-v]");
      if (!btn) return;
      tap();
      const key = seg.dataset.setting;
      store.set({ [key]: btn.dataset.v });
      if (key === "brakeSensitivity") brakeDetector.setSensitivity(btn.dataset.v);
      syncSettingsUI();
    });
  });
  dlg.querySelectorAll("input.switch[data-setting]").forEach((sw) => {
    sw.addEventListener("change", () => {
      store.set({ [sw.dataset.setting]: sw.checked });
      if (sw.dataset.setting === "invertTurns") turnDetector.reset();
      if (sw.dataset.setting === "pixelFont") state.hwKey = null;
    });
  });
  $("limitInput").addEventListener("change", (e) => {
    const v = Math.max(0, Math.min(250, parseInt(e.target.value, 10) || 0));
    // Stored in km/h regardless of display unit.
    store.set({ limitKmh: S.unit === "mph" ? Math.round(v / 0.621371) : v });
    syncSettingsUI();
  });
  $("resetSettingsBtn").addEventListener("click", () => {
    store.reset();
    brakeDetector.setSensitivity(S.brakeSensitivity);
    applySettingsToUI();
    syncSettingsUI();
    toast("Settings reset");
  });
}

function syncSettingsUI() {
  const dlg = $("settings");
  dlg.querySelectorAll(".seg[data-setting]").forEach((seg) => markSeg(seg, "v", String(S[seg.dataset.setting])));
  dlg.querySelectorAll("input.switch[data-setting]").forEach((sw) => { sw.checked = !!S[sw.dataset.setting]; });
  const mph = S.unit === "mph";
  $("limitInput").value = S.limitKmh ? Math.round(mph ? kmhToMph(S.limitKmh) : S.limitKmh) : "";
  $("limitInput").placeholder = "off";
  $("limitUnit").textContent = mph ? "mph" : "km/h";
}

function applySettingsToUI() {
  $("brightness").value = S.brightness;
  $("brightVal").textContent = `${S.brightness}%`;
  $("scrollSpeed").value = S.speed;
  $("speedVal").textContent = `${S.speed}×`;
  $("autoHud").checked = S.autoHud;
  $("protocolSel").value = S.protocol;
  $("bitOrderSel").value = S.lsbFirst ? "lsb" : "msb";
  markSeg($("styleSeg"), "style", S.style);
  markSeg($("voiceLang"), "lang", S.voiceLang);
  markColor();
}

// ------------------------------------------------------------------ voice

function dictate() {
  tap();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast("Voice input isn't supported in this browser");
  const mic = $("micBtn");
  const rec = new SR();
  rec.lang = S.voiceLang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  mic.classList.add("listening");
  toast(S.voiceLang === "ta-IN" ? "பேசுங்கள்… (Tamil)" : "Listening… (English)");
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript.trim();
    if (!text) return;
    $("composeInput").value = text;
    updateFitHint();
    sendMessage({ text, color: S.color, style: S.style, speed: S.speed, hint: "Voice" });
  };
  rec.onerror = (e) => toast(`Voice: ${e.error}`);
  rec.onend = () => mic.classList.remove("listening");
  rec.start();
}

// ------------------------------------------------------------------ lab

const HEX_PRESETS = [
  ["Power on", "05 00 07 01 01"],
  ["Power off", "05 00 07 01 00"],
  ["Bright 100%", "05 00 04 80 64"],
  ["Clock", "0B 00 06 01 01 01 01 1A 09 15 01"],
  ["DIY mode", "05 00 04 01 01"],
  ["Ping", "04 00 05 80"],
  ["Reset", "04 00 03 80"],
];

function gridFrame() {
  const b = new Bitmap();
  for (let y = 0; y < 16; y++) for (let x = 0; x < COLS; x++) if ((x + y) % 2 === 0 || x === 0 || y === 0 || x === COLS - 1 || y === 15) b.set(x, y);
  return b;
}

async function runTest(name) {
  tap();
  const tests = {
    hello: () => sendMessage({ text: "HELLO", color: COLORS.cyan, style: "static" }, { remember: false }),
    tamil: () => sendMessage({ text: "வணக்கம் 🤝", color: COLORS.cyan, style: "scroll", speed: 6 }, { remember: false }),
    speed: () => panel.pushFrame(speedHud(65), COLORS.cyan, { label: "Test · 65 km/h" }),
    left: () => panel.pushFrame(turnArrows("left", 0), COLORS.green, { label: "Test · left" }),
    right: () => panel.pushFrame(turnArrows("right", 0), COLORS.green, { label: "Test · right" }),
    brake: () => panel.pushFrame(brakeFrame(), COLORS.red, { label: "Test · brake" }),
    eyes: () => showEyes(EYES[0]),
    grid: () => panel.pushFrame(gridFrame(), COLORS.white, { label: "Test · pixel grid" }),
    bright: async () => {
      for (const v of [25, 60, 100, S.brightness]) {
        panel.brightness(v);
        toast(`Brightness ${v}%`);
        await new Promise((r) => setTimeout(r, 1100));
      }
    },
  };
  if (!panel.connected && !["hello", "tamil", "eyes"].includes(name)) return toast("Connect the panel first");
  await tests[name]?.();
}

function bindLab() {
  const sel = $("protocolSel");
  for (const [v, label] of Object.entries(PROTOCOLS)) sel.append(new Option(label, v));
  sel.addEventListener("change", () => { store.set({ protocol: sel.value }); state.hwKey = null; log(`Protocol → ${sel.value}`, "info"); });
  $("bitOrderSel").addEventListener("change", (e) => { store.set({ lsbFirst: e.target.value === "lsb" }); state.hwKey = null; log(`Bit order → ${e.target.value.toUpperCase()}`, "info"); });
  $("pairAllBtn").addEventListener("click", () => connect({ acceptAll: true }));

  const cmds = {
    "power-on": () => panel.power(true),
    "power-off": () => panel.power(false),
    time: () => panel.timeSync(),
    clock: () => showUser({ kind: "clock", color: COLORS.amber }, "Clock mode"),
    diy: () => panel.diy(true),
    reset: () => panel.reset(),
    handshake: async () => { await panel.handshake(S.brightness); state.hwKey = null; },
  };
  document.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => {
    tap();
    if (!panel.connected && b.dataset.cmd !== "clock") return toast("Connect the panel first");
    cmds[b.dataset.cmd]();
  }));
  document.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => runTest(b.dataset.test)));

  const hexRow = $("hexPresets");
  for (const [label, hex] of HEX_PRESETS) {
    const b = document.createElement("button");
    b.className = "btn btn-small btn-glass";
    b.textContent = label;
    b.addEventListener("click", () => { $("hexInput").value = hex; sendHex(); });
    hexRow.append(b);
  }
  $("hexSendBtn").addEventListener("click", sendHex);
  $("hexInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendHex(); });
  $("clearLogBtn").addEventListener("click", () => { $("console").replaceChildren(); logLines.length = 0; });
  $("copyLogBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(logLines.join("\n"));
      toast("Log copied");
    } catch {
      toast("Clipboard unavailable");
    }
  });
}

function sendHex() {
  tap();
  let bytes;
  try {
    bytes = parseHex($("hexInput").value);
  } catch (e) {
    log(`Hex: ${e.message}`, "error");
    return toast(e.message);
  }
  if (!panel.connected) return toast("Connect the panel first");
  panel.raw(bytes);
}

// ------------------------------------------------------------------ bindings

function bind() {
  $("connectBtn").addEventListener("click", () => connect());
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { tap(); showTab(t.dataset.tab); }));

  let brightTimer = null;
  $("brightness").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    store.set({ brightness: v });
    $("brightVal").textContent = `${v}%`;
    clearTimeout(brightTimer);
    brightTimer = setTimeout(() => panel.brightness(v), 120);
  });
  $("scrollSpeed").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    store.set({ speed: v });
    $("speedVal").textContent = `${v}×`;
    const us = state.user?.scene;
    if (us?.kind === "text" && us.style === "scroll") {
      clearTimeout(bind.speedTimer);
      bind.speedTimer = setTimeout(() => { state.user.scene = { ...us, speed: v, nonce: ++state.nonce }; }, 200);
    }
  });

  $("autoHud").addEventListener("change", (e) => {
    store.set({ autoHud: e.target.checked });
    toast(e.target.checked ? "Auto HUD on" : "Auto HUD off — messages stay on the panel");
  });
  $("brakeBtn").addEventListener("click", manualBrake);
  $("sensorsBtn").addEventListener("click", async () => {
    tap();
    if (sensors.active) {
      sensors.stop();
      store.set({ sensorsWanted: false });
      state.gpsAt = -Infinity;
      turnDetector.reset();
      return;
    }
    sensors.startGps();
    await sensors.startMotion();
    store.set({ sensorsWanted: true });
    keepAwake();
  });

  $("simToggle").addEventListener("change", (e) => { state.sim = e.target.checked; });
  $("simSpeed").addEventListener("input", (e) => {
    state.simKmh = parseInt(e.target.value, 10);
    $("simSpeedVal").textContent = `${state.simKmh} km/h`;
    if (!state.sim) { state.sim = true; $("simToggle").checked = true; }
  });
  document.querySelectorAll("[data-sim-turn]").forEach((b) => b.addEventListener("click", () => {
    tap();
    state.simTurn = b.dataset.simTurn;
    if (!state.sim) { state.sim = true; $("simToggle").checked = true; }
    markSeg(b.parentElement, "simTurn", state.simTurn);
  }));

  $("driveModeBtn").addEventListener("click", async () => {
    tap();
    $("driveMode").hidden = false;
    keepAwake();
    try { await document.documentElement.requestFullscreen?.(); } catch { /* optional */ }
  });
  $("driveExit").addEventListener("click", () => {
    tap();
    $("driveMode").hidden = true;
    if (document.fullscreenElement) document.exitFullscreen?.();
  });

  $("composeInput").addEventListener("input", updateFitHint);
  $("composeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("sendMsgBtn").click(); });
  $("sendMsgBtn").addEventListener("click", () => {
    const text = $("composeInput").value.trim();
    if (!text) return toast("Type a message first");
    sendMessage({ text, color: S.color, style: S.style, speed: S.speed, hint: "Studio" });
  });
  $("saveMsgBtn").addEventListener("click", () => {
    const text = $("composeInput").value.trim();
    if (!text) return toast("Type a message first");
    tap();
    store.addCustom({ text, color: S.color, style: S.style, speed: S.speed, hint: "Mine" });
    toast("Saved to Messages › Mine");
    if (state.board === "mine") renderBoard();
  });
  $("clockBtn").addEventListener("click", () => { tap(); showUser({ kind: "clock", color: COLORS.amber }, "Clock on panel"); });
  $("micBtn").addEventListener("click", dictate);
  $("voiceLang").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (!b) return;
    tap();
    store.set({ voiceLang: b.dataset.lang });
    markSeg($("voiceLang"), "lang", S.voiceLang);
  });
  $("styleSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]");
    if (!b) return;
    tap();
    store.set({ style: b.dataset.style });
    markSeg($("styleSeg"), "style", S.style);
    updateFitHint();
  });

  bindSettings();
  bindLab();

  const armAudio = () => { audio(); window.removeEventListener("pointerdown", armAudio); };
  window.addEventListener("pointerdown", armAudio);
}

// ------------------------------------------------------------------ boot

async function autoStartSensors() {
  if (!S.sensorsWanted || !navigator.permissions?.query) return;
  try {
    const p = await navigator.permissions.query({ name: "geolocation" });
    if (p.state === "granted") sensors.startGps();
  } catch { /* ignore */ }
}

function boot() {
  $("buildBadge").textContent = `v${BUILD.version.split(".")[0]}`;
  $("buildInfo").textContent = `NightFury v${BUILD.version} · build ${BUILD.hash} · ${BUILD.date}`;
  renderBoardTabs();
  renderBoard();
  renderQuick();
  renderEyes();
  renderPalette();
  bind();
  applySettingsToUI();
  syncSettingsUI();
  autoStartSensors();
  log(`NightFury v${BUILD.version} ready (${BUILD.hash}). Bluetooth ${transport.supported ? "available" : "unavailable"}.`, "ok");
  requestAnimationFrame(loop);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch((e) => log(`Service worker: ${e.message}`, "error"));
  }
}

// Debug / test handle (read-mostly).
window.NF = { state, store, panel, transport, rasterize, get scene() { return state.scene; }, build: BUILD };

boot();
