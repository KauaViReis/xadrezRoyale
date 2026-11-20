import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createWorkerHandler } from '../src/workers/ai.worker.js';

test('worker handler bestMove retorna jogada com PV e mateIn', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

  await handler({ id: 1, type: 'bestMove', fen, depth: 2 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 1);
  assert.equal(messages[0].ok, true);
  assert.equal(messages[0].fen, fen);
  assert.equal(messages[0].move.san, 'Qxf7#');
  assert.equal(messages[0].move.mateIn, 1);
  assert.equal(messages[0].move.pv.length, 1);
});

test('worker handler evaluate usa busca e preserva compatibilidade cp + evalCp + mateIn', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));

  const startFen = new Chess().fen();
  await handler({ id: 10, type: 'evaluate', fen: startFen, depth: 2 });
  assert.equal(messages[0].ok, true);
  assert.equal(messages[0].fen, startFen);
  assert.equal(messages[0].cp, messages[0].evalCp);
  assert.equal(messages[0].mateIn, null);

  const mateFen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
  await handler({ id: 11, type: 'evaluate', fen: mateFen, depth: 2 });
  assert.equal(messages[1].ok, true);
  assert.equal(messages[1].evalCp, 99999);
  assert.equal(messages[1].cp, 99999);
  assert.equal(messages[1].mateIn, null);
});

test('worker handler analyzeGame transmite progresso e resume Mate do Pastor', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));

  const c = new Chess();
  const fens = [c.fen()];
  const moves = [];
  for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) {
    const m = c.move(san);
    moves.push(m);
    fens.push(c.fen());
  }

  await handler({
    id: 20,
    jobId: 'job-scholar',
    type: 'analyzeGame',
    fens,
    moves,
    depth: 2
  });

  const progress = messages.filter(m => m.type === 'analyzeProgress');
  const finalMsg = messages.find(m => m.ok === true && m.summary);

  assert.equal(progress.length, 7);
  for (let i = 0; i < 7; i++) {
    assert.equal(progress[i].done, i + 1);
    assert.equal(progress[i].total, 7);
    assert.equal(progress[i].jobId, 'job-scholar');
    assert.ok(progress[i].entry.classification.code);
  }

  assert.ok(finalMsg);
  assert.equal(finalMsg.id, 20);
  assert.equal(finalMsg.jobId, 'job-scholar');
  assert.equal(finalMsg.plies.length, 7);
  assert.ok(finalMsg.summary.whiteAccuracy >= 0 && finalMsg.summary.whiteAccuracy <= 100);
  assert.ok(finalMsg.summary.blackAccuracy >= 0 && finalMsg.summary.blackAccuracy <= 100);
  // Black's 3...Nf6?? allows Qxf7#
  assert.equal(finalMsg.plies[5].classification.code, 'blunder');
  // White's 4. Qxf7# is best
  assert.equal(finalMsg.plies[6].classification.code, 'best');
});

test('worker handler cancelAnalysis interrompe analyzeGame no meio', async () => {
  const messages = [];
  let handler;
  handler = createWorkerHandler(msg => {
    messages.push(msg);
    if (msg.type === 'analyzeProgress' && msg.done === 2) {
      handler({ type: 'cancelAnalysis', jobId: 'job-cancel' });
    }
  });

  const c = new Chess();
  const fens = [c.fen()];
  const moves = [];
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+']) {
    moves.push(c.move(san));
    fens.push(c.fen());
  }

  await handler({
    id: 30,
    jobId: 'job-cancel',
    type: 'analyzeGame',
    fens,
    moves,
    depth: 1
  });

  const progress = messages.filter(m => m.type === 'analyzeProgress');
  const cancelledMsg = messages.find(m => m.cancelled === true);
  assert.equal(progress.length, 2);
  assert.ok(cancelledMsg);
  assert.equal(cancelledMsg.id, 30);
  assert.equal(cancelledMsg.jobId, 'job-cancel');
  assert.equal(cancelledMsg.ok, false);
});

test('worker handler trata FEN inválido sem quebrar chamadas seguintes', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));

  await handler({ id: 40, type: 'bestMove', fen: 'not-a-valid-fen', depth: 2 });
  assert.equal(messages[0].id, 40);
  assert.equal(messages[0].ok, false);
  assert.ok(messages[0].error);

  await handler({ id: 41, type: 'evaluate', fen: 'also-invalid', depth: 2 });
  assert.equal(messages[1].id, 41);
  assert.equal(messages[1].ok, false);

  await handler({ id: 42, type: 'evaluate', fen: new Chess().fen(), depth: 1 });
  assert.equal(messages[2].id, 42);
  assert.equal(messages[2].ok, true);
});

async function runAnalyzeGame(sans, depth) {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));
  const c = new Chess();
  const fens = [c.fen()];
  const moves = [];
  for (const san of sans) {
    moves.push(c.move(san));
    fens.push(c.fen());
  }
  await handler({ id: 1, jobId: `job-${depth ?? 'default'}`, type: 'analyzeGame', fens, moves, depth });
  return { messages, finalMsg: messages.find(m => m.ok === true && m.summary) };
}

test('analyzeGame em abertura equilibrada (Ruy Lopez) evita falsos blunders e 0 cpLoss artificial', async () => {
  const ruyLopez = [
    'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6',
    'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'
  ];

  for (const depth of [undefined, 3]) {
    const { finalMsg } = await runAnalyzeGame(ruyLopez, depth);
    assert.ok(finalMsg, `Expected final summary for depth=${depth}`);
    assert.equal(finalMsg.summary.counts.blunder, 0, `No blunders expected in Ruy Lopez (depth=${depth})`);
    assert.ok(
      finalMsg.summary.whiteAccuracy >= 70 && finalMsg.summary.blackAccuracy >= 70,
      `Expected >=70% accuracy in Ruy Lopez (depth=${depth}), got W=${finalMsg.summary.whiteAccuracy}, B=${finalMsg.summary.blackAccuracy}`
    );
  }

  // Inferior flank/passive moves should produce positive cpLoss rather than fake 0 cpLoss on every ply
  const inferiorOpening = ['e4', 'a6', 'd4', 'h6', 'Nc3', 'g5', 'Nf3', 'b5'];
  const { finalMsg: infMsg } = await runAnalyzeGame(inferiorOpening, 2);
  assert.ok(infMsg);
  assert.ok(infMsg.plies.some(p => p.cpLoss > 0), 'Expected positive cpLoss on inferior moves');
  assert.ok(infMsg.summary.counts.best < inferiorOpening.length, 'Not every inferior move can be best');
});

test('analyzeGame detecta blunders (2...f6?? e dama pendurada) sem punir desenvolvimento ou refutação por paridade', async () => {
  // 1) Hanging queen + immediate capture refutation across even & odd depths
  const hangingQueen = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Qg5', 'Nxg5', 'Nf6'];
  for (const depth of [2, 3]) {
    const { finalMsg } = await runAnalyzeGame(hangingQueen, depth);
    assert.ok(finalMsg);
    for (let i = 0; i < 5; i++) {
      assert.notEqual(
        finalMsg.plies[i].classification.code,
        'blunder',
        `Normal development ${finalMsg.plies[i].san} misclassified as blunder at depth=${depth}`
      );
    }
    const blunderPly = finalMsg.plies[5]; // 3...Qg5??
    assert.equal(blunderPly.san, 'Qg5');
    assert.equal(blunderPly.classification.code, 'blunder');
    assert.ok(blunderPly.cpLoss > 300, `Expected cpLoss > 300 for Qg5??, got ${blunderPly.cpLoss}`);

    const refutationPly = finalMsg.plies[6]; // 4. Nxg5
    assert.equal(refutationPly.san, 'Nxg5');
    assert.equal(refutationPly.cpLoss, 0);
    assert.equal(refutationPly.classification.code, 'best');
  }

  // 2) Damiano 2...f6?? must not score 0 cpLoss / 'best' at default depth=2
  const damiano = ['e4', 'e5', 'Nf3', 'f6', 'Bc4', 'Nc6'];
  const { finalMsg: damMsg } = await runAnalyzeGame(damiano, 2);
  assert.ok(damMsg);
  const f6Ply = damMsg.plies[3];
  assert.equal(f6Ply.san, 'f6');
  assert.ok(f6Ply.cpLoss > 0, `Expected positive cpLoss for 2...f6??, got ${f6Ply.cpLoss}`);
  assert.ok(
    ['inaccuracy', 'mistake', 'blunder'].includes(f6Ply.classification.code),
    `Expected 2...f6?? to be inaccuracy/mistake/blunder, got ${f6Ply.classification.code}`
  );
  for (let i = 0; i < 3; i++) {
    assert.notEqual(damMsg.plies[i].classification.code, 'blunder');
  }
});

test('worker handler rejeita fens.length !== moves.length + 1 e aceita jogo vazio', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));
  const c = new Chess();
  const f0 = c.fen();
  const m1 = c.move('e4');
  const f1 = c.fen();
  const m2 = c.move('e5');
  const f2 = c.fen();

  // Too few FENs
  await handler({ id: 50, jobId: 'short', type: 'analyzeGame', fens: [f0], moves: [m1] });
  assert.equal(messages[0].id, 50);
  assert.equal(messages[0].ok, false);
  assert.ok(messages[0].error);

  // Too many FENs (trailing extra FEN)
  await handler({ id: 51, jobId: 'long', type: 'analyzeGame', fens: [f0, f1, f2], moves: [m1] });
  assert.equal(messages[1].id, 51);
  assert.equal(messages[1].ok, false);
  assert.ok(messages[1].error);

  // 0-ply empty game succeeds cleanly
  await handler({ id: 52, jobId: 'empty', type: 'analyzeGame', fens: [f0], moves: [] });
  assert.equal(messages[2].id, 52);
  assert.equal(messages[2].ok, true);
  assert.deepEqual(messages[2].plies, []);
  assert.equal(messages[2].summary.whiteAccuracy, 100);
  assert.equal(messages[2].summary.blackAccuracy, 100);
});

test('worker handler substitui analyzeGame anterior mesmo quando id e jobId são omitidos', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));

  const c = new Chess();
  const fens = [c.fen()];
  const moves = [];
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
    moves.push(c.move(san));
    fens.push(c.fen());
  }

  // Launch two analyzeGame jobs back-to-back omitting both id and jobId
  const p1 = handler({ type: 'analyzeGame', fens, moves, depth: 1 });
  const p2 = handler({ type: 'analyzeGame', fens: fens.slice(0, 3), moves: moves.slice(0, 2), depth: 1 });
  await Promise.all([p1, p2]);

  const cancelled = messages.filter(m => m.cancelled === true);
  const completed = messages.filter(m => m.ok === true && m.summary);
  assert.equal(cancelled.length, 1);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].plies.length, 2);

  // cancelAnalysis omitting jobId/id also cancels an active analyzeGame omitting id/jobId
  const messages2 = [];
  let h2;
  h2 = createWorkerHandler(msg => {
    messages2.push(msg);
    if (msg.type === 'analyzeProgress' && msg.done === 1) {
      h2({ type: 'cancelAnalysis' });
    }
  });
  await h2({ type: 'analyzeGame', fens, moves, depth: 1 });
  assert.equal(messages2.filter(m => m.type === 'analyzeProgress').length, 1);
  assert.equal(messages2.filter(m => m.cancelled === true).length, 1);
});

test('worker handler recupera de FEN inválido no meio de analyzeGame e trata terminais/depth 0/mensagens inválidas', async () => {
  const messages = [];
  const handler = createWorkerHandler(msg => messages.push(msg));

  const c = new Chess();
  const f0 = c.fen();
  const m1 = c.move('e4');

  await handler({ id: 60, jobId: 'bad-mid', type: 'analyzeGame', fens: [f0, 'invalid-fen'], moves: [m1] });
  assert.equal(messages[0].id, 60);
  assert.equal(messages[0].ok, false);
  assert.ok(messages[0].error);

  // Terminal bestMove returns move: null
  const mateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
  await handler({ id: 61, type: 'bestMove', fen: mateFen, depth: 2 });
  assert.equal(messages[1].id, 61);
  assert.equal(messages[1].ok, true);
  assert.equal(messages[1].move, null);

  // bestMove respects depth: 0 (clamped to 1 inside findBestMove, pv length 1 instead of 3)
  await handler({ id: 62, type: 'bestMove', fen: f0, depth: 0 });
  assert.equal(messages[2].id, 62);
  assert.equal(messages[2].ok, true);
  assert.equal(messages[2].move.pv.length, 1);

  // Malformed / unknown messages do not throw or break subsequent calls
  await handler(null);
  await handler({ type: 'unknownOp' });
  await handler({ id: 63, type: 'evaluate', fen: f0, depth: 1 });
  assert.equal(messages[3].id, 63);
  assert.equal(messages[3].ok, true);
});

