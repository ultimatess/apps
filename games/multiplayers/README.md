# Netplay Party: P2P Party Deck & Arcade

A zero-server, peer-to-peer party platform inspired by **[NetplayJS](https://rameshvarun.github.io/netplayjs/)** and **Jackbox Games**.

One big screen (TV, laptop, tablet) is the shared game board. Every player's phone is their private controller: secret role card, gamepad, buzzer, drawing pad or ballot. No apps, no accounts.

---

## 🎮 The 13 Games

### 🎭 Social Deduction
| Game | Players | What happens |
|---|---|---|
| 🕵️ **Spyfall** | 3–12 | Everyone knows the location except the Spy. Question each other, call one accusation per round, or (as the Spy) reveal yourself and steal the win by naming the location. 18 location packs. |
| 🌙 **Mafia & Werewolf** | 4–16 | Silent night on phones: Mafia, Doctor, Detective, Jester, Vigilante. **Everyone** taps at night, so phone activity reveals nothing. Spoken narrator, tie-safe voting, full role reveal at the end. |
| 🤥 **Two Truths & a Lie** *(new)* | 3–12 | Type 2 truths and 1 lie on your phone. The TV shows each player's statements in turn; everyone votes on the lie. Awards for the best liar and the best lie detector. |

### 🎉 Party & Quiz
| Game | Players | What happens |
|---|---|---|
| 🎨 **Fake Artist** | 3–10 | One continuous line each, streamed live to the TV. The Fake never goes first. If caught, the Fake picks the word from 8 options to steal the win. |
| 🧠 **Trivia Blitz** *(new)* | 1–16 | Kahoot-style multiple choice: 80 questions across 8 topics. Faster correct answers score more, and streaks earn bonuses. |
| 🤠 **Quick Draw Showdown** *(new)* | 2–16 | WAIT FOR IT... DRAW! Fastest tap wins. Trick words ("DRUM!") catch jumpy fingers. Reaction times are measured on the phone, so wifi lag doesn't decide the winner. |
| 🔥 **Most Likely To...** | 3–16 | Secret votes, animated bar-chart reveal, and an awards ceremony of everyone's titles. |
| ⚡ **5-Second Rule** | 2–12 | Prompts arm after a short read delay, the first buzz locks everyone else out, and the host judges each answer. |
| 🎯 **Secret Missions** | 3–16 | Everyone hunts exactly one person (a random single cycle). Complete your mission for +2, or expose your hunter for +1. |

### 🕹️ Arcade
| Game | Players | What happens |
|---|---|---|
| 🏓 **Netplay Pong** | 1–2 + queue | Thumb-slider paddles, countdown serves, angle-based bounces. **Winner stays on** for the next challenger. Solo players face the AI. |
| 🏍️ **Light Cycles** *(new)* | 2–6 | Tron-style neon trails. Tap LEFT or RIGHT to turn, and bikes speed up the longer a round lasts. First to 3 round wins. Solo players face a bot. |
| 🟦 **Square Arena Clash** | 1–6 | Analog thumb joystick and a Turbo button. Grab stars, and ram rivals while boosting to steal their points. The final 10 seconds score double. |
| 🔴 **Connect 4 Grid Duel** | 1–2 + queue | Tap the board on your phone, with falling-disc animation on the TV. Winner stays on. The solo AI wins when it can, blocks your wins, and plays the centre. |

---

## ✨ Platform features

- **Rejoin on refresh.** Each phone has a stable player id in `sessionStorage`. A refreshed or sleeping phone rejoins as the same player, and the host replays the current screen and its secret card.
- **Late joiners** land straight in the running game, as a spectator or queued challenger where that applies.
- **TV refresh reclaims the same room code.** Phones reconnect automatically.
- **Connection health.** Heartbeats in both directions, a 45-second seat hold for dropped players, and a "reconnecting" overlay on phones.
- **Host dock** on every screen: room code, player count, lobby, mute and fullscreen.
- **Player-count fit** highlighting in the hub, and the host can remove players.
- **Safe by default.** Names are sanitised on the host and all free text is escaped. There are no blocking `alert`/`confirm` calls on the TV.
- **Clean teardown.** Every game's listeners, timers and animation loops are disposed when you switch games.

---

## 📂 Architecture

```text
games/multiplayers/
├── index.html · styles.css · server.mjs (static server + LAN IP for QR codes)
├── src/
│   ├── app.js                 # Host/phone coordinator, dock, reconnect overlay
│   ├── netplay/
│   │   ├── peer-manager.js    # HostSession / ClientSession (PeerJS), scopes, replay, heartbeats
│   │   ├── local-peer.js      # BroadcastChannel stand-in for PeerJS (?net=local)
│   │   ├── room-code.js · qrcode.js
│   ├── games/
│   │   ├── registry.js        # game id -> { Host, Controller }
│   │   ├── hub/party-hub.js   # catalog + lobby
│   │   ├── social-deduction/  # spyfall, mafia, two-truths
│   │   ├── party-antics/      # fake-artist, trivia, quick-draw, most-likely, fivesec, secret-names
│   │   └── arcade/            # pong, light-cycles, square-tag, connect4 (+ pure *-logic.js)
│   ├── data/                  # locations, words, prompts, trivia, mafia roles
│   └── utils/                 # ui (escape, toast, dialog, queue), audio, narrator, wake-lock
└── tests/
    ├── unit/*.test.mjs        # pure rules: win checks, AI, collisions, scoring, data integrity
    └── e2e/run.mjs            # 1 TV + 5 phones in headless Chrome, every game end to end
```

Each game is a `Host` class (renders the TV and owns the state) and a `Controller` class (renders the phone and sends actions). The host broadcasts public state and unicasts private payloads. Games receive a **scoped session** whose listeners are removed automatically on game switch.

---

## 🚀 Running

```bash
cd games/multiplayers
npm start            # node server.mjs  → http://localhost:3000
```

- **Host (TV / laptop):** open `http://localhost:3000` and choose **Create Room**.
- **Phones (same wifi):** scan the QR code, or open `http://<lan-ip>:3000` and enter the code.

**Offline / single machine:** add `?net=local` (for example `http://localhost:3000/?net=local`). Tabs in the same browser then talk over BroadcastChannel, with no internet or signaling server needed.

---

## ✅ QA loop

The definition of done for any change is that this loop stays green:

```bash
npm test     # unit: rules, AI, scoring, content packs (fast, no browser)
npm run e2e  # real Chrome: TV + 5 phones play all 13 games, plus refresh, wifi drop, late join, XSS
npm run qa   # both
```

The E2E run writes a screenshot of every key TV and phone screen to `tests/e2e/artifacts/`. Review them on each change for the CX half of the loop: is the text readable from the couch, are tap targets thumb-sized, is it always obvious what to do next?

**Manual checklist** (things a headless browser can't judge):
1. Join with 3+ real phones on the same wifi, including one iPhone and one Android.
2. Lock one phone mid-game for 30 seconds, unlock it, and check it rejoins on its own.
3. Play Pong and Light Cycles on a TV across the room. Check the controls feel immediate.
4. Turn the narrator on in Mafia and check that night and day announcements are audible.
