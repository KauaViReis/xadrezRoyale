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

export function evaluateBoard(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw()) return 0;

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

function orderMoves(moves) {
  return moves.sort((a, b) => {
    let sa = 0, sb = 0;
    if (a.captured) sa += 10 * PIECE_VAL[a.captured] - PIECE_VAL[a.piece];
    if (b.captured) sb += 10 * PIECE_VAL[b.captured] - PIECE_VAL[b.piece];
    if (a.promotion) sa += PIECE_VAL[a.promotion];
    if (b.promotion) sb += PIECE_VAL[b.promotion];
    if (a.san.includes('+')) sa += 45;
    if (b.san.includes('+')) sb += 45;
    return sb - sa;
  });
}

function minimax(chess, depth, alpha, beta, maximizing, ply) {
  if (chess.isCheckmate()) {
    return maximizing ? -99999 + ply : 99999 - ply;
  }
  if (chess.isDraw()) return 0;
  if (depth <= 0) return evaluateBoard(chess);

  const moves = orderMoves(chess.moves({ verbose: true }));
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const val = minimax(chess, depth - 1, alpha, beta, false, ply + 1);
      chess.undo();
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      chess.move(m);
      const val = minimax(chess, depth - 1, alpha, beta, true, ply + 1);
      chess.undo();
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function findBestMove(fen, depth = 3) {
  const chess = new Chess(fen);
  const moves = orderMoves(chess.moves({ verbose: true }));
  if (moves.length === 0) return null;

  const maximizing = chess.turn() === 'w';
  let bestVal = maximizing ? -Infinity : Infinity;
  let bestMoves = [];

  for (const m of moves) {
    chess.move(m);
    const val = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing, 1);
    chess.undo();

    if (maximizing) {
      if (val > bestVal) { bestVal = val; bestMoves = [m]; }
      else if (val === bestVal) bestMoves.push(m);
    } else {
      if (val < bestVal) { bestVal = val; bestMoves = [m]; }
      else if (val === bestVal) bestMoves.push(m);
    }
  }

  const chosen = bestMoves[Math.floor(Math.random() * bestMoves.length)];
  return {
    from: chosen.from,
    to: chosen.to,
    promotion: chosen.promotion || undefined,
    san: chosen.san,
    evalCp: bestVal
  };
}
