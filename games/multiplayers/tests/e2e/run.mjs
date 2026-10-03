// End-to-end party test: one TV + several phones in real headless Chrome, talking over the
// BroadcastChannel local network (?net=local). Every game is played through its main path,
// plus reconnects, late joins, host refresh and XSS-safety checks.
//   node tests/e2e/run.mjs [--headed] [--only=name] [--keep-screens]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { startServer } from '../../server.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ART = `${ROOT}tests/e2e/artifacts/`;
const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--only='))?.slice(7);
const headed = args.includes('--headed');
rmSync(ART, { recursive: true, force: true });
mkdirSync(ART, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const J = JSON.stringify;

const { server, port } = await startServer(0, '127.0.0.1');
const BASE = `http://127.0.0.1:${port}`;
const browser = await launch({ headless: !headed });
const results = [];
const allPages = [];
let shot = 0;

async function snap(page, name) {
  try { writeFileSync(`${ART}${String(++shot).padStart(3, '0')}-${name}.png`, await page.screenshot()); } catch { /* ignore */ }
}

async function step(name, fn) {
  if (only && !name.includes(only) && !name.startsWith('setup')) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err.stack || err).split('\n').slice(0, 5).join('\n      ')}`);
    await snap(tv, `FAIL-${name.replace(/\W+/g, '_')}-tv`);
    for (const p of phones) await snap(p, `FAIL-${name.replace(/\W+/g, '_')}-${p.label}`);
    // Recover so one failure doesn't cascade into every later game.
    try { await tv.eval('window.__app.launchHostHub()'); await sleep(500); } catch { /* ignore */ }
  }
}

async function newPage(opts) {
  const page = await browser.newPage();
  await page.init(opts);
  allPages.push(page);
  return page;
}

// ---------------------------------------------------------------- helpers
const host = (expr) => tv.eval(`(() => { const g = window.__app.activeHostGame; return (${expr}); })()`);
const hostWait = (expr, label, timeout = 8000) => tv.waitFor(`(() => { const g = window.__app.activeHostGame; return (${expr}); })()`, { timeout, label });
const text = (page) => page.eval('document.body.innerText');
const hasText = (page, t, timeout = 6000) => page.waitFor(`document.body.innerText.includes(${J(t)})`, { timeout, label: `${page.label} shows "${t}"` });
const exists = (page, sel, timeout = 6000) => page.waitFor(`!!document.querySelector(${J(sel)})`, { timeout, label: `${page.label} has ${sel}` });
const pid = (page) => page.eval('window.__app.clientSession.playerId');
async function confirmYes(page) {
  await exists(page, '[data-answer="yes"]');
  await page.click('[data-answer="yes"]');
}
async function phoneById(id) {
  for (const p of phones) if (await pid(p) === id) return p;
  throw new Error(`No phone for player ${id}`);
}
async function openGame(id, marker) {
  await tv.click(`.game-catalog-card[data-game-id="${id}"]`);
  await hostWait(`window.__app.activeGameId === ${J(id)}`, `host opened ${id}`);
  for (const p of phones) await p.waitFor(`window.__app.activeGameId === ${J(id)}`, { label: `${p.label} switched to ${id}` });
  if (marker) for (const p of phones) await hasText(p, marker);
}
async function backToHub() {
  await tv.eval('window.__app.launchHostHub()');
  for (const p of phones) await p.waitFor(`window.__app.activeGameId === 'hub'`, { label: `${p.label} back at hub` });
  await exists(tv, '.games-catalog-grid');
}

let tv;
const phones = [];

async function joinPhone(name, avatarIndex, code) {
  const p = await newPage({ width: 390, height: 844, mobile: true, scale: 2 });
  p.label = name;
  await p.goto(`${BASE}/?net=local&room=${code}`);
  await exists(p, '#txtName');
  await p.eval(`document.getElementById('txtName').value = ${J(name)}`);
  await p.click(`.avatar-btn:nth-child(${avatarIndex})`);
  await p.click('#btnConnectRoom');
  await p.waitFor(`window.__app?.clientSession?.isConnected && window.__app.activeGameId`, { label: `${name} connected`, timeout: 8000 });
  return p;
}

// ---------------------------------------------------------------- tests
console.log(`--- Netplay Party E2E (${BASE}) ---`);
let roomCode;

await step('setup: host creates a room', async () => {
  tv = await newPage({ width: 1440, height: 900, mobile: false, scale: 1 });
  tv.label = 'tv';
  await tv.goto(`${BASE}/?net=local`);
  await exists(tv, '#btnStartHosting');
  await snap(tv, 'landing');
  await tv.click('#btnStartHosting');
  roomCode = await tv.waitFor('window.__app?.hostSession?.roomCode', { label: 'room code' });
  await exists(tv, '#qrHubCanvas');
  assert(/^[A-Z0-9]{4}$/.test(roomCode), `room code ${roomCode}`);
});

await step('setup: four phones join and appear in the lobby', async () => {
  for (const [i, n] of ['Asha', 'Bala', 'Chitra', 'Dev'].entries()) phones.push(await joinPhone(n, i + 1, roomCode));
  await tv.waitFor(`document.getElementById('hubPlayerCount')?.textContent === '4'`, { label: 'hub shows 4 players' });
  await hasText(phones[0], 'In the room (4)');
  await snap(tv, 'hub-4-players');
  await snap(phones[0], 'phone-hub');
});

await step('security: hostile player name is neutralised and can be kicked', async () => {
  const evil = await joinPhone('<img src=x onerror=window.__xss=1>', 5, roomCode);
  await tv.waitFor(`document.getElementById('hubPlayerCount')?.textContent === '5'`, { label: '5 players' });
  assert(!(await tv.eval('!!document.querySelector("img[src=x]") || !!window.__xss')), 'XSS payload rendered on TV');
  assert(!(await phones[0].eval('!!document.querySelector("img[src=x]") || !!window.__xss')), 'XSS payload rendered on phone');
  const evilId = await pid(evil);
  await tv.eval(`document.querySelector('[data-kick-id="${evilId}"]').click()`);
  await tv.waitFor(`document.getElementById('hubPlayerCount')?.textContent === '4'`, { label: 'kicked back to 4' });
  await hasText(evil, 'removed from the room');
  await evil.close();
});

await step('security: a forged handshake cannot hijack another player seat', async () => {
  const victimId = await pid(phones[0]);
  const attacker = phones[3];
  const own = await attacker.eval(`sessionStorage.getItem('np_client_id')`);
  const result = await attacker.eval(`(async () => {
    sessionStorage.setItem('np_client_id', ${J(victimId)});
    const Ctor = window.__app.clientSession.constructor;
    const s = new Ctor(${J(roomCode)}, 'Mallory', '🦊');
    await s.connect();
    const id = s.playerId;
    s.destroy();
    sessionStorage.setItem('np_client_id', ${J(own)});
    return id;
  })()`);
  assert(result !== victimId, 'attacker was given the victim seat');
  assert(await phones[0].eval('window.__app.clientSession.isConnected'), 'victim was kicked off');
  await tv.eval(`window.__app.hostSession.kick(${J(result)})`);
  await tv.waitFor(`document.getElementById('hubPlayerCount')?.textContent === '4'`, { label: 'back to 4 players' });
});

await step('trivia: answers, speed scoring, reveal, final podium', async () => {
  await openGame('trivia', 'Trivia Blitz');
  await tv.click('[data-total="5"]');
  await tv.click('#btnStartTrivia');
  for (let q = 0; q < 5; q++) {
    await hostWait(`g.phase === 'QUESTION' && g.qIndex === ${q}`, `question ${q + 1}`);
    const correct = await host('g.current.c');
    for (const [i, p] of phones.entries()) {
      await exists(p, '.answer-btn');
      const choice = i === 0 ? correct : (correct + 1) % 4;
      await p.press(`.answer-btn[data-choice="${choice}"]`);
    }
    await hostWait(`g.phase === 'REVEAL'`, 'reveal after all answered');
    if (q === 0) {
      await hasText(phones[0], 'points!');
      await hasText(phones[1], 'Not quite!');
      await snap(tv, 'trivia-reveal');
      await snap(phones[0], 'trivia-phone-correct');
    }
    await tv.click('#btnNextQ');
  }
  await hostWait(`g.phase === 'FINAL'`, 'final');
  await hasText(tv, 'Asha is the Quiz Champion');
  await hasText(phones[0], 'Quiz Champion!');
  const streak = await host(`g.streaks[${J(await pid(phones[0]))}]`);
  assert(streak === 5, `streak should be 5, got ${streak}`);
  await snap(tv, 'trivia-final');
  await backToHub();
});

await step('late join: a phone joining mid-game lands in the running game', async () => {
  await openGame('connect4', 'Connect 4');
  const late = await joinPhone('Esha', 6, roomCode);
  await late.waitFor(`window.__app.activeGameId === 'connect4'`, { label: 'late phone in connect4' });
  await hasText(late, 'Connect 4');
  phones.push(late);
});

await step('connect4: turn enforcement, win detection, spectators, winner-stays queue', async () => {
  await tv.click('#btnStartC4');
  await hostWait(`g.phase === 'PLAYING'`, 'c4 playing');
  const p1 = await phoneById(await host('g.player1Id'));
  const p2 = await phoneById(await host('g.player2Id'));
  const spectator = phones.find(p => p !== p1 && p !== p2);
  await hasText(spectator, 'Spectating');
  assert(!(await spectator.eval('!!document.querySelector(".c4-pad-col:not([disabled])")')), 'spectator can drop discs');

  // P2 tries to move out of turn: ignored.
  await p2.eval(`window.__app.clientSession.sendAction('DROP_COL', { col: 3 })`);
  await sleep(200);
  assert(await host('g.board[5][3]') === 0, 'out-of-turn move was accepted');

  const moves = [[p1, 0], [p2, 1], [p1, 0], [p2, 1], [p1, 0], [p2, 1], [p1, 0]];
  for (const [n, [page, col]] of moves.entries()) {
    await page.waitFor(`!!document.querySelector('.c4-pad-col[data-col="${col}"]:not([disabled])')`, { label: `move ${n + 1} enabled` });
    await page.click(`.c4-pad-col[data-col="${col}"]`);
    await hostWait(`g.lastMove && g.lastMove.n === ${n + 1}`, `move ${n + 1} applied`);
  }
  await hostWait(`g.phase === 'GAME_OVER' && g.winner === 1`, 'red wins');
  await hasText(p1, 'YOU WIN!');
  await snap(tv, 'connect4-win');
  await snap(p1, 'connect4-phone-win');

  const p1Id = await pid(p1);
  await tv.click('#btnNextC4');
  await hostWait(`g.phase === 'PLAYING'`, 'next match');
  assert(await host('g.player1Id') === p1Id, 'winner should stay on');
  assert(await host('g.player2Id') !== await pid(p2), 'loser should go to the back of the line');
  await backToHub();
});

await step('most-likely: secret votes, verdict, phone reactions', async () => {
  await openGame('most-likely', 'Most Likely');
  await tv.click('#btnStartML');
  await hostWait(`g.phase === 'VOTING'`, 'voting');
  const targetId = await pid(phones[1]);
  for (const p of phones) {
    await exists(p, `[data-nominee-id="${targetId}"]`);
    await p.click(`[data-nominee-id="${targetId}"]`);
  }
  await hostWait(`g.phase === 'REVEAL'`, 'reveal');
  await hasText(tv, 'Bala!');
  await hasText(phones[1], 'The room picked YOU!');
  await snap(tv, 'most-likely-reveal');
  await backToHub();
});

await step('fivesec: arm delay, buzzer lock-out, countdown, grading', async () => {
  await openGame('fivesec', '5-Second Rule');
  await tv.click('#btnStartFive');
  await hostWait(`g.phase === 'READING'`, 'reading');
  await exists(phones[2], '.armed-wait');
  await hostWait(`g.phase === 'BUZZER_WAIT'`, 'buzzers live', 4000);
  await exists(phones[2], '#btnBuzzer');
  await phones[2].press('#btnBuzzer');
  await hostWait(`g.phase === 'COUNTDOWN'`, 'countdown');
  await phones[0].eval(`window.__app.clientSession.sendAction('BUZZ_IN')`);
  assert(await host('g.activeBuzzerPlayerId') === await pid(phones[2]), 'buzzer was stolen');
  await hasText(phones[2], "YOU'RE UP!");
  await hasText(phones[0], 'buzzed first');
  await snap(tv, 'fivesec-countdown');
  await hostWait(`g.phase === 'GRADING'`, 'grading', 8000);
  await tv.click('#btnPass');
  await hostWait(`g.scores[${J(await pid(phones[2]))}] === 1`, 'point awarded');
  await backToHub();
});

await step('quick-draw: false start, draw detection, reaction ranking', async () => {
  await openGame('quick-draw', 'Quick Draw');
  await tv.click('[data-total="3"]');
  await tv.click('#btnStartQD');
  await hostWait(`g.phase === 'WAIT'`, 'wait');
  await exists(phones[0], '#tapZone');
  await phones[0].press('#tapZone');
  await hostWait(`g.falseStarts.size === 1`, 'false start recorded');
  await hasText(phones[0], 'FALSE START');
  await hostWait(`g.phase === 'DRAW'`, 'draw!', 12000);
  for (const p of phones.slice(1)) {
    await p.waitFor(`document.querySelector('#tapZone')?.classList.contains('phase-draw')`, { label: `${p.label} sees DRAW` });
    await sleep(120); // human-speed reaction: anything under 80 ms counts as jumping the gun
    await p.press('#tapZone', 20);
  }
  await hostWait(`g.phase === 'RESULT'`, 'round result');
  const ranked = await host('g.results.length');
  assert(ranked === phones.length - 1, `expected ${phones.length - 1} reaction times, got ${ranked}`);
  await snap(tv, 'quick-draw-result');
  await snap(phones[1], 'quick-draw-phone');
  await backToHub();
});

await step('secret-missions: private targets, mission complete, call-out, debrief', async () => {
  await openGame('secret-names', 'Secret Missions');
  await tv.click('#btnDealMissions');
  await hostWait(`g.phase === 'PLAYING'`, 'missions live');
  const assignments = await host('g.assignments');
  // Every player hunts someone else, and everyone is hunted exactly once.
  const targets = Object.values(assignments).map(a => a.targetId);
  assert(new Set(targets).size === phones.length, 'targets are not a permutation');
  assert(Object.entries(assignments).every(([h, a]) => h !== a.targetId), 'someone targets themselves');

  await exists(phones[0], '#cardToggle');
  await phones[0].click('#cardToggle');
  await hasText(phones[0], 'YOUR TARGET');
  await snap(phones[0], 'secret-mission-card');
  await phones[0].click('#btnDone');
  await confirmYes(phones[0]);
  await hostWait(`Object.values(g.assignments).filter(a => a.completed).length === 1`, 'mission completed');
  await hasText(phones[0], 'Mission complete!');

  // Phone 1 calls out its real hunter.
  const me = await pid(phones[1]);
  const hunter = Object.keys(assignments).find(h => assignments[h].targetId === me);
  await phones[1].click('#btnCallout');
  await exists(phones[1], `[data-suspect="${hunter}"]`);
  await phones[1].click(`[data-suspect="${hunter}"]`);
  await confirmYes(phones[1]);
  await hasText(phones[1], 'You exposed your hunter!');
  await tv.click('#btnEndMissions');
  await hasText(tv, 'Mission Debrief');
  await snap(tv, 'secret-debrief');
  await backToHub();
});

await step('spyfall: secret cards, refresh-rejoin keeps card, accusation, spy guess', async () => {
  await openGame('spyfall', 'Spyfall');
  await tv.click('#btnLaunchGame');
  await hostWait(`g.phase === 'PLAYING'`, 'spyfall playing');
  const spyId = await host('g.spyIds[0]');
  const location = await host('g.secretLocation');
  const spy = await phoneById(spyId);
  const town = phones.filter(p => p !== spy);

  await exists(town[0], '#secretCardToggle');
  await town[0].click('#secretCardToggle');
  await hasText(town[0], location);
  await spy.click('#secretCardToggle');
  await hasText(spy, 'YOU ARE THE SPY!');
  await snap(spy, 'spyfall-spy-card');

  // Refresh a phone: it must rejoin as the same player and get its card back.
  const before = await pid(town[1]);
  await town[1].reload();
  await town[1].waitFor(`window.__app?.clientSession?.isConnected && window.__app.activeGameId === 'spyfall'`, { label: 'rejoined after refresh', timeout: 8000 });
  assert(await pid(town[1]) === before, 'player identity changed after refresh');
  await exists(town[1], '#secretCardToggle');
  await town[1].click('#secretCardToggle');
  await hasText(town[1], location);
  assert(await tv.eval('window.__app.hostSession.clients.size') === phones.length, 'refresh created a duplicate player');

  // Accuse the spy and convict.
  await town[0].click('#btnOpenAccusation');
  await exists(town[0], `[data-suspect-id="${spyId}"]`);
  await town[0].click(`[data-suspect-id="${spyId}"]`);
  await confirmYes(town[0]);
  await hostWait(`g.phase === 'ACCUSATION'`, 'trial');
  await snap(tv, 'spyfall-trial');
  for (const p of town.slice(1)) {
    await exists(p, '#btnVoteGuilty');
    await p.click('#btnVoteGuilty');
  }
  await hostWait(`g.phase === 'SPY_GUESS'`, 'spy gets a final guess');
  const idx = await spy.eval(`window.__app.activeControllerGame.privateState.allLocations.indexOf(${J(location)})`);
  await exists(spy, `.guess-loc-btn[data-loc-idx="${idx}"]`);
  await spy.click(`.guess-loc-btn[data-loc-idx="${idx}"]`);
  await confirmYes(spy);
  await hostWait(`g.phase === 'ROUND_OVER'`, 'round over');
  await hasText(tv, 'THE SPY WINS');
  await hasText(spy, 'You win this round!');
  await snap(tv, 'spyfall-round-over');
  await backToHub();
});

await step('mafia: silent night for everyone, morning report, vote out the mafia', async () => {
  await openGame('mafia', 'Mafia');
  await tv.click('#btnStartMafia');
  await hostWait(`g.phase === 'NIGHT'`, 'night 1');
  const roles = await host('g.playerRoles');
  const mafiaIds = Object.keys(roles).filter(id => roles[id] === 'Mafia');
  // Every living phone has something to tap at night (cover actions hide real powers).
  for (const p of phones) {
    await exists(p, '.night-pick');
    await p.click('.night-pick');
  }
  await snap(phones[0], 'mafia-night-phone');
  await hostWait(`g.phase === 'DAY_ANNOUNCE'`, 'morning comes early once everyone acted', 6000);
  await snap(tv, 'mafia-morning');
  await tv.click('#btnStartDayDiscussion');
  await tv.click('#btnCallVoteNow');
  await hostWait(`g.phase === 'DAY_VOTING'`, 'voting');

  for (let round = 0; round < 3 && (await host('g.phase')) !== 'GAME_OVER'; round++) {
    if (round > 0) {
      for (const p of phones) {
        if (await p.eval('!!document.querySelector(".night-pick")')) await p.click('.night-pick');
      }
      await hostWait(`g.phase === 'DAY_ANNOUNCE' || g.phase === 'GAME_OVER'`, 'next morning', 8000);
      if ((await host('g.phase')) === 'GAME_OVER') break;
      await tv.click('#btnStartDayDiscussion');
      await tv.click('#btnCallVoteNow');
    }
    const alive = await host('[...g.alivePlayers]');
    const target = mafiaIds.find(id => alive.includes(id));
    for (const p of phones) {
      const id = await pid(p);
      if (!alive.includes(id)) continue;
      const choice = id === target ? alive.find(a => a !== id) : target;
      await exists(p, `.day-pick[data-target-id="${choice}"]`);
      await p.click(`.day-pick[data-target-id="${choice}"]`);
    }
    await hostWait(`g.phase === 'DAY_RESULT' || g.phase === 'GAME_OVER'`, 'verdict');
    if ((await host('g.phase')) === 'DAY_RESULT') {
      await snap(tv, 'mafia-verdict');
      await tv.click('#btnNextNight');
    }
  }
  await hostWait(`g.phase === 'GAME_OVER'`, 'game over');
  await hasText(tv, "Everyone's secret role");
  await snap(tv, 'mafia-game-over');
  await backToHub();
});

await step('fake-artist: one-line turns, live strokes, vote, fake picks the word', async () => {
  await openGame('fake-artist', 'Fake Artist');
  await tv.click('[data-rounds="1"]');
  await tv.click('#btnStartFakeArtist');
  await hostWait(`g.phase === 'DRAWING'`, 'drawing');
  const imposterId = await host('g.imposterId');
  assert(await host('g.turnOrder[0]') !== imposterId, 'fake artist must not draw first');

  for (let turn = 0; turn < phones.length; turn++) {
    const active = await phoneById(await host('g.activePlayerId'));
    await exists(active, '#btnSubmitStroke');
    const y = 0.2 + turn * 0.12;
    await active.drag('#mobileCanvas', [[0.2, y], [0.4, y + 0.05], [0.6, y], [0.8, y + 0.08]]);
    await active.waitFor(`!document.getElementById('btnSubmitStroke').disabled`, { label: 'stroke done' });
    if (turn === 0) {
      await snap(active, 'fake-artist-phone-draw');
      await active.click('#btnRedo');
      await active.drag('#mobileCanvas', [[0.3, y], [0.5, y + 0.1], [0.7, y]]);
      await active.waitFor(`!document.getElementById('btnSubmitStroke').disabled`, { label: 'redo stroke done' });
    }
    await active.click('#btnSubmitStroke');
    await hostWait(`g.strokes.length === ${turn + 1}`, `stroke ${turn + 1} committed`);
  }
  await hostWait(`g.phase === 'VOTING'`, 'voting');
  await snap(tv, 'fake-artist-voting');
  for (const p of phones) {
    const id = await pid(p);
    const choice = id === imposterId ? (await host('g.turnOrder')).find(t => t !== id) : imposterId;
    await exists(p, `[data-player-id="${choice}"]`);
    await p.click(`[data-player-id="${choice}"]`);
  }
  await hostWait(`g.phase === 'IMPOSTER_GUESS'`, 'fake caught');
  const fake = await phoneById(imposterId);
  const word = await host('g.secretWord');
  const idx = await fake.eval(`window.__app.activeControllerGame.privateState.guessOptions.indexOf(${J(word)})`);
  await fake.click(`.guess-loc-btn[data-idx="${idx}"]`);
  await confirmYes(fake);
  await hostWait(`g.phase === 'ROUND_OVER'`, 'round over');
  await hasText(tv, 'FAKE ARTIST WINS');
  await snap(tv, 'fake-artist-round-over');
  await backToHub();
});

await step('two-truths: private writing, voting, reveal, awards', async () => {
  await openGame('two-truths', 'Two Truths');
  await tv.click('#btnStartTT');
  for (const [i, p] of phones.entries()) {
    await exists(p, '#ttForm');
    await p.eval(`(() => {
      const vals = ['I have climbed a hill ${i}', 'I can cook biryani ${i}', 'I have been to the moon ${i}'];
      document.querySelectorAll('.tt-input').forEach((el, k) => { el.value = vals[k]; el.dispatchEvent(new Event('input')); });
    })()`);
    await p.click('.lie-toggle[data-lie="2"]');
    if (i === 0) await snap(p, 'two-truths-form');
    await p.click('#ttForm button[type="submit"]');
  }
  await hostWait(`g.phase === 'VOTING'`, 'first author up');
  for (let t = 0; t < phones.length; t++) {
    await hostWait(`g.phase === 'VOTING' && g.turnIndex === ${t}`, `turn ${t + 1}`);
    const authorId = await host('g.order[g.turnIndex]');
    const lieSlot = await host('g.display.findIndex(d => d.isLie)');
    for (const p of phones) {
      if (await pid(p) === authorId) continue;
      await exists(p, '.lie-btn');
      await p.click(`.lie-btn[data-choice="${lieSlot}"]`);
    }
    await hostWait(`g.phase === 'REVEAL'`, 'reveal');
    if (t === 0) await snap(tv, 'two-truths-reveal');
    await tv.click('#btnNextTT');
  }
  await hostWait(`g.phase === 'FINAL'`, 'final');
  await hasText(tv, 'Lie Detector');
  await backToHub();
});

await step('pong: thumb paddle moves, scoring, winner-stays', async () => {
  await openGame('pong', 'Pong');
  await tv.click('[data-target="5"]');
  await tv.click('#btnStartPong');
  await hostWait(`g.phase === 'PLAYING'`, 'pong playing');
  const left = await phoneById(await host('g.player1Id'));
  await exists(left, '#paddleTouchTrack');
  await left.drag('#paddleTouchTrack', [[0.5, 0.5], [0.5, 0.7], [0.5, 0.95]], { holdMs: 250 });
  await hostWait(`g.leftPaddle > 300`, 'left paddle moved down');
  await snap(tv, 'pong-playing');
  await snap(left, 'pong-phone');
  for (let i = 0; i < 5; i++) await tv.eval(`window.__app.activeHostGame.point('LEFT')`);
  await hostWait(`g.phase === 'GAME_OVER'`, 'pong over');
  await hasText(left, 'You won!');
  await backToHub();
});

await step('square-tag: joystick steering, turbo, round end', async () => {
  await openGame('square-tag', 'Square Arena');
  await tv.click('#btnStartTag');
  await hostWait(`g.phase === 'PLAYING'`, 'arena live', 6000);
  const me = phones[0];
  const id = await pid(me);
  const x0 = await host(`g.players.find(p => p.id === ${J(id)}).x`);
  await exists(me, '#joyZone');
  await me.drag('#joyBase', [[0.5, 0.5], [0.8, 0.5], [1, 0.5]], { holdMs: 700 });
  const x1 = await host(`g.players.find(p => p.id === ${J(id)}).x`);
  assert(x1 > x0 + 40, `joystick did not move player (${x0} -> ${x1})`);
  await me.press('#btnTurbo', 300);
  await snap(tv, 'square-tag-playing');
  await snap(me, 'square-tag-phone');
  await tv.eval('window.__app.activeHostGame.timerRemaining = 1');
  await hostWait(`g.phase === 'GAME_OVER'`, 'arena over', 4000);
  await tv.waitFor(`/WINS|TIE/.test(document.body.innerText)`, { label: 'winner or tie shown' });
  await backToHub();
});

await step('light-cycles: countdown, steering, crash detection, match flow', async () => {
  await openGame('light-cycles', 'Light Cycles');
  await tv.click('#btnStartCycles');
  await hostWait(`g.phase === 'RACING'`, 'racing', 6000);
  const me = phones[0];
  const id = await pid(me);
  const dir0 = await host(`g.riders.find(r => r.id === ${J(id)}).dir`);
  await exists(me, '.steer-btn[data-dir="1"]');
  await me.press('.steer-btn[data-dir="1"]', 30);
  await hostWait(`g.riders.find(r => r.id === ${J(id)}).dir === ${(dir0 + 1) % 4}`, 'rider turned right');
  await snap(tv, 'light-cycles-racing');
  await hostWait(`g.phase === 'ROUND_OVER' || g.phase === 'MATCH_OVER'`, 'a round ends by crashes', 20000);
  await snap(tv, 'light-cycles-round-over');
  // Fast-forward: give the leader enough stars and finish the next round.
  await tv.eval(`(() => { const g = window.__app.activeHostGame; g.roundWins[${J(id)}] = 2; g.startRound(); })()`);
  await hostWait(`g.phase === 'RACING'`, 'next round racing', 6000);
  await tv.eval(`(() => { const g = window.__app.activeHostGame; g.riders.forEach(r => { r.alive = r.id === ${J(id)}; }); g.checkRoundEnd(); })()`);
  await hostWait(`g.phase === 'MATCH_OVER'`, 'match over');
  await hasText(me, 'Grid Champion!');
  await snap(tv, 'light-cycles-champion');
  await backToHub();
});

await step('resilience: a phone that drops off wifi mid-vote reconnects and keeps playing', async () => {
  await openGame('most-likely', 'Most Likely');
  await tv.click('#btnStartML');
  await hostWait(`g.phase === 'VOTING'`, 'voting');
  const flaky = phones[2];
  const id = await pid(flaky);
  // Kill the phone's network peer without any goodbye (like walking out of wifi range).
  await flaky.eval('window.__app.clientSession.peer.destroy()');
  await tv.waitFor(`window.__app.hostSession.clients.get(${J(id)})?.connected === false`, { label: 'host notices the drop', timeout: 15000 });
  await hasText(tv, 'lost connection');
  await flaky.waitFor(`window.__app.clientSession.isConnected`, { label: 'phone auto-reconnects', timeout: 15000 });
  assert(await pid(flaky) === id, 'reconnected as a different player');
  await exists(flaky, '[data-nominee-id]');
  for (const p of phones) await p.click(`[data-nominee-id="${id}"]`);
  await hostWait(`g.phase === 'REVEAL' && g.winnerId === ${J(id)}`, 'vote completes with the reconnected phone');
  await backToHub();
});

await step('resilience: TV refresh reclaims the room and phones reconnect', async () => {
  await tv.reload();
  await tv.waitFor(`window.__app?.hostSession?.roomCode === ${J(roomCode)}`, { label: 'same room code after refresh', timeout: 15000 });
  await tv.waitFor(`document.getElementById('hubPlayerCount')?.textContent === '${phones.length}'`, { label: 'all phones back', timeout: 20000 });
  for (const p of phones) await p.waitFor(`window.__app.clientSession.isConnected`, { label: `${p.label} reconnected`, timeout: 15000 });
  await snap(tv, 'hub-after-refresh');
});

await step('quality: no uncaught errors on any screen', async () => {
  const problems = [];
  for (const p of allPages) {
    const errs = p.errors.filter(e => !/favicon|fonts\.g|unpkg|peerjs/i.test(e));
    if (errs.length) problems.push(`${p.label}: ${errs.slice(0, 3).join(' | ')}`);
  }
  assert(!problems.length, `page errors:\n${problems.join('\n')}`);
});

// ---------------------------------------------------------------- summary
await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed · screenshots in tests/e2e/artifacts/`);
process.exit(failed.length ? 1 : 0);
