import { test } from "node:test";
import assert from "node:assert/strict";
import { KURAL_COUNT, MODES, MODE_IDS, buildProgramme, estimateMs, kuralLines, nextUnitIndex, shuffled } from "../../js/modes.js";
import { createScenes } from "../../js/scene.js";
import { pixelOnlyRasterizer } from "../../js/text.js";
import { ShowPlayer } from "../../js/director.js";
import { Engine } from "../../js/engine.js";
import { DriveModel } from "../../js/drive.js";
import { DEFAULT_SETTINGS } from "../../js/store.js";
import { BUILTIN_ITEMS, itemScene } from "../../js/library.js";

const words = (s) => s.trim().split(/\s+/).length;

test("Thirukkural data: unique numbers, 4 + 3 word couplets, Tamil text, an English gist", () => {
  const list = kuralLines();
  assert.equal(list.length, KURAL_COUNT);
  assert.ok(list.length >= 50);
  assert.equal(new Set(list.map((k) => k.n)).size, list.length);
  for (const k of list) {
    assert.ok(k.n >= 1 && k.n <= 1330, `kural ${k.n}`);
    assert.equal(words(k.l1), 4, `kural ${k.n} line 1: ${k.l1}`);
    assert.equal(words(k.l2), 3, `kural ${k.n} line 2: ${k.l2}`);
    assert.match(k.l1 + k.l2, /^[஀-௿\s]+$/, `kural ${k.n} is Tamil only`);
    assert.match(k.gist, /^[A-Z0-9 .,'-]+$/, `kural ${k.n} gist fits the pixel font`);
  }
  assert.equal(list.find((k) => k.n === 391).l1, "கற்க கசடறக் கற்பவை கற்றபின்");
});

test("kural programme: title, two lines, gist per couplet; language filters", () => {
  const both = buildProgramme("kural", { lang: "both" });
  assert.equal(both.id, "mode.kural");
  assert.equal(both.units, KURAL_COUNT);
  assert.equal(both.items.length, KURAL_COUNT * 4);
  assert.deepEqual(both.items.slice(0, 4).map((i) => i.scene.text), ["குறள் 1", "அகர முதல எழுத்தெல்லாம் ஆதி", "பகவன் முதற்றே உலகு", "EVERYTHING HAS A FIRST CAUSE"]);
  assert.ok(both.items.slice(0, 4).every((i) => i.unit === 0 && i.label === "குறள் 1"));
  const ta = buildProgramme("kural", { lang: "ta" });
  assert.equal(ta.items.length, KURAL_COUNT * 3);
  assert.ok(ta.items.every((i) => !/[A-Z]{3}/.test(i.scene.text)));
  const en = buildProgramme("kural", { lang: "en" });
  assert.equal(en.items.length, KURAL_COUNT * 2);
  assert.equal(en.items[0].scene.text, "KURAL 1");
  assert.equal(en.items[0].scene.size, "small");
});

test("story programme: title, beats, moral and a smile; both languages interleave", () => {
  const en = buildProgramme("story", { lang: "en" });
  assert.equal(en.units, 6);
  const first = en.items.filter((i) => i.unit === 0);
  assert.equal(first[0].scene.text, "THE THIRSTY CROW");
  assert.equal(first.at(-1).scene.kind, "eyes");
  assert.equal(first.at(-2).scene.text, "THINK. THEN DRINK");
  assert.equal(first.length, 7);
  const both = buildProgramme("story", { lang: "both" });
  assert.equal(both.units, 12);
  assert.equal(both.items.find((i) => i.unit === 0).scene.text, "தாகமான காகம்");
  assert.equal(both.items.find((i) => i.unit === 1).scene.text, "THE THIRSTY CROW");
});

test("comedy programme: set-up, punchline, laugh; language filters jokes", () => {
  const en = buildProgramme("comedy", { lang: "en" });
  const ta = buildProgramme("comedy", { lang: "ta" });
  const both = buildProgramme("comedy", { lang: "both" });
  assert.equal(en.units + ta.units, both.units);
  assert.ok(en.units >= 8 && ta.units >= 8);
  assert.deepEqual(en.items.slice(0, 3).map((i) => i.scene.text ?? i.scene.kind), ["WHY DID THE CAR NAP?", "IT WAS TYRED", "eyes"]);
  assert.ok(ta.items.every((i) => i.scene.kind === "eyes" || /[஀-௿]/.test(i.scene.text)));
  assert.equal(both.items.length, both.units * 3);
});

test("friends programme: a fun line then a wink, filtered by language", () => {
  const en = buildProgramme("friends", { lang: "en" });
  const ta = buildProgramme("friends", { lang: "ta" });
  const both = buildProgramme("friends", { lang: "both" });
  assert.equal(en.units, 10);
  assert.equal(ta.units, 10);
  assert.equal(both.items.length, 40);
  assert.deepEqual(en.items.slice(0, 2).map((i) => i.scene.text ?? i.scene.kind), ["BESTIES ON BOARD", "eyes"]);
  assert.ok(ta.items.filter((i) => i.scene.kind === "text").every((i) => /[\u0B80-\u0BFF]/.test(i.scene.text)));
  assert.equal(new Set(both.items.filter((i) => i.scene.kind === "text").map((i) => i.scene.text)).size, 20);
});

test("TVK programme: one line per beat in the two party colours, filtered by language", () => {
  const ta = buildProgramme("tvk", { lang: "ta" });
  const en = buildProgramme("tvk", { lang: "en" });
  assert.equal(ta.items[0].scene.text, "தமிழக வெற்றிக் கழகம்");
  assert.equal(ta.items[1].scene.text, "பிறப்பொக்கும் எல்லா உயிர்க்கும்", "the party motto is the first half of Kural 972");
  assert.ok(kuralLines().find((k) => k.n === 972).l1.startsWith("பிறப்பொக்கும் எல்லா உயிர்க்கும்"));
  assert.equal(en.items[0].scene.text, "TVK");
  for (const it of [...ta.items, ...en.items]) {
    assert.deepEqual([it.scene.paint, it.scene.color, it.scene.color2], ["duo", "#ff1a1a", "#ffd000"]);
  }
  assert.equal(ta.units + en.units, buildProgramme("tvk", { lang: "both" }).units);
  assert.ok(en.items.every((i) => /^[A-Z ]+$/.test(i.scene.text)), "English lines fit the pixel font");
});

test("style and timing: words style flashes words; every beat gets a sane duration", () => {
  const scroll = buildProgramme("comedy", { lang: "en", style: "scroll" });
  const wordsP = buildProgramme("comedy", { lang: "en", style: "words" });
  assert.equal(scroll.items[0].scene.effect, "auto");
  assert.equal(wordsP.items[0].scene.effect, "words");
  for (const mode of MODE_IDS) {
    for (const it of buildProgramme(mode, { lang: "both" }).items) assert.ok(it.secs >= 1.5 && it.secs <= 40, `${mode}: ${it.secs}s`);
  }
  const measured = buildProgramme("comedy", { lang: "en", measure: () => 7777 });
  assert.equal(measured.items[0].secs, 7.8);
  assert.equal(measured.items[2].secs, 2.2, "fixed beats ignore the measure");
  assert.ok(estimateMs({ kind: "text", text: "A LONG LINE OF TEXT THAT SCROLLS", effect: "auto" }) > estimateMs({ kind: "text", text: "HI", effect: "auto" }));
});

test("shuffle is deterministic per seed, keeps every unit, and seed 0 keeps order", () => {
  assert.deepEqual(shuffled([1, 2, 3, 4, 5], 0), [1, 2, 3, 4, 5]);
  const a = shuffled([...Array(30).keys()], 42), b = shuffled([...Array(30).keys()], 42), c = shuffled([...Array(30).keys()], 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.slice().sort((x, y) => x - y), [...Array(30).keys()]);
  const p1 = buildProgramme("kural", { seed: 7 }), p2 = buildProgramme("kural", { seed: 7 });
  assert.deepEqual(p1.items.map((i) => i.label), p2.items.map((i) => i.label));
  assert.notEqual(p1.items[0].label, buildProgramme("kural", { seed: 0 }).items[0].label === p1.items[0].label && buildProgramme("kural", { seed: 8 }).items[0].label === p1.items[0].label ? p1.items[0].label : "");
  assert.equal(new Set(p1.items.map((i) => i.label)).size, KURAL_COUNT);
});

test("every beat of every mode renders and plans", () => {
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer, options: () => ({ motion: "all" }) });
  for (const mode of MODE_IDS) {
    for (const style of ["scroll", "words"]) {
      for (const it of buildProgramme(mode, { lang: "both", style }).items) {
        assert.equal(scenes.render(it.scene, 300).width, 96);
        assert.ok(scenes.plan(it.scene).mode);
      }
    }
  }
  assert.equal(buildProgramme("nope"), null);
});

test("next-unit skip jumps to the start of the next couplet and wraps", () => {
  const p = buildProgramme("kural", { lang: "both" });
  assert.equal(nextUnitIndex(p, 0), 4);
  assert.equal(nextUnitIndex(p, 3), 4);
  assert.equal(nextUnitIndex(p, 5), 8);
  assert.equal(nextUnitIndex(p, p.items.length - 1), 0);
});

test("a mode plays through the engine as idle content with inline scenes", () => {
  const S = { ...DEFAULT_SETTINGS, hud: "full" };
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer, options: () => S });
  const engine = new Engine({ panel: null, scenes, drive: new DriveModel({ options: () => S }), settings: () => S });
  const p = buildProgramme("comedy", { lang: "en", measure: () => 3000 });
  assert.equal(engine.playShow(p, 0), true);
  assert.equal(engine.tick(100).text, "WHY DID THE CAR NAP?");
  assert.equal(engine.tick(3100).text, "IT WAS TYRED");
  assert.equal(engine.tick(6100).kind, "eyes");
  assert.equal(engine.tick(8300).text, "I TOLD MY CAR A JOKE");
  engine.sim = { kmh: 40, turn: "straight" };
  assert.equal(engine.tick(8400).kind, "speed", "the HUD still wins while moving");
  engine.sim = null;
  const player = new ShowPlayer();
  player.play(p, 0);
  assert.equal(player.position(0).item.unit, 0);
});

test("modes are library items with a cover card, and are pinned by default", () => {
  for (const id of MODE_IDS) {
    const item = BUILTIN_ITEMS.find((i) => i.id === `mode.${id}`);
    assert.ok(item, id);
    assert.equal(item.kind, "mode");
    assert.equal(itemScene(item), MODES[id].cover);
  }
});

test("pace stretches the fixed beats (title cards, eyes) and leaves measured ones to the layout", () => {
  const normal = buildProgramme("kural", { lang: "ta", seed: 7 });
  const slow = buildProgramme("kural", { lang: "ta", seed: 7, pace: 2 });
  const fast = buildProgramme("comedy", { lang: "en", seed: 7, pace: 0.6 });
  assert.equal(normal.items[0].secs, 2.2);
  assert.equal(slow.items[0].secs, 4.4, "title card held twice as long");
  assert.equal(slow.items[1].secs, normal.items[1].secs, "measured beats come from the measure function");
  assert.equal(fast.items[2].secs, 1.5, "eyes beat shortened, held at the 1.5 s floor");
  assert.equal(slow.seed, 7, "the seed is kept so a running mode can be re-timed in place");
  assert.deepEqual(slow.items.map((i) => i.label), normal.items.map((i) => i.label), "same seed, same order");
  const measured = buildProgramme("tvk", { lang: "en", measure: () => 5000, pace: 2 });
  assert.ok(measured.items.every((i) => i.secs === 5));
});
