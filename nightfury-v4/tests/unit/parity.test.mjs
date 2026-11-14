// v3 parity: for single-colour content v4 must put exactly the bytes on the wire
// that v3 did (v3's bytes were validated on the real panel). v3's own modules are
// imported and run side by side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as P4 from "../../js/protocol.js";
import { Frame, frameToChunks } from "../../js/frame.js";
import { classicEyes, eyesBitmap } from "../../js/eyes.js";
import { pixelOnlyRasterizer } from "../../js/text.js";
import { createMockBluetooth } from "../mock-bluetooth.mjs";
import { BleTransport } from "../../js/ble.js";
import { IPixelPanel } from "../../js/device.js";

const V3 = fileURLToPath(new URL("../../../nightfury-v3/js/", import.meta.url));
const have = existsSync(`${V3}protocol.js`);
const opt = { skip: have ? false : "nightfury-v3 sources not present" };
const P3 = have ? await import(`${V3}protocol.js`) : null;
const G3 = have ? await import(`${V3}graphics.js`) : null;
const D3 = have ? await import(`${V3}device.js`) : null;
const B3 = have ? await import(`${V3}ble.js`) : null;
const T3 = have ? await import(`${V3}textraster.js`) : null;

const fastSleep = () => Promise.resolve();

// v3's transport leaves its 12 s connect-timeout timer pending; don't let that hold the test process open.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  const t = realSetTimeout(fn, ms, ...rest);
  if (ms >= 10000) t.unref?.();
  return t;
};

test("static frames: identical bytes for every v3 graphic, colour and bit order", opt, () => {
  const bitmaps = [G3.turnArrows("left", 0), G3.turnArrows("right", 7), G3.devilEyes("angry", 3), G3.devilEyes("apk_beast_red", 20), G3.speedHud(65), G3.brakeFrame(), G3.stoppedFrame()];
  for (const bmp of bitmaps) {
    for (const color of ["#ef4444", "#06b6d4", "#000001", "#ffffff"]) {
      for (const lsbFirst of [true, false]) {
        const v3 = P3.buildTextPacket(P3.bitmapToChunks(bmp, { lsbFirst, columns: 96 }), { anim: 0, speed: 80, rgb: P3.hexToRgb(color) });
        for (const multi of [true, false]) {
          const { chunks, colors, rgb } = frameToChunks(Frame.fromBitmap(bmp, color), { lsbFirst, columns: 96, multi });
          const v4 = P4.buildTextPacket(chunks, { anim: 0, speed: 80, rgb, colors });
          assert.deepEqual([...v4], [...v3]);
        }
      }
    }
  }
});

test("scroll text: identical bytes", opt, () => {
  for (const text of ["KEEP DISTANCE", "HELLO WORLD 123", "A"]) {
    const r3 = T3.pixelRaster(text);
    const v3 = P3.buildTextPacket(P3.bitmapToChunks(r3, { lsbFirst: true }), { anim: 1, speed: P3.mapScrollSpeed(6), rgb: P3.hexToRgb("#f59e0b") });
    const r4 = Frame.fromBitmap(pixelOnlyRasterizer(text), "#f59e0b");
    const { chunks, colors, rgb } = frameToChunks(r4, { lsbFirst: true });
    const v4 = P4.buildTextPacket(chunks, { anim: 1, speed: P4.mapScrollSpeed(6), rgb, colors });
    assert.deepEqual([...v4], [...v3]);
  }
});

test("command packets: identical bytes", opt, () => {
  const d = new Date(2026, 10, 14, 9, 8, 7);
  assert.deepEqual([...P4.timeSyncPacket(d)], [...P3.timeSyncPacket(d)]);
  assert.deepEqual([...P4.clockModePacket(d)], [...P3.clockModePacket(d)]);
  for (const v of [1, 35, 85, 100, 0]) assert.deepEqual([...P4.brightnessPacket(v)], [...P3.brightnessPacket(v)]);
  for (const on of [true, false]) {
    assert.deepEqual([...P4.powerPacket(on)], [...P3.powerPacket(on)]);
    assert.deepEqual([...P4.diyModePacket(on)], [...P3.diyModePacket(on)]);
  }
  assert.deepEqual([...P4.resetPacket()], [...P3.resetPacket()]);
  assert.deepEqual([...P4.pingPacket()], [...P3.pingPacket()]);
  assert.deepEqual(P4.CANDIDATE_SERVICES, P3.CANDIDATE_SERVICES);
  assert.deepEqual(P4.DEVICE_NAME_PREFIXES, P3.DEVICE_NAME_PREFIXES);
  for (const s of [1, 5, 6, 10, "x"]) assert.equal(P4.mapScrollSpeed(s), P3.mapScrollSpeed(s));
});

test("panel driver: handshake and a frame push write the same stream as v3's driver", opt, async () => {
  const run = async (Transport, Panel, push) => {
    const mock = createMockBluetooth();
    const transport = new Transport({ bluetooth: mock.bluetooth, chunkDelay: 0, sleep: fastSleep });
    const panel = new Panel({ transport, options: () => ({ lsbFirst: true, protocol: "ipixel", multiColor: true }) });
    await transport.pair();
    await panel.handshake(70);
    await push(panel);
    await panel.queue.idle();
    return P4.splitPackets(Uint8Array.from(mock.stream())).packets;
  };
  const bmp = G3.brakeFrame();
  const a = await run(B3.BleTransport, D3.IPixelPanel, (p) => p.pushFrame(bmp, "#ef4444"));
  const b = await run(BleTransport, IPixelPanel, (p) => p.pushFrame(Frame.fromBitmap(bmp, "#ef4444")));
  assert.equal(a.length, b.length);
  a.forEach((pkt, i) => {
    const cmd = pkt[2] | (pkt[3] << 8);
    if (cmd === P4.CMD.TIME) assert.equal(b[i].length, pkt.length); // seconds may tick between the two runs
    else assert.deepEqual([...b[i]], [...pkt]);
  });
});

test("classic and APK eyes are pixel-identical to v3", opt, () => {
  for (const mode of ["angry", "cyan_cyber", "cylon", "winking"]) {
    for (const tick of [0, 13, 90, 119]) assert.ok(classicEyes(mode, tick).equals(G3.devilEyes(mode, tick)), `${mode}@${tick}`);
  }
  for (const mode of G3.APK_EYE_MODES) {
    for (const ms of [0, 500, 2000]) assert.ok(eyesBitmap(mode, ms).equals(G3.devilEyes(mode, Math.floor((ms * 60) / 1000))), `${mode}@${ms}`);
  }
});
