// The library: everything you can put on the panel. Built-in items live here;
// items you make (Studio) live in the store. An item is a scene plus a label.
import { COLORS } from "./scene.js";
import { EYE_PACK, isReactive } from "./eyes.js";
import { FX } from "./fx.js";
import { MODES } from "./modes.js";

export const GROUPS = [
  { id: "all", title: "All" },
  { id: "mine", title: "Mine" },
  { id: "modes", title: "Modes" },
  { id: "road", title: "Road" },
  { id: "meme", title: "Meme" },
  { id: "eyes", title: "Eyes" },
  { id: "art", title: "Art" },
];

const road = [
  ["thanks-ta", "நன்றி 🙏", "Thank you", COLORS.green, "static"],
  ["thanks", "THANKS!", "Pixel font", COLORS.green, "static"],
  ["vanakkam", "வணக்கம் 🤝", "Vanakkam", COLORS.cyan, "static"],
  ["sorry-ta", "மன்னிக்கவும் ✌️", "Sorry", COLORS.amber, "scroll"],
  ["sorry", "SORRY!", "Pixel font", COLORS.amber, "static"],
  ["pass-ta", "முந்திச் செல்லுங்கள் ➡️", "Please pass", COLORS.cyan, "scroll", "முந்திச் செல்க ➡️"],
  ["giveway-ta", "வழி விடுக 🚗", "Give way", "#38bdf8", "scroll"],
  ["slow-ta", "மெதுவாகச் செல்லவும் 🐢", "Drive slow", COLORS.amber, "scroll"],
  ["distance-ta", "பாதுகாப்பான இடைவெளி விடுக ⛔", "Keep distance", COLORS.red, "scroll", "இடைவெளி விடுக ⛔"],
  ["distance", "KEEP YOUR DISTANCE", "One word at a time", COLORS.red, "words"],
  ["caution-ta", "எச்சரிக்கை! ⚠️", "Caution", COLORS.red, "scroll"],
  ["hazard", "HAZARD", "Blinks", COLORS.red, "blink"],
  ["baby", "BABY ON BOARD", "Two lines", "#ff2d6f", "auto", null, "small"],
  ["newdriver", "NEW DRIVER BE KIND", "Rainbow words", COLORS.lime, "words", null, "big", "rainbow"],
];

const meme = [
  ["pesitte", "பேசிட்டே போலாம் வா 😎", "Vadivelu classic", COLORS.amber, "scroll"],
  ["aahaan", "ஆஹான்?! 🤨", "Reaction", COLORS.cyan, "static"],
  ["kodumai", "என்ன கொடுமை சரவணா இது! 🤦", "Traffic jam", COLORS.red, "scroll", "என்ன கொடுமை சரவணா! 🤦"],
  ["payapulla", "பயபுள்ள பயந்துட்டான் போல! 😂", "Overtake banter", COLORS.green, "scroll", "பயபுள்ள பயந்துட்டான்! 😂"],
  ["pinnadi", "இவனுக வேற பின்னாடியே வருவானுங்க! 🚗", "Tailgater", COLORS.amber, "scroll", "இவனுக வேற பின்னாடியே!"],
  ["enga", "சார், எங்கே போறீங்கனு தெரியாது...", "Vadivelu driving", COLORS.cyan, "scroll", "நீங்க எங்கே போறீங்க? 🤔"],
  ["bullet", "புல்லட் மாதிரி போறான்?! 🚀", "Super fast pass", COLORS.purple, "scroll"],
  ["orama", "அப்படியே ஓரமா போயிருங்க! ➡️", "Lane courtesy", COLORS.amber, "scroll", "அப்படியே ஓரமா போங்க ➡️"],
];

const textItem = (group) => ([id, text, hint, color, effect, label, size, paint]) => ({
  id: `${group}.${id}`, group, kind: "text", builtin: true,
  text, label: label ?? text, hint, color, effect, size: size ?? "big", paint: paint ?? "solid", speed: 6,
});

export const BUILTIN_ITEMS = [
  ...Object.entries(MODES).map(([id, m]) => ({
    id: `mode.${id}`, group: "modes", kind: "mode", builtin: true, mode: id, label: m.label, hint: m.hint, color: m.color,
  })),
  ...road.map(textItem("road")),
  ...meme.map(textItem("meme")),
  ...EYE_PACK.map((e) => ({
    id: `eyes.${e.mode}`, group: "eyes", kind: "eyes", builtin: true,
    mode: e.mode, color: e.color, label: e.label, hint: e.hint, react: isReactive(e.mode),
  })),
  ...Object.entries(FX).map(([id, fx]) => ({
    id: `art.${id}`, group: "art", kind: "fx", builtin: true, fx: id, label: fx.label, hint: fx.hint, color: fx.color,
  })),
  { id: "art.clock", group: "art", kind: "clock", builtin: true, label: "Clock", hint: "Hours and minutes", color: "#ff9000" },
];

export const DEFAULT_PINS = ["road.thanks-ta", "road.sorry", "road.pass-ta", "eyes.living_calm", "mode.kural", "mode.comedy"];

export const BUILTIN_SHOWS = [
  {
    id: "show.eyes", name: "Eyes parade", builtin: true,
    items: ["living_calm", "living_sly", "living_wink", "living_happy", "living_love", "living_sleepy"].map((m) => ({ ref: `eyes.${m}`, secs: 8 })),
  },
  {
    id: "show.courtesy", name: "Courtesy loop", builtin: true,
    items: [{ ref: "art.thanks", secs: 6 }, { ref: "road.distance", secs: 8 }, { ref: "art.smile", secs: 6 }, { ref: "eyes.living_calm", secs: 10 }],
  },
  {
    id: "show.colour", name: "Colour demo", builtin: true,
    items: [{ ref: "art.equalizer", secs: 8 }, { ref: "art.wave", secs: 8 }, { ref: "road.newdriver", secs: 8 }, { ref: "art.sparkle", secs: 8 }],
  },
];

/** Item -> scene (the part the renderer and director care about). */
export function itemScene(item) {
  if (!item) return null;
  switch (item.kind) {
    case "text":
      return {
        kind: "text", text: item.text, color: item.color ?? "#ffffff", color2: item.color2 ?? "#ffffff",
        paint: item.paint ?? "solid", effect: item.effect ?? "auto", size: item.size ?? "big", speed: item.speed ?? 6,
      };
    case "eyes": return { kind: "eyes", mode: item.mode, color: item.color ?? "#ffffff", react: !!item.react };
    case "fx": return { kind: "fx", id: item.fx };
    case "art": return { kind: "art", id: item.id, rev: item.rev ?? 0, frames: item.frames ?? [], fps: item.fps ?? 4, name: item.label, tint: item.color };
    case "clock": return { kind: "clock", color: item.color ?? "#ff9000" };
    case "mode": return MODES[item.mode]?.cover ?? null; // cover card; tapping the item starts the mode
    default: return null;
  }
}

export const itemLabel = (item) => item?.label || item?.text || "Untitled";

export function itemHint(item) {
  if (item.hint) return item.hint;
  if (item.kind === "text") return { auto: "Text", static: "Static", scroll: "Scrolls", words: "Word by word", blink: "Blinks" }[item.effect ?? "auto"];
  if (item.kind === "art") return `${item.frames?.length ?? 1} frame${(item.frames?.length ?? 1) === 1 ? "" : "s"}`;
  return "";
}

/** One library view over built-ins and user items. */
export function createLibrary(store) {
  const byId = new Map(BUILTIN_ITEMS.map((i) => [i.id, i]));
  return {
    all() {
      return [...store.items, ...BUILTIN_ITEMS];
    },
    get(id) {
      return store.items.find((i) => i.id === id) ?? byId.get(id) ?? null;
    },
    scene(id) {
      return itemScene(this.get(id));
    },
    filter(group = "all", query = "") {
      const q = query.trim().toLowerCase();
      return this.all().filter((i) => (group === "all" || i.group === group)
        && (!q || `${itemLabel(i)} ${i.text ?? ""} ${i.hint ?? ""}`.toLowerCase().includes(q)));
    },
    pinned() {
      return store.pins.map((id) => this.get(id)).filter(Boolean);
    },
    shows() {
      return [...store.shows, ...BUILTIN_SHOWS];
    },
    show(id) {
      return this.shows().find((s) => s.id === id) ?? null;
    },
  };
}
