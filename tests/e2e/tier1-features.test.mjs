/* ============================================================
   Xadrez Royale 3D — Tier 1 E2E Suite (Happy-Path Features)
   Opaque-box CDP tests covering >= 5 happy paths across all 9 areas.
   ============================================================ */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { startViteServer, launchBrowser, sleep } from './helpers/cdp.mjs';
import {
  ensureView2D,
  squareToXY,
  clickSquare,
  getHistPlies,
  getHistMoves,
  playMove,
  rightClickSquare,
  rightDragArrow,
  touchTapSquare,
  touchDragArrow,
  assertHudNoOverlap
} from './helpers/board.mjs';

const VIP_EMAIL = 'elkaua1227@gmail.com';
const NON_VIP_EMAIL = 'challenger@example.com';

function decodePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error('Invalid PNG signature');
  }
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < height; y++) {
    const srcOff = y * (stride + 1);
    const filter = raw[srcOff];
    const rowOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[srcOff + 1 + x];
      const a = x >= bpp ? pixels[rowOff + x - bpp] : 0;
      const b = y > 0 ? pixels[rowOff - stride + x] : 0;
      const c = (y > 0 && x >= bpp) ? pixels[rowOff - stride + x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paeth(a, b, c)) & 0xff;
      pixels[rowOff + x] = recon;
    }
  }
  return { width, height, bpp, pixels };
}

async function sampleSquareRGB(page, sq, { side = 'w', topDown = true, size = 20 } = {}) {
  const { x, y } = await squareToXY(page, sq, { side, topDown });
  const clip = {
    x: Math.max(0, Math.round(x - size / 2)),
    y: Math.max(0, Math.round(y - size / 2)),
    width: size,
    height: size,
    scale: 1
  };
  const { data } = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip });
  const { width, height, bpp, pixels } = decodePng(Buffer.from(data, 'base64'));
  let r = 0, g = 0, b = 0;
  const n = width * height;
  for (let i = 0; i < pixels.length; i += bpp) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return { r: r / n, g: g / n, b: b / n };
}

async function sampleCenterCanvasStats(page) {
  const box = await page.boundingBox('#c3d');
  assert.ok(box && box.width > 100 && box.height > 100, 'Expected full #c3d canvas');
  const size = 140;
  const clip = {
    x: Math.round(box.cx - size / 2),
    y: Math.round(box.cy - size / 2),
    width: size,
    height: size,
    scale: 1
  };
  const { data } = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip });
  const { bpp, pixels } = decodePng(Buffer.from(data, 'base64'));
  let sum = 0;
  let min = 255;
  let max = 0;
  const count = pixels.length / bpp;
  for (let i = 0; i < pixels.length; i += bpp) {
    const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sum += lum;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  return { meanLum: sum / count, contrast: max - min, min, max };
}

function colorDist(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

async function safeGoto(page, url, timeoutMs = 40000) {
  await page.bringToFront().catch(() => {});
  await page.cdp.send('Page.navigate', { url });
  await page.waitFor(
    () => document.readyState === 'complete' && Boolean(document.querySelector('#menuOverlay')),
    { timeoutMs, intervalMs: 100, message: `safeGoto(${url}) did not become ready` }
  );
  await sleep(150);
}

async function safeReload(page, timeoutMs = 40000) {
  await page.bringToFront().catch(() => {});
  await page.cdp.send('Page.reload', { ignoreCache: false });
  await page.waitFor(
    () => document.readyState === 'complete' && Boolean(document.querySelector('#menuOverlay')),
    { timeoutMs, intervalMs: 100, message: 'safeReload did not become ready' }
  );
  await sleep(150);
}

async function ensureLoadedFresh(page, url, opts = {}) {
  page.clearErrors();
  if (opts.viewport) {
    await page.setViewport(opts.viewport);
  }
  const currentUrl = await page.evalJs(() => location.href).catch(() => '');
  if (!currentUrl.startsWith(url) || opts.hardReload) {
    if (currentUrl.startsWith('http')) {
      await page.evalJs(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* noop */ }
      });
    }
    await safeGoto(page, url);
    return;
  }

  // In-page clean UI reset to avoid 16s WebGL/Vite cold reload per test
  await page.evalJs(() => {
    try { localStorage.clear(); } catch { /* noop */ }
    for (const id of ['settingsOverlay', 'lbOverlay', 'overOverlay', 'promoModal']) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hide')) {
        if (id === 'settingsOverlay') document.getElementById('btnCloseSettings')?.click();
        else if (id === 'lbOverlay') document.getElementById('btnCloseLb')?.click();
        else if (id === 'overOverlay') document.getElementById('btnOverMenu')?.click();
      }
    }
    const arrowBtn = document.getElementById('btnArrows');
    if (arrowBtn && arrowBtn.classList.contains('active')) arrowBtn.click();
    const menu = document.getElementById('menuOverlay');
    if (menu && menu.classList.contains('hide')) {
      document.getElementById('btnNewMenu')?.click();
    }
    if (window.__e2eContextMenuEvents) window.__e2eContextMenuEvents.length = 0;
    if (window.__e2eVibrateCalls) window.__e2eVibrateCalls.length = 0;
  });

  // Restore default UI settings via real clicks if changed by prior test
  if (await page.text('#btnSound') === '🔇') {
    await page.click('#btnSound');
  }
  await page.click('#btnSettings');
  await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
  if (!(await page.hasClass('#segEval .seg[data-val="0"]', 'active'))) {
    await page.click('#segEval .seg[data-val="0"]');
  }
  if (await page.exists('#segQuality .seg[data-val="auto"]') && !(await page.hasClass('#segQuality .seg[data-val="auto"]', 'active'))) {
    await page.click('#segQuality .seg[data-val="auto"]');
  }
  if (await page.exists('#segHaptics .seg[data-val="1"]') && !(await page.hasClass('#segHaptics .seg[data-val="1"]', 'active'))) {
    await page.click('#segHaptics .seg[data-val="1"]');
  }
  await page.evalJs(() => {
    const b0 = document.querySelectorAll('#boardSwatches .swatch-btn')[0];
    if (b0 && !b0.classList.contains('active')) b0.click();
    const p0 = document.querySelectorAll('#pieceSwatches .swatch-btn')[0];
    if (p0 && !p0.classList.contains('active')) p0.click();
  });
  await page.click('#btnCloseSettings');
  await page.waitFor(() => page.hasClass('#settingsOverlay', 'hide'), { timeoutMs: 2500 });
  await page.waitForSelector('#menuOverlay:not(.hide)', { visible: true, timeoutMs: 3000 });
}

async function toggleView2D(page, wantActive) {
  const isActive = await page.hasClass('#btnView2D', 'active');
  if (isActive !== wantActive) {
    await page.click('#btnView2D');
    await page.waitFor(
      async () => (await page.hasClass('#btnView2D', 'active')) === wantActive,
      { timeoutMs: 4000, message: `#btnView2D active did not become ${wantActive}` }
    );
    await sleep(120);
  }
}

async function startLocalMatch(page, {
  mode = 'pve',
  diff = '1',
  side = 'w',
  tc = '0',
  to2D = true
} = {}) {
  await page.click(`#segMode .seg[data-val="${mode}"]`);
  if (mode === 'pve') {
    await page.click(`#segDiff .seg[data-val="${diff}"]`);
    await page.click(`#segSide .seg[data-val="${side}"]`);
  }
  await page.click(`#segTcLocal .seg[data-val="${tc}"]`);
  await page.click('#btnStartLocal');
  await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), {
    timeoutMs: 4000,
    message: '#menuOverlay did not hide on #btnStartLocal'
  });
  await toggleView2D(page, to2D);
}

async function pvpMove(page, fromSq, toSq, opts = {}) {
  await playMove(page, fromSq, toSq, opts);
  if (opts.waitForFlip) {
    await sleep(220);
  }
}

async function playFoolsMatePvP(page) {
  await pvpMove(page, 'f2', 'f3', { side: 'w', waitForFlip: true });
  await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
  await pvpMove(page, 'g2', 'g4', { side: 'w', waitForFlip: true });
  await pvpMove(page, 'd8', 'h4', { side: 'b', waitForFlip: false });
  await page.waitFor(() => page.isVisible('#overOverlay:not(.hide)'), {
    timeoutMs: 5000,
    message: '#overOverlay did not appear on Fool\'s Mate'
  });
}

async function waitForPlies(page, minPlies, timeoutMs = 10000) {
  await page.waitFor(
    async () => (await getHistPlies(page)) >= minPlies,
    { timeoutMs, intervalMs: 50, message: `Expected at least ${minPlies} plies in #histList` }
  );
}

async function requireSelector(page, sel, msg) {
  const ok = await page.exists(sel);
  assert.equal(ok, true, msg || `Required M3 element ${sel} does not exist in DOM`);
}

/* ============================================================
   SUITE ROOT
   ============================================================ */
describe('Tier 1 — Feature Happy-Path E2E Suite', () => {
  let server;
  let sharedBrowser;
  let page;

  before(async () => {
    server = await startViteServer({
      mode: 'dev',
      envOverride: { VITE_FIREBASE_API_KEY: '' }
    });
    sharedBrowser = await launchBrowser({ viewport: { width: 1280, height: 800 } });
    page = sharedBrowser.page;
    await safeGoto(page, server.url);
  });

  after(async () => {
    await sharedBrowser?.close();
    await server?.close();
  });

  /* ----------------------------------------------------------
     AREA 1: Local Play (PvE, PvP, Clocks, Promo, View2D, Flip, Endgames)
     ---------------------------------------------------------- */
  describe('Area 1 — Local Play', () => {
    it('T1.1.1 PvE White Casual: starts match, executes e2->e4 and AI responds', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });

      assert.equal(await page.text('#nameW'), 'BRANCAS');
      assert.equal(await page.text('#nameB'), 'MÁQUINA');
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');
      assert.equal(await page.hasClass('#cardW', 'active'), true);
      assert.equal(await page.isVisible('#btnUndo'), false);
      assert.equal(await page.isVisible('#btnResign'), true);

      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });
      assert.equal(await getHistPlies(page), 2);
      const moves = await getHistMoves(page);
      assert.equal(moves[0], 'e4');
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');
      assert.equal(await page.isVisible('#btnUndo'), true);
      page.assertNoErrors('T1.1.1');
    });

    it('T1.1.2 PvE Black Casual: AI moves first, player replies with Black projection', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pve', diff: '1', side: 'b', tc: '0' });

      assert.equal(await page.text('#nameW'), 'MÁQUINA');
      assert.equal(await page.text('#nameB'), 'PRETAS');

      await page.waitFor(
        async () => (await getHistPlies(page)) === 1 && (await page.text('#turnTxt')) === 'VEZ DAS PRETAS',
        { timeoutMs: 8000, message: 'AI did not complete opening move for White' }
      );

      await playMove(page, 'a7', 'a6', { side: 'b', waitForAI: true });
      assert.equal(await getHistPlies(page), 3);
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS PRETAS');
      page.assertNoErrors('T1.1.2');
    });

    it('T1.1.3 PvP 2-Player mode: plays alternating turns with automatic board flip', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      assert.equal(await page.text('#nameW'), 'BRANCAS');
      assert.equal(await page.text('#nameB'), 'PRETAS');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS PRETAS');

      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');

      await pvpMove(page, 'g1', 'f3', { side: 'w', waitForFlip: true });
      const moves = await getHistMoves(page);
      assert.deepEqual(moves, ['e4', 'e5', 'Nf3']);
      page.assertNoErrors('T1.1.3');
    });

    it('T1.1.4 Timed Local Clocks: White clock decrements while Black waits, then switches on move', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '180000' });

      assert.equal(await page.isVisible('#clockW'), true);
      assert.equal(await page.isVisible('#clockB'), true);
      assert.equal(await page.text('#clockB'), '03:00');

      await page.waitFor(
        async () => {
          const w = await page.text('#clockW');
          return w && w !== '03:00';
        },
        { timeoutMs: 4000, message: '#clockW did not start decrementing' }
      );
      assert.equal(await page.text('#clockB'), '03:00');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await page.waitFor(
        async () => {
          const b = await page.text('#clockB');
          return b && b !== '03:00';
        },
        { timeoutMs: 4000, message: '#clockB did not decrement after White moved' }
      );
      page.assertNoErrors('T1.1.4');
    });

    it('T1.1.5 Pawn Promotion (=Q) & Underpromotion (=N): #promoModal updates board & SAN', async () => {
      const promoSeq = [
        ['h2', 'h4', 'w'], ['g7', 'g5', 'b'],
        ['h4', 'g5', 'w'], ['a7', 'a6', 'b'],
        ['g5', 'g6', 'w'], ['a6', 'a5', 'b'],
        ['g6', 'h7', 'w'], ['a5', 'a4', 'b']
      ];

      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      for (const [f, t, s] of promoSeq) {
        await pvpMove(page, f, t, { side: s, waitForFlip: true });
      }
      await pvpMove(page, 'h7', 'g8', { side: 'w', promotion: 'q', waitForFlip: true });
      assert.equal(await page.hasClass('#promoModal', 'hide'), true);
      let moves = await getHistMoves(page);
      assert.match(moves[moves.length - 1], /=Q/);

      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      for (const [f, t, s] of promoSeq) {
        await pvpMove(page, f, t, { side: s, waitForFlip: true });
      }
      await pvpMove(page, 'h7', 'g8', { side: 'w', promotion: 'n', waitForFlip: true });
      assert.equal(await page.hasClass('#promoModal', 'hide'), true);
      moves = await getHistMoves(page);
      assert.match(moves[moves.length - 1], /=N/);
      page.assertNoErrors('T1.1.5');
    });

    it('T1.1.6 #btnView2D & #btnFlip: toggles 2D/3D view and flips board orientation 180 deg', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0', to2D: false });

      assert.equal(await page.hasClass('#btnView2D', 'active'), false);
      await toggleView2D(page, true);
      assert.equal(await page.hasClass('#btnView2D', 'active'), true);

      await page.click('#btnFlip');
      await sleep(750);
      await pvpMove(page, 'e2', 'e4', { side: 'b', ensure2D: false, waitForFlip: true });
      const moves = await getHistMoves(page);
      assert.deepEqual(moves, ['e4']);

      await toggleView2D(page, false);
      assert.equal(await page.hasClass('#btnView2D', 'active'), false);
      page.assertNoErrors('T1.1.6');
    });

    it('T1.1.7 Check, Checkmate & Threefold Repetition Draw: endgames & #turnSub', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'd1', 'h5', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'g7', 'g6', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'h5', 'e5', { side: 'w', waitForFlip: true });
      assert.equal(await page.isVisible('#turnSub'), true);
      assert.match(await page.text('#turnSub'), /XEQUE/i);

      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);
      assert.equal(await page.text('#overTitle'), 'Pretas Vencem');
      assert.match(await page.text('#overSub'), /Xeque-mate/i);

      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      const repSeq = [
        ['g1', 'f3', 'w'], ['g8', 'f6', 'b'],
        ['f3', 'g1', 'w'], ['f6', 'g8', 'b'],
        ['g1', 'f3', 'w'], ['g8', 'f6', 'b'],
        ['f3', 'g1', 'w'], ['f6', 'g8', 'b']
      ];
      for (let i = 0; i < repSeq.length; i++) {
        const [f, t, s] = repSeq[i];
        await pvpMove(page, f, t, { side: s, waitForFlip: i < repSeq.length - 1 });
      }
      await page.waitForSelector('#overOverlay:not(.hide)', { visible: true, timeoutMs: 4000 });
      assert.equal(await page.text('#overTitle'), 'Empate');
      assert.match(await page.text('#overSub'), /Tripla repetição/i);
      page.assertNoErrors('T1.1.7');
    });
  });

  /* ----------------------------------------------------------
     AREA 2: Manual Arrows PC & Mobile "Setas"
     ---------------------------------------------------------- */
  describe('Area 2 — Manual Arrows PC & Mobile', () => {
    it('T1.2.1 PC right-drag draws Green arrow and suppresses contextmenu without moving pieces', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const beforeRGB = await sampleSquareRGB(page, 'e3');
      await rightDragArrow(page, 'e2', 'e4', { side: 'w' });
      await sleep(120);
      const afterRGB = await sampleSquareRGB(page, 'e3');

      assert.equal(await getHistPlies(page), 0);
      assert.ok(afterRGB.g - beforeRGB.g > 15, `Expected green arrow increase on e3: before=${JSON.stringify(beforeRGB)}, after=${JSON.stringify(afterRGB)}`);

      await rightClickSquare(page, 'd5', { side: 'w' });
      const ctxEvents = await page.evalJs(() => window.__e2eContextMenuEvents || []);
      assert.ok(ctxEvents.length >= 1, 'Expected contextmenu event on #c3d');
      assert.equal(ctxEvents.every((e) => e.defaultPrevented === true), true, 'contextmenu must be prevented on #c3d');
      page.assertNoErrors('T1.2.1');
    });

    it('T1.2.2 PC right-drag modifiers: Shift=Red, Alt=Blue, Ctrl=Yellow arrows', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const baseA3 = await sampleSquareRGB(page, 'a3');
      const baseC3 = await sampleSquareRGB(page, 'c3');
      const baseG3 = await sampleSquareRGB(page, 'g3');

      await rightDragArrow(page, 'a2', 'a4', { shift: true, side: 'w' });
      await rightDragArrow(page, 'c2', 'c4', { alt: true, side: 'w' });
      await rightDragArrow(page, 'g2', 'g4', { ctrl: true, side: 'w' });
      await sleep(120);

      const redA3 = await sampleSquareRGB(page, 'a3');
      const blueC3 = await sampleSquareRGB(page, 'c3');
      const yellowG3 = await sampleSquareRGB(page, 'g3');

      assert.ok(redA3.r - baseA3.r > 15 && redA3.r > redA3.b, `Expected Shift=Red on a3: ${JSON.stringify(redA3)} vs ${JSON.stringify(baseA3)}`);
      assert.ok(blueC3.b - baseC3.b > 15 && blueC3.b > blueC3.r, `Expected Alt=Blue on c3: ${JSON.stringify(blueC3)} vs ${JSON.stringify(baseC3)}`);
      assert.ok((yellowG3.r + yellowG3.g) - (baseG3.r + baseG3.g) > 25 && yellowG3.r > yellowG3.b, `Expected Ctrl=Yellow on g3: ${JSON.stringify(yellowG3)} vs ${JSON.stringify(baseG3)}`);
      assert.equal(await getHistPlies(page), 0);
      page.assertNoErrors('T1.2.2');
    });

    it('T1.2.3 PC right-click marks square cleanly', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const baseD4 = await sampleSquareRGB(page, 'd4');
      await rightClickSquare(page, 'd4', { side: 'w' });
      await sleep(100);
      const markedD4 = await sampleSquareRGB(page, 'd4');

      assert.ok(markedD4.g - baseD4.g > 15, `Expected green square mark on d4: ${JSON.stringify(markedD4)} vs ${JSON.stringify(baseD4)}`);
      assert.equal(await getHistPlies(page), 0);
      page.assertNoErrors('T1.2.3');
    });

    it('T1.2.4 PC left-click clears all manual arrows and square marks', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const baseD4 = await sampleSquareRGB(page, 'd4');
      const baseE3 = await sampleSquareRGB(page, 'e3');

      await rightClickSquare(page, 'd4', { shift: true, side: 'w' });
      await rightDragArrow(page, 'e2', 'e4', { side: 'w' });
      await sleep(100);

      assert.ok(colorDist(await sampleSquareRGB(page, 'd4'), baseD4) > 15, 'Mark should be visible before clear');
      assert.ok(colorDist(await sampleSquareRGB(page, 'e3'), baseE3) > 15, 'Arrow should be visible before clear');

      await clickSquare(page, 'h5', { button: 'left', side: 'w' });
      await sleep(100);

      const clearedD4 = await sampleSquareRGB(page, 'd4');
      const clearedE3 = await sampleSquareRGB(page, 'e3');
      assert.ok(colorDist(clearedD4, baseD4) < 12, `Expected mark cleared on d4: ${JSON.stringify(clearedD4)} vs ${JSON.stringify(baseD4)}`);
      assert.ok(colorDist(clearedE3, baseE3) < 12, `Expected arrow cleared on e3: ${JSON.stringify(clearedE3)} vs ${JSON.stringify(baseE3)}`);
      page.assertNoErrors('T1.2.4');
    });

    it('T1.2.5 Mobile #btnArrows toggle shows #arrowChip with color & clear buttons without HUD overlap', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 390, height: 844, mobile: true, hasTouch: true } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await requireSelector(page, '#btnArrows', 'Missing mobile #btnArrows button');
      assert.equal(await page.isVisible('#btnArrows'), true);
      assert.equal(await page.isVisible('#arrowChip'), false);
      await assertHudNoOverlap(page);

      const boxBtn = await page.boundingBox('#btnArrows');
      await page.touchTap(boxBtn.cx, boxBtn.cy);
      await page.waitForSelector('#arrowChip', { visible: true, timeoutMs: 2500 });

      assert.equal(await page.hasClass('#btnArrows', 'active'), true);
      assert.equal(await page.evalJs(() => document.querySelector('#btnArrows')?.getAttribute('aria-pressed')), 'true');
      await assertHudNoOverlap(page);

      const chipButtons = await page.evalJs(() => document.querySelectorAll('#arrowChip button').length);
      assert.ok(chipButtons >= 5, `Expected 4 color buttons + clear button in #arrowChip, got ${chipButtons}`);
      page.assertNoErrors('T1.2.5');
    });

    it('T1.2.6 Mobile arrowMode touch tap marks & touch drag draws arrow without moving pieces, then exits cleanly', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 390, height: 844, mobile: true, hasTouch: true } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await requireSelector(page, '#btnArrows', 'Missing mobile #btnArrows button');
      const baseD4 = await sampleSquareRGB(page, 'd4');
      const baseE3 = await sampleSquareRGB(page, 'e3');

      const boxBtn = await page.boundingBox('#btnArrows');
      await page.touchTap(boxBtn.cx, boxBtn.cy);
      await page.waitForSelector('#arrowChip', { visible: true, timeoutMs: 2500 });

      await touchTapSquare(page, 'd4', { side: 'w' });
      await touchDragArrow(page, 'e2', 'e4', { side: 'w' });
      await sleep(100);

      assert.equal(await getHistPlies(page), 0);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd4'), baseD4) > 12, 'Mobile tap in arrowMode should mark d4');
      assert.ok(colorDist(await sampleSquareRGB(page, 'e3'), baseE3) > 12, 'Mobile drag in arrowMode should draw arrow e2->e4');

      await page.evalJs(() => {
        const btns = [...document.querySelectorAll('#arrowChip button')];
        const clr = btns.find((b) => /limpar|clear|trash|✕|🗑/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.dataset.action || '')));
        (clr || btns[btns.length - 1])?.click();
      });
      await sleep(100);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd4'), baseD4) < 12, 'Clear button in #arrowChip should clear mark');

      await page.touchTap(boxBtn.cx, boxBtn.cy);
      await page.waitFor(async () => !(await page.isVisible('#arrowChip')), { timeoutMs: 2500, message: '#arrowChip did not hide' });
      assert.equal(await page.hasClass('#btnArrows', 'active'), false);

      await touchTapSquare(page, 'e2', { side: 'w' });
      await sleep(60);
      await touchTapSquare(page, 'e4', { side: 'w' });
      await waitForPlies(page, 1, 5000);
      page.assertNoErrors('T1.2.6');
    });
  });

  /* ----------------------------------------------------------
     AREA 3: New 3D Hint + Ghost + PV
     ---------------------------------------------------------- */
  describe('Area 3 — New 3D Hint + Ghost + PV', () => {
    it('T1.3.1 #btnHint shows loading state and resolves to visible #hintBanner', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      assert.equal(await page.isVisible('#btnHint'), true);
      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });
      assert.equal(await page.isVisible('#hintBanner'), true);
      page.assertNoErrors('T1.3.1');
    });

    it('T1.3.2 #hintBanner shows suggested move and PV continuation line', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });

      const bannerTxt = (await page.text('#hintBanner')) || '';
      const moveTokens = bannerTxt.match(/\b([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?)\b/g) || [];
      assert.ok(moveTokens.length >= 2, `Expected PV line with >=2 move tokens in #hintBanner, got "${bannerTxt}"`);
      page.assertNoErrors('T1.3.2');
    });

    it('T1.3.3 Hint is non-destructive to lastMove highlight on e7/e5', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      const e7Before = await sampleSquareRGB(page, 'e7', { side: 'w' });
      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });
      await sleep(120);

      const bannerTxt = await page.text('#hintBanner');
      if (!/\be7\b/i.test(bannerTxt || '')) {
        const e7After = await sampleSquareRGB(page, 'e7', { side: 'w' });
        assert.ok(colorDist(e7After, e7Before) < 15, 'e7 lastMove highlight must remain intact after hint');
      }
      page.assertNoErrors('T1.3.3');
    });

    it('T1.3.4 Clicking dismiss on #hintBanner hides banner and clears 3D hint', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');

      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });

      await page.evalJs(() => {
        const banner = document.querySelector('#hintBanner');
        const btn = banner?.querySelector('button, [role="button"]');
        (btn || banner)?.click();
      });

      await page.waitFor(async () => !(await page.isVisible('#hintBanner')), {
        timeoutMs: 2500,
        message: '#hintBanner did not hide after dismiss'
      });
      page.assertNoErrors('T1.3.4');
    });

    it('T1.3.5 Making a legal move while #hintBanner is open clears the hint', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');

      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      assert.equal(await page.isVisible('#hintBanner'), false);
      page.assertNoErrors('T1.3.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 4: Online Premove & Rooms (2-Tab BroadcastChannel Double)
     ---------------------------------------------------------- */
  describe('Area 4 — Online Premove & Rooms', () => {
    let onlineBrowser;
    let tabA;
    let tabB;

    before(async () => {
      onlineBrowser = await launchBrowser({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: NON_VIP_EMAIL,
        onlineNick: 'ALICE'
      });
      tabA = onlineBrowser.page;
      tabB = await onlineBrowser.newPage({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: NON_VIP_EMAIL,
        onlineNick: 'BOB'
      });
      await safeGoto(tabA, server.url);
      await safeGoto(tabB, server.url);
    });

    after(async () => {
      await onlineBrowser?.close();
    });

    async function resetOnlineTabs() {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabB.bringToFront();
      await ensureLoadedFresh(tabB, server.url);
    }

    async function pairViaRoomCode() {
      await tabA.bringToFront();
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.waitForSelector('#onlineActions', { visible: true, timeoutMs: 3000 });
      await tabA.click('#btnCreateRoom');
      await tabA.waitForSelector('#roomBox', { visible: true, timeoutMs: 3000 });
      const code = (await tabA.text('#roomCodeTxt')).trim();
      assert.ok(code.length >= 4, `Expected room code, got "${code}"`);

      await tabB.bringToFront();
      await tabB.click('#segMode .seg[data-val="online"]');
      await tabB.waitForSelector('#onlineActions', { visible: true, timeoutMs: 3000 });
      await tabB.click('#btnShowJoin');
      await tabB.waitForSelector('#joinBox', { visible: true, timeoutMs: 2500 });
      await tabB.type('#joinInput', code);
      await tabB.click('#btnJoinRoom');

      await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000, message: 'Tab B did not enter game' });
      await tabA.bringToFront();
      await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000, message: 'Tab A did not enter game' });

      await toggleView2D(tabA, true);
      await tabB.bringToFront();
      await toggleView2D(tabB, true);
      await tabA.bringToFront();
      return code;
    }

    it('T1.4.1 2-Tab Create Room & Join via #joinInput starts active match on both tabs', async () => {
      await resetOnlineTabs();
      await pairViaRoomCode();

      assert.equal(await tabA.text('#nameW'), 'ALICE');
      assert.equal(await tabA.text('#nameB'), 'BOB');
      assert.equal(await tabB.text('#nameW'), 'ALICE');
      assert.equal(await tabB.text('#nameB'), 'BOB');
      assert.equal(await tabA.isVisible('#clockW'), true);
      assert.equal(await tabB.isVisible('#clockB'), true);

      tabA.assertNoErrors('T1.4.1-A');
      tabB.assertNoErrors('T1.4.1-B');
    });

    it('T1.4.2 Join via ?room=CODE URL auto-joins Tab B into Tab A room', async () => {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.waitForSelector('#onlineActions', { visible: true, timeoutMs: 3000 });
      await tabA.click('#btnCreateRoom');
      await tabA.waitForSelector('#roomBox', { visible: true, timeoutMs: 3000 });
      const code = (await tabA.text('#roomCodeTxt')).trim();

      tabB.clearErrors();
      await safeGoto(tabB, `${server.url}/?room=${encodeURIComponent(code)}`);
      await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000, message: '?room= auto-join failed on Tab B' });
      await tabA.bringToFront();
      await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000, message: 'Tab A did not start after ?room= join' });

      tabA.assertNoErrors('T1.4.2-A');
      tabB.assertNoErrors('T1.4.2-B');
    });

    it('T1.4.3 2-Tab Quick Match pairs two players automatically', async () => {
      await resetOnlineTabs();
      await tabA.bringToFront();
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.waitForSelector('#onlineActions', { visible: true, timeoutMs: 3000 });
      await tabA.click('#btnQuickMatch');
      await tabA.waitForSelector('#searchBox', { visible: true, timeoutMs: 3000 });

      await tabB.bringToFront();
      await tabB.click('#segMode .seg[data-val="online"]');
      await tabB.waitForSelector('#onlineActions', { visible: true, timeoutMs: 3000 });
      await tabB.click('#btnQuickMatch');

      await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000, message: 'Quick match did not start on Tab B' });
      await tabA.bringToFront();
      await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000, message: 'Quick match did not start on Tab A' });

      tabA.assertNoErrors('T1.4.3-A');
      tabB.assertNoErrors('T1.4.3-B');
    });

    it('T1.4.4 Off-turn premove arms cleanly and auto-executes on opponent reply', async () => {
      await resetOnlineTabs();
      await pairViaRoomCode();

      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 1, 6000);

      // White (Tab A, off-turn) arms premove d2->d4
      await tabA.bringToFront();
      await clickSquare(tabA, 'd2', { side: 'w' });
      await sleep(50);
      await clickSquare(tabA, 'd4', { side: 'w' });
      await sleep(80);
      assert.equal(await getHistPlies(tabA), 1, 'Premove must not execute while off-turn');

      await tabB.bringToFront();
      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });

      await tabA.bringToFront();
      await waitForPlies(tabA, 3, 6000);
      assert.deepEqual(await getHistMoves(tabA), ['e4', 'e5', 'd4']);

      await tabB.bringToFront();
      await waitForPlies(tabB, 3, 6000);
      assert.deepEqual(await getHistMoves(tabB), ['e4', 'e5', 'd4']);

      tabA.assertNoErrors('T1.4.4-A');
      tabB.assertNoErrors('T1.4.4-B');
    });

    it('T1.4.5 Online clock increment & presence sync across moves', async () => {
      await resetOnlineTabs();
      await pairViaRoomCode();

      await sleep(1100);
      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });

      await tabB.bringToFront();
      await waitForPlies(tabB, 1, 6000);
      const wOnB = await tabB.text('#clockW');
      assert.match(wOnB || '', /^\d{2}:\d{2}$/);

      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });
      await tabA.bringToFront();
      await waitForPlies(tabA, 2, 6000);
      assert.equal(await tabA.text('#turnTxt'), 'VEZ DAS BRANCAS');

      tabA.assertNoErrors('T1.4.5-A');
      tabB.assertNoErrors('T1.4.5-B');
    });

    it('T1.4.6 Online draw offer (#drawBar) ends game on both tabs with Elo delta', async () => {
      await resetOnlineTabs();
      await pairViaRoomCode();

      await tabA.click('#btnDraw');
      await tabB.bringToFront();
      await tabB.waitForSelector('#drawBar', { visible: true, timeoutMs: 6000 });
      await tabB.click('#btnDrawYes');

      await tabB.waitForSelector('#overOverlay:not(.hide)', { visible: true, timeoutMs: 6000 });
      assert.equal(await tabB.text('#overTitle'), 'Empate');
      assert.equal(await tabB.isVisible('#overDelta'), true);

      await tabA.bringToFront();
      await tabA.waitForSelector('#overOverlay:not(.hide)', { visible: true, timeoutMs: 6000 });
      assert.equal(await tabA.text('#overTitle'), 'Empate');
      assert.equal(await tabA.isVisible('#overDelta'), true);

      tabA.assertNoErrors('T1.4.6-A');
      tabB.assertNoErrors('T1.4.6-B');
    });
  });

  /* ----------------------------------------------------------
     AREA 5: Clickable SAN History |< < > >| & Undo
     ---------------------------------------------------------- */
  describe('Area 5 — Clickable SAN History & Undo', () => {
    it('T1.5.1 Clicking a historical ply in #histList inspects position and shows #liveBanner', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#liveBanner', 'Missing #liveBanner element');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'g1', 'f3', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'b8', 'c6', { side: 'b', waitForFlip: true });

      assert.equal(await page.isVisible('#liveBanner'), false);

      await page.evalJs(() => {
        const list = document.querySelector('#histList');
        const ply2 = list.querySelector('[data-ply="2"]')
          || [...list.querySelectorAll('.hist-row span:not(.hist-num), .hist-row button:not(.hist-num)')][1];
        ply2?.click();
      });

      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      assert.match(await page.text('#liveBanner'), /voltar ao vivo/i);
      assert.equal(await getHistPlies(page), 4);
      page.assertNoErrors('T1.5.1');
    });

    it('T1.5.2 #histNav buttons |< < > >| navigate plies 0..N', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnHistPrev', 'Missing #btnHistPrev element');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'g1', 'f3', { side: 'w', waitForFlip: true });

      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });

      await page.click('#btnHistFirst');
      assert.equal(await page.isVisible('#liveBanner'), true);

      await page.click('#btnHistNext');
      assert.equal(await page.isVisible('#liveBanner'), true);

      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });
      page.assertNoErrors('T1.5.2');
    });

    it('T1.5.3 Clicking #liveBanner returns to live ply and unblocks board play', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnHistPrev', 'Missing #btnHistPrev element');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });

      await page.click('#liveBanner');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });

      await pvpMove(page, 'g1', 'f3', { side: 'w', waitForFlip: true });
      assert.equal(await getHistPlies(page), 3);
      page.assertNoErrors('T1.5.3');
    });

    it('T1.5.4 #btnUndo in PvP undoes 1 ply cleanly', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      await page.click('#btnUndo');
      await page.waitFor(async () => (await getHistPlies(page)) === 1, { timeoutMs: 2500 });
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS PRETAS');

      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      assert.equal(await getHistPlies(page), 2);
      page.assertNoErrors('T1.5.4');
    });

    it('T1.5.5 #btnUndo in PvE undoes both AI reply and player move', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });

      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });
      assert.equal(await getHistPlies(page), 2);

      await page.click('#btnUndo');
      await page.waitFor(async () => (await getHistPlies(page)) === 0, { timeoutMs: 2500 });
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');
      assert.equal(await page.isVisible('#btnUndo'), false);
      page.assertNoErrors('T1.5.5');
    });

    it('T1.5.6 Mobile SAN history strip/drawer & #histNav accessible on 390x844', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 390, height: 844, mobile: true, hasTouch: true } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#histNav', 'Missing #histNav element');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      const navVisible = await page.isVisible('#histNav');
      if (!navVisible) {
        const opened = await page.evalJs(() => {
          const btn = document.querySelector('#btnMobileHistory, #btnHistory, [data-panel="history"], [aria-label*="hist" i], [aria-label*="lance" i]');
          if (btn) { btn.click(); return true; }
          return false;
        });
        assert.equal(opened, true, 'Expected visible #histNav or mobile history toggle button on 390x844');
        await page.waitForSelector('#histNav', { visible: true, timeoutMs: 2500 });
      }

      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      await assertHudNoOverlap(page);
      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });
      page.assertNoErrors('T1.5.6');
    });
  });

  /* ----------------------------------------------------------
     AREA 6: Post-Game Analysis
     ---------------------------------------------------------- */
  describe('Area 6 — Post-Game Analysis', () => {
    it('T1.6.1 #btnViewBoard hides #overOverlay and preserves inspectable final board & history', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnViewBoard', 'Missing #btnViewBoard element');
      await playFoolsMatePvP(page);

      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: 2500 });
      assert.equal(await getHistPlies(page), 4);
      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      page.assertNoErrors('T1.6.1');
    });

    it('T1.6.2 #btnAnalyze opens #analysisPanel and completes worker analysis cleanly', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await requireSelector(page, '#analysisPanel', 'Missing #analysisPanel element');
      await playFoolsMatePvP(page);

      await page.click('#btnAnalyze');
      await page.waitForSelector('#analysisPanel:not(.hide)', { visible: true, timeoutMs: 3000 });
      await page.waitFor(
        async () => {
          const txt = (await page.text('#analysisPanel')) || '';
          return /\d+(\.\d+)?\s*%/.test(txt) && Boolean(await page.exists('#analysisPanel svg'));
        },
        { timeoutMs: 15000, intervalMs: 100, message: '#analysisPanel did not complete analysis' }
      );
      page.assertNoErrors('T1.6.2');
    });

    it('T1.6.3 #analysisPanel displays separate White and Black accuracy percentages', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await playFoolsMatePvP(page);

      await page.click('#btnAnalyze');
      await page.waitFor(
        async () => {
          const txt = (await page.text('#analysisPanel')) || '';
          const matches = txt.match(/\d+(?:\.\d+)?\s*%/g) || [];
          return matches.length >= 2;
        },
        { timeoutMs: 15000, intervalMs: 100, message: 'Expected White & Black accuracy % in #analysisPanel' }
      );
      page.assertNoErrors('T1.6.3');
    });

    it('T1.6.4 #analysisPanel displays move classification badges (!!, ★, ✓, •, ?!, ?, ??)', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await playFoolsMatePvP(page);

      await page.click('#btnAnalyze');
      await page.waitFor(
        async () => {
          const panelTxt = (await page.text('#analysisPanel')) || '';
          const histTxt = (await page.text('#histList')) || '';
          const combined = panelTxt + ' ' + histTxt;
          return /\d+(?:\.\d+)?\s*%/.test(panelTxt) && /(!!|★|✓|•|\?!|\?\?|\?)/.test(combined);
        },
        { timeoutMs: 15000, intervalMs: 100, message: 'Expected classification badges in #analysisPanel or #histList' }
      );
      page.assertNoErrors('T1.6.4');
    });

    it('T1.6.5 Clickable SVG eval graph jumps to clicked ply and updates #liveBanner', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await playFoolsMatePvP(page);

      await page.click('#btnAnalyze');
      await page.waitFor(
        async () => {
          const txt = (await page.text('#analysisPanel')) || '';
          return /\d+(?:\.\d+)?\s*%/.test(txt) && Boolean(await page.exists('#analysisPanel svg'));
        },
        { timeoutMs: 15000, intervalMs: 100 }
      );

      const clicked = await page.evalJs(() => {
        const svg = document.querySelector('#analysisPanel svg');
        if (!svg) return false;
        const nodes = svg.querySelectorAll('[data-ply]');
        if (nodes.length >= 2) {
          const target = svg.querySelector('[data-ply="2"]') || nodes[1];
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        const pts = svg.querySelectorAll('circle, rect');
        if (pts.length >= 2) {
          pts[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        const r = svg.getBoundingClientRect();
        svg.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: r.left + r.width * 0.4,
          clientY: r.top + r.height * 0.5
        }));
        return true;
      });
      assert.equal(clicked, true);
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      page.assertNoErrors('T1.6.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 7: PBR Quality Profiles & Themes
     ---------------------------------------------------------- */
  describe('Area 7 — PBR Quality Profiles & Themes', () => {
    it('T1.7.1 #segQuality supports auto/high/medium/low and persists selection', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await requireSelector(page, '#segQuality .seg[data-val="high"]', 'Missing #segQuality controls');

      for (const tier of ['auto', 'high', 'medium', 'low']) {
        await page.click(`#segQuality .seg[data-val="${tier}"]`);
        assert.equal(await page.hasClass(`#segQuality .seg[data-val="${tier}"]`, 'active'), true);
      }

      const saved = await page.evalJs(() => JSON.parse(localStorage.getItem('xadrezRoyale.prefs') || '{}'));
      assert.equal(saved.quality ?? saved.qualityTier, 'low');
      page.assertNoErrors('T1.7.1');
    });

    it('T1.7.2 Dynamic mid-game quality switch renders non-empty full-viewport WebGL canvas with 0 errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await requireSelector(page, '#segQuality .seg[data-val="high"]', 'Missing #segQuality controls');

      for (const tier of ['high', 'medium', 'low', 'high']) {
        await page.click(`#segQuality .seg[data-val="${tier}"]`);
        await sleep(80);
      }
      await page.click('#btnCloseSettings');
      await page.waitFor(() => page.hasClass('#settingsOverlay', 'hide'), { timeoutMs: 2500 });

      const box = await page.boundingBox('#c3d');
      assert.equal(box.width, 1280);
      assert.equal(box.height, 800);

      const stats = await sampleCenterCanvasStats(page);
      assert.ok(stats.meanLum > 8 && stats.contrast > 25, `Expected live non-empty WebGL canvas, got ${JSON.stringify(stats)}`);
      page.assertNoErrors('T1.7.2');
    });

    it('T1.7.3 All 4 board themes update #boardSwatches and visibly re-render #c3d', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });

      const count = await page.evalJs(() => document.querySelectorAll('#boardSwatches .swatch-btn').length);
      assert.equal(count, 4);

      const samples = [];
      for (let i = 0; i < 4; i++) {
        await page.evalJs((idx) => document.querySelectorAll('#boardSwatches .swatch-btn')[idx].click(), i);
        await sleep(80);
        const active = await page.evalJs((idx) => document.querySelectorAll('#boardSwatches .swatch-btn')[idx].classList.contains('active'), i);
        assert.equal(active, true);
        samples.push(await sampleSquareRGB(page, 'd4'));
      }
      assert.ok(colorDist(samples[0], samples[1]) > 8 || colorDist(samples[1], samples[3]) > 8, 'Board themes must change rendered colors');
      page.assertNoErrors('T1.7.3');
    });

    it('T1.7.4 All 4 piece themes update #pieceSwatches and visibly re-render #c3d', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });

      const count = await page.evalJs(() => document.querySelectorAll('#pieceSwatches .swatch-btn').length);
      assert.equal(count, 4);

      for (let i = 0; i < 4; i++) {
        await page.evalJs((idx) => document.querySelectorAll('#pieceSwatches .swatch-btn')[idx].click(), i);
        await sleep(60);
        const active = await page.evalJs((idx) => document.querySelectorAll('#pieceSwatches .swatch-btn')[idx].classList.contains('active'), i);
        assert.equal(active, true);
      }
      await page.click('#btnCloseSettings');
      const stats = await sampleCenterCanvasStats(page);
      assert.ok(stats.contrast > 20);
      page.assertNoErrors('T1.7.4');
    });

    it('T1.7.5 Low quality profile preserves gameplay, captures (#capsW) and 3D Hint cleanly', async () => {
      await ensureLoadedFresh(page, server.url);
      await page.click('#btnSettings');
      await requireSelector(page, '#segQuality .seg[data-val="low"]', 'Missing #segQuality controls');
      await page.click('#segQuality .seg[data-val="low"]');
      await page.click('#btnCloseSettings');

      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'd7', 'd5', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'e4', 'd5', { side: 'w', waitForFlip: true });

      assert.match(await page.text('#capsW'), /♟/);
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');
      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });
      page.assertNoErrors('T1.7.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 8: VIP elkaua1227@gmail.com Gating
     ---------------------------------------------------------- */
  describe('Area 8 — VIP Gating (elkaua1227@gmail.com)', () => {
    let vipBrowser;
    let vipTabA;
    let vipTabB;

    before(async () => {
      vipBrowser = await launchBrowser({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: VIP_EMAIL,
        onlineNick: 'KAUAVIP'
      });
      vipTabA = vipBrowser.page;
      vipTabB = await vipBrowser.newPage({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: NON_VIP_EMAIL,
        onlineNick: 'OPONENTE'
      });
      await safeGoto(vipTabA, server.url);
      await safeGoto(vipTabB, server.url);
    });

    after(async () => {
      await vipBrowser?.close();
    });

    async function pairVipMatch() {
      await vipTabA.bringToFront();
      await ensureLoadedFresh(vipTabA, server.url);
      await vipTabB.bringToFront();
      await ensureLoadedFresh(vipTabB, server.url);

      await vipTabA.bringToFront();
      await vipTabA.click('#segMode .seg[data-val="online"]');
      await vipTabA.waitForSelector('#onlineActions', { visible: true, timeoutMs: 3000 });
      await vipTabA.click('#btnCreateRoom');
      await vipTabA.waitForSelector('#roomBox', { visible: true, timeoutMs: 3000 });
      const code = (await vipTabA.text('#roomCodeTxt')).trim();

      await vipTabB.bringToFront();
      await vipTabB.click('#segMode .seg[data-val="online"]');
      await vipTabB.click('#btnShowJoin');
      await vipTabB.type('#joinInput', code);
      await vipTabB.click('#btnJoinRoom');
      await vipTabB.waitFor(() => vipTabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });

      await vipTabA.bringToFront();
      await vipTabA.waitFor(() => vipTabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });
    }

    it('T1.8.1 VIP user sees VIP badge in #ratingLine in Online menu', async () => {
      await vipTabA.bringToFront();
      await ensureLoadedFresh(vipTabA, server.url);
      await vipTabA.click('#segMode .seg[data-val="online"]');
      await vipTabA.waitFor(
        async () => /VIP/i.test((await vipTabA.text('#ratingLine')) || ''),
        { timeoutMs: 4000, message: 'VIP badge missing in #ratingLine for VIP email' }
      );
      vipTabA.assertNoErrors('T1.8.1');
    });

    it('T1.8.2 VIP user in active Online match sees #btnHint and gets #hintBanner', async () => {
      await pairVipMatch();
      await requireSelector(vipTabA, '#hintBanner', 'Missing #hintBanner element');
      assert.equal(await vipTabA.isVisible('#btnHint'), true, 'VIP online player must see #btnHint');

      await vipTabA.click('#btnHint');
      await vipTabA.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });
      vipTabA.assertNoErrors('T1.8.2-A');
      vipTabB.assertNoErrors('T1.8.2-B');
    });

    it('T1.8.3 VIP user in active Online match sees #evalWrap when #segEval=1 and it updates', async () => {
      await vipTabA.bringToFront();
      await ensureLoadedFresh(vipTabA, server.url);
      await vipTabB.bringToFront();
      await ensureLoadedFresh(vipTabB, server.url);

      await vipTabA.bringToFront();
      await vipTabA.click('#btnSettings');
      await vipTabA.click('#segEval .seg[data-val="1"]');
      await vipTabA.click('#btnCloseSettings');

      await vipTabA.click('#segMode .seg[data-val="online"]');
      await vipTabA.click('#btnCreateRoom');
      await vipTabA.waitForSelector('#roomBox', { visible: true, timeoutMs: 3000 });
      const code = (await vipTabA.text('#roomCodeTxt')).trim();

      await vipTabB.bringToFront();
      await vipTabB.click('#segMode .seg[data-val="online"]');
      await vipTabB.click('#btnShowJoin');
      await vipTabB.type('#joinInput', code);
      await vipTabB.click('#btnJoinRoom');
      await vipTabB.waitFor(() => vipTabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });

      await vipTabA.bringToFront();
      await vipTabA.waitFor(() => vipTabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });
      assert.equal(await vipTabA.isVisible('#evalWrap'), true, 'VIP online player must see #evalWrap when evalVisible=1');

      await toggleView2D(vipTabA, true);
      await playMove(vipTabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await vipTabA.waitFor(
        async () => {
          const txt = (await vipTabA.text('#evalNum')) || '';
          return /^[+-]?\d+\.\d+$|^-?M\d+$/.test(txt);
        },
        { timeoutMs: 6000 }
      );
      vipTabA.assertNoErrors('T1.8.3-A');
      vipTabB.assertNoErrors('T1.8.3-B');
    });

    it('T1.8.4 Non-VIP user in active Online match hides both #btnHint and #evalWrap', async () => {
      // Tab B is non-VIP! Pair Tab B (Host) with Tab A, or inspect Tab B directly
      await pairVipMatch();
      await vipTabB.bringToFront();
      await vipTabB.click('#btnSettings');
      await vipTabB.click('#segEval .seg[data-val="1"]');
      await vipTabB.click('#btnCloseSettings');

      assert.equal(await vipTabB.isVisible('#btnHint'), false, 'Non-VIP online player must NOT see #btnHint');
      assert.equal(await vipTabB.isVisible('#evalWrap'), false, 'Non-VIP online player must NOT see #evalWrap');
      vipTabA.assertNoErrors('T1.8.4-A');
      vipTabB.assertNoErrors('T1.8.4-B');
    });

    it('T1.8.5 linkGoogle updates VIP UI and Local mode always allows Hint & Eval for non-VIP', async () => {
      await vipTabA.bringToFront();
      await ensureLoadedFresh(vipTabA, server.url);
      await vipTabA.click('#segMode .seg[data-val="online"]');
      await vipTabA.waitForSelector('#btnGoogle', { visible: true, timeoutMs: 3000 });
      await vipTabA.click('#btnGoogle');
      await vipTabA.waitFor(
        async () => /Google Conectado/i.test((await vipTabA.text('#btnGoogle')) || ''),
        { timeoutMs: 4000 }
      );
      assert.match(await vipTabA.text('#ratingLine'), /VIP/i);

      await vipTabB.bringToFront();
      await ensureLoadedFresh(vipTabB, server.url);
      await vipTabB.click('#btnSettings');
      await vipTabB.click('#segEval .seg[data-val="1"]');
      await vipTabB.click('#btnCloseSettings');
      await startLocalMatch(vipTabB, { mode: 'pvp', tc: '0', to2D: false });
      assert.equal(await vipTabB.isVisible('#btnHint'), true);
      assert.equal(await vipTabB.isVisible('#evalWrap'), true);
      vipTabA.assertNoErrors('T1.8.5-A');
      vipTabB.assertNoErrors('T1.8.5-B');
    });
  });

  /* ----------------------------------------------------------
     AREA 9: General UI/UX, Settings, Audio, Haptics, A11y & Shortcuts
     ---------------------------------------------------------- */
  describe('Area 9 — General UI/UX, Settings, Audio, Haptics, A11y & Shortcuts', () => {
    it('T1.9.1 A11y semantics: <button id="btnHome">, viewport-fit=cover, aria-label & aria-pressed', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0', to2D: false });

      const a11y = await page.evalJs(() => {
        const home = document.querySelector('#btnHome');
        const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
        const btnIds = [
          'btnHome', 'btnView2D', 'btnFlip', 'btnSound', 'btnSettings',
          'btnHint', 'btnResign', 'btnNewMenu', 'btnHistFirst', 'btnHistPrev', 'btnHistNext', 'btnHistLast'
        ];
        const missingAria = btnIds.filter((id) => {
          const el = document.getElementById(id);
          return !el || !(el.getAttribute('aria-label') || '').trim();
        });
        return {
          homeTag: home?.tagName,
          hasViewportFitCover: meta.includes('viewport-fit=cover'),
          missingAria,
          view2DPressed: document.getElementById('btnView2D')?.getAttribute('aria-pressed'),
          soundPressed: document.getElementById('btnSound')?.getAttribute('aria-pressed')
        };
      });

      assert.equal(a11y.homeTag, 'BUTTON');
      assert.equal(a11y.hasViewportFitCover, true);
      assert.deepEqual(a11y.missingAria, []);
      assert.equal(a11y.view2DPressed, 'false');
      assert.ok(a11y.soundPressed === 'true' || a11y.soundPressed === 'false');

      await toggleView2D(page, true);
      assert.equal(await page.evalJs(() => document.getElementById('btnView2D')?.getAttribute('aria-pressed')), 'true');
      page.assertNoErrors('T1.9.1');
    });

    it('T1.9.2 Keyboard :focus-visible outline ring appears when tabbing controls', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0', to2D: false });

      await page.pressKey('Tab');
      const focusStyle = await page.evalJs(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const st = getComputedStyle(el);
        return {
          id: el.id,
          tag: el.tagName,
          outlineStyle: st.outlineStyle,
          outlineWidth: st.outlineWidth,
          boxShadow: st.boxShadow
        };
      });
      assert.ok(focusStyle && focusStyle.tag === 'BUTTON', `Expected Tab to focus a button, got ${JSON.stringify(focusStyle)}`);
      const hasRing = (focusStyle.outlineStyle !== 'none' && parseFloat(focusStyle.outlineWidth) > 0)
        || (focusStyle.boxShadow && focusStyle.boxShadow !== 'none');
      assert.equal(hasRing, true, `Expected visible :focus-visible indicator, got ${JSON.stringify(focusStyle)}`);
      page.assertNoErrors('T1.9.2');
    });

    it('T1.9.3 #menuOverlay #btnResumeGame hidden initially, visible mid-game, and resumes without reset', async () => {
      await ensureLoadedFresh(page, server.url, { hardReload: true });
      await requireSelector(page, '#btnResumeGame', 'Missing #btnResumeGame element');
      assert.equal(await page.isVisible('#btnResumeGame'), false);

      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });

      await page.click('#btnHome');
      await page.waitForSelector('#menuOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      assert.equal(await page.isVisible('#btnResumeGame'), true);

      await page.click('#btnResumeGame');
      await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), { timeoutMs: 2500 });
      assert.equal(await getHistPlies(page), 1);
      page.assertNoErrors('T1.9.3');
    });

    it('T1.9.4 #btnSound mute toggle & AudioContext spy verify sound plays when unmuted and stops when muted', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      assert.equal(await page.text('#btnSound'), '🔊');
      const beforeStarts = await page.evalJs(() => window.__e2eAudioSpy?.starts || 0);
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      const afterUnmuted = await page.evalJs(() => window.__e2eAudioSpy?.starts || 0);
      assert.ok(afterUnmuted > beforeStarts, `Expected AudioContext oscillator start when unmuted (${afterUnmuted} > ${beforeStarts})`);

      await page.click('#btnSound');
      assert.equal(await page.text('#btnSound'), '🔇');
      assert.equal(await page.evalJs(() => document.getElementById('btnSound')?.getAttribute('aria-pressed')), 'true');

      const beforeMuted = await page.evalJs(() => window.__e2eAudioSpy?.starts || 0);
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      const afterMuted = await page.evalJs(() => window.__e2eAudioSpy?.starts || 0);
      assert.equal(afterMuted, beforeMuted, 'Muted audio must trigger 0 oscillator starts');
      page.assertNoErrors('T1.9.4');
    });

    it('T1.9.5 #segHaptics toggle & navigator.vibrate spy trigger on move when enabled and silence when off', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await page.evalJs(() => { window.__e2eVibrateCalls = []; });
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      const callsOn = await page.evalJs(() => (window.__e2eVibrateCalls || []).length);
      assert.ok(callsOn >= 1, 'Expected navigator.vibrate call on move when haptics enabled');

      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await requireSelector(page, '#segHaptics .seg[data-val="0"]', 'Missing #segHaptics controls');
      await page.click('#segHaptics .seg[data-val="0"]');
      await page.click('#btnCloseSettings');

      await page.evalJs(() => { window.__e2eVibrateCalls = []; });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      const callsOff = await page.evalJs(() => (window.__e2eVibrateCalls || []).length);
      assert.equal(callsOff, 0, 'Haptics disabled must emit 0 navigator.vibrate calls');
      page.assertNoErrors('T1.9.5');
    });

    it('T1.9.6 Keyboard shortcuts V (2D), F (flip), H (hint), M (mute) work in active match', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0', to2D: false });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');

      await page.pressKey('v');
      await page.waitFor(() => page.hasClass('#btnView2D', 'active'), { timeoutMs: 3000 });

      await page.pressKey('m');
      assert.equal(await page.text('#btnSound'), '🔇');

      await page.pressKey('h');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });

      await page.pressKey('f');
      await sleep(750);
      await pvpMove(page, 'e2', 'e4', { side: 'b', ensure2D: false, waitForFlip: true });
      assert.equal(await getHistPlies(page), 1);
      page.assertNoErrors('T1.9.6');
    });

    it('T1.9.7 Keyboard shortcuts ArrowLeft, ArrowRight, Home, End & Escape navigate history and close modals', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#liveBanner', 'Missing #liveBanner element');
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });

      await page.pressKey('ArrowLeft');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });

      await page.pressKey('Home');
      assert.equal(await page.isVisible('#liveBanner'), true);

      await page.pressKey('ArrowRight');
      assert.equal(await page.isVisible('#liveBanner'), true);

      await page.pressKey('End');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });

      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await page.pressKey('Escape');
      await page.waitFor(() => page.hasClass('#settingsOverlay', 'hide'), { timeoutMs: 2500 });
      page.assertNoErrors('T1.9.7');
    });

    it('T1.9.8 #btnResign 2-tap confirmation ends PvE game on second tap', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });

      await page.click('#btnResign');
      assert.equal(await page.hasClass('#overOverlay', 'hide'), true, 'Single click on #btnResign must not forfeit immediately');
      assert.match(await page.text('#btnResign'), /confirmar/i);

      await page.click('#btnResign');
      await page.waitForSelector('#overOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      assert.match(await page.text('#overSub'), /Desistência/i);
      page.assertNoErrors('T1.9.8');
    });
  });
});
