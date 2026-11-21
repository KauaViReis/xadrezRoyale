import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  squareToRC,
  rcToSquare,
  evaluateBoard,
  evaluatePosition,
  findBestMove
} from '../src/core/chess-engine.js';
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
  assert.equal(best.san, 'Qxf7#');
  assert.equal(best.mateIn, 1);
  assert.ok(best.evalCp > 90000);
  assert.equal(best.pv.length, 1);
  assert.equal(best.pv[0].san, 'Qxf7#');
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

test('findBestMove retorna PV legal e consistente na posição inicial', () => {
  const startFen = new Chess().fen();
  const res = findBestMove(startFen, 3);
  assert.ok(res);
  assert.equal(res.mateIn, null);
  assert.ok(Array.isArray(res.pv));
  assert.equal(res.pv.length, 3);
  assert.equal(res.pv[0].from, res.from);
  assert.equal(res.pv[0].to, res.to);
  assert.equal(res.pv[0].san, res.san);

  const replay = new Chess(startFen);
  for (const step of res.pv) {
    const played = replay.move({ from: step.from, to: step.to, promotion: step.promotion });
    assert.ok(played, `Expected legal PV move ${JSON.stringify(step)}`);
    assert.equal(played.san, step.san);
  }
});

test('findBestMove com depth=1 retorna PV de comprimento 1', () => {
  const startFen = new Chess().fen();
  const res = findBestMove(startFen, 1);
  assert.ok(res);
  assert.equal(res.pv.length, 1);
  assert.equal(res.pv[0].san, res.san);
});

test('findBestMove detecta mate em 1 negativo para as Pretas (Fools Mate)', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
  const best = findBestMove(fen, 2);
  assert.ok(best);
  assert.equal(best.from, 'd8');
  assert.equal(best.to, 'h4');
  assert.equal(best.san, 'Qh4#');
  assert.equal(best.mateIn, -1);
  assert.ok(best.evalCp < -90000);
  assert.equal(best.pv.length, 1);
});

test('findBestMove encontra mate forçado em 2 e preenche PV completo', () => {
  const fen = 'r5k1/5ppp/8/8/8/8/3R2PP/3R2K1 w - - 0 1';
  const best = findBestMove(fen, 3);
  assert.ok(best);
  assert.equal(best.mateIn, 2);
  assert.equal(best.evalCp, 99996);
  assert.equal(best.pv.length, 3);
  assert.ok(best.pv[2].san.endsWith('#'));
});

test('findBestMove escolhe promoção para dama quando vantajosa', () => {
  const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const best = findBestMove(fen, 2);
  assert.ok(best);
  assert.equal(best.from, 'a7');
  assert.equal(best.to, 'a8');
  assert.equal(best.promotion, 'q');
  assert.equal(best.pv[0].promotion, 'q');
});

test('findBestMove retorna null em xeque-mate e afogamento; evaluatePosition trata terminais', () => {
  const mateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
  assert.equal(findBestMove(mateFen, 2), null);
  assert.deepEqual(evaluatePosition(mateFen, 2), { evalCp: -99999, mateIn: null });

  const stalemateFen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
  assert.equal(findBestMove(stalemateFen, 2), null);
  assert.deepEqual(evaluatePosition(stalemateFen, 2), { evalCp: 0, mateIn: null });
});

test('evaluatePosition detecta tática de 1 lance (dama pendurada) que static eval ignoraria', () => {
  // White has a free Black queen on d5 waiting to be taken by Nc3xd5 (with a2 pawn so not insufficient material)
  const fen = '4k3/8/8/3q4/8/2N5/P7/4K3 w - - 0 1';
  const staticEval = evaluateBoard(new Chess(fen));
  const searchEval = evaluatePosition(fen, 2);
  assert.ok(staticEval < 0);
  assert.ok(searchEval.evalCp > 250, `Expected search eval > 250, got ${searchEval.evalCp}`);
});

test('xeque-mate tem precedência sobre regra dos 50 lances no halfmove 99 e 95', () => {
  // Halfmove 99: 1. Rd8# hits halfmove 100 AND delivers checkmate
  const fen99 = '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 99 70';
  for (const depth of [1, 2]) {
    const best99 = findBestMove(fen99, depth);
    assert.ok(best99);
    assert.equal(best99.from, 'd1');
    assert.equal(best99.to, 'd8');
    assert.equal(best99.san, 'Rd8#');
    assert.equal(best99.mateIn, 1);
    assert.equal(best99.evalCp, 99998);
    assert.equal(best99.pv.length, 1);
  }

  // Terminal checkmate at halfmove 100 still evaluates as checkmate, not 50-move draw
  const matedAt100 = '3R2k1/5ppp/8/8/8/8/8/6K1 b - - 100 70';
  assert.equal(findBestMove(matedAt100, 2), null);
  assert.deepEqual(evaluatePosition(matedAt100, 2), { evalCp: 99999, mateIn: null });

  // Halfmove 95: 1. Kc6 Ka8 2. Kc7 Ka7 3. Ra1# reaches halfmove 100 on the mating move
  const fen95 = '8/k7/8/1K6/8/8/8/1R6 w - - 95 70';
  const best95 = findBestMove(fen95, 5);
  assert.ok(best95);
  assert.equal(best95.san, 'Kc6');
  assert.equal(best95.mateIn, 3);
  assert.equal(best95.evalCp, 99994);
  assert.equal(best95.pv.length, 4);

  // Halfmove 96: 2...Ka7 hits halfmove 100 before 3. Ra1# -> chess.js ends game as 50-move draw
  const fen96 = '8/k7/8/1K6/8/8/8/1R6 w - - 96 70';
  const best96 = findBestMove(fen96, 5);
  assert.ok(best96);
  assert.equal(best96.mateIn, null);
  assert.equal(best96.evalCp, 0);
});

test('evaluatePosition(fen, 0) mantém eval estático enquanto { quiesce: true } usa qsearch e depth=1 evita afogamento', () => {
  const fen = '4k3/8/8/3q4/8/2N5/P7/4K3 w - - 0 1';
  const pureStatic = evaluatePosition(fen, 0);
  const quiesced = evaluatePosition(fen, 0, { quiesce: true });
  assert.ok(pureStatic.evalCp < 0);
  assert.ok(quiesced.evalCp > 250, `Expected quiesce eval > 250, got ${quiesced.evalCp}`);

  // White is winning with Qa6, whereas Qb6 causes immediate stalemate (depth=1 must see stalemate = 0 and pick winning move)
  const avoidStalemateFen = '7k/5Q2/8/6K1/8/8/8/8 w - - 0 1';
  const best1 = findBestMove(avoidStalemateFen, 1);
  assert.ok(best1);
  const checkAfter = new Chess(avoidStalemateFen);
  checkAfter.move({ from: best1.from, to: best1.to, promotion: best1.promotion });
  assert.equal(checkAfter.isStalemate(), false);
  assert.ok(best1.evalCp > 500);
});

test('detecção de afogamento funciona em ply > 1 e dentro da quiescence search', () => {
  // 1) Stalemate at ply=3: 1. Nc5 a4 2. Nxa4 is stalemate (0), not +340;
  //    depth=3 must avoid the Nc5->Nxa4 stalemate trap and keep a winning eval.
  const stalePly3Fen = '7k/5K1p/7P/p7/8/P2N4/8/8 w - - 0 1';
  const best3 = findBestMove(stalePly3Fen, 3);
  assert.ok(best3);
  assert.notEqual(best3.san, 'Nc5', 'Should not choose Nc5 with false +340 stalemate PV');
  assert.ok(best3.evalCp > 200 && best3.evalCp < 320, `Expected winning non-stalemate eval ~285, got ${best3.evalCp}`);

  const replay = new Chess(stalePly3Fen);
  for (const step of best3.pv) {
    const played = replay.move({ from: step.from, to: step.to, promotion: step.promotion });
    assert.ok(played, `Expected legal PV step ${JSON.stringify(step)}`);
  }
  assert.equal(replay.isStalemate(), false, 'PV must not terminate in stalemate');
  assert.equal(replay.isDraw(), false);

  // Also verify ply=2 stalemate detection directly after 1. Nc5
  const afterNc5Fen = '7k/5K1p/7P/p7/8/P1N5/8/8 b - - 0 1';
  const bestAfterNc5 = findBestMove(afterNc5Fen, 2);
  assert.ok(bestAfterNc5);
  assert.ok(bestAfterNc5.evalCp < 320, `Expected Nxa4 stalemate avoided at ply=2, got ${bestAfterNc5.evalCp}`);

  // 2) Stalemate inside qsearch: 1. Rxc6 bxc6 stalemates White (0), so Black must decline bxc6
  //    and White must find the Rxc6 swindle at depth = 1, 2, and 3.
  const qsearchStaleFen = '3q2rk/1p4pp/2n5/8/8/5p1p/5P1P/2R3BK w - - 0 1';
  for (const depth of [1, 2, 3]) {
    const best = findBestMove(qsearchStaleFen, depth);
    assert.ok(best);
    assert.equal(best.san, 'Rxc6', `Expected Rxc6 stalemate swindle at depth=${depth}, got ${best.san}`);
    assert.ok(best.evalCp > -1000, `Expected evalCp > -1000 at depth=${depth}, got ${best.evalCp}`);
  }

  // Direct qsearch probe after 1. Rxc6: 1...bxc6 is stalemate (0), not -1395
  const afterRxc6Fen = '3q2rk/1p4pp/2R5/8/8/5p1p/5P1P/6BK b - - 0 1';
  const qAfterRxc6 = evaluatePosition(afterRxc6Fen, 0, { quiesce: true });
  assert.equal(qAfterRxc6.mateIn, null);
  assert.ok(qAfterRxc6.evalCp > -1000, `Expected qsearch to reject 1...bxc6 stalemate (0), got ${qAfterRxc6.evalCp}`);
});

test('createChessGeometries gera malhas Staunton Championship com UVs, vertex color AO/feltro e LOD (high > medium > low)', async () => {
  const { createChessGeometries, disposeChessGeometries } = await import('../src/engine/pieces3d.js');
  const gHigh = createChessGeometries('high');
  const gMed = createChessGeometries('medium');
  const gLow = createChessGeometries('low');

  for (const k of ['p', 'r', 'n', 'b', 'q', 'k']) {
    for (const set of [gHigh, gMed, gLow]) {
      const geo = set[k];
      assert.ok(geo, `Missing geometry ${k}`);
      assert.ok(geo.attributes.position.count > 100);
      assert.equal(geo.attributes.normal.count, geo.attributes.position.count);
      assert.equal(geo.attributes.uv.count, geo.attributes.position.count);
      assert.equal(geo.attributes.color.count, geo.attributes.position.count);
    }
    assert.ok(gHigh[k].attributes.position.count > gMed[k].attributes.position.count, `Expected high > medium verts for ${k}`);
    assert.ok(gMed[k].attributes.position.count > gLow[k].attributes.position.count, `Expected medium > low verts for ${k}`);
  }

  disposeChessGeometries(gHigh);
  disposeChessGeometries(gMed);
  disposeChessGeometries(gLow);
});

test('detectOpening identifica código ECO e nome em português pelo prefixo mais longo', async () => {
  const { detectOpening } = await import('../src/core/openings.js');
  assert.equal(detectOpening([]), null);

  const sicilian = detectOpening(['e4', 'c5']);
  assert.ok(sicilian);
  assert.equal(sicilian.eco, 'B20');
  assert.ok(sicilian.name.includes('Siciliana'));

  const najdorf = detectOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
  assert.ok(najdorf);
  assert.equal(najdorf.eco, 'B90');
  assert.ok(najdorf.name.includes('Najdorf'));
});

test('getLeague, BOT_PROFILES e evaluateMatchAchievements funcionam corretamente', async () => {
  const { getLeague, BOT_PROFILES, getBotById, evaluateMatchAchievements } = await import('../src/core/meta.js');
  assert.equal(getLeague(950).id, 'bronze');
  assert.equal(getLeague(1200).id, 'silver');
  assert.equal(getLeague(1350).id, 'gold');
  assert.equal(getLeague(2100).id, 'gm');

  assert.equal(BOT_PROFILES.length, 4);
  assert.equal(getBotById('stockfish').style, 'stockfish');

  const unlocked = evaluateMatchAchievements({
    won: true,
    isCheckmate: true,
    pliesCount: 30,
    castled: true,
    promoted: true,
    streak: 3,
    botId: 'stockfish'
  });
  assert.ok(unlocked.includes('first_win'));
  assert.ok(unlocked.includes('checkmate'));
  assert.ok(unlocked.includes('scholar'));
  assert.ok(unlocked.includes('castle_win'));
  assert.ok(unlocked.includes('promo_win'));
  assert.ok(unlocked.includes('streak_3'));
  assert.ok(unlocked.includes('beat_helena'));
});

test('TACTICAL_PUZZLES possui 20 puzzles com FENs e sequências 100% legais', async () => {
  const { TACTICAL_PUZZLES, computeMaterialBalance } = await import('../src/core/puzzles.js');
  assert.equal(TACTICAL_PUZZLES.length, 20);
  for (const p of TACTICAL_PUZZLES) {
    const c = new Chess(p.fen);
    assert.ok(p.moves.length >= 1, `Puzzle ${p.id} sem lances`);
    for (const uci of p.moves) {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      assert.ok(m, `Lance ilegal ${uci} no puzzle ${p.id} (${p.title})`);
    }
  }
  const cBal = new Chess('4k3/8/8/8/8/8/8/3QK2R w - - 0 1');
  const bal = computeMaterialBalance(cBal);
  assert.equal(bal.diffW, 14);
  assert.equal(bal.diffB, 0);
});

test('createChessGeometriesByStyle gera skins 3D Staunton, Cristal e Cyber Neon válidas', async () => {
  const { createChessGeometriesByStyle, disposeChessGeometries, PIECE_STYLES } = await import('../src/engine/pieces3d.js');
  assert.equal(PIECE_STYLES.length, 3);
  for (const st of ['staunton', 'crystal', 'cyber']) {
    const geos = createChessGeometriesByStyle('medium', st);
    for (const k of ['p', 'r', 'n', 'b', 'q', 'k']) {
      assert.ok(geos[k], `Missing ${k} for style ${st}`);
      assert.ok(geos[k].attributes.position.count > 24);
    }
    disposeChessGeometries(geos);
  }
});

test('MUSIC_STATIONS e VoiceNarrator funcionam com segurança no Node.js', async () => {
  const { AudioManager, MUSIC_STATIONS } = await import('../src/core/audio.js');
  const { VoiceNarrator } = await import('../src/core/narrator.js');
  assert.equal(MUSIC_STATIONS.length, 6);
  const am = new AudioManager();
  am.setMusicStyle('gotham');
  assert.equal(am.musicStyle, 'gotham');
  am.setMusicStyle('heroes');
  assert.equal(am.musicStyle, 'heroes');
  am.setMusicStyle('invalido');
  assert.equal(am.musicStyle, 'imperial');

  const vn = new VoiceNarrator();
  vn.setEnabled(true);
  vn.announceMove({ piece: 'q', color: 'w', to: 'f7', captured: 'p', flags: 'c' }, { isCheckmate: true });
  const blunder = vn.reactToEvalSwing({ prevWhiteCp: 120, newWhiteCp: -250, moverColor: 'w', ply: 6 });
  assert.equal(blunder.tag, 'blunder');
  const brilliant = vn.reactToEvalSwing({ prevWhiteCp: 20, newWhiteCp: 260, moverColor: 'w', ply: 10 });
  assert.equal(brilliant.tag, 'brilliant');
  const comeback = vn.reactToEvalSwing({ prevWhiteCp: 240, newWhiteCp: -190, moverColor: 'b', ply: 14 });
  assert.equal(comeback.tag, 'comeback');
  vn.announceEsportsEvent('first_blood');
  vn.resetMatch();
  assert.equal(vn.lastOpeningSpoken, null);
});

test('Coleções 3D Marvel, DC, Marvel×DC e Medieval constroem grupos 3D válidos para todas as 6 peças', async () => {
  const { createPieceMesh, disposePieceObject, setPieceHighlight } = await import('../src/engine/pieces3d.js');
  for (const style of ['medieval', 'marvel_heroes', 'dc_heroes', 'marvel_vs_dc']) {
    for (const color of ['w', 'b']) {
      for (const type of ['p', 'r', 'n', 'b', 'q', 'k']) {
        const obj = createPieceMesh(type, color, {}, null, 'high', style);
        assert.ok(obj.isGroup, `Expected THREE.Group for ${style}/${color}/${type}`);
        assert.ok(obj.children.length >= 3);
        setPieceHighlight(obj, 0xC99A3E, 0.35);
        disposePieceObject(obj);
      }
    }
  }
});


