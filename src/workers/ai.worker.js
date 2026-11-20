import { Chess } from 'chess.js';
import { findBestMove, evaluatePosition } from '../core/chess-engine.js';
import {
  cpToWinProb,
  winProbForSide,
  classifyMove,
  summarizeAnalysis
} from '../core/game-helpers.js';

const PIECE_MAT = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };

function evalForAnalysis(fen, depth) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    return {
      evalCp: chess.turn() === 'w' ? -99999 : 99999,
      mateIn: null,
      bestMove: null
    };
  }
  if (chess.isDraw()) {
    return {
      evalCp: 0,
      mateIn: null,
      bestMove: null
    };
  }
  const d = Math.max(1, Number.isFinite(depth) ? Math.trunc(depth) : 2);
  const best = findBestMove(fen, d);
  if (!best) {
    return { evalCp: 0, mateIn: null, bestMove: null };
  }
  return {
    evalCp: best.evalCp,
    mateIn: best.mateIn,
    bestMove: best
  };
}

function evalAfterForAnalysis(fen, depth) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    return {
      evalCp: chess.turn() === 'w' ? -99999 : 99999,
      mateIn: null,
      bestMove: null
    };
  }
  if (chess.isDraw()) {
    return {
      evalCp: 0,
      mateIn: null,
      bestMove: null
    };
  }
  const d = Number.isFinite(depth) ? Math.trunc(depth) : 1;
  if (d <= 0) {
    const { evalCp, mateIn } = evaluatePosition(fen, 0, { quiesce: true });
    return { evalCp, mateIn, bestMove: null };
  }
  const best = findBestMove(fen, d);
  if (!best) {
    return { evalCp: 0, mateIn: null, bestMove: null };
  }
  return {
    evalCp: best.evalCp,
    mateIn: best.mateIn,
    bestMove: best
  };
}

export function createWorkerHandler(postMessage) {
  let nextRunToken = 0;
  let activeRunToken = null;
  let activeJobKey = null;
  const cancelledJobKeys = new Set();
  const cancelledTokens = new Set();

  const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));

  return async function handleMessage(data) {
    if (!data || typeof data !== 'object') return;
    const { id, type, fen, depth, jobId, fens, moves } = data;

    if (type === 'cancelAnalysis') {
      const targetJob = jobId ?? id;
      if (targetJob !== undefined && targetJob !== null) {
        cancelledJobKeys.add(targetJob);
        if (activeJobKey === targetJob && activeRunToken !== null) {
          cancelledTokens.add(activeRunToken);
        }
      } else if (activeRunToken !== null) {
        cancelledTokens.add(activeRunToken);
      }
      return;
    }

    if (type === 'bestMove') {
      try {
        const move = findBestMove(fen, depth ?? 3);
        postMessage({ id, ok: true, fen, move });
      } catch (err) {
        postMessage({ id, ok: false, fen, error: err?.message || String(err) });
      }
      return;
    }

    if (type === 'evaluate') {
      try {
        const evalDepth = depth === undefined || depth === null ? 2 : depth;
        const { evalCp, mateIn } = evaluatePosition(fen, evalDepth);
        postMessage({ id, ok: true, fen, evalCp, cp: evalCp, mateIn });
      } catch (err) {
        postMessage({ id, ok: false, fen, error: err?.message || String(err) });
      }
      return;
    }

    if (type === 'analyzeGame') {
      const job = jobId ?? id;
      const searchDepth = depth === undefined || depth === null ? 2 : depth;
      const effectiveDepth = Math.max(1, Number.isFinite(searchDepth) ? Math.trunc(searchDepth) : 2);
      const runToken = ++nextRunToken;

      if (activeRunToken !== null) {
        cancelledTokens.add(activeRunToken);
      }
      activeRunToken = runToken;
      activeJobKey = job ?? null;
      if (job !== undefined && job !== null) {
        cancelledJobKeys.delete(job);
      }

      const isCancelled = () =>
        cancelledTokens.has(runToken) ||
        activeRunToken !== runToken ||
        (job !== undefined && job !== null && cancelledJobKeys.has(job));

      const postCancelled = () => {
        postMessage({
          id,
          jobId: job,
          ok: false,
          cancelled: true,
          error: 'Analysis cancelled'
        });
      };

      try {
        if (!Array.isArray(fens) || !Array.isArray(moves) || fens.length !== moves.length + 1) {
          throw new Error('analyzeGame requires fens (N+1) and moves (N)');
        }

        const total = moves.length;
        if (total === 0) {
          const summary = summarizeAnalysis([]);
          postMessage({ id, jobId: job, ok: true, summary, plies: [] });
          return;
        }

        const plies = [];

        for (let i = 0; i < total; i++) {
          if (isCancelled()) {
            postCancelled();
            return;
          }

          const beforeState = evalForAnalysis(fens[i], effectiveDepth);
          if (isCancelled()) {
            postCancelled();
            return;
          }

          const afterState = evalAfterForAnalysis(fens[i + 1], effectiveDepth - 1);
          await yieldTurn();

          if (isCancelled()) {
            postCancelled();
            return;
          }

          const m = moves[i] || {};
          const color = m.color || (i % 2 === 0 ? 'w' : 'b');

          const wpBeforeW = cpToWinProb(beforeState.evalCp, beforeState.mateIn);
          const wpAfterW = cpToWinProb(afterState.evalCp, afterState.mateIn);
          const wpBeforeMover = winProbForSide(wpBeforeW, color);
          const wpAfterMover = winProbForSide(wpAfterW, color);

          const bestMove = beforeState.bestMove;
          const isBestMove = Boolean(
            bestMove &&
            m.from === bestMove.from &&
            m.to === bestMove.to &&
            (m.promotion || undefined) === (bestMove.promotion || undefined)
          );

          const rawDiff = color === 'w'
            ? beforeState.evalCp - afterState.evalCp
            : afterState.evalCp - beforeState.evalCp;
          const cpLoss = isBestMove ? 0 : Math.max(0, Math.round(rawDiff));

          const movedVal = PIECE_MAT[m.piece] || 0;
          const capVal = PIECE_MAT[m.captured] || 0;
          const isSacrifice = Boolean(
            isBestMove &&
            m.piece &&
            m.piece !== 'p' &&
            movedVal > capVal &&
            afterState.bestMove &&
            afterState.bestMove.to === m.to &&
            wpBeforeMover < 0.88 &&
            wpAfterMover >= 0.45
          );

          const classification = classifyMove({
            winProbBefore: wpBeforeMover,
            winProbAfter: wpAfterMover,
            cpLoss,
            isBestMove,
            isBook: false,
            isSacrifice
          });

          const entry = {
            ply: i + 1,
            san: m.san || '',
            from: m.from,
            to: m.to,
            promotion: m.promotion || undefined,
            color,
            evalBeforeCp: beforeState.evalCp,
            evalAfterCp: afterState.evalCp,
            mateBefore: beforeState.mateIn,
            mateAfter: afterState.mateIn,
            bestMove,
            cpLoss,
            winProbBefore: wpBeforeW,
            winProbAfter: wpAfterW,
            classification
          };

          plies.push(entry);
          postMessage({
            id,
            jobId: job,
            type: 'analyzeProgress',
            done: i + 1,
            total,
            entry
          });
        }

        if (isCancelled()) {
          postCancelled();
          return;
        }

        const summary = summarizeAnalysis(plies);
        postMessage({ id, jobId: job, ok: true, summary, plies });
      } catch (err) {
        postMessage({
          id,
          jobId: job,
          ok: false,
          error: err?.message || String(err)
        });
      } finally {
        cancelledTokens.delete(runToken);
        if (activeRunToken === runToken) {
          activeRunToken = null;
          activeJobKey = null;
          if (job !== undefined && job !== null) {
            cancelledJobKeys.delete(job);
          }
        }
      }
    }
  };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const handler = createWorkerHandler(msg => self.postMessage(msg));
  self.onmessage = e => handler(e.data);
}
