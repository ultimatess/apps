// Transport + panel driver against the mock iPixel device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBluetooth } from "../mock-bluetooth.mjs";
import { BleTransport } from "../../js/ble.js";
import { IPixelPanel } from "../../js/device.js";
import { CMD, decodePacket, splitPackets, chunksToBitmap } from "../../js/protocol.js";
import { speedHud, turnFrame } from "../../js/graphics.js";
import { Frame } from "../../js/frame.js";
import { Bitmap } from "../../js/bitmap.js";
import { layoutText, pixelOnlyRasterizer } from "../../js/text.js";
import { TxQueue } from "../../js/queue.js";

const fastSleep = () => Promise.resolve();

function setup(opts = {}, panelOpts = { lsbFirst: true, multiColor: true }, transportOpts = {}) {
  const mock = createMockBluetooth(opts);
  const logs = [];
  const transport = new BleTransport({ bluetooth: mock.bluetooth, log: (m, l) => logs.push([l, m]), chunkDelay: 0, sleep: fastSleep, ...transportOpts });
  const panel = new IPixelPanel({ transport, log: (m, l) => logs.push([l, m]), options: () => panelOpts });
  return { mock, transport, panel, logs };
}

const packets = (mock) => splitPackets(Uint8Array.from(mock.stream())).packets.map(decodePacket);

test("pairing discovers FA02 write + FA03 notify and emits state changes", async () => {
  const { mock, transport } = setup();
  const states = [];
  transport.on("state", (s) => states.push(s.state));
  await transport.pair();
  assert.equal(transport.connected, true);
  assert.ok(transport.writeChar.uuid.includes("fa02"));
  assert.equal(transport.notifyChars.length, 1);
  assert.deepEqual(states, ["requesting", "connecting", "connected"]);
  assert.deepEqual(mock.log.requests[0].filters.map((f) => f.namePrefix), ["LED_BLE", "LED", "iPixel", "CoolLED"]);
});

test("cancelling the chooser does not open a second chooser", async () => {
  const { mock, transport } = setup({ cancel: true });
  await assert.rejects(transport.pair(), /cancelled/);
  assert.equal(mock.log.requests.length, 1);
  assert.equal(transport.state, "idle");
});

test("handshake order and bytes", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  await panel.handshake(70);
  await panel.queue.idle();
  const p = packets(mock);
  assert.deepEqual(p.map((x) => x.cmd), [CMD.TIME, CMD.POWER, CMD.BRIGHTNESS, CMD.DIY]);
  assert.deepEqual([...p[2].payload], [70]);
});

test("multi-colour frame: 20-byte writes, valid CRC, one colour per chunk", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  const frame = speedHud(62, { frac: 0.8 });
  await panel.pushFrame(frame);
  await panel.queue.idle();
  assert.ok(mock.log.writes.every((w) => w.bytes.length <= 20 && w.mode === "noresp"));
  const [pkt] = packets(mock);
  assert.equal(pkt.cmd, CMD.TEXT);
  assert.ok(pkt.crcOk);
  assert.equal(pkt.anim, 0);
  assert.equal(pkt.chunks.length, 12);
  assert.ok(new Bitmap(96, 16, chunksToBitmap(pkt.chunks).data).equals(frame.mask()));
  assert.deepEqual(pkt.colors[2], [255, 255, 255], "digits white");
  assert.deepEqual(pkt.colors[8], [0, 224, 96], "first gauge bar green");
  assert.deepEqual(pkt.colors[10], [255, 144, 0], "third gauge bar amber");
  assert.ok(new Set(pkt.colors.map(String)).size >= 4);
});

test("single-colour mode sends one colour for the whole frame", async () => {
  const { mock, transport, panel } = setup({}, { lsbFirst: true, multiColor: false });
  await transport.pair();
  await panel.pushFrame(speedHud(62, { frac: 0.8 }));
  await panel.queue.idle();
  const [pkt] = packets(mock);
  assert.equal(new Set(pkt.colors.map(String)).size, 1);
  assert.deepEqual(pkt.colors[0], pkt.rgb);
});

test("a blank frame uses the fallback colour in its header", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  await panel.pushFrame(new Frame(), { fallback: "#ff9000" });
  await panel.queue.idle();
  assert.deepEqual(packets(mock)[0].rgb, [255, 144, 0]);
});

test("scroll: variable chunk count, scroll-left, per-chunk rainbow colours", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  const l = layoutText({ text: "RAINBOW RIBBON OF TEXT", color: "#ffffff", paint: "rainbow", effect: "scroll" }, pixelOnlyRasterizer);
  await panel.pushScroll(l.raster, 72);
  await panel.queue.idle();
  const [pkt] = packets(mock);
  assert.equal(pkt.anim, 1);
  assert.equal(pkt.speed, 72);
  assert.equal(pkt.chunks.length, Math.ceil(l.raster.width / 8));
  assert.ok(pkt.crcOk);
  assert.ok(new Set(pkt.colors.map(String)).size >= 8);
});

test("falls back to write-with-response when writeWithoutResponse is unsupported", async () => {
  const { mock, transport, panel } = setup({ writeWithoutResponse: false });
  await transport.pair();
  await panel.power(true);
  assert.ok(mock.log.writes.length > 0 && mock.log.writes.every((w) => w.mode === "resp"));
});

test("sending while disconnected is a quiet no-op", async () => {
  const { mock, panel } = setup();
  const r = await panel.brightness(50);
  assert.equal(r.skipped, true);
  assert.equal(mock.log.writes.length, 0);
});

test("brightness bursts coalesce to the latest value; scene frames replace a waiting one", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  const jobs = [panel.pushFrame(new Frame())]; // occupies the queue
  for (let v = 10; v <= 100; v += 10) jobs.push(panel.brightness(v));
  jobs.push(panel.pushFrame(turnFrame("left")));
  jobs.push(panel.pushFrame(turnFrame("right")));
  const res = await Promise.all(jobs);
  const p = packets(mock);
  const b = p.filter((x) => x.cmd === CMD.BRIGHTNESS);
  assert.equal(b.length, 1);
  assert.equal(b[0].payload[0], 100);
  assert.equal(p.filter((x) => x.cmd === CMD.TEXT).length, 2);
  assert.equal(res.filter((r) => r.superseded).length, 10);
});

test("write failure is logged, not thrown", async () => {
  const { transport, panel, logs } = setup({ failWrites: 1, writeWithoutResponse: false });
  await transport.pair();
  const r = await panel.power(true);
  assert.ok(r.error);
  assert.ok(logs.some(([l, m]) => l === "error" && /Write failed/.test(m)));
});

test("unexpected drop auto-reconnects and emits reconnected", async () => {
  const { mock, transport } = setup();
  await transport.pair();
  const events = [];
  transport.on("reconnected", () => events.push("reconnected"));
  transport.on("state", (s) => events.push(s.state));
  mock.drop();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(transport.connected, true);
  assert.ok(events.includes("reconnecting"));
  assert.ok(events.includes("reconnected"));
  assert.equal(mock.log.connects, 2);
});

test("user disconnect does not auto-reconnect", async () => {
  const { mock, transport } = setup();
  await transport.pair();
  transport.disconnect();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(transport.state, "disconnected");
  assert.equal(mock.log.connects, 1);
});

test("gives up after the retry budget when the panel stays away", async () => {
  const { mock, transport } = setup();
  await transport.pair();
  mock.options.refuseConnect = true;
  mock.drop();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(transport.state, "disconnected");
  assert.equal(mock.log.connects, 1 + 6);
});

test("notifications surface as rx events", async () => {
  const { transport, panel } = setup();
  const rx = [];
  transport.on("rx", (e) => rx.push([...e.bytes]));
  await transport.pair();
  await panel.power(true);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(rx[0], [5, 0, 7, 1, 1]);
});

test("panel is only 'ready' after the handshake, and not after a drop", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  assert.equal(panel.ready, false, "connected but not initialised");
  await panel.handshake(50);
  assert.equal(panel.ready, true);
  mock.drop();
  assert.equal(panel.ready, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(transport.connected, true, "auto-reconnected");
  assert.equal(panel.ready, false, "must re-handshake after a reconnect");
  await panel.handshake(50);
  assert.equal(panel.ready, true);
});

test("resume: reconnects to a known panel without the chooser; quiet when there is none or it is away", async () => {
  const a = setup({ known: true });
  assert.equal(await a.transport.resume(), true);
  assert.equal(a.transport.connected, true);
  assert.equal(a.mock.log.requests.length, 0, "no chooser");
  const b = setup({ known: false });
  assert.equal(await b.transport.resume(), false);
  assert.equal(b.transport.state, "idle");
  const c = setup({ known: true, refuseConnect: true });
  assert.equal(await c.transport.resume(), false);
  assert.equal(c.transport.state, "disconnected");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.mock.log.connects, 1, "no retry storm after a failed resume");
  const d = setup();
  delete d.mock.bluetooth.getDevices;
  assert.equal(await d.transport.resume(), false);
});

test("chunk size is configurable and clamped (Lab setting)", async () => {
  let size = 100;
  const { mock, transport, panel } = setup({ mtu: 244 }, undefined, { chunkSize: () => size });
  await transport.pair();
  await panel.pushFrame(turnFrame("left"));
  await panel.queue.idle();
  assert.deepEqual(mock.log.writes.map((w) => w.bytes.length), [100, 100, 69]);
  assert.ok(packets(mock)[0].crcOk);
  size = 9999;
  assert.equal(transport.chunkSize, 244);
  size = "junk";
  assert.equal(transport.chunkSize, 20);
});

test("GIF upload is one checksummed packet", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  await panel.uploadGif(Uint8Array.from({ length: 300 }, (_, i) => i & 255));
  await panel.queue.idle();
  const [pkt] = packets(mock);
  assert.equal(pkt.cmd, CMD.GIF);
  assert.ok(pkt.crcOk && pkt.lengthOk);
});

test("queue: serial execution, coalescing by key, clear resolves waiters", async () => {
  const q = new TxQueue({ gapMs: 0 });
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = q.enqueue(async () => { await gate; order.push("first"); });
  const a = q.enqueue(async () => order.push("a"), { key: "k" });
  const b = q.enqueue(async () => order.push("b"), { key: "k" });
  const c = q.enqueue(async () => order.push("c"));
  assert.deepEqual(await a, { superseded: true });
  release();
  await Promise.all([first, b, c]);
  assert.deepEqual(order, ["first", "b", "c"]);
  let hold;
  const busy = q.enqueue(() => new Promise((r) => { hold = r; }));
  const waiting = q.enqueue(async () => order.push("never"));
  q.clear("drop");
  assert.deepEqual(await waiting, { cancelled: true, reason: "drop" });
  hold();
  await busy;
  assert.equal(q.busy, false);
});
