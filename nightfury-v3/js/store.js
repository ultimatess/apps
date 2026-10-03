// Persistent settings, custom messages and recents (localStorage, versioned keys).
const KEY = "nightfury.v3";

export const DEFAULT_SETTINGS = {
  brightness: 85,
  speed: 6,
  color: "#06b6d4",
  style: "scroll",
  autoHud: true,
  holdKey: "10s",
  unit: "kmh",
  limitKmh: 0,
  stoppedMode: "stopped",
  brakeLight: true,
  brakeSensitivity: "medium",
  invertTurns: false,
  pixelFont: true,
  lsbFirst: true,
  protocol: "ipixel",
  liveAnimation: false,
  sound: true,
  haptics: true,
  voiceLang: "ta-IN",
  sensorsWanted: false,
  autoRotate: false,
  autoRotateInterval: "10s",
  autoRotateCategory: "eyes",
};

export function createStore(storage = globalThis.localStorage) {
  const read = (k, fallback) => {
    try {
      const raw = storage?.getItem(`${KEY}.${k}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (k, v) => {
    try { storage?.setItem(`${KEY}.${k}`, JSON.stringify(v)); } catch { /* quota / private mode */ }
  };

  const settings = { ...DEFAULT_SETTINGS, ...read("settings", {}) };
  let custom = read("custom", []);
  let recents = read("recents", []);

  return {
    settings,
    set(patch) {
      Object.assign(settings, patch);
      write("settings", settings);
      return settings;
    },
    reset() {
      Object.keys(settings).forEach((k) => delete settings[k]);
      Object.assign(settings, DEFAULT_SETTINGS);
      write("settings", settings);
    },
    get custom() { return custom; },
    addCustom(item) {
      custom = [item, ...custom.filter((c) => c.text !== item.text)].slice(0, 24);
      write("custom", custom);
    },
    removeCustom(text) {
      custom = custom.filter((c) => c.text !== text);
      write("custom", custom);
    },
    get recents() { return recents; },
    pushRecent(item) {
      recents = [item, ...recents.filter((r) => r.text !== item.text)].slice(0, 8);
      write("recents", recents);
    },
  };
}
