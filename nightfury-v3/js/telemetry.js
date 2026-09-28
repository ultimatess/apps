// Driving telemetry. Pure, time-injected state machines so they can be unit tested
// with synthetic traces.
//
// v2 used phone tilt (gamma) for turns and raw Z acceleration for braking, which only
// works for one mounting angle. v3 is mount-agnostic:
//  * gravity direction is estimated from the accelerometer,
//  * yaw rate  = gyroscope vector projected onto "up"      -> turn detection,
//  * braking   = horizontal linear acceleration magnitude  -> brake light,
//    confirmed / complemented by GPS speed drop.

export const G = 9.80665;

export const kmhToMph = (kmh) => kmh * 0.621371;

export function headingDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function classifyDrive(kmh) {
  if (kmh <= 0) return { id: "stopped", label: "Stopped", tone: "muted" };
  if (kmh <= 25) return { id: "slow", label: "Slow traffic", tone: "amber" };
  if (kmh <= 75) return { id: "cruise", label: "Cruising", tone: "green" };
  return { id: "highway", label: "Highway", tone: "cyan" };
}

// ------------------------------------------------------------------ GPS speed

export class SpeedTracker {
  constructor({ smoothing = 0.5, restKmh = 2, staleMs = 6000 } = {}) {
    Object.assign(this, { smoothing, restKmh, staleMs });
    this.prev = null;
    this.kmh = 0;
    this.heading = null;
    this.lastFixAt = -Infinity;
  }

  /** fix: { latitude, longitude, speed (m/s|null), heading (deg|null), accuracy, timestamp (ms) } */
  update(fix) {
    let mps = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    let heading = Number.isFinite(fix.heading) ? fix.heading : null;
    if (this.prev) {
      const dt = (fix.timestamp - this.prev.timestamp) / 1000;
      const dist = haversineMeters(this.prev.latitude, this.prev.longitude, fix.latitude, fix.longitude);
      const trusted = (fix.accuracy ?? 0) <= 50;
      if (mps === null && dt >= 0.5 && trusted) mps = dist / dt;
      if (heading === null && dist >= 5 && trusted) {
        heading = bearingDeg(this.prev.latitude, this.prev.longitude, fix.latitude, fix.longitude);
      }
    }
    if (mps !== null) {
      const raw = Math.min(300, mps * 3.6);
      const smoothed = this.prev ? this.kmh + (raw - this.kmh) * this.smoothing : raw;
      this.kmh = smoothed < this.restKmh ? 0 : smoothed;
    }
    if (heading !== null && this.kmh >= 5) this.heading = heading;
    this.prev = fix;
    this.lastFixAt = fix.timestamp;
    return { kmh: Math.round(this.kmh), heading: this.heading };
  }

  isStale(now) {
    return now - this.lastFixAt > this.staleMs;
  }
}

// ------------------------------------------------------------------ motion

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Turns raw DeviceMotionEvent data into mount-independent signals.
 * input: { acc:[x,y,z]|null, accG:[x,y,z]|null, rot:{alpha,beta,gamma}|null }
 * output: { yawLeft (deg/s, +ve = turning left), horiz (m/s^2), ready }
 */
export class MotionProcessor {
  constructor({ gravityAlpha = 0.08 } = {}) {
    this.gravityAlpha = gravityAlpha;
    this.gravity = null;
  }

  process({ acc, accG, rot }) {
    if (!accG) return { yawLeft: 0, horiz: 0, ready: false };
    let g;
    if (acc) {
      g = [accG[0] - acc[0], accG[1] - acc[1], accG[2] - acc[2]];
      this.gravity = this.gravity ? this.gravity.map((v, i) => v + (g[i] - v) * 0.3) : g;
    } else {
      this.gravity = this.gravity ? this.gravity.map((v, i) => v + (accG[i] - v) * this.gravityAlpha) : accG.slice();
    }
    g = this.gravity;
    const gm = norm(g);
    if (gm < 1) return { yawLeft: 0, horiz: 0, ready: false };
    const up = g.map((v) => v / gm); // spec: accelerationIncludingGravity points "up" at rest

    const lin = acc ?? [accG[0] - g[0], accG[1] - g[1], accG[2] - g[2]];
    const vert = dot(lin, up);
    const horiz = norm([lin[0] - vert * up[0], lin[1] - vert * up[1], lin[2] - vert * up[2]]);

    // rotationRate: alpha about z, beta about x, gamma about y (deg/s, right-handed).
    const yawLeft = rot ? dot([rot.beta || 0, rot.gamma || 0, rot.alpha || 0], up) : 0;
    return { yawLeft, horiz, ready: true };
  }
}

/**
 * Learns whether the gyro yaw sign agrees with GPS heading changes. Some WebKit
 * builds report sensor axes inverted; this flips automatically after a few turns.
 */
export class YawCalibrator {
  constructor({ minSamples = 6 } = {}) {
    this.minSamples = minSamples;
    this.agree = 0;
    this.disagree = 0;
  }

  observe(gyroYawLeft, gpsYawLeft) {
    if (Math.abs(gyroYawLeft) < 6 || Math.abs(gpsYawLeft) < 6) return;
    if (Math.sign(gyroYawLeft) === Math.sign(gpsYawLeft)) this.agree++;
    else this.disagree++;
  }

  get sign() {
    const n = this.agree + this.disagree;
    return n >= this.minSamples && this.disagree > this.agree * 2 ? -1 : 1;
  }
}

// ------------------------------------------------------------------ turns

export class TurnDetector {
  constructor({ enter = 12, exit = 5, enterMs = 250, exitMs = 600, minKmh = 4, smoothing = 0.35 } = {}) {
    Object.assign(this, { enter, exit, enterMs, exitMs, minKmh, smoothing });
    this.state = "straight";
    this.yaw = 0;
    this.pendingSince = null;
    this.pendingDir = null;
  }

  /** yawLeft deg/s (+ = left). kmh may be null when GPS speed is unknown. */
  update(yawLeft, t, kmh = null) {
    this.yaw += (yawLeft - this.yaw) * this.smoothing;
    const moving = kmh === null || kmh >= this.minKmh;
    const dir = this.yaw > 0 ? "left" : "right";
    const mag = Math.abs(this.yaw);

    if (!moving) {
      this.state = "straight";
      this.pendingSince = null;
      return this.state;
    }

    if (this.state === "straight" || (mag > this.enter && dir !== this.state)) {
      if (mag > this.enter) {
        if (this.pendingDir !== dir) { this.pendingDir = dir; this.pendingSince = t; }
        if (t - this.pendingSince >= this.enterMs) { this.state = dir; this.pendingSince = null; }
      } else {
        this.pendingSince = null;
        this.pendingDir = null;
      }
    } else if (mag < this.exit) {
      if (this.pendingDir !== "straight") { this.pendingDir = "straight"; this.pendingSince = t; }
      if (t - this.pendingSince >= this.exitMs) { this.state = "straight"; this.pendingSince = null; this.pendingDir = null; }
    } else if (this.pendingDir === "straight") {
      this.pendingDir = null;
      this.pendingSince = null;
    }
    return this.state;
  }

  reset() {
    this.state = "straight";
    this.yaw = 0;
    this.pendingSince = null;
    this.pendingDir = null;
  }
}

// ------------------------------------------------------------------ braking

export const BRAKE_SENSITIVITY = {
  low: { accelG: 0.55, gpsDecel: 4.5 },
  medium: { accelG: 0.4, gpsDecel: 3.5 },
  high: { accelG: 0.3, gpsDecel: 2.5 },
};

export class BrakeDetector {
  constructor({ sensitivity = "medium", sustainMs = 200, holdMs = 2500, minKmh = 10 } = {}) {
    Object.assign(this, { sustainMs, holdMs, minKmh });
    this.setSensitivity(sensitivity);
    this.overSince = null;
    this.until = -Infinity;
    this.speeds = [];
  }

  setSensitivity(level) {
    this.thresholds = BRAKE_SENSITIVITY[level] ?? BRAKE_SENSITIVITY.medium;
  }

  /** Recent GPS acceleration in m/s^2 (negative = slowing), or null. */
  gpsAccel() {
    if (this.speeds.length < 2) return null;
    const a = this.speeds[0], b = this.speeds[this.speeds.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt >= 0.8 ? (b.kmh - a.kmh) / 3.6 / dt : null;
  }

  lastKmh() {
    return this.speeds.length ? this.speeds[this.speeds.length - 1].kmh : null;
  }

  updateSpeed(kmh, t) {
    this.speeds.push({ kmh, t });
    while (this.speeds.length > 2 && t - this.speeds[0].t > 2000) this.speeds.shift();
    const accel = this.gpsAccel();
    const from = this.speeds[0].kmh;
    if (accel !== null && -accel >= this.thresholds.gpsDecel && from >= this.minKmh + 5) this.until = t + this.holdMs;
    return this.isBraking(t);
  }

  updateMotion(horiz, yawAbs, t) {
    const kmh = this.lastKmh();
    const accel = this.gpsAccel();
    const speeding_up = accel !== null && accel > 0.5;
    const eligible = (kmh === null || kmh >= this.minKmh) && yawAbs < 20 && !speeding_up;
    if (eligible && horiz >= this.thresholds.accelG * G) {
      if (this.overSince === null) this.overSince = t;
      if (t - this.overSince >= this.sustainMs) this.until = t + this.holdMs;
    } else {
      this.overSince = null;
    }
    return this.isBraking(t);
  }

  isBraking(t) {
    return t < this.until;
  }
}
