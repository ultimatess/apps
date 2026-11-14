// Eyes. Three families:
//   living_*  parametric eyes drawn here: they blink, glance around, and can react to
//             the drive (look into a turn, widen under braking).
//   classic   v3's four procedural designs (pixel-identical, kept for continuity).
//   apk_*     the nine dual-eye animations carried over from v3.
// Everything is a pure function of (mode, elapsed ms, reaction) -> 1-bit Bitmap.
import { Bitmap } from "./bitmap.js";
import { COLS, ROWS } from "./protocol.js";
import { APK_EYES_META, getApkEyeBitmap, isApkEye } from "./apk_eyes.js";
import { icon } from "./icons.js";

const L = 24, R = 72;

// ------------------------------------------------------------------ living eyes

// Deterministic pseudo-random in 0..1 from an integer.
function rand(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ease = (t) => t * t * (3 - 2 * t);

/** Idle gaze: holds a spot, then glides to the next one. Returns -1..1. */
function wander(t, period = 1750) {
  const i = Math.floor(t / period);
  const pick = (n) => [0, 0, -0.9, 0.9, 0, -0.5, 0.5][Math.floor(rand(n) * 7)];
  const k = Math.min(1, ((t % period) / period) * 5);
  const a = pick(i - 1), b = pick(i);
  return a + (b - a) * ease(k);
}

/**
 * Lid openness 0..1: a blink every few seconds. The closed phase is 200 ms long and
 * starts on a multiple of 250 ms, so the 4 fps panel stream never misses a blink.
 */
function blink(t, every = 3500) {
  const p = t % every;
  if (p < 200) return 0.08;
  if (p < 300) return 0.5;
  return 1;
}

export const MOODS = {
  calm: { a: 11, b: 7, pupil: 3, slant: 0, top: 0, bottom: 0 },
  angry: { a: 12, b: 7, pupil: 2.6, slant: 0.5, top: 0.1, bottom: 0 },
  sleepy: { a: 11, b: 7, pupil: 3, slant: 0, top: 0.5, bottom: 0, slowBlink: true },
  wide: { a: 9, b: 7.4, pupil: 1.8, slant: 0, top: 0, bottom: 0 },
  sly: { a: 12, b: 7, pupil: 2.6, slant: 0, top: 0.42, bottom: 0.3 },
  happy: { arc: true },
  love: { hearts: true },
  dizzy: { cross: true },
  wink: { a: 11, b: 7, pupil: 3, slant: 0, top: 0, bottom: 0, wink: true },
};

function drawEye(bmp, cx, mood, { open, gaze, inner }) {
  const { a, b, pupil, slant, top, bottom } = mood;
  const cy = 7.5;
  const bb = Math.max(0.6, b * open);
  const px = cx + gaze * (a - pupil - 2.5);
  for (let y = 0; y < ROWS; y++) {
    for (let x = Math.floor(cx - a - 1); x <= Math.ceil(cx + a + 1); x++) {
      const nx = (x - cx) / a;
      const ny = (y - cy) / bb;
      if (nx * nx + ny * ny > 1) continue;
      // Lids: top lid drops by `top` (0..1 of the eye height) and slants towards the nose.
      const towardNose = inner * (x - cx) / a; // +1 at the inner corner
      const lidTop = cy - bb + 2 * bb * (top + slant * (towardNose + 1) / 2);
      const lidBottom = cy + bb - 2 * bb * bottom;
      if (y < lidTop - 0.5 || y > lidBottom + 0.5) continue;
      if (open > 0.5 && Math.hypot(x - px, y - cy) <= pupil) continue; // pupil is dark
      bmp.set(x, y);
    }
  }
  // Glint: one lit pixel inside the pupil so the eye reads as wet, not hollow.
  if (open > 0.7 && pupil >= 2.5) bmp.set(Math.round(px - 1), Math.round(cy - 1));
}

function arcEye(bmp, cx) {
  // ^ shaped smile-eye, 3 px thick.
  for (let x = -9; x <= 9; x++) {
    const y = 4 + Math.round((x * x) / 13);
    for (let t = 0; t < 3; t++) bmp.set(cx + x, y + t);
  }
}

function crossEye(bmp, cx, spin) {
  for (let i = -5; i <= 5; i++) {
    for (let t = 0; t < 2; t++) {
      if (spin) { bmp.set(cx + i, 7 + t); bmp.set(cx + t, 7 + Math.round(i * 0.9)); }
      else { bmp.set(cx + i + t, 7 + i); bmp.set(cx + i + t, 7 - i); }
    }
  }
}

/**
 * Living eyes. `react.gaze` (-1 left .. 1 right, or null to wander) and `react.alert`
 * (braking: eyes go wide) come from the drive when the item is reactive.
 */
export function livingEyes(moodName, t = 0, react = {}) {
  const bmp = new Bitmap();
  let mood = MOODS[moodName] ?? MOODS.calm;
  if (react.alert && !mood.hearts) mood = MOODS.wide;

  if (mood.hearts) {
    const big = Math.floor(t / 450) % 2 === 0;
    const h = icon(big ? "heart" : "heartSmall");
    for (const cx of [L, R]) bmp.blit(h, cx - Math.floor(h.width / 2), 8 - Math.floor(h.height / 2));
    return bmp;
  }
  if (mood.arc) {
    const bounce = Math.floor(t / 500) % 2;
    const tmp = new Bitmap();
    arcEye(tmp, L);
    arcEye(tmp, R);
    return bmp.blit(tmp, 0, bounce);
  }
  if (mood.cross) {
    const spin = Math.floor(t / 300) % 2 === 1;
    crossEye(bmp, L, spin);
    crossEye(bmp, R, spin);
    return bmp;
  }

  const gaze = react.gaze ?? (react.poster ? 0 : wander(t));
  const every = mood.slowBlink ? 2500 : 3500;
  let openL = blink(t, every);
  let openR = openL;
  if (mood.slowBlink) openL = openR = Math.min(openL, 0.75 + 0.25 * Math.sin(t / 900));
  if (mood.wink) openR = (t % 2500) >= 1750 ? 0.08 : openR;
  if (react.poster) openL = openR = 1; // the still frame always has both eyes open
  drawEye(bmp, L, mood, { open: openL, gaze, inner: 1 });
  drawEye(bmp, R, mood, { open: openR, gaze, inner: -1 });
  return bmp;
}

// ------------------------------------------------------------------ classic (v3, pixel-identical)

export function classicEyes(mode, frame = 0) {
  const bmp = new Bitmap();
  const on = (x, y) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) bmp.data[y * COLS + x] = 1; };
  const off = (x, y) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) bmp.data[y * COLS + x] = 0; };

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

const CLASSIC = new Set(["angry", "cyan_cyber", "cylon", "winking"]);

// ------------------------------------------------------------------ dispatch

export const isLiving = (mode) => typeof mode === "string" && mode.startsWith("living_");
export const isReactive = (mode) => isLiving(mode) && !["living_love", "living_happy", "living_dizzy"].includes(mode);

/** Any eye mode -> Bitmap. `ms` is elapsed time; classic/APK modes run on v3's 60 Hz tick. */
export function eyesBitmap(mode, ms = 0, react = {}) {
  if (isLiving(mode)) return livingEyes(mode.slice(7), ms, react);
  const tick = Math.floor((ms * 60) / 1000);
  if (isApkEye(mode)) return getApkEyeBitmap(mode, tick);
  if (CLASSIC.has(mode)) return classicEyes(mode, tick);
  return new Bitmap();
}

export const EYE_PACK = [
  { mode: "living_calm", label: "Fury", hint: "Looks into turns", color: "#a3e635" },
  { mode: "living_angry", label: "Glare", hint: "Tailgater deterrent", color: "#ff0000" },
  { mode: "living_sly", label: "Side-eye", hint: "Narrowed and judging", color: "#ff9000" },
  { mode: "living_sleepy", label: "Sleepy", hint: "Heavy lids", color: "#00d0ff" },
  { mode: "living_wide", label: "Startled", hint: "Wide open", color: "#ffffff" },
  { mode: "living_wink", label: "Wink", hint: "Cheeky", color: "#f59e0b" },
  { mode: "living_happy", label: "Happy", hint: "Smiling arcs", color: "#00e060" },
  { mode: "living_love", label: "Heart eyes", hint: "Beating hearts", color: "#ff2d6f" },
  { mode: "living_dizzy", label: "Dizzy", hint: "After the speed bump", color: "#a855f7" },
  { mode: "angry", label: "Angry red", hint: "Classic slit pupils", color: "#ef4444" },
  { mode: "cyan_cyber", label: "Cyber rings", hint: "Classic aperture", color: "#06b6d4" },
  { mode: "cylon", label: "Scanner bar", hint: "Classic sweep", color: "#ef4444" },
  ...APK_EYES_META.map((m) => ({ mode: m.mode, label: m.label, hint: m.hint, color: m.color })),
];
