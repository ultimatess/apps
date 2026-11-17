// Panel memory: save slots, against the mock panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBluetooth } from "../mock-bluetooth.mjs";
import { BleTransport } from "../../js/ble.js";
import { IPixelPanel } from "../../js/device.js";
import * as P from "../../js/protocol.js";
import { createScenes } from "../../js/scene.js";
import { pixelOnlyRasterizer, layoutText } from "../../js/text.js";
import { PanelMemory, planSlot, slotsBeyond, MEMORY_MAX } from "../../js/memory.js";
import { DEFAULT_SETTINGS } from "../../js/store.js";
import { quantize } from "../../js/frame.js";

test("slot packets match the pypixelcolor byte layouts", () => {
  assert.deepEqual([...P.showSlotPacket(3)], [0x07, 0x00, 0x08, 0x80, 0x01, 0x00, 0x03]);
  assert.deepEqual([...P.deleteSlotPacket(2)], [0x07, 0x00, 0x02, 0x01, 0x01, 0x00, 0x02]);
  const pkt = P.buildTextPacket([new Array(16).fill(1)], { anim: 0, saveSlot: 4 });
  assert.equal(pkt[13], 0x00);
  assert.equal(pkt[14], 4, "save slot is byte 14");
  assert.equal(P.decodePacket(pkt).saveSlot, 4);
  assert.equal(P.buildTextPacket([new Array(16).fill(1)], { anim: 0 })[14], 0, "live frames stay in slot 0");
});

test("planSlot: fills free slots, never rewrites the same message, then replaces the oldest", () => {
  let recs = [];
  const step = (key, at, keep = 3) => { const p = planSlot(recs, key, keep, at); recs = p.records; return p; };
  assert.deepEqual([step("a", 1), step("b", 2), step("c", 3)].map((p) => [p.slot, p.write]), [[1, true], [2, true], [3, true]]);
  assert.deepEqual([step("b", 4).slot, step("b", 4).write], [2, false], "same message: no write");
  const d = step("d", 5);
  assert.deepEqual([d.slot, d.write], [1, true], "a (oldest) is replaced");
  const e = step("e", 6);
  assert.equal(e.slot, 3, "c is now the oldest (b was refreshed)");
  assert.deepEqual(recs.map((r) => r.key), ["d", "b", "e"]);
  assert.equal(planSlot(recs, "x", 0, 7), null, "off");
  assert.deepEqual(slotsBeyond([{ slot: 1 }, { slot: 4 }, { slot: 5 }], 3), [4, 5]);
  assert.deepEqual(slotsBeyond([{ slot: 1 }, { slot: 2 }], 0), [1, 2]);
});

async function setup(over = {}) {
  const S = { ...DEFAULT_SETTINGS, ...over };
  const mock = createMockBluetooth();
  const transport = new BleTransport({ bluetooth: mock.bluetooth, log: () => {}, chunkDelay: 0, sleep: () => Promise.resolve() });
  const panel = new IPixelPanel({ transport, options: () => ({ lsbFirst: S.lsbFirst, multiColor: S.multiColor }) });
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer, options: () => S });
  let saved = null;
  const writes = [];
  const memory = new PanelMemory({ panel, scenes, settings: () => S, load: () => saved, save: (m) => { saved = JSON.parse(JSON.stringify(m)); }, onWrite: (slot) => writes.push(slot) });
  const packets = () => P.splitPackets(Uint8Array.from(mock.stream())).packets.map(P.decodePacket);
  const connect = async () => { await transport.pair(); await panel.handshake(80); mock.log.writes.length = 0; };
  return { S, mock, transport, panel, scenes, memory, packets, connect, writes, saved: () => saved };
}

const text = (t, o = {}) => ({ kind: "text", text: t, color: "#00ff00", effect: "auto", nonce: Math.random(), ...o });

test("a sent message is written once to slot 1, a still as a frame and a long one as a firmware scroll", async () => {
  const { memory, packets, connect, writes, saved, S } = await setup();
  await connect();
  assert.deepEqual(await memory.remember(text("THANKS"), "THANKS"), { slot: 1, written: true });
  assert.deepEqual(await memory.remember(text("THANKS"), "THANKS"), { slot: 1, written: false }, "re-sending does not rewrite flash");
  assert.deepEqual(await memory.remember(text("KEEP YOUR DISTANCE PLEASE"), "long"), { slot: 2, written: true });
  const [a, b, ...rest] = packets();
  assert.equal(rest.length, 0);
  assert.ok(a.crcOk && b.crcOk);
  assert.deepEqual([a.saveSlot, a.anim, a.chunks.length], [1, 0, 12]);
  const want = layoutText({ ...text("THANKS"), speed: S.speed }, pixelOnlyRasterizer, { allowMotion: false }).frames[0];
  assert.deepEqual(P.chunksToBitmap(a.chunks).data, quantize(want).mask().data, "the stored frame is the message");
  assert.deepEqual([b.saveSlot, b.anim, b.speed], [2, 1, P.mapScrollSpeed(S.speed)]);
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(saved().records.map((r) => [r.slot, r.label]), [[1, "THANKS"], [2, "long"]], "persisted for the next launch");
});

test("word-by-word and blink are stored as something the firmware can play alone", async () => {
  const { memory, packets, connect } = await setup();
  await connect();
  await memory.remember(text("KEEP YOUR DISTANCE", { effect: "words" }), "words");
  await memory.remember(text("HAZARD", { effect: "blink" }), "blink");
  const [w, b] = packets();
  assert.deepEqual([w.saveSlot, w.anim], [1, 1], "words become a scroll");
  assert.deepEqual([b.saveSlot, b.anim], [2, 0], "blink becomes a still");
});

test("live-only scenes, memory off, and a disconnected panel never write a slot", async () => {
  const { memory, packets, connect, S } = await setup();
  assert.deepEqual(await memory.remember(text("HI"), "HI"), { skipped: "offline" });
  await connect();
  for (const scene of [{ kind: "eyes", mode: "living_calm", color: "#fff" }, { kind: "clock" }, { kind: "speed", value: 40, unit: "KM/H" }, { kind: "fx", id: "wave" }]) {
    assert.deepEqual(await memory.remember(scene, "x"), { skipped: "live-only" }, scene.kind);
  }
  S.panelKeep = 0;
  assert.deepEqual(await memory.remember(text("HI"), "HI"), { skipped: "off" });
  assert.equal(packets().length, 0);
});

test("pictures and pixel art are stored as their still; art identity is its drawing, not its revision", async () => {
  const { memory, packets, connect, scenes } = await setup();
  await connect();
  assert.equal((await memory.remember({ kind: "pic", id: "crow" }, "Crow")).written, true);
  const art = { kind: "art", id: "u1", rev: 1, fps: 4, frames: ["x"] };
  const frames = [scenes.render({ kind: "pic", id: "race" }, 0, { poster: true })];
  const { packFrame } = await import("../../js/frame.js");
  art.frames = frames.map(packFrame);
  assert.equal((await memory.remember(art, "Art")).written, true);
  assert.equal((await memory.remember({ ...art, rev: "1.999" }, "Art")).written, false, "re-sent drawing is not rewritten");
  const [pic] = packets();
  assert.equal(pic.saveSlot, 1);
  assert.deepEqual(P.chunksToBitmap(pic.chunks).data, quantize(scenes.render({ kind: "pic", id: "crow" }, 0, { poster: true })).mask().data);
});

test("a different speed or colour mode is a different message", async () => {
  const { memory, connect, S } = await setup();
  await connect();
  const long = text("KEEP YOUR DISTANCE PLEASE");
  assert.equal((await memory.remember(long, "a")).slot, 1);
  S.speed = 9;
  assert.equal((await memory.remember(long, "a")).slot, 2);
  S.multiColor = false;
  assert.equal((await memory.remember(long, "a")).slot, 3);
});

test("shrinking or clearing memory deletes slots now, or on the next connect when offline", async () => {
  const { memory, packets, connect, transport, S, saved } = await setup({ panelKeep: 5 });
  await connect();
  for (const w of ["A", "B", "C", "D"]) await memory.remember(text(w), w);
  const before = packets().length;
  S.panelKeep = 3;
  await memory.applyKeep();
  const dels = packets().slice(before);
  assert.deepEqual(dels.map((p) => [p.cmd, p.payload?.[2]]), [[P.CMD.DELETE_SLOT, 4]]);
  assert.deepEqual(memory.records.map((r) => r.slot), [1, 2, 3]);

  transport.disconnect();
  await memory.clear();
  assert.deepEqual(saved().pendingDelete, Array.from({ length: MEMORY_MAX }, (_, i) => i + 1), "remembered while offline");
  await connect();
  assert.equal(await memory.flush(), MEMORY_MAX);
  assert.deepEqual(packets().map((p) => p.payload?.[2]), [1, 2, 3, 4, 5]);
  assert.ok(packets().every((p) => p.cmd === P.CMD.DELETE_SLOT));
  assert.deepEqual(saved().pendingDelete, []);
});

test("a failed slot write is forgotten so the next send tries again", async () => {
  const { memory, connect, panel } = await setup();
  await connect();
  const real = panel.saveToSlot.bind(panel);
  panel.saveToSlot = () => Promise.resolve({ error: new Error("x") });
  assert.deepEqual(await memory.remember(text("HI"), "HI"), { skipped: "write-failed" });
  assert.equal(memory.records.length, 0);
  panel.saveToSlot = real;
  assert.deepEqual(await memory.remember(text("HI"), "HI"), { slot: 1, written: true });
});

test("a live frame queued after a slot write does not cancel it", async () => {
  const { memory, packets, connect, panel, scenes } = await setup();
  await connect();
  const p = memory.remember(text("THANKS"), "THANKS");
  panel.pushFrame(scenes.render({ kind: "pic", id: "jam" }, 0)); // ordinary live frame, key "scene"
  await p;
  await panel.queue.idle();
  assert.deepEqual(packets().map((x) => x.saveSlot).sort(), [0, 1]);
});
