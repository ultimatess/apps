// Procedural 96x16 graphics. Turn chevrons and devil eyes are pixel-identical to v2
// (locked by parity tests); the speed / brake / stop frames are new pixel-font designs.
import { Bitmap } from "./bitmap.js";
import { COLS, ROWS } from "./protocol.js";
import { drawText, measure, renderText } from "./font5x7.js";
import { APK_EYES_META, getApkEyeBitmap, isApkEye } from "./apk_eyes.js";

export const APK_EYE_MODES = APK_EYES_META.map((m) => m.mode);
export const DEVIL_MODES = ["angry", "cyan_cyber", "cylon", "winking", ...APK_EYE_MODES];

export function turnArrows(direction, tick = 0) {
  const bmp = new Bitmap();
  const anim = Math.floor((tick * 0.4) % 12);
  const plot = (x, y) => {
    if (x >= 0 && x < COLS) bmp.data[y * COLS + x] = 1;
    if (x + 1 >= 0 && x + 1 < COLS) bmp.data[y * COLS + x + 1] = 1;
  };
  if (direction === "left") {
    for (let base = 12; base < COLS - 12; base += 16) {
      for (let y = 0; y < ROWS; y++) plot(Math.round(base - anim + Math.abs(y - 7.5) * 1.1), y);
    }
  } else if (direction === "right") {
    for (let base = 4; base < COLS - 4; base += 16) {
      for (let y = 0; y < ROWS; y++) plot(Math.round(base + anim - Math.abs(y - 7.5) * 1.1), y);
    }
  }
  return bmp;
}

export function devilEyes(mode, frame = 0) {
  if (isApkEye(mode)) return getApkEyeBitmap(mode, frame);
  const bmp = new Bitmap();
  const on = (x, y) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) bmp.data[y * COLS + x] = 1; };
  const off = (x, y) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) bmp.data[y * COLS + x] = 0; };
  const L = 24, R = 72;

  if (mode === "angry") {
    const eyeW = 24;
    for (let dy = 0; dy < 12; dy++) {
      const row = 2 + dy;
      const leftStart = L - Math.floor(eyeW / 2) + Math.floor(dy * 1.1);
      for (let dx = 0; dx < eyeW - dy * 1.3; dx++) {
        on(leftStart + dx, row);
        on(R - Math.floor(eyeW / 2) + Math.floor(dy * 0.3) + dx, row);
      }
    }
    const slit = Math.sin(frame * 0.08) * 3;
    for (let r = 4; r <= 11; r++) {
      off(Math.round(L + slit), r);
      off(Math.round(R + slit), r);
    }
  } else if (mode === "cyan_cyber") {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dL = Math.hypot(c - L, (r - 8) * 1.5);
        const dR = Math.hypot(c - R, (r - 8) * 1.5);
        if ((dL < 7 && dL > 4) || (dR < 7 && dR > 4)) on(c, r);
      }
    }
  } else if (mode === "cylon") {
    const scan = Math.floor((Math.sin(frame * 0.07) + 1) * 0.5 * (COLS - 18));
    for (let r = 5; r <= 10; r++) for (let c = scan; c < scan + 18; c++) on(c, r);
  } else if (mode === "winking") {
    const wink = frame % 120 > 85;
    const eye = (cx) => {
      for (let r = 3; r <= 12; r++) for (let c = cx - 8; c <= cx + 8; c++) if (Math.hypot(c - cx, (r - 7.5) * 1.6) < 6) on(c, r);
    };
    eye(L);
    if (wink) for (let c = R - 8; c <= R + 8; c++) { on(c, 8); on(c, 7); }
    else eye(R);
  }
  return bmp;
}

/** Filled warning triangle (13x14) with the "!" knocked out. */
export function warningTriangle() {
  const bmp = new Bitmap(13, 14);
  for (let i = 0; i < 14; i++) {
    const half = Math.round((i * 6) / 13);
    for (let x = 6 - half; x <= 6 + half; x++) bmp.set(x, i);
  }
  for (let i = 4; i <= 9; i++) bmp.set(6, i, 0);
  for (let i = 11; i <= 12; i++) bmp.set(6, i, 0);
  return bmp;
}

/** Center a bitmap on a 96x16 frame (horizontally and vertically). */
export function centered(src) {
  const bmp = new Bitmap();
  bmp.blit(src, Math.floor((COLS - src.width) / 2), Math.floor((ROWS - src.height) / 2));
  return bmp;
}

/** Big-digit speed readout: 2x digits, unit label and a proportional speed bar. */
export function speedHud(value, { unit = "KM/H", barMax = 140, over = false } = {}) {
  const bmp = new Bitmap();
  const digits = String(Math.max(0, Math.min(999, Math.round(value))));
  const dW = measure(digits, { scale: 2 });
  const uW = measure(unit);
  const gap = 4;
  const total = dW + gap + uW;
  const x0 = Math.floor((COLS - total) / 2);
  drawText(bmp, digits, x0, 1, { scale: 2 });

  const ux = x0 + dW + gap;
  drawText(bmp, unit, ux, 8);

  // Speed bar above the unit (rows 1..5): outline plus proportional fill.
  const barW = uW;
  for (let x = ux; x < ux + barW; x++) { bmp.set(x, 1); bmp.set(x, 5); }
  for (let y = 1; y <= 5; y++) { bmp.set(ux, y); bmp.set(ux + barW - 1, y); }
  const fill = Math.round(Math.max(0, Math.min(1, value / barMax)) * (barW - 4));
  bmp.fillRect(ux + 2, 3, fill, 1);

  if (over) {
    // Over the limit: solid side rails so the reading stands out even as a static frame.
    bmp.fillRect(0, 0, 2, ROWS);
    bmp.fillRect(COLS - 2, 0, 2, ROWS);
  }
  return bmp;
}

export function brakeFrame() {
  const bmp = new Bitmap();
  const tri = warningTriangle();
  const word = renderText("BRAKE", { scale: 2 });
  const total = tri.width * 2 + word.width + 8;
  const x0 = Math.floor((COLS - total) / 2);
  bmp.blit(tri, x0, 1);
  bmp.blit(word, x0 + tri.width + 4, 1);
  bmp.blit(tri, x0 + tri.width + 4 + word.width + 4, 1);
  return bmp;
}

export function wordFrame(text) {
  return centered(renderText(text, { scale: 2 }));
}

export const stoppedFrame = () => wordFrame("STOPPED");

export function clockFrame(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return wordFrame(`${hh}:${mm}`);
}
