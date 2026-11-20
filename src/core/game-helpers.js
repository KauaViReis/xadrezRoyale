/* ============================================================
   XADREZ ROYALE — Helpers Puros de Estado, Análise e Premove
   Compatível com Node.js (ESM) e Browser/Web Worker (zero DOM).
   ============================================================ */

import { Chess } from 'chess.js';
import { squareToRC } from './chess-engine.js';

const CAPTURE_ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4 };
const MATERIAL_PTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const WIN_PROB_K = 0.00368208;
const SQUARE_RE = /^[a-h][1-8]$/;

export const MOVE_CLASSIFICATIONS = {
  brilliant:  { code: 'brilliant',  symbol: '!!', label: 'Brilhante',  color: '#26C2A3' },
  best:       { code: 'best',       symbol: '★',  label: 'Melhor',     color: '#81B64C' },
  excellent:  { code: 'excellent',  symbol: '✓',  label: 'Excelente',  color: '#96BC4B' },
  good:       { code: 'good',       symbol: '•',  label: 'Bom',        color: '#A3B899' },
  inaccuracy: { code: 'inaccuracy', symbol: '?!', label: 'Imprecisão', color: '#F7C631' },
  mistake:    { code: 'mistake',    symbol: '?',  label: 'Erro',       color: '#E58F2A' },
  blunder:    { code: 'blunder',    symbol: '??', label: 'Capivarada', color: '#CA3431' },
  book:       { code: 'book',       symbol: '📖', label: 'Livro',      color: '#A88B6A' }
};

export function reconstructStateAtPly(historyVerbose = [], ply = undefined, initialFen = undefined) {
  const moves = Array.isArray(historyVerbose) ? historyVerbose : [];
  const rawPly = Number.isFinite(ply) ? Math.trunc(ply) : moves.length;
  const targetPly = Math.max(0, Math.min(moves.length, rawPly));

  const c = initialFen ? new Chess(initialFen) : new Chess();
  const capturedByWhite = [];
  const capturedByBlack = [];
  let lastExecuted = null;

  for (let i = 0; i < targetPly; i++) {
    const m = moves[i];
    const played = typeof m === 'string'
      ? c.move(m)
      : c.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
    if (!played) {
      throw new Error(`Invalid move at ply ${i + 1}: ${JSON.stringify(m)}`);
    }
    lastExecuted = played;
    if (played.captured) {
      if (played.color === 'w') capturedByWhite.push(played.captured);
      else capturedByBlack.push(played.captured);
    }
  }

  capturedByWhite.sort((a, b) => (CAPTURE_ORDER[a] ?? 9) - (CAPTURE_ORDER[b] ?? 9));
  capturedByBlack.sort((a, b) => (CAPTURE_ORDER[a] ?? 9) - (CAPTURE_ORDER[b] ?? 9));

  const board = c.board();
  let materialDiff = 0;
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 8; col++) {
      const sq = board[r][col];
      if (!sq) continue;
      const pts = MATERIAL_PTS[sq.type] || 0;
      materialDiff += sq.color === 'w' ? pts : -pts;
    }
  }

  return {
    ply: targetPly,
    fen: c.fen(),
    board,
    capturedByWhite,
    capturedByBlack,
    materialDiff,
    lastMove: lastExecuted ? { from: lastExecuted.from, to: lastExecuted.to } : null,
    inCheck: c.inCheck(),
    turn: c.turn()
  };
}

export function cpToWinProb(cp, mateIn = null) {
  if (Number.isFinite(mateIn) && mateIn !== 0) {
    return mateIn > 0 ? 1 : 0;
  }
  if (!Number.isFinite(cp)) return 0.5;
  if (cp >= 90000) return 1;
  if (cp <= -90000) return 0;
  return 1 / (1 + Math.exp(-WIN_PROB_K * cp));
}

export function winProbForSide(winProbWhite, color) {
  return color === 'w' ? winProbWhite : 1 - winProbWhite;
}

export function formatEvalDisplay(evalCp, mateIn = null) {
  if (Number.isFinite(mateIn) && mateIn !== 0) {
    const moves = Math.max(1, Math.abs(Math.round(mateIn)));
    return {
      text: mateIn > 0 ? `M${moves}` : `-M${moves}`,
      pct: mateIn > 0 ? 100 : 0
    };
  }

  if (Number.isFinite(evalCp) && Math.abs(evalCp) >= 90000) {
    const plies = Math.max(1, 99999 - Math.abs(evalCp));
    const moves = Math.max(1, Math.ceil(plies / 2));
    return {
      text: evalCp > 0 ? `M${moves}` : `-M${moves}`,
      pct: evalCp > 0 ? 100 : 0
    };
  }

  const cp = Number.isFinite(evalCp) ? evalCp : 0;
  const rounded = Math.round(cp / 10) / 10;
  let text;
  if (Math.abs(rounded) < 0.05) text = '0.0';
  else if (rounded > 0) text = `+${rounded.toFixed(1)}`;
  else text = rounded.toFixed(1);

  const wp = cpToWinProb(cp, null);
  const pct = Math.round(Math.max(5, Math.min(95, wp * 100)) * 10) / 10;
  return { text, pct };
}

export function classifyMove({
  winProbBefore,
  winProbAfter,
  cpLoss = 0,
  isBestMove = false,
  isBook = false,
  isSacrifice = false
} = {}) {
  if (isBook) return MOVE_CLASSIFICATIONS.book;

  const hasWp = Number.isFinite(winProbBefore) && Number.isFinite(winProbAfter);
  const dp = hasWp ? Math.max(0, winProbBefore - winProbAfter) : null;
  const loss = Number.isFinite(cpLoss) ? Math.max(0, cpLoss) : 0;

  if (isBestMove && isSacrifice && (!hasWp || winProbAfter >= 0.45)) {
    return MOVE_CLASSIFICATIONS.brilliant;
  }
  if (isBestMove) return MOVE_CLASSIFICATIONS.best;

  if (hasWp) {
    if (dp <= 0.01) return MOVE_CLASSIFICATIONS.best;
    if (dp <= 0.025) return MOVE_CLASSIFICATIONS.excellent;
    if (dp <= 0.055) return MOVE_CLASSIFICATIONS.good;
    if (dp <= 0.11) return MOVE_CLASSIFICATIONS.inaccuracy;
    if (dp <= 0.22) return MOVE_CLASSIFICATIONS.mistake;
    return MOVE_CLASSIFICATIONS.blunder;
  }

  if (loss <= 10) return MOVE_CLASSIFICATIONS.best;
  if (loss <= 25) return MOVE_CLASSIFICATIONS.excellent;
  if (loss <= 55) return MOVE_CLASSIFICATIONS.good;
  if (loss <= 115) return MOVE_CLASSIFICATIONS.inaccuracy;
  if (loss <= 230) return MOVE_CLASSIFICATIONS.mistake;
  return MOVE_CLASSIFICATIONS.blunder;
}

function moveAccuracyFromDelta(dpPct) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * dpPct) - 3.1669));
}

export function computeAccuracy(winProbs = [], color = undefined) {
  if (!Array.isArray(winProbs) || winProbs.length === 0) return 100;

  const scores = [];
  const first = winProbs[0];

  if (typeof first === 'object' && first !== null) {
    for (let i = 0; i < winProbs.length; i++) {
      const p = winProbs[i];
      if (!p) continue;
      const moveColor = (p.color === 'w' || p.color === 'b') ? p.color : (i % 2 === 0 ? 'w' : 'b');
      if (color && moveColor !== color) continue;
      if (!Number.isFinite(p.winProbBefore) || !Number.isFinite(p.winProbAfter)) continue;
      const beforeMover = winProbForSide(p.winProbBefore, moveColor);
      const afterMover = winProbForSide(p.winProbAfter, moveColor);
      const dpPct = Math.max(0, (beforeMover - afterMover) * 100);
      scores.push(moveAccuracyFromDelta(dpPct));
    }
  } else {
    for (let i = 0; i < winProbs.length - 1; i++) {
      const moveColor = i % 2 === 0 ? 'w' : 'b';
      if (color && moveColor !== color) continue;
      const wpBeforeW = winProbs[i];
      const wpAfterW = winProbs[i + 1];
      if (!Number.isFinite(wpBeforeW) || !Number.isFinite(wpAfterW)) continue;
      const beforeMover = winProbForSide(wpBeforeW, moveColor);
      const afterMover = winProbForSide(wpAfterW, moveColor);
      const dpPct = Math.max(0, (beforeMover - afterMover) * 100);
      scores.push(moveAccuracyFromDelta(dpPct));
    }
  }

  if (scores.length === 0) return 100;
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return Math.round(avg * 10) / 10;
}

function emptyCounts() {
  return {
    brilliant: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    book: 0
  };
}

export function summarizeAnalysis(plies = []) {
  const list = Array.isArray(plies) ? plies : [];
  const counts = emptyCounts();
  const byColor = { w: emptyCounts(), b: emptyCounts() };

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const code = p?.classification?.code;
    const c = (p?.color === 'w' || p?.color === 'b') ? p.color : (i % 2 === 0 ? 'w' : 'b');
    if (code && code in counts) {
      counts[code]++;
      byColor[c][code]++;
    }
  }

  return {
    whiteAccuracy: computeAccuracy(list, 'w'),
    blackAccuracy: computeAccuracy(list, 'b'),
    counts,
    byColor
  };
}

function getBoardPiece(boardPieces, sq, r, c) {
  if (!boardPieces) return null;
  if (Array.isArray(boardPieces)) {
    return boardPieces[r]?.[c] || null;
  }
  if (typeof boardPieces.get === 'function') {
    return boardPieces.get(sq) || null;
  }
  if (typeof boardPieces === 'object') {
    return boardPieces[sq] || null;
  }
  return null;
}

export function isPseudoLegalPremove(boardPieces, myColor, fromSq, toSq) {
  if (myColor !== 'w' && myColor !== 'b') return false;
  if (typeof fromSq !== 'string' || typeof toSq !== 'string') return false;
  if (!SQUARE_RE.test(fromSq) || !SQUARE_RE.test(toSq) || fromSq === toSq) return false;

  const { r: fr, c: fc } = squareToRC(fromSq);
  const { r: tr, c: tc } = squareToRC(toSq);

  const piece = getBoardPiece(boardPieces, fromSq, fr, fc);
  if (!piece || piece.color !== myColor) return false;

  const target = getBoardPiece(boardPieces, toSq, tr, tc);
  if (target && target.color === myColor) return false;

  const dr = tr - fr;
  const dc = tc - fc;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);

  switch (piece.type) {
    case 'p': {
      const dir = myColor === 'w' ? -1 : 1;
      const startRow = myColor === 'w' ? 6 : 1;
      if (dc === 0 && dr === dir) return true;
      if (dc === 0 && dr === 2 * dir && fr === startRow) return true;
      if (adr === 1 && adc === 1 && dr === dir) return true;
      return false;
    }
    case 'n':
      return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    case 'b':
      return adr === adc && adr > 0;
    case 'r':
      return (dr === 0 && adc > 0) || (dc === 0 && adr > 0);
    case 'q':
      return (adr === adc && adr > 0) || (dr === 0 && adc > 0) || (dc === 0 && adr > 0);
    case 'k': {
      if (adr <= 1 && adc <= 1 && (adr + adc > 0)) return true;
      const homeRow = myColor === 'w' ? 7 : 0;
      if (dr === 0 && adc === 2 && fr === homeRow && fc === 4) return true;
      return false;
    }
    default:
      return false;
  }
}

export function isPawnPromotionMove(pieceType, color, toSq) {
  if (pieceType !== 'p' || typeof toSq !== 'string' || !SQUARE_RE.test(toSq)) return false;
  return toSq[1] === (color === 'w' ? '8' : '1');
}
