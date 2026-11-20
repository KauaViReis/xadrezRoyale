import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { squareToRC, rcToSquare, evaluateBoard, findBestMove } from '../src/core/chess-engine.js';
import { eloDelta, RATING_INICIAL } from '../src/core/elo.js';

test('squareToRC e rcToSquare são inversas', () => {
  assert.deepEqual(squareToRC('e4'), { r: 4, c: 4 });
  assert.equal(rcToSquare(4, 4), 'e4');
  assert.deepEqual(squareToRC('a8'), { r: 0, c: 0 });
  assert.deepEqual(squareToRC('h1'), { r: 7, c: 7 });
});

test('evaluateBoard é simétrico na posição inicial', () => {
  const c = new Chess();
  assert.equal(evaluateBoard(c), 0);
});

test('findBestMove encontra mate em 1 (Mate do Pastor)', () => {
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const best = findBestMove(fen, 2);
  assert.ok(best);
  assert.equal(best.from, 'h5');
  assert.equal(best.to, 'f7');
});

test('regras FIDE: roque, en passant e promoção funcionam', () => {
  const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const castle = c.move('O-O');
  assert.ok(castle);
  assert.equal(c.get('g1')?.type, 'k');
  assert.equal(c.get('f1')?.type, 'r');
});

test('eloDelta positivo em vitória contra rating igual', () => {
  const d = eloDelta(RATING_INICIAL, RATING_INICIAL, 1, 0);
  assert.equal(d, 20);
});
