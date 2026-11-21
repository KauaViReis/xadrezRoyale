/* ============================================================
   XADREZ ROYALE — Orquestrador Principal
   Modos: Contra Máquina (Web Worker) · 2 Jogadores · Online (Firebase)
   ============================================================ */

import * as THREE from 'three';
import { Chess } from 'chess.js';
import { squareToRC, rcToSquare } from './core/chess-engine.js';
import {
  reconstructStateAtPly, formatEvalDisplay, cpToWinProb,
  summarizeAnalysis, isPseudoLegalPremove, isPawnPromotionMove
} from './core/game-helpers.js';
import { AudioManager } from './core/audio.js';
import { setHaptics, vibrate } from './core/utils.js';
import { formatClock } from './core/elo.js';
import { BOARD_THEMES, PIECE_THEMES } from './engine/themes.js';
import { applyQualityTier } from './engine/quality.js';
import { createScene } from './engine/scene.js';
import { createBoard, applyBoardMaterialTextures, worldPos } from './engine/board3d.js';
import {
  createChessGeometriesByStyle, makeChessPiece, applyPieceTheme as applyPieceTheme3D,
  setPieceQuality, setPieceHighlight, disposePieceObject, isGroupPieceStyle,
  animatePieceMove, animateKingTopple, animatePiecesIntro
} from './engine/pieces3d.js';
import { FXManager } from './engine/fx.js';
import { CameraController } from './engine/camera.js';
import { OnlineManager, isFirebaseConfigured } from './online/firebase.js';
import { getStockfishHint } from './workers/stockfish-hint.js';
import { detectOpening } from './core/openings.js';
import { BOT_PROFILES, getBotById, getLeague, ACHIEVEMENTS, evaluateMatchAchievements } from './core/meta.js';
import { TACTICAL_PUZZLES, computeMaterialBalance, PuzzleRushManager } from './core/puzzles.js';
import { VoiceNarrator } from './core/narrator.js';
import { PiecePreviewStudio } from './engine/preview-studio.js';
import {
  RoyaleMatchManager, SPECIAL_RULESETS, getRingSquares,
  computeFogVisibleSquares, generateChess960Fen
} from './core/royale-mode.js';
import { TowerRunManager, TOWER_FLOORS, TOWER_BOONS } from './core/roguelike.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const PREFS_KEY = 'xadrezRoyale.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
const prefs = loadPrefs();

/* ============ ESTADO ============ */
const chess = new Chess();
const royale = new RoyaleMatchManager();
const towerRun = new TowerRunManager();
const puzzleRush = new PuzzleRushManager();
let isTowerMatch = false;
let activeRuleset = 'classic';
let mode = 'pve';
let aiDepth = prefs.aiDepth ?? 2;
let playerSide = 'w';
let myColor = 'w';
let localTimeLimit = 0;
let onlineTc = { base: 180000, inc: 2000, label: '3+2' };
let clockW = null, clockB = null;
let lastTickSec = -1;
let gameActive = false;
let busy = false;
let selectedSq = null;
let legalFromSelected = [];
let premove = null;           /* { from, to, promotion } */
let reviewPly = null;         /* null = ao vivo, 0..N = inspecionando lance */
let plyAnalyses = [];         /* [{ classification, evalCp, mateIn, cpLoss }] */
let boardThemeIdx = prefs.boardTheme ?? 0;
let pieceThemeIdx = prefs.pieceTheme ?? 0;
let pieceStyle = prefs.pieceStyle || 'staunton';
let lightingMode = prefs.lightingMode || 'lit';
let evalVisible = !!prefs.evalVisible;
let nick = prefs.nick || 'JOGADOR';
let pendingPromo = null;
let grid = Array.from({ length: 8 }, () => Array(8).fill(null));
let pieceMeshes = [];
let capturedMeshes = [];
let capTrayCount = { w: 0, b: 0 };
let capturedSymbols = { w: '', b: '' };

/* Estado da Arena Bot vs Bot */
let botWhiteId = 'viktor';
let botBlackId = 'helena';
let botArenaPaused = false;
let botArenaSpeed = 1;       /* 1 = normal (650ms), 2 = rápido (220ms), 3 = turbo (40ms) */
let botOrbitEnabled = true;

/* Estado de Puzzles Táticos */
const PUZZLE_KEY = 'xadrezRoyale.puzzles';
const loadSolvedPuzzles = () => {
  try { return new Set(JSON.parse(localStorage.getItem(PUZZLE_KEY)) || []); }
  catch { return new Set(); }
};
const solvedPuzzles = loadSolvedPuzzles();
let puzzleIdx = 0;
let puzzleStep = 0;

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      boardTheme: boardThemeIdx,
      pieceTheme: pieceThemeIdx,
      pieceStyle,
      lightingMode,
      aiDepth,
      evalVisible,
      muted: audio.muted,
      music: audio.musicEnabled,
      musicStyle: audio.musicStyle,
      narrator: narrator.enabled,
      nick
    }));
  } catch { /* noop */ }
}

/* ============ CENA 3D & ADAPTIVE QUALITY ============ */
const canvas = $('#c3d');
const { scene, camera, renderer, materials, lights, qualityTier: initTier, resize, setLightingMode } = createScene(canvas);
setLightingMode(lightingMode);
let qualityTier = initTier;
const boardCtx = createBoard(scene, materials, qualityTier);
const { squares } = boardCtx;
let geos = createChessGeometriesByStyle(qualityTier, pieceStyle);
const fx = new FXManager(scene);
fx.setQuality(qualityTier);
fx.setHintAssets(geos, PIECE_THEMES[pieceThemeIdx]);
const cam = new CameraController(canvas, camera);
const audio = new AudioManager();
audio.muted = !!prefs.muted;
audio.musicEnabled = prefs.music !== false;
audio.musicStyle = prefs.musicStyle || 'imperial';
const narrator = new VoiceNarrator();
narrator.setEnabled(!!prefs.narrator);
$('#btnSound').textContent = audio.muted ? '🔇' : '🔊';
if (audio.musicEnabled && !audio.muted) {
  const startAmbientOnce = () => {
    audio.startMusic();
    window.removeEventListener('pointerdown', startAmbientOnce);
    window.removeEventListener('keydown', startAmbientOnce);
  };
  window.addEventListener('pointerdown', startAmbientOnce, { once: true });
  window.addEventListener('keydown', startAmbientOnce, { once: true });
}

/* ============ WEB WORKER IA ============ */
const aiWorker = new Worker(new URL('./workers/ai.worker.js', import.meta.url), { type: 'module' });
let workerReqId = 0;
const workerWaiters = new Map();
let activeAnalysisCallback = null;

aiWorker.onmessage = e => {
  const { id, type, ...rest } = e.data;
  if (type === 'analysisProgress') {
    activeAnalysisCallback?.(rest);
    return;
  }
  const resolve = workerWaiters.get(id);
  if (resolve) { workerWaiters.delete(id); resolve(rest); }
};

function askWorker(type, payload, extra = {}) {
  return new Promise(resolve => {
    const id = ++workerReqId;
    workerWaiters.set(id, resolve);
    aiWorker.postMessage({ id, type, ...payload, ...extra });
  });
}

/* ============ ONLINE ============ */
const online = new OnlineManager();
let onlineInitPromise = null;

function canUseHint() {
  if (!gameActive || reviewPly !== null || online.game?.spectate || mode === 'botvsbot' || mode === 'puzzle') return false;
  if (mode !== 'online') return true;
  return online.isVipDev();
}

function canShowEval() {
  if (plyAnalyses.length > 0 && reviewPly !== null) return true;
  if (mode === 'botvsbot') return true;
  if (mode === 'online' && online.game?.spectate) return true;
  if (mode === 'online') return evalVisible && online.isVipDev();
  return evalVisible;
}

/* ============ TOAST & BANNER ============ */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function hideHint() {
  fx.clearHint();
  const hb = $('#hintBanner');
  hb.classList.add('hide');
  hb.style.display = 'none';
}

/* ============ TEMAS & SKINS 3D ============ */
function applyBoardTheme(i) {
  boardThemeIdx = i;
  const t = BOARD_THEMES[i] || BOARD_THEMES[0];
  boardCtx.setTheme(i, qualityTier);
  scene.background = new THREE.Color(t.bg);
  fx.setWeather(t.weather || 'none');
  document.querySelectorAll('#boardSwatches .swatch-btn').forEach((b, idx) => b.classList.toggle('active', idx === i));
  savePrefs();
}

let previewStudio = null;
let previewType = 'k';
let previewColor = 'w';

const PREVIEW_PIECE_NAMES = { k: 'Rei', q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo', p: 'Peão' };
const PREVIEW_HERO_MAP = {
  marvel_heroes: { k: 'Homem de Ferro', q: 'Feiticeira Escarlate', r: 'Thor (Mjolnir)', b: 'Dr. Estranho', n: 'Homem-Aranha', p: 'Capitão América' },
  dc_heroes:     { k: 'Batman', q: 'Mulher-Maravilha', r: 'Superman', b: 'Lanterna Verde', n: 'The Flash', p: 'Aquaman' }
};
const STYLE_BADGE_LABELS = {
  staunton: '♔ Staunton',
  crystal: '💎 Cristal',
  cyber: '🌆 Cyber Neon',
  medieval: '🏰 Medieval',
  marvel_heroes: '🛡️ Marvel',
  dc_heroes: '🦇 DC',
  marvel_vs_dc: '⚡ Marvel×DC'
};

function refreshPreviewStudio() {
  if (!previewStudio) return;
  previewStudio.updatePiece(previewType, previewColor, geos, PIECE_THEMES[pieceThemeIdx] || PIECE_THEMES[0], pieceStyle);
  const badge = $('#previewHeroBadge');
  if (badge) badge.textContent = STYLE_BADGE_LABELS[pieceStyle] || '♔ Staunton';
  const sub = $('#previewHeroSub');
  if (sub) {
    const pName = PREVIEW_PIECE_NAMES[previewType] || 'Peça';
    const sideName = previewColor === 'w' ? 'Brancas' : 'Pretas';
    let heroTitle = '';
    if (pieceStyle === 'marvel_heroes') heroTitle = ` · ${PREVIEW_HERO_MAP.marvel_heroes[previewType]}`;
    else if (pieceStyle === 'dc_heroes') heroTitle = ` · ${PREVIEW_HERO_MAP.dc_heroes[previewType]}`;
    else if (pieceStyle === 'marvel_vs_dc') {
      heroTitle = ` · ${(previewColor === 'w' ? PREVIEW_HERO_MAP.marvel_heroes : PREVIEW_HERO_MAP.dc_heroes)[previewType]}`;
    }
    sub.textContent = `${pName}${heroTitle} (${sideName}) · 360°`;
  }
}

function applyPieceTheme(i) {
  pieceThemeIdx = i;
  const th = PIECE_THEMES[i] || PIECE_THEMES[0];
  applyPieceTheme3D(th, qualityTier, { pieceMeshes, capturedMeshes, geos, style: pieceStyle });
  fx.setHintAssets(geos, th);
  document.querySelectorAll('#pieceSwatches .swatch-btn').forEach((b, idx) => b.classList.toggle('active', idx === i));
  refreshPreviewStudio();
  savePrefs();
}

function applyPieceStyle(nextStyle) {
  pieceStyle = nextStyle || 'staunton';
  const th = PIECE_THEMES[pieceThemeIdx] || PIECE_THEMES[0];
  if (!isGroupPieceStyle(pieceStyle)) {
    setPieceQuality(qualityTier, { pieceMeshes, capturedMeshes, geos, theme: th, style: pieceStyle });
  }
  rebuildBoardPieces();
  fx.setHintAssets(geos, th);
  refreshPreviewStudio();
  savePrefs();
}

/* ============ PEÇAS 3D ============ */
function clearAllPieces() {
  for (const p of pieceMeshes) {
    scene.remove(p.mesh);
    disposePieceObject(p.mesh);
  }
  for (const m of capturedMeshes) {
    scene.remove(m);
    disposePieceObject(m);
  }
  pieceMeshes = [];
  capturedMeshes = [];
  capTrayCount = { w: 0, b: 0 };
  grid = Array.from({ length: 8 }, () => Array(8).fill(null));
}

function addCapturedToken(type, color) {
  const sym = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }[type] || '';
  capturedSymbols[color === 'w' ? 'b' : 'w'] += sym;
  $('#capsW').textContent = capturedSymbols.w;
  $('#capsB').textContent = capturedSymbols.b;

  if (qualityTier === 'low') return;
  const th = PIECE_THEMES[pieceThemeIdx];
  const tok = makeChessPiece(scene, geos, type, color, 0, 0, th, qualityTier, pieceStyle);
  const side = color === 'w' ? -1 : 1;
  const n = capTrayCount[color]++;
  const col = Math.floor(n / 8);
  const row = n % 8;
  tok.mesh.position.set(side * (5.1 + col * 0.72), -0.35, (row - 3.5) * 0.85);
  tok.mesh.scale.setScalar(0.75);
  capturedMeshes.push(tok.mesh);
}

function rebuildBoardPieces(boardMatrix = chess.board()) {
  const prevCaptured = [...capturedMeshes];
  for (const p of pieceMeshes) {
    scene.remove(p.mesh);
    disposePieceObject(p.mesh);
  }
  pieceMeshes = [];
  grid = Array.from({ length: 8 }, () => Array(8).fill(null));

  const th = PIECE_THEMES[pieceThemeIdx];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = boardMatrix[r][c];
      if (!cell) continue;
      const p = makeChessPiece(scene, geos, cell.type, cell.color, r, c, th, qualityTier, pieceStyle);
      grid[r][c] = p;
      pieceMeshes.push(p);
    }
  }
  capturedMeshes = prevCaptured;
}

function updateMaterialUI(viewChess = chess) {
  const bal = computeMaterialBalance(viewChess);
  const elW = $('#matW');
  const elB = $('#matB');
  if (elW) {
    elW.style.display = bal.diffW > 0 ? 'inline-block' : 'none';
    if (bal.diffW > 0) elW.textContent = `+${bal.diffW}`;
  }
  if (elB) {
    elB.style.display = bal.diffB > 0 ? 'inline-block' : 'none';
    if (bal.diffB > 0) elB.textContent = `+${bal.diffB}`;
  }
}

/* ============ UI UPDATES ============ */
function updateTurnUI(viewChess = chess) {
  const turn = viewChess.turn();
  const isReview = reviewPly !== null;
  updateMaterialUI(viewChess);
  $('#turnDot').classList.toggle('black', turn === 'b');
  $('#turnTxt').textContent = isReview
    ? `REVISÃO · LANCE ${reviewPly}/${chess.history().length}`
    : (turn === 'w' ? 'VEZ DAS BRANCAS' : 'VEZ DAS PRETAS');
  $('#turnSub').style.display = viewChess.inCheck() ? 'inline' : 'none';
  $('#turnSub').textContent = viewChess.inCheck() ? '· XEQUE!' : '';
  $('#cardW').classList.toggle('active', gameActive && !isReview && turn === 'w');
  $('#cardB').classList.toggle('active', gameActive && !isReview && turn === 'b');
  const lb = $('#liveBanner');
  lb.classList.toggle('hide', !isReview);
  lb.style.display = isReview ? 'inline-block' : 'none';

  if (viewChess.inCheck()) {
    const b = viewChess.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (b[r][c]?.type === 'k' && b[r][c]?.color === turn) fx.setCheckSquare(r, c);
    }
  } else {
    fx.clearCheckSquare();
  }

  $('#btnHint').style.display = canUseHint() ? 'flex' : 'none';
  $('#btnUndo').style.display = (gameActive && !isReview && mode !== 'online' && chess.history().length > 0) ? 'flex' : 'none';
  $('#btnDraw').style.display = (gameActive && mode === 'online') ? 'flex' : 'none';
  $('#btnResign').style.display = (gameActive && mode !== 'pvp') ? 'flex' : 'none';
  $('#btnResumeGame').style.display = gameActive ? 'block' : 'none';
}

function updateClocksUI() {
  const show = clockW !== null && clockB !== null;
  $('#clockW').style.display = show ? 'block' : 'none';
  $('#clockB').style.display = show ? 'block' : 'none';
  if (!show) return;
  $('#clockW').textContent = formatClock(clockW);
  $('#clockB').textContent = formatClock(clockB);
  $('#clockW').classList.toggle('low', clockW <= 15000);
  $('#clockB').classList.toggle('low', clockB <= 15000);
}

const CLS_BADGE = {
  brilliant: { sym: '!!', cls: 'cls-brilliant' },
  great:     { sym: '!',  cls: 'cls-great' },
  best:      { sym: '★',  cls: 'cls-best' },
  inaccuracy:{ sym: '?!', cls: 'cls-inaccuracy' },
  mistake:   { sym: '?',  cls: 'cls-mistake' },
  blunder:   { sym: '??', cls: 'cls-blunder' }
};

function renderHistory() {
  const list = $('#histList');
  const hist = chess.history();
  const activePly = reviewPly !== null ? reviewPly : hist.length;
  list.innerHTML = '';

  for (let i = 0; i < hist.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const num = document.createElement('span');
    num.className = 'hist-num';
    num.textContent = `${i / 2 + 1}.`;
    row.appendChild(num);

    for (const offset of [0, 1]) {
      const plyIdx = i + offset;
      if (plyIdx >= hist.length) {
        row.appendChild(document.createElement('span'));
        continue;
      }
      const plyNum = plyIdx + 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hist-move' + (activePly === plyNum ? ' active' : '');
      btn.dataset.ply = String(plyNum);
      const badge = plyAnalyses[plyIdx]?.classification?.code
        ? CLS_BADGE[plyAnalyses[plyIdx].classification.code]
        : (typeof plyAnalyses[plyIdx]?.classification === 'string' ? CLS_BADGE[plyAnalyses[plyIdx].classification] : null);
      btn.innerHTML = `<span>${hist[plyIdx]}</span>` + (badge ? `<span class="hist-cls ${badge.cls}">${badge.sym}</span>` : '');
      btn.onclick = () => goToPly(plyNum);
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;

  const op = detectOpening(hist);
  const opEl = $('#openingBadge');
  if (opEl) {
    if (op) {
      opEl.innerHTML = `<strong>${op.eco}</strong> · ${op.name}`;
      opEl.style.display = 'block';
    } else {
      opEl.style.display = 'none';
    }
  }

  const total = hist.length;
  $('#btnHistFirst').disabled = activePly <= 0;
  $('#btnHistPrev').disabled = activePly <= 0;
  $('#btnHistNext').disabled = activePly >= total;
  $('#btnHistLast').disabled = activePly >= total;
}

function goToPly(ply) {
  const histVerbose = chess.history({ verbose: true });
  const total = histVerbose.length;
  const clamped = Math.max(0, Math.min(total, ply));
  deselect();
  hideHint();

  if (clamped === total) {
    reviewPly = null;
    rebuildBoardPieces(chess.board());
    if (total > 0) {
      const last = histVerbose[total - 1];
      const f = squareToRC(last.from), t = squareToRC(last.to);
      fx.setLastMove(f.r, f.c, t.r, t.c);
    } else {
      fx.clearLastMove();
    }
    updateTurnUI(chess);
    renderHistory();
    refreshEval();
    return;
  }

  reviewPly = clamped;
  const stateAt = reconstructStateAtPly(histVerbose, clamped);
  const viewChess = new Chess(stateAt.fen);
  rebuildBoardPieces(viewChess.board());
  if (stateAt.lastMove) {
    const f = squareToRC(stateAt.lastMove.from), t = squareToRC(stateAt.lastMove.to);
    fx.setLastMove(f.r, f.c, t.r, t.c);
  } else {
    fx.clearLastMove();
  }
  updateTurnUI(viewChess);
  renderHistory();
  refreshEval(viewChess.fen(), clamped);
}

let lastEvalWhiteCp = 0;
let firstBloodClaimed = false;
let lastCapturePlyByColor = { w: -99, b: -99 };
let esportsBannerTimer = null;

function showEsportsBanner(title, sub = '', tone = 'gold', durationMs = 2600) {
  const el = $('#esportsBanner');
  if (!el) return;
  if ($('#esportsTitle')) $('#esportsTitle').textContent = title;
  if ($('#esportsSub')) $('#esportsSub').textContent = sub;
  el.classList.remove('hide', 'tone-danger', 'tone-cyan');
  if (tone === 'danger') el.classList.add('tone-danger');
  else if (tone === 'cyan') el.classList.add('tone-cyan');
  clearTimeout(esportsBannerTimer);
  esportsBannerTimer = setTimeout(() => el.classList.add('hide'), durationMs);
}

async function refreshEval(fen = chess.fen(), plyForAnalysis = null) {
  const show = canShowEval();
  $('#evalWrap').style.display = show ? 'flex' : 'none';

  if (plyForAnalysis !== null && plyForAnalysis > 0 && plyAnalyses[plyForAnalysis - 1]) {
    if (!show) return;
    const a = plyAnalyses[plyForAnalysis - 1];
    const wp = cpToWinProb(a.evalCp, a.mateIn);
    $('#evalFill').style.height = `${Math.max(5, Math.min(95, wp * 100))}%`;
    $('#evalNum').textContent = formatEvalDisplay(a.evalCp, a.mateIn);
    return;
  }

  const res = await askWorker('evaluate', { fen }, { depth: 1, quiesce: true });
  if (!res.ok) return;
  const newWhiteCp = res.cp ?? res.evalCp ?? 0;
  const histV = chess.history({ verbose: true });
  if (plyForAnalysis === null && histV.length >= 4 && gameActive) {
    const lastMove = histV[histV.length - 1];
    const reaction = narrator.reactToEvalSwing({
      prevWhiteCp: lastEvalWhiteCp,
      newWhiteCp,
      moverColor: lastMove.color,
      ply: histV.length
    });
    if (reaction.tag === 'blunder') {
      showEsportsBanner('🦆 CAPIVARA DETECTADA (??)', reaction.text, 'danger', 2800);
    } else if (reaction.tag === 'brilliant') {
      showEsportsBanner('💎 LANCE DE MESTRE (!!)', reaction.text, 'cyan', 2800);
    } else if (reaction.tag === 'comeback') {
      showEsportsBanner('🔥 VIRADA HISTÓRICA!', reaction.text, 'gold', 3000);
    }
  }
  lastEvalWhiteCp = newWhiteCp;

  if (!show) return;
  const wp = cpToWinProb(newWhiteCp, res.mateIn ?? null);
  $('#evalFill').style.height = `${Math.max(5, Math.min(95, wp * 100))}%`;
  $('#evalNum').textContent = formatEvalDisplay(newWhiteCp, res.mateIn ?? null);
}

/* ============ SELEÇÃO, PREMOVE & EXECUÇÃO ============ */
function deselect() {
  if (selectedSq) {
    const { r, c } = squareToRC(selectedSq);
    const p = grid[r][c];
    if (p) {
      p.mesh.position.y = 0;
      setPieceHighlight(p.mesh, 0x000000, 0);
    }
  }
  selectedSq = null;
  legalFromSelected = [];
  fx.clearIndicators();
}

function clearPremove() {
  premove = null;
  fx.clearPremove();
}

function syncRoyaleVisuals() {
  const curPly = chess.history().length;
  boardCtx.setCollapsedRings?.(royale.collapsedRings);

  const warningSquares = royale.warningRing > 0 ? getRingSquares(royale.warningRing) : [];
  const { shields, frozen } = royale.getActiveStatusSquares(curPly);

  const fogSquares = [];
  if (royale.isFogActive() && gameActive && reviewPly === null) {
    const persp = mode === 'pvp' ? chess.turn() : myColor;
    const visSet = computeFogVisibleSquares(chess, persp);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = rcToSquare(r, c);
        const isVisible = visSet.has(sq);
        if (!isVisible) fogSquares.push({ r, c, sq });
        if (grid[r][c]) {
          grid[r][c].mesh.visible = isVisible || grid[r][c].color === persp;
        }
      }
    }
  } else {
    for (const p of pieceMeshes) p.mesh.visible = true;
  }

  fx.setRoyaleOverlays({
    warningSquares,
    relicSquare: royale.relicSquare,
    shieldSquares: shields,
    frozenSquares: frozen,
    fogSquares
  });

  const hudBar = $('#royaleHudBar');
  const zoneBadge = $('#royaleZoneBadge');
  const powerGrp = $('#heroPowerGroup');
  if (!hudBar) return;

  const showRoyale = gameActive && royale.isRoyaleActive();
  const showPowers = gameActive && royale.isPowersActive();
  const showFog = gameActive && royale.isFogActive();
  const show960 = gameActive && royale.ruleset === 'chess960';
  hudBar.style.display = (showRoyale || showPowers || showFog || show960) ? 'flex' : 'none';

  if (zoneBadge) {
    zoneBadge.style.display = (showRoyale || showFog || show960) ? 'inline-block' : 'none';
    if (showRoyale) {
      zoneBadge.classList.toggle('danger', royale.warningRing > 0);
      if (royale.warningRing === 1) {
        zoneBadge.textContent = `⚠️ ALERTA: Borda 8×8 desaba em ${Math.max(1, 12 - curPly)} lance(s)!`;
      } else if (royale.warningRing === 2) {
        zoneBadge.textContent = `⚠️ ALERTA: Borda 6×6 desaba em ${Math.max(1, 26 - curPly)} lance(s)!`;
      } else if (royale.collapsedRings === 0) {
        zoneBadge.textContent = `🔥 Arena 8×8 · Colapso em ${Math.max(1, 12 - curPly)} lances${royale.relicSquare ? ` · 💎 Relíquia em ${royale.relicSquare.toUpperCase()}` : ''}`;
      } else if (royale.collapsedRings === 1) {
        zoneBadge.textContent = `🔥 Arena 6×6 · 2º Colapso em ${Math.max(1, 26 - curPly)} lances${royale.relicSquare ? ` · 💎 ${royale.relicSquare.toUpperCase()}` : ''}`;
      } else {
        zoneBadge.textContent = `🔥 Arena Final 4×4 · Morte Súbita!`;
      }
    } else if (showFog) {
      zoneBadge.classList.remove('danger');
      zoneBadge.textContent = `🌫️ Neblina de Guerra 3D · ${64 - fogSquares.length}/64 casas visíveis`;
    } else if (show960) {
      zoneBadge.classList.remove('danger');
      zoneBadge.textContent = '🎲 Xadrez 960 (Fischer Random) · Primeira fileira sorteada';
    }
  }

  if (powerGrp) {
    powerGrp.style.display = showPowers ? 'flex' : 'none';
    if (showPowers) {
      const activeSide = mode === 'pvp' ? chess.turn() : myColor;
      const myE = royale.energy[activeSide] || 0;
      const isMyTurn = chess.turn() === activeSide && !busy;
      if ($('#heroEnergyBadge')) $('#heroEnergyBadge').textContent = `⚡ ${myE}/3`;
      if ($('#btnPowerShield')) $('#btnPowerShield').disabled = !isMyTurn || myE < 1;
      if ($('#btnPowerFreeze')) $('#btnPowerFreeze').disabled = !isMyTurn || myE < 2;
      if ($('#btnPowerUlt')) $('#btnPowerUlt').disabled = !isMyTurn || myE < 3;
    }
  }
}

function selectSquare(sq) {
  const { r, c } = squareToRC(sq);
  const p = grid[r][c];
  if (!p) return;

  /* Premove no modo online durante o turno do oponente */
  if (mode === 'online' && chess.turn() !== myColor) {
    if (p.color !== myColor) return;
    deselect();
    selectedSq = sq;
    p.mesh.position.y = 0.14;
    setPieceHighlight(p.mesh, 0x3B82F6, 0.38);
    const b = chess.board();
    for (let tr = 0; tr < 8; tr++) {
      for (let tc = 0; tc < 8; tc++) {
        const target = rcToSquare(tr, tc);
        if (isPseudoLegalPremove(b, myColor, sq, target)) {
          fx.addMoveDot(tr, tc, Boolean(b[tr][tc]));
        }
      }
    }
    audio.select();
    return;
  }

  if (p.color !== chess.turn()) return;
  deselect();
  if (royale.isSquareFrozen(sq, chess.history().length)) {
    audio.error();
    toast('❄️ Esta peça está congelada neste turno!');
    return;
  }
  const rawMoves = chess.moves({ square: sq, verbose: true });
  const moves = royale.filterLegalMoves(rawMoves, chess.history().length);
  if (moves.length === 0) { audio.error(); return; }

  selectedSq = sq;
  legalFromSelected = moves;
  p.mesh.position.y = 0.14;
  setPieceHighlight(p.mesh, 0xC99A3E, 0.35);
  for (const m of moves) {
    const to = squareToRC(m.to);
    fx.addMoveDot(to.r, to.c, Boolean(m.captured));
  }
  audio.select();
}

function askPromotion() {
  return new Promise(resolve => {
    $('#promoModal').classList.remove('hide');
    pendingPromo = resolve;
  });
}

document.querySelectorAll('.promo-btn').forEach(btn => {
  btn.onclick = () => {
    $('#promoModal').classList.add('hide');
    if (pendingPromo) { pendingPromo(btn.dataset.piece); pendingPromo = null; }
  };
});

async function executeMove(moveInput, isRemote = false) {
  if (busy) return false;
  busy = true;
  deselect();
  hideHint();
  fx.clearManualAnnotations();
  if (reviewPly !== null) goToPly(chess.history().length);

  const moverColor = chess.turn();
  const move = chess.move(moveInput);
  if (!move) { busy = false; return false; }

  const fromRC = squareToRC(move.from);
  const toRC = squareToRC(move.to);
  const piece = grid[fromRC.r][fromRC.c];

  if (move.captured) {
    const capR = move.flags.includes('e') ? fromRC.r : toRC.r;
    const capC = toRC.c;
    const victim = grid[capR][capC];
    if (victim) {
      grid[capR][capC] = null;
      scene.remove(victim.mesh);
      pieceMeshes = pieceMeshes.filter(x => x !== victim);
      disposePieceObject(victim.mesh);
      addCapturedToken(victim.type, victim.color);
      fx.spawnParticles(capR, capC, PIECE_THEMES[pieceThemeIdx][victim.color]);
      fx.spawnShockwave(capR, capC, 0xEF4444);
      royale.addEnergy(moverColor, 1);

      const plyCount = chess.history().length;
      if (!firstBloodClaimed) {
        firstBloodClaimed = true;
        fx.spawnLightningBolt(capR, capC, 0xEF4444);
        cam.shake(0.11, 210);
        showEsportsBanner('🩸 FIRST BLOOD!', `Primeira captura em ${move.to.toUpperCase()}`, 'danger', 2400);
        narrator.announceEsportsEvent('first_blood');
      } else if (victim.type === 'q') {
        fx.spawnLightningBolt(capR, capC, 0xF4C96B);
        cam.shake(0.18, 280);
        showEsportsBanner('👑 DAMA ABATIDA!', `Captura decisiva em ${move.to.toUpperCase()}`, 'gold', 2600);
        narrator.announceEsportsEvent('queen_snipe');
      } else if (plyCount - lastCapturePlyByColor[moverColor] <= 2) {
        fx.spawnLightningBolt(capR, capC, 0x38BDF8);
        cam.shake(0.12, 220);
        showEsportsBanner('⚡ COMBO DUPLO!', 'Capturas consecutivas em sequência!', 'cyan', 2300);
        narrator.announceEsportsEvent('double_capture');
      } else if (victim.type === 'r') {
        cam.shake(0.10, 180);
      }
      lastCapturePlyByColor[moverColor] = plyCount;
    }
  }

  grid[fromRC.r][fromRC.c] = null;
  grid[toRC.r][toRC.c] = piece;
  await animatePieceMove(piece, toRC.r, toRC.c, move.piece === 'n');

  const isHiddenInFog = royale.isFogActive()
    && moverColor !== (mode === 'pvp' ? chess.turn() : myColor)
    && !computeFogVisibleSquares(chess, mode === 'pvp' ? chess.turn() : myColor).has(move.to);

  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rookFromC = move.flags.includes('k') ? 7 : 0;
    const rookToC = move.flags.includes('k') ? 5 : 3;
    const rook = grid[fromRC.r][rookFromC];
    if (rook) {
      grid[fromRC.r][rookFromC] = null;
      grid[fromRC.r][rookToC] = rook;
      animatePieceMove(rook, fromRC.r, rookToC, false, 200);
    }
    audio.castle();
    vibrate([20, 40, 20]);
  } else if (move.captured) {
    audio.capture();
    vibrate(35);
  } else if (isHiddenInFog) {
    const pan = (toRC.c - 3.5) / 3.5;
    audio.fogStep(pan);
    toast(`🌫️ Som de movimento na neblina (${toRC.c < 4 ? 'Ala da Dama' : 'Ala do Rei'})…`, 1800);
  } else {
    audio.move();
    vibrate(12);
  }

  if (move.promotion) {
    piece.type = move.promotion;
    if (piece.mesh.isGroup) {
      scene.remove(piece.mesh);
      disposePieceObject(piece.mesh);
      const nextP = makeChessPiece(scene, geos, move.promotion, piece.color, toRC.r, toRC.c, PIECE_THEMES[pieceThemeIdx], qualityTier, pieceStyle);
      piece.mesh = nextP.mesh;
      piece.mesh.userData.piece = piece;
      piece.mesh.traverse(ch => { ch.userData.piece = piece; });
    } else {
      piece.mesh.geometry = geos[move.promotion];
    }
    audio.promote();
    fx.spawnParticles(toRC.r, toRC.c, 0xC99A3E, 18);
  }

  /* Processa Estado Battle Royale & Poderes de Heróis */
  const curPly = chess.history().length;
  royale.onPieceMoved(move.from, move.to, move.captured ? move.to : null);
  const rEv = royale.advanceTurn(chess, move, curPly);
  if (rEv.relicClaimed) {
    fx.spawnLightningBolt(toRC.r, toRC.c, 0x38BDF8);
    fx.spawnShockwave(toRC.r, toRC.c, 0x38BDF8);
    cam.shake(0.14, 220);
    showEsportsBanner('💎 RELÍQUIA ANCESTRAL!', '+2⚡ Energia de Herói + Escudo Arcano ativado!', 'cyan', 2800);
    narrator.announceEsportsEvent('relic_claim');
  }
  if (rEv.warningRing > 0) {
    showEsportsBanner('⚠️ ALERTA DE COLAPSO!', 'A borda externa vai afundar em 2 lances! Evacue suas peças!', 'danger', 3200);
    narrator.announceEsportsEvent('royale_warning');
  }
  if (rEv.collapsedRing > 0) {
    for (const d of rEv.destroyedSquares) {
      fx.spawnParticles(d.r, d.c, 0xEF4444, 16);
      fx.spawnLightningBolt(d.r, d.c, 0xEF4444);
      addCapturedToken(d.type, d.color);
    }
    rebuildBoardPieces();
    cam.shake(0.24, 340);
    const subMsg = rEv.destroyedSquares.length > 0
      ? `${rEv.destroyedSquares.length} peça(s) engolida(s) pelo abismo!`
      : `A arena encolheu para ${rEv.collapsedRing === 1 ? '6×6' : '4×4'}!`;
    showEsportsBanner('🔥 COLAPSO DA ARENA 3D!', subMsg, 'danger', 3400);
    narrator.announceEsportsEvent('royale_collapse');
  }
  syncRoyaleVisuals();

  if (chess.inCheck()) {
    audio.check();
    cam.shake(0.11, 200);
  }
  if (!isHiddenInFog) {
    narrator.announceMove(move, { isCheck: chess.inCheck(), isCheckmate: chess.isCheckmate() });
    fx.setLastMove(fromRC.r, fromRC.c, toRC.r, toRC.c);
  } else {
    fx.clearLastMove();
  }
  const curOpening = detectOpening(chess.history());
  if (curOpening && chess.history().length <= 12) {
    narrator.announceOpening(curOpening);
  }
  renderHistory();
  updateTurnUI();
  refreshEval();

  if (mode === 'online' && !isRemote && moverColor === myColor) {
    if (onlineTc.base > 0) {
      if (moverColor === 'w') clockW += onlineTc.inc;
      else clockB += onlineTc.inc;
      updateClocksUI();
    }
    online.sendMove({ from: move.from, to: move.to, promotion: move.promotion }, moverColor === 'w' ? clockW : clockB);
  }

  busy = false;

  /* Validação do Modo Puzzles Táticos & Puzzle Rush */
  if (mode === 'puzzle' && !isRemote) {
    const puz = puzzleRush.active ? puzzleRush.currentPuzzle() : TACTICAL_PUZZLES[puzzleIdx];
    const expectedUci = puz?.moves?.[puzzleStep];
    const playedUci = `${move.from}${move.to}${move.promotion || ''}`;
    if (expectedUci && playedUci !== expectedUci) {
      audio.error();
      if (puzzleRush.active) {
        const mRes = puzzleRush.recordMistake();
        updatePuzzleRushHUD();
        if (mRes.gameOver) {
          finishPuzzleRush('Três erros cometidos (0 vidas restantes)!');
          return true;
        }
        showEsportsBanner('💔 ERRO NO RUSH!', `Restam ${puzzleRush.formatHearts()} (${mRes.lives} vida(s))!`, 'danger', 2000);
      } else {
        toast('❌ Lance incorreto! Tente novamente.');
      }
      setTimeout(() => {
        if (mode !== 'puzzle') return;
        chess.undo();
        rebuildBoardPieces();
        renderHistory();
        updateTurnUI();
      }, 420);
      return true;
    }
    puzzleStep++;
    if (puzzleStep >= puz.moves.length) {
      audio.win();
      solvedPuzzles.add(puz.id);
      try { localStorage.setItem(PUZZLE_KEY, JSON.stringify([...solvedPuzzles])); } catch { /* noop */ }
      updatePuzzleSolvedUI();
      if (puzzleRush.active) {
        const sRes = puzzleRush.recordSolve();
        updatePuzzleRushHUD();
        showEsportsBanner(`🔥 RUSH +1 (${sRes.score} ACERTOS)`, `Recorde Pessoal: ${sRes.bestScore} 🔥`, 'cyan', 1600);
        setTimeout(() => {
          if (mode === 'puzzle' && puzzleRush.active) loadRushPuzzle(sRes.nextPuzzle);
        }, 520);
      } else {
        toast(`✅ Puzzle "${puz.title}" resolvido! (${solvedPuzzles.size}/${TACTICAL_PUZZLES.length})`);
        narrator.speak(`Excelente! Puzzle ${puz.title} resolvido!`);
        setTimeout(() => {
          if (mode === 'puzzle') startPuzzle((puzzleIdx + 1) % TACTICAL_PUZZLES.length);
        }, 1500);
      }
      return true;
    }
    /* Resposta automática do oponente no puzzle */
    const replyUci = puz.moves[puzzleStep];
    puzzleStep++;
    setTimeout(() => {
      if (mode !== 'puzzle' || !gameActive) return;
      executeMove({
        from: replyUci.slice(0, 2),
        to: replyUci.slice(2, 4),
        promotion: replyUci[4] || undefined
      }, true);
    }, 360);
    return true;
  }

  if (chess.isGameOver()) {
    clearPremove();
    endGameFromBoard();
    return true;
  }

  /* Executa Premove se for minha vez no online */
  if (mode === 'online' && isRemote && chess.turn() === myColor && premove) {
    const pm = premove;
    clearPremove();
    const legal = chess.moves({ verbose: true }).find(
      m => m.from === pm.from && m.to === pm.to && (!m.promotion || m.promotion === (pm.promotion || 'q'))
    );
    if (legal) {
      await executeMove({ from: legal.from, to: legal.to, promotion: legal.promotion });
      return true;
    }
  }

  if (mode === 'pvp') {
    cam.flipBoard();
  } else if (mode === 'pve' && chess.turn() !== playerSide) {
    runAIMove();
  } else if (mode === 'botvsbot') {
    scheduleBotArenaTurn();
  }
  return true;
}

const ACH_KEY = 'xadrezRoyale.achievements';
const loadUnlockedAch = () => {
  try { return new Set(JSON.parse(localStorage.getItem(ACH_KEY)) || []); }
  catch { return new Set(); }
};
const unlockedAch = loadUnlockedAch();
let localWinStreak = 0;
let lastMatchWinner = 'draw';
let lastMatchReason = '';

function unlockMatchesAchievements(ids = []) {
  let added = false;
  for (const id of ids) {
    if (!unlockedAch.has(id)) {
      unlockedAch.add(id);
      added = true;
      const meta = ACHIEVEMENTS.find(a => a.id === id);
      if (meta) toast(`Conquista: ${meta.icon} ${meta.name}!`);
    }
  }
  if (added) {
    try { localStorage.setItem(ACH_KEY, JSON.stringify([...unlockedAch])); } catch { /* noop */ }
  }
}

function currentBotProfile() {
  return BOT_PROFILES[Math.max(0, Math.min(BOT_PROFILES.length - 1, (aiDepth || 2) - 1))] || BOT_PROFILES[1];
}

let botArenaTimer = null;
function scheduleBotArenaTurn() {
  clearTimeout(botArenaTimer);
  if (mode !== 'botvsbot' || !gameActive || botArenaPaused || chess.isGameOver()) return;
  const delay = botArenaSpeed === 3 ? 40 : (botArenaSpeed === 2 ? 220 : 620);
  botArenaTimer = setTimeout(() => {
    if (mode !== 'botvsbot' || !gameActive || botArenaPaused || chess.isGameOver()) return;
    const activeBot = getBotById(chess.turn() === 'w' ? botWhiteId : botBlackId);
    runAIMove(activeBot);
  }, delay);
}

async function runAIMove(overrideBot = null) {
  if (!gameActive || chess.isGameOver()) return;
  const bot = overrideBot || currentBotProfile();
  $('#turnTxt').textContent = `${bot.name.toUpperCase()} PENSANDO…`;

  const curPly = chess.history().length;
  const aiColor = chess.turn();
  if (royale.isPowersActive()) {
    const aiE = royale.energy[aiColor] || 0;
    if (aiE >= 3) {
      triggerHeroPower('ultimate', aiColor);
    } else if (aiE >= 2 && Math.random() < 0.65) {
      triggerHeroPower('freeze', aiColor);
    }
  }

  const allowedMoves = royale.filterLegalMoves(chess.moves({ verbose: true }), curPly);
  if (allowedMoves.length === 0) {
    endGameFromBoard(chess.turn() === 'w' ? 'b' : 'w', 'Sem lances legais na Zona Royale');
    return;
  }

  let res = null;
  if (bot.style === 'stockfish') {
    res = await getStockfishHint(chess.fen(), { depth: 12, movetime: mode === 'botvsbot' && botArenaSpeed === 3 ? 250 : 750 });
  }
  if (!res || !res.ok || !res.move) {
    res = await askWorker('bestMove', { fen: chess.fen(), depth: Math.min(3, bot.depth || aiDepth) });
  }
  if (!gameActive) return;
  if (mode === 'botvsbot' && botArenaPaused) return;

  let chosen = res?.ok && res?.move ? res.move : null;
  const isAllowed = chosen && allowedMoves.some(m => m.from === chosen.from && m.to === chosen.to);
  if (!isAllowed) {
    const captures = allowedMoves.filter(m => m.captured);
    chosen = captures.length > 0 ? captures[0] : allowedMoves[0];
  }
  await executeMove(chosen);
}

async function endGameFromBoard(customWinner = null, customReason = '') {
  if (!gameActive && !customWinner) return;
  gameActive = false;
  clearPremove();
  hideHint();
  let winner = customWinner;
  let reason = customReason;
  const isMate = chess.isCheckmate();

  if (!winner) {
    if (isMate) {
      winner = chess.turn() === 'w' ? 'b' : 'w';
      reason = 'Xeque-mate';
    } else if (chess.isStalemate()) {
      winner = 'draw';
      reason = 'Afogamento (Stalemate)';
    } else if (chess.isThreefoldRepetition()) {
      winner = 'draw';
      reason = 'Tripla repetição';
    } else if (chess.isInsufficientMaterial()) {
      winner = 'draw';
      reason = 'Material insuficiente';
    } else {
      winner = 'draw';
      reason = 'Empate';
    }
  }

  lastMatchWinner = winner;
  lastMatchReason = reason;

  if (mode === 'online' && !customWinner && !online.game?.spectate) {
    online.finishGame(winner, reason);
  }

  /* Killcam 3D Cinematográfica de Xeque-Mate */
  if (isMate) {
    const loserColor = chess.turn();
    const kingPiece = pieceMeshes.find(p => p.type === 'k' && p.color === loserColor);
    if (kingPiece) {
      const kPos = worldPos(kingPiece.r, kingPiece.c);
      fx.spawnParticles(kingPiece.r, kingPiece.c, 0xC99A3E, 22);
      await Promise.all([
        cam.playKillcam(kPos),
        animateKingTopple(kingPiece)
      ]);
    }
  }

  if (winner === 'draw') audio.draw();
  else if (mode !== 'pvp' && winner !== myColor) audio.defeat();
  else audio.win();

  /* Avalia Conquistas */
  if (!online.game?.spectate) {
    const won = mode === 'pvp' ? winner !== 'draw' : winner === myColor;
    if (won) localWinStreak++; else localWinStreak = 0;
    const histV = chess.history({ verbose: true });
    const myMoves = histV.filter(m => m.color === (mode === 'pvp' ? winner : myColor));
    const newAchs = evaluateMatchAchievements({
      won,
      isCheckmate: isMate,
      pliesCount: histV.length,
      castled: myMoves.some(m => m.flags.includes('k') || m.flags.includes('q')),
      promoted: myMoves.some(m => Boolean(m.promotion)),
      streak: online.profile?.streak || localWinStreak,
      botId: mode === 'pve' ? currentBotProfile().id : null
    });
    unlockMatchesAchievements(newAchs);
  }

  /* Progressão da Torre Royale (Roguelike PvE) */
  if (isTowerMatch) {
    if (winner === 'w') {
      const adv = towerRun.advanceAfterWin();
      if (adv.clearedRun) {
        showEsportsBanner('👑 TORRE ROYALE CONQUISTADA!', 'Você derrotou todos os 8 Guardiões e o Imperador Stockfish!', 'gold', 4200);
        narrator.speak('Parabéns! Você conquistou o topo da Torre Royale!', true);
        openTowerModal(false);
        return;
      }
      showEsportsBanner(`🏰 ANDAR ${towerRun.floor - 1} VENCIDO!`, 'Escolha 1 Bênção Permanente para o próximo andar!', 'cyan', 3400);
      openTowerModal(true);
      return;
    }
    if ($('#overEyebrow')) $('#overEyebrow').textContent = `TORRE ROYALE · ANDAR ${towerRun.floor}/8`;
  } else {
    if ($('#overEyebrow')) $('#overEyebrow').textContent = 'FIM DE PARTIDA';
  }

  $('#overTitle').textContent = winner === 'draw' ? 'Empate' : (winner === 'w' ? 'Brancas Vencem' : 'Pretas Vencem');
  $('#overSub').textContent = reason;
  $('#overDelta').style.display = 'none';
  $('#rematchStatus').style.display = 'none';
  $('#btnRematch').textContent = (mode === 'online' && !online.game?.spectate) ? '🔄 PEDIR REVANCHE' : (isTowerMatch ? '⚔️ TENTAR ANDAR NOVAMENTE' : 'JOGAR NOVAMENTE');
  $('#btnRematch').style.display = online.game?.spectate ? 'none' : 'block';
  $('#btnAnalyze').style.display = chess.history().length > 0 ? 'block' : 'none';
  $('#overOverlay').classList.remove('hide');
}

/* ============ SETAS TÁTICAS & ANOTAÇÕES ============ */
let dragOriginSq = null;
function annotationColor(payload) {
  if (payload?.shiftKey) return 'red';
  if (payload?.altKey) return 'blue';
  if (payload?.ctrlKey || payload?.metaKey) return 'yellow';
  return cam.arrowMode ? activeArrowColor : 'green';
}

function handleAnnotateStart(payload) {
  const hit = cam.screenToSquare(payload.clientX, payload.clientY);
  dragOriginSq = hit ? { r: hit.r, c: hit.c } : null;
}

function handleAnnotateMove(payload) {
  if (!dragOriginSq) return;
  const hit = cam.screenToSquare(payload.clientX, payload.clientY);
  if (hit && (hit.r !== dragOriginSq.r || hit.c !== dragOriginSq.c)) {
    fx.setManualPreviewArrow(dragOriginSq.r, dragOriginSq.c, hit.r, hit.c, annotationColor(payload));
  } else {
    fx.clearManualPreviewArrow();
  }
}

function handleAnnotateEnd(payload) {
  fx.clearManualPreviewArrow();
  if (!dragOriginSq || payload.cancelled) { dragOriginSq = null; return; }
  const hit = cam.screenToSquare(payload.clientX, payload.clientY);
  if (hit) {
    const color = annotationColor(payload);
    if (hit.r === dragOriginSq.r && hit.c === dragOriginSq.c) {
      fx.toggleManualMark(hit.r, hit.c, color);
    } else {
      fx.toggleManualArrow(dragOriginSq.r, dragOriginSq.c, hit.r, hit.c, color);
    }
  }
  dragOriginSq = null;
}

cam.onRightDown = p => {
  if (premove) clearPremove();
  handleAnnotateStart(p);
};
cam.onRightDrag = handleAnnotateMove;
cam.onRightUp = handleAnnotateEnd;
cam.onArrowDragStart = handleAnnotateStart;
cam.onArrowDragMove = handleAnnotateMove;
cam.onArrowDragEnd = handleAnnotateEnd;

/* ============ INTERAÇÃO NO TABULEIRO (RAYCASTER) ============ */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();

cam.onTap = async (cx, cy) => {
  if (cam.arrowMode || online.game?.spectate || mode === 'botvsbot') return;
  fx.clearManualAnnotations();
  if (!gameActive || busy || reviewPly !== null) return;
  if (mode === 'pve' && chess.turn() !== playerSide) return;

  const isOnlinePremoveTurn = mode === 'online' && chess.turn() !== myColor;
  const rect = canvas.getBoundingClientRect();
  ptr.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ptr.y = -((cy - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ptr, camera);

  const pieceHits = ray.intersectObjects(pieceMeshes.map(p => p.mesh), true);
  const sqHits = ray.intersectObjects(squares, false);

  let hitSq = null;
  if (pieceHits.length) {
    const p = pieceHits[0].object.userData.piece;
    if (p) hitSq = rcToSquare(p.r, p.c);
  } else if (sqHits.length) {
    const { r, c } = sqHits[0].object.userData;
    hitSq = rcToSquare(r, c);
  }
  if (!hitSq) { deselect(); if (isOnlinePremoveTurn) clearPremove(); return; }

  if (isOnlinePremoveTurn) {
    if (selectedSq && selectedSq !== hitSq) {
      const b = chess.board();
      if (isPseudoLegalPremove(b, myColor, selectedSq, hitSq)) {
        const f = squareToRC(selectedSq), t = squareToRC(hitSq);
        const piece = grid[f.r][f.c];
        premove = {
          from: selectedSq,
          to: hitSq,
          promotion: isPawnPromotionMove(piece?.type, myColor, hitSq) ? 'q' : undefined
        };
        fx.setPremove(f.r, f.c, t.r, t.c);
        deselect();
        toast('Pré-lance definido');
        return;
      }
    }
    const { r, c } = squareToRC(hitSq);
    if (grid[r][c]?.color === myColor) {
      selectSquare(hitSq);
    } else {
      deselect();
      clearPremove();
    }
    return;
  }

  if (selectedSq) {
    const matching = legalFromSelected.filter(m => m.to === hitSq);
    if (matching.length > 0) {
      let promo;
      if (matching.some(m => m.promotion)) {
        promo = await askPromotion();
      }
      await executeMove({ from: selectedSq, to: hitSq, promotion: promo });
      return;
    }
  }

  const { r, c } = squareToRC(hitSq);
  if (grid[r][c]?.color === chess.turn()) {
    selectSquare(hitSq);
  } else {
    deselect();
  }
};

/* Segurar e Arrastar Peças em 3D (Hold & Drag) */
let dragPiece = null;
let dragOriginPos = null;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.55);
const dragHitPt = new THREE.Vector3();

cam.onPieceDragStart = (cx, cy) => {
  if (!gameActive || busy || reviewPly !== null || cam.arrowMode || online.game?.spectate || mode === 'botvsbot') return false;
  if (mode === 'pve' && chess.turn() !== playerSide) return false;
  if (mode === 'online' && chess.turn() !== myColor) return false;

  const rect = canvas.getBoundingClientRect();
  ptr.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ptr.y = -((cy - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ptr, camera);

  const hits = ray.intersectObjects(pieceMeshes.filter(p => p.color === chess.turn()).map(p => p.mesh), true);
  if (!hits.length) return false;
  const p = hits[0].object.userData.piece;
  if (!p) return false;
  const sq = rcToSquare(p.r, p.c);
  if (royale.isSquareFrozen(sq, chess.history().length)) {
    audio.error();
    toast('❄️ Esta peça está congelada neste turno!');
    return false;
  }
  const moves = royale.filterLegalMoves(chess.moves({ square: sq, verbose: true }), chess.history().length);
  if (!moves.length) return false;

  dragPiece = p;
  dragOriginPos = worldPos(p.r, p.c);
  selectSquare(sq);
  return true;
};


cam.onPieceDragMove = (cx, cy, moved) => {
  if (!dragPiece || moved < 8) return;
  const rect = canvas.getBoundingClientRect();
  ptr.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ptr.y = -((cy - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ptr, camera);

  if (ray.ray.intersectPlane(dragPlane, dragHitPt)) {
    dragPiece.mesh.position.set(
      Math.max(-4.4, Math.min(4.4, dragHitPt.x)),
      0.55,
      Math.max(-4.4, Math.min(4.4, dragHitPt.z))
    );
  }
  const hit = cam.screenToSquare(cx, cy);
  if (hit) {
    const leg = legalFromSelected.find(m => m.to === hit.sq);
    if (leg) fx.setDragRing(hit.r, hit.c, Boolean(leg.captured));
    else fx.clearDragRing();
  } else {
    fx.clearDragRing();
  }
};

cam.onPieceDragEnd = async (cx, cy, moved, cancelled) => {
  if (!dragPiece) return;
  const p = dragPiece;
  const origin = dragOriginPos;
  dragPiece = null;
  dragOriginPos = null;
  fx.clearDragRing();

  if (cancelled || moved < 8) {
    p.mesh.position.set(origin.x, selectedSq === rcToSquare(p.r, p.c) ? 0.14 : 0, origin.z);
    return;
  }

  const hit = cam.screenToSquare(cx, cy);
  const matching = hit ? legalFromSelected.filter(m => m.to === hit.sq) : [];
  if (matching.length > 0 && selectedSq) {
    p.mesh.position.set(origin.x, 0, origin.z);
    let promo;
    if (matching.some(m => m.promotion)) promo = await askPromotion();
    await executeMove({ from: selectedSq, to: hit.sq, promotion: promo });
  } else {
    p.mesh.position.set(origin.x, 0, origin.z);
    deselect();
  }
};

/* Hover tátil no desktop + Ghost Ring nas casas legais */
let hoveredPiece = null;
if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
  canvas.addEventListener('pointermove', e => {
    if (!gameActive || busy || cam.dragging || cam.pieceDragging || cam.arrowMode || reviewPly !== null || qualityTier === 'low' || mode === 'botvsbot') {
      if (hoveredPiece) {
        const sq = rcToSquare(hoveredPiece.r, hoveredPiece.c);
        if (sq !== selectedSq) hoveredPiece.mesh.position.y = 0;
        hoveredPiece = null;
      }
      return;
    }
    const rect = canvas.getBoundingClientRect();
    ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);

    if (selectedSq && legalFromSelected.length) {
      const hit = cam.screenToSquare(e.clientX, e.clientY);
      const leg = hit ? legalFromSelected.find(m => m.to === hit.sq) : null;
      if (leg) fx.setDragRing(hit.r, hit.c, Boolean(leg.captured));
      else fx.clearDragRing();
    }

    const activeColor = mode === 'online' ? myColor : chess.turn();
    const hits = ray.intersectObjects(pieceMeshes.filter(p => p.color === activeColor).map(p => p.mesh), true);
    const next = hits.length ? hits[0].object.userData.piece : null;
    if (hoveredPiece && hoveredPiece !== next && rcToSquare(hoveredPiece.r, hoveredPiece.c) !== selectedSq) {
      hoveredPiece.mesh.position.y = 0;
    }
    hoveredPiece = next;
    if (hoveredPiece && rcToSquare(hoveredPiece.r, hoveredPiece.c) !== selectedSq) {
      hoveredPiece.mesh.position.y = 0.05;
    }
    canvas.style.cursor = hoveredPiece ? 'pointer' : '';
  });
}

function updatePuzzleSolvedUI() {
  const el = $('#puzzleSolvedCount');
  if (el) el.textContent = String(solvedPuzzles.size);
}
updatePuzzleSolvedUI();

function updatePuzzleRushHUD() {
  const hud = $('#puzzleRushHud');
  if (!hud) return;
  hud.style.display = puzzleRush.active ? 'inline-block' : 'none';
  if ($('#btnPuzzleNext')) $('#btnPuzzleNext').style.display = puzzleRush.active ? 'none' : 'inline-block';
  if (!puzzleRush.active) return;
  if ($('#rushTimerTxt')) $('#rushTimerTxt').textContent = formatClock(puzzleRush.remainingMs);
  if ($('#rushLivesTxt')) $('#rushLivesTxt').textContent = puzzleRush.formatHearts();
  if ($('#rushScoreTxt')) $('#rushScoreTxt').textContent = String(puzzleRush.score);
}

function loadRushPuzzle(puz) {
  if (!puz) return;
  const idx = TACTICAL_PUZZLES.findIndex(x => x.id === puz.id);
  puzzleIdx = idx >= 0 ? idx : 0;
  puzzleStep = 0;
  startMatch('puzzle', { customFen: puz.fen, puzzle: puz, isRush: true });
  updatePuzzleRushHUD();
  if ($('#puzzleMeta')) {
    $('#puzzleMeta').textContent = `⚡ RUSH #${puzzleRush.score + 1} · ${puz.title} (${puz.rating})`;
  }
}

function startPuzzleRush() {
  const first = puzzleRush.start(180000);
  loadRushPuzzle(first);
  showEsportsBanner('⚡ PUZZLE RUSH INICIADO!', '3 Minutos · 3 Vidas ❤️❤️❤️ · Resolva o máximo que puder!', 'gold', 2800);
}

function finishPuzzleRush(reason = 'Fim do Puzzle Rush') {
  puzzleRush.stop();
  updatePuzzleRushHUD();
  gameActive = false;
  audio.win();
  if ($('#overEyebrow')) $('#overEyebrow').textContent = '⚡ PUZZLE RUSH · SOBREVIVÊNCIA';
  $('#overTitle').textContent = `🔥 ${puzzleRush.score} Puzzles Resolvidos!`;
  $('#overSub').textContent = `${reason} · Recorde Pessoal: ${puzzleRush.bestScore} 🔥`;
  $('#overDelta').style.display = 'none';
  $('#rematchStatus').style.display = 'none';
  $('#btnRematch').textContent = '⚡ JOGAR RUSH NOVAMENTE';
  $('#btnRematch').style.display = 'block';
  $('#btnAnalyze').style.display = 'none';
  $('#overOverlay').classList.remove('hide');
}

function startPuzzle(idx = 0) {
  puzzleRush.stop();
  updatePuzzleRushHUD();
  puzzleIdx = ((idx % TACTICAL_PUZZLES.length) + TACTICAL_PUZZLES.length) % TACTICAL_PUZZLES.length;
  puzzleStep = 0;
  const puz = TACTICAL_PUZZLES[puzzleIdx];
  startMatch('puzzle', { customFen: puz.fen, puzzle: puz });
}

/* ============ INICIALIZAÇÃO DE PARTIDA ============ */
function startMatch(newMode, opts = {}) {
  clearTimeout(botArenaTimer);
  botArenaPaused = false;
  mode = newMode;
  isTowerMatch = Boolean(opts.isTower);
  narrator.resetMatch();
  lastEvalWhiteCp = 0;
  firstBloodClaimed = false;
  lastCapturePlyByColor = { w: -99, b: -99 };

  if (isTowerMatch) {
    playerSide = 'w';
    myColor = 'w';
    const floorCfg = towerRun.prepareFloorMatch(chess, royale);
    aiDepth = floorCfg.depth || 2;
    opts.overrideBot = {
      name: floorCfg.guardian,
      rating: floorCfg.rating,
      avatar: floorCfg.avatar,
      depth: floorCfg.depth,
      style: floorCfg.style || 'balanced'
    };
  } else {
    const matchRuleset = (newMode === 'online' || newMode === 'puzzle')
      ? 'classic'
      : (opts.ruleset || activeRuleset || 'classic');
    royale.reset(matchRuleset);

    if (opts.customFen) {
      chess.load(opts.customFen);
    } else if (matchRuleset === 'chess960') {
      chess.load(generateChess960Fen());
    } else {
      chess.reset();
    }
  }
  reviewPly = null;
  plyAnalyses = [];
  clearPremove();
  hideHint();
  fx.clearAll();
  $('#analysisSummary').style.display = 'none';
  clearAllPieces();
  capturedSymbols = { w: '', b: '' };
  $('#capsW').textContent = '';
  $('#capsB').textContent = '';
  if ($('#chatMessages')) {
    $('#chatMessages').innerHTML = '<div class="chat-empty">Envie uma mensagem ou reação rápida!</div>';
  }
  if ($('#chatUnread')) $('#chatUnread').style.display = 'none';

  if (mode === 'online' && opts.spectate && Array.isArray(opts.moves)) {
    for (const m of opts.moves) {
      try { chess.move({ from: m.from, to: m.to, promotion: m.promotion || undefined }); } catch { /* noop */ }
    }
  }

  rebuildBoardPieces();
  renderHistory();
  animatePiecesIntro(pieceMeshes);

  const arenaBar = $('#botArenaBar');
  const puzzleBar = $('#puzzleBar');
  if (arenaBar) arenaBar.style.display = mode === 'botvsbot' ? 'flex' : 'none';
  if (puzzleBar) puzzleBar.style.display = mode === 'puzzle' ? 'flex' : 'none';

  const myLeagueIcon = getLeague(online.profile?.rating || 1200).icon;
  if (mode === 'online') {
    myColor = opts.myColor || 'w';
    if (opts.spectate && opts.data) {
      $('#nameW').textContent = opts.data.white?.name || 'BRANCAS';
      $('#nameB').textContent = opts.data.black?.name || 'PRETAS';
      if ($('#avatarW')) $('#avatarW').textContent = getLeague(opts.data.white?.rating || 1200).icon;
      if ($('#avatarB')) $('#avatarB').textContent = getLeague(opts.data.black?.rating || 1200).icon;
    } else {
      const oppName = opts.opponent?.name || 'OPONENTE';
      const myName = online.profile?.name || nick;
      const oppIcon = getLeague(opts.opponent?.rating || 1200).icon;
      $('#nameW').textContent = myColor === 'w' ? myName : oppName;
      $('#nameB').textContent = myColor === 'b' ? myName : oppName;
      if ($('#avatarW')) $('#avatarW').textContent = myColor === 'w' ? myLeagueIcon : oppIcon;
      if ($('#avatarB')) $('#avatarB').textContent = myColor === 'b' ? myLeagueIcon : oppIcon;
    }
    clockW = opts.tc?.base || 300000;
    clockB = opts.tc?.base || 300000;
    cam.resetView(myColor);
  } else if (mode === 'botvsbot') {
    const bw = getBotById(botWhiteId);
    const bb = getBotById(botBlackId);
    $('#nameW').textContent = `${bw.name.toUpperCase()} (${bw.rating})`;
    $('#nameB').textContent = `${bb.name.toUpperCase()} (${bb.rating})`;
    if ($('#avatarW')) $('#avatarW').textContent = bw.avatar;
    if ($('#avatarB')) $('#avatarB').textContent = bb.avatar;
    clockW = null;
    clockB = null;
    if ($('#btnBotPause')) $('#btnBotPause').textContent = '⏸ Pausar';
    cam.resetView('w');
  } else if (mode === 'puzzle') {
    const puz = opts.puzzle || TACTICAL_PUZZLES[puzzleIdx];
    const side = chess.turn();
    myColor = side;
    $('#nameW').textContent = side === 'w' ? 'VOCÊ (PUZZLE)' : 'DESAFIO TÁTICO';
    $('#nameB').textContent = side === 'b' ? 'VOCÊ (PUZZLE)' : 'DESAFIO TÁTICO';
    if ($('#avatarW')) $('#avatarW').textContent = side === 'w' ? '🧩' : '♚';
    if ($('#avatarB')) $('#avatarB').textContent = side === 'b' ? '🧩' : '♔';
    if ($('#puzzleMeta')) {
      $('#puzzleMeta').textContent = `🧩 #${puzzleIdx + 1}/${TACTICAL_PUZZLES.length} · ${puz.title} (${puz.theme} · ${puz.rating})`;
    }
    clockW = null;
    clockB = null;
    cam.resetView(side);
  } else {
    myColor = playerSide;
    const bot = opts.overrideBot || currentBotProfile();
    const botLabel = `${bot.name.toUpperCase()} (${bot.rating})`;
    $('#nameW').textContent = mode === 'pve' && playerSide === 'b' ? botLabel : (mode === 'pve' ? nick : 'BRANCAS');
    $('#nameB').textContent = mode === 'pve' && playerSide === 'w' ? botLabel : (mode === 'pve' ? nick : 'PRETAS');
    if ($('#avatarW')) $('#avatarW').textContent = mode === 'pve' && playerSide === 'b' ? bot.avatar : (mode === 'pve' ? myLeagueIcon : '♔');
    if ($('#avatarB')) $('#avatarB').textContent = mode === 'pve' && playerSide === 'w' ? bot.avatar : (mode === 'pve' ? myLeagueIcon : '♚');
    clockW = localTimeLimit > 0 ? localTimeLimit : null;
    clockB = localTimeLimit > 0 ? localTimeLimit : null;
    cam.resetView(mode === 'pve' ? playerSide : 'w');
  }

  gameActive = true;
  busy = false;
  $('#menuOverlay').classList.add('hide');
  $('#overOverlay').classList.add('hide');
  $('#tvOverlay')?.classList.add('hide');
  $('#socialOverlay')?.classList.add('hide');
  syncRoyaleVisuals();
  updateClocksUI();
  updateTurnUI();
  refreshEval();


  if (mode === 'pve' && chess.turn() !== playerSide) {
    runAIMove();
  } else if (mode === 'botvsbot') {
    scheduleBotArenaTurn();
  }
}

/* ============ ANÁLISE PÓS-PARTIDA ============ */
function renderEvalGraph() {
  const svg = $('#evalGraph');
  if (!svg || !plyAnalyses.length) return;
  const w = 200, h = 48;
  const pts = plyAnalyses.map((a, i) => {
    const x = plyAnalyses.length === 1 ? w / 2 : (i / (plyAnalyses.length - 1)) * w;
    const wp = cpToWinProb(a?.evalAfterCp ?? a?.evalCp ?? 0, a?.mateIn ?? null);
    const y = (1 - wp) * (h - 6) + 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  svg.innerHTML =
    `<line x1="0" y1="24" x2="200" y2="24" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>` +
    `<polyline fill="none" stroke="#C99A3E" stroke-width="2" points="${pts.join(' ')}"/>`;
  svg.onclick = e => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetPly = Math.max(1, Math.min(plyAnalyses.length, Math.round(ratio * (plyAnalyses.length - 1)) + 1));
    goToPly(targetPly);
  };
}

async function runPostGameAnalysis() {
  const histVerbose = chess.history({ verbose: true });
  if (!histVerbose.length) return;
  $('#overOverlay').classList.add('hide');
  $('#historyBox').classList.add('open');
  $('#analysisPanel').style.display = 'flex';
  $('#analysisSummary').textContent = 'Analisando partida…';

  const fens = [new Chess().fen()];
  const tmp = new Chess();
  const moves = [];
  for (const m of histVerbose) {
    tmp.move(m);
    fens.push(tmp.fen());
    moves.push({ from: m.from, to: m.to, promotion: m.promotion, san: m.san });
  }

  plyAnalyses = new Array(moves.length);
  activeAnalysisCallback = prog => {
    const idx = prog.plyIndex ?? (prog.done ? prog.done - 1 : undefined);
    if (idx !== undefined && prog.entry) {
      plyAnalyses[idx] = prog.entry;
      renderHistory();
    }
    $('#analysisSummary').textContent = `Analisando lance ${prog.done ?? prog.completed ?? 0}/${moves.length}…`;
  };

  const res = await askWorker('analyzeGame', { fens, moves, depth: 2 });
  activeAnalysisCallback = null;
  if (res.ok && res.plies) {
    plyAnalyses = res.plies;
    const sum = res.summary || summarizeAnalysis(plyAnalyses);
    const accW = sum.whiteAccuracy ?? sum.accuracyW ?? 0;
    const accB = sum.blackAccuracy ?? sum.accuracyB ?? 0;
    $('#analysisSummary').innerHTML =
      `Precisão: <strong>B ${accW}%</strong> · <strong>P ${accB}%</strong><br>` +
      `★ ${sum.counts.best || 0} · ?! ${sum.counts.inaccuracy || 0} · ? ${sum.counts.mistake || 0} · ?? ${sum.counts.blunder || 0}`;
    renderEvalGraph();
    renderHistory();
    goToPly(1);
  }
}

/* ============ BINDINGS DE UI ============ */
function bindSeg(sel, cb) {
  const root = $(sel);
  if (!root) return;
  root.querySelectorAll('.seg').forEach(btn => {
    btn.onclick = () => {
      root.querySelectorAll('.seg').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cb(btn.dataset.val);
    };
  });
}

bindSeg('#segMode', v => {
  const isOnline = v === 'online';
  const isArena = v === 'botvsbot';
  $('#localOpts').style.display = (!isOnline && !isArena) ? 'block' : 'none';
  $('#botArenaOpts').style.display = isArena ? 'block' : 'none';
  $('#onlineOpts').style.display = isOnline ? 'block' : 'none';
  $('#diffRow').style.display = v === 'pve' ? 'flex' : 'none';
  $('#sideRow').style.display = v === 'pve' ? 'flex' : 'none';
  mode = v;
  if (isOnline) ensureOnline();
});

bindSeg('#segBotW', v => { botWhiteId = v; });
bindSeg('#segBotB', v => { botBlackId = v; });

bindSeg('#segRuleset', v => {
  activeRuleset = v;
  const meta = SPECIAL_RULESETS.find(r => r.id === v) || SPECIAL_RULESETS[0];
  if ($('#rulesetDesc')) {
    $('#rulesetDesc').innerHTML = `${meta.icon} <strong>${meta.name}:</strong> ${meta.desc}.`;
  }
});

function refreshBotCardUI() {
  const bot = currentBotProfile();
  const el = $('#botCardDesc');
  if (el && bot) {
    el.innerHTML = `${bot.avatar} <strong>${bot.name} (${bot.rating}) · ${bot.title}:</strong> ${bot.desc}`;
  }
}
bindSeg('#segDiff', v => {
  aiDepth = Number(v);
  savePrefs();
  refreshBotCardUI();
});
document.querySelectorAll('#segDiff .seg').forEach(b => b.classList.toggle('active', Number(b.dataset.val) === aiDepth));
refreshBotCardUI();
bindSeg('#segSide', v => { playerSide = v; });
bindSeg('#segTcLocal', v => { localTimeLimit = Number(v); });
bindSeg('#segTcOnline', v => {
  const [m, inc] = v.split('+').map(Number);
  onlineTc = { base: m * 60000, inc: inc * 1000, label: v };
});
bindSeg('#segEval', v => { evalVisible = v === '1'; savePrefs(); refreshEval(); });

/* Skin 3D das Peças (Staunton / Cristal / Cyber Neon / Medieval / Heróis) */
bindSeg('#segPieceStyle', v => { applyPieceStyle(v); });
document.querySelectorAll('#segPieceStyle .seg').forEach(b => b.classList.toggle('active', b.dataset.val === pieceStyle));

/* Iluminação de Estúdio (Escuro / Penumbra / Estúdio) */
bindSeg('#segLighting', v => {
  lightingMode = setLightingMode(v);
  savePrefs();
});
document.querySelectorAll('#segLighting .seg').forEach(b => b.classList.toggle('active', b.dataset.val === lightingMode));

let manualQualityMode = 'auto';
bindSeg('#segQuality', v => {
  manualQualityMode = v;
  qualityTier = v === 'auto' ? initTier : v;
  applyQualityTier(qualityTier, {
    renderer, lights, fx, materials,
    boardTheme: BOARD_THEMES[boardThemeIdx],
    board: boardCtx,
    pieces: { pieceMeshes, capturedMeshes, geos, theme: PIECE_THEMES[pieceThemeIdx], style: pieceStyle }
  });
});

/* Rádio Royale: Música Ambiente + Troca de Estação */
bindSeg('#segMusic', v => { audio.setMusic(v === '1'); savePrefs(); });
if (!audio.musicEnabled) {
  document.querySelectorAll('#segMusic .seg').forEach(b => b.classList.toggle('active', b.dataset.val === '0'));
}
bindSeg('#segMusicStyle', v => {
  audio.setMusicStyle(v);
  if (audio.musicEnabled && !audio.muted && !audio.musicPlaying) audio.startMusic();
  savePrefs();
  toast(`🎵 Estação: ${v.toUpperCase()}`);
});
document.querySelectorAll('#segMusicStyle .seg').forEach(b => b.classList.toggle('active', b.dataset.val === audio.musicStyle));

/* Narrador de Voz (Português) */
bindSeg('#segNarrator', v => {
  narrator.setEnabled(v === '1');
  savePrefs();
  if (narrator.enabled) narrator.speak('Narrador de voz ativado!');
});
document.querySelectorAll('#segNarrator .seg').forEach(b => b.classList.toggle('active', b.dataset.val === (narrator.enabled ? '1' : '0')));

bindSeg('#segHaptics', v => { setHaptics(v === '1'); });

let activeArrowColor = 'green';
document.querySelectorAll('.arrow-color-btn').forEach(btn => {
  btn.onclick = () => {
    activeArrowColor = btn.dataset.color || 'green';
    document.querySelectorAll('.arrow-color-btn').forEach(b => b.classList.toggle('active', b === btn));
  };
});
$('#btnClearArrows').onclick = () => fx.clearManualAnnotations();

/* Ativação dos Poderes de Heróis (Escudo Arcano 1⚡, Prisão de Gelo 2⚡, Trovão Royale 3⚡) */
function triggerHeroPower(powerId, sideOverride = null) {
  if (!gameActive || !royale.isPowersActive()) return false;
  const side = sideOverride || (mode === 'pvp' ? chess.turn() : myColor);
  if (chess.turn() !== side) {
    toast('Aguarde o seu turno para ativar um Poder de Herói!');
    return false;
  }
  const curPly = chess.history().length;
  const res = royale.activatePower(powerId, chess, side, curPly, selectedSq);
  if (!res.ok) {
    audio.error();
    toast(res.reason);
    return false;
  }

  audio.promote();
  cam.shake(0.16, 260);
  if (res.shieldedSq) {
    const rc = squareToRC(res.shieldedSq);
    fx.spawnShockwave(rc.r, rc.c, 0x38BDF8);
    fx.spawnParticles(rc.r, rc.c, 0x38BDF8, 16);
  }
  if (res.frozenSq) {
    const rc = squareToRC(res.frozenSq);
    fx.spawnLightningBolt(rc.r, rc.c, 0x60A5FA);
    fx.spawnShockwave(rc.r, rc.c, 0x60A5FA);
    fx.spawnParticles(rc.r, rc.c, 0x60A5FA, 18);
  }
  syncRoyaleVisuals();

  const details = [];
  if (res.shieldedSq) details.push(`🛡️ Escudo em ${res.shieldedSq.toUpperCase()}`);
  if (res.frozenSq) details.push(`❄️ Gelo em ${res.frozenSq.toUpperCase()}`);
  showEsportsBanner(`${res.power.icon} ${res.power.name.toUpperCase()}!`, details.join(' · '), powerId === 'ultimate' ? 'gold' : 'cyan', 2900);
  narrator.speak(`${res.power.name} ativado! ${details.join(' e ')}!`, false);
  return true;
}

if ($('#btnPowerShield')) $('#btnPowerShield').onclick = () => triggerHeroPower('shield');
if ($('#btnPowerFreeze')) $('#btnPowerFreeze').onclick = () => triggerHeroPower('freeze');
if ($('#btnPowerUlt')) $('#btnPowerUlt').onclick = () => triggerHeroPower('ultimate');

$('#btnStartLocal').onclick = () => startMatch(mode === 'pvp' ? 'pvp' : 'pve');
$('#btnStartBotArena').onclick = () => startMatch('botvsbot');
$('#btnStartPuzzles').onclick = () => {
  const firstUnsolved = TACTICAL_PUZZLES.findIndex(p => !solvedPuzzles.has(p.id));
  startPuzzle(firstUnsolved >= 0 ? firstUnsolved : 0);
};

/* ============ TORRE ROYALE (ROGUELIKE PvE DE 8 ANDARES) ============ */
function openTowerModal(showReward = false) {
  const cfg = towerRun.getCurrentFloorConfig();
  if ($('#towerTitle')) $('#towerTitle').textContent = `🏰 Torre Royale — Andar ${towerRun.floor}/8`;
  if ($('#towerRecordBadge')) {
    $('#towerRecordBadge').textContent = `🏆 Recorde: Andar ${towerRun.bestFloor}/8 · 👑 ${towerRun.clears} Coroa(s)`;
  }

  if ($('#towerLadder')) {
    $('#towerLadder').innerHTML = TOWER_FLOORS.map(f => {
      const cls = f.floor < towerRun.floor ? 'done' : (f.floor === towerRun.floor ? 'current' : '');
      return `<div class="tower-step ${cls}">
        <strong>${f.floor < towerRun.floor ? '✓' : f.avatar}</strong>
        <span>Andar ${f.floor}</span>
        <small>${f.rating}</small>
      </div>`;
    }).join('');
  }

  if ($('#towerFloorCard')) {
    const ruleTag = cfg.ruleset === 'royale' ? '🔥 Battle Royale 3D' : (cfg.use960 ? '🎲 Xadrez 960 + Heróis' : '⚡ Poderes de Heróis');
    $('#towerFloorCard').innerHTML = `
      <div>
        <div class="modal-eyebrow">PRÓXIMO DESAFIO · ${ruleTag.toUpperCase()}</div>
        <strong style="font-size:16px;color:#F4C96B">${cfg.avatar} Andar ${cfg.floor}: ${cfg.name} — ${cfg.guardian} (${cfg.rating} Elo)</strong>
        <div style="font-size:12px;color:var(--text-dim);margin-top:3px">${cfg.desc}</div>
      </div>
    `;
  }

  if ($('#towerBoonCount')) $('#towerBoonCount').textContent = String(towerRun.boons.length);
  if ($('#towerActiveBoons')) {
    $('#towerActiveBoons').innerHTML = towerRun.boons.length
      ? towerRun.boons.map(id => {
          const b = TOWER_BOONS.find(x => x.id === id);
          return b ? `<span class="tower-boon-chip" title="${b.desc}">${b.icon} ${b.name}</span>` : '';
        }).join('')
      : '<span class="status-msg" style="padding:4px 0">Vença andares para escolher Relíquias & Bênçãos permanentes!</span>';
  }

  const rewardBox = $('#towerRewardBox');
  const rewardGrid = $('#towerRewardGrid');
  if (rewardBox && rewardGrid) {
    rewardBox.classList.toggle('hide', !showReward);
    if (showReward) {
      const choices = towerRun.getRewardChoices(3);
      rewardGrid.innerHTML = choices.map(b => `
        <button type="button" class="tower-reward-btn" data-boon="${b.id}">
          <strong>${b.icon} ${b.name}</strong>
          <small>${b.desc}</small>
        </button>
      `).join('');
      rewardGrid.querySelectorAll('[data-boon]').forEach(btn => {
        btn.onclick = () => {
          audio.promote();
          towerRun.addBoon(btn.dataset.boon);
          const picked = TOWER_BOONS.find(x => x.id === btn.dataset.boon);
          if (picked) toast(`✨ Bênção adquirida: ${picked.icon} ${picked.name}!`);
          openTowerModal(false);
        };
      });
    }
  }

  $('#overOverlay').classList.add('hide');
  $('#towerOverlay').classList.remove('hide');
}

if ($('#btnStartTower')) $('#btnStartTower').onclick = () => { audio.click(); openTowerModal(false); };
if ($('#btnCloseTower')) $('#btnCloseTower').onclick = () => $('#towerOverlay').classList.add('hide');
if ($('#btnTowerReset')) {
  $('#btnTowerReset').onclick = () => {
    towerRun.startNewRun();
    toast('🔄 Escalada da Torre Royale reiniciada no Andar 1!');
    openTowerModal(false);
  };
}
if ($('#btnTowerFight')) {
  $('#btnTowerFight').onclick = () => {
    $('#towerOverlay').classList.add('hide');
    startMatch('pve', { isTower: true });
    const cfg = towerRun.getCurrentFloorConfig();
    showEsportsBanner(`🏰 ANDAR ${cfg.floor}/8 · ${cfg.name.toUpperCase()}`, `Vs ${cfg.guardian} (${cfg.rating} Elo)`, 'gold', 3000);
  };
}

/* Controles da Arena Bot vs Bot + Botão Assumir Controle */
$('#btnBotPause').onclick = () => {
  botArenaPaused = !botArenaPaused;
  $('#btnBotPause').textContent = botArenaPaused ? '▶ Continuar' : '⏸ Pausar';
  if (!botArenaPaused) scheduleBotArenaTurn();
};
$('#btnBotSpeed').onclick = () => {
  botArenaSpeed = (botArenaSpeed % 3) + 1;
  $('#btnBotSpeed').textContent = botArenaSpeed === 3 ? '⚡ Turbo' : `⚡ ${botArenaSpeed}x`;
};
$('#btnBotOrbit').onclick = () => {
  botOrbitEnabled = !botOrbitEnabled;
  $('#btnBotOrbit').textContent = botOrbitEnabled ? '🎥 Órbita: ON' : '🎥 Órbita: OFF';
};
function takeOverArenaSide(side) {
  if (mode !== 'botvsbot') return;
  clearTimeout(botArenaTimer);
  mode = 'pve';
  playerSide = side;
  myColor = side;
  const oppBotId = side === 'w' ? botBlackId : botWhiteId;
  const oppIdx = BOT_PROFILES.findIndex(b => b.id === oppBotId);
  if (oppIdx >= 0) aiDepth = oppIdx + 1;
  $('#botArenaBar').style.display = 'none';
  if (side === 'w') $('#nameW').textContent = 'VOCÊ (ASSUMIU)';
  else $('#nameB').textContent = 'VOCÊ (ASSUMIU)';
  cam.resetView(side);
  toast(`🎮 Você assumiu as ${side === 'w' ? 'Brancas' : 'Pretas'}!`);
  updateTurnUI();
  if (chess.turn() !== playerSide) runAIMove();
}
$('#btnTakeWhite').onclick = () => takeOverArenaSide('w');
$('#btnTakeBlack').onclick = () => takeOverArenaSide('b');

/* Controles do Modo Puzzles & Puzzle Rush */
if ($('#btnStartPuzzleRush')) {
  $('#btnStartPuzzleRush').onclick = () => {
    audio.click();
    startPuzzleRush();
  };
}
$('#btnPuzzleHint').onclick = () => {
  if (mode !== 'puzzle') return;
  const puz = puzzleRush.active ? puzzleRush.currentPuzzle() : TACTICAL_PUZZLES[puzzleIdx];
  const uci = puz?.moves?.[puzzleStep];
  if (!uci) return;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const moving = chess.get(from);
  fx.setHint({ from, to, pieceType: moving?.type || 'p', color: moving?.color || chess.turn(), pv: [{ from, to }] });
  toast(`💡 Dica: mova a peça de ${from.toUpperCase()} para ${to.toUpperCase()}`);
};
$('#btnPuzzleNext').onclick = () => startPuzzle((puzzleIdx + 1) % TACTICAL_PUZZLES.length);
$('#btnPuzzleExit').onclick = () => {
  puzzleRush.stop();
  updatePuzzleRushHUD();
  $('#puzzleBar').style.display = 'none';
  $('#menuOverlay').classList.remove('hide');
};

/* Importar / Exportar PGN & FEN */
$('#btnCopyPgn').onclick = () => {
  const pgn = chess.pgn() || '(sem lances ainda)';
  navigator.clipboard?.writeText(pgn);
  toast('📋 PGN copiado para a área de transferência!');
};
$('#btnCopyFen').onclick = () => {
  navigator.clipboard?.writeText(chess.fen());
  toast('📋 FEN atual copiado!');
};
$('#btnLoadFen').onclick = () => {
  const fen = window.prompt('Cole a string FEN da posição para jogar:', chess.fen());
  if (!fen) return;
  try {
    const test = new Chess(fen.trim());
    startMatch(mode === 'pvp' ? 'pvp' : 'pve', { customFen: test.fen() });
    toast('📥 Posição FEN carregada!');
  } catch {
    toast('❌ FEN inválido! Verifique o formato.');
  }
};

/* Gaveta Lateral Unificada (Abas: 📜 Lances | 💬 Chat) & Chat ao Vivo */
let activeDockTab = 'moves';
function setDockTab(tab = 'moves') {
  activeDockTab = tab === 'chat' ? 'chat' : 'moves';
  if ($('#tabDockMoves')) $('#tabDockMoves').classList.toggle('active', activeDockTab === 'moves');
  if ($('#tabDockChat')) $('#tabDockChat').classList.toggle('active', activeDockTab === 'chat');
  if ($('#dockPaneMoves')) $('#dockPaneMoves').style.display = activeDockTab === 'moves' ? 'flex' : 'none';
  if ($('#dockPaneChat')) $('#dockPaneChat').style.display = activeDockTab === 'chat' ? 'flex' : 'none';
  if (activeDockTab === 'chat') {
    if ($('#chatUnread')) $('#chatUnread').style.display = 'none';
    if ($('#chatUnreadInline')) $('#chatUnreadInline').style.display = 'none';
    if ($('#chatBox')) $('#chatBox').classList.add('open');
  }
}
if ($('#tabDockMoves')) $('#tabDockMoves').onclick = () => setDockTab('moves');
if ($('#tabDockChat')) $('#tabDockChat').onclick = () => setDockTab('chat');

function appendChatMessage(msg, isMe = false) {
  const box = $('#chatMessages');
  if (!box) return;
  const empty = box.querySelector('.chat-empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = `chat-msg ${isMe ? 'me' : ''}`;
  const tag = msg.spectate ? ' 📺' : '';
  const strong = document.createElement('strong');
  strong.textContent = `${msg.name || 'JOGADOR'}${tag}`;
  const body = document.createElement('span');
  body.textContent = msg.text;
  row.appendChild(strong);
  row.appendChild(body);
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  if (!isMe) {
    audio.chat();
    if (activeDockTab !== 'chat') {
      if ($('#chatUnread')) $('#chatUnread').style.display = 'block';
      if ($('#chatUnreadInline')) $('#chatUnreadInline').style.display = 'inline-block';
      toast(`💬 ${msg.name}: ${msg.text}`, 2200);
    }
  }
}

function sendChatText(text, isEmote = false) {
  const clean = String(text || '').trim().slice(0, 140);
  if (!clean) return;
  if (mode === 'online' && online.game) {
    online.sendChat(clean, isEmote);
  } else {
    appendChatMessage({ name: nick, text: clean, isEmote, ts: Date.now() }, true);
  }
}

$('#btnChat').onclick = () => {
  $('#historyBox').classList.add('open');
  setDockTab('chat');
};
if ($('#btnCloseChat')) $('#btnCloseChat').onclick = () => setDockTab('moves');
$('#chatForm').onsubmit = e => {
  e.preventDefault();
  const inp = $('#chatInput');
  if (!inp.value.trim()) return;
  sendChatText(inp.value, false);
  inp.value = '';
};
document.querySelectorAll('#chatEmotes .emote-btn').forEach(btn => {
  btn.onclick = () => sendChatText(btn.dataset.emote, true);
});
online.onChatMessage = (msg, isMe) => appendChatMessage(msg, isMe);

$('#btnResumeGame').onclick = () => $('#menuOverlay').classList.add('hide');
$('#btnNewMenu').onclick = () => $('#menuOverlay').classList.remove('hide');
$('#btnHome').onclick = () => $('#menuOverlay').classList.remove('hide');

$('#btnArrows').onclick = () => {
  const next = !cam.arrowMode;
  cam.setArrowMode(next);
  $('#btnArrows').classList.toggle('active', next);
  $('#btnArrows').setAttribute('aria-pressed', String(next));
  const chip = $('#arrowChip');
  chip.classList.toggle('hide', !next);
  chip.style.display = next ? 'flex' : 'none';
  toast(next ? 'Modo Setas: toque/arraste no tabuleiro' : 'Modo Jogo restaurado');
};

$('#btnView2D').onclick = async () => {
  const is2D = await cam.toggleTopDown();
  $('#btnView2D').classList.toggle('active', is2D);
  $('#btnView2D').setAttribute('aria-pressed', String(is2D));
};
$('#btnFlip').onclick = () => cam.flipBoard();
$('#btnSound').onclick = () => {
  audio.setMuted(!audio.muted);
  $('#btnSound').textContent = audio.muted ? '🔇' : '🔊';
  $('#btnSound').setAttribute('aria-pressed', String(audio.muted));
  savePrefs();
};

/* Abas do Estúdio Widescreen de Configurações */
$$('#settingsTabs .studio-tab').forEach(btn => {
  btn.onclick = () => {
    audio.click();
    const target = btn.dataset.stab;
    $$('#settingsTabs .studio-tab').forEach(b => b.classList.toggle('active', b === btn));
    ['visual', 'audio', 'graphics'].forEach(id => {
      const pane = $(`#stab-${id}`);
      if (pane) pane.classList.toggle('hide', id !== target);
    });
  };
});

bindSeg('#segPreviewType', v => { previewType = v; refreshPreviewStudio(); });
bindSeg('#segPreviewColor', v => { previewColor = v; refreshPreviewStudio(); });
function openSettingsStudio() {
  $('#settingsOverlay').classList.remove('hide');
  const pCanvas = $('#piecePreviewCanvas');
  if (pCanvas && !previewStudio) {
    try { previewStudio = new PiecePreviewStudio(pCanvas); } catch { /* noop */ }
  }
  refreshPreviewStudio();
  previewStudio?.start();
}
function closeSettingsStudio() {
  $('#settingsOverlay').classList.add('hide');
  previewStudio?.stop();
}
$('#btnSettings').onclick = openSettingsStudio;
$('#btnCloseSettings').onclick = closeSettingsStudio;
if ($('#btnCloseSettingsTop')) $('#btnCloseSettingsTop').onclick = closeSettingsStudio;
$('#btnHistoryToggle').onclick = () => {
  $('#historyBox').classList.toggle('open');
  setDockTab('moves');
};

$('#btnHistFirst').onclick = () => goToPly(0);
$('#btnHistPrev').onclick = () => goToPly((reviewPly !== null ? reviewPly : chess.history().length) - 1);
$('#btnHistNext').onclick = () => goToPly((reviewPly !== null ? reviewPly : chess.history().length) + 1);
$('#btnHistLast').onclick = () => goToPly(chess.history().length);
$('#liveBanner').onclick = () => goToPly(chess.history().length);

$('#btnHintDismiss').onclick = hideHint;
$('#btnHint').onclick = async () => {
  if (!canUseHint() || busy) return;
  const reqFen = chess.fen();
  const btn = $('#btnHint');
  btn.disabled = true;
  const prevHtml = btn.innerHTML;
  btn.innerHTML = '⏳ <span>PENSANDO</span>';
  try {
    let res = await getStockfishHint(reqFen, { depth: 14, movetime: 950 });
    if (!res.ok) {
      res = await askWorker('bestMove', { fen: reqFen, depth: 3 });
    }
    if (!res.ok || !res.move || chess.fen() !== reqFen) return;
    const moving = chess.get(res.move.from);
    const pv = Array.isArray(res.move.pv) && res.move.pv.length
      ? res.move.pv
      : [{ from: res.move.from, to: res.move.to, promotion: res.move.promotion, san: res.move.san }];
    fx.setHint({
      from: res.move.from,
      to: res.move.to,
      pieceType: moving?.type || 'p',
      color: moving?.color || chess.turn(),
      promotion: res.move.promotion,
      pv
    });
    const pvLine = pv.slice(0, 4).map(m => m.san || `${m.from}-${m.to}`).join(' ');
    const tag = res.engine === 'stockfish-19' ? 'Dica Stockfish' : 'Dica';
    $('#hintBannerTxt').innerHTML = `<strong>${tag}: ${res.move.san}</strong> · ${pvLine}`;
    const hb = $('#hintBanner');
    hb.classList.remove('hide');
    hb.style.display = 'flex';
  } finally {
    btn.disabled = false;
    btn.innerHTML = prevHtml;
  }
};

$('#btnUndo').onclick = () => {
  if (!gameActive || mode === 'online' || busy) return;
  if (reviewPly !== null) goToPly(chess.history().length);
  chess.undo();
  if (mode === 'pve' && chess.turn() !== playerSide) chess.undo();
  rebuildBoardPieces();
  renderHistory();
  updateTurnUI();
  refreshEval();
};

let resignArmed = false;
let resignTimer = null;
$('#btnResign').onclick = () => {
  if (!gameActive) return;
  if (!resignArmed) {
    resignArmed = true;
    $('#btnResign').innerHTML = '🏳 <span>CONFIRMAR?</span>';
    clearTimeout(resignTimer);
    resignTimer = setTimeout(() => {
      resignArmed = false;
      $('#btnResign').innerHTML = '🏳 <span>DESISTIR</span>';
    }, 3000);
    return;
  }
  resignArmed = false;
  clearTimeout(resignTimer);
  $('#btnResign').innerHTML = '🏳 <span>DESISTIR</span>';
  if (mode === 'online') online.resign();
  else endGameFromBoard(playerSide === 'w' ? 'b' : 'w', 'Desistência');
};

$('#btnDraw').onclick = () => {
  if (gameActive && mode === 'online') {
    online.offerDraw();
    toast('Proposta de empate enviada');
  }
};
$('#btnDrawYes').onclick = () => { $('#drawBar').style.display = 'none'; online.respondDraw(true); };
$('#btnDrawNo').onclick = () => { $('#drawBar').style.display = 'none'; online.respondDraw(false); };

$('#btnAnalyze').onclick = runPostGameAnalysis;
$('#btnViewBoard').onclick = () => $('#overOverlay').classList.add('hide');
$('#btnRematch').onclick = async () => {
  if (mode === 'online' && !online.game?.spectate) {
    const btn = $('#btnRematch');
    btn.disabled = true;
    try {
      const res = await online.requestRematch();
      const st = $('#rematchStatus');
      st.style.display = 'block';
      if (res?.started) {
        st.textContent = 'Revanche aceita! Iniciando nova partida…';
      } else if (res?.offered) {
        st.textContent = 'Convite de revanche enviado… aguardando oponente.';
        btn.textContent = '⏳ AGUARDANDO OPONENTE';
      }
    } finally {
      btn.disabled = false;
    }
  } else if (mode === 'puzzle') {
    startPuzzleRush();
  } else if (isTowerMatch) {
    startMatch('pve', { isTower: true });
  } else {
    startMatch(mode);
  }
};
$('#btnOverMenu').onclick = () => {
  $('#overOverlay').classList.add('hide');
  $('#menuOverlay').classList.remove('hide');
};

/* Cartão PNG Compartilhável de Resultado */
$('#btnShareResult').onclick = async () => {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 630;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, '#0D0C0A');
  grad.addColorStop(0.5, '#191612');
  grad.addColorStop(1, '#0A0908');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.strokeStyle = '#C99A3E';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, 1128, 558);

  ctx.fillStyle = '#C99A3E';
  ctx.font = 'bold 28px Georgia, serif';
  ctx.fillText('♔ XADREZ ROYALE 3D · EDIÇÃO STAUNTON', 76, 102);

  ctx.fillStyle = '#F3EDE0';
  ctx.font = 'bold 64px Georgia, serif';
  ctx.fillText($('#overTitle').textContent || 'Fim de Partida', 76, 200);

  ctx.fillStyle = '#D4AF37';
  ctx.font = '32px system-ui, sans-serif';
  ctx.fillText(`${lastMatchReason || $('#overSub').textContent} · ${chess.history().length} lances`, 76, 256);

  const wName = $('#nameW').textContent || 'BRANCAS';
  const bName = $('#nameB').textContent || 'PRETAS';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.fillText(`♔ ${wName}   vs   ♚ ${bName}`, 76, 355);

  const op = detectOpening(chess.history());
  if (op) {
    ctx.fillStyle = '#B8AD9E';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(`📖 Abertura: ${op.eco} · ${op.name}`, 76, 425);
  }

  const r = online.profile?.rating || 1200;
  const lg = getLeague(r);
  ctx.fillStyle = lg.color || '#C99A3E';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(`Liga ${lg.name} · Rating ${r} · ${unlockedAch.size}/${ACHIEVEMENTS.length} Conquistas`, 76, 520);

  c.toBlob(async blob => {
    if (!blob) return;
    const file = new File([blob], 'xadrez-royale.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: 'Xadrez Royale 3D', text: `${$('#overTitle').textContent} (${wName} vs ${bName})`, files: [file] });
        return;
      } catch { /* fallback download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xadrez-royale-resultado.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('Cartão da partida salvo em PNG!');
  }, 'image/png');
};

window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'Escape') {
    for (const id of ['settingsOverlay', 'lbOverlay', 'tvOverlay', 'socialOverlay', 'profileOverlay', 'promoModal']) {
      $(`#${id}`)?.classList.add('hide');
    }
    if (premove) clearPremove();
    if (cam.arrowMode) $('#btnArrows').click();
    return;
  }
  if (e.key === 'v' || e.key === 'V') $('#btnView2D').click();
  else if (e.key === 'f' || e.key === 'F') $('#btnFlip').click();
  else if (e.key === 'h' || e.key === 'H') $('#btnHint').click();
  else if (e.key === 'm' || e.key === 'M') $('#btnSound').click();
  else if (e.key === 'ArrowLeft') $('#btnHistPrev').click();
  else if (e.key === 'ArrowRight') $('#btnHistNext').click();
  else if (e.key === 'Home') $('#btnHistFirst').click();
  else if (e.key === 'End') $('#btnHistLast').click();
});

/* Swatches de temas */
BOARD_THEMES.forEach((t, i) => {
  const b = document.createElement('button');
  b.className = 'swatch-btn' + (i === boardThemeIdx ? ' active' : '');
  b.innerHTML = `<span class="swatch-dot" style="background:#${t.dark.toString(16).padStart(6, '0')}"></span>${t.name}`;
  b.onclick = () => applyBoardTheme(i);
  $('#boardSwatches').appendChild(b);
});

PIECE_THEMES.forEach((t, i) => {
  const b = document.createElement('button');
  b.className = 'swatch-btn' + (i === pieceThemeIdx ? ' active' : '');
  b.innerHTML = `<span class="swatch-dot" style="background:#${t.w.toString(16).padStart(6, '0')}"></span>${t.name}`;
  b.onclick = () => applyPieceTheme(i);
  $('#pieceSwatches').appendChild(b);
});

/* ============ ONLINE BINDINGS, TV, SOCIAL & CENTRAL DO JOGADOR ============ */
function refreshTopUserPill() {
  const r = online.profile?.rating || 1200;
  const lg = getLeague(r);
  if ($('#topUserIcon')) $('#topUserIcon').textContent = lg.icon;
  if ($('#topUserNick')) $('#topUserNick').textContent = nick;
  if ($('#topUserElo')) $('#topUserElo').textContent = r;
}

$('#nickInput').value = nick;
refreshTopUserPill();
$('#nickInput').onchange = () => {
  nick = ($('#nickInput').value.trim() || 'JOGADOR').toUpperCase().slice(0, 16);
  $('#nickInput').value = nick;
  savePrefs();
  refreshTopUserPill();
  if (online.ready) online.setName(nick);
};

function formatRatingLeague(r) {
  const lg = getLeague(r);
  return `${lg.icon} Liga ${lg.name} · ${r} Elo${online.isVipDev() ? ' · VIP' : ''}`;
}

let activeChallengeOffer = null;
function setupChallengeListener() {
  online.listenIncomingChallenges(ch => {
    activeChallengeOffer = ch;
    const bar = $('#challengeBar');
    if (!bar) return;
    $('#challengeTxt').textContent = `⚔️ ${ch.fromName} (${ch.fromRating}) desafiou você (${ch.tc?.label || '5+0'})!`;
    bar.style.display = 'flex';
  });
}

$('#btnChallengeYes').onclick = async () => {
  if (!activeChallengeOffer) return;
  const ch = activeChallengeOffer;
  activeChallengeOffer = null;
  $('#challengeBar').style.display = 'none';
  try {
    await online.acceptChallenge(ch);
  } catch (e) {
    toast(e.message || 'Erro ao aceitar desafio');
  }
};
$('#btnChallengeNo').onclick = async () => {
  if (!activeChallengeOffer) return;
  const ch = activeChallengeOffer;
  activeChallengeOffer = null;
  $('#challengeBar').style.display = 'none';
  await online.declineChallenge(ch.id);
};

async function ensureOnline() {
  if (!isFirebaseConfigured) {
    $('#onlineStatus').style.display = 'block';
    $('#onlineStatus').textContent = 'Configure VITE_FIREBASE_* no .env para ativar o modo online.';
    return false;
  }
  if (!onlineInitPromise) {
    $('#onlineStatus').style.display = 'block';
    $('#onlineStatus').textContent = 'Conectando ao servidor…';
    onlineInitPromise = online.init(nick).then(ok => {
      if (ok) {
        $('#onlineStatus').style.display = 'none';
        $('#ratingLine').textContent = formatRatingLeague(online.profile.rating);
        refreshTopUserPill();
        if (online.profile.google) $('#btnGoogle').textContent = '✓ Google Conectado';
        online.updateActive();
        setupChallengeListener();
      } else {
        $('#onlineStatus').textContent = 'Falha ao conectar ao Firebase.';
        onlineInitPromise = null;
      }
      return ok;
    });
  }
  return onlineInitPromise;
}

online.onMatchFound = ({ myColor: mc, opponent, code, data, spectate, moves }) => {
  $('#searchBox').style.display = 'none';
  $('#roomBox').style.display = 'none';
  $('#onlineActions').style.display = 'block';
  onlineTc = data?.tc || onlineTc;
  startMatch('online', { myColor: mc, opponent, tc: onlineTc, code, data, spectate, moves });
  if (spectate) {
    toast(`Assistindo ao vivo: ${data?.white?.name || 'Brancas'} vs ${data?.black?.name || 'Pretas'}`);
  } else {
    toast(`Partida iniciada vs ${opponent?.name || 'Oponente'}`);
  }
};

online.onOpponentMove = entry => {
  executeMove({ from: entry.from, to: entry.to, promotion: entry.promotion || undefined }, true);
};

online.onDrawOffer = () => { $('#drawBar').style.display = 'flex'; };
online.onRematchOffer = () => {
  const st = $('#rematchStatus');
  if (st) {
    st.style.display = 'block';
    st.textContent = '🔥 Seu oponente quer revanche! Clique abaixo para aceitar.';
  }
  const btn = $('#btnRematch');
  if (btn) btn.textContent = '✓ ACEITAR REVANCHE';
};
online.onGameEnd = (winner, reason) => { endGameFromBoard(winner, reason); };
online.onRated = (delta, newRating) => {
  $('#ratingLine').textContent = formatRatingLeague(newRating);
  refreshTopUserPill();
  $('#overDelta').style.display = 'block';
  $('#overDelta').textContent = `${delta >= 0 ? '+' : ''}${delta} Elo (${newRating})`;
};

$('#btnGoogle').onclick = async () => {
  if (!(await ensureOnline())) return;
  try {
    const res = await online.linkGoogle();
    if (res?.linked) {
      toast(res.msg);
      $('#btnGoogle').textContent = '✓ Google Conectado';
      $('#ratingLine').textContent = formatRatingLeague(online.profile.rating);
      refreshTopUserPill();
      updateTurnUI();
      refreshEval();
    }
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') toast('Erro ao conectar Google');
  }
};

$('#btnQuickMatch').onclick = async () => {
  if (!(await ensureOnline())) return;
  $('#onlineActions').style.display = 'none';
  $('#searchBox').style.display = 'block';
  await online.quickMatch(onlineTc);
};
$('#btnCancelSearch').onclick = async () => {
  await online.cancelSearch();
  $('#searchBox').style.display = 'none';
  $('#onlineActions').style.display = 'block';
};
$('#btnCreateRoom').onclick = async () => {
  if (!(await ensureOnline())) return;
  const code = await online.createRoom(onlineTc);
  $('#roomCodeTxt').textContent = code;
  $('#onlineActions').style.display = 'none';
  $('#roomBox').style.display = 'block';
};
$('#btnCopyRoom').onclick = () => {
  const link = `${location.origin}${location.pathname}?room=${$('#roomCodeTxt').textContent}`;
  navigator.clipboard?.writeText(link);
  toast('Link da sala copiado!');
};
$('#btnCancelRoom').onclick = async () => {
  await online.leaveGame();
  $('#roomBox').style.display = 'none';
  $('#onlineActions').style.display = 'block';
};
$('#btnShowJoin').onclick = () => {
  $('#joinBox').style.display = $('#joinBox').style.display === 'none' ? 'block' : 'none';
};
$('#btnJoinRoom').onclick = async () => {
  if (!(await ensureOnline())) return;
  try { await online.joinRoom($('#joinInput').value); }
  catch (e) { toast(e.message || 'Erro ao entrar'); }
};

/* TV Xadrez Royale (Modo Espectador Ao Vivo) */
$('#btnTv').onclick = async () => {
  if (!(await ensureOnline())) return;
  $('#tvOverlay').classList.remove('hide');
  $('#tvList').innerHTML = '<div class="status-msg">Buscando partidas ao vivo…</div>';
  const games = await online.listActiveGames(12);
  if (!games.length) {
    $('#tvList').innerHTML = '<div class="status-msg">Nenhuma partida online em andamento agora.</div>';
    return;
  }
  $('#tvList').innerHTML = games.map(g => {
    const w = g.white?.name || 'Brancas';
    const b = g.black?.name || 'Pretas';
    const wr = g.white?.rating || 1200;
    const br = g.black?.rating || 1200;
    const plies = Array.isArray(g.moves) ? g.moves.length : 0;
    return `<div class="lb-row">
      <div class="row-meta">
        <strong>♔ ${w} (${wr}) vs ♚ ${b} (${br})</strong>
        <small>${g.tc?.label || '5+0'} · ${plies} lances</small>
      </div>
      <button class="btn-secondary btn-mini" data-watch="${g.id}">📺 Assistir</button>
    </div>`;
  }).join('');
  $('#tvList').querySelectorAll('[data-watch]').forEach(btn => {
    btn.onclick = async () => {
      try {
        await online.spectateGame(btn.dataset.watch);
      } catch (e) {
        toast(e.message || 'Não foi possível assistir');
      }
    };
  });
};
$('#btnCloseTv').onclick = () => $('#tvOverlay').classList.add('hide');

/* ============ CENTRAL DO JOGADOR UNIFICADA (PERFIL + AMIGOS + RANKING) ============ */
function renderUserOverview() {
  const r = online.profile?.rating || 1200;
  const lg = getLeague(r);
  const games = online.profile?.games || 0;
  const wins = online.profile?.wins || 0;
  refreshTopUserPill();
  if ($('#profBadgeIcon')) $('#profBadgeIcon').textContent = lg.icon;
  if ($('#profTitle')) $('#profTitle').textContent = nick;
  const banner = $('#profLeagueBanner');
  if (banner) {
    banner.innerHTML = `${lg.icon} <strong>Liga ${lg.name}</strong> · ${r} Elo${online.isVipDev() ? ' · 👑 VIP' : ''}`;
  }
  const span = lg.max === Infinity ? 1 : Math.max(1, lg.max - lg.min + 1);
  const pct = lg.max === Infinity ? 100 : Math.min(100, Math.max(6, Math.round(((r - lg.min) / span) * 100)));
  if ($('#profLeagueCurr')) $('#profLeagueCurr').textContent = `${lg.icon} Liga ${lg.name} (${lg.min}+ Elo)`;
  if ($('#profLeagueNext')) {
    $('#profLeagueNext').textContent = lg.max === Infinity ? '⚜️ Nível Máximo!' : `Próxima: ${lg.max + 1} Elo`;
  }
  if ($('#profLeagueFill')) $('#profLeagueFill').style.width = `${pct}%`;

  const stats = $('#profStatsGrid');
  if (stats) {
    stats.innerHTML = `
      <div class="stat-box"><strong>${r}</strong><small>Rating Elo</small></div>
      <div class="stat-box"><strong>${games} (${wins}V)</strong><small>Partidas Online</small></div>
      <div class="stat-box"><strong>Andar ${towerRun.bestFloor}/8</strong><small>Torre Royale (${towerRun.clears}👑)</small></div>
      <div class="stat-box"><strong>${solvedPuzzles.size}/20 · 🔥${puzzleRush.bestScore}</strong><small>Puzzles & Rush</small></div>
    `;
  }
  if ($('#achGrid')) {
    $('#achGrid').innerHTML = ACHIEVEMENTS.map(a => {
      const unlocked = unlockedAch.has(a.id);
      return `<div class="ach-card ${unlocked ? 'unlocked' : ''}">
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-meta">
          <strong>${a.name} ${unlocked ? '✓' : ''}</strong>
          <small>${a.desc}</small>
        </div>
      </div>`;
    }).join('');
  }
}

async function loadSocialTab() {
  $('#onlinePlayersList').innerHTML = '<div class="status-msg">Carregando jogadores…</div>';
  $('#friendsList').innerHTML = '<div class="status-msg">Carregando amigos…</div>';
  if (!(await ensureOnline())) {
    $('#onlinePlayersList').innerHTML = '<div class="status-msg">Conecte-se ao modo online para ver jogadores ativos.</div>';
    $('#friendsList').innerHTML = '<div class="status-msg">Modo online indisponível.</div>';
    return;
  }
  await online.updateActive();
  const [players, friends] = await Promise.all([
    online.listOnlinePlayers(15),
    online.listFriends()
  ]);
  const friendIds = new Set(friends.map(f => f.uid));

  const renderChallengeHandlers = root => {
    root.querySelectorAll('[data-challenge]').forEach(btn => {
      btn.onclick = async () => {
        const target = {
          uid: btn.dataset.challenge,
          name: btn.dataset.name,
          rating: Number(btn.dataset.rating) || 1200
        };
        btn.disabled = true;
        btn.textContent = '⏳ Enviado';
        try {
          const chId = await online.sendChallenge(target, onlineTc);
          toast(`Desafio enviado para ${target.name}!`);
          online.listenOutgoingChallenge(chId, async ch => {
            if (ch.status === 'accepted' && ch.gameId) {
              $('#profileOverlay').classList.add('hide');
              await online.joinChallengeAsWhite(ch);
            } else if (ch.status === 'declined') {
              toast(`${target.name} recusou o desafio.`);
            }
          });
        } catch {
          toast('Falha ao enviar desafio');
        }
      };
    });
    root.querySelectorAll('[data-friend]').forEach(btn => {
      btn.onclick = async () => {
        const target = {
          uid: btn.dataset.friend,
          name: btn.dataset.name,
          rating: Number(btn.dataset.rating) || 1200
        };
        await online.addFriend(target);
        btn.disabled = true;
        btn.textContent = '✓ Amigo';
        toast(`${target.name} adicionado aos amigos!`);
      };
    });
  };

  $('#onlinePlayersList').innerHTML = players.map(p => {
    const lg = getLeague(p.rating || 1200);
    const isFr = friendIds.has(p.uid);
    return `<div class="lb-row">
      <div class="row-meta">
        <strong>${lg.icon} ${p.name}</strong>
        <small>${p.rating || 1200} Elo</small>
      </div>
      <div class="row-actions">
        <button class="btn-secondary btn-mini" data-challenge="${p.uid}" data-name="${p.name}" data-rating="${p.rating || 1200}">⚔️ Desafiar</button>
        ${isFr ? '' : `<button class="btn-secondary btn-mini" data-friend="${p.uid}" data-name="${p.name}" data-rating="${p.rating || 1200}">+ Amigo</button>`}
      </div>
    </div>`;
  }).join('') || '<div class="status-msg">Nenhum outro jogador online no momento.</div>';

  $('#friendsList').innerHTML = friends.map(f => {
    const lg = getLeague(f.rating || 1200);
    return `<div class="lb-row">
      <div class="row-meta">
        <strong>${lg.icon} ${f.name}</strong>
        <small>${f.rating || 1200} Elo</small>
      </div>
      <div class="row-actions">
        <button class="btn-secondary btn-mini" data-challenge="${f.uid}" data-name="${f.name}" data-rating="${f.rating || 1200}">⚔️ Desafiar</button>
      </div>
    </div>`;
  }).join('') || '<div class="status-msg">Adicione jogadores da lista acima para desafiar rapidamente.</div>';

  renderChallengeHandlers($('#onlinePlayersList'));
  renderChallengeHandlers($('#friendsList'));
}

async function loadRankingTab() {
  $('#lbList').innerHTML = '<div class="status-msg">Carregando…</div>';
  if (!(await ensureOnline())) {
    $('#lbList').innerHTML = '<div class="status-msg">Conecte-se ao modo online para carregar o Top 10.</div>';
    return;
  }
  const list = await online.leaderboard(10);
  $('#lbList').innerHTML = list.map((p, i) => {
    const lg = getLeague(p.rating || 1200);
    return `<div class="lb-row"><span>${i + 1}. ${lg.icon} ${p.name}</span><strong>${p.rating} Elo</strong></div>`;
  }).join('') || '<div class="status-msg">Nenhum jogador no ranking ainda.</div>';
}

function openUserHub(tab = 'overview') {
  renderUserOverview();
  $$('#userHubTabs .studio-tab').forEach(b => b.classList.toggle('active', b.dataset.utab === tab));
  ['overview', 'social', 'ranking'].forEach(k => {
    const pane = $(`#utab-${k}`);
    if (pane) pane.classList.toggle('hide', k !== tab);
  });
  $('#profileOverlay').classList.remove('hide');
  if (tab === 'social') loadSocialTab();
  else if (tab === 'ranking') loadRankingTab();
}

$$('#userHubTabs .studio-tab').forEach(btn => {
  btn.onclick = () => {
    audio.click();
    openUserHub(btn.dataset.utab);
  };
});

if ($('#btnTopUser')) $('#btnTopUser').onclick = () => { audio.click(); openUserHub('overview'); };
$('#btnProfile').onclick = () => { audio.click(); openUserHub('overview'); };
$('#btnSocial').onclick = () => { audio.click(); openUserHub('social'); };
$('#btnLeaderboard').onclick = () => { audio.click(); openUserHub('ranking'); };
$('#btnCloseProfile').onclick = () => $('#profileOverlay').classList.add('hide');
if ($('#btnCloseSocial')) $('#btnCloseSocial').onclick = () => $('#socialOverlay').classList.add('hide');
if ($('#btnCloseLb')) $('#btnCloseLb').onclick = () => $('#lbOverlay').classList.add('hide');


/* ============ LOOP PRINCIPAL & FPS ADAPTATIVO ============ */
applyBoardTheme(boardThemeIdx);
rebuildBoardPieces();
animatePiecesIntro(pieceMeshes);
resize();
cam.resetView('w');

window.addEventListener('resize', () => {
  resize();
  const need = cam.fitRadius();
  if (cam.radius < need) { cam.radius = need; cam.sync(); }
});

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  document.querySelector('#segMode .seg[data-val="online"]')?.click();
  ensureOnline().then(ok => {
    if (ok) online.joinRoom(roomParam).catch(e => toast(e.message));
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const clock = new THREE.Clock();
let prevT = 0;
let fpsFrames = 0, fpsAccum = 0, lowFpsStrikes = 0;

(function loop() {
  requestAnimationFrame(loop);
  const t = clock.getElapsedTime();
  const dt = t - prevT;
  prevT = t;

  if (gameActive && mode === 'botvsbot' && botOrbitEnabled && !cam.dragging) {
    cam.theta += dt * 0.22;
    cam.sync();
  }

  if (gameActive && mode === 'puzzle' && puzzleRush.active) {
    const rTick = puzzleRush.tick(dt * 1000);
    if ($('#rushTimerTxt')) $('#rushTimerTxt').textContent = formatClock(rTick.remainingMs);
    if (rTick.timeUp) {
      finishPuzzleRush('Tempo de 3 minutos esgotado!');
    }
  }

  if (gameActive && clockW !== null && clockB !== null) {
    const ms = dt * 1000;
    if (chess.turn() === 'w') clockW -= ms; else clockB -= ms;
    updateClocksUI();
    const active = chess.turn() === 'w' ? clockW : clockB;
    if (active <= 0) {
      if (mode === 'online' && chess.turn() !== myColor && !online.game?.spectate) online.claimTimeout();
      else if (!online.game?.spectate) endGameFromBoard(chess.turn() === 'w' ? 'b' : 'w', 'Tempo esgotado');
    } else if (active <= 15000) {
      const sec = Math.ceil(active / 1000);
      if (sec !== lastTickSec) { audio.tick(); lastTickSec = sec; }
    }
  }


  if (!document.hidden && gameActive && dt > 0 && dt < 0.25 && qualityTier !== 'low') {
    fpsFrames++;
    fpsAccum += dt;
    if (fpsAccum >= 1.5) {
      const avg = fpsFrames / fpsAccum;
      fpsFrames = 0;
      fpsAccum = 0;
      if (avg < 32) {
        lowFpsStrikes++;
        if (lowFpsStrikes >= 2) {
          lowFpsStrikes = 0;
          qualityTier = qualityTier === 'high' ? 'medium' : 'low';
          applyQualityTier(qualityTier, {
            renderer,
            lights,
            fx,
            materials,
            boardTheme: BOARD_THEMES[boardThemeIdx],
            board: boardCtx,
            pieces: { pieceMeshes, capturedMeshes, geos, theme: PIECE_THEMES[pieceThemeIdx], style: pieceStyle }
          });
          toast(qualityTier === 'low' ? 'Modo desempenho ativado' : 'Qualidade ajustada para 60fps');
        }
      } else {
        lowFpsStrikes = 0;
      }
    }
  }

  fx.update(t, Math.min(dt, 0.05));
  if (!document.hidden) renderer.render(scene, camera);
})();
