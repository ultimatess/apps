// A "scene" is a plain object describing what the panel should show. The same
// scene drives the on-screen preview and the hardware, through one pure renderer:
//
//   render(scene, ms)  -> Frame for that moment (preview: every display frame)
//   plan(scene)        -> how to get it onto the panel:
//        { mode: "scroll", raster, speed }       firmware scrolls it; sent once
//        { mode: "frames", animated, stepMs, minGapMs }
//                                                we send frames; a still is sent once,
//                                                an animation is re-sent when it changes
import { ANIM, mapScrollSpeed } from "./protocol.js";
import { Frame, unpackFrame } from "./frame.js";
import { LED, FRAME_MS, brakeFrame, clockFrame, hazardFrame, speedHud, stoppedFrame, turnFrame } from "./graphics.js";
import { eyesBitmap, EYE_PACK } from "./eyes.js";
import { FX, FX_STEP_MS, fxFrame } from "./fx.js";
import { clampSpeed, layoutFrameAt, layoutText, paceOf, scrollFrameAt } from "./text.js";
import { PICS, PIC_STEP_MS, picFrame } from "./pictures.js";

export const COLORS = {
  cyan: "#06b6d4",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  purple: "#a855f7",
  white: "#ffffff",
  lime: "#a3e635",
  blue: "#3b82f6",
  pink: "#ec4899",
};

export const PALETTE = [LED.red, "#ff9000", "#ffd000", COLORS.lime, "#00e060", "#00d0ff", COLORS.blue, COLORS.purple, "#ff2d6f", "#ffffff"];

/** Kinds that only ever come from the drive, never from the library. */
const SIGNAL_KINDS = new Set(["turn", "hazard", "brake"]);

export function createScenes({ rasterize, epoch = () => 0, options = () => ({}) } = {}) {
  const layouts = new Map();
  const arts = new Map();

  const motion = () => options().motion ?? "all"; // off | signals | all

  /** Message speed is one setting for every text scene; a scene's own `speed` is only a fallback. */
  const speed = (scene) => clampSpeed(options().speed ?? scene?.speed);

  function textLayout(scene, allowMotion = motion() !== "off") {
    const spec = { ...scene, speed: speed(scene) };
    const key = `${epoch()}|${allowMotion}|${options().pixelFont !== false}|${textKey(spec)}`;
    let l = layouts.get(key);
    if (!l) {
      l = layoutText(spec, rasterize, { allowMotion });
      if (layouts.size > 80) layouts.clear();
      layouts.set(key, l);
    }
    return l;
  }

  function artFrames(scene) {
    const key = `${scene.id}|${scene.rev ?? 0}`;
    let list = arts.get(key);
    if (!list) {
      list = (scene.frames ?? []).map(unpackFrame);
      if (!list.length) list = [new Frame()];
      if (arts.size > 40) arts.clear();
      arts.set(key, list);
    }
    return list;
  }

  /**
   * `poster` gives the canonical still (used when the panel is not animating this scene).
   * `thumb` is for library thumbnails: scrolling text shows its beginning instead of scrolling.
   */
  function render(scene, ms = 0, { date = new Date(), poster = false, thumb = false } = {}) {
    if (!scene) return new Frame();
    const t = poster ? 0 : Math.max(0, ms);
    switch (scene.kind) {
      case "text": {
        const l = textLayout(scene);
        if (l.kind === "scroll") return thumb ? new Frame().blit(l.raster, 0, 0) : scrollFrameAt(l, poster ? 1e9 : t);
        return layoutFrameAt(l, t);
      }
      case "eyes": {
        const react = { gaze: scene.react ? scene.gaze ?? null : null, alert: !!(scene.react && scene.alert), poster };
        return Frame.fromBitmap(eyesBitmap(scene.mode, t, react), scene.color);
      }
      case "fx": return fxFrame(scene.id, t);
      // Pictures follow the message speed: slower stretches the cartoon's timeline.
      case "pic": return picFrame(scene.id, t / paceOf(options().speed ?? 6), { poster });
      case "art": {
        const list = artFrames(scene);
        const fps = Math.max(1, Math.min(12, scene.fps ?? 4));
        return list[poster ? 0 : Math.floor((t * fps) / 1000) % list.length];
      }
      case "turn": return turnFrame(scene.dir, poster ? -1 : t);
      case "hazard": return hazardFrame(poster ? -1 : t);
      case "brake": return brakeFrame(poster ? -1 : t);
      case "speed": return speedHud(scene.value, scene);
      case "stopped": return stoppedFrame();
      case "clock": return clockFrame(date, scene.color ?? LED.amber);
      default: return new Frame();
    }
  }

  function plan(scene) {
    const m = motion();
    const still = { mode: "frames", animated: false, stepMs: 0, minGapMs: 0 };
    if (!scene) return still;
    switch (scene.kind) {
      case "text": {
        const l = textLayout(scene);
        if (l.kind === "scroll") return { mode: "scroll", raster: l.raster, anim: ANIM.SCROLL_LEFT, speed: mapScrollSpeed(l.speed) };
        return l.frames.length > 1 ? { mode: "frames", animated: true, stepMs: 50, minGapMs: 250 } : still;
      }
      case "eyes": return m === "all" ? { mode: "frames", animated: true, stepMs: 250, minGapMs: 250 } : still;
      case "fx": return m === "all" ? { mode: "frames", animated: true, stepMs: FX_STEP_MS, minGapMs: 250 } : still;
      case "pic": return m === "all" ? { mode: "frames", animated: true, stepMs: PIC_STEP_MS, minGapMs: 250 } : still;
      case "art": {
        const n = scene.frames?.length ?? 1;
        if (n < 2 || m !== "all") return still;
        const step = Math.max(250, Math.round(1000 / Math.max(1, scene.fps ?? 4)));
        return { mode: "frames", animated: true, stepMs: step, minGapMs: 250 };
      }
      case "turn": case "hazard": case "brake":
        return m === "off" ? still : { mode: "frames", animated: true, stepMs: FRAME_MS, minGapMs: FRAME_MS - 20 };
      case "speed": return { mode: "frames", animated: false, stepMs: 0, minGapMs: 700 };
      default: return still;
    }
  }

  /**
   * What to keep in the panel's own memory for a scene, or null for scenes that only
   * make sense live (HUD, signals, clock, eyes). Text is kept as the firmware would
   * show it unattended: a still when it fits, otherwise a firmware scroll. Pictures
   * and art are kept as their still.
   */
  function stored(scene) {
    switch (scene?.kind) {
      case "text": {
        if (!String(scene.text ?? "").trim()) return null;
        const l = textLayout(scene, false);
        if (l.kind === "scroll") return { mode: "scroll", raster: l.raster, speed: mapScrollSpeed(l.speed) };
        return { mode: "frame", frame: l.frames[0] };
      }
      case "pic": case "art": return { mode: "frame", frame: render(scene, 0, { poster: true }) };
      default: return null;
    }
  }

  return { render, plan, textLayout, speed, stored };
}

function textKey(s) {
  return `${s.text}|${s.color}|${s.color2 ?? ""}|${s.paint ?? "solid"}|${s.effect ?? "auto"}|${s.size ?? "big"}|${s.speed ?? ""}`;
}

/** Identity of a scene: when it changes, the scene restarts (animation clock, hardware push). */
export function sceneKey(scene) {
  if (!scene) return "";
  const n = scene.nonce ?? "";
  switch (scene.kind) {
    case "text": return `text|${textKey(scene)}|${n}`;
    case "eyes": return `eyes|${scene.mode}|${scene.color}|${scene.react ? 1 : 0}|${n}`;
    case "fx": return `fx|${scene.id}|${n}`;
    case "pic": return `pic|${scene.id}|${n}`;
    case "art": return `art|${scene.id}|${scene.rev ?? 0}|${scene.fps ?? 4}|${n}`;
    case "turn": return `turn|${scene.dir}`;
    case "speed": return "speed";
    default: return `${scene.kind}|${scene.color ?? ""}`;
  }
}

export const isSignal = (scene) => SIGNAL_KINDS.has(scene?.kind);

export function describeScene(scene) {
  switch (scene?.kind) {
    case "text": return scene.text;
    case "eyes": return `Eyes · ${EYE_PACK.find((e) => e.mode === scene.mode)?.label ?? scene.mode}`;
    case "fx": return FX[scene.id]?.label ?? "Effect";
    case "pic": return PICS[scene.id]?.label ?? "Picture";
    case "art": return scene.name || "Pixel art";
    case "turn": return scene.dir === "left" ? "Signalling left" : "Signalling right";
    case "hazard": return "Hazard lights";
    case "brake": return "Brake light";
    case "speed": return `${Math.round(scene.value)} ${String(scene.unit).toLowerCase()}`;
    case "stopped": return "Stopped";
    case "clock": return "Clock";
    default: return "Blank";
  }
}

/** A colour that represents the scene in the UI (ambient tint, thumbnails). */
export function sceneTint(scene) {
  switch (scene?.kind) {
    case "text": return scene.paint === "rainbow" ? "#a855f7" : scene.color ?? "#ffffff";
    case "eyes": return scene.color ?? "#ffffff";
    case "fx": return FX[scene.id]?.color ?? "#ffffff";
    case "pic": return PICS[scene.id]?.color ?? "#ffffff";
    case "art": return scene.tint ?? "#ffffff";
    case "turn": case "hazard": return LED.amber;
    case "brake": case "stopped": return LED.red;
    case "speed": return scene.over ? LED.red : LED.cyan;
    case "clock": return scene.color ?? LED.amber;
    default: return "#ffffff";
  }
}
