// Drive model: fuses GPS fixes and motion samples into the handful of values the
// director needs. Time-injected; the detectors themselves live in telemetry.js.
import { BrakeDetector, G, MotionProcessor, SpeedTracker, TurnDetector, YawCalibrator, headingDelta } from "./telemetry.js";

const SPEED_STALE_MS = 6000;
const MOTION_STALE_MS = 1500;

export class DriveModel {
  constructor({ options = () => ({}) } = {}) {
    this.options = options; // () => ({ invertTurns, brakeSensitivity })
    this.reset();
  }

  reset() {
    this.speed = new SpeedTracker();
    this.motion = new MotionProcessor();
    this.calibrator = new YawCalibrator();
    this.turns = new TurnDetector();
    this.brakes = new BrakeDetector({ sensitivity: this.options().brakeSensitivity ?? "medium" });
    this.kmh = 0;
    this.gpsAt = -Infinity;
    this.heading = null;
    this.headingAt = 0;
    this.motionAt = -Infinity;
    this.yaw = 0;
    this.horizG = 0;
    this.turn = "straight";
    this.accuracy = null;
  }

  setSensitivity(level) {
    this.brakes.setSensitivity(level);
  }

  resetTurns() {
    this.turns.reset();
    this.turn = "straight";
  }

  hasSpeed(now) {
    return now - this.gpsAt < SPEED_STALE_MS;
  }

  /** GPS fix: { latitude, longitude, speed, heading, accuracy, timestamp }. */
  fix(fix, now) {
    const invert = this.options().invertTurns ? -1 : 1;
    const { kmh, heading } = this.speed.update(fix);
    this.kmh = kmh;
    this.gpsAt = now;
    this.accuracy = fix.accuracy ?? null;
    this.brakes.updateSpeed(kmh, now);
    if (heading !== null) {
      if (this.heading !== null && now > this.headingAt) {
        const dt = (now - this.headingAt) / 1000;
        const gpsYawLeft = -headingDelta(this.heading, heading) / dt; // heading is clockwise
        this.calibrator.observe(this.yaw, gpsYawLeft);
        // Without a gyroscope, the GPS heading rate drives turn detection.
        if (now - this.motionAt > MOTION_STALE_MS) this.turn = this.turns.update(gpsYawLeft * invert, now, kmh);
      }
      this.heading = heading;
      this.headingAt = now;
    }
  }

  /** Motion sample: { acc, accG, rot } as produced by sensors.js. */
  sample(m, now) {
    const out = this.motion.process(m);
    if (!out.ready) return;
    const invert = this.options().invertTurns ? -1 : 1;
    this.motionAt = now;
    const yaw = out.yawLeft * this.calibrator.sign * invert;
    this.yaw = yaw;
    this.horizG = out.horiz / G;
    this.turn = this.turns.update(yaw, now, this.hasSpeed(now) ? this.kmh : null);
    this.brakes.updateMotion(out.horiz, Math.abs(yaw), now);
  }

  read(now) {
    const hasMotion = now - this.motionAt < 2000;
    return {
      kmh: this.kmh,
      hasSpeed: this.hasSpeed(now),
      turn: this.turn,
      brake: this.brakes.isBraking(now),
      yaw: hasMotion ? this.yaw : null,
      horizG: hasMotion ? this.horizG : null,
      accuracy: this.accuracy,
    };
  }
}
