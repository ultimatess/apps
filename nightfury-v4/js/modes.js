// Modes: endless programmes built from a content set.
//   kural    Thirukkural couplets (title card, line one, line two, short English gist)
//   story    mini stories told a line at a time, ending on a moral
//   comedy   set-up, punchline, laugh
//   friends  fun lines for the people you ride with
//   tvk      supporter lines for Tamilaga Vettri Kazhagam / Vijay
//   pics     the picture pack (pictures.js): cartoon stories and memes, one pass each
//
// A programme is a show whose items carry their scene inline:
//   { id, name, mode, items: [{ scene, secs, label, unit }] }
// `unit` groups the beats of one couplet / story / joke, so "next" can skip a whole one.
//
// The Tamil couplets were checked against the public tk120404/thirukkural dataset
// (the text itself is ancient and in the public domain). The English gists, the
// story retellings and the jokes are written for this app.
import { PICS, PIC_IDS, picLoopMs } from "./pictures.js";

const KURALS = [
  [1, "அகர முதல எழுத்தெல்லாம் ஆதி", "பகவன் முதற்றே உலகு", "EVERYTHING HAS A FIRST CAUSE"],
  [2, "கற்றதனால் ஆய பயனென்கொல் வாலறிவன்", "நற்றாள் தொழாஅர் எனின்", "LEARNING MEANS LITTLE WITHOUT HUMILITY"],
  [3, "மலர்மிசை ஏகினான் மாணடி சேர்ந்தார்", "நிலமிசை நீடுவாழ் வார்", "HOLD ON TO THE GOOD AND LIVE LONG"],
  [4, "வேண்டுதல் வேண்டாமை இலானடி சேர்ந்தார்க்கு", "யாண்டும் இடும்பை இல", "FREE OF WANT, FREE OF SORROW"],
  [10, "பிறவிப் பெருங்கடல் நீந்துவர் நீந்தார்", "இறைவன் அடிசேரா தார்", "FAITH CARRIES YOU ACROSS"],
  [34, "மனத்துக்கண் மாசிலன் ஆதல் அனைத்தறன்", "ஆகுல நீர பிற", "A CLEAN MIND IS ALL OF VIRTUE"],
  [45, "அன்பும் அறனும் உடைத்தாயின் இல்வாழ்க்கை", "பண்பும் பயனும் அது", "LOVE AND VIRTUE MAKE A HOME"],
  [50, "வையத்துள் வாழ்வாங்கு வாழ்பவன் வான்உறையும்", "தெய்வத்துள் வைக்கப் படும்", "LIVE WELL AND BE HONOURED"],
  [71, "அன்பிற்கும் உண்டோ அடைக்குந்தாழ் ஆர்வலர்", "புன்கணீர் பூசல் தரும்", "LOVE CANNOT BE LOCKED AWAY"],
  [72, "அன்பிலார் எல்லாம் தமக்குரியர் அன்புடையார்", "என்பும் உரியர் பிறர்க்கு", "THE LOVING GIVE EVEN THEMSELVES"],
  [80, "அன்பின் வழியது உயிர்நிலை அஃதிலார்க்கு", "என்புதோல் போர்த்த உடம்பு", "WITHOUT LOVE, ONLY SKIN AND BONE"],
  [90, "மோப்பக் குழையும் அனிச்சம் முகந்திரிந்து", "நோக்கக் குழையும் விருந்து", "A COLD LOOK WILTS A GUEST"],
  [100, "இனிய உளவாக இன்னாத கூறல்", "கனிஇருப்பக் காய்கவர்ந் தற்று", "WHY PICK SOUR WORDS WHEN SWEET ONES ARE RIPE"],
  [101, "செய்யாமல் செய்த உதவிக்கு வையகமும்", "வானகமும் ஆற்றல் அரிது", "UNASKED HELP IS BEYOND PRICE"],
  [102, "காலத்தி னாற்செய்த நன்றி சிறிதெனினும்", "ஞாலத்தின் மாணப் பெரிது", "HELP IN TIME IS BIGGER THAN THE WORLD"],
  [108, "நன்றி மறப்பது நன்றன்று நன்றல்லது", "அன்றே மறப்பது நன்று", "REMEMBER KINDNESS. FORGET HARM AT ONCE"],
  [110, "எந்நன்றி கொன்றார்க்கும் உய்வுண்டாம் உய்வில்லை", "செய்ந்நன்றி கொன்ற மகற்கு", "NO ESCAPE FOR THE UNGRATEFUL"],
  [121, "அடக்கம் அமரருள் உய்க்கும் அடங்காமை", "ஆரிருள் உய்த்து விடும்", "SELF-CONTROL LIFTS YOU UP"],
  [127, "யாகாவா ராயினும் நாகாக்க காவாக்கால்", "சோகாப்பர் சொல்லிழுக்குப் பட்டு", "GUARD YOUR TONGUE ABOVE ALL"],
  [129, "தீயினாற் சுட்டபுண் உள்ளாறும் ஆறாதே", "நாவினாற் சுட்ட வடு", "BURNS HEAL. HARSH WORDS DO NOT"],
  [131, "ஒழுக்கம் விழுப்பந் தரலான் ஒழுக்கம்", "உயிரினும் ஓம்பப் படும்", "CONDUCT IS WORTH MORE THAN LIFE"],
  [151, "அகழ்வாரைத் தாங்கும் நிலம்போலத் தம்மை", "இகழ்வார்ப் பொறுத்தல் தலை", "BE PATIENT LIKE THE EARTH"],
  [200, "சொல்லுக சொல்லிற் பயனுடைய சொல்லற்க", "சொல்லிற் பயனிலாச் சொல்", "SPEAK ONLY WORDS THAT HELP"],
  [202, "தீயவை தீய பயத்தலால் தீயவை", "தீயினும் அஞ்சப் படும்", "FEAR WRONGDOING MORE THAN FIRE"],
  [211, "கைம்மாறு வேண்டா கடப்பாடு மாரிமாட்டு", "என்ஆற்றுங் கொல்லோ உலகு", "RAIN ASKS NOTHING BACK. GIVE LIKE RAIN"],
  [231, "ஈதல் இசைபட வாழ்தல் அதுவல்லது", "ஊதியம் இல்லை உயிர்க்கு", "GIVE, AND LIVE WITH A GOOD NAME"],
  [236, "தோன்றின் புகழொடு தோன்றுக அஃதிலார்", "தோன்றலின் தோன்றாமை நன்று", "IF YOU SHOW UP, SHOW UP WELL"],
  [291, "வாய்மை எனப்படுவது யாதெனின் யாதொன்றும்", "தீமை இலாத சொலல்", "TRUTH IS SPEECH THAT HARMS NO ONE"],
  [314, "இன்னாசெய் தாரை ஒறுத்தல் அவர்நாண", "நன்னயஞ் செய்து விடல்", "ANSWER HARM WITH KINDNESS"],
  [322, "பகுத்துண்டு பல்லுயிர் ஓம்புதல் நூலோர்", "தொகுத்தவற்றுள் எல்லாந் தலை", "SHARE YOUR FOOD. PROTECT ALL LIFE"],
  [391, "கற்க கசடறக் கற்பவை கற்றபின்", "நிற்க அதற்குத் தக", "LEARN WELL, THEN LIVE WHAT YOU LEARNED"],
  [392, "எண்ணென்ப ஏனை எழுத்தென்ப இவ்விரண்டும்", "கண்ணென்ப வாழும் உயிர்க்கு", "NUMBERS AND LETTERS ARE OUR TWO EYES"],
  [396, "தொட்டனைத் தூறும் மணற்கேணி மாந்தர்க்குக்", "கற்றனைத் தூறும் அறிவு", "DIG DEEPER, FIND WATER. STUDY MORE, FIND WISDOM"],
  [400, "கேடில் விழுச்செல்வம் கல்வி யொருவற்கு", "மாடல்ல மற்றை யவை", "LEARNING IS THE WEALTH THAT LASTS"],
  [411, "செல்வத்துட் செல்வஞ் செவிச்செல்வம் அச்செல்வம்", "செல்வத்து ளெல்லாந் தலை", "LISTENING IS THE BEST WEALTH"],
  [423, "எப்பொருள் யார்யார்வாய்க் கேட்பினும் அப்பொருள்", "மெய்ப்பொருள் காண்ப தறிவு", "WHOEVER SAYS IT, FIND THE TRUTH IN IT"],
  [467, "எண்ணித் துணிக கருமம் துணிந்தபின்", "எண்ணுவம் என்பது இழுக்கு", "THINK FIRST, THEN ACT"],
  [504, "குணம்நாடிக் குற்றமும் நாடி அவற்றுள்", "மிகைநாடி மிக்க கொளல்", "WEIGH THE GOOD AND THE BAD, THEN JUDGE"],
  [517, "இதனை இதனால் இவன்முடிக்கும் என்றாய்ந்து", "அதனை அவன்கண் விடல்", "GIVE THE JOB TO THE RIGHT PERSON"],
  [596, "உள்ளுவ தெல்லாம் உயர்வுள்ளல் மற்றது", "தள்ளினுந் தள்ளாமை நீர்த்து", "AIM HIGH IN EVERY THOUGHT"],
  [611, "அருமை உடைத்தென்று அசாவாமை வேண்டும்", "பெருமை முயற்சி தரும்", "NEVER SAY IT IS TOO HARD. EFFORT WINS"],
  [616, "முயற்சி திருவினை ஆக்கும் முயற்றின்மை", "இன்மை புகுத்தி விடும்", "EFFORT BRINGS FORTUNE"],
  [619, "தெய்வத்தான் ஆகா தெனினும் முயற்சிதன்", "மெய்வருத்தக் கூலி தரும்", "EFFORT ALWAYS PAYS ITS WAGES"],
  [620, "ஊழையும் உப்பக்கம் காண்பர் உலைவின்றித்", "தாழாது உஞற்று பவர்", "TIRELESS EFFORT BEATS EVEN FATE"],
  [621, "இடுக்கண் வருங்கால் நகுக அதனை", "அடுத்தூர்வது அஃதொப்ப தில்", "LAUGH WHEN TROUBLE COMES"],
  [664, "சொல்லுதல் யார்க்கும் எளிய அரியவாம்", "சொல்லிய வண்ணம் செயல்", "SAYING IS EASY. DOING IS HARD"],
  [666, "எண்ணிய எண்ணியாங்கு எய்துவர் எண்ணியார்", "திண்ணியர் ஆகப் பெறின்", "FIRM MINDS GET WHAT THEY AIM FOR"],
  [788, "உடுக்கை இழந்தவன் கைபோல ஆங்கே", "இடுக்கண் களைவதாம் நட்பு", "A FRIEND HELPS BEFORE YOU ASK"],
  [948, "நோய்நாடி நோய்முதல் நாடி அதுதணிக்கும்", "வாய்நாடி வாய்ப்பச் செயல்", "FIND THE CAUSE, THEN THE CURE"],
  [972, "பிறப்பொக்கும் எல்லா உயிர்க்கும் சிறப்பொவ்வா", "செய்தொழில் வேற்றுமை யான்", "ALL ARE BORN EQUAL"],
  [1031, "சுழன்றும்ஏர்ப் பின்னது உலகம் அதனால்", "உழந்தும் உழவே தலை", "THE WORLD FOLLOWS THE PLOUGH"],
  [1033, "உழுதுண்டு வாழ்வாரே வாழ்வார்மற் றெல்லாம்", "தொழுதுண்டு பின்செல் பவர்", "FARMERS FEED EVERYONE ELSE"],
];

// Each story: a title, the beats, and a closing moral - in Tamil and in English.
const STORIES = [
  {
    ta: ["தாகமான காகம்", ["ஒரு காகத்துக்கு தாகம்", "பானையில் கொஞ்சம் தண்ணீர்", "கற்களைப் போட்டது", "தண்ணீர் மேலே வந்தது!"], "யோசி. வழி பிறக்கும்"],
    en: ["THE THIRSTY CROW", ["A CROW WAS THIRSTY", "THE POT HAD LITTLE WATER", "IT DROPPED IN PEBBLES", "THE WATER ROSE"], "THINK. THEN DRINK"],
  },
  {
    ta: ["ஆமையும் முயலும்", ["முயல் வேகமாக ஓடியது", "நடுவில் தூங்கியது", "ஆமை நிற்காமல் நடந்தது", "ஆமை வென்றது!"], "நிதானமே வெற்றி"],
    en: ["TORTOISE AND HARE", ["THE HARE RAN FAST", "THEN TOOK A NAP", "THE TORTOISE KEPT WALKING", "THE TORTOISE WON"], "SLOW AND STEADY. LIKE THIS LANE"],
  },
  {
    ta: ["சிங்கமும் எலியும்", ["சிங்கம் எலியை விட்டது", "சிங்கம் வலையில் சிக்கியது", "எலி வலையைக் கடித்தது", "சிங்கம் தப்பியது!"], "சிறிய உதவியும் பெரியது"],
    en: ["LION AND MOUSE", ["A LION SPARED A MOUSE", "THE LION GOT CAUGHT IN A NET", "THE MOUSE CHEWED THE ROPE", "THE LION WAS FREE"], "NO HELP IS TOO SMALL"],
  },
  {
    ta: ["நரியும் திராட்சையும்", ["நரி திராட்சையைப் பார்த்தது", "எட்டி எட்டிக் குதித்தது", "கிடைக்கவில்லை", "சீ சீ, இந்தப் பழம் புளிக்கும்!"], "கிடைக்காததை குறை சொல்லாதே"],
    en: ["FOX AND GRAPES", ["A FOX SAW GRAPES", "IT JUMPED. AND JUMPED", "NO LUCK", "SOUR ANYWAY, SAID THE FOX"], "SOUNDS LIKE MY PARKING"],
  },
  {
    ta: ["எறும்பும் வெட்டுக்கிளியும்", ["எறும்பு கோடையில் சேமித்தது", "வெட்டுக்கிளி பாடியது", "குளிர்காலம் வந்தது", "எறும்பு உணவைப் பகிர்ந்தது"], "சேமி. பகிர்"],
    en: ["ANT AND GRASSHOPPER", ["THE ANT SAVED ALL SUMMER", "THE GRASSHOPPER SANG", "WINTER CAME", "THE ANT SHARED ITS FOOD"], "SAVE. AND SHARE"],
  },
  {
    ta: ["சிக்னல்", ["சிவப்பு விளக்கு", "எல்லோரும் ஹாரன் அடித்தார்கள்", "விளக்கு மாறவில்லை", "ஒருவர் மட்டும் சிரித்தார்"], "பச்சை தானாக வந்தது"],
    en: ["THE SIGNAL", ["RED LIGHT", "EVERYONE HONKED", "THE LIGHT STAYED RED", "ONE DRIVER SMILED"], "GREEN CAME ANYWAY"],
  },
];

// [language, set-up, punchline]
const JOKES = [
  ["en", "WHY DID THE CAR NAP?", "IT WAS TYRED"],
  ["en", "I TOLD MY CAR A JOKE", "IT BRAKED UP LAUGHING"],
  ["en", "WHY IS THIS LANE SLOW?", "I AM IN IT"],
  ["en", "0 TO 60?", "EVENTUALLY"],
  ["en", "IF YOU CAN READ THIS", "YOU ARE TOO CLOSE"],
  ["en", "HONK IF YOU LOVE", "PEACE AND QUIET"],
  ["en", "MY OTHER CAR", "IS ALSO STUCK HERE"],
  ["en", "TRAFFIC JAM?", "I PREFER STRAWBERRY"],
  ["en", "I AM NOT SLOW", "I AM SAVING FUEL"],
  ["en", "WHERE DO CARS SWIM?", "IN A CAR POOL"],
  ["ta", "எந்த 'கால்'ல நடக்க முடியாது?", "மிஸ்டு கால்!"],
  ["ta", "எந்த 'பால்'ஐ குடிக்க முடியாது?", "ஃபுட்பால்!"],
  ["ta", "எந்த 'கீ' பூட்டைத் திறக்காது?", "மங்கீ!"],
  ["ta", "எந்த 'பஸ்'ல ஏற முடியாது?", "சிலபஸ்!"],
  ["ta", "எந்த 'மீன்' தண்ணீரில் இருக்காது?", "விண்மீன்!"],
  ["ta", "எந்த 'பூ'வைப் பறிக்க முடியாது?", "ஷாம்பூ!"],
  ["ta", "எந்த 'டீ'யைக் குடிக்க முடியாது?", "டி-ஷர்ட்!"],
  ["ta", "ஏன் மெதுவா போறேன் தெரியுமா?", "பெட்ரோல் விலை தெரியும்!"],
  ["ta", "ஹாரன் அடிச்சா", "சிக்னல் மாறாது பாஸ்!"],
  ["ta", "பின்னாடி வர்றவங்களுக்கு", "முன்னாடி போக வாழ்த்துக்கள்!"],
];

// [language, line]. Friendly banter for the people you ride with.
const FRIENDS = [
  ["ta", "மச்சி, டீ சாப்பிடலாமா?"],
  ["ta", "நண்பன் இருந்தா போதும்"],
  ["ta", "டேய்! எங்க டா போற?"],
  ["ta", "நட்புக்கு எல்லை இல்ல"],
  ["ta", "பிரியாணி ட்ரீட் எப்போ?"],
  ["ta", "நண்பேன்டா!"],
  ["ta", "சண்டை போட்டாலும் சேர்ந்தே சாப்பிடுவோம்"],
  ["ta", "வா மச்சி, ஒரு ரைட் போலாம்"],
  ["ta", "கடன் கேக்காத, நட்பு கெட்டுடும்"],
  ["ta", "மச்சான் வண்டி வருது, வழி விடு!"],
  ["en", "BESTIES ON BOARD"],
  ["en", "ROAD TRIP CREW"],
  ["en", "MY FRIEND DRIVES BETTER. HE SAYS"],
  ["en", "WHO IS PAYING FOR FUEL?"],
  ["en", "FRIENDS DON'T LET FRIENDS SKIP TEA"],
  ["en", "HONK IF YOU MISS YOUR GANG"],
  ["en", "TREAT PENDING SINCE 2019"],
  ["en", "NO FRIEND LEFT BEHIND. EXCEPT AT TOLLS"],
  ["en", "SQUAD GOAL: REACH ON TIME"],
  ["en", "GOOD FRIENDS. BAD DIRECTIONS"],
];

// [language, line]. Supporter lines for Tamilaga Vettri Kazhagam and Vijay. The party
// name and its motto (from Kural 972) are the party's own; the rest are fan lines
// written for this app, not official slogans.
const TVK = [
  ["ta", "தமிழக வெற்றிக் கழகம்"],
  ["ta", "பிறப்பொக்கும் எல்லா உயிர்க்கும்"],
  ["ta", "தளபதி"],
  ["ta", "வெற்றி நிச்சயம்"],
  ["ta", "வாகை சூடுவோம்"],
  ["ta", "நம்ம தளபதி, நம்ம பெருமை"],
  ["ta", "மக்களோடு தளபதி"],
  ["ta", "ஒன்றாய் வெல்வோம்"],
  ["ta", "தளபதி ரசிகன்"],
  ["ta", "தமிழ்நாடு வெல்லும்"],
  ["en", "TVK"],
  ["en", "THALAPATHY"],
  ["en", "TAMILAGA VETTRI KAZHAGAM"],
  ["en", "THALAPATHY FAN ON BOARD"],
  ["en", "ALL ARE BORN EQUAL"],
  ["en", "TEAM TVK"],
  ["en", "VIJAY FAN FOR LIFE"],
  ["en", "TVK FOR TAMIL NADU"],
];

const C = { amber: "#ff9000", cyan: "#00d0ff", lime: "#a3e635", white: "#ffffff", pink: "#ff2d6f", yellow: "#ffd000", green: "#00e060", red: "#ff1a1a", purple: "#a855f7" };

const text = (t, color, extra = {}) => ({ kind: "text", text: t, color, color2: "#ffffff", paint: "solid", effect: "auto", size: "big", ...extra });

export const MODES = {
  kural: {
    label: "திருக்குறள்", name: "Thirukkural", color: C.amber,
    hint: `${KURALS.length} couplets with a short gist`,
    cover: text("குறள்", C.amber, { effect: "static" }),
  },
  story: {
    label: "Mini stories", name: "Mini stories", color: C.pink,
    hint: `${STORIES.length} tiny stories, a line at a time`,
    cover: text("STORY", C.pink, { effect: "static" }),
  },
  comedy: {
    label: "Comedy", name: "Comedy", color: C.yellow,
    hint: `${JOKES.length} one-liners: set-up, punchline, laugh`,
    cover: text("HA HA!", C.yellow, { effect: "static" }),
  },
  friends: {
    label: "நண்பர்கள்", name: "Friends", color: C.purple,
    hint: `${FRIENDS.length} fun lines for your gang`,
    cover: text("FRIENDS", C.purple, { effect: "static" }),
  },
  pics: {
    label: "படக்கதை", name: "Picture pack", color: C.lime,
    hint: `${PIC_IDS.length} cartoon stories and memes`,
    cover: { kind: "pic", id: "crow" },
  },
  tvk: {
    label: "TVK", name: "TVK · Vijay", color: C.red,
    hint: `${TVK.length} supporter lines in party colours`,
    cover: text("TVK", C.red, { effect: "static", paint: "solid" }),
  },
};

export const MODE_IDS = Object.keys(MODES);
export const MODE_LANGS = ["ta", "en", "both"];

/** Deterministic shuffle (seed 0 keeps the original order). */
export function shuffled(list, seed = 0) {
  const out = list.slice();
  if (!seed) return out;
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Rough reading time when no layout-based measure is supplied (tests, Node). */
export function estimateMs(scene) {
  if (scene.kind !== "text") return 2500;
  const chars = [...scene.text].length;
  const words = scene.text.trim().split(/\s+/).length;
  if (scene.effect === "words" && words > 1) return words * 600 + chars * 80 + 450;
  if (scene.effect === "static") return 2400;
  return Math.max(2400, Math.round(((96 + chars * 9) / 100) * 1100));
}

/**
 * Build the programme for a mode.
 *   lang     "ta" | "en" | "both"
 *   style    "scroll" (a line is static when it fits, otherwise scrolls) | "words" (one word at a time)
 *   seed     shuffle seed; 0 = original order
 *   measure  (scene) -> ms the scene needs on the panel (the app measures the real layout)
 *   pace     multiplier on the fixed beats (title cards, eyes); the message speed sets it
 */
export function buildProgramme(mode, { lang = "both", style = "scroll", seed = 0, measure = estimateMs, pace = 1 } = {}) {
  const meta = MODES[mode];
  if (!meta) return null;
  const body = style === "words" ? "words" : "auto";
  const items = [];
  let unit = 0;
  const beat = (scene, label, ms) => items.push({ scene, label, unit, secs: Math.max(1.5, Math.round((ms != null ? ms * pace : measure(scene)) / 100) / 10) });
  const eyes = (mood, color) => ({ kind: "eyes", mode: `living_${mood}`, color, react: false });
  const ta = lang === "ta" || lang === "both";
  const en = lang === "en" || lang === "both";

  if (mode === "kural") {
    for (const [n, l1, l2, gist] of shuffled(KURALS, seed)) {
      const label = ta ? `குறள் ${n}` : `Kural ${n}`;
      beat(ta ? text(`குறள் ${n}`, C.amber, { effect: "static" }) : text(`KURAL ${n}`, C.amber, { effect: "static", size: "small" }), label, 2200);
      if (ta) {
        beat(text(l1, C.cyan, { effect: body }), label);
        beat(text(l2, C.cyan, { effect: body }), label);
      }
      if (en) beat(text(gist, C.lime, { effect: body }), label);
      unit++;
    }
  } else if (mode === "story") {
    const tellings = shuffled(STORIES, seed).flatMap((s) => [ta && s.ta, en && s.en].filter(Boolean));
    for (const [title, beats, moral] of tellings) {
      beat(text(title, C.pink, { effect: body }), title);
      for (const b of beats) beat(text(b, C.white, { effect: body }), title);
      beat(text(moral, C.lime, { effect: body }), title);
      beat(eyes("happy", C.green), title, 2400);
      unit++;
    }
  } else if (mode === "friends") {
    const tints = [C.purple, C.cyan, C.pink, C.lime];
    let n = 0;
    for (const [l, line] of shuffled(FRIENDS, seed)) {
      if ((l === "ta" && !ta) || (l === "en" && !en)) continue;
      beat(text(line, tints[n++ % tints.length], { effect: body }), line);
      beat(eyes(n % 2 ? "wink" : "happy", C.purple), line, 2000);
      unit++;
    }
  } else if (mode === "pics") {
    // Each cartoon plays one full pass; the message speed stretches it (pace).
    for (const id of shuffled(PIC_IDS, seed)) {
      items.push({ scene: { kind: "pic", id }, label: PICS[id].label, unit, secs: Math.round((picLoopMs(id) * pace) / 100) / 10 });
      unit++;
    }
  } else if (mode === "tvk") {
    // Party colours: red and yellow, alternating word by word.
    for (const [l, line] of shuffled(TVK, seed)) {
      if ((l === "ta" && !ta) || (l === "en" && !en)) continue;
      beat(text(line, C.red, { effect: body, paint: "duo", color2: C.yellow }), line);
      unit++;
    }
  } else {
    for (const [l, setup, punch] of shuffled(JOKES, seed)) {
      if ((l === "ta" && !ta) || (l === "en" && !en)) continue;
      beat(text(setup, C.cyan, { effect: body }), setup);
      beat(text(punch, C.yellow, { effect: body }), setup);
      beat(eyes("happy", C.green), setup, 2200);
      unit++;
    }
  }
  return { id: `mode.${mode}`, name: meta.name, mode, seed, units: unit, items };
}

/** Index of the first beat of the unit after the one at `index` (wraps). */
export function nextUnitIndex(programme, index) {
  const items = programme.items;
  const cur = items[index]?.unit;
  for (let k = 1; k <= items.length; k++) {
    const i = (index + k) % items.length;
    if (items[i].unit !== cur) return i;
  }
  return 0;
}

export const KURAL_COUNT = KURALS.length;
export const kuralLines = () => KURALS.map(([n, l1, l2, gist]) => ({ n, l1, l2, gist }));
