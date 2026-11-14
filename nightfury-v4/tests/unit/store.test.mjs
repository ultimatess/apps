import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createStore } from "../../js/store.js";
import { BUILTIN_ITEMS, BUILTIN_SHOWS, DEFAULT_PINS, createLibrary, itemScene } from "../../js/library.js";
import { createScenes, describeScene, sceneKey, sceneTint } from "../../js/scene.js";
import { pixelOnlyRasterizer } from "../../js/text.js";
import { TripMeter, formatDistance, formatDuration } from "../../js/trip.js";
import { encodeGif } from "../../js/gif.js";
import { Frame, packFrame } from "../../js/frame.js";
import { fxFrame } from "../../js/fx.js";

function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("settings persist, reset, and survive corrupt storage", () => {
  const mem = memory();
  const a = createStore(mem);
  a.set({ brightness: 40, hud: "signals" });
  const b = createStore(mem);
  assert.equal(b.settings.brightness, 40);
  assert.equal(b.settings.hud, "signals");
  assert.equal(b.settings.unit, "kmh", "new keys fall back to defaults");
  b.resetSettings();
  assert.deepEqual(b.settings, DEFAULT_SETTINGS);
  assert.equal(createStore(memory({ "nightfury.v4.settings": "{nope" })).settings.brightness, 85);
  assert.doesNotThrow(() => createStore({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }).set({ brightness: 1 }));
});

test("items: save, update in place, delete, and deleting cleans pins and shows", () => {
  const s = createStore(memory());
  const one = s.saveItem({ kind: "text", text: "HELLO", color: "#ff0000" });
  const two = s.saveItem({ kind: "text", text: "HELLO", color: "#00ff00" });
  assert.notEqual(one.id, two.id, "same text may be saved twice (v3 de-duplicated by text)");
  assert.equal(one.group, "mine");
  const edited = s.saveItem({ ...one, text: "HELLO THERE" });
  assert.equal(edited.id, one.id);
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].text, "HELLO THERE");
  assert.ok(edited.rev > one.rev);
  s.togglePin(one.id);
  const show = s.saveShow({ name: "Mine", items: [{ ref: one.id, secs: 5 }, { ref: "road.thanks", secs: 500 }] });
  assert.equal(show.items[1].secs, 120, "durations are clamped");
  s.removeItem(one.id);
  assert.ok(!s.pins.includes(one.id));
  assert.deepEqual(s.shows[0].items.map((i) => i.ref), ["road.thanks"]);
});

test("pins: default deck, toggle, and a cap of eight", () => {
  const s = createStore(memory());
  assert.deepEqual(s.pins, DEFAULT_PINS);
  assert.equal(s.togglePin(DEFAULT_PINS[0]), false);
  for (const id of ["a", "b", "c"]) assert.equal(s.togglePin(id), true);
  assert.equal(s.pins.length, 8);
  assert.equal(s.togglePin("overflow"), false);
  assert.equal(s.pins.length, 8);
});

test("backup round-trip, and rejecting a foreign file", () => {
  const a = createStore(memory());
  a.set({ unit: "mph", limitKmh: 100 });
  const item = a.saveItem({ kind: "text", text: "MINE" });
  a.saveShow({ name: "S", items: [{ ref: item.id, secs: 4 }] });
  a.setPins([item.id]);
  const backup = JSON.parse(JSON.stringify(a.exportAll()));
  const b = createStore(memory());
  const res = b.importAll(backup);
  assert.deepEqual(res, { items: 1, shows: 1, settings: true });
  assert.equal(b.settings.unit, "mph");
  assert.equal(b.items[0].text, "MINE");
  assert.equal(b.items[0].id, item.id, "ids are kept so shows and pins still point at them");
  assert.deepEqual(b.pins, [item.id]);
  assert.throws(() => b.importAll({ hello: 1 }), /backup/);
  b.importAll({ app: "nightfury", settings: { brightness: "loud", hud: "off" } });
  assert.equal(b.settings.brightness, 85, "wrong types are ignored");
  assert.equal(b.settings.hud, "off");
});

test("v3 migration: saved messages and settings come across once", () => {
  const mem = memory({
    "nightfury.v3.settings": JSON.stringify({ brightness: 60, autoHud: false, unit: "mph", stoppedMode: "message", liveAnimation: false, brakeLight: false, holdKey: "30s", limitKmh: 90, speed: 4 }),
    "nightfury.v3.custom": JSON.stringify([{ text: "முதல்", color: "#ff0000", style: "static", speed: 4 }, { text: "SECOND", color: "#00ff00", style: "scroll" }, { nope: 1 }]),
  });
  const s = createStore(mem);
  assert.deepEqual(s.migrateV3(), { items: 2, settings: true });
  assert.deepEqual(s.items.map((i) => i.text), ["முதல்", "SECOND"], "order kept");
  assert.deepEqual(s.items.map((i) => i.effect), ["static", "scroll"]);
  assert.equal(s.settings.brightness, 60);
  assert.equal(s.settings.hud, "off");
  assert.equal(s.settings.unit, "mph");
  assert.equal(s.settings.stoppedMode, "content");
  assert.equal(s.settings.motion, "signals");
  assert.equal(s.settings.autoBrake, false);
  assert.equal(s.settings.holdKey, "30s");
  assert.equal(s.settings.speed, 4, "v3's scroll speed becomes the message speed");
  assert.ok(s.items.every((i) => !("speed" in i)), "messages no longer carry their own speed");
  assert.equal(s.migrateV3(), null, "only once");
  assert.equal(createStore(mem).migrateV3(), null, "remembered across reloads");
  assert.equal(createStore(memory()).migrateV3(), null, "nothing to migrate");
});

test("library: unique ids, every built-in renders, pins and shows resolve", () => {
  const store = createStore(memory());
  const lib = createLibrary(store);
  const ids = BUILTIN_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer });
  for (const item of BUILTIN_ITEMS) {
    const scene = itemScene(item);
    assert.ok(scene, item.id);
    assert.equal(scenes.render(scene, 500).width, 96, item.id);
    assert.ok(scenes.plan(scene).mode, item.id);
    assert.ok(describeScene(scene).length > 0);
    assert.match(sceneTint(scene), /^#[0-9a-f]{6}$/i);
    assert.ok(sceneKey(scene).length > 3);
  }
  assert.equal(lib.pinned().length, DEFAULT_PINS.length);
  for (const show of BUILTIN_SHOWS) for (const it of show.items) assert.ok(lib.get(it.ref), `${show.id} → ${it.ref}`);
  const mine = store.saveItem({ kind: "text", text: "Custom one", label: "Custom one" });
  assert.equal(lib.filter("mine")[0].id, mine.id);
  assert.equal(lib.filter("all", "custom").length, 1);
  assert.ok(lib.filter("eyes").every((i) => i.kind === "eyes"));
  assert.equal(lib.filter("all", "zzzz").length, 0);
});

test("pixel art items render their packed frames at the chosen rate", () => {
  const f1 = new Frame(); f1.fillRect(0, 0, 8, 16, "#ff0000");
  const f2 = new Frame(); f2.fillRect(8, 0, 8, 16, "#00ff00");
  const scene = itemScene({ id: "u1", kind: "art", frames: [packFrame(f1), packFrame(f2)], fps: 2, label: "Blink" });
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer, options: () => ({ motion: "all" }) });
  assert.ok(scenes.render(scene, 0).equals(f1));
  assert.ok(scenes.render(scene, 600).equals(f2));
  assert.ok(scenes.render(scene, 1100).equals(f1));
  assert.ok(scenes.render(scene, 600, { poster: true }).equals(f1));
  assert.deepEqual(scenes.plan(scene), { mode: "frames", animated: true, stepMs: 500, minGapMs: 250 });
  assert.equal(scenes.plan({ ...scene, frames: [packFrame(f1)] }).animated, false);
  assert.notEqual(sceneKey(scene), sceneKey({ ...scene, rev: 2 }), "edits restart the scene");
});

test("trip meter: distance, moving time, max, stops, hard brakes; ignores gaps", () => {
  const t = new TripMeter();
  let now = 1_000_000;
  for (let i = 0; i < 60; i++) t.update({ kmh: 36 }, (now += 1000)); // 10 m/s for a minute
  assert.ok(Math.abs(t.distanceM - 590) < 20, `${t.distanceM}`);
  assert.equal(Math.round(t.avgKmh), 36);
  t.update({ kmh: 80, braking: true }, (now += 1000));
  t.update({ kmh: 60, braking: true }, (now += 1000));
  t.update({ kmh: 0, braking: false }, (now += 1000));
  assert.equal(t.maxKmh, 80);
  assert.equal(t.hardBrakes, 1, "one braking event, not one per sample");
  assert.equal(t.stops, 1);
  const before = t.distanceM;
  t.update({ kmh: 100 }, (now += 60000)); // GPS came back after a minute
  assert.equal(t.distanceM, before, "a long gap adds nothing");
  for (let i = 0; i < 20; i++) t.update({ kmh: 0 }, (now += 1000));
  assert.ok(t.stoppedMs >= 19000);
  assert.ok(t.samples.length >= 15);
  const back = new TripMeter(JSON.parse(JSON.stringify(t)));
  assert.equal(back.maxKmh, 100);
  assert.equal(Math.round(back.distanceM), Math.round(t.distanceM));
  assert.equal(formatDuration(3_725_000), "1h 02m");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDistance(1234), "1.23 km");
  assert.equal(formatDistance(16093.44, "mph"), "10.0 mi");
});

// Independent GIF reader (header + LZW) to prove the encoder's output decodes.
function decodeGif(bytes) {
  let p = 6;
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const width = u16(), height = u16();
  const packed = bytes[p++]; p += 2;
  const size = 1 << ((packed & 7) + 1);
  const palette = [];
  for (let i = 0; i < size; i++) { palette.push("#" + [0, 1, 2].map((k) => bytes[p + k].toString(16).padStart(2, "0")).join("")); p += 3; }
  const frames = [];
  let loops = false;
  while (bytes[p] !== 0x3b) {
    if (bytes[p] === 0x21) {
      if (bytes[p + 1] === 0xff) loops = true;
      p += 2;
      while (bytes[p]) p += bytes[p] + 1;
      p++;
      continue;
    }
    assert.equal(bytes[p++], 0x2c);
    p += 9;
    const min = bytes[p++];
    const data = [];
    while (bytes[p]) { data.push(...bytes.slice(p + 1, p + 1 + bytes[p])); p += bytes[p] + 1; }
    p++;
    const clear = 1 << min, eoi = clear + 1;
    let codeSize = min + 1, dict = [], prev = null, bitPos = 0;
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = null; codeSize = min + 1; prev = null; };
    reset();
    const out = [];
    for (;;) {
      let code = 0;
      for (let i = 0; i < codeSize; i++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry;
      if (code < dict.length) entry = dict[code];
      else if (code === dict.length && prev) entry = [...prev, prev[0]];
      else throw new Error(`bad LZW code ${code}`);
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    frames.push(out);
  }
  return { width, height, palette, frames, loops };
}

test("GIF encoder output decodes back to the same frames", () => {
  const frames = [0, 250, 500, 750].map((t) => fxFrame("equalizer", t));
  const noisy = new Frame();
  for (let i = 0; i < 96 * 16; i++) if ((i * 7919) % 5 < 2) noisy.px[i] = noisy.ink(["#ff0000", "#00ff00", "#0000ff", "#ffffff"][(i * 31) % 4]);
  frames.push(noisy);
  const gif = encodeGif(frames, { delayMs: 250 });
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), "GIF89a");
  assert.equal(gif[gif.length - 1], 0x3b);
  const d = decodeGif(gif);
  assert.deepEqual([d.width, d.height, d.frames.length, d.loops], [96, 16, frames.length, true]);
  frames.forEach((f, i) => {
    assert.equal(d.frames[i].length, 96 * 16);
    for (let k = 0; k < f.px.length; k++) assert.equal(d.palette[d.frames[i][k]], f.pal[f.px[k]] ?? "#000000", `frame ${i} px ${k}`);
  });
  assert.ok(gif.length < 6000, `${gif.length} B`);
  const single = decodeGif(encodeGif([frames[0]]));
  assert.equal(single.frames.length, 1);
  assert.equal(single.loops, false);
});
