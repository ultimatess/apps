// LED matrix renderers. The main view draws realistic diodes (sprites cached per
// colour) and only repaints cells that changed; thumbnails are plain dots.
import { COLS, ROWS, hexToRgb } from "../protocol.js";

const CELL = 10;

function sprite(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = CELL;
  draw(c.getContext("2d"));
  return c;
}

export function createLedView(canvas, glowCanvas = null) {
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext("2d");
  const glow = glowCanvas?.getContext("2d") ?? null;
  const sprites = new Map();
  const shown = new Array(COLS * ROWS).fill(undefined); // colour (or null) per cell
  let level = -1;

  const off = sprite((g) => {
    g.fillStyle = "#020304";
    g.fillRect(0, 0, CELL, CELL);
    g.fillStyle = "rgba(255,255,255,0.055)";
    g.beginPath();
    g.arc(CELL / 2, CELL / 2, CELL * 0.27, 0, Math.PI * 2);
    g.fill();
  });

  function lit(color, a) {
    const key = `${color}|${a}`;
    let s = sprites.get(key);
    if (!s) {
      const [r, g, b] = hexToRgb(color);
      s = sprite((x) => {
        const c = CELL / 2;
        x.fillStyle = "#020304";
        x.fillRect(0, 0, CELL, CELL);
        const halo = x.createRadialGradient(c, c, 0, c, c, CELL / 2);
        halo.addColorStop(0, `rgba(${r},${g},${b},${0.55 * a})`);
        halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
        x.fillStyle = halo;
        x.fillRect(0, 0, CELL, CELL);
        x.fillStyle = `rgba(${r},${g},${b},${a})`;
        x.beginPath();
        x.arc(c, c, CELL * 0.36, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = `rgba(255,255,255,${0.5 * a})`;
        x.beginPath();
        x.arc(c - 1.2, c - 1.2, CELL * 0.11, 0, Math.PI * 2);
        x.fill();
      });
      if (sprites.size > 96) sprites.clear();
      sprites.set(key, s);
    }
    return s;
  }

  return {
    /** Draw a 96x16 Frame at a brightness (0..100). Returns true when anything changed. */
    draw(frame, brightness = 100) {
      const a = Math.round(Math.max(0.3, Math.min(1, brightness / 100)) * 20) / 20;
      const all = a !== level;
      level = a;
      let changed = false;
      for (let i = 0; i < COLS * ROWS; i++) {
        const color = frame.pal[frame.px[i]] ?? null;
        if (!all && shown[i] === color) continue;
        shown[i] = color;
        changed = true;
        const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
        ctx.drawImage(color ? lit(color, a) : off, x, y);
        if (glow) {
          glow.clearRect(i % COLS, Math.floor(i / COLS), 1, 1);
          if (color) {
            glow.globalAlpha = a;
            glow.fillStyle = color;
            glow.fillRect(i % COLS, Math.floor(i / COLS), 1, 1);
          }
        }
      }
      return changed;
    },
    invalidate() {
      shown.fill(undefined);
    },
  };
}

/** Plain thumbnail: one dot per pixel on a small canvas (CSS scales it). */
export function drawThumb(canvas, frame, scale = 3) {
  if (canvas.width !== frame.width * scale) {
    canvas.width = frame.width * scale;
    canvas.height = frame.height * scale;
  }
  const g = canvas.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const dot = scale - (scale > 2 ? 1 : 0);
  let last = null;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const v = frame.px[y * frame.width + x];
      if (!v) continue;
      const color = frame.pal[v];
      if (color !== last) { g.fillStyle = color; last = color; }
      g.fillRect(x * scale, y * scale, dot, dot);
    }
  }
}

/**
 * Animated thumbnails: canvases register with a render(ms) function; visible ones are
 * redrawn four times a second (the panel's own rate), hidden ones not at all.
 */
export function createThumbs() {
  const live = new Map(); // canvas -> { render, visible, key }
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const t = live.get(e.target);
        if (t) t.visible = e.isIntersecting;
      }
    }, { rootMargin: "80px" })
    : null;

  function paint(canvas, t, ms) {
    const frame = t.render(ms);
    const key = frame.key();
    if (key === t.key) return;
    t.key = key;
    drawThumb(canvas, frame);
  }

  return {
    add(canvas, render) {
      const t = { render, visible: !io, key: "" };
      live.set(canvas, t);
      io?.observe(canvas);
      paint(canvas, t, 0);
      return canvas;
    },
    /** Forget canvases that left the document. */
    sweep() {
      for (const canvas of live.keys()) {
        if (!canvas.isConnected) { io?.unobserve(canvas); live.delete(canvas); }
      }
    },
    tick(ms) {
      const q = Math.floor(ms / 250) * 250;
      for (const [canvas, t] of live) if (t.visible && canvas.isConnected) paint(canvas, t, q);
    },
    get size() { return live.size; },
  };
}
