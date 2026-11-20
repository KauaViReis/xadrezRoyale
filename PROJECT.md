# Project: Xadrez Royale 3D

## Architecture
- **Core & AI Worker (`src/core/`, `src/workers/`)**: Pure FIDE game rules via `chess.js`, alpha-beta engine (`chess-engine.js`) returning best move + Principal Variation (`pv`) + mate-safe evaluation, pure game-state/history/premove/analysis helpers (`game-helpers.js`), Web Audio synthesizer (`audio.js`), Elo/clock utilities (`elo.js`), haptics/math (`utils.js`), and module Web Worker (`ai.worker.js`) handling `bestMove`, `evaluate`, and streaming/cancellable `analyzeGame`.
- **3D Rendering & Input (`src/engine/`)**: Three.js (`^0.170.0`) WebGL scene (`scene.js`), adaptive & manual quality profiles (`quality.js`: `auto`/`high`/`medium`/`low`), procedural PBR board & beveled frame with metallic fillet (`board3d.js`, `themes.js`), UV-normalized Staunton pieces with subtle PBR grain (`pieces3d.js`), strict Y-stratified FX layers (`fx.js`: last move, premove, check, move dots, manual marks/arrows, animated 3D gold-emerald hint arrow + ghost piece + PV arrows), and `CameraController` (`camera.js`) with `arrowMode` touch gate and `y=0` board-plane raycasting.
- **Online Multiplayer (`src/online/firebase.js`)**: Firebase Auth & Firestore matchmaking/rooms, authoritative clock/turn sync, presence callbacks, and VIP developer bypass (`elkaua1227@gmail.com` or `profile.dev === true`) for live online hints & evaluation bar.
- **Application Orchestrator & UI (`src/main.js`, `index.html`, `src/styles/main.css`)**: Responsive glassmorphic HUD (desktop + mobile), FIFO remote/queued move buffer, online premove state machine, decoupled `viewPly` SAN history navigation (`|< < > >|`), post-game analysis panel (accuracy %, move classification badges, clickable SVG eval graph), mobile `✎ Setas` drawing mode + PC right-drag arrows, accessibility, keyboard shortcuts, and haptics.

## Feature Inventory
Every feature discovered in Step 0 Survey and requested in `ORIGINAL_REQUEST.md` is assigned a Milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Git hygiene (`.gitignore`) | Ignore `.agents/` so agent metadata is never committed or pushed | M1 | survey_1, original |
| 2 | Engine PV line (`findBestMove`) | Return 2–4 ply Principal Variation (`pv: [{ from, to, promotion, san }]`) with best move | M1 | original (2A), survey_1/2/3 |
| 3 | Mate-safe eval & move classification | `formatEval`, `cpToWinProb`, `classifyMove` (`!!`, `★`, `✓`, `•`, `?!`, `?`, `??`), accuracy % | M1 | original (2A), survey_1/3 |
| 4 | Worker `analyzeGame` & cancellation | Streaming per-ply analysis (`analyzeProgress` + `id` cancel), search-backed `evaluate` | M1 | original (2A), survey_1/3 |
| 5 | Deterministic position/capture/premove helpers | Reconstruct board/captured pieces/material delta at any ply `0..N`; premove validation helper | M1 | survey_1/3 |
| 6 | Extended audio effects | Add `defeat`, `draw`, `premove`, and subtle `arrow`/`hint` Web Audio cues | M1 | survey_3, general UX |
| 7 | Engine & helper unit tests | Expand `tests/*.test.mjs` covering PV, mate eval formatting, classification, captures/history, premove logic | M1 | original, survey_1/3 |
| 8 | PBR board & table textures (`Opção 3A`) | Procedural `map` + `bumpMap` + `roughnessMap` (`512` high / `256` medium; `NoColorSpace` on data maps); color-only `map` on `low` | M2 | original (3A), survey_2 |
| 9 | Beveled board frame + metallic fillet (`Opção 3A`) | Beveled molding frame with thin metallic inlay fillet on `high`/`medium`, lightweight frame on `low`; aligned coords & `fitRadius` | M2 | original (3A), survey_2 |
| 10 | Piece UVs & subtle PBR piece textures (`Opção 3A`) | Fix `mergeGeos()` UV preservation/normalization across all 6 piece types; subtle wood/ivory/brushed-metal PBR maps on `high`/`medium`, clean `low` | M2 | original (3A), survey_2 |
| 11 | Dynamic & manual quality profiles | Update `applyQualityTier` to switch PBR maps, shadow types, and piece materials (`high`/`medium`/`low`) dynamically | M2 | original (3A), survey_2 |
| 12 | Stratified FX layers: premove & manual annotations | Separate Y-strata & disposal in `FXManager` for premove (blue/purple), 4-color square marks (`0.021`), and 4-color arrows (`0.026-0.032`) | M2 | original (1A, 2A), survey_2 |
| 13 | New 3D Hint FX (`Opção 2A`) | Animated 3D arrow (gold-emerald gradient/glow) + translucent ghost piece at target square + subtle PV continuation arrows (`0.036+`) | M2 | original (2A), survey_2/3 |
| 14 | Camera `arrowMode` & `y=0` raycaster | `CameraController.setArrowMode(bool)` (disables 1-finger orbit/tap, preserves pinch zoom) + analytical `y=0` square picker | M2 | original (1A), survey_2 |
| 15 | PC & Mobile manual arrows (`Opção 1A`) | PC right-drag arrows (Green, Shift=Red, Alt=Blue, Ctrl=Yellow), right-click mark, left-click clear (any turn), `contextmenu` suppressed; Mobile `✎ Setas` top-corner button + color/clear chip | M3 | original (1A), survey_2/3 |
| 16 | 3D Hint UI + PV line + stale-FEN guard | Wire `#btnHint` loading state, stale-FEN check, `fx.setHint` (without overwriting `lastMove`), and dismissible PV pill | M3 | original (2A), survey_1/2/3 |
| 17 | Online move queue, clock/presence sync & endgame dedup | FIFO move buffer (fix `busy` drops), sync `clockW`/`clockB`/`turnStartedAt` + `onPresence`, clamp `dt`, deduplicate `endGameFromBoard`, `leaveGame()` on switch | M3 | survey_1/3 |
| 18 | Online premove state machine (`Opção 2A`) | Allow off-turn piece selection & premove arming in `online` mode, blue/purple highlight, Esc/right-click cancel, auto-execute on opponent move | M3 | original (2A), survey_1/3 |
| 19 | Clickable SAN history & undo fix (`Opção 2A`) | `viewPly` decoupled inspection, `|< < > >|` + clickable SAN moves, mobile history drawer/strip, `"Voltar ao vivo"` banner, deterministic `#btnUndo` captures | M3 | original (2A), survey_1/3 |
| 20 | Post-game analysis UI (`Opção 2A`) | `#overOverlay` `"Analisar Partida"` & `"Ver Tabuleiro"`, streaming analysis progress, accuracy %, move classification badges, clickable SVG eval graph | M3 | original (2A), survey_3 |
| 21 | VIP rule preservation (`elkaua1227@gmail.com`) | Preserve `online.isVipDev()` gating for live online hints & eval bar; sync `#segEval`/`#segDiff` on startup | M3 | original (VIP), survey_1/3 |
| 22 | General UI/UX, haptics, accessibility & polish | Quality & haptics settings, `vibrate()` wiring, `#menuOverlay` resume & clock pause, 2-tap resign confirm, sorted captures + `+N`, ARIA, `:focus-visible`, `safe-area-inset`, keyboard shortcuts, mate eval display (`M1`) | M3 | original (general), survey_3 |
| 23 | Requirement-driven E2E test suite (Tiers 1–4) | Opaque-box E2E test infra (`TEST_INFRA.md`), automated test cases covering all 22 features, publish `TEST_READY.md` | E2E Track | original, Project Pattern |
| 24 | Final E2E pass, Tier 5 hardening, audit & Git push | Pass 100% E2E Tiers 1–4, Tier 5 adversarial hardening, whole-project audit, `npm test` + `npm run build`, commit & push to `main` (no `.agents/`) | M4 | original, Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Engine, Worker, Pure Helpers & Audio | Features #1–#7 (`src/core/*`, `src/workers/ai.worker.js`, `.gitignore`, `tests/*.test.mjs`) | none | IN_PROGRESS |
| M2 | 3D PBR Textures, Beveled Frame, FX & Camera | Features #8–#14 (`src/engine/*`) | none | DONE |
| E2E | E2E Testing Track (Opaque-box Tiers 1–4) | Feature #23 (`TEST_INFRA.md`, `TEST_READY.md`, `tests/e2e/*`) | none (specs from `PROJECT.md`) | IN_PROGRESS |
| M3 | Online Premove, SAN History, Analysis & UI/UX | Features #15–#22 (`src/online/firebase.js`, `src/main.js`, `index.html`, `src/styles/main.css`) | M1, M2 | PLANNED |
| M4 | Final Milestone: E2E Pass, Tier 5 & Git Push | Feature #24 (E2E Tiers 1–4, Tier 5 adversarial, full audit, `npm test`, `npm run build`, push `main`) | M1, M2, M3, E2E | PLANNED |

## Interface Contracts

### M1 ↔ M3 (`src/core/chess-engine.js`, `src/core/game-helpers.js`, `src/workers/ai.worker.js`, `src/core/audio.js`)
- `findBestMove(fen, depth = 3)` returns `{ from, to, promotion, san, evalCp, mateIn, pv }` (or `null` if no legal moves), where:
  - `evalCp`: number (White-perspective centipawns; large signed mate value handled cleanly)
  - `mateIn`: `number | null` (plies or moves to mate signed by side, `null` if non-mate)
  - `pv`: `Array<{ from: string, to: string, promotion?: string, san: string }>` (at least 1–4 plies when depth >= 1)
- `src/workers/ai.worker.js` protocol:
  - Request `{ id, type: 'bestMove', fen, depth }` → `{ id, ok: true, fen, move }` (where `move` includes `pv` and `mateIn`)
  - Request `{ id, type: 'evaluate', fen, depth? }` → `{ id, ok: true, fen, evalCp, mateIn }`
  - Request `{ id, type: 'analyzeGame', jobId, fens, moves, depth? }` → streams `{ id, jobId, type: 'analyzeProgress', done, total, entry }` and resolves `{ id, jobId, ok: true, summary: { whiteAccuracy, blackAccuracy, counts }, plies: [...] }`
  - Request `{ type: 'cancelAnalysis', jobId }` → cancels active analysis loop cleanly.
  - Each analyzed ply `entry` contains `{ ply, san, from, to, color, evalBeforeCp, evalAfterCp, bestMove, cpLoss, winProbBefore, winProbAfter, classification }` where `classification.code` is one of `'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'book'`.
- `src/core/game-helpers.js`:
  - `reconstructStateAtPly(historyVerbose, ply)`: returns `{ fen, board, capturedByWhite, capturedByBlack, materialDiff, lastMove: { from, to } | null, inCheck, turn }` without mutating caller's `Chess`.
  - `formatEvalDisplay(evalCp, mateIn)`: returns `{ text: string, pct: number }` (e.g. `M2`, `-M1`, `+1.4`, `0.0`).
  - `isPseudoLegalPremove(boardPieces, myColor, fromSq, toSq)`: validates own piece on `fromSq`, target != `fromSq`, chess movement geometry (including knight, king castle-adjacent, pawn push/capture/promo) ignoring current occupancy blockers where premove makes sense.
- `src/core/audio.js`:
  - Existing methods (`select`, `move`, `capture`, `castle`, `check`, `promote`, `win`, `tick`, `error`) plus `defeat()`, `draw()`, `premove()`.

### M2 ↔ M3 (`src/engine/quality.js`, `src/engine/board3d.js`, `src/engine/pieces3d.js`, `src/engine/fx.js`, `src/engine/camera.js`)
- `applyQualityTier(tier, context)` accepts `{ renderer, lights, fx, board?, pieces?, onTierApplied? }` and switches `'high' | 'medium' | 'low'` textures/PBR maps/shadows cleanly without leaking GPU resources.
- `board3d.js` exposes `setBoardQuality(tier)` / `applyBoardTheme(themeIndex, tier)` (or similar clean API exported for `main.js` and `quality.js`) supporting PBR `{ map, bumpMap, roughnessMap }` on `high`/`medium` and color-only `map` on `low`, plus beveled frame + metallic fillet on `high`/`medium`.
- `pieces3d.js` exports `createChessGeometries(tier)` (with preserved/normalized `uv` attributes on all 6 piece types `p,r,n,b,q,k`), `setPieceQuality(tier)` / `applyPieceTheme(theme, tier)`, and `createPieceMesh(type, color, geos, theme, tier)`.
- `fx.js` (`FXManager`) methods:
  - `setLastMove(fr, fc, tr, tc)` / `clearLastMove()`
  - `setPremove(fr, fc, tr, tc)` / `clearPremove()` (blue/purple layer at `y = 0.013`)
  - `toggleManualMark(r, c, colorKey)` / `toggleManualArrow(fr, fc, tr, tc, colorKey)` / `setManualPreviewArrow(fr, fc, tr, tc, colorKey)` / `clearManualPreviewArrow()` / `clearManualAnnotations()` (4 colors: `'green' | 'red' | 'blue' | 'yellow'`; marks at `y = 0.021`, arrows at `y = 0.026-0.032`)
  - `setHint({ from, to, pieceType, color, promotion, pv })` / `clearHint()` (animated gold-emerald 3D arrow + translucent ghost piece at target + optional subtle PV arrows at `y = 0.036+`)
- `camera.js` (`CameraController`) methods/callbacks:
  - `setArrowMode(enabled: boolean)`: locks 1-finger orbit/tap when true, preserves 2-finger pinch zoom.
  - `screenToSquare(clientX, clientY)`: analytical `y = 0` plane raycast returning `{ r, c, sq } | null`.
  - Clean pointer hooks or `onTap(x, y)` + `onRightDown` / `onRightDrag` / `onRightUp` / `onArrowDragStart` / `onArrowDragMove` / `onArrowDragEnd` so `main.js` handles PC right-click/drag and mobile `arrowMode` uniformly.

### UI ↔ E2E Testing Track (`index.html`, `src/main.js`, `src/online/firebase.js`)
- Required DOM IDs preserved & added:
  - Preserved: `#c3d`, `#btnHome`, `#turnPill`, `#turnTxt`, `#btnView2D`, `#btnFlip`, `#btnSound`, `#btnSettings`, `#cardW`, `#cardB`, `#capsW`, `#capsB`, `#clockW`, `#clockB`, `#evalWrap`, `#evalFill`, `#evalNum`, `#historyBox`, `#histList`, `#btnHint`, `#btnUndo`, `#btnDraw`, `#btnResign`, `#btnNewMenu`, `#menuOverlay`, `#settingsOverlay`, `#overOverlay`, `#btnRematch`, `#btnOverMenu`, `#segDiff`, `#segEval`, `#joinInput`.
  - New: `#btnArrows` (mobile `✎ Setas` toggle in top-right HUD), `#arrowChip` (floating color/clear bar when `arrowMode` active), `#histNav` (`#btnHistFirst`, `#btnHistPrev`, `#btnHistNext`, `#btnHistLast`), `#liveBanner` (`Voltar ao vivo`), `#hintBanner` (PV line & dismiss), `#btnAnalyze`, `#btnViewBoard`, `#analysisPanel` (eval SVG graph + accuracy + badges), `#segQuality` (`auto`/`high`/`medium`/`low`), `#segHaptics` (`1`/`0`), `#btnResumeGame` in `#menuOverlay`.
- VIP rule invariant: `elkaua1227@gmail.com` (`online.isVipDev()`) retains Hint and Eval Bar availability in active online matches; non-VIP online players do not receive live online hints or eval bar.

## Code Layout
- `src/core/`: pure logic, chess engine, helpers, audio, elo, utils (Node + browser ES module compatible, no DOM required except optional `utils.js`/`audio.js` guards)
- `src/workers/`: `ai.worker.js`
- `src/engine/`: Three.js scene, board, pieces, themes, quality, fx, camera
- `src/online/`: `firebase.js`
- `src/styles/`: `main.css`
- `src/main.js`: application wiring & UI state
- `tests/`: unit tests (`tests/*.test.mjs`) and E2E tests (`tests/e2e/`)
- Root config: `.gitignore`, `index.html`, `package.json`, `firestore.rules`, `vercel.json`
