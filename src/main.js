/* ============================================================
   XADREZ ROYALE — Orquestrador Principal
   Modos: Contra Máquina (Web Worker) · 2 Jogadores · Online (Firebase)
   ============================================================ */

import * as THREE from 'three';
import { Chess } from 'chess.js';
import { squareToRC, rcToSquare, evaluateBoard } from './core/chess-engine.js';
import { AudioManager } from './core/audio.js';
import { formatClock } from './core/elo.js';
import { BOARD_THEMES, PIECE_THEMES } from './engine/themes.js';
import { applyQualityTier } from './engine/quality.js';
import { createScene } from './engine/scene.js';
import { createBoard, getBoardTexture, worldPos } from './engine/board3d.js';
import { createChessGeometries, makeChessPiece, animatePieceMove } from './engine/pieces3d.js';
import { FXManager } from './engine/fx.js';
import { CameraController } from './engine/camera.js';
import { OnlineManager, isFirebaseConfigured } from './online/firebase.js';

const $ = sel => document.querySelector(sel);

const PREFS_KEY = 'xadrezRoyale.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
const prefs = loadPrefs();

/* ============ ESTADO ============ */
const chess = new Chess();
let mode = 'pve';           /* 'pve' | 'pvp' | 'online' */
let aiDepth = prefs.aiDepth ?? 2;
let playerSide = 'w';
let myColor = 'w';
let localTimeLimit = 0;     /* ms (0 = livre) */
let onlineTc = { base: 180000, inc: 2000, label: '3+2' };
let clockW = null, clockB = null;
let lastTickSec = -1;
let gameActive = false;
let busy = false;
let selectedSq = null;      /* 'e2' */
let legalFromSelected = []; /* verbose moves */
let boardThemeIdx = prefs.boardTheme ?? 0;
let pieceThemeIdx = prefs.pieceTheme ?? 0;
let evalVisible = !!prefs.evalVisible;
let nick = prefs.nick || 'JOGADOR';
let pendingPromo = null;    /* { from, to, resolve } */
let grid = Array.from({ length: 8 }, () => Array(8).fill(null));
let pieceMeshes = [];
let capturedMeshes = [];
let capTrayCount = { w: 0, b: 0 };
let capturedSymbols = { w: '', b: '' };

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      boardTheme: boardThemeIdx,
      pieceTheme: pieceThemeIdx,
      aiDepth,
      evalVisible,
      muted: audio.muted,
      nick
    }));
  } catch { /* noop */ }
}

/* ============ CENA 3D & ADAPTIVE QUALITY ============ */
const canvas = $('#c3d');
const { scene, camera, renderer, materials, lights, qualityTier: initTier, resize } = createScene(canvas);
let qualityTier = initTier;
const { squares } = createBoard(scene, materials);
const geos = createChessGeometries(qualityTier);
const fx = new FXManager(scene);
fx.setQuality(qualityTier);
const cam = new CameraController(canvas, camera);
const audio = new AudioManager();
audio.muted = !!prefs.muted;
$('#btnSound').textContent = audio.muted ? '🔇' : '🔊';

/* ============ WEB WORKER IA ============ */
const aiWorker = new Worker(new URL('./workers/ai.worker.js', import.meta.url), { type: 'module' });
let workerReqId = 0;
const workerWaiters = new Map();
aiWorker.onmessage = e => {
  const { id, ...rest } = e.data;
  const resolve = workerWaiters.get(id);
  if (resolve) { workerWaiters.delete(id); resolve(rest); }
};
function askWorker(type, fen, depth = 2) {
  return new Promise(resolve => {
    const id = ++workerReqId;
    workerWaiters.set(id, resolve);
    aiWorker.postMessage({ id, type, fen, depth });
  });
}

/* ============ ONLINE ============ */
const online = new OnlineManager();
let onlineInitPromise = null;

function canUseHint() {
  if (!gameActive) return false;
  if (mode !== 'online') return true;
  return online.isVipDev();
}

function canShowEval() {
  if (mode === 'online') return evalVisible && online.isVipDev();
  return evalVisible;
}

/* ============ TOAST ============ */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ============ TEMAS ============ */
function applyBoardTheme(i) {
  boardThemeIdx = i;
  const t = BOARD_THEMES[i] || BOARD_THEMES[0];
  const tex = getBoardTexture(t.tex);
  materials.lightSq.color.set(t.light);
  materials.darkSq.color.set(t.dark);
  materials.frame.color.set(t.frame);
  materials.table.color.set(t.table);
  materials.lightSq.map = tex;
  materials.darkSq.map = tex;
  materials.frame.map = tex;
  materials.lightSq.needsUpdate = true;
  materials.darkSq.needsUpdate = true;
  materials.frame.needsUpdate = true;
  scene.background = new THREE.Color(t.bg);
  document.querySelectorAll('#boardSwatches .swatch-btn').forEach((b, idx) => b.classList.toggle('active', idx === i));
  savePrefs();
}

function applyPieceTheme(i) {
  pieceThemeIdx = i;
  rebuildBoardPieces();
  document.querySelectorAll('#pieceSwatches .swatch-btn').forEach((b, idx) => b.classList.toggle('active', idx === i));
  savePrefs();
}

/* ============ PEÇAS 3D ============ */
function clearAllPieces() {
  for (const p of pieceMeshes) {
    scene.remove(p.mesh);
    if (p.mesh.material) p.mesh.material.dispose();
  }
  for (const m of capturedMeshes) {
    scene.remove(m);
    if (m.material) m.material.dispose();
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
  const tok = makeChessPiece(scene, geos, type, color, 0, 0, th, qualityTier);
  const side = color === 'w' ? -1 : 1;
  const n = capTrayCount[color]++;
  const col = Math.floor(n / 8);
  const row = n % 8;
  tok.mesh.position.set(side * (5.1 + col * 0.72), -0.35, (row - 3.5) * 0.85);
  tok.mesh.scale.setScalar(0.75);
  capturedMeshes.push(tok.mesh);
}

function rebuildBoardPieces() {
  const prevCaptured = [...capturedMeshes];
  for (const p of pieceMeshes) {
    scene.remove(p.mesh);
    if (p.mesh.material) p.mesh.material.dispose();
  }
  pieceMeshes = [];
  grid = Array.from({ length: 8 }, () => Array(8).fill(null));

  const th = PIECE_THEMES[pieceThemeIdx];
  const b = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = b[r][c];
      if (!cell) continue;
      const p = makeChessPiece(scene, geos, cell.type, cell.color, r, c, th, qualityTier);
      grid[r][c] = p;
      pieceMeshes.push(p);
    }
  }
  capturedMeshes = prevCaptured;
}

/* ============ UI UPDATES ============ */
function updateTurnUI() {
  const turn = chess.turn();
  $('#turnDot').classList.toggle('black', turn === 'b');
  $('#turnTxt').textContent = turn === 'w' ? 'VEZ DAS BRANCAS' : 'VEZ DAS PRETAS';
  $('#turnSub').style.display = chess.inCheck() ? 'inline' : 'none';
  $('#turnSub').textContent = chess.inCheck() ? '· XEQUE!' : '';
  $('#cardW').classList.toggle('active', gameActive && turn === 'w');
  $('#cardB').classList.toggle('active', gameActive && turn === 'b');

  if (chess.inCheck()) {
    const b = chess.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (b[r][c]?.type === 'k' && b[r][c]?.color === turn) fx.setCheckSquare(r, c);
    }
  } else {
    fx.clearCheckSquare();
  }

  $('#btnHint').style.display = canUseHint() ? 'flex' : 'none';
  $('#btnUndo').style.display = (gameActive && mode !== 'online' && chess.history().length > 0) ? 'flex' : 'none';
  $('#btnDraw').style.display = (gameActive && mode === 'online') ? 'flex' : 'none';
  $('#btnResign').style.display = (gameActive && mode !== 'pvp') ? 'flex' : 'none';
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

function renderHistory() {
  const list = $('#histList');
  const hist = chess.history();
  list.innerHTML = '';
  for (let i = 0; i < hist.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    row.innerHTML = `<span class="hist-num">${i / 2 + 1}.</span><span>${hist[i]}</span><span>${hist[i + 1] || ''}</span>`;
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

async function refreshEval() {
  const show = canShowEval();
  $('#evalWrap').style.display = show ? 'flex' : 'none';
  if (!show) return;
  const res = await askWorker('evaluate', chess.fen());
  if (!res.ok) return;
  const cp = res.cp;
  const pct = Math.max(5, Math.min(95, 50 + (cp / 800) * 45));
  $('#evalFill').style.height = `${pct}%`;
  const pawns = (cp / 100).toFixed(1);
  $('#evalNum').textContent = cp >= 0 ? `+${pawns}` : pawns;
}

/* ============ SELEÇÃO & EXECUÇÃO DE LANCE ============ */
function deselect() {
  if (selectedSq) {
    const { r, c } = squareToRC(selectedSq);
    const p = grid[r][c];
    if (p) {
      p.mesh.position.y = 0;
      p.mesh.material.emissive.set(0x000000);
      p.mesh.material.emissiveIntensity = 0;
    }
  }
  selectedSq = null;
  legalFromSelected = [];
  fx.clearIndicators();
}

function selectSquare(sq) {
  const { r, c } = squareToRC(sq);
  const p = grid[r][c];
  if (!p || p.color !== chess.turn()) return;
  deselect();
  const moves = chess.moves({ square: sq, verbose: true });
  if (moves.length === 0) {
    audio.error();
    return;
  }
  selectedSq = sq;
  legalFromSelected = moves;
  p.mesh.position.y = 0.14;
  p.mesh.material.emissive.set(0xC99A3E);
  p.mesh.material.emissiveIntensity = 0.35;
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

  const moverColor = chess.turn();
  const move = chess.move(moveInput);
  if (!move) { busy = false; return false; }

  const fromRC = squareToRC(move.from);
  const toRC = squareToRC(move.to);
  const piece = grid[fromRC.r][fromRC.c];

  /* Captura normal ou en passant */
  if (move.captured) {
    const capR = move.flags.includes('e') ? fromRC.r : toRC.r;
    const capC = toRC.c;
    const victim = grid[capR][capC];
    if (victim) {
      grid[capR][capC] = null;
      scene.remove(victim.mesh);
      pieceMeshes = pieceMeshes.filter(x => x !== victim);
      if (victim.mesh.material) victim.mesh.material.dispose();
      addCapturedToken(victim.type, victim.color);
      fx.spawnParticles(capR, capC, PIECE_THEMES[pieceThemeIdx][victim.color]);
    }
  }

  grid[fromRC.r][fromRC.c] = null;
  grid[toRC.r][toRC.c] = piece;
  await animatePieceMove(piece, toRC.r, toRC.c, move.piece === 'n');

  /* Roque: move a torre também */
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
  } else if (move.captured) {
    audio.capture();
  } else {
    audio.move();
  }

  /* Promoção: troca geometria para Dama/Torre/Bispo/Cavalo */
  if (move.promotion) {
    piece.type = move.promotion;
    piece.mesh.geometry = geos[move.promotion];
    audio.promote();
    fx.spawnParticles(toRC.r, toRC.c, 0xC99A3E, 18);
  }

  if (chess.inCheck()) audio.check();
  fx.setLastMove(fromRC.r, fromRC.c, toRC.r, toRC.c);
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

  if (chess.isGameOver()) {
    endGameFromBoard();
    return true;
  }

  if (mode === 'pvp') {
    cam.flipBoard();
  } else if (mode === 'pve' && chess.turn() !== playerSide) {
    runAIMove();
  }
  return true;
}

async function runAIMove() {
  if (!gameActive || chess.isGameOver()) return;
  $('#turnTxt').textContent = 'MÁQUINA PENSANDO…';
  const res = await askWorker('bestMove', chess.fen(), aiDepth);
  if (!gameActive || !res.ok || !res.move) return;
  await executeMove(res.move);
}

function endGameFromBoard(customWinner = null, customReason = '') {
  gameActive = false;
  let winner = customWinner;
  let reason = customReason;

  if (!winner) {
    if (chess.isCheckmate()) {
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

  audio.win();
  $('#overTitle').textContent = winner === 'draw' ? 'Empate' : (winner === 'w' ? 'Brancas Vencem' : 'Pretas Vencem');
  $('#overSub').textContent = reason;
  $('#overDelta').style.display = 'none';
  $('#overOverlay').classList.remove('hide');

  if (mode === 'online' && !customWinner) {
    online.finishGame(winner, reason);
  }
}

/* ============ INTERAÇÃO NO TABULEIRO (RAYCASTER) ============ */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();

cam.onTap = async (cx, cy) => {
  if (!gameActive || busy) return;
  if (mode === 'pve' && chess.turn() !== playerSide) return;
  if (mode === 'online' && chess.turn() !== myColor) return;

  const rect = canvas.getBoundingClientRect();
  ptr.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ptr.y = -((cy - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ptr, camera);

  const pieceHits = ray.intersectObjects(pieceMeshes.map(p => p.mesh), false);
  const sqHits = ray.intersectObjects(squares, false);

  let hitSq = null;
  if (pieceHits.length) {
    const p = pieceHits[0].object.userData.piece;
    hitSq = rcToSquare(p.r, p.c);
  } else if (sqHits.length) {
    const { r, c } = sqHits[0].object.userData;
    hitSq = rcToSquare(r, c);
  }
  if (!hitSq) { deselect(); return; }

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

/* Hover tátil no desktop */
let hoveredPiece = null;
if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
  canvas.addEventListener('pointermove', e => {
    if (!gameActive || busy || cam.dragging || qualityTier === 'low') {
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
    const hits = ray.intersectObjects(pieceMeshes.filter(p => p.color === chess.turn()).map(p => p.mesh), false);
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

/* ============ INICIALIZAÇÃO DE PARTIDA ============ */
function startMatch(newMode, opts = {}) {
  mode = newMode;
  chess.reset();
  clearAllPieces();
  capturedSymbols = { w: '', b: '' };
  $('#capsW').textContent = '';
  $('#capsB').textContent = '';
  fx.clearIndicators();
  fx.clearLastMove();
  fx.clearCheckSquare();
  rebuildBoardPieces();
  renderHistory();

  if (mode === 'online') {
    myColor = opts.myColor || 'w';
    const oppName = opts.opponent?.name || 'OPONENTE';
    const myName = online.profile?.name || nick;
    $('#nameW').textContent = myColor === 'w' ? myName : oppName;
    $('#nameB').textContent = myColor === 'b' ? myName : oppName;
    clockW = opts.tc?.base || 300000;
    clockB = opts.tc?.base || 300000;
    cam.resetView(myColor);
  } else {
    myColor = playerSide;
    $('#nameW').textContent = mode === 'pve' && playerSide === 'b' ? 'MÁQUINA' : 'BRANCAS';
    $('#nameB').textContent = mode === 'pve' && playerSide === 'w' ? 'MÁQUINA' : 'PRETAS';
    clockW = localTimeLimit > 0 ? localTimeLimit : null;
    clockB = localTimeLimit > 0 ? localTimeLimit : null;
    cam.resetView(mode === 'pve' ? playerSide : 'w');
  }

  gameActive = true;
  busy = false;
  $('#menuOverlay').classList.add('hide');
  $('#overOverlay').classList.add('hide');
  updateClocksUI();
  updateTurnUI();
  refreshEval();

  if (mode === 'pve' && playerSide === 'b') {
    runAIMove();
  }
}

/* ============ BINDINGS DE UI ============ */
function bindSeg(sel, cb) {
  const root = $(sel);
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
  $('#localOpts').style.display = isOnline ? 'none' : 'block';
  $('#onlineOpts').style.display = isOnline ? 'block' : 'none';
  $('#diffRow').style.display = v === 'pve' ? 'flex' : 'none';
  $('#sideRow').style.display = v === 'pve' ? 'flex' : 'none';
  mode = v;
  if (isOnline) ensureOnline();
});

bindSeg('#segDiff', v => { aiDepth = Number(v); savePrefs(); });
bindSeg('#segSide', v => { playerSide = v; });
bindSeg('#segTcLocal', v => { localTimeLimit = Number(v); });
bindSeg('#segTcOnline', v => {
  const [m, inc] = v.split('+').map(Number);
  onlineTc = { base: m * 60000, inc: inc * 1000, label: v };
});
bindSeg('#segEval', v => { evalVisible = v === '1'; savePrefs(); refreshEval(); });

$('#btnStartLocal').onclick = () => startMatch(mode === 'pvp' ? 'pvp' : 'pve');
$('#btnNewMenu').onclick = () => $('#menuOverlay').classList.remove('hide');
$('#btnHome').onclick = () => $('#menuOverlay').classList.remove('hide');
$('#btnView2D').onclick = async () => {
  const is2D = await cam.toggleTopDown();
  $('#btnView2D').classList.toggle('active', is2D);
};
$('#btnFlip').onclick = () => cam.flipBoard();
$('#btnSound').onclick = () => {
  audio.muted = !audio.muted;
  $('#btnSound').textContent = audio.muted ? '🔇' : '🔊';
  savePrefs();
};
$('#btnSettings').onclick = () => $('#settingsOverlay').classList.remove('hide');
$('#btnCloseSettings').onclick = () => $('#settingsOverlay').classList.add('hide');

$('#btnHint').onclick = async () => {
  if (!canUseHint() || busy) return;
  const res = await askWorker('bestMove', chess.fen(), 3);
  if (!res.ok || !res.move) return;
  const f = squareToRC(res.move.from), t = squareToRC(res.move.to);
  fx.setLastMove(f.r, f.c, t.r, t.c);
  toast(`Sugestão: ${res.move.san}`);
};

$('#btnUndo').onclick = () => {
  if (!gameActive || mode === 'online' || busy) return;
  chess.undo();
  if (mode === 'pve' && chess.turn() !== playerSide) chess.undo();
  rebuildBoardPieces();
  renderHistory();
  updateTurnUI();
  refreshEval();
};

$('#btnResign').onclick = () => {
  if (!gameActive) return;
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

$('#btnRematch').onclick = () => {
  if (mode === 'online') {
    $('#overOverlay').classList.add('hide');
    $('#menuOverlay').classList.remove('hide');
  } else {
    startMatch(mode);
  }
};
$('#btnOverMenu').onclick = () => {
  $('#overOverlay').classList.add('hide');
  $('#menuOverlay').classList.remove('hide');
};

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

/* ============ ONLINE BINDINGS ============ */
$('#nickInput').value = nick;
$('#nickInput').onchange = () => {
  nick = ($('#nickInput').value.trim() || 'JOGADOR').toUpperCase().slice(0, 16);
  $('#nickInput').value = nick;
  savePrefs();
  if (online.ready) online.setName(nick);
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
        $('#ratingLine').textContent = `Rating: ${online.profile.rating}${online.isVipDev() ? ' · VIP' : ''}`;
        if (online.profile.google) $('#btnGoogle').textContent = '✓ Google Conectado';
      } else {
        $('#onlineStatus').textContent = 'Falha ao conectar ao Firebase.';
        onlineInitPromise = null;
      }
      return ok;
    });
  }
  return onlineInitPromise;
}

online.onMatchFound = ({ myColor: mc, opponent, code, data }) => {
  $('#searchBox').style.display = 'none';
  $('#roomBox').style.display = 'none';
  $('#onlineActions').style.display = 'block';
  onlineTc = data.tc || onlineTc;
  startMatch('online', { myColor: mc, opponent, tc: onlineTc, code });
  toast(`Partida iniciada vs ${opponent?.name || 'Oponente'}`);
};

online.onOpponentMove = entry => {
  executeMove({ from: entry.from, to: entry.to, promotion: entry.promotion || undefined }, true);
};

online.onDrawOffer = () => { $('#drawBar').style.display = 'flex'; };
online.onGameEnd = (winner, reason) => { endGameFromBoard(winner, reason); };
online.onRated = (delta, newRating) => {
  $('#ratingLine').textContent = `Rating: ${newRating}${online.isVipDev() ? ' · VIP' : ''}`;
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
      $('#ratingLine').textContent = `Rating: ${online.profile.rating}${online.isVipDev() ? ' · VIP' : ''}`;
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
$('#btnLeaderboard').onclick = async () => {
  if (!(await ensureOnline())) return;
  $('#lbOverlay').classList.remove('hide');
  $('#lbList').innerHTML = '<div class="status-msg">Carregando…</div>';
  const list = await online.leaderboard(10);
  $('#lbList').innerHTML = list.map((p, i) =>
    `<div class="lb-row"><span>${i + 1}. ${p.name}</span><strong>${p.rating}</strong></div>`
  ).join('') || '<div class="status-msg">Nenhum jogador no ranking ainda.</div>';
};
$('#btnCloseLb').onclick = () => $('#lbOverlay').classList.add('hide');

/* ============ LOOP PRINCIPAL & FPS ADAPTATIVO ============ */
applyBoardTheme(boardThemeIdx);
rebuildBoardPieces();
resize();
cam.resetView('w');

window.addEventListener('resize', () => {
  resize();
  const need = cam.fitRadius();
  if (cam.radius < need) { cam.radius = need; cam.sync(); }
});

/* Auto-join por ?room=CODIGO */
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  document.querySelector('#segMode .seg[data-val="online"]')?.click();
  ensureOnline().then(ok => {
    if (ok) online.joinRoom(roomParam).catch(e => toast(e.message));
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

  /* Relógio da partida */
  if (gameActive && clockW !== null && clockB !== null) {
    const ms = dt * 1000;
    if (chess.turn() === 'w') clockW -= ms; else clockB -= ms;
    updateClocksUI();
    const active = chess.turn() === 'w' ? clockW : clockB;
    if (active <= 0) {
      if (mode === 'online' && chess.turn() !== myColor) online.claimTimeout();
      else endGameFromBoard(chess.turn() === 'w' ? 'b' : 'w', 'Tempo esgotado');
    } else if (active <= 15000) {
      const sec = Math.ceil(active / 1000);
      if (sec !== lastTickSec) { audio.tick(); lastTickSec = sec; }
    }
  }

  /* Monitoramento de FPS para PC fraco / celular */
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
          applyQualityTier(qualityTier, { renderer, lights, fx });
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
