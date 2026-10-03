import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, lowestEmptyRow, findWin, chooseAiMove, isBoardFull, ROWS, COLS } from '../../src/games/arcade/connect4/connect4-logic.js';
import { createGrid, spawnRiders, queueTurn, step, aiTurn, idx, GRID_W } from '../../src/games/arcade/light-cycles/light-cycles-logic.js';
import { scoreAnswer } from '../../src/games/party-antics/trivia/trivia-logic.js';
import { resolveReaction } from '../../src/games/party-antics/quick-draw/quick-draw-host.js';
import { assignTargets } from '../../src/games/party-antics/secret-names/secret-names-host.js';
import { sanitizeStatement } from '../../src/games/social-deduction/two-truths/two-truths-host.js';
import { buildRoleDeck } from '../../src/data/mafia-roles.js';
import { tallyVotes, ChallengerQueue, cleanText, escapeHtml, shuffle } from '../../src/utils/ui.js';

const drop = (board, col, who) => { const r = lowestEmptyRow(board, col); board[r][col] = who; return r; };

test('connect4: discs stack from the bottom and full columns reject', () => {
  const b = createBoard();
  for (let i = 0; i < ROWS; i++) assert.equal(drop(b, 3, 1), ROWS - 1 - i);
  assert.equal(lowestEmptyRow(b, 3), -1);
  assert.equal(lowestEmptyRow(b, -1), -1);
  assert.equal(lowestEmptyRow(b, COLS), -1);
});

test('connect4: detects horizontal, vertical and both diagonals', () => {
  const h = createBoard();
  [0, 1, 2].forEach(c => drop(h, c, 1));
  assert.equal(findWin(h, ROWS - 1, 2), null);
  const r = drop(h, 3, 1);
  assert.equal(findWin(h, r, 3).length, 4);

  const v = createBoard();
  let last;
  for (let i = 0; i < 4; i++) last = drop(v, 0, 2);
  assert.ok(findWin(v, last, 0));

  const d = createBoard(); // rising diagonal
  drop(d, 0, 1);
  drop(d, 1, 2); drop(d, 1, 1);
  drop(d, 2, 2); drop(d, 2, 2); drop(d, 2, 1);
  drop(d, 3, 2); drop(d, 3, 2); drop(d, 3, 2);
  const top = drop(d, 3, 1);
  assert.ok(findWin(d, top, 3));

  const f = createBoard(); // falling diagonal
  drop(f, 3, 1);
  drop(f, 2, 2); drop(f, 2, 1);
  drop(f, 1, 2); drop(f, 1, 2); drop(f, 1, 1);
  drop(f, 0, 2); drop(f, 0, 2); drop(f, 0, 2);
  const t2 = drop(f, 0, 1);
  assert.ok(findWin(f, t2, 0));
});

test('connect4 AI: takes a win, blocks a loss, prefers the centre', () => {
  const win = createBoard();
  [0, 1, 2].forEach(c => drop(win, c, 2));
  assert.equal(chooseAiMove(win, 2, () => 0), 3);

  const block = createBoard();
  [0, 0, 0].forEach(() => drop(block, 6, 1));
  assert.equal(chooseAiMove(block, 2, () => 0), 6);

  assert.equal(chooseAiMove(createBoard(), 2, () => 0), 3);
  const full = createBoard().map(row => row.map(() => 1));
  assert.ok(isBoardFull(full));
  assert.equal(chooseAiMove(full, 2), -1);
});

test('light cycles: walls, trails and head-on collisions crash riders', () => {
  const grid = createGrid();
  const riders = spawnRiders(2);
  riders.forEach((r, i) => { grid[idx(r.x, r.y)] = i + 1; });
  // Ride straight at each other along the same row until they meet.
  let crashed = [];
  for (let i = 0; i < GRID_W && !crashed.length; i++) crashed = step(grid, riders);
  assert.deepEqual(crashed.sort(), [0, 1]);
  assert.ok(riders.every(r => !r.alive));

  const g2 = createGrid();
  const [solo] = spawnRiders(1);
  g2[idx(solo.x, solo.y)] = 1;
  queueTurn(solo, -1); // face up
  let steps = 0;
  while (solo.alive && steps < 200) { step(g2, [solo]); steps++; }
  assert.ok(!solo.alive, 'rider should hit the top wall');
  assert.ok(steps < 60);
});

test('light cycles: at most two buffered turns, and bots avoid walls', () => {
  const [r] = spawnRiders(1);
  queueTurn(r, 1); queueTurn(r, 1); queueTurn(r, 1);
  assert.equal(r.turns.length, 2);

  const grid = createGrid();
  const bot = { x: GRID_W - 2, y: 20, dir: 1, alive: true, turns: [] };
  assert.notEqual(aiTurn(grid, bot, () => 0.5), 0, 'bot must turn before the wall');
});

test('trivia scoring rewards correctness, speed and streaks', () => {
  assert.equal(scoreAnswer({ correct: false, msLeft: 15000, msTotal: 15000, streak: 3 }), 0);
  assert.equal(scoreAnswer({ correct: true, msLeft: 15000, msTotal: 15000, streak: 1 }), 1000);
  assert.equal(scoreAnswer({ correct: true, msLeft: 0, msTotal: 15000, streak: 1 }), 500);
  assert.equal(scoreAnswer({ correct: true, msLeft: 0, msTotal: 15000, streak: 3 }), 700);
  assert.equal(scoreAnswer({ correct: true, msLeft: 0, msTotal: 15000, streak: 99 }), 900);
});

test('quick draw trusts the phone clock, bounded by the host clock', () => {
  assert.equal(resolveReaction(180, 260, 60), 180);
  assert.equal(resolveReaction(500, 260, 60), 320); // can't be slower than the host saw
  assert.equal(resolveReaction(1, 260, 60), 160); // tampered "1 ms" is clamped up
  assert.equal(resolveReaction(null, 260, 60), 200);
  assert.ok(resolveReaction(NaN, 10, 60) >= 1);
});

test('secret missions: every player hunts exactly one other player', () => {
  for (let n = 2; n <= 16; n++) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const map = assignTargets(ids);
    assert.equal(new Set(Object.values(map)).size, n);
    ids.forEach(id => assert.notEqual(map[id], id));
  }
});

test('mafia role deck scales with the table', () => {
  for (let n = 3; n <= 16; n++) {
    const deck = buildRoleDeck(n);
    assert.equal(deck.length, n);
    const mafia = deck.filter(r => r === 'Mafia').length;
    assert.ok(mafia >= 1 && mafia < n - mafia, `n=${n}: mafia must start outnumbered`);
    assert.ok(deck.includes('Doctor'));
  }
  assert.ok(buildRoleDeck(7).includes('Jester'));
  assert.ok(buildRoleDeck(9).includes('Vigilante'));
});

test('votes: unique leader wins, ties and SKIP do not', () => {
  assert.equal(tallyVotes({ a: 'x', b: 'x', c: 'y' }).leader, 'x');
  assert.equal(tallyVotes({ a: 'x', b: 'y' }).leader, null);
  assert.equal(tallyVotes({ a: 'SKIP', b: 'SKIP', c: 'x' }, { ignore: ['SKIP'] }).leader, null);
  assert.equal(tallyVotes({}).leader, null);
});

test('challenger queue: winner stays, loser to the back', () => {
  const q = new ChallengerQueue();
  q.sync(['a', 'b', 'c', 'd']);
  assert.deepEqual(q.pair(), ['a', 'b']);
  q.winnerStays('b', 'a');
  assert.deepEqual(q.order, ['b', 'c', 'd', 'a']);
  q.sync(['b', 'd', 'a', 'e']);
  assert.deepEqual(q.order, ['b', 'd', 'a', 'e']);
});

test('text safety helpers', () => {
  assert.equal(cleanText('<img src=x onerror=alert(1)>', 40), 'img src=x onerror=alert(1)');
  assert.equal(cleanText('   Ravi    Kumar  '), 'Ravi Kumar');
  assert.equal(escapeHtml('<b>"Tom" & \'Jerry\'</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
  assert.equal(sanitizeStatement('  I   ate  '.repeat(1)), 'I ate');
  assert.equal(sanitizeStatement('x'.repeat(500)).length, 120);
  const arr = [1, 2, 3, 4, 5];
  assert.deepEqual(shuffle(arr).sort(), arr);
});
