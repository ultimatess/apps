// Picture pack: every cartoon renders, animates, fits the panel and plays as a mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PICS, PIC_IDS, PIC_STEP_MS, picFrame, picLoopMs } from "../../js/pictures.js";
import { quantize } from "../../js/frame.js";
import { createScenes, sceneKey, describeScene, sceneTint } from "../../js/scene.js";
import { pixelOnlyRasterizer } from "../../js/text.js";
import { DEFAULT_SETTINGS } from "../../js/store.js";
import { BUILTIN_ITEMS, GROUPS, itemScene } from "../../js/library.js";
import { MODES, buildProgramme } from "../../js/modes.js";

test("twelve pictures: four stories and eight memes, each with a label, colour and a poster inside its loop", () => {
  assert.equal(PIC_IDS.length, 12);
  assert.equal(PIC_IDS.filter((id) => PICS[id].group === "story").length, 4);
  assert.equal(PIC_IDS.filter((id) => PICS[id].group === "meme").length, 8);
  for (const id of PIC_IDS) {
    const p = PICS[id];
    assert.ok(p.label && /^#[0-9a-f]{6}$/.test(p.color), id);
    const loop = picLoopMs(id);
    assert.ok(loop >= 5000 && loop <= 15000, `${id}: ${loop} ms`);
    assert.ok(p.posterAt >= 0 && p.posterAt < loop, `${id}: poster inside the loop`);
    assert.ok(p.shots.every(([ms]) => ms % PIC_STEP_MS === 0), `${id}: shots land on panel steps`);
  }
});

test("every step of every picture renders a lit 96x16 frame, and each picture moves", () => {
  for (const id of PIC_IDS) {
    const keys = new Set();
    for (let t = 0; t < picLoopMs(id); t += PIC_STEP_MS) {
      const f = picFrame(id, t);
      assert.equal(f.width, 96);
      assert.equal(f.height, 16);
      assert.ok(quantize(f).litCount() > 10, `${id} @${t} is lit`);
      keys.add(f.key());
    }
    assert.ok(keys.size >= 6, `${id} has ${keys.size} distinct frames`);
    assert.ok(picFrame(id, 0, { poster: true }).litCount() > 60, `${id} poster is a real picture`);
    assert.equal(picFrame(id, 123).key(), picFrame(id, 123 + picLoopMs(id)).key(), `${id} loops`);
  }
});

test("captions fit: no text is cut off at the panel edges", () => {
  // Any lit pixel in the outermost column on both sides at once would mean a caption ran off.
  for (const id of PIC_IDS) {
    for (let t = 0; t < picLoopMs(id); t += PIC_STEP_MS) {
      const f = picFrame(id, t);
      let left = 0, right = 0;
      for (let y = 0; y < 16; y++) { if (f.get(0, y)) left++; if (f.get(95, y)) right++; }
      assert.ok(left < 12 && right < 12, `${id} @${t}: edge columns ${left}/${right}`);
    }
  }
});

test("pictures are a scene kind: animated with motion, still without; speed stretches them", () => {
  const S = { ...DEFAULT_SETTINGS };
  const scenes = createScenes({ rasterize: pixelOnlyRasterizer, options: () => S });
  const scene = { kind: "pic", id: "race" };
  assert.deepEqual(scenes.plan(scene), { mode: "frames", animated: true, stepMs: 250, minGapMs: 250 });
  S.motion = "signals";
  assert.equal(scenes.plan(scene).animated, false);
  assert.equal(scenes.render(scene, 5000, { poster: true }).key(), picFrame("race", 0, { poster: true }).key());
  S.motion = "all";
  assert.equal(scenes.render(scene, 3000).key(), picFrame("race", 3000).key());
  S.speed = 1;
  assert.equal(scenes.render(scene, 6000).key(), picFrame("race", 3000).key(), "slowest: half speed");
  assert.equal(sceneKey({ ...scene, nonce: 3 }), "pic|race|3");
  assert.equal(describeScene(scene), "Hare & tortoise");
  assert.equal(sceneTint(scene), PICS.race.color);
});

test("library: a Pictures group with every picture; a Picture pack mode plays each once", () => {
  assert.ok(GROUPS.some((g) => g.id === "pics"));
  const items = BUILTIN_ITEMS.filter((i) => i.group === "pics");
  assert.deepEqual(items.map((i) => i.pic).sort(), PIC_IDS.slice().sort());
  assert.deepEqual(itemScene(items[0]), { kind: "pic", id: items[0].pic });
  assert.ok(MODES.pics);
  const prog = buildProgramme("pics", { seed: 5 });
  assert.equal(prog.units, 12);
  assert.deepEqual(prog.items.map((i) => i.scene.id).sort(), PIC_IDS.slice().sort());
  for (const it of prog.items) assert.equal(it.secs, picLoopMs(it.scene.id) / 1000, `${it.scene.id} plays one full pass`);
  const slow = buildProgramme("pics", { seed: 5, pace: 2 });
  assert.equal(slow.items[0].secs, prog.items[0].secs * 2);
  assert.deepEqual(buildProgramme("pics", { seed: 5, lang: "ta" }).units, 12, "pictures play in any language");
});
