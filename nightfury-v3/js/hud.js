// Decides which scene owns the panel. Priority (highest first):
//   brake  >  turn  >  fresh user message  >  speed / stopped HUD  >  last user message
// v2 had no arbitration: once a message was sent the speed HUD never came back.
import { COLORS } from "./scene.js";
import { kmhToMph } from "./telemetry.js";

export const HOLD_OPTIONS = { "5s": 5000, "10s": 10000, "15s": 15000, "30s": 30000, sticky: Infinity };

export const DEFAULT_MESSAGE = { kind: "text", text: "வணக்கம் 🤝", color: COLORS.cyan, style: "static", speed: 6 };

export function arbitrate({
  now,
  autoHud = true,
  kmh = 0,
  hasSpeed = false,
  turn = "straight",
  sensorBrake = false,
  manualBrakeUntil = 0,
  user = null, // { scene, at }
  holdMs = HOLD_OPTIONS["10s"],
  unit = "kmh",
  limitKmh = 0,
  stoppedMode = "stopped", // stopped | message | clock
}) {
  if (now < manualBrakeUntil || (autoHud && sensorBrake)) {
    return { kind: "brake", color: COLORS.red, source: "brake" };
  }
  if (autoHud && (turn === "left" || turn === "right")) {
    return { kind: "turn", dir: turn, color: COLORS.green, source: "turn" };
  }
  const userScene = user?.scene ?? DEFAULT_MESSAGE;
  if (!autoHud) return { ...userScene, source: "user" };
  if (user && now - user.at < holdMs) return { ...userScene, source: "user" };
  if (!hasSpeed) return { ...userScene, source: "user" };

  if (kmh >= 1) {
    const over = limitKmh > 0 && kmh > limitKmh;
    const mph = unit === "mph";
    return {
      kind: "speed",
      value: mph ? kmhToMph(kmh) : kmh,
      unit: mph ? "MPH" : "KM/H",
      barMax: mph ? 90 : 140,
      over,
      color: over ? COLORS.red : COLORS.cyan,
      source: "speed",
    };
  }
  if (stoppedMode === "message") return { ...userScene, source: "user" };
  if (stoppedMode === "clock") return { kind: "clock", color: COLORS.amber, source: "clock" };
  return { kind: "stopped", color: COLORS.red, source: "stopped" };
}
