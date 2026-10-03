# Netplay-Party: P2P Multiplayer Party Deck & NetplayJS Arcade

A zero-server peer-to-peer multiplayer platform inspired by **[NetplayJS](https://rameshvarun.github.io/netplayjs/)** and **Jackbox Games**.

Play party deduction games and fast 60fps arcade duels using a central display (TV, laptop, or tablet) as the shared game screen, while every player uses their smartphone as their private controller, virtual gamepad, secret role card, or drawing pad.

---

## 📂 Architecture & Directory Structure

All games are split into modular categories and dedicated folders:

```text
games/multiplayers/src/games/
├── social-deduction/                    # Hidden Information & Bluffing
│   ├── spyfall/
│   │   ├── spyfall-host.js              # Big screen board, timer, accusation trial
│   │   └── spyfall-controller.js        # Secret location card, cross-out notepad, ballots
│   └── mafia/
│       ├── mafia-host.js                # Silent night phase narrator, day lynch trial
│       └── mafia-controller.js          # Private roles (Doctor, Detective, Mafia), night moves
├── party-antics/                        # Creative, Antics & Buzzer Antics
│   ├── fake-artist/
│   │   ├── fake-artist-host.js          # Real-time WebRTC stroke streaming canvas
│   │   └── fake-artist-controller.js    # Mobile touch drawing pad, 1-stroke turn submit
│   ├── most-likely/
│   │   ├── most-likely-host.js          # Animated bar-chart results on big screen
│   │   └── most-likely-controller.js    # Simultaneous blind voting grid
│   ├── fivesec/
│   │   ├── fivesec-host.js              # 5-second ticking Web Audio clock & grading
│   │   └── fivesec-controller.js        # Low-latency giant buzzer
│   └── secret-names/
│       ├── secret-names-host.js         # Secret mission overview & reveal
│       └── secret-names-controller.js   # Covert party challenge & target card
├── arcade/                              # Fast 60fps NetplayJS Arcade Action
│   ├── pong/
│   │   ├── pong-host.js                 # 60fps retro-arcade paddle & ball physics
│   │   └── pong-controller.js           # Vertical touch paddle slider on smartphone
│   ├── square-tag/
│   │   ├── tag-host.js                  # 4-player arena clash, star collection
│   │   └── tag-controller.js            # Virtual 4-way D-Pad + Turbo Boost button
│   └── connect4/
│       ├── connect4-host.js             # 7x6 tactical board with falling chip physics
│       └── connect4-controller.js       # Mobile 7-column drop selector
└── hub/
    └── party-hub.js                     # Central game selector with Category Tabs
```

---

## 🎮 The 9 Multiplayer Games

### 1. 🎭 Social Deduction
- **🕵️‍♂️ Spyfall**: 18 packs (Tamil Cinema, India Hotspots, Kingdoms, Sci-Fi). Everyone knows the location except the Spy. Secret cards, cross-out notepad, and accusation trial.
- **🌙 Mafia & Werewolf**: 7 roles (Mafia, Doctor, Detective, Town, Jester, Vigilante, Bodyguard). Simultaneous, silent night moves on phones with zero accidental rustling.

### 2. 🎨 Creative & Party Antics
- **🎨 Fake Artist**: Collaborative drawing! Players take turns drawing **ONE stroke** on their mobile touchscreens. Lines stream over WebRTC in real time to the TV screen! Imposter guessing & voting.
- **🔥 Most Likely To...**: 77 hilarious & desi prompts. Simultaneous blind voting on phones with animated bar chart reveals.
- **⚡ 5-Second Rule**: Sub-10ms buzzer battle. First to buzz gets a 5-second ticking Web Audio clock to name 3 items out loud.
- **🎯 Secret Names**: Discreet party challenges where each player is secretly assigned another player to target.

### 3. 🕹️ NetplayJS Arcade & Action
- **🏓 Netplay Pong**: Directly inspired by NetplayJS's classic Pong! 2 players slide their thumb on their mobile screens to deflect the glowing ball at 60fps.
- **🟦 Square Arena Clash**: Directly inspired by NetplayJS's `SimpleGame`! 2–4 players use virtual mobile D-pads to steer their squares, collect golden stars, and tag opponents.
- **🔴🟡 Connect 4 Grid Duel**: Tactical 4-in-a-row drop-column duel. Tap columns on your phone to drop chips into the glowing TV grid.

---

## 🚀 Running the Suite

```bash
cd games/multiplayers
node server.mjs
```

- **Host (Big Screen / TV / Laptop)**: `http://localhost:3000`
- **Mobile Controllers (Same Wi-Fi)**: `http://<your-lan-ip>:3000`
