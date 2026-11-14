// Procedural 96x16 colour graphics for the driving HUD. Every design keeps its
// colour boundaries on the 8-column chunk grid, so the hardware (one colour per
// chunk) shows it exactly as drawn.
//
// All functions are pure. Animated ones take elapsed milliseconds and are stepped
// in multiples of FRAME_MS so the panel stream (a few frames per second) and the
// on-screen preview show the same frames.
import { Bitmap } from "./bitmap.js";
import { COLS, ROWS } from "./protocol.js";
import { Frame, centerFrame, dim } from "./frame.js";
import { drawText, measure, renderText } from "./font5x7.js";
import { icon } from "./icons.js";

export const LED = {
  red: "#ff0000",
  amber: "#ff9000",
  green: "#00e060",
  cyan: "#00d0ff",
  white: "#ffffff",
};

/** Animation step shared by the signal frames (and the panel stream rate for them). */
export const FRAME_MS = 300;

// ------------------------------------------------------------------ speed

/**
 * Speed readout: big digits (chunks 0-4), unit (chunks 5-7), four-bar gauge (chunks 8-11).
 * `frac` 0..1 fills the gauge; `over` turns the digits red.
 */
export function speedHud(value, { unit = "KM/H", frac = 0, over = false, color = LED.white } = {}) {
  const f = new Frame();
  const digits = String(Math.max(0, Math.min(999, Math.round(value))));
  const dW = measure(digits, { scale: 2 });
  const dBmp = new Bitmap(dW, 14);
  drawText(dBmp, digits, 0, 0, { scale: 2 });
  f.paint(dBmp, over ? LED.red : color, 39 - dW, 1);

  const uW = measure(unit);
  const uBmp = new Bitmap(uW, 7);
  drawText(uBmp, unit, 0, 0);
  f.paint(uBmp, dim(LED.cyan, 0.75), 40 + Math.floor((24 - uW) / 2), 5);

  const lit = Math.max(0, Math.min(4, Math.ceil(Math.max(0, Math.min(1, frac)) * 4 - 1e-9)));
  const colors = [LED.green, LED.green, LED.amber, LED.red];
  for (let i = 0; i < 4; i++) {
    const x = 64 + i * 8 + 1;
    const h = 4 + i * 3;
    const c = over ? LED.red : colors[i];
    if (i < lit) f.fillRect(x, 15 - h, 6, h, c);
    else f.fillRect(x, 14, 6, 1, dim(c, 0.45));
  }
  return f;
}

// ------------------------------------------------------------------ signals

function chevron(dir) {
  const bmp = new Bitmap(16, 16);
  for (let y = 0; y < 16; y++) {
    const off = Math.round(7.5 - Math.abs(y - 7.5));
    for (let t = 0; t < 4; t++) {
      const x = dir === "right" ? 3 + off + t : 12 - off - t;
      bmp.set(x, y);
    }
  }
  return bmp;
}

/**
 * Sequential indicator: six chevrons fill in pairs towards `dir`, then go dark.
 * elapsedMs < 0 gives the poster frame (all chevrons lit) for still mode.
 */
export function turnFrame(dir, elapsedMs = -1, color = LED.amber) {
  const f = new Frame();
  const stage = elapsedMs < 0 ? 2 : Math.floor(elapsedMs / FRAME_MS) % 4;
  if (stage === 3) return f;
  const ch = chevron(dir);
  for (let i = 0; i < 6; i++) {
    const order = dir === "right" ? i : 5 - i; // 0 = lights first
    if (Math.floor(order / 2) <= stage) f.paint(ch, color, i * 16, 0);
  }
  return f;
}

/** Hazard: chevrons pointing outwards with warning triangles, blinking. */
export function hazardFrame(elapsedMs = -1, color = LED.amber) {
  const f = new Frame();
  if (elapsedMs >= 0 && Math.floor(elapsedMs / FRAME_MS) % 2 === 1) return f;
  const tri = icon("warn");
  f.paint(chevron("left"), color, 0, 0);
  f.paint(chevron("left"), color, 16, 0);
  f.paint(tri, color, 32 + 1, 1);
  f.paint(tri, color, 48 + 2, 1);
  f.paint(chevron("right"), color, 64, 0);
  f.paint(chevron("right"), color, 80, 0);
  return f;
}

/**
 * Brake light. Alternates a solid red slab (word knocked out) with the plain word
 * and triangles; the poster frame is the slab because it puts out the most light.
 */
export function brakeFrame(elapsedMs = -1, color = LED.red) {
  const f = new Frame();
  const word = renderText("BRAKE", { scale: 2 });
  const slab = elapsedMs < 0 || Math.floor(elapsedMs / FRAME_MS) % 2 === 0;
  if (slab) {
    const bmp = new Bitmap();
    bmp.fillRect(0, 0, COLS, ROWS);
    const x0 = Math.floor((COLS - word.width) / 2);
    for (let y = 0; y < word.height; y++) {
      for (let x = 0; x < word.width; x++) if (word.data[y * word.width + x]) bmp.set(x0 + x, y + 1, 0);
    }
    return f.paint(bmp, color);
  }
  const tri = icon("warn");
  const total = tri.width * 2 + word.width + 8;
  const x0 = Math.floor((COLS - total) / 2);
  f.paint(tri, color, x0, 1);
  f.paint(word, color, x0 + tri.width + 4, 1);
  f.paint(tri, color, x0 + tri.width + 4 + word.width + 4, 1);
  return f;
}

// ------------------------------------------------------------------ words / clock

export function wordFrame(text, color = LED.white) {
  return centerFrame(Frame.fromBitmap(renderText(text, { scale: 2 }), color));
}

export const stoppedFrame = (color = LED.red) => wordFrame("STOPPED", color);

export function clockFrame(d = new Date(), color = LED.amber) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return wordFrame(`${hh}:${mm}`, color);
}

/** Checker + border test card (bit order and column alignment show up at a glance). */
export function gridFrame(color = LED.white) {
  const b = new Bitmap();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) if ((x + y) % 2 === 0 || x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) b.set(x, y);
  }
  return Frame.fromBitmap(b, color);
}

/** Twelve vertical colour bars, one per chunk: a quick check of multi-colour mode. */
export function colorBarsFrame() {
  const f = new Frame();
  const hues = ["#ff0000", "#ff9000", "#ffe000", "#80ff00", "#00e060", "#00ffc0", "#00d0ff", "#0060ff", "#6000ff", "#c000ff", "#ff00a0", "#ffffff"];
  hues.forEach((c, i) => f.fillRect(i * 8 + 1, 1, 6, 14, c));
  return f;
}
