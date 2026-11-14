// Serial BLE job queue. Jobs run strictly one at a time (GATT allows one operation
// in flight). Jobs with the same `key` coalesce: if a newer job arrives while an
// older one is still waiting, the older one is dropped (resolves { superseded: true }).
// This keeps the panel responsive when sliders or GPS produce bursts of updates;
// v2 queued every update and could lag seconds behind.

export class TxQueue {
  constructor({ gapMs = 15, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.gapMs = gapMs;
    this.sleep = sleep;
    this.jobs = [];
    this.running = false;
    this.stats = { run: 0, superseded: 0, failed: 0 };
  }

  get busy() {
    return this.running || this.jobs.length > 0;
  }

  get pending() {
    return this.jobs.length;
  }

  enqueue(fn, { key = null } = {}) {
    return new Promise((resolve, reject) => {
      if (key !== null) {
        const idx = this.jobs.findIndex((j) => j.key === key);
        if (idx >= 0) {
          const [old] = this.jobs.splice(idx, 1);
          this.stats.superseded++;
          old.resolve({ superseded: true });
        }
      }
      this.jobs.push({ fn, key, resolve, reject });
      this.drain();
    });
  }

  clear(reason = "cleared") {
    const jobs = this.jobs.splice(0);
    for (const j of jobs) j.resolve({ cancelled: true, reason });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift();
        try {
          const value = await job.fn();
          this.stats.run++;
          job.resolve({ value });
        } catch (err) {
          this.stats.failed++;
          job.reject(err);
        }
        if (this.jobs.length && this.gapMs > 0) await this.sleep(this.gapMs);
      }
    } finally {
      this.running = false;
    }
  }

  /** Resolves once the queue is empty and idle. */
  async idle() {
    while (this.busy) await this.sleep(5);
  }
}
