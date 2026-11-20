import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  MOVE_CLASSIFICATIONS,
  reconstructStateAtPly,
  cpToWinProb,
  winProbForSide,
  formatEvalDisplay,
  classifyMove,
  computeAccuracy,
  summarizeAnalysis,
  isPseudoLegalPremove,
  isPawnPromotionMove
} from '../src/core/game-helpers.js';
import { AudioManager } from '../src/core/audio.js';
import { clamp, tween, setHaptics, getHaptics, vibrate } from '../src/core/utils.js';
import { formatClock } from '../src/core/elo.js';

test('reconstructStateAtPly reconstrói capturas, en passant, roque e promoção sem mutar original', () => {
  const c = new Chess();
  const sans = [
    'e4', 'a6',
    'e5', 'd5',
    'exd6', 'cxd6', // en passant by White, recapture by Black
    'Nf3', 'Nc6',
    'Be2', 'Nf6',
    'O-O', 'Qa5',   // castling by White
    'd4', 'Qxa2',   // Black queen captures pawn
    'Nc3', 'Nb4',
    'Nxa2', 'Nxa2'  // exchange on a2 (White gets queen, Black gets knight)
  ];
  for (const s of sans) c.move(s);
  const hist = c.history({ verbose: true });
  const snapshotFen = c.fen();

  const at0 = reconstructStateAtPly(hist, 0);
  assert.equal(at0.ply, 0);
  assert.equal(at0.fen, new Chess().fen());
  assert.deepEqual(at0.capturedByWhite, []);
  assert.deepEqual(at0.capturedByBlack, []);
  assert.equal(at0.materialDiff, 0);
  assert.equal(at0.lastMove, null);
  assert.equal(at0.turn, 'w');

  // After ply 5 (exd6 en passant)
  const atEp = reconstructStateAtPly(hist, 5);
  assert.deepEqual(atEp.capturedByWhite, ['p']);
  assert.deepEqual(atEp.capturedByBlack, []);
  assert.equal(atEp.materialDiff, 1);
  assert.deepEqual(atEp.lastMove, { from: 'e5', to: 'd6' });

  // Final ply: captured pieces sorted by q, r, b, n, p
  const atEnd = reconstructStateAtPly(hist, 999);
  assert.equal(atEnd.ply, hist.length);
  assert.equal(atEnd.fen, snapshotFen);
  assert.deepEqual(atEnd.capturedByWhite, ['q', 'p']);
  assert.deepEqual(atEnd.capturedByBlack, ['n', 'p', 'p']);
  assert.equal(atEnd.materialDiff, 5); // White captured Q(9)+P(1)=10, Black captured N(3)+P(1)+P(1)=5 => +5

  // Negative ply clamps to 0; original Chess instance unmutated
  const atNeg = reconstructStateAtPly(hist, -5);
  assert.equal(atNeg.ply, 0);
  assert.equal(c.fen(), snapshotFen);
});

test('reconstructStateAtPly lida com promoção com captura corretamente', () => {
  const startFen = '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const c = new Chess(startFen);
  c.move({ from: 'a7', to: 'b8', promotion: 'q' });
  const hist = c.history({ verbose: true });
  const state = reconstructStateAtPly(hist, 1, startFen);
  assert.deepEqual(state.capturedByWhite, ['r']); // captured rook, NOT promoted queen
  assert.equal(state.materialDiff, 9); // White has Q(+9), lost P(-1), Black lost R(-5) => +9
});

test('formatEvalDisplay formata centipeões, zero e mates corretamente', () => {
  assert.deepEqual(formatEvalDisplay(0, null), { text: '0.0', pct: 50 });
  assert.deepEqual(formatEvalDisplay(-3, null), { text: '0.0', pct: 49.7 });
  const pos = formatEvalDisplay(145, null);
  assert.equal(pos.text, '+1.5');
  assert.ok(pos.pct > 50 && pos.pct <= 95);

  const neg = formatEvalDisplay(-250, null);
  assert.equal(neg.text, '-2.5');
  assert.ok(neg.pct < 50 && neg.pct >= 5);

  assert.deepEqual(formatEvalDisplay(99998, 1), { text: 'M1', pct: 100 });
  assert.deepEqual(formatEvalDisplay(-99996, -2), { text: '-M2', pct: 0 });
  assert.deepEqual(formatEvalDisplay(99997, null), { text: 'M1', pct: 100 });
  assert.deepEqual(formatEvalDisplay(5000, null).pct, 95);
  assert.deepEqual(formatEvalDisplay(-5000, null).pct, 5);

  // Non-finite mateIn (NaN, Infinity, -Infinity) must safely fall back to evalCp
  assert.deepEqual(formatEvalDisplay(0, NaN), { text: '0.0', pct: 50 });
  assert.deepEqual(formatEvalDisplay(145, NaN), formatEvalDisplay(145, null));
  assert.deepEqual(formatEvalDisplay(0, Infinity), { text: '0.0', pct: 50 });
  assert.deepEqual(formatEvalDisplay(-250, -Infinity), formatEvalDisplay(-250, null));
  assert.deepEqual(formatEvalDisplay(NaN, NaN), { text: '0.0', pct: 50 });
  assert.deepEqual(formatEvalDisplay(99998, NaN), { text: 'M1', pct: 100 });
  assert.deepEqual(formatEvalDisplay(-99996, Infinity), { text: '-M2', pct: 0 });
});

test('cpToWinProb e winProbForSide são simétricos, monotônicos e seguros para mate', () => {
  assert.equal(cpToWinProb(0), 0.5);
  const w300 = cpToWinProb(300);
  const b300 = cpToWinProb(-300);
  assert.ok(Math.abs(w300 + b300 - 1) < 1e-12);
  assert.ok(cpToWinProb(-500) < cpToWinProb(0) && cpToWinProb(0) < cpToWinProb(500));
  assert.equal(cpToWinProb(99998, 1), 1);
  assert.equal(cpToWinProb(-99998, -1), 0);
  assert.equal(cpToWinProb(NaN, null), 0.5);
  assert.ok(Math.abs(winProbForSide(0.75, 'b') - 0.25) < 1e-12);

  // Non-finite mateIn must not hijack win probability as mate
  assert.equal(cpToWinProb(0, NaN), 0.5);
  assert.equal(cpToWinProb(300, NaN), cpToWinProb(300, null));
  assert.equal(cpToWinProb(0, Infinity), 0.5);
  assert.equal(cpToWinProb(0, -Infinity), 0.5);
  assert.equal(cpToWinProb(-300, Infinity), cpToWinProb(-300, null));
  assert.equal(cpToWinProb(NaN, NaN), 0.5);
  assert.equal(cpToWinProb(99998, NaN), 1);
  assert.equal(cpToWinProb(-99998, Infinity), 0);
});

test('classifyMove cobre todas as categorias e computeAccuracy/summarizeAnalysis funcionam', () => {
  assert.equal(classifyMove({ isBook: true }).code, 'book');
  assert.equal(classifyMove({ isBestMove: true, isSacrifice: true, winProbAfter: 0.6 }).code, 'brilliant');
  assert.equal(classifyMove({ isBestMove: true }).code, 'best');
  assert.equal(classifyMove({ winProbBefore: 0.52, winProbAfter: 0.505 }).code, 'excellent');
  assert.equal(classifyMove({ winProbBefore: 0.55, winProbAfter: 0.51 }).code, 'good');
  assert.equal(classifyMove({ winProbBefore: 0.60, winProbAfter: 0.51 }).code, 'inaccuracy');
  assert.equal(classifyMove({ winProbBefore: 0.65, winProbAfter: 0.48 }).code, 'mistake');
  assert.equal(classifyMove({ winProbBefore: 0.75, winProbAfter: 0.30 }).code, 'blunder');
  assert.equal(classifyMove({ cpLoss: 300 }).code, 'blunder');
  assert.equal(Object.keys(MOVE_CLASSIFICATIONS).length, 8);

  const perfectPlies = [
    { color: 'w', winProbBefore: 0.5, winProbAfter: 0.52, classification: MOVE_CLASSIFICATIONS.best },
    { color: 'b', winProbBefore: 0.52, winProbAfter: 0.50, classification: MOVE_CLASSIFICATIONS.best }
  ];
  const perfectSummary = summarizeAnalysis(perfectPlies);
  assert.equal(perfectSummary.whiteAccuracy, 100);
  assert.equal(perfectSummary.blackAccuracy, 100);
  assert.equal(perfectSummary.counts.best, 2);

  const blunderPlies = [
    ...perfectPlies,
    { color: 'b', winProbBefore: 0.5, winProbAfter: 0.9, classification: MOVE_CLASSIFICATIONS.blunder }
  ];
  const blunderSummary = summarizeAnalysis(blunderPlies);
  assert.ok(blunderSummary.blackAccuracy < 80 && blunderSummary.blackAccuracy >= 0);
  assert.equal(blunderSummary.byColor.b.blunder, 1);

  assert.equal(computeAccuracy([0.5, 0.5, 0.5], 'w'), 100);
});

test('summarizeAnalysis usa paridade de índice como fallback de cor consistente com computeAccuracy', () => {
  const omittedColorPlies = [
    { winProbBefore: 0.5, winProbAfter: 0.52, classification: MOVE_CLASSIFICATIONS.best },       // ply 0 -> w
    { winProbBefore: 0.52, winProbAfter: 0.85, classification: MOVE_CLASSIFICATIONS.blunder },   // ply 1 -> b
    { winProbBefore: 0.85, winProbAfter: 0.85, classification: MOVE_CLASSIFICATIONS.excellent }, // ply 2 -> w
    { color: 'invalid', winProbBefore: 0.85, winProbAfter: 0.87, classification: MOVE_CLASSIFICATIONS.inaccuracy } // ply 3 -> b
  ];
  const summary = summarizeAnalysis(omittedColorPlies);
  assert.equal(summary.counts.best, 1);
  assert.equal(summary.counts.blunder, 1);
  assert.equal(summary.counts.excellent, 1);
  assert.equal(summary.counts.inaccuracy, 1);
  assert.equal(summary.byColor.w.best, 1);
  assert.equal(summary.byColor.w.excellent, 1);
  assert.equal(summary.byColor.w.blunder, 0);
  assert.equal(summary.byColor.w.inaccuracy, 0);
  assert.equal(summary.byColor.b.blunder, 1);
  assert.equal(summary.byColor.b.inaccuracy, 1);
  assert.equal(summary.byColor.b.best, 0);
  assert.equal(summary.whiteAccuracy, 100);
  assert.ok(summary.blackAccuracy < 80);

  // Explicit color still overrides index parity (e.g. Black-to-move starting FEN)
  const blackFirstPlies = [
    { color: 'b', winProbBefore: 0.5, winProbAfter: 0.48, classification: MOVE_CLASSIFICATIONS.best },
    { color: 'w', winProbBefore: 0.48, winProbAfter: 0.2, classification: MOVE_CLASSIFICATIONS.blunder }
  ];
  const bfSummary = summarizeAnalysis(blackFirstPlies);
  assert.equal(bfSummary.byColor.b.best, 1);
  assert.equal(bfSummary.byColor.w.blunder, 1);
  assert.equal(bfSummary.byColor.w.best, 0);
  assert.equal(bfSummary.byColor.b.blunder, 0);
});

test('isPseudoLegalPremove e isPawnPromotionMove validam geometria de premove', () => {
  const c = new Chess();
  const board = c.board();

  // Reject invalid / own piece target / opponent piece source
  assert.equal(isPseudoLegalPremove(board, 'w', 'e2', 'e2'), false);
  assert.equal(isPseudoLegalPremove(board, 'w', 'e7', 'e5'), false);
  assert.equal(isPseudoLegalPremove(board, 'w', 'd1', 'e2'), false); // own pawn on e2
  assert.equal(isPseudoLegalPremove(board, 'w', 'z9', 'e4'), false);

  // Pawn: 1-step, 2-step from rank 2, diagonal even onto empty square, no sideways
  assert.equal(isPseudoLegalPremove(board, 'w', 'e2', 'e3'), true);
  assert.equal(isPseudoLegalPremove(board, 'w', 'e2', 'e4'), true);
  assert.equal(isPseudoLegalPremove(board, 'w', 'e2', 'd3'), true);
  assert.equal(isPseudoLegalPremove(board, 'w', 'e2', 'd2'), false);

  // Knight ignores blockers
  assert.equal(isPseudoLegalPremove(board, 'w', 'g1', 'f3'), true);
  assert.equal(isPseudoLegalPremove(board, 'w', 'g1', 'e2'), false); // own pawn on e2!

  // Sliding pieces ignore intermediate blockers
  assert.equal(isPseudoLegalPremove(board, 'w', 'a1', 'a6'), true);
  assert.equal(isPseudoLegalPremove(board, 'w', 'c1', 'h6'), true);
  assert.equal(isPseudoLegalPremove(board, 'w', 'd1', 'h5'), true);

  // King 1-step & home-rank castling, no 2-step off home rank
  const openBoard = new Chess('4k3/8/8/8/8/8/4K3/8 w - - 0 1');
  assert.equal(isPseudoLegalPremove(openBoard, 'w', 'e2', 'g2'), false);
  assert.equal(isPseudoLegalPremove(board, 'w', 'e1', 'g1'), false); // blocked by f1? Wait: f1 has bishop, g1 has knight (own piece)!
  const castleBoard = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(isPseudoLegalPremove(castleBoard, 'w', 'e1', 'g1'), true);
  assert.equal(isPseudoLegalPremove(castleBoard, 'w', 'e1', 'c1'), true);
  assert.equal(isPseudoLegalPremove(castleBoard, 'b', 'e8', 'g8'), true);

  assert.equal(isPawnPromotionMove('p', 'w', 'e8'), true);
  assert.equal(isPawnPromotionMove('p', 'b', 'a1'), true);
  assert.equal(isPawnPromotionMove('p', 'w', 'e7'), false);
  assert.equal(isPawnPromotionMove('q', 'w', 'e8'), false);
});

test('AudioManager, utils e elo funcionam com segurança no Node.js', async () => {
  const audio = new AudioManager();
  for (const fn of [
    'select', 'move', 'capture', 'castle', 'check',
    'promote', 'win', 'defeat', 'draw', 'premove', 'arrow', 'hint', 'tick', 'error'
  ]) {
    assert.doesNotThrow(() => audio[fn]());
  }

  assert.equal(clamp(15, 0, 10), 10);
  setHaptics(false);
  assert.equal(getHaptics(), false);
  assert.doesNotThrow(() => vibrate(25));
  setHaptics(true);
  assert.equal(getHaptics(), true);

  let last = 0;
  await tween(0, k => { last = k; });
  assert.equal(last, 1);

  assert.equal(formatClock(null), '--:--');
  assert.equal(formatClock(NaN), '--:--');
  assert.equal(formatClock(Infinity), '--:--');
  assert.equal(formatClock(65000), '01:05');
});
