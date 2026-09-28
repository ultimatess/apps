// Transport + panel driver against the mock iPixel device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBluetooth } from "../mock-bluetooth.mjs";
import { BleTransport } from "../../js/ble.js";
import { IPixelPanel } from "../../js/device.js";
import { CMD, decodePacket, splitPackets, chunksToBitmap } from "../../js/protocol.js";
import { turnArrows } from "../../js/graphics.js";
import { Bitmap } from "../../js/bitmap.js";

const fastSleep = () => Promise.resolve();

function setup(opts = {}) {
  const mock = createMockBluetooth(opts);
  const logs = [];
  const transport = new BleTransport({ bluetooth: mock.bluetooth, log: (m, l) => logs.push([l, m]), chunkDelay: 0, sleep: fastSleep });
  const panel = new IPixelPanel({ transport, log: (m, l) => logs.push([l, m]), options: () => ({ lsbFirst: true, protocol: "ipixel" }) });
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
  assert.ok(mock.log.requests[0].optionalServices.includes("000000fa-0000-1000-8000-00805f9b34fb"));
});

test("cancelling the chooser does not open a second chooser (v2 bug)", async () => {
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

test("writes never exceed 20 bytes and frames reassemble with valid CRC", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  const bmp = turnArrows("left", 0);
  await panel.pushFrame(bmp, "#10b981");
  await panel.queue.idle();
  assert.ok(mock.log.writes.every((w) => w.bytes.length <= 20));
  const [pkt] = packets(mock);
  assert.equal(pkt.cmd, CMD.TEXT);
  assert.ok(pkt.crcOk);
  assert.equal(pkt.anim, 0);
  assert.deepEqual(pkt.rgb, [16, 185, 129]);
  assert.ok(new Bitmap(96, 16, chunksToBitmap(pkt.chunks).data).equals(bmp));
  assert.ok(mock.log.writes.every((w) => w.mode === "noresp"));
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

test("brightness bursts coalesce to the latest value", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  const jobs = [];
  jobs.push(panel.pushFrame(new Bitmap(), "#ffffff")); // occupy the queue
  for (let v = 10; v <= 100; v += 10) jobs.push(panel.brightness(v));
  await Promise.all(jobs);
  const b = packets(mock).filter((p) => p.cmd === CMD.BRIGHTNESS);
  assert.equal(b.length, 1);
  assert.equal(b[0].payload[0], 100);
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
  assert.equal(transport.connected, false);
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

test("protocol override: frame mode centres text, legacy modes send text encoders", async () => {
  for (const [protocol, check] of [
    ["frame", (p) => p[0].cmd === CMD.TEXT && p[0].anim === 0],
    ["clock", (p) => p[0].cmd === CMD.CLOCK],
    ["diy", (p) => p[0].cmd === CMD.DIY],
  ]) {
    const mock = createMockBluetooth();
    const transport = new BleTransport({ bluetooth: mock.bluetooth, chunkDelay: 0, sleep: fastSleep });
    const panel = new IPixelPanel({ transport, options: () => ({ lsbFirst: true, protocol }) });
    await transport.pair();
    const raster = new Bitmap(40, 16);
    raster.fillRect(0, 0, 40, 16);
    await panel.pushPlan({ type: "text", raster, speed: 72 }, { kind: "text", text: "HI", color: "#ffffff", style: "scroll", speed: 6 });
    await panel.queue.idle();
    assert.ok(check(packets(mock)), protocol);
  }
  const mock = createMockBluetooth();
  const transport = new BleTransport({ bluetooth: mock.bluetooth, chunkDelay: 0, sleep: fastSleep });
  const panel = new IPixelPanel({ transport, options: () => ({ protocol: "coolled" }) });
  await transport.pair();
  await panel.pushPlan({ type: "text", raster: new Bitmap(8, 16), speed: 50 }, { kind: "text", text: "HI", color: "#ff0000", speed: 6 });
  await panel.queue.idle();
  assert.equal(mock.stream()[0], 0x77);
});

test("panel is only 'ready' for scene frames after the handshake, and not after a drop", async () => {
  const { mock, transport, panel } = setup();
  await transport.pair();
  assert.equal(panel.connected, true);
  assert.equal(panel.ready, false, "connected but not initialised");
  await panel.handshake(50);
  assert.equal(panel.ready, true);
  mock.drop();
  assert.equal(panel.ready, false, "not ready while reconnecting");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(transport.connected, true, "auto-reconnected");
  assert.equal(panel.ready, false, "must re-handshake before scene frames after a reconnect");
  await panel.handshake(50);
  assert.equal(panel.ready, true);
});
