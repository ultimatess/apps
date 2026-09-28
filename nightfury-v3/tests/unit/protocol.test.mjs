import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../../js/protocol.js";
import { Bitmap } from "../../js/bitmap.js";

test("hexToRgb keeps zero channels (v2 turned 0 into 255)", () => {
  assert.deepEqual(P.hexToRgb("#ff0000"), [255, 0, 0]);
  assert.deepEqual(P.hexToRgb("#000000"), [0, 0, 0]);
  assert.deepEqual(P.hexToRgb("0f0"), [0, 255, 0]);
  assert.deepEqual(P.hexToRgb("#10b981"), [16, 185, 129]);
  assert.deepEqual(P.hexToRgb("nonsense"), [255, 255, 255]);
  assert.equal(P.rgbToHex([6, 182, 212]), "#06b6d4");
});

test("parseHex accepts common formats and rejects garbage", () => {
  assert.deepEqual([...P.parseHex("05 00 07 01 01")], [5, 0, 7, 1, 1]);
  assert.deepEqual([...P.parseHex("0x05,0x00, 0x07")], [5, 0, 7]);
  assert.deepEqual([...P.parseHex("0500070101")], [5, 0, 7, 1, 1]);
  assert.deepEqual([...P.parseHex("a;B:c")], [10, 11, 12]);
  assert.throws(() => P.parseHex(""), /Empty/);
  assert.throws(() => P.parseHex("05 zz"), /Invalid/);
  assert.throws(() => P.parseHex("123"), /Odd/);
  assert.throws(() => P.parseHex("100"), /Odd/);
});

test("packet length header is little-endian and includes the header", () => {
  const pkt = P.buildPacket(0x1234, new Array(300).fill(1));
  assert.equal(pkt.length, 304);
  assert.equal(pkt[0] | (pkt[1] << 8), 304);
  assert.equal(pkt[2], 0x34);
  assert.equal(pkt[3], 0x12);
});

test("text packet decodes back to the same bitmap, colour and CRC", () => {
  const bmp = new Bitmap();
  for (let x = 0; x < 96; x += 3) bmp.set(x, x % 16);
  bmp.fillRect(40, 4, 10, 6);
  for (const lsbFirst of [true, false]) {
    const chunks = P.bitmapToChunks(bmp, { lsbFirst, columns: 96 });
    const pkt = P.buildTextPacket(chunks, { anim: 0, speed: 80, rgb: [1, 2, 3] });
    const d = P.decodePacket(pkt);
    assert.equal(d.cmd, P.CMD.TEXT);
    assert.ok(d.lengthOk && d.crcOk);
    assert.equal(d.chunks.length, 12);
    assert.deepEqual(d.rgb, [1, 2, 3]);
    assert.equal(d.anim, 0);
    const back = P.chunksToBitmap(d.chunks, { lsbFirst });
    assert.ok(new Bitmap(96, 16, back.data).equals(bmp));
  }
});

test("corrupted packets fail CRC", () => {
  const pkt = P.buildTextPacket(P.bitmapToChunks(new Bitmap(), { columns: 96 }), {});
  pkt[pkt.length - 1] ^= 0xff;
  assert.equal(P.decodePacket(pkt).crcOk, false);
});

test("splitPackets reassembles a concatenated stream", () => {
  const a = P.powerPacket(true);
  const b = P.buildTextPacket(P.bitmapToChunks(new Bitmap(), { columns: 96 }), {});
  const c = P.brightnessPacket(40);
  const stream = Uint8Array.from([...a, ...b, ...c, 0x09]);
  const { packets, rest } = P.splitPackets(stream);
  assert.equal(packets.length, 3);
  assert.equal(packets[1].length, b.length);
  assert.deepEqual([...rest], [0x09]);
});

test("brightness and clock packets clamp their inputs", () => {
  assert.equal(P.brightnessPacket(0)[4], 100); // 0/NaN -> default 100 (v2 behaviour)
  assert.equal(P.brightnessPacket(250)[4], 100);
  assert.equal(P.brightnessPacket(1)[4], 1);
  const clk = P.clockModePacket(new Date(2026, 0, 4), { style: 20 }); // a Sunday
  assert.equal(clk[4], 8);
  assert.equal(clk[10], 7);
});

test("notification recogniser", () => {
  assert.deepEqual(P.describeNotification(Uint8Array.from([0x0b, 0, 1, 0x80, 0x84])), { type: "screen", screenType: 0x84, is96x16: true });
  assert.equal(P.describeNotification(Uint8Array.from([5, 0, 7, 1, 1])).type, "ack");
  assert.equal(P.describeNotification(Uint8Array.from([1])).type, "unknown");
});

test("legacy encoders produce checksummed payloads", () => {
  const [pre, body] = P.ae01Packets("HI", { style: "static", speed: 3, rgb: [1, 2, 3] });
  assert.deepEqual([...pre], [2, 1, 1]);
  const sum = [...body.slice(0, -1)].reduce((a, b) => (a + b) & 0xff, 0);
  assert.equal(body[body.length - 1], sum);
  const cl = P.coolled7728Packet("HI", { speed: 3, rgb: [1, 2, 3] });
  assert.equal(cl[0], 0x77);
  assert.equal(cl[1], 0x28);
});

test("candidate UUIDs are canonical 128-bit lowercase", () => {
  for (const u of [...P.CANDIDATE_SERVICES, ...P.CANDIDATE_CHARACTERISTICS]) {
    assert.match(u, /^[0-9a-f]{8}-0000-1000-8000-00805f9b34fb$/);
  }
  assert.ok(P.CANDIDATE_SERVICES.includes("000000fa-0000-1000-8000-00805f9b34fb"));
});
