// Mutation smoke test: proves the unit suite actually catches regressions.
// Each mutation plants a realistic bug into a temp copy of the sources; the unit
// tests must FAIL for every one of them.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const V3 = fileURLToPath(new URL("../../nightfury-v3/js", import.meta.url));

const MUTATIONS = [
  ["js/frame.js", "v |= lsbFirst ? 1 << bit : 1 << (7 - bit);", "v |= lsbFirst ? 1 << (7 - bit) : 1 << bit;", "bit order flipped"],
  ["js/frame.js", "colors.push(multi && best ? hexToRgb(frame.pal[best]) : rgb);", "colors.push(rgb);", "multi-colour silently off"],
  ["js/frame.js", "const ink = out.ink(multi ? frame.pal[best] : main);", "const ink = out.ink(main);", "preview no longer matches the panel"],
  ["js/protocol.js", "0xedb88320", "0xedb88321", "wrong CRC polynomial"],
  ["js/protocol.js", "pkt[14] = saveSlot & 0xff;", "pkt[14] = 1;", "save slot corrupts header"],
  ["js/protocol.js", "const c = colors?.[i] ?? rgb;", "const c = rgb;", "per-chunk colours dropped"],
  ["js/protocol.js", "* 70) + 30", "* 70) + 20", "scroll speed mapping drift"],
  ["js/text.js", "Math.max(MIN_FRAME_MS, Math.round(ms * pace))", "Math.max(MIN_FRAME_MS, Math.round(ms))", "message speed ignored by word-by-word and blink"],
  ["js/text.js", "s >= 6 ? 1 - (s - 6) * 0.1 : 1 + (6 - s) * 0.2", "s >= 6 ? 1 + (s - 6) * 0.1 : 1 - (6 - s) * 0.1", "speed slider works backwards"],
  ["js/scene.js", "clampSpeed(options().speed ?? scene?.speed)", "clampSpeed(scene?.speed)", "speed setting never reaches the scenes"],
  ["js/engine.js", "if (plan.mode === \"scroll\" || plan.animated) key += `|v${this.scenes.speed(scene)}`;", "", "speed change not sent to the panel"],
  ["js/modes.js", "(ms != null ? ms * pace : measure(scene))", "(ms ?? measure(scene))", "mode title cards ignore the speed"],
  ["js/graphics.js", "const order = dir === \"right\" ? i : 5 - i;", "const order = i;", "left signal fills the wrong way"],
  ["js/graphics.js", "f.paint(dBmp, over ? LED.red : color, 39 - dW, 1);", "f.paint(dBmp, over ? LED.red : color, 44 - dW, 1);", "speed digits bleed into the unit chunks"],
  ["js/eyes.js", "if (p < 200) return 0.08;", "if (p < 20) return 0.08;", "blink too short for the panel stream"],
  ["js/telemetry.js", "if (t - this.pendingSince >= this.enterMs) { this.state = dir;", "if (true) { this.state = dir;", "turns trigger on a single blip"],
  ["js/telemetry.js", "yawAbs < 20 && !speeding_up", "yawAbs < 200 && !speeding_up", "cornering g counted as braking"],
  ["js/director.js", "if (user && now - user.at < holdMs) return", "if (user) return", "v2 bug: speed HUD never returns"],
  ["js/director.js", "else if (this.sawTurn && sensorTurn === \"straight\") this.active = null;", "", "signal never self-cancels"],
  ["js/director.js", "if (hud !== \"full\" || !hasSpeed) return idle;", "if (!hasSpeed) return idle;", "Signals mode shows speed"],
  ["js/engine.js", "if (sameScene && now - this.hw.at < plan.minGapMs) return;", "", "no rate limit on speed frames"],
  ["js/engine.js", "if (sameScene && plan.animated && panel.queue.busy) return;", "", "animation frames pile up behind a slow link"],
  ["js/engine.js", "this.draft = scene ? { scene, at: now, key: sceneKey(scene) } : null;", "this.draft = null; if (scene) this.show(scene, now);", "drafts get sent to the panel"],
  ["js/queue.js", "if (idx >= 0) {", "if (false) {", "no coalescing (v2 backlog)"],
  ["js/ble.js", 'if (this.userDisconnect || this.state === "reconnecting") return;', "return;", "no auto-reconnect"],
  ["js/ble.js", "i += size) {", "i += size * 2) {", "chunking drops data"],
  ["js/device.js", 'if (state !== "connected") this.handshaken = false;', "", "ready survives a drop"],
  ["js/device.js", "await this.send(powerPacket(true), { label: \"Power on\" }); await pause();\n", "", "handshake skips power-on"],
  ["js/text.js", "x = Math.ceil((x + bmp.width + WORD_GAP) / 8) * 8;", "x = x + bmp.width + WORD_GAP;", "duo words off the chunk grid"],
  ["js/trip.js", "if (dt > 0 && dt <= 10000) {", "if (dt > 0) {", "GPS gaps counted as distance"],
  ["js/store.js", "if (meta.migratedV3) return null;", "", "v3 import runs on every launch"],
  ["js/modes.js", "of shuffled(JOKES, seed)) {\n      if ((l === \"ta\" && !ta) || (l === \"en\" && !en)) continue;", "of shuffled(JOKES, seed)) {", "comedy ignores the language choice"],
  ["js/modes.js", "beat(text(line, C.red, { effect: body, paint: \"duo\", color2: C.yellow }), line);", "beat(text(line, C.red, { effect: body }), line);", "TVK loses its second party colour"],
  ["js/gif.js", "if (next >= 1 << codeSize) codeSize++;", "if (next > 1 << codeSize) codeSize++;", "GIF code size grows late"],
];

// Each mutation gets its own temp copy, and a few run at once.
async function run([file, from, to, label], tmp, n) {
  const work = join(tmp, String(n), "apps", "nightfury-v4");
  mkdirSync(work, { recursive: true });
  if (existsSync(V3)) cpSync(V3, join(tmp, String(n), "apps", "nightfury-v3", "js"), { recursive: true });
  for (const d of ["js", "tests/unit", "tests/mock-bluetooth.mjs", "package.json"]) cpSync(join(ROOT, d), join(work, d), { recursive: true });
  const path = join(work, file);
  const src = readFileSync(path, "utf8");
  const count = src.split(from).length - 1;
  if (count !== 1) return { ok: false, line: `  ! ${label}: pattern found ${count}× in ${file} (mutation list is stale)` };
  writeFileSync(path, src.replace(from, to));
  const res = await new Promise((resolve) => {
    const child = spawn("sh", ["-c", `"${process.execPath}" --test tests/unit/*.test.mjs`], { cwd: work });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    // The suite takes about a second; a mutant that hangs it is killed (and counts as caught).
    let hung = false;
    const timer = setTimeout(() => { hung = true; spawnSync("pkill", ["-9", "-f", work]); child.kill("SIGKILL"); }, 30000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status: hung ? 1 : status, out, hung }); });
  });
  rmSync(join(tmp, String(n)), { recursive: true, force: true });
  if (res.status === 0) return { ok: false, line: `  ✗ SURVIVED: ${label} (${file})` };
  const failed = (res.out.match(/^✖ (?!failing)(.+?) \(/gm) || []).length;
  return { ok: true, line: `  ✓ killed: ${label} (${res.hung ? "the suite hung" : `${failed} failing test(s)`})` };
}

let survivors = 0;
const tmp = mkdtempSync(join(tmpdir(), "nf4-mut-"));
try {
  const queue = MUTATIONS.map((m, n) => [m, n]);
  const results = new Array(MUTATIONS.length);
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) results[job[1]] = await run(job[0], tmp, job[1]);
  }));
  for (const r of results) {
    console.log(r.line);
    if (!r.ok) survivors++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(survivors ? `✗ ${survivors}/${MUTATIONS.length} mutation(s) survived` : `✓ all ${MUTATIONS.length} mutations killed`);
process.exit(survivors ? 1 : 0);
