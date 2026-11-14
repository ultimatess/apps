// Drive tab (cluster, quick deck, trip) and the full-screen Drive mode.
import { $, bindSeg, h, markSeg, toast } from "./dom.js";
import { createLedView } from "./led.js";
import { classifyDrive, kmhToMph } from "../telemetry.js";
import { describeScene, sceneTint } from "../scene.js";
import { itemLabel, itemScene } from "../library.js";
import { formatDistance, formatDuration } from "../trip.js";
import { effectiveBrightness } from "../engine.js";

const HUD_HINTS = {
  off: "The drive never takes over the panel",
  signals: "Brake light and turn arrows interrupt your content",
  full: "Speed while moving, plus brake light and turn arrows",
};

export function mountDrive(ctx) {
  const { store, S, lib, engine, sensors, sensorStatus, fb, bus } = ctx;
  let ckLed = null;

  // ------------------------------------------------------------------ deck

  function deckButton(item, i) {
    const scene = itemScene(item);
    return h("button", {
      class: "item", dataset: { id: item.id }, style: { "--c": sceneTint(scene) },
      onclick: () => ctx.send(item),
    },
    ctx.thumb(scene),
    h("span", { class: "key" }, String(i + 1)),
    h("b", { class: "tamil" }, itemLabel(item)));
  }

  function renderDeck() {
    const items = lib.pinned();
    $("deck").replaceChildren(...items.map(deckButton));
    $("deckHint").textContent = items.length
      ? "Pin up to eight items from the Library. Keys 1–8 send them."
      : "Nothing pinned yet. Open the Library, tap ⋯ on an item and choose Pin.";
    $("ckDeck").replaceChildren(...items.slice(0, 6).map((item) => h("button", {
      class: "tamil", dataset: { id: item.id }, style: { "--c": sceneTint(itemScene(item)) },
      onclick: () => ctx.send(item),
    }, itemLabel(item))));
    ctx.thumbs.sweep();
    markActive();
  }

  function markActive() {
    const id = ctx.state.activeId;
    document.querySelectorAll("#deck .item, #ckDeck button").forEach((b) => b.classList.toggle("active", !!id && b.dataset.id === id));
  }

  // ------------------------------------------------------------------ drive mode

  function openCockpit() {
    fb.tap();
    $("driveMode").hidden = false;
    if (!ckLed) ckLed = createLedView($("ckMatrix"));
    ckLed.invalidate();
    ctx.keepAwake();
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function closeCockpit() {
    fb.tap();
    $("driveMode").hidden = true;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  // ------------------------------------------------------------------ sensors / demo

  async function toggleSensors() {
    fb.tap();
    if (sensors.active) {
      sensors.stop();
      store.set({ sensorsWanted: false });
      ctx.drive.reset();
      store.saveTrip(engine.trip.toJSON());
      return;
    }
    setDemo(false);
    sensors.startGps();
    await sensors.startMotion();
    store.set({ sensorsWanted: true });
    ctx.keepAwake();
    if (sensorStatus.gps === "denied") toast("Location is blocked for this site");
  }

  function setDemo(on) {
    $("demoToggle").checked = on;
    if (on) {
      engine.startDemo(ctx.now());
      if (S.hud !== "full") { store.set({ hud: "full" }); syncHud(); }
      toast("Demo drive: watch the panel");
    } else {
      engine.stopDemo();
    }
  }

  function syncHud() {
    markSeg($("hudSeg"), S.hud);
    $("hudHint").textContent = HUD_HINTS[S.hud];
  }

  function newTrip() {
    fb.tap();
    if (engine.trip.active) store.pushTrip(engine.trip.summary());
    engine.trip.reset(Date.now());
    store.saveTrip(engine.trip.toJSON());
    toast("New trip started");
  }

  // ------------------------------------------------------------------ periodic render

  function sparkline() {
    const c = $("tripSpark");
    const g = c.getContext("2d");
    const samples = engine.trip.samples;
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, c.height - 0.5); g.lineTo(c.width, c.height - 0.5); g.stroke();
    if (samples.length < 2) return;
    const max = Math.max(40, ...samples);
    const step = c.width / Math.max(1, samples.length - 1);
    const y = (v) => c.height - 3 - (v / max) * (c.height - 8);
    g.beginPath();
    samples.forEach((v, i) => (i ? g.lineTo(i * step, y(v)) : g.moveTo(0, y(v))));
    g.strokeStyle = "#b9f227";
    g.lineWidth = 2.5;
    g.lineJoin = "round";
    g.stroke();
    g.lineTo((samples.length - 1) * step, c.height);
    g.lineTo(0, c.height);
    g.closePath();
    g.fillStyle = "rgba(185,242,39,0.12)";
    g.fill();
  }

  let sparkKey = "";
  function render() {
    const t = engine.tele;
    const mph = S.unit === "mph";
    const shown = mph ? kmhToMph(t.kmh) : t.kmh;
    const unit = mph ? "mph" : "km/h";
    const over = S.limitKmh > 0 && t.hasSpeed && t.kmh > S.limitKmh;
    const text = t.hasSpeed ? String(Math.round(shown)) : "--";
    for (const [num, unitEl, wrap] of [["speedNum", "speedUnit", "speedo"], ["ckSpeed", "ckUnit", "ckSpeedo"]]) {
      if ($(num).textContent !== text) $(num).textContent = text;
      $(unitEl).textContent = unit;
      $(wrap).classList.toggle("nodata", !t.hasSpeed);
      $(wrap).classList.toggle("over", over);
    }

    const scene = engine.scene;
    const cls = classifyDrive(t.hasSpeed ? t.kmh : 0);
    const pill = $("drivePill");
    const braking = scene.kind === "brake";
    const label = braking ? "Braking" : over ? "Over limit" : t.source === "demo" ? `Demo · ${cls.label}` : t.source === "sim" ? `Sim · ${cls.label}` : t.hasSpeed ? cls.label : sensors.active ? "Waiting for GPS" : "No GPS";
    if (pill.textContent !== label) pill.textContent = label;
    pill.className = `pill tone-${braking || over ? "red" : t.hasSpeed ? cls.tone : "muted"}`;

    const sig = engine.stalk.active;
    const auto = scene.kind === "turn" && scene.source === "sensor" ? scene.dir : null;
    for (const [id, dir] of [["sigLeft", "left"], ["sigRight", "right"], ["ckLeft", "left"], ["ckRight", "right"]]) {
      $(id).setAttribute("aria-pressed", sig === dir ? "true" : "false");
      $(id).classList.toggle("auto", auto === dir);
    }
    for (const id of ["hazardBtn", "ckHazard"]) $(id).setAttribute("aria-pressed", sig === "hazard" ? "true" : "false");

    const gps = sensorStatus.gps === "ok" ? `±${sensorStatus.accuracy}m` : sensorStatus.gps;
    if ($("statGps").textContent !== gps) $("statGps").textContent = gps;
    $("statYaw").textContent = t.yaw === null ? "–" : `${t.yaw >= 0 ? "↺" : "↻"}${Math.abs(t.yaw).toFixed(0)}°/s`;
    $("statG").textContent = t.horizG === null ? "–" : t.horizG.toFixed(2);
    $("sensorsBtn").classList.toggle("on", sensors.active);
    $("sensorsLabel").textContent = sensors.active ? "End drive" : "Start drive";

    const trip = engine.trip;
    $("tripDist").textContent = formatDistance(trip.distanceM, S.unit);
    $("tripTime").textContent = formatDuration(trip.movingMs);
    $("tripAvg").textContent = `${Math.round(mph ? kmhToMph(trip.avgKmh) : trip.avgKmh)} ${unit}`;
    $("tripMax").textContent = `${Math.round(mph ? kmhToMph(trip.maxKmh) : trip.maxKmh)} ${unit}`;
    $("tripBrakes").textContent = trip.hardBrakes;
    $("tripStops").textContent = trip.stops;
    const key = `${trip.samples.length}|${trip.samples[trip.samples.length - 1] ?? ""}`;
    if (key !== sparkKey) { sparkKey = key; sparkline(); }

    if (!$("driveMode").hidden) {
      const label2 = describeScene(scene);
      if ($("ckScene").textContent !== label2) $("ckScene").textContent = label2;
    }
  }

  // ------------------------------------------------------------------ bindings

  $("sigLeft").addEventListener("click", () => ctx.signal("left"));
  $("sigRight").addEventListener("click", () => ctx.signal("right"));
  $("hazardBtn").addEventListener("click", () => ctx.signal("hazard"));
  $("brakeBtn").addEventListener("click", () => ctx.brake());
  $("ckLeft").addEventListener("click", () => ctx.signal("left"));
  $("ckRight").addEventListener("click", () => ctx.signal("right"));
  $("ckHazard").addEventListener("click", () => ctx.signal("hazard"));
  $("ckBrake").addEventListener("click", () => ctx.brake());
  $("ckExit").addEventListener("click", closeCockpit);
  $("driveModeBtn").addEventListener("click", openCockpit);
  $("sensorsBtn").addEventListener("click", toggleSensors);
  $("tripResetBtn").addEventListener("click", newTrip);
  $("demoToggle").addEventListener("change", (e) => { fb.tap(); setDemo(e.target.checked); });
  bindSeg($("hudSeg"), (v) => {
    fb.tap();
    store.set({ hud: v });
    $("hudHint").textContent = HUD_HINTS[v];
  });
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && !$("driveMode").hidden) $("driveMode").hidden = true; });
  window.addEventListener("pagehide", () => { if (engine.trip.active) store.saveTrip(engine.trip.toJSON()); });

  bus.on("library", renderDeck);
  bus.on("active", markActive);
  bus.on("settings", syncHud);
  bus.on("demo", setDemo);
  bus.on("drivemode", () => ($("driveMode").hidden ? openCockpit() : closeCockpit()));

  syncHud();
  renderDeck();

  return {
    render,
    frame(f) { if (ckLed && !$("driveMode").hidden) ckLed.draw(f, effectiveBrightness(S)); },
  };
}
