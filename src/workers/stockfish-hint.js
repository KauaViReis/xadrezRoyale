/* ============================================================
   XADREZ ROYALE — Dica Stockfish 19 NNUE (WASM Web Worker)
   Carregamento sob demanda para manter boot rápido no mobile.
   ============================================================ */

import { Chess } from 'chess.js';

let sfWorker = null;
let sfReady = false;
let sfInitPromise = null;
let activeSearch = null;

function initStockfish() {
  if (sfReady && sfWorker) return Promise.resolve(true);
  if (sfInitPromise) return sfInitPromise;

  sfInitPromise = new Promise(resolve => {
    try {
      const worker = new Worker('/stockfish/stockfish-19-lite-single.js');
      let settled = false;
      const failTimer = setTimeout(() => {
        if (!settled) { settled = true; resolve(false); }
      }, 6000);

      worker.onerror = () => {
        clearTimeout(failTimer);
        if (!settled) { settled = true; resolve(false); }
      };

      worker.onmessage = e => {
        const line = typeof e.data === 'string' ? e.data : String(e.data || '');
        if (line === 'readyok') {
          clearTimeout(failTimer);
          sfReady = true;
          if (!settled) { settled = true; resolve(true); }
          return;
        }
        if (activeSearch) handleUciLine(line);
      };

      sfWorker = worker;
      worker.postMessage('uci');
      worker.postMessage('isready');
    } catch {
      resolve(false);
    }
  });

  return sfInitPromise;
}

function handleUciLine(line) {
  if (!activeSearch) return;

  if (line.startsWith('info ') && line.includes(' pv ')) {
    const scoreCpMatch = line.match(/\bscore cp (-?\d+)/);
    const scoreMateMatch = line.match(/\bscore mate (-?\d+)/);
    const pvPart = line.split(' pv ')[1];
    if (pvPart) {
      activeSearch.pvTokens = pvPart.trim().split(/\s+/).slice(0, 4);
    }
    if (scoreMateMatch) {
      const m = parseInt(scoreMateMatch[1], 10);
      activeSearch.mateIn = activeSearch.turn === 'w' ? m : -m;
      activeSearch.evalCp = activeSearch.mateIn > 0 ? 99999 : -99999;
    } else if (scoreCpMatch) {
      const cp = parseInt(scoreCpMatch[1], 10);
      activeSearch.mateIn = null;
      activeSearch.evalCp = activeSearch.turn === 'w' ? cp : -cp;
    }
    return;
  }

  if (line.startsWith('bestmove ')) {
    const bestUci = line.split(/\s+/)[1];
    const search = activeSearch;
    activeSearch = null;
    clearTimeout(search.timer);

    if (!bestUci || bestUci === '(none)') {
      search.resolve({ ok: false });
      return;
    }

    const tokens = search.pvTokens?.length ? search.pvTokens : [bestUci];
    if (tokens[0] !== bestUci) tokens.unshift(bestUci);

    const chess = new Chess(search.fen);
    const pv = [];
    for (const uci of tokens.slice(0, 4)) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      try {
        const mv = chess.move({ from, to, promotion });
        if (!mv) break;
        pv.push({ from: mv.from, to: mv.to, promotion: mv.promotion, san: mv.san });
      } catch {
        break;
      }
    }

    if (pv.length === 0) {
      search.resolve({ ok: false });
      return;
    }

    search.resolve({
      ok: true,
      engine: 'stockfish-19',
      move: {
        from: pv[0].from,
        to: pv[0].to,
        promotion: pv[0].promotion,
        san: pv[0].san,
        evalCp: search.evalCp,
        mateIn: search.mateIn,
        pv
      }
    });
  }
}

export async function getStockfishHint(fen, { depth = 14, movetime = 950 } = {}) {
  const ok = await initStockfish();
  if (!ok || !sfWorker) return { ok: false };

  if (activeSearch) {
    clearTimeout(activeSearch.timer);
    activeSearch.resolve({ ok: false, cancelled: true });
    activeSearch = null;
    sfWorker.postMessage('stop');
  }

  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (activeSearch && activeSearch.resolve === resolve) {
        activeSearch = null;
        try { sfWorker.postMessage('stop'); } catch { /* noop */ }
        resolve({ ok: false, timeout: true });
      }
    }, movetime + 2500);

    activeSearch = {
      fen,
      turn,
      pvTokens: [],
      evalCp: 0,
      mateIn: null,
      timer,
      resolve
    };

    sfWorker.postMessage(`position fen ${fen}`);
    sfWorker.postMessage(`go depth ${depth} movetime ${movetime}`);
  });
}
