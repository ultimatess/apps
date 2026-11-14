// Built-in animated colour art ("fx"). Pure functions of elapsed ms -> Frame.
// Colour changes land on the 8-column chunk grid so the panel shows them exactly.
import { COLS, ROWS } from "./protocol.js";
import { Bitmap } from "./bitmap.js";
import { Frame, hsl } from "./frame.js";
import { renderText } from "./font5x7.js";
import { icon } from "./icons.js";

const STEP = 250; // every fx advances in 250 ms steps (4 fps on the panel)

/** Icon in the first two chunks, word after it. `pulse` swaps the icon each beat. */
function badge(iconName, word, iconColor, wordColor, { alt = null, t = 0, flip = false } = {}) {
  const f = new Frame();
  const beat = Math.floor(t / 500) % 2;
  const ic = icon(alt && beat ? alt : iconName, { flip });
  const text = renderText(word, { scale: 2 });
  // Icon sits centred in the leading chunks; text starts on a chunk boundary.
  const iconSpan = Math.ceil((ic.width + 2) / 8) * 8;
  const total = iconSpan + text.width;
  const x0 = Math.max(0, Math.floor((COLS - total) / 16) * 8);
  f.paint(ic, iconColor, x0 + Math.floor((iconSpan - ic.width) / 2), Math.floor((ROWS - ic.height) / 2));
  f.paint(text, wordColor, x0 + iconSpan, 1);
  return f;
}

export const FX = {
  thanks: {
    label: "Thumbs up", hint: "THANKS badge", color: "#00e060",
    render: (t) => badge("thumb", "THANKS", "#00e060", "#ffffff", { t }),
  },
  love: {
    label: "Heartbeat", hint: "Beating heart", color: "#ff2d6f",
    render: (t) => badge("heart", "LOVE", "#ff2d6f", "#ffffff", { alt: "heartSmall", t }),
  },
  smile: {
    label: "Smile", hint: "HI THERE", color: "#ffd000",
    render: (t) => badge("smile", "HELLO", "#ffd000", "#00d0ff", { t }),
  },
  pass: {
    label: "After you", hint: "Marching arrows", color: "#00d0ff",
    render(t) {
      const f = new Frame();
      const text = renderText("PASS", { scale: 2 });
      f.paint(text, "#ffffff", 2, 1);
      const a = icon("arrow");
      const step = Math.floor(t / STEP) % 3;
      for (let i = 0; i < 3; i++) if (i <= step) f.paint(a, "#00d0ff", 48 + i * 16 + 1, 4);
      return f;
    },
  },
  equalizer: {
    label: "Equalizer", hint: "Twelve colour bars", color: "#a855f7",
    render(t) {
      const f = new Frame();
      const step = Math.floor(t / STEP);
      for (let i = 0; i < 12; i++) {
        const h = 3 + Math.round(11 * Math.abs(Math.sin(step * 0.9 + i * 1.7) * Math.cos(step * 0.37 + i * 0.6)));
        f.fillRect(i * 8 + 1, ROWS - h, 6, h, hsl((i * 30 + 200) % 360));
      }
      return f;
    },
  },
  wave: {
    label: "Rainbow wave", hint: "Rolling ribbon", color: "#00d0ff",
    render(t) {
      const f = new Frame();
      const phase = Math.floor(t / STEP) * 0.7;
      for (let x = 0; x < COLS; x++) {
        const y = 7.5 + 5 * Math.sin(x / 7 + phase);
        const c = hsl((Math.floor(x / 8) * 30 + Math.floor(t / STEP) * 15) % 360);
        for (let k = -1; k <= 1; k++) f.set(x, Math.round(y) + k, c);
      }
      return f;
    },
  },
  tape: {
    label: "Caution tape", hint: "Moving stripes", color: "#ff9000",
    render(t) {
      const bmp = new Bitmap();
      const shift = Math.floor(t / STEP) * 2;
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (((x + y + shift) >> 3) % 2 === 0) bmp.set(x, y);
      return Frame.fromBitmap(bmp, "#ff9000");
    },
  },
  sparkle: {
    label: "Starfield", hint: "Twinkling pixels", color: "#ffffff",
    render(t) {
      const f = new Frame();
      const step = Math.floor(t / STEP);
      for (let i = 0; i < 26; i++) {
        const seed = i * 7919;
        const x = (seed * 31) % COLS;
        const y = (seed * 17) % ROWS;
        const on = (step + i * 3) % 7 < 4;
        if (on) f.set(x, y, hsl((Math.floor(x / 8) * 47) % 360, 1, 0.7));
        if ((step + i) % 9 === 0) { f.set(x + 1, y, "#ffffff"); f.set(x - 1, y, "#ffffff"); f.set(x, y + 1, "#ffffff"); f.set(x, y - 1, "#ffffff"); }
      }
      return f;
    },
  },
};

export const FX_STEP_MS = STEP;

export function fxFrame(id, t = 0) {
  return (FX[id] ?? FX.thanks).render(Math.max(0, t));
}
