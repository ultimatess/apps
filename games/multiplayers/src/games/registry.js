// Single source of truth mapping catalog ids to their host (TV) and controller (phone) classes.

// Category 1: Social Deduction
import { SpyfallHost } from './social-deduction/spyfall/spyfall-host.js';
import { SpyfallController } from './social-deduction/spyfall/spyfall-controller.js';
import { MafiaHost } from './social-deduction/mafia/mafia-host.js';
import { MafiaController } from './social-deduction/mafia/mafia-controller.js';
import { TwoTruthsHost } from './social-deduction/two-truths/two-truths-host.js';
import { TwoTruthsController } from './social-deduction/two-truths/two-truths-controller.js';

// Category 2: Creative & Party Antics
import { FakeArtistHost } from './party-antics/fake-artist/fake-artist-host.js';
import { FakeArtistController } from './party-antics/fake-artist/fake-artist-controller.js';
import { MostLikelyHost } from './party-antics/most-likely/most-likely-host.js';
import { MostLikelyController } from './party-antics/most-likely/most-likely-controller.js';
import { FiveSecHost } from './party-antics/fivesec/fivesec-host.js';
import { FiveSecController } from './party-antics/fivesec/fivesec-controller.js';
import { SecretNamesHost } from './party-antics/secret-names/secret-names-host.js';
import { SecretNamesController } from './party-antics/secret-names/secret-names-controller.js';
import { TriviaHost } from './party-antics/trivia/trivia-host.js';
import { TriviaController } from './party-antics/trivia/trivia-controller.js';
import { QuickDrawHost } from './party-antics/quick-draw/quick-draw-host.js';
import { QuickDrawController } from './party-antics/quick-draw/quick-draw-controller.js';

// Category 3: NetplayJS Arcade & Action
import { PongHost } from './arcade/pong/pong-host.js';
import { PongController } from './arcade/pong/pong-controller.js';
import { SquareTagHost } from './arcade/square-tag/tag-host.js';
import { SquareTagController } from './arcade/square-tag/tag-controller.js';
import { Connect4Host } from './arcade/connect4/connect4-host.js';
import { Connect4Controller } from './arcade/connect4/connect4-controller.js';
import { LightCyclesHost } from './arcade/light-cycles/light-cycles-host.js';
import { LightCyclesController } from './arcade/light-cycles/light-cycles-controller.js';

export const GAME_REGISTRY = {
  'spyfall': { Host: SpyfallHost, Controller: SpyfallController },
  'mafia': { Host: MafiaHost, Controller: MafiaController },
  'two-truths': { Host: TwoTruthsHost, Controller: TwoTruthsController },
  'fake-artist': { Host: FakeArtistHost, Controller: FakeArtistController },
  'trivia': { Host: TriviaHost, Controller: TriviaController },
  'quick-draw': { Host: QuickDrawHost, Controller: QuickDrawController },
  'most-likely': { Host: MostLikelyHost, Controller: MostLikelyController },
  'fivesec': { Host: FiveSecHost, Controller: FiveSecController },
  'secret-names': { Host: SecretNamesHost, Controller: SecretNamesController },
  'pong': { Host: PongHost, Controller: PongController },
  'light-cycles': { Host: LightCyclesHost, Controller: LightCyclesController },
  'square-tag': { Host: SquareTagHost, Controller: SquareTagController },
  'connect4': { Host: Connect4Host, Controller: Connect4Controller }
};
