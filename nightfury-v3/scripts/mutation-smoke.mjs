// Mutation smoke test: proves the unit suite actually catches regressions.
// Each mutation re-introduces a realistic bug (several are real v2 bugs) into a
// temp copy of the sources; the unit tests must FAIL for every one of them.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const V2 = fileURLToPath(new URL("../../nightfury/index.html", import.meta.url));

const MUTATIONS = [
  ["js/protocol.js", "v |= lsbFirst ? 1 << bit : 1 << (7 - bit);", "v |= lsbFirst ? 1 << (7 - bit) : 1 << bit;", "bit order flipped"],
  ["js/protocol.js", "0xedb88320", "0xedb88321", "wrong CRC polynomial"],
  ["js/protocol.js", "pkt[14] = saveSlot & 0xff;", "pkt[14] = 1;", "save slot corrupts header"],
  ["js/protocol.js", ".map((i) => parseInt(h.slice(i, i + 2), 16));", ".map((i) => parseInt(h.slice(i, i + 2), 16) || 255);", "v2 colour bug (0 -> 255)"],
  ["js/protocol.js", "* 70) + 30", "* 70) + 20", "scroll speed mapping drift"],
  ["js/graphics.js", "base - anim + Math.abs", "base + anim + Math.abs", "left chevrons animate the wrong way"],
  ["js/graphics.js", "const x0 = Math.floor((COLS - total) / 2);\n  drawText(bmp, digits", "const x0 = 0;\n  drawText(bmp, digits", "speed HUD not centred"],
  ["js/telemetry.js", "if (t - this.pendingSince >= this.enterMs) { this.state = dir;", "if (true) { this.state = dir;", "turns trigger on a single blip"],
  ["js/telemetry.js", "yawAbs < 20 && !speeding_up", "yawAbs < 200 && !speeding_up", "cornering g counted as braking"],
  ["js/telemetry.js", "dot([rot.beta || 0, rot.gamma || 0, rot.alpha || 0], up)", "(rot.alpha || 0)", "mount-dependent yaw (v2-style)"],
  ["js/hud.js", "if (user && now - user.at < holdMs)", "if (user)", "v2 bug: speed HUD never returns"],
  ["js/queue.js", "if (idx >= 0) {", "if (false) {", "no coalescing (v2 backlog)"],
  ["js/ble.js", 'if (this.userDisconnect || this.state === "reconnecting") return;', "return;", "no auto-reconnect"],
  ["js/ble.js", "i += this.chunkSize)", "i += this.chunkSize * 2)", "chunking drops data"],
  ["js/device.js", 'if (state !== "connected") this.handshaken = false;', "", "ready survives a drop"],
  ["js/device.js", "await this.send(powerPacket(true), { label: \"Power on\" }); await pause();\n", "", "handshake skips power-on"],
];

let survivors = 0;
const tmp = mkdtempSync(join(tmpdir(), "nf3-mut-"));
try {
  for (const [file, from, to, label] of MUTATIONS) {
    const work = join(tmp, "apps", "nightfury-v3");
    rmSync(join(tmp, "apps"), { recursive: true, force: true });
    mkdirSync(join(tmp, "apps", "nightfury"), { recursive: true });
    if (existsSync(V2)) cpSync(V2, join(tmp, "apps", "nightfury", "index.html"));
    for (const d of ["js", "tests", "package.json"]) cpSync(join(ROOT, d), join(work, d), { recursive: true });
    const path = join(work, file);
    const src = readFileSync(path, "utf8");
    const count = src.split(from).length - 1;
    if (count !== 1) {
      console.log(`  ! ${label}: pattern found ${count}× in ${file} (mutation list is stale)`);
      survivors++;
      continue;
    }
    writeFileSync(path, src.replace(from, to));
    const res = spawnSync(process.execPath, ["--test", ...["protocol", "parity", "graphics", "telemetry", "app-logic", "ble"].map((n) => `tests/unit/${n}.test.mjs`)], { cwd: work, encoding: "utf8", timeout: 120000 });
    if (res.status === 0) {
      console.log(`  ✗ SURVIVED: ${label} (${file})`);
      survivors++;
    } else {
      const failed = (res.stdout.match(/^✖ (?!failing)(.+?) \(/gm) || []).length;
      console.log(`  ✓ killed: ${label} — ${failed} failing test(s)`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(survivors ? `✗ ${survivors}/${MUTATIONS.length} mutations survived` : `✓ all ${MUTATIONS.length} mutations killed`);
process.exit(survivors ? 1 : 0);
