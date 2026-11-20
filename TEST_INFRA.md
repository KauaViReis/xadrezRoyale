# E2E Testing Infrastructure (`TEST_INFRA.md`) — Xadrez Royale 3D

## 1. Overview & Design Principles
This E2E test suite is a **requirement-driven, opaque-box** browser verification suite built strictly against `ORIGINAL_REQUEST.md` and `PROJECT.md § Feature Inventory` & `§ Interface Contracts`.
- **Zero modifications to `package.json` or `src/*`**: Uses Node.js `v24.22.3` built-ins (`node:test`, `node:assert/strict`, native `WebSocket`, `fetch`, `node:child_process`) driving `/usr/bin/chromium` over Chrome DevTools Protocol (CDP) against ephemeral `vite` / `vite preview` servers.
- **Unit test isolation**: `npm test` (`node --test tests/*.test.mjs`) runs unit tests only; E2E tests live exclusively in `tests/e2e/**`.
- **Opaque-box contract**: Tests interact through real DOM selectors, real pointer/mouse/touch events, real keyboard events, and real `#c3d` canvas coordinates (no internal JS globals or test backdoors in `src/*`).
- **Deterministic & offline-safe**: External Google Fonts requests are fulfilled locally (`200`), local/offline tests force `VITE_FIREBASE_API_KEY=''` on the Vite process, and online multiplayer/VIP tests intercept `/src/online/firebase.js` at the CDP `Fetch` boundary with a `BroadcastChannel`-backed `OnlineManager` test double supporting real 2-tab rooms.

---

## 2. Runtime & Browser Stack
| Component | Details |
|---|---|
| **Node.js** | `v24.22.3` (`node:test`, `node:assert/strict`, built-in `WebSocket`, `fetch`) |
| **Browser** | `/usr/bin/chromium` (`Chromium 156.0.8078.79`) |
| **WebGL Flags** | `--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox --use-gl=angle --use-angle=swiftshader --enable-webgl --enable-unsafe-swiftshader --ignore-gpu-blocklist --remote-debugging-port=0` |
| **Dev / Preview Server** | `npx vite --port 0 --host 127.0.0.1` (and `npx vite preview --port 0 --host 127.0.0.1` for production `dist/` smoke) |
| **Isolation** | Each suite/session spawns an isolated `--user-data-dir` in `/tmp/` and an ephemeral Vite port, cleaned up in `finally` hooks |

> **SwiftShader Note (`src/engine/quality.js`)**: Headless SwiftShader reports `swiftshader` in `WEBGL_debug_renderer_info`, so `'auto'` resolves to `'low'`. Quality tests verify both `'auto'` behavior and explicit `#segQuality` switches to `'high'`, `'medium'`, and `'low'`.

---

## 3. Directory Structure (`tests/e2e/`)
```text
tests/e2e/
├── run-e2e.mjs                  # Unified E2E runner (supports --tier=1..4, serial execution, clean summary)
├── helpers/
│   ├── cdp.mjs                  # Zero-dep Node 24 CDP WebSocket client, server/browser lifecycle, input & spies
│   ├── board.mjs                # Deterministic 2D/3D #c3d square projection, move/arrow/touch actions, DOM waiters
│   └── online-double.mjs        # CDP Fetch interceptor + BroadcastChannel OnlineManager double for 2-tab/VIP tests
├── tier1-features.test.mjs      # Tier 1: >=5 happy-path tests per feature area (9 areas)
├── tier2-boundaries.test.mjs    # Tier 2: >=5 boundary/edge-case tests per feature area
├── tier3-combinations.test.mjs  # Tier 3: Pairwise cross-feature interaction tests
└── tier4-scenarios.test.mjs     # Tier 4: Realistic end-to-end user journeys + vite preview smoke
```

---

## 4. Harness Capabilities (`tests/e2e/helpers/`)

### 4.1 `cdp.mjs` — Browser, Vite & CDP Primitives
- **`startViteServer({ mode: 'dev' | 'preview', envOverride })`**: Spawns `npx vite --port 0 --host 127.0.0.1` (or `vite preview`), parses the bound `http://127.0.0.1:<port>` URL from stdout, and terminates cleanly on `close()`.
- **`launchBrowser({ viewport, mobile, interceptOnline, authEmail })`**: Spawns `/usr/bin/chromium` with SwiftShader WebGL2 flags and an isolated temporary `user-data-dir`, opens a CDP WebSocket connection, enables `Runtime`, `Page`, `DOM`, `Network`, `Fetch`, and optionally `Emulation.setDeviceMetricsOverride` + `Emulation.setTouchEmulationEnabled`.
- **Error Tracking**: Collects all `Runtime.exceptionThrown` and `console.error` events per page; every test asserts `page.assertNoErrors()`.
- **Browser API Spies (`Page.addScriptToEvaluateOnNewDocument`)**:
  - Wraps `window.AudioContext` / `webkitAudioContext` to count oscillator `.start()` calls cleanly without touching app code.
  - Wraps `navigator.vibrate` to record vibration pattern invocations.
  - Exposes `window.__e2eContextMenuEvents` passive spy on `#c3d` to assert `defaultPrevented === true` on right-click.
- **Input Primitives**:
  - `click(selector)`, `type(selector, text)`, `pressKey(key, modifiers)`
  - `mouseMove`, `mouseDown`, `mouseUp`, `mouseClick`, `mouseDrag` (supports `button: 'left' | 'right'` and `Shift` / `Alt` / `Control` modifiers)
  - `touchTap(x, y)`, `touchDrag(x1, y1, x2, y2)` (real `Input.dispatchTouchEvent` so `setPointerCapture` & `CameraController` touch logic execute genuinely)

### 4.2 `board.mjs` — Deterministic `#c3d` Square Projection & Game Helpers
- Uses exact `CameraController` / `board3d.js` geometry (`worldPos(r, c) = (c - 3.5, 0, r - 3.5)`, `fov = 42`, `target = (0, -0.05, 0)`, `half = 4.65`, `margin = 1.08`, `phi = 0.08` in 2D mode, `theta = 0` White / `Math.PI` Black).
- `ensureView2D(page)` toggles `#btnView2D` if not `.active` and waits for the `360ms` top-down tween.
- `squareToClientXY(page, sq, { side = 'w', topDown = true })` computes exact pixel `(x, y)` inside `#c3d`.
- `playMove(page, fromSq, toSq, { side, waitForFlip, promotion })` clicks `fromSq` -> `toSq`, handles `#promoModal` if `promotion` is provided, and waits for move completion (and optional PvP flip tween `>= 600ms`).
- `rightDragArrow(page, fromSq, toSq, { shift, alt, ctrl, side })` & `rightClickSquare(page, sq, { shift, alt, ctrl, side })`.
- `touchTapSquare(page, sq, { side })` & `touchDragArrow(page, fromSq, toSq, { side })`.
- `assertHudNoOverlap(page)` checks `getBoundingClientRect()` invariants (`scrollWidth <= innerWidth`, all visible HUD controls within viewport, minimum `>= 32px` touch target, zero pairwise rect intersection across `.hud-top`, `#btnHome`, `#turnPill`, `.hud-right`, `#btnArrows`, `#cardW`, `#cardB`, `#evalWrap`, `.hud-actions`, `#arrowChip`, mobile history strip/drawer).

### 4.3 `online-double.mjs` — Two-Tab Online & VIP Test Double
- Intercepts `**/src/online/firebase.js*` via CDP `Fetch.enable` and serves a module exporting `isFirebaseConfigured = true` and `class OnlineManager` implementing the full contract (`init`, `linkGoogle`, `setNick`, `isVipDev`, `quickMatch`, `createRoom`, `joinRoom`, `sendMove`, `offerDraw`, `respondDraw`, `resign`, `finishGame`, `leaveGame`, `getLeaderboard`, plus `onMatchFound`, `onOpponentMove`, `onClockSync`, `onPresence`, `onDrawOffer`, `onGameEnd`, `onStatus`).
- Synchronizes state across browser tabs via `BroadcastChannel('xadrez-e2e-online')` + `localStorage` so Tab A (`White`) and Tab B (`Black`) play real 2-tab matches through `src/main.js` without internet or Firebase credentials.
- Configurable per-tab identity via `window.__E2E_AUTH_EMAIL__` (`elkaua1227@gmail.com` for VIP vs non-VIP email).

---

## 5. Coverage Matrix (Tiers 1–4)

| Tier | File | Scope & Requirement Mapping |
|---|---|---|
| **Tier 1** | `tests/e2e/tier1-features.test.mjs` | >=5 isolated happy-path tests for each of the 9 feature areas: (1) Local Play PvE/PvP/Clocks/Promotion/View2D/Flip, (2) Arrows PC & Mobile `✎ Setas`, (3) 3D Hint + Ghost + PV, (4) Online Premove & Rooms, (5) Clickable SAN History `|< < > >|` & Undo, (6) Post-Game Analysis, (7) PBR Quality Profiles `auto`/`high`/`medium`/`low` & Themes, (8) VIP `elkaua1227@gmail.com` Gating, (9) General UI/UX, Settings, Audio, Haptics, A11y & Shortcuts. |
| **Tier 2** | `tests/e2e/tier2-boundaries.test.mjs` | >=5 boundary/invalid/edge-case tests per feature area: off-turn premove cancel (`Esc`/right-click), illegal premove abort, stale-FEN hint guard, move-blocking during history inspection (`viewPly < N`), `#btnUndo` capture/lead restoration + piece sorting, mobile `360x740` & `390x844` HUD non-overlap, SwiftShader `'auto'` fallback + dynamic quality switch, mate-score eval `M1`/`-M1`, non-VIP online hint/eval block, `#btnResign` timeout reset, shortcuts ignored in `<input>`, `Enter` on `#joinInput`, clock pause in `#menuOverlay`, cancel `analyzeGame` on rematch, startup `.seg.active` reload sync. |
| **Tier 3** | `tests/e2e/tier3-combinations.test.mjs` | Pairwise feature interactions: flipped board + arrows + 3D hint; history nav + post-game analysis + quality switch; mobile `✎ Setas` + orbit/move lock + toggle back; VIP online + eval bar + hint + premove; capture + undo + sorted `#capsW` + eval update; themes + PBR quality + 3D hint ghost; `#menuOverlay` clock pause + settings persistence; online draw + resign + history inspection; keyboard-driven review + flip + 2D + hint. |
| **Tier 4** | `tests/e2e/tier4-scenarios.test.mjs` | End-to-end user journeys: (1) Full PvE/PvP Checkmate -> `#btnViewBoard` -> `#btnAnalyze` -> SVG eval graph inspection -> `#btnRematch`, (2) Mobile `360x740` touch annotation & play session, (3) Two-tab Online VIP vs Non-VIP premove & match completion session, (4) Quality downgrade + theme switching + prefs reload lifecycle, (5) Keyboard-driven capture/undo & history review session, (6) `vite preview` production `dist/` smoke journey. |

---

## 6. Execution Commands
- **Run full E2E suite (Tiers 1–4):**
  ```bash
  node tests/e2e/run-e2e.mjs
  ```
- **Run a specific tier:**
  ```bash
  node tests/e2e/run-e2e.mjs --tier=1
  node tests/e2e/run-e2e.mjs --tier=2
  node tests/e2e/run-e2e.mjs --tier=3
  node tests/e2e/run-e2e.mjs --tier=4
  ```
- **Run unit tests (unchanged):**
  ```bash
  npm test
  ```
