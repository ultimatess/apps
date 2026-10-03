import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_GAMES_CATALOG } from '../../src/games/hub/party-hub.js';
import { GAME_REGISTRY } from '../../src/games/registry.js';
import { SPYFALL_CATEGORIES } from '../../src/data/locations.js';
import { IMPOSTER_WORDS } from '../../src/data/imposter-words.js';
import { MOST_LIKELY_PROMPTS } from '../../src/data/most-likely-prompts.js';
import { FIVESEC_PROMPTS } from '../../src/data/fivesec-prompts.js';
import { TRIVIA_QUESTIONS } from '../../src/data/trivia-questions.js';
import { MAFIA_ROLES } from '../../src/data/mafia-roles.js';
import { generateRoomCode, sanitizeRoomCode, getPeerIdForRoom } from '../../src/netplay/room-code.js';

test('catalog and registry describe the same 13 games', () => {
  assert.equal(PARTY_GAMES_CATALOG.length, 13);
  const ids = PARTY_GAMES_CATALOG.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate game id');
  assert.deepEqual([...ids].sort(), Object.keys(GAME_REGISTRY).sort());
  for (const [id, { Host, Controller }] of Object.entries(GAME_REGISTRY)) {
    assert.equal(typeof Host, 'function', `${id} host`);
    assert.equal(typeof Controller, 'function', `${id} controller`);
  }
  const counts = PARTY_GAMES_CATALOG.reduce((acc, g) => ({ ...acc, [g.category]: (acc[g.category] || 0) + 1 }), {});
  assert.deepEqual(counts, { social: 3, party: 6, arcade: 4 });
  PARTY_GAMES_CATALOG.forEach(g => {
    assert.ok(g.minPlayers >= 1 && g.maxPlayers >= g.minPlayers, `${g.id} player range`);
    assert.ok(g.title && g.desc && g.icon && g.duration, `${g.id} metadata`);
  });
});

test('content packs are large enough and well formed', () => {
  assert.ok(SPYFALL_CATEGORIES.length >= 18);
  SPYFALL_CATEGORIES.forEach(c => assert.ok(c.locations.length >= 8, c.category));
  assert.ok(IMPOSTER_WORDS.length >= 18);
  IMPOSTER_WORDS.forEach(c => assert.ok(c.words.length >= 8, `${c.category}: needs 8 words for the Fake Artist guess`));
  assert.ok(MOST_LIKELY_PROMPTS.length >= 70);
  assert.ok(FIVESEC_PROMPTS.length >= 70);
  assert.ok(MAFIA_ROLES.length >= 6);
});

test('every trivia question has 4 distinct answers and a valid correct index', () => {
  assert.ok(TRIVIA_QUESTIONS.length >= 75);
  const seen = new Set();
  TRIVIA_QUESTIONS.forEach(q => {
    assert.equal(q.a.length, 4, q.q);
    assert.equal(new Set(q.a).size, 4, `duplicate answers: ${q.q}`);
    assert.ok(Number.isInteger(q.c) && q.c >= 0 && q.c < 4, q.q);
    assert.ok(!seen.has(q.q), `duplicate question: ${q.q}`);
    seen.add(q.q);
  });
});

test('room codes avoid ambiguous characters and map to stable peer ids', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode(4);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
  }
  assert.equal(sanitizeRoomCode(' ab-cd! '), 'ABCD');
  assert.equal(getPeerIdForRoom('BULL'), 'partydeck-spyfall-bull');
});
