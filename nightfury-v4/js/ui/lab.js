// Lab tab: panel options, test cards, simulator, unverified firmware features,
// raw hex, the console and backups.
import { $, bindSeg, h, markSeg, paintRange, toast } from "./dom.js";
import { ANIM_UNVERIFIED, GIF_MAX_BYTES, clockModePacket, mapScrollSpeed, parseHex, toHex } from "../protocol.js";
import { Frame, packFrame } from "../frame.js";
import { FRAME_MS, brakeFrame, colorBarsFrame, gridFrame, speedHud, turnFrame } from "../graphics.js";
import { encodeGif } from "../gif.js";
import { describeScene } from "../scene.js";
import { effectiveBrightness } from "../engine.js";

export function mountLab(ctx) {
  const { store, S, engine, panel, transport, scenes, rasterizer, fb, bus, log, logLines } = ctx;
  const sim = { on: false, kmh: 0, turn: "straight", brake: false };
  const probe = { anim: 2, rainbow: 0 };

  const needPanel = () => {
    if (panel.connected) return true;
    toast("Connect the panel first");
    return false;
  };

  /** Test cards are ordinary art scenes, so the preview shows exactly what was sent. */
  const card = (id, name, frames, fps = 4) => ctx.sendScene({ kind: "art", id: `test.${id}`, rev: Date.now(), name, fps, frames: frames.map(packFrame) }, name);

  const TESTS = {
    grid: () => card("grid", "Pixel grid", [gridFrame()]),
    bars: () => card("bars", "Colour bars", [colorBarsFrame()]),
    speed: () => card("speed", "Speed 65", [speedHud(65, { frac: 65 / 120 })]),
    left: () => card("left", "Signal left", [0, 1, 2, 3].map((i) => turnFrame("left", i * FRAME_MS)), 1000 / FRAME_MS),
    right: () => card("right", "Signal right", [0, 1, 2, 3].map((i) => turnFrame("right", i * FRAME_MS)), 1000 / FRAME_MS),
    brake: () => card("brake", "Brake", [brakeFrame(0), brakeFrame(FRAME_MS)], 1000 / FRAME_MS),
    hello: () => ctx.sendScene({ kind: "text", text: "HELLO", color: "#00d0ff", effect: "static" }, "HELLO"),
    tamil: () => ctx.sendScene({ kind: "text", text: "வணக்கம் 🤝", color: "#00d0ff", effect: "scroll", speed: 6 }, "வணக்கம்"),
    async bright() {
      if (!needPanel()) return;
      for (const v of [25, 60, 100, effectiveBrightness(S)]) {
        panel.brightness(v);
        toast(`Brightness ${v}%`);
        await new Promise((r) => setTimeout(r, 1100));
      }
    },
  };

  const CMDS = {
    "power-on": () => panel.power(true),
    "power-off": () => panel.power(false),
    time: () => panel.timeSync(),
    fwclock: () => panel.clock(),
    diy: () => panel.diy(true),
    reset: () => panel.reset(),
    handshake: async () => { await panel.handshake(effectiveBrightness(S)); engine.resync(); },
  };

  function applySim() {
    engine.sim = sim.on ? { kmh: sim.kmh, turn: sim.turn, brake: sim.brake } : null;
    $("simToggle").checked = sim.on;
    $("simBrake").setAttribute("aria-pressed", sim.brake ? "true" : "false");
    if (sim.on && engine.demoAt !== null) bus.emit("demo", false);
  }

  function sendHex() {
    fb.tap();
    let bytes;
    try {
      bytes = parseHex($("hexInput").value);
    } catch (e) {
      log(`Hex: ${e.message}`, "error");
      return toast(e.message);
    }
    if (needPanel()) panel.raw(bytes);
  }

  function sendProbe() {
    fb.tap();
    if (!needPanel()) return;
    const raster = Frame.fromBitmap(rasterizer.rasterize("NIGHTFURY"), "#00d0ff");
    panel.pushScroll(raster, mapScrollSpeed(6), { anim: probe.anim, rainbow: probe.rainbow, label: `Probe anim ${probe.anim} rainbow ${probe.rainbow}` });
    toast(`Probe: animation ${probe.anim} (${ANIM_UNVERIFIED[probe.anim] ?? "?"}), rainbow ${probe.rainbow}`);
  }

  /** Render the current scene's loop as GIF frames (full per-pixel colour, not chunk-quantized). */
  function sceneGif() {
    const scene = engine.scene;
    const plan = scenes.plan(scene);
    if (plan.mode === "scroll") throw new Error("Scrolling text is already animated by the panel");
    const step = plan.animated ? Math.max(250, plan.stepMs) : 0;
    const count = plan.animated ? 16 : 1;
    const frames = [];
    for (let i = 0; i < count; i++) frames.push(scenes.render(scene, i * step, { poster: !plan.animated }));
    for (let n = frames.length; n >= 1; n = Math.floor(n / 2)) {
      const gif = encodeGif(frames.slice(0, n), { delayMs: step || 500 });
      if (gif.length <= GIF_MAX_BYTES) return { gif, frames: n };
    }
    throw new Error("Scene is too large for one GIF upload");
  }

  function uploadGif() {
    fb.tap();
    let out;
    try {
      out = sceneGif();
    } catch (e) {
      return toast(e.message);
    }
    $("gifHint").textContent = `“${describeScene(engine.scene)}” → ${out.frames} frame${out.frames === 1 ? "" : "s"}, ${out.gif.length} bytes.`;
    if (!needPanel()) return;
    panel.uploadGif(out.gif);
    toast(`Uploading GIF (${out.gif.length} B)…`);
  }

  function exportBackup() {
    fb.tap();
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `nightfury-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Backup downloaded");
  }

  async function importBackup(file) {
    try {
      const res = store.importAll(JSON.parse(await file.text()));
      toast(`Imported ${res.items} item${res.items === 1 ? "" : "s"}, ${res.shows} show${res.shows === 1 ? "" : "s"}${res.settings ? " and settings" : ""}`);
      ctx.syncSettings?.();
      syncOptions();
      bus.emit("settings", "all");
      bus.emit("library");
      bus.emit("shows");
    } catch (e) {
      toast(e instanceof SyntaxError ? "That file is not valid JSON" : e.message);
    }
  }

  function syncOptions() {
    markSeg($("colorModeSeg"), S.multiColor ? "multi" : "single");
    markSeg($("motionSeg"), S.motion);
    markSeg($("bitOrderSeg"), S.lsbFirst ? "lsb" : "msb");
    markSeg($("chunkSeg"), S.chunkSize);
  }

  // ------------------------------------------------------------------ bindings

  bindSeg($("colorModeSeg"), (v) => { fb.tap(); store.set({ multiColor: v === "multi" }); log(`Colour mode → ${v}`, "info"); });
  bindSeg($("motionSeg"), (v) => { fb.tap(); store.set({ motion: v }); log(`Panel animation → ${v}`, "info"); });
  bindSeg($("bitOrderSeg"), (v) => { fb.tap(); store.set({ lsbFirst: v === "lsb" }); log(`Bit order → ${v.toUpperCase()}`, "info"); });
  bindSeg($("chunkSeg"), (v) => { fb.tap(); store.set({ chunkSize: Number(v) }); log(`Write size → ${v} bytes`, "info"); });
  $("pairAllBtn").addEventListener("click", () => ctx.connect({ acceptAll: true }));
  document.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => { fb.tap(); if (needPanel()) CMDS[b.dataset.cmd](); }));
  document.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => TESTS[b.dataset.test]?.()));

  $("simToggle").addEventListener("change", (e) => { sim.on = e.target.checked; applySim(); });
  $("simSpeed").addEventListener("input", (e) => {
    sim.kmh = parseInt(e.target.value, 10);
    sim.on = true;
    $("simSpeedVal").textContent = sim.kmh;
    paintRange(e.target);
    applySim();
  });
  bindSeg($("simTurn"), (v) => { fb.tap(); sim.turn = v; sim.on = true; applySim(); });
  $("simBrake").addEventListener("click", () => { fb.tap(); sim.brake = !sim.brake; sim.on = true; applySim(); });
  bus.on("demo", (on) => { if (on && sim.on) { sim.on = false; applySim(); } });

  const stepper = (down, up, out, key, min, max) => {
    const set = (v) => { probe[key] = Math.max(min, Math.min(max, v)); $(out).textContent = probe[key]; };
    $(down).addEventListener("click", () => { fb.tap(); set(probe[key] - 1); });
    $(up).addEventListener("click", () => { fb.tap(); set(probe[key] + 1); });
  };
  stepper("probeDown", "probeUp", "probeVal", "anim", 0, 8);
  stepper("rainbowDown", "rainbowUp", "rainbowVal", "rainbow", 0, 9);
  $("probeSend").addEventListener("click", sendProbe);
  $("gifBtn").addEventListener("click", uploadGif);

  const presets = [
    ["Power on", "05 00 07 01 01"],
    ["Power off", "05 00 07 01 00"],
    ["Bright 100%", "05 00 04 80 64"],
    ["Clock", () => toHex(clockModePacket())],
    ["DIY mode", "05 00 04 01 01"],
    ["Ping", "04 00 05 80"],
    ["Wipe memory", "04 00 03 80"],
    ["Show slot 1", "07 00 08 80 01 00 01"],
  ];
  $("hexPresets").append(...presets.map(([label, hex]) => h("button", {
    class: "btn btn-small",
    onclick: () => { $("hexInput").value = typeof hex === "function" ? hex() : hex; sendHex(); },
  }, label)));
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
  $("exportBtn").addEventListener("click", exportBackup);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) importBackup(file);
  });

  markSeg($("simTurn"), sim.turn);
  paintRange($("simSpeed"));
  syncOptions();

  // ------------------------------------------------------------------ panel memory

  function renderMemory() {
    const { memory } = ctx;
    const keep = memory.keep;
    const list = memory.records.slice().sort((a, b) => a.slot - b.slot);
    $("memoryInfo").textContent = keep ? `${list.length} of ${keep} saved` : "Off";
    $("memoryList").replaceChildren(...list.map((r) => h("div", { class: "show-item", dataset: { slot: r.slot } },
      r.scene ? ctx.thumb(r.scene, "") : h("canvas", {}),
      h("span", { class: "name tamil" }, r.label || "Message"),
      h("span", { class: "ctl" }, h("span", { class: "secs" }, `Slot ${r.slot}`)))));
    if (!list.length) $("memoryList").append(h("p", { class: "hint" }, keep ? "Nothing saved yet. Send a message while the panel is connected." : "Turn on Settings › Keep on the panel."));
    ctx.thumbs.sweep();
  }

  $("memoryClearBtn").addEventListener("click", () => {
    fb.tap();
    ctx.confirm("Clear panel memory", "Delete every message this app saved in the panel? It will no longer show them after a restart.", "Clear", async () => {
      const sent = await ctx.memory.clear();
      renderMemory();
      toast(sent ? "Panel memory cleared" : "Cleared here; the panel is emptied when it next connects");
    });
  });
  $("memoryPlayBtn").addEventListener("click", async () => {
    fb.tap();
    if (!needPanel()) return;
    const last = ctx.memory.latest();
    if (!last) return toast("Nothing saved on the panel yet");
    // Leave DIY (live) mode, ask for the newest slot, then let go of the panel.
    await panel.diy(false);
    await panel.showSlot(last.slot);
    await panel.queue.idle();
    panel.stopHeartbeat();
    transport.disconnect();
    toast("Disconnected: the panel is on its own now");
  });
  bus.on("memory", renderMemory);
  bus.on("settings", (key) => { if (key === "panelKeep" || key === "all") renderMemory(); });
  bus.on("tab", (t) => { if (t === "lab") renderMemory(); });
  renderMemory();

  ctx.sceneGif = sceneGif;
  return {
    render() {
      if (ctx.state.tab !== "lab") return;
      const q = panel.queue.stats;
      $("txStats").textContent = transport.bytesSent
        ? `${(transport.bytesSent / 1024).toFixed(1)} KB in ${transport.writes} writes · ${panel.framesSent} frames · ${q.superseded} replaced before sending`
        : "Nothing sent yet";
    },
  };
}
