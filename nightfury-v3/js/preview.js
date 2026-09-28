// Realistic LED-matrix preview. Diodes are pre-rendered sprites and the canvas is
// only repainted when the frame, colour or brightness actually changes.
import { COLS, ROWS, hexToRgb } from "./protocol.js";

const CELL = 10;

function sprite(doc, draw) {
  const c = doc.createElement("canvas");
  c.width = c.height = CELL;
  draw(c.getContext("2d"));
  return c;
}

export function createPreview(canvas, doc = document) {
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext("2d");
  const off = sprite(doc, (g) => {
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.beginPath();
    g.arc(CELL / 2, CELL / 2, CELL * 0.27, 0, Math.PI * 2);
    g.fill();
  });
  let litKey = "";
  let lit = null;
  let lastKey = "";

  function litSprite(color, brightness) {
    const key = `${color}|${brightness}`;
    if (key === litKey) return lit;
    const [r, g, b] = hexToRgb(color);
    const a = Math.max(0.25, brightness / 100);
    lit = sprite(doc, (x) => {
      const cx = CELL / 2;
      const glow = x.createRadialGradient(cx, cx, 0, cx, cx, CELL / 2);
      glow.addColorStop(0, `rgba(${r},${g},${b},${0.55 * a})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = glow;
      x.fillRect(0, 0, CELL, CELL);
      x.fillStyle = `rgba(${r},${g},${b},${a})`;
      x.beginPath();
      x.arc(cx, cx, CELL * 0.36, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = `rgba(255,255,255,${0.55 * a})`;
      x.beginPath();
      x.arc(cx - 1.2, cx - 1.2, CELL * 0.11, 0, Math.PI * 2);
      x.fill();
    });
    litKey = key;
    return lit;
  }

  return {
    draw(bitmap, color, brightness) {
      const key = `${color}|${brightness}|${bitmap.key()}`;
      if (key === lastKey) return false;
      lastKey = key;
      const on = litSprite(color, brightness);
      ctx.fillStyle = "#020408";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          ctx.drawImage(bitmap.data[y * COLS + x] ? on : off, x * CELL, y * CELL);
        }
      }
      return true;
    },
    invalidate() {
      lastKey = "";
    },
  };
}
