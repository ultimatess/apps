// Trip computer. Pure and time-injected: feed it speed samples, read totals.
// Distance is integrated from speed (the GPS speed is steadier than differencing
// positions at city speeds).

const SAMPLE_MS = 5000;
const MAX_SAMPLES = 360; // 30 minutes of sparkline at one sample per 5 s

export class TripMeter {
  constructor(saved = null) {
    this.reset();
    if (saved && typeof saved === "object") {
      for (const k of ["startedAt", "distanceM", "movingMs", "stoppedMs", "maxKmh", "hardBrakes", "stops"]) {
        if (Number.isFinite(saved[k])) this[k] = saved[k];
      }
      if (Array.isArray(saved.samples)) this.samples = saved.samples.filter(Number.isFinite).slice(-MAX_SAMPLES);
    }
  }

  reset(now = 0) {
    this.startedAt = now;
    this.distanceM = 0;
    this.movingMs = 0;
    this.stoppedMs = 0;
    this.maxKmh = 0;
    this.hardBrakes = 0;
    this.stops = 0;
    this.samples = [];
    this.lastAt = null;
    this.lastKmh = 0;
    this.sampleAt = 0;
    this.sampleMax = 0;
    this.wasBraking = false;
    this.wasMoving = false;
  }

  get active() {
    return this.movingMs > 0 || this.distanceM > 0;
  }

  /** One sample. `now` is wall-clock ms; gaps over 10 s (GPS lost, app asleep) are not counted. */
  update({ kmh, braking = false }, now) {
    if (!this.startedAt) this.startedAt = now;
    if (this.lastAt !== null) {
      const dt = now - this.lastAt;
      if (dt > 0 && dt <= 10000) {
        const avg = (kmh + this.lastKmh) / 2;
        if (avg >= 1) {
          this.distanceM += (avg / 3.6) * (dt / 1000);
          this.movingMs += dt;
        } else {
          this.stoppedMs += dt;
        }
      }
    }
    const moving = kmh >= 3;
    if (this.wasMoving && !moving && kmh < 1) { this.stops++; this.wasMoving = false; }
    else if (moving) this.wasMoving = true;
    if (braking && !this.wasBraking) this.hardBrakes++;
    this.wasBraking = braking;
    if (kmh > this.maxKmh) this.maxKmh = kmh;

    this.sampleMax = Math.max(this.sampleMax, kmh);
    if (!this.sampleAt) this.sampleAt = now;
    if (now - this.sampleAt >= SAMPLE_MS) {
      this.samples.push(Math.round(this.sampleMax));
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
      this.sampleAt = now;
      this.sampleMax = 0;
    }
    this.lastAt = now;
    this.lastKmh = kmh;
  }

  get avgKmh() {
    return this.movingMs > 0 ? (this.distanceM / 1000) / (this.movingMs / 3600000) : 0;
  }

  summary() {
    return {
      startedAt: this.startedAt,
      distanceM: Math.round(this.distanceM),
      movingMs: this.movingMs,
      stoppedMs: this.stoppedMs,
      maxKmh: Math.round(this.maxKmh),
      avgKmh: Math.round(this.avgKmh * 10) / 10,
      hardBrakes: this.hardBrakes,
      stops: this.stops,
    };
  }

  toJSON() {
    return { ...this.summary(), samples: this.samples };
  }
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function formatDistance(meters, unit = "kmh") {
  const v = unit === "mph" ? meters / 1609.344 : meters / 1000;
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${unit === "mph" ? "mi" : "km"}`;
}
