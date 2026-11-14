// End-to-end tests: real Chrome (headless), real app, mocked Bluetooth panel, mocked
// GPS and synthetic DeviceMotion events. Every packet the app writes is reassembled,
// CRC-checked and decoded, and frames are compared pixel-for-pixel and colour-for-
// colour against the pure modules.
//   node tests/e2e/run.mjs [--headed] [--only=name]
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { serve } from "../../scripts/serve.mjs";
import { createMockBluetooth } from "../mock-bluetooth.mjs";
import { CMD, chunksToBitmap, decodePacket, rgbToHex, splitPackets } from "../../js/protocol.js";
import { Frame, quantize } from "../../js/frame.js";
import { FRAME_MS, brakeFrame, gridFrame, speedHud, turnFrame } from "../../js/graphics.js";
import { layoutText, pixelOnlyRasterizer } from "../../js/text.js";

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
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err.stack || err).split("\n").slice(0, 4).join("\n      ")}`);
    try { writeFileSync(`${ART}FAIL-${name.replace(/\W+/g, "_")}.png`, await page.screenshot()); } catch { /* ignore */ }
    // Leave the app usable for the next step: close sheets, restore the phone viewport.
    try {
      await page.eval(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    } catch { /* ignore */ }
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writes = () => page.eval("window.__mock.log.writes.map((w) => w.bytes)");

/** Complete packets written after packet index `from` (the whole stream is parsed, so write boundaries never matter). */
async function packetsSince(from = 0) {
  const w = await writes();
  const { packets } = splitPackets(Uint8Array.from(w.flat()));
  return { packets: packets.slice(from).map(decodePacket), count: packets.length };
}

/** Decoded text packet -> colour Frame, exactly as the panel would light it. */
function frameOf(pkt) {
  const mask = chunksToBitmap(pkt.chunks);
  const f = new Frame(mask.width, 16);
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) f.px[i] = f.ink(rgbToHex(pkt.colors[Math.floor((i % mask.width) / 8)]));
  return f;
}

async function waitPacket(from, pred, label, timeout = 5000) {
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

const isFrame = (p) => p.cmd === CMD.TEXT && p.anim === 0 && p.chunks.length === 12 && p.crcOk;
const frameIs = (expected) => (p) => isFrame(p) && frameOf(p).equals(quantize(expected));
/** Packet index to measure "new packets" from. Waits for any in-flight packet to finish first. */
async function mark() {
  await page.waitFor("NF.panel.queue.busy === false", { label: "queue idle" });
  return (await packetsSince(0)).count;
}

async function setRange(id, value) {
  await page.eval(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${value}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
}
const tab = (name) => page.click(`.tab[data-tab="${name}"]`);
const shot = async (name) => writeFileSync(`${ART}${name}.png`, await page.screenshot());
const expireHold = () => page.eval("NF.engine.user && (NF.engine.user.at = -1e9), true");
const sceneNow = () => page.eval("JSON.parse(JSON.stringify(NF.scene))");
const text = (id) => page.eval(`document.getElementById(${JSON.stringify(id)}).textContent`);
const simOff = () => page.eval("(() => { NF.engine.sim = null; const t = document.getElementById('simToggle'); if (t.checked) t.click(); })()");

// ------------------------------------------------------------------ run
const srv = await serve();
const base = `http://127.0.0.1:${srv.port}/`;
const browser = await launch({ headless: !args.includes("--headed") });
console.log(`NightFury v4 e2e → ${base}`);

try {
  page = await browser.newPage();
  await page.init({ width: 390, height: 844, mobile: true, scale: 2 });
  await page.addInitScript(INIT);
  await page.goto(base);
  await page.waitFor("!!window.NF && !!NF.scene", { label: "app boot" });

  await step("boot: build stamp, welcome sheet, preview renders, worker ticker, no errors", async () => {
    const build = await page.eval("NF.build");
    assert(readFileSync(`${ROOT}js/version.js`, "utf8").includes(build.hash), `build hash ${build.hash} not in version.js`);
    assert(await page.eval("document.getElementById('welcome').open"), "welcome sheet shown on first run");
    await sleep(350);
    await shot("00-welcome");
    await page.click("#welcomeSkip");
    assert(!(await page.eval("document.getElementById('welcome').open")), "welcome closes");
    eq(await page.eval("NF.ticker.kind"), "worker", "engine ticker");
    const lit = await page.eval(`(() => {
      const c = document.getElementById("matrix"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++; return n; })()`);
    assert(lit > 200, `preview looks empty (${lit} bright pixels)`);
    eq((await sceneNow()).kind, "eyes", "base scene");
    assert(page.errors.length === 0, `page errors: ${page.errors.join(" | ")}`);
    await shot("01-drive");
  });

  await step("layout: no horizontal overflow on any tab at 320 / 390 / 430, stage stays compact", async () => {
    for (const name of ["library", "studio", "shows", "lab", "drive"]) {
      await tab(name);
      eq(await page.eval(`document.querySelector(".view.active")?.dataset.view`), name, "active view");
      if (name === "studio") await page.click('#studioSeg [data-v="pixel"]');
      for (const w of [320, 390, 430]) {
        await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
        await sleep(60);
        const over = await page.eval("document.documentElement.scrollWidth - window.innerWidth");
        assert(over <= 0, `${name}: horizontal overflow ${over}px at ${w}px wide`);
        const clipped = await page.eval(`[...document.querySelectorAll(".view.active .card")].filter((c) => [...c.querySelectorAll("button, .seg")].some((b) => b.getBoundingClientRect().right > c.getBoundingClientRect().right + 1 && !b.closest(".scroll-x, .px-frames, .chips"))).length`);
        assert(clipped === 0, `${name}: ${clipped} card(s) with controls sticking out at ${w}px`);
      }
      if (name === "studio") await page.click('#studioSeg [data-v="text"]');
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const stage = await page.eval(`document.getElementById("stage").getBoundingClientRect().height`);
    assert(stage < 240, `sticky stage should stay compact (${stage}px)`);
  });

  await step("connect: pairing, handshake bytes, first scene pushed in 20-byte writes", async () => {
    await page.click("#connectBtn");
    await page.waitFor("NF.panel.ready", { label: "panel ready" });
    eq(await text("connectLabel"), "LED_BLE_E1A2", "connect label");
    const first = await waitPacket(0, isFrame, "initial scene");
    const { packets } = await packetsSince(0);
    eq(packets.slice(0, 4).map((p) => p.cmd), [CMD.TIME, CMD.POWER, CMD.BRIGHTNESS, CMD.DIY], "handshake order");
    eq(packets[2].payload[0], 85, "handshake brightness");
    eq(first.rgb, [163, 230, 53], "living eyes are lime");
    assert((await writes()).every((b) => b.length <= 20), "all writes ≤ 20 B");
    await page.waitFor(`document.getElementById("syncTag").textContent === "LIVE"`, { label: "LIVE tag" });
  });

  await step("library: pixel-font item is frame-exact; Tamil item has colour + CRC; active card marked", async () => {
    await tab("library");
    await page.click('#libChips [data-group="road"]');
    let from = await mark();
    await page.click('#libGrid .item[data-id="road.thanks"] .hit');
    const want = layoutText({ text: "THANKS!", color: "#10b981", effect: "static", size: "big", paint: "solid" }, pixelOnlyRasterizer).frames[0];
    await waitPacket(from, frameIs(want), "THANKS! frame");
    assert(await page.eval(`document.querySelector('#libGrid .item[data-id="road.thanks"]').classList.contains("active")`), "active card");
    from = await mark();
    await page.click('#libGrid .item[data-id="road.thanks-ta"] .hit');
    const p = await waitPacket(from, (x) => x.cmd === CMD.TEXT && x.crcOk, "நன்றி packet");
    eq(p.rgb, [16, 185, 129], "green");
    assert(frameOf(p).litCount() > 20, "Tamil raster has pixels");
    await shot("02-library");
  });

  await step("library: word-by-word item streams one frame per word; search filters", async () => {
    const from = await mark();
    await page.click('#libGrid .item[data-id="road.distance"] .hit');
    const words = ["KEEP", "YOUR", "DISTANCE"].map((w) => layoutText({ text: w, color: "#ef4444", effect: "static" }, pixelOnlyRasterizer).frames[0]);
    for (const [i, w] of words.entries()) await waitPacket(from, frameIs(w), `word ${i + 1}`, 6000);
    await page.eval(`(() => { const s = document.getElementById("libSearch"); s.value = "sorry"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const n = await page.eval(`document.querySelectorAll("#libGrid .item").length`);
    assert(n >= 1 && n <= 3, `search results ${n}`);
    await page.eval(`(() => { const s = document.getElementById("libSearch"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  });

  await step("HUD: multi-colour speed frame is exact, rate-limited, and returns after a message hold", async () => {
    await tab("lab");
    await expireHold();
    let from = await mark();
    await setRange("simSpeed", 50);
    const p = await waitPacket(from, frameIs(speedHud(50, { frac: 50 / 120 })), "speed 50 frame");
    assert(new Set(p.colors.map(String)).size >= 3, `speed frame uses ${new Set(p.colors.map(String)).size} colours`);
    from = await mark();
    for (const v of [51, 52, 53, 54, 55, 56]) { await setRange("simSpeed", v); await sleep(40); }
    await waitPacket(from, frameIs(speedHud(56, { frac: 56 / 120 })), "latest speed frame");
    const n = (await packetsSince(from)).packets.filter(isFrame).length;
    assert(n <= 2, `speed frames should be rate limited (${n} sent)`);
    await page.waitFor(`document.getElementById("syncTag").textContent === "LIVE"`, { label: "LIVE tag" });
  });

  await step("signals: stalk button animates amber chevrons on the panel, second press cancels", async () => {
    await tab("drive");
    eq(await text("speedNum"), "56", "cluster speed");
    let from = await mark();
    await page.click("#sigRight");
    const p0 = await waitPacket(from, frameIs(turnFrame("right", 0)), "turn stage 0");
    eq(p0.rgb, [255, 144, 0], "amber");
    await waitPacket(from, frameIs(turnFrame("right", FRAME_MS)), "turn stage 1");
    await waitPacket(from, frameIs(turnFrame("right", 2 * FRAME_MS)), "turn stage 2");
    eq(await page.eval(`document.getElementById("sigRight").getAttribute("aria-pressed")`), "true", "pressed");
    await shot("03-signal");
    from = await mark();
    await page.click("#sigRight");
    await waitPacket(from, frameIs(speedHud(56, { frac: 56 / 120 })), "speed returns");
    eq((await sceneNow()).kind, "speed", "scene");
  });

  await step("brake: button shows the red slab at once and outranks a signal; hazard blinks", async () => {
    await page.click("#sigLeft");
    const from = await mark();
    await page.click("#brakeBtn");
    const p = await waitPacket(from, frameIs(brakeFrame(0)), "brake slab");
    eq(p.rgb, [255, 0, 0], "pure red");
    eq((await sceneNow()).kind, "brake", "scene");
    await page.eval("NF.engine.manualBrakeUntil = 0");
    await page.waitFor("NF.scene.kind === 'turn'", { label: "signal resumes after braking" });
    await page.click("#hazardBtn");
    await page.waitFor("NF.scene.kind === 'hazard'", { label: "hazard" });
    await page.click("#hazardBtn");
    await page.waitFor("NF.scene.kind === 'speed'", { label: "hazard off" });
  });

  await step("sensors: GPS speed drives the HUD and trip; gyro yaw shows a turn and cancels the stalk", async () => {
    await simOff();
    await page.click("#sensorsBtn");
    await page.waitFor("NF.sensors.active", { label: "sensors on" });
    for (let i = 0; i < 6; i++) { await page.eval(`__geo.emit({ speed: 20, heading: 90, lon: 80 + ${i} * 0.0002 })`); await sleep(120); }
    await page.waitFor("NF.scene.kind === 'speed' && Math.round(NF.scene.value) >= 60", { label: "GPS speed on HUD" });
    assert((await page.eval("NF.engine.trip.maxKmh")) >= 60, "trip saw the speed");
    await page.click("#sigLeft");
    for (let i = 0; i < 45; i++) { await page.eval(`__motion({ alpha: 30, beta: 0, gamma: 0 }); __geo.emit({ speed: 20, heading: 90 })`); await sleep(20); }
    await page.waitFor("NF.engine.tele.turn === 'left'", { label: "yaw detected" });
    for (let i = 0; i < 70; i++) { await page.eval(`__motion({ alpha: 0, beta: 0, gamma: 0 })`); await sleep(20); }
    await page.waitFor("NF.engine.stalk.active === null", { label: "stalk self-cancels after the turn" });
    await page.click("#sensorsBtn");
    await page.waitFor("!NF.sensors.active", { label: "sensors off" });
  });

  await step("modes: comedy plays set-up → punchline, skips to the next joke, yields to the HUD, stops", async () => {
    await tab("shows");
    await page.click('#modeLang [data-v="en"]');
    await page.click('.mode-row[data-mode="comedy"] .play');
    await page.waitFor("NF.engine.player.show?.id === 'mode.comedy'", { label: "comedy running" });
    const s = await sceneNow();
    eq(s.source, "show", "source");
    assert(/^[A-Z0-9 ?.,']+$/.test(s.text), `English set-up, got "${s.text}"`);
    assert(!(await page.eval("document.getElementById('nowPlaying').hidden")), "now playing shown");
    assert((await text("nowItem")).startsWith("1 of 10"), `now item "${await text("nowItem")}"`);
    await page.click("#nowNext");
    assert((await text("nowItem")).startsWith("2 of 10") || (await sleep(200), (await text("nowItem")).startsWith("2 of 10")), "next joke");
    const second = await sceneNow();
    assert(second.text !== s.text, "a different joke");
    await shot("04-modes");
    await page.eval("NF.engine.sim = { kmh: 40, turn: 'straight' }");
    await page.waitFor("NF.scene.kind === 'speed'", { label: "HUD wins while moving" });
    await page.eval("NF.engine.sim = null");
    await page.waitFor("NF.scene.source === 'show'", { label: "mode resumes when stopped" });
    await page.click("#nowStop");
    await page.waitFor("!NF.engine.player.playing", { label: "stopped" });
  });

  await step("modes: Thirukkural starts from the library, shows the title card then the couplet", async () => {
    await page.click('#modeLang [data-v="both"]');
    await tab("library");
    await page.click('#libChips [data-group="modes"]');
    eq(await page.eval(`document.querySelectorAll("#libGrid .item").length`), 5, "five modes");
    const from = await mark();
    await page.click('#libGrid .item[data-id="mode.kural"] .hit');
    await page.waitFor("NF.engine.player.show?.id === 'mode.kural'", { label: "kural running" });
    const s = await sceneNow();
    assert(/^குறள் \d+$/.test(s.text), `title card, got "${s.text}"`);
    eq(await page.eval("NF.engine.player.show.units"), 52, "couplets");
    await waitPacket(from, (p) => p.cmd === CMD.TEXT && p.crcOk && p.rgb.join() === "255,144,0", "amber title on the panel");
    await page.waitFor("!/^குறள்/.test(NF.scene.text)", { label: "first line follows", timeout: 6000 });
    assert(/[஀-௿]/.test((await sceneNow()).text), "Tamil line");
    await page.click('#libGrid .item[data-id="mode.kural"] .hit');
    await page.waitFor("!NF.engine.player.playing", { label: "second tap stops it" });
  });

  await step("modes: Friends and TVK play from the Shows tab; TVK goes out in red and yellow", async () => {
    await tab("shows");
    eq(await page.eval(`document.querySelectorAll("#modeList .mode-row").length`), 5, "mode rows");
    await page.click('#modeLang [data-v="en"]');
    await page.click('.mode-row[data-mode="friends"] .play');
    await page.waitFor("NF.engine.player.show?.id === 'mode.friends' && NF.scene.source === 'show'", { label: "friends running" });
    eq(await page.eval("NF.engine.player.show.units"), 10, "English friend lines");
    const from = await mark();
    await page.click('.mode-row[data-mode="tvk"] .play');
    await page.waitFor("NF.engine.player.show?.id === 'mode.tvk' && NF.scene.paint === 'duo'", { label: "TVK running" });
    const seen = new Set();
    for (let i = 0; i < 8 && seen.size < 2; i++) {
      const p = await waitPacket(from, (x) => x.cmd === CMD.TEXT && x.crcOk && x.colors.some((c) => c.join() === "255,26,26" || c.join() === "255,208,0"), "TVK packet", 8000);
      p.colors.forEach((c) => { if (c.join() === "255,26,26") seen.add("red"); if (c.join() === "255,208,0") seen.add("yellow"); });
      if (seen.size < 2) { await page.click("#nowNext"); await sleep(300); }
    }
    assert(seen.has("red"), "red on the panel");
    await shot("04b-tvk");
    await page.click("#nowStop");
    await page.click('#modeLang [data-v="both"]');
  });

  await step("studio text: live draft is preview-only, send is exact, save lands in Mine", async () => {
    await tab("studio");
    const from = await mark();
    await page.eval(`(() => { const i = document.getElementById("composeInput"); i.value = "HI V4"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.click('#effectSeg [data-v="static"]');
    await page.click('#paintSeg [data-v="rainbow"]');
    await page.waitFor(`document.getElementById("syncTag").textContent === "DRAFT"`, { label: "DRAFT tag" });
    await sleep(400);
    eq(await page.eval("NF.scene.text ?? NF.scene.kind") === "HI V4", false, "a draft never becomes the live scene");
    const before = (await packetsSince(0)).count;
    const draftSends = (await packetsSince(from)).packets.filter((p) => p.cmd === CMD.TEXT && frameIs(layoutText({ text: "HI V4", color: "#00d0ff", paint: "rainbow", effect: "static", size: "big" }, pixelOnlyRasterizer).frames[0])(p)).length;
    eq(draftSends, 0, "nothing sent for a draft");
    await shot("05-studio-text");
    await page.click("#sendMsgBtn");
    const want = layoutText({ text: "HI V4", color: "#00d0ff", paint: "rainbow", effect: "static", size: "big" }, pixelOnlyRasterizer).frames[0];
    const p = await waitPacket(before, frameIs(want), "rainbow frame");
    assert(new Set(p.colors.map(String)).size >= 4, "one hue per chunk");
    await page.click("#saveMsgBtn");
    eq(await page.eval("NF.store.items.length"), 1, "saved items");
    eq(await page.eval("NF.store.items[0].paint"), "rainbow", "saved paint");
    await page.click('#paintSeg [data-v="solid"]');
  });

  await step("pixel studio: drawing with the pointer, stamp, undo, send is frame-exact", async () => {
    await page.click('#studioSeg [data-v="pixel"]');
    const box = await page.eval(`(() => { const r = document.getElementById("pxCanvas").getBoundingClientRect(); document.getElementById("pxCanvas").scrollIntoView({ block: "center" }); const q = document.getElementById("pxCanvas").getBoundingClientRect(); return { x: q.left, y: q.top, cell: q.width / 96 }; })()`);
    const at = (cx, cy) => ({ x: box.x + (cx + 0.5) * box.cell, y: box.y + (cy + 0.5) * box.cell });
    const a = at(10, 3), b = at(30, 3);
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y, button: "left", buttons: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
    const row = await page.eval(`(() => { const f = NF.ctx.pixelEditor.frames[0]; let n = 0; for (let x = 0; x < 96; x++) if (f.get(x, 3)) n++; return [n, f.get(10, 3), f.get(9, 3)]; })()`);
    eq(row, [21, "#ff0000", null], "a 21-pixel red line");
    await page.click('[data-px="stamp"]');
    await page.click("#sheetContent .stamps button");
    const lit = await page.eval("NF.ctx.pixelEditor.frames[0].litCount()");
    assert(lit > 60, `stamp added pixels (${lit})`);
    await page.click("#pxUndo");
    eq(await page.eval("NF.ctx.pixelEditor.frames[0].litCount()"), 21, "undo removes the stamp");
    await page.click("#pxRedo");
    await shot("06-studio-pixel");
    const from = await mark();
    await page.click("#pxSendBtn");
    const sent = await waitPacket(from, isFrame, "art frame");
    const same = await page.eval(`(() => { const f = NF.ctx.pixelEditor.frames[0]; let s = ""; for (let i = 0; i < f.px.length; i++) s += f.px[i] ? "1" : "0"; return s; })()`);
    const got = frameOf(sent);
    let mask = "";
    for (let i = 0; i < got.px.length; i++) mask += got.px[i] ? "1" : "0";
    assert(mask === same, "panel frame matches the editor pixel for pixel");
    await page.eval(`(() => { const i = document.getElementById("pxName"); i.value = "My heart"; })()`);
    await page.click("#pxSaveBtn");
    eq(await page.eval("NF.store.items.map((i) => i.kind)"), ["art", "text"], "saved art");
  });

  await step("shows: a built-in show plays as idle content and a tapped message interrupts it", async () => {
    await tab("shows");
    await page.click('.show[data-show="show.colour"] .play');
    await page.waitFor("NF.scene.source === 'show' && NF.scene.kind === 'fx'", { label: "show playing" });
    assert(await page.eval(`!!document.querySelector('.tab[data-tab="shows"] .badge')`), "tab badge");
    await tab("drive");
    await page.click("#deck .item");
    await page.waitFor("NF.scene.source === 'user'", { label: "message interrupts" });
    await page.waitFor("!document.getElementById('holdBar').hidden", { label: "hold bar counts down" });
    await expireHold();
    await page.waitFor("NF.scene.source === 'show'", { label: "show resumes" });
    await tab("shows");
    await page.click('.show[data-show="show.colour"] .play');
    await page.waitFor("!NF.engine.player.playing", { label: "stopped" });
  });

  await step("lab: test card is exact, MSB flips the bits, single-colour mode collapses colours", async () => {
    await tab("lab");
    let from = await mark();
    await page.click('[data-test="grid"]');
    await waitPacket(from, frameIs(gridFrame()), "grid card");
    from = await mark();
    await page.click('#bitOrderSeg [data-v="msb"]');
    const flipped = await waitPacket(from, isFrame, "re-sent after bit order change");
    const lsb = quantize(gridFrame());
    const mirrored = new Frame();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 96; x++) mirrored.set(x, y, lsb.get(Math.floor(x / 8) * 8 + 7 - (x % 8), y));
    assert(frameOf(flipped).mask().equals(mirrored.mask()), "MSB order mirrors every 8-pixel block");
    await page.click('#bitOrderSeg [data-v="lsb"]');
    from = await mark();
    await page.click('[data-test="bars"]');
    const bars = await waitPacket(from, isFrame, "colour bars");
    eq(new Set(bars.colors.map(String)).size, 12, "twelve colours");
    from = await mark();
    await page.click('#colorModeSeg [data-v="single"]');
    const mono = await waitPacket(from, isFrame, "single-colour re-send");
    eq(new Set(mono.colors.map(String)).size, 1, "one colour");
    await page.click('#colorModeSeg [data-v="multi"]');
    await shot("07-lab");
  });

  await step("lab: hex send, brightness coalescing, GIF upload packet", async () => {
    let from = await mark();
    await page.click("#hexSendBtn");
    const hex = await waitPacket(from, (p) => p.cmd === CMD.POWER, "raw power packet");
    eq([...hex.payload], [1], "payload");
    from = await mark();
    for (const v of [20, 30, 40, 50, 60]) { await setRange("brightness", v); await sleep(15); }
    const b = await waitPacket(from, (p) => p.cmd === CMD.BRIGHTNESS, "brightness");
    eq(b.payload[0], 60, "latest brightness");
    await sleep(300);
    eq((await packetsSince(from)).packets.filter((p) => p.cmd === CMD.BRIGHTNESS).length, 1, "one brightness packet");
    from = await mark();
    await page.click("#gifBtn");
    const gif = await waitPacket(from, (p) => p.cmd === CMD.GIF, "GIF packet", 15000);
    assert(gif.crcOk && gif.lengthOk, "GIF CRC");
    eq(String.fromCharCode(...gif.data.slice(0, 6)), "GIF89a", "GIF header");
    await setRange("brightness", 85);
  });

  await step("link: a drop reconnects, re-handshakes and re-sends the scene; user disconnect stays off", async () => {
    await page.waitFor("NF.panel.queue.busy === false", { label: "idle", timeout: 20000 });
    const from = (await packetsSince(0)).count;
    await page.eval("__mock.drop()");
    await page.waitFor("NF.panel.ready", { label: "ready again", timeout: 8000 });
    const again = await waitPacket(from, isFrame, "scene re-sent");
    assert(again.crcOk, "CRC");
    const cmds = (await packetsSince(from)).packets.map((p) => p.cmd);
    eq(cmds.slice(0, 4), [CMD.TIME, CMD.POWER, CMD.BRIGHTNESS, CMD.DIY], "handshake after reconnect");
    await page.click("#connectBtn");
    await page.waitFor("!NF.transport.connected", { label: "disconnected" });
    await page.waitFor(`document.getElementById("syncTag").textContent === "PREVIEW"`, { label: "PREVIEW tag" });
    await sleep(200);
    eq(await page.eval("__mock.log.connects"), 2, "no auto-reconnect after a user disconnect");
  });

  await step("drive mode: portrait and landscape fit the screen; buttons act", async () => {
    await tab("drive");
    await page.eval("NF.engine.sim = { kmh: 72, turn: 'straight' }");
    await page.click("#driveModeBtn");
    await page.waitFor("!document.getElementById('driveMode').hidden", { label: "cockpit open" });
    await page.waitFor(`document.getElementById("ckSpeed").textContent === "72"`, { label: "cockpit speed" });
    eq(await page.eval(`document.querySelectorAll("#ckDeck button").length`), 6, "deck buttons");
    await page.click("#ckLeft");
    await page.waitFor("NF.scene.kind === 'turn'", { label: "signal from cockpit" });
    await page.click("#ckLeft");
    await sleep(250);
    await shot("08-drive-mode");
    for (const [w, hgt] of [[390, 844], [844, 390], [667, 375]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 2, mobile: true });
      await sleep(120);
      const fit = await page.eval(`(() => { const c = document.getElementById("driveMode"); const out = [...c.querySelectorAll("button, canvas, .ck-speed")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1; }).length; return out; })()`);
      assert(fit === 0, `${fit} cockpit element(s) off-screen at ${w}×${hgt}`);
      if (w > hgt && w === 844) await shot("09-drive-mode-landscape");
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.click("#ckExit");
    await page.eval("NF.engine.sim = null");
  });

  await step("settings: units, speed alert and HUD mode apply and persist across a reload", async () => {
    await page.click("#settingsBtn");
    await page.click('#settings [data-setting="unit"] [data-v="mph"]');
    await page.eval(`(() => { const i = document.getElementById("limitInput"); i.value = "50"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(250);
    await shot("10-settings");
    await page.eval("document.getElementById('settings').close()");
    await page.click('#hudSeg [data-v="signals"]');
    eq(await page.eval("[NF.store.settings.unit, NF.store.settings.limitKmh, NF.store.settings.hud]"), ["mph", 80, "signals"], "settings");
    await page.reload();
    await page.waitFor("!!window.NF && !!NF.scene", { label: "reboot" });
    assert(!(await page.eval("document.getElementById('welcome').open")), "welcome not shown again");
    eq(await page.eval("[NF.store.settings.unit, NF.store.settings.limitKmh, NF.store.settings.hud]"), ["mph", 80, "signals"], "settings after reload");
    eq(await page.eval("NF.store.items.length"), 2, "saved items after reload");
    eq(await text("speedUnit"), "mph", "unit label");
    await tab("library");
    await page.click('#libChips [data-group="mine"]');
    eq(await page.eval(`document.querySelectorAll("#libGrid .item").length`), 2, "Mine shows saved items");
  });

  await step("v3 migration: saved messages and settings are imported on first run", async () => {
    await page.eval(`(() => {
      localStorage.clear();
      localStorage.setItem("nightfury.v3.settings", JSON.stringify({ brightness: 55, autoHud: false, unit: "mph" }));
      localStorage.setItem("nightfury.v3.custom", JSON.stringify([{ text: "FROM V3", color: "#ff0000", style: "static", speed: 5 }]));
    })()`);
    await page.reload();
    await page.waitFor("!!window.NF && !!NF.scene", { label: "reboot" });
    eq(await page.eval("[NF.store.items.length, NF.store.items[0]?.text, NF.store.settings.brightness, NF.store.settings.hud]"), [1, "FROM V3", 55, "off"], "migrated");
    assert((await text("welcomeNote")).includes("Imported 1 saved message"), "welcome mentions the import");
    await page.click("#welcomeSkip");
  });

  await step("desktop: wide layout has no overflow and keyboard shortcuts work", async () => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(150);
    eq(await page.eval("document.documentElement.scrollWidth - window.innerWidth <= 0"), true, "no overflow");
    const key = (k) => page.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: k === "ArrowLeft" ? 37 : k.toUpperCase().charCodeAt(0) });
    await key("ArrowLeft");
    await page.waitFor("NF.engine.stalk.active === 'left'", { label: "← signals left" });
    await key("ArrowLeft");
    await key("b");
    await page.waitFor("NF.scene.kind === 'brake'", { label: "B brakes" });
    await page.eval("NF.engine.manualBrakeUntil = 0");
    await key("1");
    await page.waitFor("NF.scene.source === 'user'", { label: "1 sends the first pinned item" });
    await shot("11-desktop");
  });

  await step("no console errors or uncaught exceptions during the whole run", async () => {
    const errs = [...page.errors, ...page.console.filter((c) => c.type === "error").map((c) => c.text)];
    assert(errs.length === 0, `errors:\n      ${errs.join("\n      ")}`);
  });
} finally {
  await browser.close();
  srv.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed${failed.length ? ` · FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
