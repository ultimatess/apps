import { SPYFALL_CATEGORIES } from '../src/data/locations.js';
import { IMPOSTER_WORDS } from '../src/data/imposter-words.js';
import { MOST_LIKELY_PROMPTS } from '../src/data/most-likely-prompts.js';
import { FIVESEC_PROMPTS } from '../src/data/fivesec-prompts.js';
import { MAFIA_ROLES } from '../src/data/mafia-roles.js';
import { PARTY_GAMES_CATALOG } from '../src/games/hub/party-hub.js';
import { generateRoomCode, sanitizeRoomCode, getPeerIdForRoom } from '../src/netplay/room-code.js';

// Category 1: Social Deduction
import { SpyfallHost } from '../src/games/social-deduction/spyfall/spyfall-host.js';
import { SpyfallController } from '../src/games/social-deduction/spyfall/spyfall-controller.js';
import { MafiaHost } from '../src/games/social-deduction/mafia/mafia-host.js';
import { MafiaController } from '../src/games/social-deduction/mafia/mafia-controller.js';

// Category 2: Party Antics
import { FakeArtistHost } from '../src/games/party-antics/fake-artist/fake-artist-host.js';
import { FakeArtistController } from '../src/games/party-antics/fake-artist/fake-artist-controller.js';
import { MostLikelyHost } from '../src/games/party-antics/most-likely/most-likely-host.js';
import { MostLikelyController } from '../src/games/party-antics/most-likely/most-likely-controller.js';
import { FiveSecHost } from '../src/games/party-antics/fivesec/fivesec-host.js';
import { FiveSecController } from '../src/games/party-antics/fivesec/fivesec-controller.js';
import { SecretNamesHost } from '../src/games/party-antics/secret-names/secret-names-host.js';
import { SecretNamesController } from '../src/games/party-antics/secret-names/secret-names-controller.js';

// Category 3: NetplayJS Arcade
import { PongHost } from '../src/games/arcade/pong/pong-host.js';
import { PongController } from '../src/games/arcade/pong/pong-controller.js';
import { SquareTagHost } from '../src/games/arcade/square-tag/tag-host.js';
import { SquareTagController } from '../src/games/arcade/square-tag/tag-controller.js';
import { Connect4Host } from '../src/games/arcade/connect4/connect4-host.js';
import { Connect4Controller } from '../src/games/arcade/connect4/connect4-controller.js';

console.log('--- RUNNING FULL 9-GAME NETPLAY QUALITY & INTEGRATION TEST ---');

let passed = 0;
let total = 0;

function assert(condition, testName) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    process.exitCode = 1;
  }
}

// 1. Catalog & Category Verification
assert(PARTY_GAMES_CATALOG.length === 9, `Catalog has 9 games (Found: ${PARTY_GAMES_CATALOG.length})`);
const socialGames = PARTY_GAMES_CATALOG.filter(g => g.category === 'social');
const partyGames = PARTY_GAMES_CATALOG.filter(g => g.category === 'party');
const arcadeGames = PARTY_GAMES_CATALOG.filter(g => g.category === 'arcade');

assert(socialGames.length === 2, `Social Deduction category has 2 games: Spyfall, Mafia`);
assert(partyGames.length === 4, `Party Antics category has 4 games: Fake Artist, Most Likely, 5-Sec, Secret Names`);
assert(arcadeGames.length === 3, `NetplayJS Arcade category has 3 games: Pong, Square Arena Clash, Connect 4`);

// 2. Class Instantiation & Module Export Verification
assert(typeof SpyfallHost === 'function' && typeof SpyfallController === 'function', 'Spyfall modules valid');
assert(typeof MafiaHost === 'function' && typeof MafiaController === 'function', 'Mafia modules valid');
assert(typeof FakeArtistHost === 'function' && typeof FakeArtistController === 'function', 'Fake Artist modules valid');
assert(typeof MostLikelyHost === 'function' && typeof MostLikelyController === 'function', 'Most Likely modules valid');
assert(typeof FiveSecHost === 'function' && typeof FiveSecController === 'function', '5-Second modules valid');
assert(typeof SecretNamesHost === 'function' && typeof SecretNamesController === 'function', 'Secret Names modules valid');
assert(typeof PongHost === 'function' && typeof PongController === 'function', 'Pong modules valid');
assert(typeof SquareTagHost === 'function' && typeof SquareTagController === 'function', 'Square Tag modules valid');
assert(typeof Connect4Host === 'function' && typeof Connect4Controller === 'function', 'Connect 4 modules valid');

// 3. Dataset Integrity
assert(SPYFALL_CATEGORIES.length >= 18, `Spyfall categories: ${SPYFALL_CATEGORIES.length}`);
assert(IMPOSTER_WORDS.length >= 18, `Fake Artist categories: ${IMPOSTER_WORDS.length}`);
assert(MOST_LIKELY_PROMPTS.length >= 70, `Most Likely prompts: ${MOST_LIKELY_PROMPTS.length}`);
assert(FIVESEC_PROMPTS.length >= 70, `5-Second prompts: ${FIVESEC_PROMPTS.length}`);
assert(MAFIA_ROLES.length >= 6, `Mafia roles: ${MAFIA_ROLES.length}`);

// 4. Room Code & Deterministic Peer ID
const code = generateRoomCode(4);
assert(code.length === 4, `4-Letter room code generation: ${code}`);
assert(getPeerIdForRoom('BULL') === 'partydeck-spyfall-bull', 'Peer ID mapping verified');

console.log(`\nQUALITY TEST SUMMARY: ${passed} / ${total} tests passed.`);
if (passed === total) {
  console.log('✨ 100% Quality Verification Success across all 3 game categories!');
}
