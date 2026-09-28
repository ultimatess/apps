// A "scene" describes what the panel should show. The same scene drives the
// animated on-screen preview and the (static or natively scrolling) hardware frame,
// so the preview is always a faithful picture of what the panel will display.
import { COLS, mapScrollSpeed, ANIM } from "./protocol.js";
import { Bitmap } from "./bitmap.js";
import { brakeFrame, centered, clockFrame, devilEyes, speedHud, stoppedFrame, turnArrows } from "./graphics.js";

export const COLORS = {
  cyan: "#06b6d4",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  purple: "#a855f7",
  white: "#ffffff",
};

const FPS = 60;

/** Animated preview frame for `elapsedMs` since the scene started. */
export function renderPreview(scene, elapsedMs, rasterize, now = new Date()) {
  const tick = Math.floor((elapsedMs * FPS) / 1000);
  switch (scene.kind) {
    case "text": {
      const raster = rasterize(scene.text);
      if (scene.style === "static" && raster.width <= COLS) return centered(raster);
      // Emulate the firmware scroll: enter from the right edge, exit left, repeat.
      const pxPerSec = (scene.speed ?? 6) * 0.28 * FPS;
      const span = COLS + raster.width;
      const offset = COLS - (Math.floor((elapsedMs / 1000) * pxPerSec) % span);
      return new Bitmap().blit(raster, offset, Math.floor((16 - raster.height) / 2));
    }
    case "devil": return devilEyes(scene.mode, tick);
    case "turn": return turnArrows(scene.dir, tick);
    case "brake": return Math.floor(tick / 12) % 2 === 0 ? brakeFrame() : new Bitmap();
    case "speed": return speedHud(scene.value, scene);
    case "stopped": return stoppedFrame();
    case "clock": return clockFrame(now);
    default: return new Bitmap();
  }
}

/**
 * What to send to the panel for a scene.
 *  { type: "frame", bitmap }            -> 12-chunk static frame
 *  { type: "text", raster, anim, speed } -> native firmware scroll
 *  { type: "clock" }                     -> firmware clock mode
 */
export function hardwarePlan(scene, rasterize, { frameTick = 0 } = {}) {
  switch (scene.kind) {
    case "text": {
      const raster = rasterize(scene.text);
      if (scene.style === "static" && raster.width <= COLS) return { type: "frame", bitmap: centered(raster) };
      return { type: "text", raster, anim: ANIM.SCROLL_LEFT, speed: mapScrollSpeed(scene.speed ?? 6) };
    }
    case "devil": return { type: "frame", bitmap: devilEyes(scene.mode, frameTick) };
    case "turn": return { type: "frame", bitmap: turnArrows(scene.dir, frameTick) };
    case "brake": return { type: "frame", bitmap: brakeFrame() };
    case "speed": return { type: "frame", bitmap: speedHud(scene.value, scene) };
    case "stopped": return { type: "frame", bitmap: stoppedFrame() };
    case "clock": return { type: "clock" };
    default: return { type: "frame", bitmap: new Bitmap() };
  }
}

/** Identity used to skip redundant hardware pushes. */
export function sceneKey(scene) {
  switch (scene.kind) {
    case "text": return `text|${scene.text}|${scene.style}|${scene.speed}|${scene.color}|${scene.nonce ?? ""}`;
    case "devil": return `devil|${scene.mode}|${scene.color}|${scene.nonce ?? ""}`;
    case "turn": return `turn|${scene.dir}|${scene.color}`;
    case "speed": return `speed|${Math.round(scene.value)}|${scene.unit}|${scene.over}|${scene.color}`;
    default: return `${scene.kind}|${scene.color}`;
  }
}

/** Scenes whose preview animates but whose hardware frame is a single still. */
export const isAnimatedStill = (scene) => scene.kind === "devil" || scene.kind === "turn";

export function describeScene(scene) {
  switch (scene.kind) {
    case "text": return scene.text;
    case "devil": return `Eyes · ${scene.mode.replace("_", " ")}`;
    case "turn": return scene.dir === "left" ? "⬅ Turning left" : "Turning right ➡";
    case "brake": return "⛔ Brake";
    case "speed": return `${Math.round(scene.value)} ${scene.unit}`;
    case "stopped": return "Stopped";
    case "clock": return "Clock";
    default: return "";
  }
}
