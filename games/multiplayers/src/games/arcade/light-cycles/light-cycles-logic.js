// Pure Light Cycles simulation (no DOM): grid trails, simultaneous moves, head-on crashes.
export const GRID_W = 96;
export const GRID_H = 56;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left (clockwise)

export function createGrid() {
  return new Uint8Array(GRID_W * GRID_H); // 0 = empty, n = rider index + 1
}

export function idx(x, y) {
  return y * GRID_W + x;
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

/** Spawn points spread around the arena, each facing toward the middle. */
export function spawnRiders(count) {
  const spots = [
    { x: 8, y: Math.floor(GRID_H / 2), dir: 1 },
    { x: GRID_W - 9, y: Math.floor(GRID_H / 2), dir: 3 },
    { x: Math.floor(GRID_W / 2), y: 6, dir: 2 },
    { x: Math.floor(GRID_W / 2), y: GRID_H - 7, dir: 0 },
    { x: 14, y: 8, dir: 2 },
    { x: GRID_W - 15, y: GRID_H - 9, dir: 0 }
  ];
  return spots.slice(0, count).map(s => ({ ...s, alive: true, turns: [] }));
}

/** Queue a relative turn (-1 left, +1 right). Two can be buffered so quick double-taps work. */
export function queueTurn(rider, turn) {
  if (!rider.alive || rider.turns.length >= 2) return;
  rider.turns.push(turn > 0 ? 1 : -1);
}

/**
 * Advance every living rider one cell at the same instant.
 * Returns indices of riders that crashed this tick.
 */
export function step(grid, riders) {
  const targets = riders.map((r) => {
    if (!r.alive) return null;
    if (r.turns.length) r.dir = (r.dir + r.turns.shift() + 4) % 4;
    const [dx, dy] = DIRS[r.dir];
    return { x: r.x + dx, y: r.y + dy };
  });

  const crashed = new Set();
  targets.forEach((t, i) => {
    if (!t) return;
    if (!inBounds(t.x, t.y) || grid[idx(t.x, t.y)] !== 0) crashed.add(i);
  });
  // Two riders entering the same cell (or swapping cells) take each other out.
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if (!a || !b) continue;
      const sameCell = a.x === b.x && a.y === b.y;
      const swapped = a.x === riders[j].x && a.y === riders[j].y && b.x === riders[i].x && b.y === riders[i].y;
      if (sameCell || swapped) {
        crashed.add(i);
        crashed.add(j);
      }
    }
  }

  targets.forEach((t, i) => {
    if (!t) return;
    const r = riders[i];
    if (crashed.has(i)) {
      r.alive = false;
      return;
    }
    r.x = t.x;
    r.y = t.y;
    grid[idx(r.x, r.y)] = i + 1;
  });

  return [...crashed];
}

function freeRun(grid, x, y, dir, limit) {
  const [dx, dy] = DIRS[dir];
  let n = 0;
  let cx = x;
  let cy = y;
  while (n < limit) {
    cx += dx;
    cy += dy;
    if (!inBounds(cx, cy) || grid[idx(cx, cy)] !== 0) break;
    n++;
  }
  return n;
}

/** Simple bot: keep going straight while there is room, otherwise turn toward open space. */
export function aiTurn(grid, rider, random = Math.random) {
  const ahead = freeRun(grid, rider.x, rider.y, rider.dir, 12);
  const left = freeRun(grid, rider.x, rider.y, (rider.dir + 3) % 4, 30);
  const right = freeRun(grid, rider.x, rider.y, (rider.dir + 1) % 4, 30);
  if (ahead > 4 && random() > 0.04) return 0;
  if (ahead >= Math.max(left, right) && ahead > 0) return 0;
  if (left === right) return random() < 0.5 ? -1 : 1;
  return left > right ? -1 : 1;
}
