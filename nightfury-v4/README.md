# NightFury v4 — colour driving HUD for iPixel 96×16 panels

A rebuild of [`../nightfury-v3`](../nightfury-v3). It drives a 96×16 iPixel LED panel over Web Bluetooth: speed, turn signals and a brake light, Tamil and English messages, living eyes, a pixel studio, shows, and five endless modes (Thirukkural, mini stories, comedy, friends, TVK).

v3 is left untouched. v4 lives in this folder and is published at `/nightfury-v4/`. On first launch it imports your saved messages and settings from v3 (same origin, so it can read them).

## Using it

1. Open the page.
   - **iPhone:** use [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055). Safari has no Web Bluetooth.
   - **Android or desktop:** use Chrome or Edge.
   - Any other browser still works as a full preview.
2. Tap **Connect panel** and pick the `LED_BLE_…` device. If it isn't listed, use **Lab › Pair any device**.
3. **Drive › Start drive** turns on GPS and motion. Pick a HUD mode:
   - **Off**: the drive never takes the panel.
   - **Signals**: brake light and turn arrows interrupt your content.
   - **Full**: as Signals, plus the speed readout while moving.
4. The **◀ ▶** buttons are a manual indicator stalk. A signal cancels itself once the turn is finished (or after the timeout); **Hazard** stays until you turn it off. **Brake light** shows the red slab for three seconds.
5. Tap anything in the **Library** to show it. It holds the panel for the time set in Settings, then the HUD or the running show returns. **⋯** pins an item to the quick deck, adds it to a show, or opens it in the Studio.
6. **Drive mode** is the full-screen, large-button view for the car.
7. No car handy? **Drive › Demo drive** plays a scripted 50-second drive.

Desktop keys: `←` `→` signals, `H` hazard, `B` or space brake, `1`–`8` quick deck, `D` drive mode.

## Modes

Shows tab, or pin them to the quick deck (Thirukkural and Comedy are pinned by default).

| Mode | What it plays |
|---|---|
| **திருக்குறள் · Thirukkural** | 52 well-known couplets: a `குறள் 391` title card, line one, line two, then a short English gist |
| **Mini stories** | 6 tiny stories (thirsty crow, tortoise and hare, lion and mouse, fox and grapes, ant and grasshopper, the signal), one line at a time, ending on a moral |
| **Comedy** | 20 one-liners: set-up, punchline, laughing eyes. Ten English car puns, ten Tamil கடி jokes |
| **நண்பர்கள் · Friends** | 20 fun lines for your gang (ten Tamil, ten English), each followed by a wink |
| **TVK · Vijay** | 18 supporter lines in the party's red and yellow, alternating word by word |

**Language** (தமிழ் / English / Both) and **Style** (scroll each line, or one big word at a time) apply to all five. The order is shuffled each time a mode starts; **⏭** skips to the next couplet, story or joke. Modes are idle content like shows: the HUD still interrupts them.

The couplets were checked against the public [tk120404/thirukkural](https://github.com/tk120404/thirukkural) dataset, and a unit test checks every one is four words plus three. The full 1,330 are not bundled; `KURALS` in `js/modes.js` is the list to extend. The English gists, story retellings, jokes and friend lines were written for this app. In the TVK mode the party name and its motto (பிறப்பொக்கும் எல்லா உயிர்க்கும், the opening of Kural 972) are the party's own; the other lines are fan lines written for this app, not official slogans. Edit `TVK` and `FRIENDS` in `js/modes.js` to add your own.

## What changed from v3

| Area | v3 | v4 |
|---|---|---|
| Colour | One colour per frame | One colour per 8-pixel block, using the per-chunk RGB the packet already carries. The speed HUD has white digits, a cyan unit and a green/amber/red gauge; text can be rainbow or two-colour |
| Preview | Drew the ideal frame | Draws the frame as the panel will show it (colours quantized to blocks) |
| Engine | Ran inside `requestAnimationFrame`, so it froze when the screen locked or the tab was hidden and the panel kept a stale speed | Runs on a Worker timer; only the on-screen preview uses animation frames |
| HUD | One Auto-HUD switch | Off / Signals / Full |
| Auto-rotate | Re-armed the message hold on every step, so the speed readout never came back while it ran | Shows are idle content: they never hold the panel against the HUD |
| Turn signals | Only automatic, detected while already turning (and only settable by hand in the simulator) | Manual stalk with self-cancel, plus the automatic arrows. Amber, sequential, animated on the panel |
| Brake | Static word | Alternates a solid red slab with the word |
| Panel animation | Optional 4 fps stream for eyes and arrows | Change-driven: a frame is sent only when it differs, never faster than the link drains; Off / Signals / All |
| Eyes | 4 procedural + 9 imported | Adds 9 living eyes that blink, glance about, look into turns and widen under braking |
| Text | Scroll or static | Auto / static / scroll / word-by-word / blink; big or two-line; solid / rainbow / duo; live draft preview while typing |
| Saved messages | De-duplicated by text | Any number of variants; editable in place |
| Pixel studio | — | Draw, erase, fill, stamps, pixel text, shift / mirror / invert, undo, multi-frame animation |
| Shows and modes | — | Playlists of library items; Thirukkural, mini stories, comedy, friends, TVK |
| Trip computer | — | Distance, moving time, average, top speed, hard brakes, stops, speed sparkline |
| Clock | Firmware clock on the panel, a different one in the preview | Rendered by the app, so preview and panel match (the firmware clock is still in the Lab) |
| Reconnect | Chooser every launch | Reconnects to the last panel on launch where the browser supports `getDevices()` |
| Other | — | Night dimming, backup export/import, keyboard shortcuts, first-run sheet, demo drive |

Removed: the legacy AE01 and CoolLED-7728 text encoders (ASCII only, never used by the iPixel panel).

## What is and isn't verified on hardware

- **Verified by parity with v3:** for single-colour content v4 writes byte-for-byte what v3 wrote (v3's bytes were tested on the real panel). `tests/unit/parity.test.mjs` runs v3's own modules next to v4's to hold that.
- **Not yet tried on a panel:** per-block colours. The packet format has always carried an RGB triple per chunk; v3 simply sent the same one twelve times. If your firmware ignores them the frame shows in its dominant colour, which is v3's behaviour. **Lab › Colour › Single** forces that. **Lab › Test cards › Colour bars** is the quick check.
- **Unverified, Lab only:** firmware animation numbers 2–8, firmware rainbow modes, and GIF upload. These come from community protocol notes. They are labelled as such in the app.
- **Larger Bluetooth writes** (Lab › Write size) only work if the phone and panel negotiated a bigger MTU. 20 is the default and always safe.

## Build and test loops

No npm dependencies. Node 22+ and a local Chrome for the end-to-end tests.

```sh
node scripts/build.mjs        # checks + version stamp + sw.js
node --test tests/unit/*.test.mjs
node scripts/mutation-smoke.mjs
node tests/e2e/run.mjs        # headless Chrome, mocked panel/GPS/motion
sh scripts/verify.sh          # all of the above, fail-fast
sh scripts/verify.sh --loop 3 # repeat to catch flaky timing
node scripts/serve.mjs 8080   # local preview at http://127.0.0.1:8080/
```

1. **Build** checks that every `$("id")` exists in `index.html` with no duplicates, every icon is defined, every relative import resolves to an exported name, every referenced file exists, every `data-setting` is a real setting and every tab has a view. It then stamps `js/version.js` and writes `sw.js`.
2. **Unit** (`node:test`, 130 tests): protocol and CRC, v3 byte parity, colour frames and quantizing, HUD geometry, eyes, text layout, the director's priority rules, the engine loop on a fake clock, modes, storage and v3 migration, trip computer, GIF encoder (decoded back by an independent reader), and the Bluetooth transport and panel driver against a mock panel.
3. **Mutation smoke** plants 29 realistic bugs into a temp copy; the unit tests must fail for each one.
4. **E2E** (23 steps, zero-dependency CDP driver) runs the real app in headless Chrome at phone size with Bluetooth, GPS and DeviceMotion mocked. Every byte written is reassembled into packets and CRC-checked, and frames are compared pixel-for-pixel and colour-for-colour with the pure modules. Screenshots go to `tests/e2e/artifacts/`.

## Layout

```
index.html           UI markup (no inline JS)
css/app.css          hand-written styles
js/protocol.js       iPixel packets, CRC32, chunking, decoder       (pure)
js/bitmap.js         1-bit bitmap                                    (pure)
js/frame.js          colour frame, chunk encoding, quantizing        (pure)
js/font5x7.js        LED pixel font                                  (pure)
js/icons.js          pixel icons                                     (pure)
js/graphics.js       speed HUD, signals, brake, clock, test cards    (pure)
js/eyes.js           living, classic and imported eyes               (pure)
js/fx.js             built-in animated art                           (pure)
js/text.js           text layout: effects, sizes, paints             (pure)
js/scene.js          scene → frame / hardware plan                   (pure)
js/director.js       priority rules, signal stalk, show player, demo (pure)
js/modes.js          Thirukkural, stories, comedy, friends, TVK      (pure)
js/telemetry.js      GPS speed, yaw, turn and brake detectors        (pure)
js/drive.js          fuses fixes and motion samples                  (pure)
js/trip.js           trip computer                                   (pure)
js/engine.js         the tick: telemetry → scene → panel             (pure, injected clock)
js/queue.js          serial write queue that replaces stale jobs     (pure)
js/gif.js            GIF89a encoder                                  (pure)
js/library.js        built-in items and shows
js/store.js          settings, saved items, pins, shows, v3 import
js/ble.js            Web Bluetooth transport + reconnect
js/device.js         iPixel panel driver
js/textraster.js     canvas text rasteriser (Tamil / emoji)
js/sensors.js        geolocation / devicemotion adapters
js/ticker.js         Worker-backed engine timer
js/app.js            boot and wiring
js/ui/               stage LED renderer and the Drive, Library, Studio, Shows, Lab, Settings views
scripts/             build, verify loop, mutation smoke, icons, dev server
tests/               unit, e2e, Bluetooth mock
```

`js/apk_eyes.js` is carried over from v3 unchanged. Those nine animations were extracted from the vendor's app, so check you are happy redistributing them before publishing.
