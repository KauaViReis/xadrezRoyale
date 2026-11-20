/* ============================================================
   XADREZ ROYALE — Motor de Regras FIDE + Avaliação & Busca Alpha-Beta
   ============================================================ */

import { Chess } from 'chess.js';

export function squareToRC(sq) {
  const c = sq.charCodeAt(0) - 97;
  const r = 8 - parseInt(sq[1], 10);
  return { r, c };
}

export function rcToSquare(r, c) {
  return String.fromCharCode(97 + c) + String(8 - r);
}

const PIECE_VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const MATE_SCORE = 99999;
const MATE_THRESHOLD = 90000;
const MAX_PV_LEN = 4;
const QSEARCH_MAX_DEPTH = 4;

/* Tabelas Posicionais (White perspective, row 0 = rank 8) */
const PST = {
  p: [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5,  5, 10, 27, 27, 10,  5,  5],
    [0,  0,  0, 24, 24,  0,  0,  0],
    [5, -5,-10,  0,  0,-10, -5,  5],
    [5, 10, 10,-22,-22, 10, 10,  5],
    [0,  0,  0,  0,  0,  0,  0,  0]
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 12, 16, 16, 12,  0,-30],
    [-30,  5, 16, 20, 20, 16,  5,-30],
    [-30,  0, 16, 20, 20, 16,  0,-30],
    [-30,  5, 12, 16, 16, 12,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  8, 12, 12,  8,  0,-10],
    [-10,  6,  6, 12, 12,  6,  6,-10],
    [-10,  0, 12, 12, 12, 12,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
  ],
  r: [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [8, 12, 12, 12, 12, 12, 12,  8],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [0,  0,  0,  6,  6,  0,  0,  0]
  ],
  q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [-5,   0,  5,  5,  5,  5,  0, -5],
    [0,    0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20,  20,  0,  0,  0,  0, 20, 20],
    [20,  32, 12,  0,  0, 12, 32, 20]
  ]
};

function staticEvaluateBoard(chess) {
  const board = chess.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      const base = PIECE_VAL[sq.type];
      const pstRow = sq.color === 'w' ? r : 7 - r;
      const pos = PST[sq.type][pstRow][c];
      score += sq.color === 'w' ? (base + pos) : -(base + pos);
    }
  }
  return score;
}

function staticEvaluate0x88(chess) {
  const board = chess._board;
  let score = 0;
  for (let i = 0; i <= 0x77; i++) {
    if (i & 0x88) {
      i += 7;
      continue;
    }
    const sq = board[i];
    if (!sq) continue;
    const r = i >> 4;
    const c = i & 15;
    const base = PIECE_VAL[sq.type];
    const pstRow = sq.color === 'w' ? r : 7 - r;
    const pos = PST[sq.type][pstRow][c];
    score += sq.color === 'w' ? (base + pos) : -(base + pos);
  }
  return score;
}

export function evaluateBoard(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -MATE_SCORE : MATE_SCORE;
  }
  if (chess.isDraw()) return 0;
  return staticEvaluateBoard(chess);
}

export function computeMateIn(evalCp) {
  if (!Number.isFinite(evalCp) || Math.abs(evalCp) < MATE_THRESHOLD) return null;
  const pliesToMate = MATE_SCORE - Math.abs(evalCp);
  if (pliesToMate <= 0) return null;
  const fullMoves = Math.ceil(pliesToMate / 2);
  return evalCp > 0 ? fullMoves : -fullMoves;
}

function moveOrderScore(m) {
  let s = 0;
  if (m.captured) s += 10 * PIECE_VAL[m.captured] - PIECE_VAL[m.piece];
  if (m.promotion) s += PIECE_VAL[m.promotion];
  if (typeof m.san === 'string' && m.san.includes('+')) s += 45;
  else if (typeof m.flags === 'number' && (m.flags & 48)) s += 35;
  return s;
}

function orderMoves(moves) {
  return moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
}

function hasAnyLegalMoveFast(chess, mover, pseudo = null) {
  const moves = pseudo || chess._moves({ legal: false });
  for (let i = 0; i < moves.length; i++) {
    chess._makeMove(moves[i]);
    const legal = !chess._isKingAttacked(mover);
    chess._undoMove();
    if (legal) return true;
  }
  return false;
}

function hasAnyLegalMovePublic(chess, legal = null) {
  if (Array.isArray(legal)) return legal.length > 0;
  if (typeof chess.isStalemate === 'function') return !chess.isStalemate();
  return chess.moves().length > 0;
}

function qsearchFast(chess, alpha, beta, maximizing, ply, qdepth) {
  const inCheck = chess.inCheck();
  if (inCheck) {
    const evasions = chess._moves();
    if (evasions.length === 0) {
      return maximizing ? -MATE_SCORE + ply : MATE_SCORE - ply;
    }
    if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
      return 0;
    }
    if (qdepth >= QSEARCH_MAX_DEPTH) {
      return staticEvaluate0x88(chess);
    }

    orderMoves(evasions);
    let best = maximizing ? -Infinity : Infinity;
    for (let i = 0; i < evasions.length; i++) {
      const m = evasions[i];
      chess._makeMove(m);
      chess._incPositionCount();
      const s = qsearchFast(chess, alpha, beta, !maximizing, ply + 1, qdepth + 1);
      const hashBeforeUndo = chess._hash;
      chess._undoMove();
      chess._decPositionCount(hashBeforeUndo);

      if (maximizing) {
        if (s > best) best = s;
        if (s > alpha) alpha = s;
      } else {
        if (s < best) best = s;
        if (s < beta) beta = s;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    return 0;
  }

  const mover = maximizing ? 'w' : 'b';
  const standPat = staticEvaluate0x88(chess);
  if (qdepth >= QSEARCH_MAX_DEPTH) {
    if (!hasAnyLegalMoveFast(chess, mover)) return 0;
    return standPat;
  }

  if (maximizing) {
    if (standPat >= beta) {
      if (beta > 0 && !hasAnyLegalMoveFast(chess, mover)) return 0;
      return standPat;
    }
    if (standPat > alpha) alpha = standPat;
  } else {
    if (standPat <= alpha) {
      if (alpha < 0 && !hasAnyLegalMoveFast(chess, mover)) return 0;
      return standPat;
    }
    if (standPat < beta) beta = standPat;
  }

  const pseudo = chess._moves({ legal: false });
  const tactical = [];
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i];
    if (m.captured || m.promotion) tactical.push(m);
  }
  if (tactical.length === 0) {
    if (!hasAnyLegalMoveFast(chess, mover, pseudo)) return 0;
    return standPat;
  }

  orderMoves(tactical);

  let best = standPat;
  let hasLegalTactical = false;
  for (let i = 0; i < tactical.length; i++) {
    const m = tactical[i];
    chess._makeMove(m);
    if (chess._isKingAttacked(mover)) {
      chess._undoMove();
      continue;
    }
    hasLegalTactical = true;
    chess._incPositionCount();
    const s = qsearchFast(chess, alpha, beta, !maximizing, ply + 1, qdepth + 1);
    const hashBeforeUndo = chess._hash;
    chess._undoMove();
    chess._decPositionCount(hashBeforeUndo);

    if (maximizing) {
      if (s > best) best = s;
      if (s > alpha) alpha = s;
    } else {
      if (s < best) best = s;
      if (s < beta) beta = s;
    }
    if (beta <= alpha) break;
  }

  if (!hasLegalTactical && !hasAnyLegalMoveFast(chess, mover, pseudo)) {
    return 0;
  }

  return best;
}

function qsearchPublic(chess, alpha, beta, maximizing, ply, qdepth) {
  const inCheck = chess.inCheck();
  if (inCheck) {
    const evasions = chess.moves({ verbose: true });
    if (evasions.length === 0) {
      return maximizing ? -MATE_SCORE + ply : MATE_SCORE - ply;
    }
    if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
      return 0;
    }
    if (qdepth >= QSEARCH_MAX_DEPTH) {
      return staticEvaluateBoard(chess);
    }

    orderMoves(evasions);
    let best = maximizing ? -Infinity : Infinity;
    for (let i = 0; i < evasions.length; i++) {
      const m = evasions[i];
      chess.move(m);
      const s = qsearchPublic(chess, alpha, beta, !maximizing, ply + 1, qdepth + 1);
      chess.undo();

      if (maximizing) {
        if (s > best) best = s;
        if (s > alpha) alpha = s;
      } else {
        if (s < best) best = s;
        if (s < beta) beta = s;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    return 0;
  }

  const standPat = staticEvaluateBoard(chess);
  if (qdepth >= QSEARCH_MAX_DEPTH) {
    if (!hasAnyLegalMovePublic(chess)) return 0;
    return standPat;
  }

  if (maximizing) {
    if (standPat >= beta) {
      if (beta > 0 && !hasAnyLegalMovePublic(chess)) return 0;
      return standPat;
    }
    if (standPat > alpha) alpha = standPat;
  } else {
    if (standPat <= alpha) {
      if (alpha < 0 && !hasAnyLegalMovePublic(chess)) return 0;
      return standPat;
    }
    if (standPat < beta) beta = standPat;
  }

  const legal = chess.moves({ verbose: true });
  if (!hasAnyLegalMovePublic(chess, legal)) return 0;
  const tactical = [];
  for (let i = 0; i < legal.length; i++) {
    const m = legal[i];
    if (m.captured || m.promotion) tactical.push(m);
  }
  if (tactical.length === 0) return standPat;

  orderMoves(tactical);

  let best = standPat;
  for (let i = 0; i < tactical.length; i++) {
    const m = tactical[i];
    chess.move(m);
    const s = qsearchPublic(chess, alpha, beta, !maximizing, ply + 1, qdepth + 1);
    chess.undo();

    if (maximizing) {
      if (s > best) best = s;
      if (s > alpha) alpha = s;
    } else {
      if (s < best) best = s;
      if (s < beta) beta = s;
    }
    if (beta <= alpha) break;
  }

  return best;
}

function searchFast(chess, depth, alpha, beta, maximizing, ply) {
  if (depth <= 0) {
    return { score: qsearchFast(chess, alpha, beta, maximizing, ply, 0), pv: [] };
  }

  const moves = chess._moves();
  if (moves.length === 0) {
    return {
      score: chess.inCheck() ? (maximizing ? -MATE_SCORE + ply : MATE_SCORE - ply) : 0,
      pv: []
    };
  }

  if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    return { score: 0, pv: [] };
  }

  orderMoves(moves);

  let bestScore = maximizing ? -Infinity : Infinity;
  let bestPv = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    chess._makeMove(m);
    chess._incPositionCount();
    const child = searchFast(chess, depth - 1, alpha, beta, !maximizing, ply + 1);
    const hashBeforeUndo = chess._hash;
    chess._undoMove();
    chess._decPositionCount(hashBeforeUndo);

    if (maximizing) {
      if (child.score > bestScore) {
        bestScore = child.score;
        bestPv = [m, ...child.pv];
      }
      if (child.score > alpha) alpha = child.score;
    } else {
      if (child.score < bestScore) {
        bestScore = child.score;
        bestPv = [m, ...child.pv];
      }
      if (child.score < beta) beta = child.score;
    }
    if (beta <= alpha) break;
  }

  return { score: bestScore, pv: bestPv };
}

function searchPublic(chess, depth, alpha, beta, maximizing, ply) {
  if (depth <= 0) {
    return { score: qsearchPublic(chess, alpha, beta, maximizing, ply, 0), pv: [] };
  }

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return {
      score: chess.inCheck() ? (maximizing ? -MATE_SCORE + ply : MATE_SCORE - ply) : 0,
      pv: []
    };
  }

  if (chess.isDrawByFiftyMoves() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    return { score: 0, pv: [] };
  }

  orderMoves(moves);

  let bestScore = maximizing ? -Infinity : Infinity;
  let bestPv = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    chess.move(m);
    const child = searchPublic(chess, depth - 1, alpha, beta, !maximizing, ply + 1);
    chess.undo();

    if (maximizing) {
      if (child.score > bestScore) {
        bestScore = child.score;
        bestPv = [m, ...child.pv];
      }
      if (child.score > alpha) alpha = child.score;
    } else {
      if (child.score < bestScore) {
        bestScore = child.score;
        bestPv = [m, ...child.pv];
      }
      if (child.score < beta) beta = child.score;
    }
    if (beta <= alpha) break;
  }

  return { score: bestScore, pv: bestPv };
}

function canUseFast0x88(chess) {
  return (
    typeof chess._moves === 'function' &&
    typeof chess._makeMove === 'function' &&
    typeof chess._undoMove === 'function' &&
    typeof chess._incPositionCount === 'function' &&
    typeof chess._decPositionCount === 'function' &&
    typeof chess._isKingAttacked === 'function' &&
    Array.isArray(chess._board)
  );
}

export function findBestMove(fen, depth = 3) {
  const chess = new Chess(fen);
  const searchDepth = Math.max(1, Number.isFinite(depth) ? Math.trunc(depth) : 3);
  const fast = canUseFast0x88(chess);

  const moves = fast ? chess._moves() : chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  orderMoves(moves);

  const maximizing = chess.turn() === 'w';
  let bestVal = maximizing ? -Infinity : Infinity;
  let bestEntries = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const rootAlpha = maximizing && bestVal > -Infinity ? bestVal - 1 : -Infinity;
    const rootBeta = !maximizing && bestVal < Infinity ? bestVal + 1 : Infinity;

    let child;
    if (fast) {
      chess._makeMove(m);
      chess._incPositionCount();
      child = searchFast(chess, searchDepth - 1, rootAlpha, rootBeta, !maximizing, 1);
      const hashBeforeUndo = chess._hash;
      chess._undoMove();
      chess._decPositionCount(hashBeforeUndo);
    } else {
      chess.move(m);
      child = searchPublic(chess, searchDepth - 1, rootAlpha, rootBeta, !maximizing, 1);
      chess.undo();
    }

    const val = child.score;
    const entry = { move: m, pv: [m, ...child.pv] };

    if (maximizing) {
      if (val > bestVal) {
        bestVal = val;
        bestEntries = [entry];
      } else if (val === bestVal) {
        bestEntries.push(entry);
      }
    } else {
      if (val < bestVal) {
        bestVal = val;
        bestEntries = [entry];
      } else if (val === bestVal) {
        bestEntries.push(entry);
      }
    }
  }

  const chosenEntry = bestEntries[Math.floor(Math.random() * bestEntries.length)];
  const rawPv = chosenEntry.pv.slice(0, MAX_PV_LEN);

  // Materialize exact FIDE-verified SANs from root on the local Chess instance
  const pv = [];
  for (let i = 0; i < rawPv.length; i++) {
    const step = rawPv[i];
    const from = typeof step.from === 'number' ? rcToSquare(step.from >> 4, step.from & 15) : step.from;
    const to = typeof step.to === 'number' ? rcToSquare(step.to >> 4, step.to & 15) : step.to;
    const promotion = step.promotion || undefined;
    const played = chess.move({ from, to, promotion });
    if (!played) break;
    pv.push({
      from: played.from,
      to: played.to,
      promotion: played.promotion || undefined,
      san: played.san
    });
  }

  const root = pv[0];
  return {
    from: root.from,
    to: root.to,
    promotion: root.promotion,
    san: root.san,
    evalCp: bestVal,
    mateIn: computeMateIn(bestVal),
    pv
  };
}

export function evaluatePosition(fen, depth = 2, options = {}) {
  const { quiesce = false } = options || {};
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    return {
      evalCp: chess.turn() === 'w' ? -MATE_SCORE : MATE_SCORE,
      mateIn: null
    };
  }
  if (chess.isDraw()) {
    return { evalCp: 0, mateIn: null };
  }

  const d = Number.isFinite(depth) ? Math.trunc(depth) : 2;
  if (d <= 0) {
    if (!quiesce) {
      return { evalCp: evaluateBoard(chess), mateIn: null };
    }
    const maximizing = chess.turn() === 'w';
    const score = canUseFast0x88(chess)
      ? qsearchFast(chess, -Infinity, Infinity, maximizing, 0, 0)
      : qsearchPublic(chess, -Infinity, Infinity, maximizing, 0, 0);
    return { evalCp: score, mateIn: computeMateIn(score) };
  }

  const best = findBestMove(fen, d);
  if (!best) {
    return { evalCp: evaluateBoard(chess), mateIn: null };
  }
  return { evalCp: best.evalCp, mateIn: best.mateIn };
}
