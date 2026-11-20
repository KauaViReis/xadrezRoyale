import { Chess } from 'chess.js';
import { findBestMove, evaluateBoard } from '../core/chess-engine.js';

self.onmessage = e => {
  const { id, type, fen, depth } = e.data;
  try {
    if (type === 'bestMove') {
      const move = findBestMove(fen, depth || 3);
      self.postMessage({ id, ok: true, move });
    } else if (type === 'evaluate') {
      const chess = new Chess(fen);
      const cp = evaluateBoard(chess);
      self.postMessage({ id, ok: true, cp });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
