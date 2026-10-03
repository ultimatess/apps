// Message boards. `text` is what goes to the panel; `label` is the button caption.
import { COLORS } from "./scene.js";
import { APK_EYES_META } from "./apk_eyes.js";

export const BOARDS = [
  {
    id: "road",
    title: "Road",
    subtitle: "Courtesy & safety",
    items: [
      { text: "நன்றி 🙏", label: "நன்றி 🙏", hint: "Thank you", color: COLORS.green, style: "static", speed: 5 },
      { text: "THANKS!", hint: "Pixel font", color: COLORS.green, style: "static", speed: 5 },
      { text: "வணக்கம் 🤝", hint: "Vanakkam", color: COLORS.cyan, style: "static", speed: 5 },
      { text: "மன்னிக்கவும் ✌️", hint: "Sorry", color: COLORS.amber, style: "scroll", speed: 5 },
      { text: "SORRY!", hint: "Pixel font", color: COLORS.amber, style: "static", speed: 5 },
      { text: "முந்திச் செல்லுங்கள் ➡️", label: "முந்திச் செல்க ➡️", hint: "Please pass", color: COLORS.cyan, style: "scroll", speed: 6 },
      { text: "வழி விடுக 🚗", hint: "Give way", color: "#38bdf8", style: "scroll", speed: 6 },
      { text: "மெதுவாகச் செல்லவும் 🐢", hint: "Drive slow", color: COLORS.amber, style: "scroll", speed: 5 },
      { text: "பாதுகாப்பான இடைவெளி விடுக ⛔", label: "இடைவெளி விடுக ⛔", hint: "Keep distance", color: COLORS.red, style: "scroll", speed: 6 },
      { text: "KEEP DISTANCE", hint: "Pixel font", color: COLORS.red, style: "scroll", speed: 6 },
      { text: "எச்சரிக்கை! ⚠️", hint: "Caution", color: COLORS.red, style: "scroll", speed: 7 },
      { text: "HAZARD", hint: "Pixel font", color: COLORS.red, style: "static", speed: 6 },
    ],
  },
  {
    id: "meme",
    title: "Meme",
    subtitle: "Tamil cinema banter",
    items: [
      { text: "பேசிட்டே போலாம் வா 😎", hint: "Vadivelu classic", color: COLORS.amber, style: "scroll", speed: 6 },
      { text: "ஆஹான்?! 🤨", hint: "Reaction", color: COLORS.cyan, style: "static", speed: 5 },
      { text: "என்ன கொடுமை சரவணா இது! 🤦", label: "என்ன கொடுமை சரவணா! 🤦", hint: "Traffic jam", color: COLORS.red, style: "scroll", speed: 6 },
      { text: "பயபுள்ள பயந்துட்டான் போல! 😂", label: "பயபுள்ள பயந்துட்டான்! 😂", hint: "Overtake banter", color: COLORS.green, style: "scroll", speed: 6 },
      { text: "இவனுக வேற பின்னாடியே வருவானுங்க! 🚗", label: "இவனுக வேற பின்னாடியே!", hint: "Tailgater", color: COLORS.amber, style: "scroll", speed: 6 },
      { text: "சார், எங்கே போறீங்கனு தெரியாது...", label: "நீங்க எங்கே போறீங்க? 🤔", hint: "Vadivelu driving", color: COLORS.cyan, style: "scroll", speed: 6 },
      { text: "புல்லட் மாதிரி போறான்?! 🚀", hint: "Super fast pass", color: COLORS.purple, style: "scroll", speed: 7 },
      { text: "அப்படியே ஓரமா போயிருங்க! ➡️", label: "அப்படியே ஓரமா போங்க ➡️", hint: "Lane courtesy", color: COLORS.amber, style: "scroll", speed: 6 },
    ],
  },
];

export const EYES = [
  { mode: "angry", label: "Angry red", hint: "Slit pupils", icon: "😈", color: COLORS.red },
  { mode: "cyan_cyber", label: "Cyber rings", hint: "Sci-fi aperture", icon: "🤖", color: COLORS.cyan },
  { mode: "cylon", label: "Scanner bar", hint: "Knight Rider", icon: "⚡", color: COLORS.red },
  { mode: "winking", label: "Winking", hint: "Wink loop", icon: "😉", color: COLORS.amber },
  ...APK_EYES_META.map((m) => ({
    mode: m.mode,
    label: m.label,
    hint: m.hint,
    icon: m.icon,
    color: m.color,
  })),
];

export const PALETTE = [COLORS.red, COLORS.amber, COLORS.green, COLORS.cyan, "#3b82f6", COLORS.purple, "#ec4899", COLORS.white];

export const QUICK = [
  { text: "நன்றி 🙏", label: "நன்றி", color: COLORS.green, style: "static", speed: 5 },
  { text: "SORRY!", label: "Sorry", color: COLORS.amber, style: "static", speed: 5 },
  { text: "முந்திச் செல்லுங்கள் ➡️", label: "Pass", color: COLORS.cyan, style: "scroll", speed: 6 },
];
