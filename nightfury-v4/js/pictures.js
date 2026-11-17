// Picture pack: tiny animated cartoons for the 96x16 panel. Four fables told in
// pictures and eight road / everyday memes, each a timeline of "shots".
// Pure functions of elapsed ms -> Frame, like fx.js. The panel stream manages about
// four frames a second, so every shot moves in 250 ms steps.
//
// Colour is one per 8-column chunk on the panel, so each object is drawn in one
// colour and objects that should differ sit in different chunks where possible.
// The preview always shows the quantized result, so what you see is what lights up.
import { Frame } from "./frame.js";
import { renderText } from "./font5x7.js";
import { icon } from "./icons.js";

export const PIC_STEP_MS = 250;

const C = {
  white: "#ffffff", amber: "#ff9000", orange: "#ff6a00", yellow: "#ffd000", red: "#ff1a1a", green: "#00e060",
  cyan: "#00d0ff", blue: "#3b82f6", purple: "#a855f7", pink: "#ff2d6f", lime: "#a3e635", grey: "#9aa4c0", stone: "#c8c8c8",
};

// ------------------------------------------------------------------ drawing helpers

const sprite = (rows) => ({ w: Math.max(...rows.map((r) => r.length)), h: rows.length, rows });

/** Draw a sprite. `colors` is one colour for "#", or a map of character -> colour. */
function put(f, s, x, y, colors, { flip = false } = {}) {
  const map = typeof colors === "string" ? { "#": colors } : colors;
  s.rows.forEach((row, yy) => {
    [...row].forEach((ch, xx) => {
      const c = map[ch];
      if (c) f.set(x + (flip ? s.w - 1 - xx : xx), y + yy, c);
    });
  });
}

/** Pixel-font text (5x7), centred in [x0, x0 + w). One line sits mid-height, two lines fill the rows. */
function caption(f, lines, color, { x0 = 48, w = 48, y } = {}) {
  const list = Array.isArray(lines) ? lines : [lines];
  const ys = y !== undefined ? [y] : list.length === 1 ? [4] : [0, 9];
  list.forEach((line, i) => {
    const b = renderText(line);
    f.paint(b, color, x0 + Math.floor((w - b.width) / 2), ys[i]);
  });
}

/** Big 2x text centred across the panel. */
function big(f, text, color, { x0 = 0, w = 96 } = {}) {
  const b = renderText(text, { scale: 2 });
  f.paint(b, color, x0 + Math.floor((w - b.width) / 2), 1);
}

const full = (lines, color) => (f) => caption(f, lines, color, { x0: 0, w: 96 });
const blink = (step, on = 2, off = 2) => step % (on + off) < on;

// ------------------------------------------------------------------ sprites

const S = {
  crowUp: sprite([
    "...#........",
    "...##.......",
    "....##...##.",
    ".#########oo",
    "##########..",
    "..######....",
  ]),
  crowDown: sprite([
    "............",
    "............",
    ".........##.",
    ".#########oo",
    "##########..",
    "..######....",
    "....##......",
    ".....##.....",
  ]),
  crowStand: sprite([
    "......###...",
    ".....##.#oo.",
    "##..#####...",
    ".########...",
    "..#######...",
    "...#####....",
    "....#..#....",
    "...##.##....",
  ]),
  pot: sprite([
    "##############",
    ".#..........#.",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    ".#..........#.",
    "..##########..",
  ]),
  hare: sprite([
    ".........#.#.",
    ".........#.#.",
    "........####.",
    "........#####",
    ".#######.###.",
    "##########...",
    ".#########...",
    "..#.....#....",
  ]),
  hareRun: sprite([
    ".........#.#.",
    ".........#.#.",
    "........####.",
    "........#####",
    ".#######.###.",
    "##########...",
    ".#########...",
    "#.........#..",
  ]),
  hareSleep: sprite([
    ".........##.",
    "..#######.##",
    "############",
    "############",
  ]),
  tortoise: sprite([
    "...######....",
    "..########...",
    ".##########..",
    ".############",
    "..#..#..#..#.",
  ]),
  tree: sprite([
    "..#####..",
    ".#######.",
    "#########",
    "#########",
    ".#######.",
    "..#####..",
    "....t....",
    "....t....",
    "....t....",
    "...ttt...",
  ]),
  flag: sprite([
    "#rrrr",
    "#rrrr",
    "#rrrr",
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
    "#....",
  ]),
  lion: sprite([
    "..############..",
    ".##############.",
    "###..........###",
    "##..##....##..##",
    "##..##....##..##",
    "##............##",
    "##.....##.....##",
    "##....####....##",
    "##.....##.....##",
    "###..#....#..###",
    ".###..####..###.",
    "..############..",
    "....########....",
  ]),
  lionHappy: sprite([
    "..############..",
    ".##############.",
    "###..........###",
    "##..##....##..##",
    "##............##",
    "##............##",
    "##.....##.....##",
    "##....####....##",
    "##.....##.....##",
    "###.#......#.###",
    ".###.######.###.",
    "..############..",
    "....########....",
  ]),
  mouse: sprite([
    "......##..",
    ".....####.",
    "#..#######",
    ".##.#...#.",
  ]),
  fox: sprite([
    "..........#.#.",
    "..........###.",
    ".........#####",
    "##......####..",
    ".##########...",
    "..#########...",
    "..#.#....#.#..",
  ]),
  grapes: sprite([
    "...s...",
    ".##s##.",
    "#######",
    ".#####.",
    "..###..",
    "...#...",
  ]),
  car: sprite([
    ".....#######....",
    "....#..#....#...",
    "...#...#.....#..",
    "################",
    "################",
    "################",
    "..##.......##...",
    "..##.......##...",
  ]),
  snail: sprite([
    "...###.....",
    "..#...#..#.",
    ".#..#..#.#.",
    ".#...##.##.",
    "###########",
  ]),
  bump: sprite([
    "....########....",
    "..############..",
    "################",
  ]),
  auto: sprite([
    "..##########....",
    ".#..........#...",
    "#...........##..",
    "#...........#.#.",
    "#...........#..#",
    "#############..#",
    "################",
    "################",
    ".###.......###..",
    ".###.......###..",
  ]),
  handi: sprite([
    "......####......",
    "...##########...",
    ".##############.",
    "#..............#",
    "#..............#",
    "#..............#",
    ".#............#.",
    "..############..",
  ]),
  lamp: sprite([
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
  ]),
  ring: sprite([
    ".####.",
    "#....#",
    "#....#",
    "#....#",
    "#....#",
    ".####.",
  ]),
};

const Z = renderText("Z");
const QUESTION = renderText("?");
const BANG = renderText("!");

// ------------------------------------------------------------------ the pictures
// Each picture: { label, hint, group: "story" | "meme", color, posterAt, shots: [[ms, draw(f, t, step)]] }.
// `posterAt` is the moment used for a still (thumbnail, panel animation off, panel memory).

function crowWater(f, level) {
  // Water rises inside the pot (x 32..45, bottom row 14).
  for (let i = 0; i < level; i++) f.fillRect(34, 14 - i, 10, 1, C.cyan);
}

export const PICS = {
  crow: {
    label: "Thirsty crow", hint: "Picture story", group: "story", color: C.cyan, posterAt: 9500,
    shots: [
      [2000, (f, t, k) => {
        put(f, k % 2 ? S.crowDown : S.crowUp, -12 + k * 4, 2, { "#": C.grey, o: C.yellow });
        put(f, S.pot, 32, 7, C.amber);
        crowWater(f, 1);
        caption(f, ["THIRSTY", "CROW"], C.amber);
      }],
      [1500, (f, t, k) => {
        put(f, S.crowStand, 19, 8, { "#": C.grey, o: C.yellow });
        put(f, S.pot, 32, 7, C.amber);
        crowWater(f, 1);
        if (blink(k)) f.paint(QUESTION, C.white, 25, 0);
        caption(f, ["WATER", "TOO LOW"], C.cyan);
      }],
      [3000, (f, t, k) => {
        const drop = Math.floor(k / 4); // three pebbles, one a second
        const s = k % 4;
        put(f, S.crowStand, 19, 8, { "#": C.grey, o: C.yellow });
        put(f, S.pot, 32, 7, C.amber);
        crowWater(f, 1 + drop * 2 + (s === 3 ? 2 : 0));
        if (s < 3) f.fillRect(37, [3, 7, 11][s], 2, 2, C.stone);
        caption(f, s === 3 ? ["PLOP!"] : ["PEBBLE", String(drop + 1)], s === 3 ? C.white : C.stone);
      }],
      [2000, (f, t, k) => {
        put(f, S.crowStand, 24, 7, { "#": C.grey, o: C.yellow });
        put(f, S.pot, 32, 7, C.amber);
        crowWater(f, 6);
        caption(f, blink(k) ? ["GLUG", "GLUG!"] : ["AAH!"], C.cyan);
      }],
      [2500, (f, t, k) => {
        put(f, k % 2 ? S.crowDown : S.crowUp, 18, 1, { "#": C.grey, o: C.yellow });
        put(f, S.pot, 32, 7, C.amber);
        crowWater(f, 5);
        caption(f, ["WORK", "SMART!"], C.lime);
      }],
    ],
  },

  race: {
    label: "Hare & tortoise", hint: "Picture story", group: "story", color: C.green, posterAt: 10300,
    shots: [
      [2000, (f, t, k) => {
        put(f, S.hare, 0, 8, C.white);
        put(f, S.tortoise, 18, 11, C.green);
        f.fillRect(33, 4, 1, 12, C.white);
        big(f, ["READY", "SET", "GO!"][Math.min(2, Math.floor(k / 3))], C.yellow, { x0: 40, w: 56 });
      }],
      [1500, (f, t, k) => {
        const x = k * 16;
        put(f, k % 2 ? S.hareRun : S.hare, x, 8, C.white);
        for (let i = 1; i <= 3; i++) f.fillRect(x - 4 * i - 2, 10 + i, 3, 1, C.white);
        put(f, S.tortoise, 18 + k, 11, C.green);
      }],
      [1500, (f, t, k) => {
        put(f, S.tree, 80, 6, { "#": C.green, t: C.amber });
        put(f, S.hareSleep, 64, 12, C.white);
        if (blink(k)) f.paint(Z, C.cyan, 66, 2);
        put(f, S.tortoise, 24 + k, 11, C.green);
      }],
      [3000, (f, t, k) => {
        put(f, S.tree, 80, 6, { "#": C.green, t: C.amber });
        put(f, S.hareSleep, 64, 12, C.white);
        if (blink(k)) f.paint(Z, C.cyan, 66, 2);
        put(f, S.tortoise, 30 + k * 3, 11, C.green);
        caption(f, ["SLOW..."], C.green, { x0: 0, w: 48, y: 1 });
      }],
      [1500, (f, t, k) => {
        put(f, S.flag, 90, 6, { "#": C.white, r: C.red });
        put(f, S.hareSleep, 40, 12, C.white);
        if (k >= 3) f.paint(BANG, C.red, 44, 2);
        put(f, S.tortoise, 72 + k * 2, 11, C.green);
      }],
      [2500, full(["SLOW AND STEADY", "WINS THE RACE"], C.lime)],
    ],
  },

  lion: {
    label: "Lion & mouse", hint: "Picture story", group: "story", color: C.amber, posterAt: 7200,
    shots: [
      [2000, (f, t, k) => {
        put(f, S.lion, 8 + (k % 2), 2, C.amber);
        net(f, 0);
        caption(f, ["LION", "TRAPPED!"], C.red);
      }],
      [1500, (f, t, k) => {
        put(f, S.lion, 8, 2, C.amber);
        net(f, 0);
        put(f, S.mouse, 86 - k * 10, 12, C.stone, { flip: true });
      }],
      [2500, (f, t, k) => {
        put(f, S.lion, 8, 2, C.amber);
        net(f, Math.min(4, Math.floor(k / 2) + 1));
        put(f, S.mouse, 30 + (k % 2), 12, C.stone, { flip: true });
        caption(f, [blink(k, 1, 1) ? "NIBBLE" : "CRUNCH"], C.stone);
      }],
      [2000, (f, t, k) => {
        put(f, S.lionHappy, 8, 2, C.amber);
        put(f, S.mouse, 30, 12, C.stone, { flip: true });
        if (blink(k)) f.paint(icon("heartSmall"), C.pink, 33, 2);
        caption(f, ["THANK", "YOU!"], C.pink);
      }],
      [2500, full(["SMALL FRIENDS", "HELP BIG"], C.lime)],
    ],
  },

  grapes: {
    label: "Sour grapes", hint: "Picture story", group: "story", color: C.purple, posterAt: 4700,
    shots: [
      [1500, (f, t, k) => {
        put(f, S.fox, -14 + k * 7, 9, C.orange);
        put(f, S.grapes, 40, 0, { "#": C.purple, s: C.green });
        caption(f, ["YUMMY", "GRAPES"], C.purple, { x0: 50, w: 46 });
      }],
      [3000, (f, t, k) => {
        const s = k % 4;
        put(f, S.fox, 24, 9 - [0, 4, 6, 2][s], C.orange);
        put(f, S.grapes, 40, 0, { "#": C.purple, s: C.green });
        caption(f, [s === 3 ? "MISSED" : "JUMP!"], s === 3 ? C.red : C.orange, { x0: 50, w: 46 });
      }],
      [1500, (f, t, k) => {
        put(f, S.fox, 24 - k * 4, 9, C.orange, { flip: true });
        put(f, S.grapes, 40, 0, { "#": C.purple, s: C.green });
        caption(f, ["THEY'RE", "SOUR!"], C.lime, { x0: 50, w: 46 });
      }],
      [2500, full(["CAN'T REACH IT?", "CALL IT SOUR!"], C.purple)],
    ],
  },

  jam: {
    label: "Snail in traffic", hint: "Picture meme", group: "meme", color: C.lime, posterAt: 8000,
    shots: [
      [2000, (f, t, k) => {
        [C.red, C.cyan, C.yellow, C.white].forEach((c, i) => put(f, S.car, i * 24, 8, c));
        if (blink(k, 1, 1)) f.fillRect(0, 12, 1, 1, C.white);
        caption(f, ["TRAFFIC JAM..."], C.white, { x0: 0, w: 96, y: 0 });
      }],
      [5000, (f, t, k) => {
        [C.red, C.cyan, C.yellow, C.white].forEach((c, i) => put(f, S.car, i * 24, 8, c));
        put(f, S.snail, -10 + k * 5, 11, C.lime);
        caption(f, [k < 8 ? "BUT LOOK..." : "SNAIL OVERTAKES"], C.lime, { x0: 0, w: 96, y: 0 });
      }],
      [2500, (f, t, k) => {
        [C.red, C.cyan, C.yellow, C.white].forEach((c, i) => put(f, S.car, i * 24, 8, c));
        put(f, S.snail, 85, 11, C.lime);
        caption(f, [blink(k) ? "SNAIL WINS!" : ""], C.lime, { x0: 0, w: 96, y: 0 });
      }],
    ],
  },

  bump: {
    label: "Speed breaker", hint: "Picture meme", group: "meme", color: C.yellow, posterAt: 1250,
    shots: [
      [3500, (f, t, k) => {
        const x = -16 + k * 9;
        const lift = [0, 0, 0, 0, 3, 7, 8, 7, 3, 0, 0, 0, 0, 0][k] ?? 0;
        put(f, S.bump, 40, 13, C.yellow);
        put(f, S.car, x, 8 - lift, C.cyan);
        if (lift > 2) caption(f, ["WHEEE!"], C.white, x < 40 ? { x0: 58, w: 38, y: 0 } : { x0: 0, w: 40, y: 0 });
      }],
      [2500, full(["SPEED BREAKER", "OR LAUNCH PAD?"], C.yellow)],
    ],
  },

  pothole: {
    label: "Pothole pond", hint: "Picture meme", group: "meme", color: C.cyan, posterAt: 3000,
    shots: [
      [2000, (f, t, k) => {
        f.fillRect(0, 15, 40, 1, C.grey); f.fillRect(56, 15, 40, 1, C.grey);
        f.fillRect(40, 15, 16, 1, C.blue);
        put(f, S.car, -16 + k * 7, 7, C.red);
      }],
      [2000, (f, t, k) => {
        f.fillRect(0, 15, 40, 1, C.grey); f.fillRect(56, 15, 40, 1, C.grey);
        put(f, S.car, 40, 7 + k * 2, C.red);
        f.fillRect(40, 15, 16, 1, C.blue);
        if (k >= 2) caption(f, ["HELP!"], C.white, { x0: 0, w: 40, y: 2 });
      }],
      [1500, (f, t, k) => {
        f.fillRect(0, 15, 40, 1, C.grey); f.fillRect(56, 15, 40, 1, C.grey);
        f.fillRect(40, 15, 16, 1, C.blue);
        for (let i = 0; i < 3; i++) { const y = 13 - ((k + i * 2) % 6) * 2; f.set(44 + i * 4, y, C.cyan); }
        caption(f, ["BLUB"], C.cyan, { x0: 60, w: 36, y: 2 });
      }],
      [2500, full(["IS THIS A ROAD", "OR A POND?"], C.cyan)],
    ],
  },

  horn: {
    label: "Horn at red", hint: "Picture meme", group: "meme", color: C.red, posterAt: 2500,
    shots: [
      [1500, (f) => { hornScene(f, "red"); }],
      [2500, (f, t, k) => {
        hornScene(f, "red");
        caption(f, [blink(k, 1, 1) ? "POM POM!" : "POM!"], C.amber, { x0: 52, w: 44, y: 0 });
        if (k % 2) { f.set(81, 9, C.amber); f.set(82, 10, C.amber); f.set(81, 11, C.amber); }
      }],
      [2500, full(["SIGNAL: RED", "HORN: ON"], C.red)],
      [2000, (f, t, k) => { hornScene(f, "green", k * 8); caption(f, ["FINALLY"], C.green, { x0: 52, w: 44, y: 0 }); }],
    ],
  },

  gps: {
    label: "Recalculating", hint: "Picture meme", group: "meme", color: C.amber, posterAt: 4600,
    shots: [
      [2000, (f, t, k) => { gpsScene(f, k); caption(f, ["TAKE THE", "2ND EXIT"], C.amber); }],
      [2000, (f, t, k) => { gpsScene(f, k + 8); caption(f, ["MISSED", "IT..."], C.white); }],
      [3000, (f, t, k) => { gpsScene(f, k + 16); caption(f, blink(k) ? ["RECALC-", "ULATING"] : [""], C.amber); }],
      [2500, (f, t, k) => { gpsScene(f, k + 28); caption(f, ["LAP 5", "DIZZY!"], C.pink); }],
    ],
  },

  auto: {
    label: "Auto anna logic", hint: "Picture meme", group: "meme", color: C.yellow, posterAt: 2250,
    shots: [
      [2000, (f, t, k) => {
        put(f, S.auto, 60, 6, C.yellow);
        caption(f, ["SIGNAL", blink(k) ? "< LEFT" : ""], C.amber, { x0: 0, w: 48 });
      }],
      [2000, (f, t, k) => {
        put(f, S.auto, 60 + k * 5, 6 - Math.min(3, k), C.yellow);
        caption(f, ["GOES", "RIGHT >"], C.red, { x0: 0, w: 48 });
      }],
      [2500, full(["AUTO ANNA", "LOGIC!"], C.yellow)],
    ],
  },

  monday: {
    label: "Monday loading", hint: "Picture meme", group: "meme", color: C.green, posterAt: 4000,
    shots: [
      [3000, (f, t, k) => { loadBar(f, Math.min(99, k * 9)); caption(f, ["MONDAY LOADING"], C.green, { x0: 0, w: 96, y: 0 }); }],
      [3000, (f, t, k) => { loadBar(f, 99, blink(k)); caption(f, [blink(k) ? "99%..." : "PLEASE WAIT"], C.green, { x0: 0, w: 96, y: 0 }); }],
      [2000, full(["ERROR 404:", "MOTIVATION"], C.red)],
    ],
  },

  biryani: {
    label: "Sunday biryani", hint: "Picture meme", group: "meme", color: C.amber, posterAt: 3000,
    shots: [
      [2500, (f, t, k) => { handi(f, k); caption(f, ["SUNDAY", "BIRYANI"], C.amber); }],
      [2000, (f, t, k) => {
        handi(f, k);
        if (blink(k, 1, 1)) f.paint(icon("heart"), C.pink, 34, 3);
        caption(f, ["ONE MORE", "PLATE"], C.pink, { x0: 50, w: 46 });
      }],
      [2500, full(["DIET STARTS", "TOMORROW!"], C.lime)],
    ],
  },
};

/** A dotted rope net over the lion; `cut` strands (from the right) already bitten through. */
function net(f, cut) {
  for (let i = 0; i < 6 - cut; i++) {
    const x = 5 + i * 4;
    for (let y = 0; y < 16; y += 2) f.set(x, y, C.amber);
  }
  if (cut < 3) for (const y of [1, 7, 13]) for (let x = 5; x <= 25 - cut * 4; x += 2) f.set(x, y, C.amber);
}

function hornScene(f, light, go = 0) {
  // A horizontal signal: one lamp per chunk so each keeps its own colour.
  const lamps = [["red", C.red], ["amber", C.amber], ["green", C.green]];
  lamps.forEach(([name, c], i) => put(f, name === light ? S.lamp : S.ring, 1 + i * 8, 1, name === light ? c : C.grey));
  f.fillRect(0, 8, 24, 1, C.grey);
  put(f, S.car, 32 + go, 8, C.white);
  put(f, S.car, 64 + go, 8, C.red);
}

function gpsScene(f, k) {
  // A roundabout centred at (20, 7.5): dotted outer kerb, solid island, and the car
  // going round and round, clockwise, one eighth of a lap per step.
  const cx = 20, cy = 7.5;
  for (let a = 0; a < 48; a += 2) {
    const r = (a / 48) * Math.PI * 2;
    f.set(cx + Math.cos(r) * 7.5, cy + Math.sin(r) * 7.5, C.white);
  }
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) f.set(cx + x, Math.round(cy) + y, C.green);
  f.fillRect(cx + 8, 7, 12, 1, C.white); // the exit you were meant to take
  const r = (-Math.PI / 2) + ((k % 8) / 8) * Math.PI * 2;
  const px = Math.round(cx + Math.cos(r) * 5 - 1), py = Math.round(cy + Math.sin(r) * 5 - 1);
  f.fillRect(px, py, 3, 3, C.cyan);
}

function loadBar(f, pct, edge = true) {
  f.fillRect(2, 9, 92, 1, C.green);
  f.fillRect(2, 15, 92, 1, C.green);
  f.fillRect(2, 9, 1, 7, C.green);
  f.fillRect(93, 9, 1, 7, C.green);
  const w = Math.round((88 * pct) / 100);
  f.fillRect(4, 11, edge ? w : Math.max(0, w - 4), 3, C.green);
}

function handi(f, k) {
  put(f, S.handi, 8, 8, C.amber);
  // Steam: three wisps that wiggle.
  for (let i = 0; i < 3; i++) {
    const x = 11 + i * 4 + ((k + i) % 3) - 1;
    f.set(x, 6, C.white); f.set(x + 1, 4, C.white); f.set(x, 2, C.white);
  }
}

// ------------------------------------------------------------------ API

export const PIC_IDS = Object.keys(PICS);

const loops = new Map();
/** Length of one pass of a picture in ms. */
export function picLoopMs(id) {
  if (!loops.has(id)) loops.set(id, (PICS[id] ?? PICS.crow).shots.reduce((n, [ms]) => n + ms, 0));
  return loops.get(id);
}

/** Frame of picture `id` at time t (loops). `poster` gives the picture's chosen still. */
export function picFrame(id, t = 0, { poster = false } = {}) {
  const p = PICS[id] ?? PICS.crow;
  const loop = picLoopMs(id in PICS ? id : "crow");
  let rem = poster ? p.posterAt : ((Math.floor(t) % loop) + loop) % loop;
  for (const [ms, draw] of p.shots) {
    if (rem < ms) {
      const f = new Frame();
      draw(f, rem, Math.floor(rem / PIC_STEP_MS));
      return f;
    }
    rem -= ms;
  }
  return new Frame();
}
