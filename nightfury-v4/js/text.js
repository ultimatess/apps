// Text layout: turns a text item into coloured frames or a scroll raster.
//
//   size    big    16-row text (2x pixel font for Latin, canvas raster for Tamil/emoji)
//           small  5x7 pixel font, two lines per page (Latin only; otherwise falls back to big)
//   paint   solid | rainbow (one hue per 8-column chunk) | duo (words alternate two colours)
//   effect  auto | static | scroll | words (one big word at a time) | blink
//
// `rasterize(text)` is injected (textraster.js in the browser, pixelRaster in tests).
import { COLS, ROWS, MAX_CHUNKS } from "./protocol.js";
import { Bitmap } from "./bitmap.js";
import { Frame, hsl } from "./frame.js";
import { isPixelFontText, measure, renderText } from "./font5x7.js";

const WORD_GAP = 6;
const PAGE_MS = 2600;

export const EFFECTS = ["auto", "static", "scroll", "words", "blink"];
export const PAINTS = ["solid", "rainbow", "duo"];

const rainbowAt = (x) => hsl((Math.floor(x / 8) * 30) % 360);

function words(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Paint a 1-bit mask (already positioned on its target width) according to the spec. */
function paintMask(mask, spec, dx = 0, dy = 0, target = null) {
  const f = target ?? new Frame(mask.width, mask.height);
  const color = spec.paint === "rainbow" ? (x) => rainbowAt(x) : spec.color;
  return f.paint(mask, color, dx, dy);
}

/** Crop a raster to its lit columns (rasters carry a little side padding for scrolling). */
function trimX(bmp) {
  const b = bmp.bounds();
  if (!b || (b.x === 0 && b.w === bmp.width)) return bmp;
  return new Bitmap(b.w, bmp.height).blit(bmp, -b.x, 0);
}

/** Words laid out so each starts on a chunk boundary: "duo" colours stay exact on the panel. */
function duoRaster(spec, rasterize) {
  const parts = words(spec.text).map((w) => trimX(rasterize(w)));
  let x = 0;
  const places = parts.map((bmp) => {
    const at = x;
    x = Math.ceil((x + bmp.width + WORD_GAP) / 8) * 8;
    return at;
  });
  const width = parts.length ? places[places.length - 1] + parts[parts.length - 1].width : 1;
  const f = new Frame(width, ROWS);
  parts.forEach((bmp, i) => f.paint(bmp, i % 2 ? spec.color2 ?? "#ffffff" : spec.color, places[i], 0));
  return f;
}

/** One 16-row raster of the whole text, for scrolling. */
function bigRaster(spec, rasterize) {
  return spec.paint === "duo" ? duoRaster(spec, rasterize) : paintMask(rasterize(spec.text), spec);
}

/** The text centred on the panel, or null when it is too wide to show without scrolling. */
function staticFrame(spec, rasterize) {
  if (spec.paint === "duo") {
    const r = duoRaster(spec, rasterize);
    if (r.width > COLS) return null;
    return new Frame().blit(r, Math.floor((COLS - r.width) / 16) * 8, 0); // keep words on chunk boundaries
  }
  const bmp = trimX(rasterize(spec.text));
  if (bmp.width > COLS) return null;
  // Painted after centring, so rainbow hues follow the panel's chunks.
  return paintMask(bmp, spec, Math.floor((COLS - bmp.width) / 2), Math.floor((ROWS - bmp.height) / 2), new Frame());
}

function wrapSmall(text) {
  const lines = [];
  let line = "";
  for (const w of words(text.toUpperCase())) {
    let word = w;
    while (measure(word) > COLS) {
      // Hard-split a word that can never fit on one line.
      let n = word.length - 1;
      while (n > 1 && measure(word.slice(0, n)) > COLS) n--;
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, n));
      word = word.slice(n);
    }
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= COLS) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function smallPages(spec) {
  const lines = wrapSmall(spec.text);
  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += 2) {
    const pair = lines.slice(i, i + 2);
    const f = new Frame();
    pair.forEach((l, k) => {
      const bmp = renderText(l);
      const y = pair.length === 1 ? 4 : k * 9;
      const x = Math.floor((COLS - bmp.width) / 2);
      const c = spec.paint === "duo" && k === 1 ? spec.color2 ?? "#ffffff" : spec.paint === "rainbow" ? (px) => rainbowAt(px) : spec.color;
      f.paint(bmp, c, x, y);
    });
    pages.push(f);
  }
  return pages;
}

/**
 * Layout result:
 *   { kind: "frames", frames, durations, loopMs }   static (one frame), words, blink, pages
 *   { kind: "scroll", raster, speed }               firmware scroll
 * `allowMotion=false` (panel animation off) never returns multi-frame layouts.
 */
export function layoutText(spec, rasterize, { allowMotion = true } = {}) {
  const text = String(spec.text ?? "");
  const effect = EFFECTS.includes(spec.effect) ? spec.effect : "auto";
  const frames = (list, durations) => ({ kind: "frames", frames: list, durations, loopMs: durations.reduce((a, b) => a + b, 0) });
  const still = (f) => ({ kind: "frames", frames: [f], durations: [Infinity], loopMs: Infinity });

  if (!text.trim()) return still(new Frame());

  if (spec.size === "small" && isPixelFontText(text) && effect !== "scroll") {
    const pages = smallPages(spec);
    if (pages.length === 1 || !allowMotion) {
      if (effect === "blink" && allowMotion) return frames([pages[0], new Frame()], [600, 300]);
      return still(pages[0]);
    }
    return frames(pages, pages.map(() => PAGE_MS));
  }

  const scroll = () => {
    const raster = bigRaster(spec, rasterize);
    const maxW = MAX_CHUNKS * 8;
    return { kind: "scroll", raster: raster.width > maxW ? cropFrame(raster, maxW) : raster, speed: spec.speed ?? 6 };
  };

  if (effect === "scroll") return scroll();
  if (effect === "words" && allowMotion) {
    const list = words(text);
    const rasters = list.map((w) => trimX(rasterize(w)));
    if (list.length > 1 && rasters.every((r) => r.width <= COLS)) {
      const fr = rasters.map((bmp, i) => {
        const sub = { ...spec, color: spec.paint === "duo" && i % 2 ? spec.color2 ?? "#ffffff" : spec.color };
        return paintMask(bmp, sub, Math.floor((COLS - bmp.width) / 2), Math.floor((ROWS - bmp.height) / 2), new Frame());
      });
      const dur = list.map((w) => 600 + 80 * [...w].length);
      return frames([...fr, new Frame()], [...dur, 450]);
    }
  }
  const f = staticFrame(spec, rasterize);
  if (!f) return scroll();
  if (effect === "blink" && allowMotion) return frames([f, new Frame()], [600, 300]);
  return still(f);
}

function cropFrame(frame, width) {
  const f = new Frame(width, frame.height);
  return f.blit(frame, 0, 0);
}

/** Frame of a "frames" layout at elapsed time t (loops). */
export function layoutFrameAt(layout, t) {
  if (layout.frames.length === 1 || !Number.isFinite(layout.loopMs)) return layout.frames[0];
  let p = t % layout.loopMs;
  for (let i = 0; i < layout.frames.length; i++) {
    if (p < layout.durations[i]) return layout.frames[i];
    p -= layout.durations[i];
  }
  return layout.frames[layout.frames.length - 1];
}

/** On-screen emulation of the firmware scroll: enter from the right, exit left, repeat. */
export function scrollFrameAt(layout, t) {
  const raster = layout.raster;
  const pxPerSec = (layout.speed ?? 6) * 0.28 * 60;
  const span = COLS + raster.width;
  const offset = COLS - (Math.floor((t / 1000) * pxPerSec) % span);
  return new Frame().blit(raster, offset, Math.floor((ROWS - raster.height) / 2));
}

/** Time for one full pass of a scroll layout at the on-screen emulation rate. */
export function scrollDurationMs(layout) {
  const pxPerSec = (layout.speed ?? 6) * 0.28 * 60;
  return Math.round(((COLS + layout.raster.width) / pxPerSec) * 1000);
}

/** How the text will be shown, for the Studio hint. */
export function describeLayout(layout) {
  if (layout.kind === "scroll") return { fits: false, label: `${layout.raster.width}px wide: scrolls` };
  if (layout.frames.length === 1) return { fits: true, label: "Fits the panel" };
  return { fits: true, label: `${layout.frames.length} frames` };
}

/** Pixel-font-only rasteriser (tests, and Node tools that have no canvas). */
export function pixelOnlyRasterizer(text) {
  const s = String(text ?? "").toUpperCase();
  const inner = renderText(s, { scale: 2 });
  const bmp = new Bitmap(inner.width + 4, 16);
  return bmp.blit(inner, 2, 1);
}
