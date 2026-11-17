// Panel memory: keeps your last few messages in the panel's own save slots, so it
// still shows them after a restart with no phone connected (what the vendor app does).
//
// Live frames always go out with save slot 0, which the panel treats as temporary.
// When you send a message, picture or pixel art, it is also written once to a slot
// 1..keep: the same message is never written twice (flash memory wears), a new one
// takes a free slot or replaces the oldest. HUD, signals, eyes, clock, modes and
// shows are never stored: they only make sense live and change every few seconds.
import { sceneKey, sceneTint } from "./scene.js";

export const MEMORY_MAX = 5;
export const KEEP_OPTIONS = [0, 3, 5];

const clampKeep = (n) => Math.max(0, Math.min(MEMORY_MAX, Math.round(Number(n)) || 0));

/**
 * Where a message goes. Pure.
 *   records  [{ slot, key, label, scene, at }]
 * Returns { slot, write, records } (write=false: already stored, only its recency changes),
 * or null when memory is off.
 */
export function planSlot(records, key, keep, at, extra = {}) {
  const n = clampKeep(keep);
  if (!n) return null;
  const live = records.filter((r) => r.slot >= 1 && r.slot <= n);
  const hit = live.find((r) => r.key === key);
  if (hit) {
    return { slot: hit.slot, write: false, records: live.map((r) => (r === hit ? { ...r, ...extra, at } : r)) };
  }
  const used = new Set(live.map((r) => r.slot));
  let slot = 0;
  for (let s = 1; s <= n; s++) if (!used.has(s)) { slot = s; break; }
  if (!slot) slot = live.reduce((a, b) => (b.at < a.at ? b : a)).slot; // replace the oldest
  const rec = { slot, key, at, ...extra };
  return { slot, write: true, records: [...live.filter((r) => r.slot !== slot), rec].sort((a, b) => a.slot - b.slot) };
}

/** Slots above `keep` that have to be emptied when memory shrinks (or is switched off). */
export function slotsBeyond(records, keep) {
  const n = clampKeep(keep);
  return records.filter((r) => r.slot > n).map((r) => r.slot);
}

export class PanelMemory {
  /**
   * panel       IPixelPanel (ready, saveToSlot, deleteSlot, showSlot)
   * scenes      createScenes() (stored)
   * settings    () => settings (panelKeep, lsbFirst, multiColor, speed)
   * load/save   persistence of { records, pendingDelete }
   * fontsReady  (text) => Promise: Tamil / emoji rasters must not be stored before the font loads
   * onWrite     called after each slot write (the app re-sends the live scene)
   */
  constructor({ panel, scenes, settings, load = () => null, save = () => {}, fontsReady = () => Promise.resolve(), wall = () => Date.now(), onWrite = () => {}, log = () => {} }) {
    Object.assign(this, { panel, scenes, settings, save: (s) => save(s), fontsReady, wall, onWrite, log });
    const s = load() ?? {};
    this.records = Array.isArray(s.records) ? s.records.filter((r) => r && Number.isInteger(r.slot)) : [];
    this.pendingDelete = Array.isArray(s.pendingDelete) ? s.pendingDelete.filter(Number.isInteger) : [];
    this.busy = Promise.resolve();
  }

  get keep() {
    return clampKeep(this.settings().panelKeep ?? 3);
  }

  persist() {
    this.save({ records: this.records, pendingDelete: this.pendingDelete });
  }

  /** Identity of what would be written: the message plus everything that changes its bytes. */
  keyOf(scene) {
    const S = this.settings();
    // Pixel art is kept as its first frame, so that frame is its identity (a re-send gets a new rev).
    const base = scene.kind === "art" ? `art|${scene.frames?.[0] ?? ""}` : sceneKey({ ...scene, nonce: undefined });
    const speed = scene.kind === "text" ? `|v${this.scenes.speed(scene)}` : "";
    return `${base}${speed}|${S.lsbFirst ? "l" : "m"}${S.multiColor ? "c" : "1"}`;
  }

  /** Store a message the user just sent. Resolves to { slot, written } or { skipped: reason }. */
  remember(scene, label = "") {
    const run = async () => {
      if (!this.keep) return { skipped: "off" };
      if (!this.panel.ready) return { skipped: "offline" };
      if (!this.scenes.stored(scene)) return { skipped: "live-only" };
      if (scene.kind === "text") await this.fontsReady(scene.text);
      const stored = this.scenes.stored(scene); // again: the raster may have changed once the font loaded
      const key = this.keyOf(scene);
      const plan = planSlot(this.records, key, this.keep, this.wall(), { label, scene: slim(scene) });
      this.records = plan.records;
      this.persist();
      if (!plan.write) return { slot: plan.slot, written: false };
      const res = await this.panel.saveToSlot(stored, plan.slot, { fallback: sceneTint(scene), label });
      if (res?.error || res?.skipped || res?.superseded || res?.cancelled) {
        // Not on the panel after all: forget it so a later send tries again.
        this.records = this.records.filter((r) => !(r.slot === plan.slot && r.key === key));
        this.persist();
        return { skipped: "write-failed" };
      }
      this.log(`Kept on the panel in slot ${plan.slot}: ${label}`, "ble");
      this.onWrite(plan.slot, scene);
      return { slot: plan.slot, written: true };
    };
    // One at a time, in the order sent.
    const p = this.busy.then(run, run);
    this.busy = p.catch(() => {});
    return p;
  }

  /** Apply a new "keep" setting: slots beyond it are emptied now, or on the next connect. */
  async applyKeep() {
    const drop = slotsBeyond(this.records, this.keep);
    this.records = this.records.filter((r) => r.slot <= this.keep);
    this.pendingDelete = [...new Set([...this.pendingDelete, ...drop])];
    this.persist();
    return this.flush();
  }

  /** Empty every slot this app may have used. */
  async clear() {
    this.records = [];
    this.pendingDelete = Array.from({ length: MEMORY_MAX }, (_, i) => i + 1);
    this.persist();
    return this.flush();
  }

  /** Send deletes that could not go out while disconnected. Returns how many were sent. */
  async flush() {
    if (!this.panel.ready || !this.pendingDelete.length) return 0;
    const list = this.pendingDelete.slice().sort((a, b) => a - b);
    let sent = 0;
    for (const slot of list) {
      const res = await this.panel.deleteSlot(slot);
      if (res?.error || res?.skipped) break;
      this.pendingDelete = this.pendingDelete.filter((s) => s !== slot);
      sent++;
    }
    this.persist();
    return sent;
  }

  /** Most recent stored message, or null. */
  latest() {
    return this.records.reduce((a, b) => (!a || b.at > a.at ? b : a), null);
  }
}

/** What the Lab list needs to draw a stored item again (art frames are already compact). */
function slim(scene) {
  const { nonce, ...rest } = scene;
  return rest;
}
