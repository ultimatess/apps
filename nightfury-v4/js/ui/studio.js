// Studio tab: the text composer and the pixel editor. Whatever is being edited is
// shown on the stage as a DRAFT (preview only) until it is sent.
import { $, bindSeg, h, icon, markSeg, openSheet, toast } from "./dom.js";
import { drawThumb } from "./led.js";
import { COLS, ROWS } from "../protocol.js";
import { Frame, packFrame, unpackFrame } from "../frame.js";
import { PALETTE } from "../scene.js";
import { describeLayout } from "../text.js";
import { isPixelFontText, renderText } from "../font5x7.js";
import { ICON_LABELS, ICON_NAMES, icon as pixelIcon } from "../icons.js";

const MAX_FRAMES = 24;
const ZOOM_COLS = 32;

export function mountStudio(ctx) {
  const { store, S, engine, scenes, fb, bus } = ctx;
  let mode = "text";
  let editingText = null; // id of the saved text item being edited
  let sentKey = ""; // what was last sent from here: an unchanged draft is not shown as DRAFT again

  // ================================================================== text

  const textScene = () => ({
    kind: "text", text: $("composeInput").value.trim(), color: S.color, color2: S.color2,
    paint: S.paint, effect: S.effect, size: S.size,
  });

  function palette(el, key) {
    el.replaceChildren();
    for (const c of PALETTE) {
      el.append(h("button", {
        class: "swatch", style: { "--c": c }, dataset: { color: c }, "aria-label": `Colour ${c}`,
        onclick: () => { fb.tap(); store.set({ [key]: c }); syncText(); },
      }));
    }
    const input = h("input", { type: "color", value: S[key], "aria-label": "Custom colour", oninput: (e) => { store.set({ [key]: e.target.value }); syncText(); } });
    el.append(h("label", { class: "swatch swatch-custom", title: "Custom colour" }, input));
  }

  function syncText() {
    markSeg($("effectSeg"), S.effect);
    markSeg($("sizeSeg"), S.size);
    markSeg($("paintSeg"), S.paint);
    markSeg($("voiceLang"), S.voiceLang);
    $("colorRow").hidden = S.paint === "rainbow";
    $("color2Row").hidden = S.paint !== "duo";
    for (const [id, key] of [["palette", "color"], ["palette2", "color2"]]) {
      $(id).querySelectorAll(".swatch[data-color]").forEach((s) => s.classList.toggle("on", s.dataset.color === S[key]));
    }
    $("saveMsgLabel").textContent = editingText ? "Update" : "Save";

    const scene = textScene();
    const hint = $("fitHint");
    if (!scene.text) {
      hint.textContent = "Type something to see it on the panel above.";
      hint.classList.remove("warn");
    } else {
      const layout = scenes.textLayout(scene);
      const d = describeLayout(layout);
      const scrolls = layout.kind === "scroll";
      const forced = scrolls && ["static", "blink", "words"].includes(S.effect);
      const smallSkipped = S.size === "small" && !isPixelFontText(scene.text);
      hint.textContent = forced ? `Too wide for ${S.effect}: it will scroll instead (${layout.raster.width}px)`
        : smallSkipped ? "Two-line size needs A–Z / 0–9 text; using the big size"
          : d.label;
      hint.classList.toggle("warn", forced || smallSkipped);
    }
    updateDraft();
  }

  function sendText() {
    const scene = textScene();
    if (!scene.text) return toast("Type a message first");
    sentKey = JSON.stringify(scene);
    ctx.sendScene(scene, scene.text, { keep: true });
  }

  function saveText() {
    const scene = textScene();
    if (!scene.text) return toast("Type a message first");
    fb.tap();
    const { kind, ...fields } = scene;
    const stored = store.saveItem({ id: editingText ?? undefined, kind, ...fields, label: scene.text });
    toast(editingText ? "Updated" : "Saved to Library › Mine");
    editingText = stored.id;
    syncText();
    bus.emit("library");
  }

  function dictate() {
    fb.tap();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast("Voice input isn't supported in this browser");
    const mic = $("micBtn");
    const rec = new SR();
    rec.lang = S.voiceLang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    mic.classList.add("listening");
    toast(S.voiceLang === "ta-IN" ? "பேசுங்கள்…" : "Listening…");
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript.trim();
      if (!text) return;
      $("composeInput").value = text;
      editingText = null;
      syncText();
      sendText();
    };
    rec.onerror = (e) => toast(`Voice: ${e.error}`);
    rec.onend = () => mic.classList.remove("listening");
    rec.start();
  }

  // ================================================================== pixel

  const px = {
    frames: [new Frame()],
    idx: 0,
    tool: "pen",
    color: PALETTE[0],
    zoom: "fit",
    viewX: 0,
    fps: 4,
    editId: null,
    rev: 0,
    undo: [],
    redo: [],
    last: null, // last painted cell during a stroke
  };
  const canvas = $("pxCanvas");
  const g = canvas.getContext("2d");
  const cur = () => px.frames[px.idx];

  const snapshot = () => ({ frames: px.frames.map((f) => f.clone()), idx: px.idx });
  function remember() {
    px.undo.push(snapshot());
    if (px.undo.length > 60) px.undo.shift();
    px.redo.length = 0;
  }
  function restore(from, to) {
    const snap = from.pop();
    if (!snap) return;
    to.push(snapshot());
    px.frames = snap.frames;
    px.idx = Math.min(snap.idx, px.frames.length - 1);
    changed(true);
  }

  const visibleCols = () => (px.zoom === "zoom" ? ZOOM_COLS : COLS);

  function drawEditor() {
    const cols = visibleCols();
    const cssW = canvas.clientWidth || 320;
    const cell = cssW / cols;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(cssW * dpr), hgt = Math.round(cell * ROWS * dpr);
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
    const c = cell * dpr;
    const f = cur();
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, hgt);
    const x0 = px.zoom === "zoom" ? px.viewX : 0;
    const r = Math.max(0.5, c * 0.42);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < cols; x++) {
        const v = f.px[y * COLS + x0 + x];
        g.fillStyle = v ? f.pal[v] : "rgba(255,255,255,0.07)";
        g.beginPath();
        g.arc((x + 0.5) * c, (y + 0.5) * c, v ? r : r * 0.55, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Chunk boundaries: the panel has one colour per 8-pixel block.
    g.fillStyle = "rgba(255,255,255,0.14)";
    for (let x = 0; x <= cols; x++) if ((x0 + x) % 8 === 0 && x > 0 && x < cols) g.fillRect(Math.round(x * c), 0, 1, hgt);
  }

  function drawNav() {
    const nav = $("pxNav");
    nav.hidden = px.zoom !== "zoom";
    if (nav.hidden) return;
    drawThumb(nav, cur(), 4);
    const n = nav.getContext("2d");
    n.strokeStyle = "#b9f227";
    n.lineWidth = 2;
    n.strokeRect(px.viewX * 4 + 1, 1, ZOOM_COLS * 4 - 2, ROWS * 4 - 2);
  }

  function renderFrames() {
    const strip = $("pxFrames");
    strip.replaceChildren(...px.frames.map((f, i) => {
      const c = h("canvas", {});
      drawThumb(c, f, 2);
      return h("button", { class: `px-frame${i === px.idx ? " on" : ""}`, "aria-label": `Frame ${i + 1}`, onclick: () => { px.idx = i; changed(false); } }, c, h("span", {}, String(i + 1)));
    }));
    if (px.frames.length < MAX_FRAMES) strip.append(h("button", { class: "px-add", "aria-label": "Add frame", onclick: addFrame }, icon("plus")));
    if (px.frames.length > 1) strip.append(h("button", { class: "px-add", "aria-label": "Delete this frame", onclick: deleteFrame }, icon("trash")));
  }

  /** Redraw after a change. `content` = pixels changed (not just the selection). */
  function changed(content = true) {
    if (content) px.rev++;
    drawEditor();
    drawNav();
    renderFrames();
    $("pxUndo").disabled = !px.undo.length;
    $("pxRedo").disabled = !px.redo.length;
    updateDraft();
  }

  const artScene = () => ({
    kind: "art", id: px.editId ?? "draft", rev: px.rev, fps: px.fps, name: $("pxName").value.trim() || "Pixel art",
    frames: px.frames.map(packFrame), tint: px.frames[0].dominant(px.color),
  });
  /** Draft for the stage: shows the frame being edited, or plays when there are several. */
  const artDraft = () => ({ kind: "art", id: "studio", rev: `${px.rev}.${px.idx}`, fps: px.fps, name: "Pixel art", frames: [packFrame(cur())] });

  function cellAt(e) {
    const rect = canvas.getBoundingClientRect();
    const cell = rect.width / visibleCols();
    const x = Math.floor((e.clientX - rect.left) / cell) + (px.zoom === "zoom" ? px.viewX : 0);
    const y = Math.floor((e.clientY - rect.top) / cell);
    return { x: Math.max(0, Math.min(COLS - 1, x)), y: Math.max(0, Math.min(ROWS - 1, y)) };
  }

  function plot(x, y) {
    cur().set(x, y, px.tool === "erase" ? null : px.color);
  }

  function line(a, b) {
    let { x, y } = a;
    const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x, y);
      if (x === b.x && y === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  function flood(x, y) {
    const f = cur();
    const target = f.get(x, y);
    const ink = px.color;
    if (target === ink) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || f.get(cx, cy) !== target) continue;
      f.set(cx, cy, ink);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  function pointerDown(e) {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    remember();
    const c = cellAt(e);
    if (px.tool === "fill") { flood(c.x, c.y); px.last = null; }
    else { plot(c.x, c.y); px.last = c; }
    changed(true);
  }
  function pointerMove(e) {
    if (!px.last) return;
    const c = cellAt(e);
    if (c.x === px.last.x && c.y === px.last.y) return;
    line(px.last, c);
    px.last = c;
    px.rev++;
    drawEditor();
    updateDraft();
  }
  function pointerUp() {
    if (!px.last) return;
    px.last = null;
    changed(true);
  }

  function transform(fn) {
    remember();
    const src = cur();
    const out = new Frame();
    fn(src, out);
    px.frames[px.idx] = out;
    changed(true);
  }

  const ACTIONS = {
    left: () => transform((s, o) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) o.set(x, y, s.get((x + 1) % COLS, y)); }),
    right: () => transform((s, o) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) o.set(x, y, s.get((x + COLS - 1) % COLS, y)); }),
    up: () => transform((s, o) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) o.set(x, y, s.get(x, (y + 1) % ROWS)); }),
    down: () => transform((s, o) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) o.set(x, y, s.get(x, (y + ROWS - 1) % ROWS)); }),
    mirror: () => transform((s, o) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) o.set(x, y, s.get(COLS - 1 - x, y)); }),
    invert: () => transform((s, o) => { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) o.set(x, y, s.get(x, y) ? null : px.color); }),
    clear: () => transform(() => {}),
    stamp: stampSheet,
    text: textSheet,
  };

  /** Place a 1-bit bitmap centred in the visible part of the canvas. */
  function stamp(bmp) {
    remember();
    const cols = visibleCols();
    const x0 = (px.zoom === "zoom" ? px.viewX : 0) + Math.floor((cols - bmp.width) / 2);
    cur().paint(bmp, px.color, Math.max(0, Math.min(COLS - bmp.width, x0)), Math.floor((ROWS - bmp.height) / 2));
    changed(true);
  }

  function stampSheet() {
    const close = openSheet("Stamp", h("div", { class: "stamps" }, ICON_NAMES.flatMap((name) => {
      const variants = name === "arrow" ? [[false, "Arrow right"], [true, "Arrow left"]] : [[false, ICON_LABELS[name] ?? name]];
      return variants.map(([flip, label]) => {
        const bmp = pixelIcon(name, { flip });
        const f = new Frame(16, 16).paint(bmp, px.color, Math.floor((16 - bmp.width) / 2), Math.floor((16 - bmp.height) / 2));
        const c = h("canvas", {});
        drawThumb(c, f, 3);
        return h("button", { onclick: () => { close(); stamp(bmp); } }, c, label);
      });
    })));
  }

  function textSheet() {
    const input = h("input", { class: "input", maxlength: 16, placeholder: "A–Z, 0–9", autocomplete: "off", "aria-label": "Text to stamp" });
    const place = (scale) => {
      const text = input.value.trim().toUpperCase();
      if (!text) return;
      if (!isPixelFontText(text)) return toast("Pixel text supports A–Z, 0–9 and basic punctuation");
      const bmp = renderText(text, { scale });
      if (bmp.width > COLS) return toast("Too long for the panel at this size");
      $("sheet").close();
      stamp(bmp);
    };
    openSheet("Stamp text", [
      input,
      h("div", { class: "row" },
        h("button", { class: "btn grow", onclick: () => place(1) }, "Small"),
        h("button", { class: "btn btn-primary grow", onclick: () => place(2) }, "Big")),
    ]);
    setTimeout(() => input.focus(), 50);
  }

  function addFrame() {
    fb.tap();
    remember();
    px.frames.splice(px.idx + 1, 0, cur().clone());
    px.idx++;
    changed(true);
  }

  function deleteFrame() {
    fb.tap();
    remember();
    px.frames.splice(px.idx, 1);
    px.idx = Math.max(0, px.idx - 1);
    changed(true);
  }

  function newArt() {
    fb.tap();
    remember();
    px.frames = [new Frame()];
    px.idx = 0;
    px.editId = null;
    $("pxName").value = "";
    changed(true);
    toast("New canvas (undo brings the old one back)");
  }

  function saveArt() {
    if (!px.frames.some((f) => f.litCount())) return toast("Draw something first");
    fb.tap();
    const scene = artScene();
    const stored = store.saveItem({ id: px.editId ?? undefined, kind: "art", label: scene.name, frames: scene.frames, fps: px.fps, color: scene.tint });
    toast(px.editId ? "Updated" : "Saved to Library › Mine");
    px.editId = stored.id;
    bus.emit("library");
  }

  function sendArt() {
    if (!px.frames.some((f) => f.litCount())) return toast("Draw something first");
    const scene = artScene();
    sentKey = `art|${px.rev}|${px.idx}|${px.fps}`;
    ctx.sendScene({ ...scene, rev: `${scene.rev}.${Date.now()}` }, scene.name || "Pixel art", { keep: true });
  }

  function pxPalette() {
    const el = $("pxPalette");
    el.replaceChildren();
    const pick = (c) => { px.color = c; if (px.tool === "erase") { px.tool = "pen"; markSeg($("pxTool"), "pen"); } mark(); };
    const mark = () => el.querySelectorAll(".swatch[data-color]").forEach((s) => s.classList.toggle("on", s.dataset.color === px.color));
    for (const c of PALETTE) el.append(h("button", { class: "swatch", style: { "--c": c }, dataset: { color: c }, "aria-label": `Colour ${c}`, onclick: () => { fb.tap(); pick(c); } }));
    el.append(h("label", { class: "swatch swatch-custom", title: "Custom colour" }, h("input", { type: "color", value: px.color, "aria-label": "Custom colour", oninput: (e) => pick(e.target.value) })));
    mark();
  }

  function navDrag(e) {
    const rect = $("pxNav").getBoundingClientRect();
    const col = ((e.clientX - rect.left) / rect.width) * COLS - ZOOM_COLS / 2;
    px.viewX = Math.max(0, Math.min(COLS - ZOOM_COLS, Math.round(col)));
    drawEditor();
    drawNav();
  }

  // ================================================================== shared

  function updateDraft() {
    if (ctx.state.tab !== "studio") return;
    if (mode === "text") {
      const scene = textScene();
      engine.setDraft(scene.text && JSON.stringify(scene) !== sentKey ? scene : null, ctx.now());
    } else {
      const has = px.frames.some((f) => f.litCount());
      engine.setDraft(has && sentKey !== `art|${px.rev}|${px.idx}|${px.fps}` ? artDraft() : null, ctx.now());
    }
  }

  function setMode(m) {
    mode = m;
    markSeg($("studioSeg"), m);
    $("studioText").hidden = m !== "text";
    $("studioPixel").hidden = m !== "pixel";
    if (m === "pixel") changed(false);
    else syncText();
  }

  function edit(item) {
    if (item.kind === "art") {
      px.frames = (item.frames ?? []).map(unpackFrame);
      if (!px.frames.length) px.frames = [new Frame()];
      px.idx = 0;
      px.fps = item.fps ?? 4;
      px.editId = item.builtin ? null : item.id;
      px.undo.length = px.redo.length = 0;
      $("pxName").value = item.label ?? "";
      markSeg($("pxFps"), px.fps);
      setMode("pixel");
    } else {
      $("composeInput").value = item.text ?? "";
      store.set({ color: item.color ?? S.color, color2: item.color2 ?? S.color2, paint: item.paint ?? "solid", effect: item.effect ?? "auto", size: item.size ?? "big" });
      editingText = item.builtin ? null : item.id;
      setMode("text");
    }
  }

  // ------------------------------------------------------------------ bindings

  bindSeg($("studioSeg"), (v) => { fb.tap(); setMode(v); });
  $("composeInput").addEventListener("input", syncText);
  $("composeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });
  bindSeg($("effectSeg"), (v) => { fb.tap(); store.set({ effect: v }); syncText(); });
  bindSeg($("sizeSeg"), (v) => { fb.tap(); store.set({ size: v }); syncText(); });
  bindSeg($("paintSeg"), (v) => { fb.tap(); store.set({ paint: v }); syncText(); });
  bindSeg($("voiceLang"), (v) => { fb.tap(); store.set({ voiceLang: v }); });
  $("sendMsgBtn").addEventListener("click", sendText);
  $("saveMsgBtn").addEventListener("click", saveText);
  $("micBtn").addEventListener("click", dictate);

  bindSeg($("pxTool"), (v) => { fb.tap(); px.tool = v; });
  bindSeg($("pxZoom"), (v) => { fb.tap(); px.zoom = v; changed(false); });
  bindSeg($("pxFps"), (v) => { fb.tap(); px.fps = Number(v); px.rev++; updateDraft(); });
  $("pxUndo").addEventListener("click", () => { fb.tap(); restore(px.undo, px.redo); });
  $("pxRedo").addEventListener("click", () => { fb.tap(); restore(px.redo, px.undo); });
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  const nav = $("pxNav");
  nav.addEventListener("pointerdown", (e) => { nav.setPointerCapture?.(e.pointerId); nav.dataset.drag = "1"; navDrag(e); });
  nav.addEventListener("pointermove", (e) => { if (nav.dataset.drag) navDrag(e); });
  nav.addEventListener("pointerup", () => { delete nav.dataset.drag; });
  document.querySelectorAll("[data-px]").forEach((b) => b.addEventListener("click", () => { fb.tap(); ACTIONS[b.dataset.px]?.(); }));
  $("pxNewBtn").addEventListener("click", newArt);
  $("pxSaveBtn").addEventListener("click", saveArt);
  $("pxSendBtn").addEventListener("click", sendArt);
  window.addEventListener("resize", () => { if (ctx.state.tab === "studio" && mode === "pixel") { drawEditor(); drawNav(); } });

  bus.on("tab", (tab) => {
    if (tab === "studio") { if (mode === "pixel") changed(false); else syncText(); }
    else engine.setDraft(null, ctx.now());
  });
  bus.on("edit", edit);
  bus.on("settings", () => { if (mode === "text") syncText(); });

  palette($("palette"), "color");
  palette($("palette2"), "color2");
  pxPalette();
  markSeg($("pxTool"), px.tool);
  markSeg($("pxZoom"), px.zoom);
  markSeg($("pxFps"), px.fps);
  markSeg($("studioSeg"), mode);
  syncText();

  // Test handle: lets the e2e suite read the editor without poking at closures.
  ctx.pixelEditor = px;
  return null;
}
