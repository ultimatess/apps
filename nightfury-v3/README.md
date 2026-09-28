# NightFury v3 — iPixel 96×16 driving HUD

A rebuild of [`../nightfury`](../nightfury) (v2.2.4). It drives a 96×16 iPixel LED panel over Web Bluetooth. It shows your speed, turn arrows and a brake light, plus Tamil and English messages and devil eyes.

v2 is left untouched. v3 lives in this folder and is published at `/nightfury-v3/`.

## Using it

1. Open the page:
   - **iPhone:** use [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055). Safari has no Web Bluetooth.
   - **Android or desktop:** use Chrome or Edge.
2. Tap **Connect panel** and pick the `LED_BLE_…` device. If your panel isn't listed, go to **Lab › Pair any device**.
3. Go to **Drive › Start GPS & motion**. From there, **Auto HUD** shows speed, turn arrows and the brake light automatically.
4. Tap any message. It holds the panel for 5 s, 10 s or 30 s, or stays pinned (**Settings**), then the HUD comes back.
5. **Drive mode ⤢** switches to a full-screen, large-button view for use in the car.

## What changed from v2

| Area | v2.2.4 | v3 |
|---|---|---|
| Code | One 2,500-line HTML file with the Tailwind CDN | ES modules; pure logic separate from the UI; no runtime dependencies |
| Protocol | Hand-rolled | Same bytes, checked by `tests/unit/parity.test.mjs` running v2's own functions |
| Colours | `parseInt(..) \|\| 255` turned 0 channels into 255, so red was sent as yellow-white | Exact RGB |
| HUD after a message | Never returned | Priority rules (brake > turn > message > speed) with a hold timer |
| Turn detection | Phone tilt (gamma); only works for one mount angle | Gyro yaw projected on gravity, works for any mount; falls back to GPS heading; corrects its own sign |
| Brake detection | Raw Z-axis acceleration above 13.5 | Sustained horizontal deceleration, or a GPS speed drop; ignores cornering, potholes and hard launches |
| iOS motion permission | Only asked for orientation | Asks for motion and orientation |
| BLE writes | Every update queued; sliders built up a backlog | One write in flight at a time; a newer frame replaces a waiting one of the same kind |
| Scene before handshake | Could send frames mid-handshake | No scene frames until the handshake completes, including after a reconnect |
| Reconnect | Foreground reconnect skipped rediscovery | Backoff reconnect with full rediscovery and handshake, and the scene is re-sent |
| Cancelled chooser | Opened a second "all devices" chooser | Stops; "Pair any device" is a separate button in Lab |
| Text | Canvas threshold only | Crisp 2× pixel font for A–Z/0–9; Tamil and emoji wait for the web font before rasterising |
| Speed / brake frames | Anti-aliased emoji text | Pixel-art speed readout with speed bar and over-limit rails, plus a brake frame with warning triangles |
| Extras | — | Offline PWA, settings saved, saved messages, recents, km/h and mph, speed alert, Drive mode, voice input (Tamil and English), optional live animation stream |

## Build and test loops

There are no npm dependencies. You need Node 22+ and a local Chrome for the end-to-end tests.

```sh
node scripts/build.mjs        # checks + version stamp + sw.js
node --test tests/unit/*.test.mjs
node scripts/mutation-smoke.mjs
node tests/e2e/run.mjs        # headless Chrome, mocked panel/GPS/motion
sh scripts/verify.sh          # all of the above, fail-fast
sh scripts/verify.sh --loop 3 # repeat to catch flaky timing
node scripts/serve.mjs 8080   # local preview at http://127.0.0.1:8080/
```

### The loops

**Inner loop (edit → verify):** after every change, run `sh scripts/verify.sh` and fix the first failure. Repeat until you see `✓ verify green`.

1. **Build** (`scripts/build.mjs`) checks that:
   - every `$("id")` in `app.js` exists in `index.html`, and no id is duplicated;
   - every icon `<use href="#…">` is defined;
   - every relative import resolves and every imported name is exported;
   - every local file referenced from HTML or the manifest exists;
   - there is no Tailwind CDN and no inline `on*=` handlers.

   It then writes `js/version.js`, a content hash that changes only when the sources change, and `sw.js`, the precache list.
2. **Syntax:** `node --check` on every module.
3. **Unit** (Node's built-in `node:test`), about 70 tests:
   - protocol, CRC, packet decode;
   - v2 byte and pixel parity;
   - font and graphics geometry;
   - telemetry state machines on synthetic traces;
   - HUD priority, the write queue, storage;
   - BLE transport and panel driver against `tests/mock-bluetooth.mjs`.
4. **Mutation smoke** (`scripts/mutation-smoke.mjs`) plants 16 realistic bugs, several of them real v2 bugs, into a temp copy. The unit tests must fail for every one. This loop checks the tests themselves.
5. **E2E** (`tests/e2e/run.mjs`, zero-dependency CDP driver) runs the real app in headless Chrome at phone size:
   - Bluetooth, GPS and DeviceMotion are mocked.
   - Every byte written is reassembled into packets and CRC-checked.
   - Frames are compared pixel-for-pixel with the pure graphics modules.
   - It covers pairing and the handshake, presets, eyes, turn and brake, the speed HUD and its rate limit, brightness coalescing, the Studio, Hex lab, bit order, drop and reconnect, user disconnect, saved settings across a reload, sensors, Drive mode in portrait and landscape, and a cancelled chooser.
   - It also checks for zero console errors and zero horizontal overflow at 320, 390 and 430 px widths.
   - Screenshots go to `tests/e2e/artifacts/` for visual review.

**Outer loop (release):** before a deploy:
- Run `sh scripts/verify.sh --loop 3`. Three green passes in a row means no flaky timing.
- Look through the screenshots in `tests/e2e/artifacts/`.
- Try it on real hardware with the **Lab › Feature tests** buttons. **Pixel grid** checks bit order and columns end to end.

## Layout

```
index.html          UI markup (no inline JS)
css/app.css         hand-written styles
js/protocol.js      iPixel packets, CRC32, chunking, decoder   (pure)
js/bitmap.js        1-bit frame buffer                          (pure)
js/font5x7.js       LED pixel font                              (pure)
js/graphics.js      chevrons, devil eyes, speed/brake frames   (pure)
js/scene.js         scene → preview frame / hardware plan       (pure)
js/hud.js           priority rules                              (pure)
js/telemetry.js     GPS speed, yaw, turn/brake detectors        (pure)
js/queue.js         serial write queue that replaces stale jobs (pure)
js/ble.js           Web Bluetooth transport + reconnect
js/device.js        iPixel panel driver (handshake, frames, text)
js/textraster.js    canvas text rasteriser (Tamil/emoji)
js/preview.js       LED canvas renderer (sprites, redraws only on change)
js/sensors.js       geolocation / devicemotion adapters
js/store.js         saved settings
js/app.js           UI wiring
scripts/            build, verify loop, mutation smoke, icons, dev server
tests/              unit, e2e, Bluetooth mock
```
