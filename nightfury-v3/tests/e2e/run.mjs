// End-to-end tests: real Chrome (headless), real app, mocked Bluetooth panel,
// mocked GPS and synthetic DeviceMotion events. Every packet the app writes is
// reassembled, CRC-checked and decoded, and graphics are compared pixel-for-pixel
// against the pure modules.
//   node tests/e2e/run.mjs [--headed] [--only=name]
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { serve } from "../../scripts/serve.mjs";
import { createMockBluetooth } from "../mock-bluetooth.mjs";
import { CMD, chunksToBitmap, decodePacket, hexToRgb, splitPackets } from "../../js/protocol.js";
import { Bitmap } from "../../js/bitmap.js";
import { brakeFrame, centered, devilEyes, speedHud, turnArrows } from "../../js/graphics.js";
import { pixelRaster } from "../../js/textraster.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ART = `${ROOT}tests/e2e/artifacts/`;
mkdirSync(ART, { recursive: true });
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7);

const INIT = `
  window.__mock = (${createMockBluetooth.toString()})({});
  Object.defineProperty(navigator, "bluetooth", { value: window.__mock.bluetooth, configurable: true });
  const geo = {
    watchers: new Map(), n: 0,
    watchPosition(ok) { const id = ++this.n; this.watchers.set(id, ok); return id; },
    clearWatch(id) { this.watchers.delete(id); },
    getCurrentPosition(ok) { ok({ coords: { latitude: 13, longitude: 80, accuracy: 5, speed: 0, heading: null }, timestamp: Date.now() }); },
    emit(c) { for (const ok of this.watchers.values()) ok({ coords: { latitude: c.lat ?? 13, longitude: c.lon ?? 80, speed: c.speed ?? null, heading: c.heading ?? null, accuracy: c.accuracy ?? 5 }, timestamp: Date.now() }); },
  };
  Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true });
  window.__geo = geo;
  window.__motion = (rot, accG = { x: 0, y: 0, z: 9.81 }, acc = { x: 0, y: 0, z: 0 }) =>
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: acc, accelerationIncludingGravity: accG, rotationRate: rot, interval: 16 }));
`;

// ------------------------------------------------------------------ harness
const results = [];
let page;

async function step(name, fn) {
  if (only && !name.includes(only)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, err });
    console.log(`  ✗ ${name}\n      ${String(err.stack || err).split("\n").slice(0, 4).join("\n      ")}`);
    try { writeFileSync(`${ART}FAIL-${name.replace(/\W+/g, "_")}.png`, await page.screenshot()); } catch { /* ignore */ }
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writes() {
  return page.eval("window.__mock.log.writes.map((w) => w.bytes)");
}

/** Complete packets written after packet index `from` (the whole stream is parsed so chunk boundaries never matter). */
async function packetsSince(from = 0) {
  const w = await writes();
  const { packets, rest } = splitPackets(Uint8Array.from(w.flat()));
  return { packets: packets.slice(from).map(decodePacket), rest, count: packets.length };
}

const bmpOf = (pkt) => new Bitmap(pkt.chunks.length * 8, 16, chunksToBitmap(pkt.chunks).data);

async function waitPacket(from, pred, label, timeout = 4000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await packetsSince(from);
    const hit = last.packets.find(pred);
    if (hit) return hit;
    await sleep(50);
  }
  throw new Error(`No packet matching ${label}. Saw: ${last.packets.map((p) => `0x${p.cmd.toString(16)}${p.chunks ? `[${p.chunks.length}]` : ""}`).join(", ") || "none"}`);
}

const frameEquals = (expected) => (p) => p.cmd === CMD.TEXT && p.anim === 0 && p.chunks.length === 12 && bmpOf(p).equals(expected);
/** Packet index to measure "new packets" from. Waits for any in-flight packet to finish first. */
async function mark() {
  await page.waitFor("NF.panel.queue.busy === false", { label: "queue idle" });
  return (await packetsSince(0)).count;
}
const writeCount = async () => (await writes()).length;

async function setRange(id, value) {
  await page.eval(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${value}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
}

const shot = async (name) => writeFileSync(`${ART}${name}.png`, await page.screenshot());
const expireHold = () => page.eval("NF.state.user && (NF.state.user.at = -1e9), true");

// ------------------------------------------------------------------ run
const srv = await serve();
const base = `http://127.0.0.1:${srv.port}/`;
const browser = await launch({ headless: !args.includes("--headed") });
console.log(`NightFury v3 e2e → ${base}`);

try {
  page = await browser.newPage();
  await page.init({ width: 390, height: 844, mobile: true, scale: 2 });
  await page.addInitScript(INIT);
  await page.goto(base);
  await page.waitFor("!!window.NF && !!NF.scene", { label: "app boot" });

  await step("boot: build stamp, preview renders, no errors", async () => {
    const build = await page.eval("NF.build");
    const stamp = readFileSync(`${ROOT}js/version.js`, "utf8");
    assert(stamp.includes(build.hash), `build hash ${build.hash} not in version.js`);
    await sleep(300);
    const lit = await page.eval(`(() => {
      const c = document.getElementById("matrix"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++; return n; })()`);
    assert(lit > 200, `preview looks empty (${lit} bright pixels)`);
    assert(page.errors.length === 0, `page errors: ${page.errors.join(" | ")}`);
    await shot("01-drive");
  });

  await step("layout: no horizontal overflow, tab bar reachable, all tabs switch", async () => {
    for (const w of [320, 390, 430]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
      await sleep(80);
      const over = await page.eval("document.documentElement.scrollWidth - window.innerWidth");
      assert(over <= 0, `horizontal overflow ${over}px at ${w}px wide`);
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const sticky = await page.eval(`document.querySelector(".panel-card").getBoundingClientRect().height`);
    assert(sticky < 200, `sticky preview should stay compact (${sticky}px)`);
    assert(await page.eval(`document.getElementById("speedNum").classList.contains("nodata")`), "no-speed placeholder styled");
    const header = await page.eval(`(() => { const a = document.querySelector(".brand").getBoundingClientRect(), b = document.querySelector(".topbar-actions").getBoundingClientRect(); return b.left - a.right; })()`);
    assert(header >= 0, `header brand overlaps actions by ${-header}px`);
    for (const tab of ["messages", "eyes", "studio", "lab", "drive"]) {
      await page.click(`.tab[data-tab="${tab}"]`);
      const active = await page.eval(`document.querySelector(".view.active")?.dataset.view`);
      assert(active === tab, `tab ${tab} → view ${active}`);
    }
  });

  await step("connect: pairing + handshake bytes + initial scene pushed", async () => {
    await page.click("#connectBtn");
    await page.waitFor("NF.transport.connected", { label: "connected" });
    const label = await page.eval(`document.getElementById("connectLabel").textContent`);
    assert(label === "LED_BLE_E1A2", `connect label "${label}"`);
    const hs = await waitPacket(0, (p) => p.cmd === CMD.TEXT, "initial scene");
    const { packets } = await packetsSince(0);
    const cmds = packets.map((p) => p.cmd);
    assert(JSON.stringify(cmds.slice(0, 4)) === JSON.stringify([CMD.TIME, CMD.POWER, CMD.BRIGHTNESS, CMD.DIY]), `handshake order ${cmds.map((c) => c.toString(16))}`);
    assert(packets[2].payload[0] === 85, "handshake brightness 85");
    assert(hs.crcOk && hs.lengthOk, "initial scene CRC");
    const w = await writes();
    assert(w.every((b) => b.length <= 20), "all writes ≤ 20 B");
    assert((await page.eval(`document.getElementById("syncTag").textContent`)) !== "PREVIEW", "sync tag updated");
  });

  await step("messages: Tamil preset → colour + CRC; pixel-font preset → exact frame", async () => {
    await page.click('.tab[data-tab="messages"]');
    let from = await mark();
    await page.click('#presetGrid .preset[data-text="நன்றி 🙏"]');
    const p1 = await waitPacket(from, (p) => p.cmd === CMD.TEXT, "நன்றி packet");
    assert(p1.crcOk, "CRC");
    assert(JSON.stringify(p1.rgb) === JSON.stringify(hexToRgb("#10b981")), `rgb ${p1.rgb}`);
    assert(bmpOf(p1).litCount() > 20, "Tamil raster has pixels");
    from = await mark();
    await page.click('#presetGrid .preset[data-text="THANKS!"]');
    await waitPacket(from, frameEquals(centered(pixelRaster("THANKS!"))), "THANKS! frame");
    await shot("02-messages");
  });

  await step("messages: long static text falls back to native scroll", async () => {
    const from = await mark();
    await page.click('#presetGrid .preset[data-text="KEEP DISTANCE"]');
    const p = await waitPacket(from, (x) => x.cmd === CMD.TEXT && x.anim === 1, "scroll packet");
    assert(p.chunks.length > 12, `chunks ${p.chunks.length}`);
    assert(bmpOf(p).equals(new Bitmap(p.chunks.length * 8, 16, chunksToBitmap(p.chunks).data)), "decodes");
  });

  await step("board tabs: Meme board renders and Mine is empty", async () => {
    await page.click('#boardTabs [data-board="meme"]');
    const n = await page.eval("document.querySelectorAll('#presetGrid .preset').length");
    assert(n === 8, `meme presets ${n}`);
    await page.click('#boardTabs [data-board="mine"]');
    assert(await page.eval("!document.getElementById('mineEmpty').hidden"), "empty hint shown");
  });

  await step("eyes: angry eyes frame is pixel-exact and red", async () => {
    await page.click('.tab[data-tab="eyes"]');
    const from = await mark();
    await page.click("#eyesGrid .preset:nth-child(1)");
    const p = await waitPacket(from, frameEquals(devilEyes("angry", 0)), "angry eyes frame");
    assert(JSON.stringify(p.rgb) === JSON.stringify(hexToRgb("#ef4444")), "red");
    await shot("03-eyes");
  });

  await step("drive: simulated turn beats message; brake beats turn", async () => {
    await page.click('.tab[data-tab="drive"]');
    await page.click("#simCard summary");
    let from = await mark();
    await page.click('[data-sim-turn="left"]');
    await waitPacket(from, frameEquals(turnArrows("left", 0)), "left chevrons");
    assert(await page.eval(`document.getElementById("turnLeft").classList.contains("on")`), "left indicator lit");
    from = await mark();
    await page.click("#brakeBtn");
    const p = await waitPacket(from, frameEquals(brakeFrame()), "brake frame");
    assert(p.rgb[0] === 0xef, "brake is red");
    await page.click('[data-sim-turn="straight"]');
    await shot("04-brake");
  });

  await step("drive: speed HUD after hold window; exact frame; rate-limited updates", async () => {
    await sleep(3200); // manual brake hold
    await expireHold();
    let from = await mark();
    await setRange("simSpeed", 72);
    await waitPacket(from, frameEquals(speedHud(72, { unit: "KM/H", barMax: 140, over: false })), "72 km/h frame");
    from = await mark();
    for (let v = 80; v < 100; v += 2) { await setRange("simSpeed", v); await sleep(40); }
    await sleep(900);
    const { packets } = await packetsSince(from);
    const speedFrames = packets.filter((x) => x.cmd === CMD.TEXT);
    assert(speedFrames.length >= 1 && speedFrames.length <= 3, `speed frames in ~1.3s: ${speedFrames.length}`);
    const last = speedFrames.at(-1);
    assert(bmpOf(last).equals(speedHud(98, { unit: "KM/H", barMax: 140 })), "settles on the latest speed (98)");
  });

  await step("drive: speed limit alert turns HUD red with side rails", async () => {
    await page.eval("NF.store.set({ limitKmh: 90 }), true");
    await setRange("simSpeed", 110);
    const p = await waitPacket(0, (x) => x.cmd === CMD.TEXT && bmpOf(x).equals(speedHud(110, { unit: "KM/H", barMax: 140, over: true })), "over-limit frame");
    assert(p.rgb[0] === 0xef, "red when over limit");
    assert(await page.eval(`document.querySelector(".speed-num").classList.contains("over")`), "UI shows over");
    await page.eval("NF.store.set({ limitKmh: 0 }), true");
    await setRange("simSpeed", 0);
    await page.eval(`document.getElementById("simToggle").click()`);
  });

  await step("brightness: slider burst sends ≤ 2 packets ending at the final value", async () => {
    const from = await mark();
    for (let v = 20; v <= 100; v += 8) await setRange("brightness", v);
    await setRange("brightness", 64);
    await sleep(600);
    const { packets } = await packetsSince(from);
    const b = packets.filter((p) => p.cmd === CMD.BRIGHTNESS);
    assert(b.length >= 1 && b.length <= 2, `brightness packets ${b.length}`);
    assert(b.at(-1).payload[0] === 64, `final brightness ${b.at(-1).payload[0]}`);
  });

  await step("studio: compose, fit hint, save to Mine, send custom colour", async () => {
    await page.click('.tab[data-tab="studio"]');
    await page.eval(`(() => { const i = document.getElementById("composeInput"); i.value = "GO GO"; i.dispatchEvent(new Event("input")); })()`);
    const hint = await page.eval(`document.getElementById("fitHint").textContent`);
    assert(/Fits/.test(hint), `fit hint "${hint}"`);
    await page.click('#styleSeg [data-style="static"]');
    await page.click('#palette .swatch[data-color="#3b82f6"]');
    const from = await mark();
    await page.click("#sendMsgBtn");
    const p = await waitPacket(from, frameEquals(centered(pixelRaster("GO GO"))), "GO GO frame");
    assert(JSON.stringify(p.rgb) === JSON.stringify([0x3b, 0x82, 0xf6]), `rgb ${p.rgb}`);
    await page.click("#saveMsgBtn");
    await page.click('.tab[data-tab="messages"]');
    await page.click('#boardTabs [data-board="mine"]');
    const mine = await page.eval("[...document.querySelectorAll('#presetGrid .preset')].map((b) => b.dataset.text)");
    assert(mine.includes("GO GO"), `mine: ${mine}`);
    await shot("05-studio-mine");
  });

  await step("lab: hex send is byte-exact; invalid hex is rejected", async () => {
    await page.click('.tab[data-tab="lab"]');
    await mark();
    let from = await writeCount();
    await page.eval(`document.getElementById("hexInput").value = "05 00 07 01 00"`);
    await page.click("#hexSendBtn");
    await page.waitFor(`window.__mock.log.writes.length > ${from}`, { label: "hex write" });
    const w = await writes();
    assert(JSON.stringify(w.at(-1)) === JSON.stringify([5, 0, 7, 1, 0]), `hex write ${w.at(-1)}`);
    from = await writeCount();
    await page.eval(`document.getElementById("hexInput").value = "05 zz"`);
    await page.click("#hexSendBtn");
    await sleep(200);
    assert((await writeCount()) === from, "invalid hex must not write");
    assert(/Invalid/.test(await page.eval(`document.getElementById("toast").textContent`)), "error toast");
    const logText = await page.eval(`document.getElementById("console").textContent`);
    assert(/Handshake/.test(logText) && /Raw/.test(logText), "console shows traffic");
    await shot("06-lab");
  });

  await step("lab: bit order MSB mirrors every chunk", async () => {
    await page.eval(`(() => { const s = document.getElementById("bitOrderSel"); s.value = "msb"; s.dispatchEvent(new Event("change")); })()`);
    await page.click('.tab[data-tab="eyes"]');
    const from = await mark();
    await page.click("#eyesGrid .preset:nth-child(3)");
    const p = await waitPacket(from, (x) => x.cmd === CMD.TEXT && x.anim === 0, "msb frame");
    const decoded = new Bitmap(96, 16, chunksToBitmap(p.chunks, { lsbFirst: false }).data);
    assert(decoded.equals(devilEyes("cylon", 0)), "MSB-decoded frame matches");
    await page.eval(`(() => { const s = document.getElementById("bitOrderSel"); s.value = "lsb"; s.dispatchEvent(new Event("change")); })()`);
  });

  await step("live animation: streams distinct eye frames when enabled, stops when disabled", async () => {
    await page.eval("NF.store.set({ liveAnimation: true }), true");
    const from = await mark();
    await page.click("#eyesGrid .preset:nth-child(3)"); // cylon scanner moves every frame
    await sleep(1800);
    const { packets } = await packetsSince(from);
    const frames = packets.filter((p) => p.cmd === CMD.TEXT && p.anim === 0).map((p) => bmpOf(p).key());
    assert(new Set(frames).size >= 3, `distinct streamed frames: ${new Set(frames).size}`);
    const w = await writes();
    assert(w.every((b) => b.length <= 20), "stream respects 20 B writes");
    await page.eval("NF.store.set({ liveAnimation: false }), true");
    await sleep(400);
    const stopAt = await mark();
    await sleep(900);
    assert((await packetsSince(stopAt)).packets.length === 0, "no frames after disabling");
  });

  await step("reconnect: dropped panel reconnects, re-handshakes and re-pushes the scene", async () => {
    const from = await mark();
    await page.eval("window.__mock.drop()");
    await page.waitFor(`document.getElementById("connectBtn").dataset.state === "reconnecting"`, { label: "reconnecting state" });
    await page.waitFor("NF.transport.connected", { timeout: 6000, label: "reconnected" });
    await waitPacket(from, (p) => p.cmd === CMD.TIME, "time sync after reconnect");
    await waitPacket(from, (p) => p.cmd === CMD.TEXT, "scene after reconnect");
  });

  await step("disconnect: user disconnect stops traffic and does not reconnect", async () => {
    await page.click("#connectBtn");
    await page.waitFor(`document.getElementById("connectBtn").dataset.state === "disconnected"`, { label: "disconnected" });
    const from = await writeCount();
    await page.click('.tab[data-tab="eyes"]');
    await page.click("#eyesGrid .preset:nth-child(2)");
    await sleep(1500);
    assert((await writeCount()) === from, "no writes after disconnect");
    assert((await page.eval(`document.getElementById("syncTag").textContent`)) === "PREVIEW", "back to preview");
  });

  await step("settings: sheet opens, choices persist across reload", async () => {
    await page.click("#settingsBtn");
    assert(await page.eval(`document.getElementById("settings").open`), "sheet open");
    await page.click('#settings [data-setting="unit"] [data-v="mph"]');
    await page.click('#settings [data-setting="holdKey"] [data-v="5s"]');
    await shot("07-settings");
    await page.eval(`document.getElementById("settings").close()`);
    await page.reload();
    await page.waitFor("!!window.NF && !!NF.scene", { label: "reboot" });
    const s = await page.eval("({ unit: NF.store.settings.unit, hold: NF.store.settings.holdKey })");
    assert(s.unit === "mph" && s.hold === "5s", JSON.stringify(s));
    assert((await page.eval(`document.getElementById("speedUnit").textContent`)) === "mph", "unit label");
  });

  await step("sensors: GPS speed + gyro turn + decel brake drive the HUD", async () => {
    await page.click("#sensorsBtn");
    await page.waitFor(`document.getElementById("sensorsBtn").classList.contains("on") || window.__geo.watchers.size > 0`, { label: "sensors on" });
    for (let i = 0; i < 3; i++) { await page.eval("window.__geo.emit({ speed: 20, heading: 90 })"); await sleep(120); }
    await page.waitFor(`document.getElementById("speedNum").textContent === "45"`, { label: "72 km/h shown as 45 mph", timeout: 3000 });
    await page.eval("NF.state.user = null, true");
    await page.waitFor(`NF.scene.kind === "speed"`, { label: "speed scene" });
    // Sustained left yaw of 30°/s, phone lying flat.
    await page.eval(`new Promise((r) => { let n = 0; const t = setInterval(() => { window.__motion({ alpha: 30, beta: 0, gamma: 0 }); if (++n > 20) { clearInterval(t); r(); } }, 40); })`);
    assert(await page.eval(`NF.scene.kind === "turn" && NF.scene.dir === "left"`), `scene ${await page.eval("JSON.stringify(NF.scene)")}`);
    assert(await page.eval(`document.getElementById("turnLeft").classList.contains("on")`), "left indicator");
    // Straighten out, then brake hard (0.6 g along x).
    await page.eval(`new Promise((r) => { let n = 0; const t = setInterval(() => { window.__motion({ alpha: 0, beta: 0, gamma: 0 }); if (++n > 30) { clearInterval(t); r(); } }, 40); })`);
    assert(await page.eval(`NF.scene.kind === "speed"`), "back to speed after turn");
    await page.eval(`new Promise((r) => { let n = 0; const t = setInterval(() => { window.__motion({ alpha: 0, beta: 0, gamma: 0 }, { x: 5.9, y: 0, z: 9.81 }, { x: 5.9, y: 0, z: 0 }); if (++n > 12) { clearInterval(t); r(); } }, 40); })`);
    assert(await page.eval(`NF.scene.kind === "brake"`), `brake scene, got ${await page.eval("NF.scene.kind")}`);
    const stat = await page.eval(`document.getElementById("statG").textContent`);
    assert(/0\.[5-6]\d g/.test(stat), `g-force stat "${stat}"`);
    await shot("08-sensors");
  });

  await step("drive mode: fullscreen overlay with large controls", async () => {
    await page.click('.tab[data-tab="drive"]');
    await page.click("#driveModeBtn");
    assert(await page.eval(`!document.getElementById("driveMode").hidden`), "overlay visible");
    const sizes = await page.eval(`[...document.querySelectorAll("#dmButtons button")].map((b) => b.getBoundingClientRect().height)`);
    assert(sizes.length === 5 && sizes.every((h) => h >= 60), `button heights ${sizes}`);
    await shot("09-drive-mode");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await sleep(150);
    await shot("10-drive-mode-landscape");
    const overflow = await page.eval(`(() => { const r = [...document.querySelectorAll("#dmButtons button")].map((b) => b.getBoundingClientRect()); return r.some((x) => x.bottom > innerHeight + 1 || x.right > innerWidth + 1); })()`);
    assert(!overflow, "landscape buttons fit the screen");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.click("#driveExit");
    assert(await page.eval(`document.getElementById("driveMode").hidden`), "overlay closed");
  });

  await step("cancelled pairing shows no error and opens one chooser", async () => {
    await page.eval("window.__mock.options.cancel = true; window.__mock.log.requests.length = 0; true");
    await page.click("#connectBtn");
    await sleep(300);
    assert((await page.eval("window.__mock.log.requests.length")) === 1, "single chooser");
    assert((await page.eval("NF.transport.state")) === "idle", "state idle");
    await page.eval("window.__mock.options.cancel = false; true");
  });

  await step("final: no uncaught errors or console errors", async () => {
    const ignorable = (t) => /fonts\.(googleapis|gstatic)\.com/.test(t);
    const errs = page.errors.filter((e) => !ignorable(e));
    const consoleErrs = page.console.filter((c) => c.type === "error" && !ignorable(c.text));
    assert(errs.length === 0, `errors: ${errs.join(" | ")}`);
    assert(consoleErrs.length === 0, `console errors: ${consoleErrs.map((c) => c.text).join(" | ")}`);
  });
} finally {
  await browser.close();
  srv.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed · screenshots in tests/e2e/artifacts/`);
process.exit(failed.length ? 1 : 0);
