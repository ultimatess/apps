import { test } from "node:test";
import assert from "node:assert/strict";
import { Frame, centerFrame, dim, frameToChunks, hsl, packFrame, quantize, unpackFrame } from "../../js/frame.js";
import { Bitmap } from "../../js/bitmap.js";
import { chunksToBitmap } from "../../js/protocol.js";

test("ink normalises colours and reuses palette slots", () => {
  const f = new Frame();
  assert.equal(f.ink("#FFF"), f.ink("#ffffff"));
  assert.notEqual(f.ink("#ff0000"), f.ink("#00ff00"));
  f.set(3, 4, "#F00");
  assert.equal(f.get(3, 4), "#ff0000");
  assert.equal(f.get(0, 0), null);
  assert.equal(f.get(-1, 0), null);
  f.set(3, 4, null);
  assert.equal(f.litCount(), 0);
});

test("paint draws a bitmap in one colour or per pixel, clipped to the frame", () => {
  const bmp = new Bitmap(4, 2);
  bmp.fillRect(0, 0, 4, 2);
  const f = new Frame().paint(bmp, "#00ff00", 94, 15);
  assert.equal(f.litCount(), 2);
  const g = new Frame().paint(bmp, (x) => (x % 2 ? "#ff0000" : "#0000ff"), 0, 0);
  assert.equal(g.get(0, 0), "#0000ff");
  assert.equal(g.get(1, 1), "#ff0000");
});

test("frameToChunks: one dominant colour per 8-column chunk; empty chunks take the frame colour", () => {
  const f = new Frame();
  f.fillRect(0, 0, 8, 16, "#ff0000");
  f.fillRect(8, 0, 5, 16, "#00ff00");
  f.fillRect(13, 0, 3, 16, "#0000ff"); // minority in chunk 1
  const { chunks, colors, rgb } = frameToChunks(f, { columns: 96 });
  assert.equal(chunks.length, 12);
  assert.deepEqual(colors[0], [255, 0, 0]);
  assert.deepEqual(colors[1], [0, 255, 0]);
  assert.deepEqual(colors[5], rgb);
  assert.deepEqual(rgb, [255, 0, 0]);
  assert.ok(new Bitmap(96, 16, chunksToBitmap(chunks).data).equals(f.mask()));
  const mono = frameToChunks(f, { columns: 96, multi: false });
  assert.ok(mono.colors.every((c) => c.join() === "255,0,0"));
});

test("quantize shows what the panel shows, and is a no-op for chunk-aligned art", () => {
  const f = new Frame();
  f.fillRect(8, 0, 5, 16, "#00ff00");
  f.fillRect(13, 0, 3, 16, "#0000ff");
  const q = quantize(f);
  assert.equal(q.get(14, 3), "#00ff00");
  assert.ok(q.mask().equals(f.mask()));
  const aligned = new Frame();
  aligned.fillRect(0, 0, 8, 16, "#ff0000");
  aligned.fillRect(8, 0, 8, 16, "#00ff00");
  assert.ok(quantize(aligned).equals(aligned));
  assert.equal(quantize(f, { multi: false }).colors().length, 1);
});

test("key changes with pixels and with colour", () => {
  const a = new Frame();
  a.set(1, 1, "#ff0000");
  const b = a.clone();
  assert.equal(a.key(), b.key());
  b.set(2, 2, "#ff0000");
  assert.notEqual(a.key(), b.key());
  const c = new Frame();
  c.set(1, 1, "#00ff00");
  assert.notEqual(a.key(), c.key());
  assert.ok(!a.equals(c));
});

test("pack / unpack round-trips pixels and colours", () => {
  const f = new Frame();
  f.fillRect(0, 0, 40, 3, "#ff0000");
  f.fillRect(50, 5, 2, 9, "#00d0ff");
  f.set(95, 15, "#ffffff");
  const packed = JSON.parse(JSON.stringify(packFrame(f)));
  assert.ok(packed.d.length < 200, "run-length coding keeps it small");
  assert.ok(unpackFrame(packed).equals(f));
  assert.equal(unpackFrame(null).litCount(), 0);
});

test("colour helpers", () => {
  assert.equal(hsl(0), "#ff0000");
  assert.equal(hsl(120), "#00ff00");
  assert.equal(dim("#ff8000", 0.5), "#804000");
  const small = new Frame(10, 4);
  small.fillRect(0, 0, 10, 4, "#ffffff");
  const c = centerFrame(small);
  assert.equal(c.get(43, 6), "#ffffff");
  assert.equal(c.get(42, 6), null);
});
