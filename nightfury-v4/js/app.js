// NightFury v4 - boot and wiring. The logic lives in the pure modules (engine,
// director, scene, ...); this file connects them to the DOM, the sensors and the
// Bluetooth panel, and hands a shared context to the views in ui/.
import { BUILD } from "./version.js";
import { describeNotification, toHex } from "./protocol.js";
import { BleTransport } from "./ble.js";
import { IPixelPanel } from "./device.js";
import { createRasterizer } from "./textraster.js";
import { createScenes, describeScene, sceneTint } from "./scene.js";
import { DriveModel } from "./drive.js";
import { Engine, effectiveBrightness } from "./engine.js";
import { FRAME_MS } from "./graphics.js";
import { TripMeter } from "./trip.js";
import { createSensors } from "./sensors.js";
import { createStore } from "./store.js";
import { createLibrary, itemLabel, itemScene } from "./library.js";
import { MODES, buildProgramme } from "./modes.js";
import { scrollDurationMs } from "./text.js";
import { createTicker } from "./ticker.js";
import { $, bindSheet, createFeedback, h, icon, openMenu, openSheet, paintRange, toast } from "./ui/dom.js";
import { createLedView, createThumbs } from "./ui/led.js";
import { mountDrive } from "./ui/drive.js";
import { mountLibrary } from "./ui/library.js";
import { mountStudio } from "./ui/studio.js";
import { mountShows } from "./ui/shows.js";
import { mountLab } from "./ui/lab.js";
import { mountSettings } from "./ui/settings.js";

const store = createStore();
const S = store.settings;
const migrated = store.migrateV3();
const lib = createLibrary(store);
const fb = createFeedback(S);
const now = () => performance.now();

// ------------------------------------------------------------------ logging

const LOG_MAX = 400;
const logLines = [];
function log(msg, level = "info") {
  const t = new Date().toTimeString().slice(0, 8);
  logLines.push(`[${t}] ${msg}`);
  if (logLines.length > LOG_MAX) logLines.shift();
  const el = $("console");
  if (el) {
    el.append(h("div", { class: `log-${level}` }, h("span", { class: "t" }, `${t} `), msg));
    while (el.childElementCount > LOG_MAX) el.firstElementChild.remove();
    el.scrollTop = el.scrollHeight;
  }
  if (level === "error") console.warn(`[nightfury] ${msg}`);
}

// ------------------------------------------------------------------ core objects

const bus = (() => {
  const map = new Map();
  return {
    on(type, fn) { (map.get(type) ?? map.set(type, new Set()).get(type)).add(fn); },
    emit(type, detail) { for (const fn of map.get(type) ?? []) fn(detail); },
  };
})();

const rasterizer = createRasterizer({ pixelFont: () => S.pixelFont });
const transport = new BleTransport({ bluetooth: navigator.bluetooth, log, chunkSize: () => S.chunkSize });
const panel = new IPixelPanel({ transport, log, options: () => ({ lsbFirst: S.lsbFirst, multiColor: S.multiColor }) });
const scenes = createScenes({ rasterize: rasterizer.rasterize, epoch: () => rasterizer.epoch, options: () => S });
const drive = new DriveModel({ options: () => S });
const engine = new Engine({
  panel, scenes, drive,
  settings: () => S,
  resolve: (ref) => lib.scene(ref),
  fontsReady: (text) => rasterizer.ready(text),
  epoch: () => rasterizer.epoch,
  trip: new TripMeter(store.trip),
});

const sensorStatus = { gps: "off", accuracy: null, motion: "off" };
const sensors = createSensors({
  log,
  onStatus: (st) => Object.assign(sensorStatus, st),
  onFix: (fix) => drive.fix(fix, now()),
  onMotion: (m) => drive.sample(m, now()),
});

const led = createLedView($("matrix"), $("glow"));
const thumbs = createThumbs();
const state = { tab: "drive", activeId: null, sentBrightness: null };

// ------------------------------------------------------------------ actions

/** How long a mode beat needs on the panel, from its real layout. */
function beatMs(scene) {
  if (scene.kind !== "text") return 2400;
  const l = scenes.textLayout(scene);
  if (l.kind === "scroll") return Math.round(scrollDurationMs(l) * 1.1) + 400;
  return Number.isFinite(l.loopMs) ? l.loopMs : 2600;
}

/** Start (or, when it is already running, stop) a mode: Thirukkural, mini stories, comedy. */
function playMode(mode, { toggle = true } = {}) {
  if (!MODES[mode]) return;
  fb.tap();
  const id = `mode.${mode}`;
  if (toggle && engine.player.show?.id === id) {
    engine.stopShow();
    state.activeId = null;
    toast(`${MODES[mode].name} stopped`);
  } else {
    const programme = buildProgramme(mode, { lang: S.modeLang, style: S.modeStyle, seed: (Date.now() % 100000) + 1, measure: beatMs });
    if (!programme?.items.length) return toast("Nothing to show in this language");
    engine.playShow(programme, now());
    state.activeId = id;
    toast(`${MODES[mode].name}: ${programme.units} on a loop`);
  }
  engine.tick(now());
  bus.emit("active");
  bus.emit("shows");
}

/** Put a library item on the panel. */
function send(item, { quiet = false } = {}) {
  if (item?.kind === "mode") return playMode(item.mode);
  const scene = itemScene(item);
  if (!scene) return;
  if (!quiet) fb.tap();
  engine.show(scene, now());
  state.activeId = item.id ?? null;
  engine.tick(now());
  toast(`${panel.ready ? "Sent" : "Preview"} · ${itemLabel(item)}`);
  bus.emit("active");
}

/** Put an ad-hoc scene (studio draft, test card) on the panel. */
function sendScene(scene, label) {
  fb.tap();
  engine.show(scene, now());
  state.activeId = null;
  engine.tick(now());
  if (label) toast(`${panel.ready ? "Sent" : "Preview"} · ${label}`);
  bus.emit("active");
}

function clearMessage() {
  engine.clearUser();
  state.activeId = null;
  engine.tick(now());
  bus.emit("active");
}

function brake() {
  fb.sound("brake");
  fb.haptic([80, 50, 80]);
  engine.brake(now(), 3000);
  engine.tick(now());
}

function signal(which) {
  fb.tap();
  const active = engine.signal(which, now());
  engine.tick(now());
  return active;
}

async function connect({ acceptAll = false } = {}) {
  fb.tap();
  if (transport.connected || ["reconnecting", "connecting", "resuming"].includes(transport.state)) {
    transport.disconnect();
    panel.stopHeartbeat();
    return;
  }
  if (!transport.supported) {
    toast("No Web Bluetooth here: use Chrome, Edge or Bluefy (iPhone)");
    log("navigator.bluetooth is not available in this browser", "error");
    return;
  }
  try {
    await transport.pair({ acceptAll });
  } catch (err) {
    if (err?.name === "NotFoundError" && /cancel/i.test(err.message)) return log("Pairing cancelled", "info");
    log(`Pairing failed: ${err.message || err}`, "error");
    toast(`Bluetooth: ${err.message || "failed"}`);
  }
}

async function onConnected() {
  fb.sound("ok");
  fb.haptic([20, 40, 20]);
  toast(`Connected · ${transport.device?.name || "LED panel"}`);
  keepAwake();
  const level = effectiveBrightness(S);
  await panel.handshake(level);
  state.sentBrightness = level;
  engine.resync();
  panel.startHeartbeat();
}

function pushBrightness() {
  const level = effectiveBrightness(S);
  if (level === state.sentBrightness) return;
  state.sentBrightness = level;
  panel.brightness(level);
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
  fb.keepAlive();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (panel.connected || transport.device || sensors.active) keepAwake();
  transport.ensureConnected();
  led.invalidate();
});

// ------------------------------------------------------------------ connection UI

const CONNECT_LABELS = {
  idle: "Connect panel",
  requesting: "Choose panel…",
  connecting: "Connecting…",
  resuming: "Finding panel…",
  disconnected: "Reconnect",
};

transport.on("state", ({ state: st, attempt, name, reason }) => {
  $("connectBtn").dataset.state = st;
  $("connectLabel").textContent = st === "connected" ? name || "Connected" : st === "reconnecting" ? `Reconnecting ${attempt ?? ""}…` : CONNECT_LABELS[st] ?? "Connect panel";
  $("devInfo").textContent = st === "connected"
    ? `${transport.device?.name || "Panel"} · ${transport.writeChars.length} write / ${transport.notifyChars.length} notify`
    : st === "disconnected" && reason === "resume" ? "Last panel not in range" : st === "idle" ? "Not connected" : st;
  if (st === "connected") onConnected();
  else {
    panel.stopHeartbeat();
    engine.resync();
    state.sentBrightness = null;
  }
});
transport.on("drop", () => { toast("Panel disconnected: reconnecting"); panel.queue.clear("drop"); });
transport.on("rx", ({ uuid, bytes }) => {
  log(`RX ${uuid.slice(4, 8)} ← ${toHex(bytes)}`, "rx");
  const n = describeNotification(bytes);
  if (n.type === "screen" && n.is96x16) log("Panel identified: 96×16", "ok");
});

// ------------------------------------------------------------------ item menu

function addToShowSheet(item) {
  const shows = store.shows;
  openMenu(`Add “${itemLabel(item)}” to…`, [
    ...shows.map((s) => ({
      label: s.name, icon: "list",
      run() {
        store.saveShow({ ...s, items: [...s.items, { ref: item.id, secs: 8 }] });
        toast(`Added to ${s.name}`);
        bus.emit("shows");
      },
    })),
    {
      label: "New show", icon: "plus",
      run() {
        const s = store.saveShow({ name: "My show", items: [{ ref: item.id, secs: 8 }] });
        toast(`Created ${s.name}`);
        bus.emit("shows", { open: s.id });
        showTab("shows");
      },
    },
  ]);
}

function itemMenu(item) {
  const pinned = store.pins.includes(item.id);
  const editable = item.kind === "text" || item.kind === "art";
  openMenu(itemLabel(item), [
    { label: item.kind === "mode" ? (engine.player.show?.id === item.id ? "Stop" : "Start") : "Send to panel", icon: item.kind === "mode" ? "play" : "send", run: () => send(item) },
    {
      label: pinned ? "Unpin from quick deck" : "Pin to quick deck", icon: "pin",
      run() {
        const ok = store.togglePin(item.id);
        toast(pinned ? "Unpinned" : ok ? "Pinned to the quick deck" : "The quick deck is full (8)");
        bus.emit("library");
      },
    },
    item.kind !== "mode" && { label: "Add to a show", icon: "play", run: () => addToShowSheet(item) },
    editable && { label: item.builtin ? "Copy to Studio" : "Edit in Studio", icon: "pen", run: () => { bus.emit("edit", item); showTab("studio"); } },
    !item.builtin && {
      label: "Delete", icon: "trash", danger: true,
      run() {
        store.removeItem(item.id);
        if (state.activeId === item.id) clearMessage();
        toast("Deleted");
        bus.emit("library");
        bus.emit("shows");
      },
    },
  ]);
}

// ------------------------------------------------------------------ navigation

function showTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === tab;
    t.classList.toggle("active", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  bus.emit("tab", tab);
}

// ------------------------------------------------------------------ context + views

const ctx = {
  store, S, lib, engine, panel, transport, scenes, rasterizer, sensors, sensorStatus, drive, fb, thumbs, bus, log, logLines, state, now,
  send, sendScene, clearMessage, brake, signal, connect, keepAwake, itemMenu, showTab, pushBrightness, playMode,
  /** Thumbnail canvas for a scene (animated while visible). */
  thumb(scene, cls = "thumb") {
    const canvas = h("canvas", { class: cls, "aria-hidden": "true" });
    thumbs.add(canvas, (ms) => scenes.render(scene, ms, { thumb: true }));
    return canvas;
  },
};

const views = [mountDrive, mountLibrary, mountStudio, mountShows, mountLab, mountSettings].map((mount) => mount(ctx)).filter(Boolean);

// ------------------------------------------------------------------ stage

function renderStage(t) {
  const status = engine.status;
  const tag = $("syncTag");
  const text = { draft: "DRAFT", preview: "PREVIEW", sending: "SENDING", live: "LIVE" }[status];
  if (tag.textContent !== text) { tag.textContent = text; tag.className = `tag ${status}`; }

  const scene = engine.draft ? engine.draft.scene : engine.scene;
  const label = describeScene(scene);
  if ($("sceneLabel").textContent !== label) $("sceneLabel").textContent = label;
  document.documentElement.style.setProperty("--tint", sceneTint(scene));

  const left = engine.holdLeft(t);
  $("holdBar").hidden = left === null;
  if (left !== null) $("holdBar").firstElementChild.style.transform = `scaleX(${left})`;
  $("clearBtn").hidden = !(engine.user && engine.scene.source === "user" && !engine.draft);

  // Indicator relay: tick-tock in step with the panel animation.
  const sig = engine.stalk.active;
  const phase = sig ? Math.floor((t - engine.stalk.since) / FRAME_MS) % 2 : -1;
  if (phase !== renderStage.phase) {
    renderStage.phase = phase;
    if (phase >= 0) fb.sound(phase ? "relayOff" : "relayOn");
  }
}

engine.on("brake", (on) => { if (on && engine.manualBrakeUntil < now()) { fb.sound("brake"); fb.haptic([60, 40, 60]); } });
engine.on("over", (on) => { if (on) { fb.sound("alert"); fb.haptic([40, 60, 40, 60, 40]); } });
engine.on("show", (show) => {
  if (!show && state.activeId?.startsWith("mode.")) { state.activeId = null; bus.emit("active"); }
});
engine.on("scene", (scene) => {
  if (scene.source !== "user" && state.activeId && !engine.user) { state.activeId = null; bus.emit("active"); }
});

// ------------------------------------------------------------------ loops

let slowAt = 0;
const ticker = createTicker(() => {
  const t = now();
  engine.tick(t);
  if (t - slowAt > 15000) {
    slowAt = t;
    if (panel.ready) pushBrightness();
    if (engine.trip.active) store.saveTrip(engine.trip.toJSON());
  }
}, 100);

let uiAt = -Infinity;
function frame() {
  const t = now();
  const f = engine.previewFrame(t);
  led.draw(f, effectiveBrightness(S));
  for (const v of views) v.frame?.(f, t);
  if (t - uiAt > 120) {
    uiAt = t;
    renderStage(t);
    for (const v of views) v.render?.(t);
    thumbs.tick(t);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ bindings

function bind() {
  bindSheet();
  $("connectBtn").addEventListener("click", () => connect());
  $("clearBtn").addEventListener("click", () => { fb.tap(); clearMessage(); });
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { fb.tap(); showTab(t.dataset.tab); }));

  const bright = $("brightness");
  let brightTimer = null;
  const showBright = () => { $("brightVal").textContent = `${S.brightness}%`; bright.value = S.brightness; paintRange(bright); };
  bright.addEventListener("input", () => {
    store.set({ brightness: parseInt(bright.value, 10) });
    showBright();
    clearTimeout(brightTimer);
    brightTimer = setTimeout(pushBrightness, 120);
  });
  bus.on("settings", showBright);
  showBright();

  window.addEventListener("pointerdown", () => fb.arm(), { once: true });

  // Desktop keys: arrows = signals, H = hazard, B / space = brake, 1-8 = quick deck, D = drive mode.
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target;
    if (el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft") signal("left");
    else if (k === "arrowright") signal("right");
    else if (k === "h") signal("hazard");
    else if (k === "b" || k === " ") brake();
    else if (k === "d") bus.emit("drivemode");
    else if (/^[1-8]$/.test(k)) { const item = lib.pinned()[Number(k) - 1]; if (item) send(item); }
    else return;
    e.preventDefault();
  });
}

function welcome() {
  const dlg = $("welcome");
  const notes = [];
  if (migrated) notes.push(`Imported ${migrated.items} saved message${migrated.items === 1 ? "" : "s"}${migrated.settings ? " and your settings" : ""} from v3.`);
  if (!transport.supported) notes.push("This browser has no Web Bluetooth, so everything runs as a preview. To drive a panel use Chrome or Edge (Android, desktop) or Bluefy (iPhone).");
  $("welcomeNote").textContent = notes.join(" ");
  $("welcomeNote").hidden = !notes.length;
  const done = () => { store.setMeta({ onboarded: true }); dlg.close(); };
  $("welcomeSkip").addEventListener("click", done);
  $("welcomeConnect").addEventListener("click", () => { done(); connect(); });
  $("welcomeDemo").addEventListener("click", () => { done(); bus.emit("demo", true); });
  dlg.addEventListener("close", () => store.setMeta({ onboarded: true }));
  if (!store.meta.onboarded) dlg.showModal();
  else if (migrated) toast(notes[0]);
}

async function boot() {
  $("buildBadge").textContent = `v${BUILD.version.split(".")[0]}`;
  $("buildInfo").textContent = `NightFury v${BUILD.version} · build ${BUILD.hash} · ${BUILD.date}`;
  bind();
  engine.tick(now());
  log(`NightFury v${BUILD.version} ready (${BUILD.hash}). Bluetooth ${transport.supported ? "available" : "unavailable"}.`, "ok");
  requestAnimationFrame(frame);
  welcome();

  if (S.sensorsWanted && navigator.permissions?.query) {
    try {
      const p = await navigator.permissions.query({ name: "geolocation" });
      if (p.state === "granted") sensors.startGps();
    } catch { /* ignore */ }
  }
  if (S.resume && transport.supported) transport.resume().catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch((e) => log(`Service worker: ${e.message}`, "error"));
  }
}

// Debug / test handle (read-mostly).
window.NF = { state, store, lib, engine, panel, transport, scenes, drive, sensors, thumbs, ticker, ctx, build: BUILD, get scene() { return engine.scene; } };

// Kept for views that want to build a quick confirm sheet.
ctx.confirm = (title, message, label, run) => openSheet(title, [
  h("p", { class: "hint" }, message),
  h("div", { class: "row" },
    h("button", { class: "btn grow", onclick: () => $("sheet").close() }, "Cancel"),
    h("button", { class: "btn btn-red grow", onclick: () => { $("sheet").close(); run(); } }, icon("trash"), label)),
]);

boot();
