// Persistent state (localStorage, versioned keys): settings, your library items,
// pinned quick actions, shows and the trip computer. Also imports what v3 saved,
// since v3 and v4 are served from the same origin.
import { DEFAULT_PINS } from "./library.js";

const KEY = "nightfury.v4";
const V3_KEY = "nightfury.v3";

export const DEFAULT_SETTINGS = {
  brightness: 85,
  hud: "full", // off | signals | full
  holdKey: "10s",
  unit: "kmh",
  limitKmh: 0,
  stoppedMode: "content", // content | stopped | clock
  autoBrake: true,
  brakeSensitivity: "medium",
  autoTurn: true,
  invertTurns: false,
  signalTimeout: 30,
  pixelFont: true,
  multiColor: true,
  lsbFirst: true,
  motion: "all", // off | signals | all
  chunkSize: 20,
  nightDim: false,
  nightLevel: 35,
  sound: true,
  haptics: true,
  voiceLang: "ta-IN",
  sensorsWanted: false,
  resume: true,
  modeLang: "both", // ta | en | both
  modeStyle: "scroll", // scroll | words
  panelKeep: 3, // messages kept in the panel's own memory: 0 (off) | 3 | 5
  // Text studio draft
  color: "#00d0ff",
  color2: "#ffffff",
  paint: "solid",
  effect: "auto",
  size: "big",
  speed: 6,
};

const MAX_ITEMS = 60;
const MAX_SHOWS = 12;
const MAX_PINS = 8;

let idCounter = 0;
export const newId = (prefix = "u") => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function createStore(storage = globalThis.localStorage) {
  const read = (k, fallback, root = KEY) => {
    try {
      const raw = storage?.getItem(`${root}.${k}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (k, v) => {
    try { storage?.setItem(`${KEY}.${k}`, JSON.stringify(v)); return true; } catch { return false; /* quota / private mode */ }
  };

  const settings = { ...DEFAULT_SETTINGS, ...read("settings", {}) };
  let items = read("items", []);
  let pins = read("pins", null) ?? DEFAULT_PINS.slice();
  let shows = read("shows", []);
  let trips = read("trips", []);
  const meta = { onboarded: false, migratedV3: false, ...read("meta", {}) };

  const api = {
    settings,
    set(patch) {
      Object.assign(settings, patch);
      write("settings", settings);
      return settings;
    },
    resetSettings() {
      Object.keys(settings).forEach((k) => delete settings[k]);
      Object.assign(settings, DEFAULT_SETTINGS);
      write("settings", settings);
    },

    get items() { return items; },
    /** Insert or update a user item (matched by id). Returns the stored item. */
    saveItem(item) {
      const stored = { ...item, id: item.id && !item.builtin ? item.id : newId(), group: "mine", builtin: false, rev: (item.rev ?? 0) + 1 };
      items = [stored, ...items.filter((i) => i.id !== stored.id)].slice(0, MAX_ITEMS);
      write("items", items);
      return stored;
    },
    removeItem(id) {
      items = items.filter((i) => i.id !== id);
      write("items", items);
      if (pins.includes(id)) api.setPins(pins.filter((p) => p !== id));
      shows = shows.map((s) => ({ ...s, items: s.items.filter((it) => it.ref !== id) }));
      write("shows", shows);
    },

    get pins() { return pins; },
    setPins(ids) {
      pins = [...new Set(ids)].slice(0, MAX_PINS);
      write("pins", pins);
    },
    /** Returns true when the item is pinned afterwards. */
    togglePin(id) {
      if (pins.includes(id)) api.setPins(pins.filter((p) => p !== id));
      else if (pins.length >= MAX_PINS) return false;
      else api.setPins([...pins, id]);
      return pins.includes(id);
    },

    get shows() { return shows; },
    saveShow(show) {
      const stored = { id: show.id && !show.builtin ? show.id : newId("s"), name: String(show.name || "Untitled show").slice(0, 40), items: (show.items ?? []).slice(0, 40).map((it) => ({ ref: it.ref, secs: Math.max(2, Math.min(120, Number(it.secs) || 8)) })) };
      shows = [stored, ...shows.filter((s) => s.id !== stored.id)].slice(0, MAX_SHOWS);
      write("shows", shows);
      return stored;
    },
    removeShow(id) {
      shows = shows.filter((s) => s.id !== id);
      write("shows", shows);
    },

    /** What this app has put in the panel's save slots (see memory.js). */
    get panelMemory() { return read("panelMemory", null); },
    savePanelMemory(m) { write("panelMemory", m); },

    get trip() { return read("trip", null); },
    saveTrip(trip) { write("trip", trip); },
    get trips() { return trips; },
    pushTrip(summary) {
      trips = [summary, ...trips].slice(0, 12);
      write("trips", trips);
    },

    meta,
    setMeta(patch) {
      Object.assign(meta, patch);
      write("meta", meta);
    },

    exportAll() {
      return { app: "nightfury", version: 4, exportedAt: new Date().toISOString(), settings: { ...settings }, items, pins, shows, trips };
    },
    /** Merge a backup. Returns what was imported; throws on a file that is not a NightFury backup. */
    importAll(data) {
      if (!data || data.app !== "nightfury" || typeof data !== "object") throw new Error("Not a NightFury backup file");
      const out = { items: 0, shows: 0, settings: false };
      if (data.settings && typeof data.settings === "object") {
        const clean = {};
        for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof data.settings[k] === typeof DEFAULT_SETTINGS[k]) clean[k] = data.settings[k];
        api.set(clean);
        out.settings = true;
      }
      for (const it of Array.isArray(data.items) ? data.items : []) {
        if (!it || !["text", "art"].includes(it.kind)) continue;
        const keep = it.id && !items.some((x) => x.id === it.id);
        api.saveItem(keep ? it : { ...it, id: undefined });
        out.items++;
      }
      for (const s of Array.isArray(data.shows) ? data.shows : []) {
        if (!s || !Array.isArray(s.items)) continue;
        api.saveShow({ ...s, id: s.id && !shows.some((x) => x.id === s.id) ? s.id : undefined });
        out.shows++;
      }
      if (Array.isArray(data.pins)) api.setPins(data.pins.filter((p) => typeof p === "string"));
      return out;
    },

    /** One-time import of v3's saved messages and settings. Returns { items, settings } or null. */
    migrateV3() {
      if (meta.migratedV3) return null;
      const v3s = read("settings", null, V3_KEY);
      const v3c = read("custom", [], V3_KEY);
      api.setMeta({ migratedV3: true });
      if (!v3s && !(Array.isArray(v3c) && v3c.length)) return null;
      let count = 0;
      for (const c of Array.isArray(v3c) ? v3c.slice().reverse() : []) {
        if (!c || typeof c.text !== "string" || !c.text.trim()) continue;
        api.saveItem({ kind: "text", text: c.text, label: c.text, color: c.color ?? "#ffffff", effect: c.style === "static" ? "static" : "scroll", size: "big", paint: "solid" });
        count++;
      }
      if (v3s && typeof v3s === "object") {
        const patch = {};
        const copy = (from, to = from, ok = () => true) => { if (from in v3s && ok(v3s[from])) patch[to] = v3s[from]; };
        copy("brightness", "brightness", Number.isFinite);
        copy("unit", "unit", (v) => v === "kmh" || v === "mph");
        copy("limitKmh", "limitKmh", Number.isFinite);
        copy("speed", "speed", (v) => Number.isInteger(v) && v >= 1 && v <= 10);
        copy("holdKey", "holdKey", (v) => ["5s", "10s", "30s", "sticky"].includes(v));
        copy("brakeLight", "autoBrake", (v) => typeof v === "boolean");
        copy("brakeSensitivity", "brakeSensitivity", (v) => ["low", "medium", "high"].includes(v));
        copy("invertTurns", "invertTurns", (v) => typeof v === "boolean");
        copy("pixelFont", "pixelFont", (v) => typeof v === "boolean");
        copy("lsbFirst", "lsbFirst", (v) => typeof v === "boolean");
        copy("sound", "sound", (v) => typeof v === "boolean");
        copy("haptics", "haptics", (v) => typeof v === "boolean");
        copy("voiceLang", "voiceLang", (v) => typeof v === "string");
        if (typeof v3s.autoHud === "boolean") patch.hud = v3s.autoHud ? "full" : "off";
        if (typeof v3s.stoppedMode === "string") patch.stoppedMode = { stopped: "stopped", clock: "clock", message: "content" }[v3s.stoppedMode] ?? "content";
        if (typeof v3s.liveAnimation === "boolean") patch.motion = v3s.liveAnimation ? "all" : "signals";
        api.set(patch);
      }
      return { items: count, settings: !!v3s };
    },
  };
  return api;
}
