/* ============================================================
   Xadrez Royale 3D — Tier 2 E2E Suite (Boundaries & Edge Cases)
   Opaque-box CDP tests covering >= 5 boundary/edge cases per area.
   ============================================================ */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { startViteServer, launchBrowser, sleep } from './helpers/cdp.mjs';
import {
  squareToXY,
  clickSquare,
  getHistPlies,
  getHistMoves,
  playMove,
  rightClickSquare,
  rightDragArrow,
  assertHudNoOverlap
} from './helpers/board.mjs';

const NON_VIP_EMAIL = 'player@example.com';

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
  const size = 120;
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
  return { meanLum: sum / count, contrast: max - min };
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
    message: '#menuOverlay did not hide'
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
  await page.waitForSelector('#overOverlay:not(.hide)', { visible: true, timeoutMs: 4000 });
}

async function waitForPlies(page, minPlies, timeoutMs = 8000) {
  await page.waitFor(
    async () => (await getHistPlies(page)) >= minPlies,
    { timeoutMs, intervalMs: 50, message: `Expected >= ${minPlies} plies` }
  );
}

async function requireSelector(page, sel, msg) {
  const ok = await page.exists(sel);
  assert.equal(ok, true, msg || `Required M3 element ${sel} does not exist in DOM`);
}

describe('Tier 2 — Boundaries, Invalid Inputs & Edge Cases E2E Suite', () => {
  let server;
  let sharedBrowser;
  let page;

  before(async () => {
    server = await startViteServer({
      mode: 'dev',
      envOverride: { VITE_FIREBASE_API_KEY: '' }
    });
    sharedBrowser = await launchBrowser({ viewport: { width: 1280, height: 800 }, interceptOnline: false });
    page = sharedBrowser.page;
    await safeGoto(page, server.url);
  });

  after(async () => {
    await sharedBrowser?.close();
    await server?.close();
  });

  /* ----------------------------------------------------------
     AREA 1: Local Play Boundaries
     ---------------------------------------------------------- */
  describe('Area 1 — Local Play Boundaries', () => {
    it('T2.1.1 Clicking opponent piece or empty square when unselected does not mutate board', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await clickSquare(page, 'e4', { side: 'w' });
      await clickSquare(page, 'e7', { side: 'w' });
      await sleep(100);

      assert.equal(await getHistPlies(page), 0);
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');
      page.assertNoErrors('T2.1.1');
    });

    it('T2.1.2 Selecting own piece then clicking illegal destination does not move piece', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await clickSquare(page, 'e2', { side: 'w' });
      await sleep(50);
      await clickSquare(page, 'e5', { side: 'w' });
      await sleep(100);

      assert.equal(await getHistPlies(page), 0);
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');
      page.assertNoErrors('T2.1.2');
    });

    it('T2.1.3 Clicking board while AI is thinking/off-turn in PvE Black is ignored safely', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pve', diff: '3', side: 'b', tc: '0' });

      await clickSquare(page, 'e7', { side: 'b' });
      await clickSquare(page, 'e5', { side: 'b' });

      await page.waitFor(
        async () => (await getHistPlies(page)) === 1 && (await page.text('#turnTxt')) === 'VEZ DAS PRETAS',
        { timeoutMs: 10000, message: 'AI opening move did not settle' }
      );
      assert.equal(await getHistPlies(page), 1);
      page.assertNoErrors('T2.1.3');
    });

    it('T2.1.4 Opening #menuOverlay pauses local clock and #btnResumeGame resumes it', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnResumeGame', 'Missing #btnResumeGame element');
      await startLocalMatch(page, { mode: 'pvp', tc: '180000' });

      await page.click('#btnHome');
      await page.waitForSelector('#menuOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      const pausedClock = await page.text('#clockW');
      await sleep(2000);
      assert.equal(await page.text('#clockW'), pausedClock, 'Clock must not tick down while #menuOverlay is open');

      await page.click('#btnResumeGame');
      await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), { timeoutMs: 2500 });
      await page.waitFor(
        async () => (await page.text('#clockW')) !== pausedClock,
        { timeoutMs: 3000, message: 'Clock did not resume after #btnResumeGame' }
      );
      page.assertNoErrors('T2.1.4');
    });

    it('T2.1.5 Board ignores move attempts after game over (#btnViewBoard inspection)', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnViewBoard', 'Missing #btnViewBoard element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);

      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: 2500 });

      await clickSquare(page, 'e2', { side: 'b' });
      await sleep(40);
      await clickSquare(page, 'e4', { side: 'b' });
      await sleep(100);
      assert.equal(await getHistPlies(page), 4);
      page.assertNoErrors('T2.1.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 2: Manual Arrows & Mobile Narrow Viewport Boundaries
     ---------------------------------------------------------- */
  describe('Area 2 — Manual Arrows & Mobile Viewport Boundaries', () => {
    it('T2.2.1 Duplicate right-drag arrow with same color toggles the arrow OFF', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const baseE3 = await sampleSquareRGB(page, 'e3');
      await rightDragArrow(page, 'e2', 'e4', { side: 'w' });
      await sleep(80);
      assert.ok(colorDist(await sampleSquareRGB(page, 'e3'), baseE3) > 15, 'Arrow should appear on 1st drag');

      await rightDragArrow(page, 'e2', 'e4', { side: 'w' });
      await sleep(80);
      assert.ok(colorDist(await sampleSquareRGB(page, 'e3'), baseE3) < 12, 'Duplicate right-drag should toggle arrow OFF');
      page.assertNoErrors('T2.2.1');
    });

    it('T2.2.2 Duplicate right-click square mark toggles mark OFF', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const baseD4 = await sampleSquareRGB(page, 'd4');
      await rightClickSquare(page, 'd4', { side: 'w' });
      await sleep(80);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd4'), baseD4) > 15);

      await rightClickSquare(page, 'd4', { side: 'w' });
      await sleep(80);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd4'), baseD4) < 12, 'Duplicate right-click should toggle mark OFF');
      page.assertNoErrors('T2.2.2');
    });

    it('T2.2.3 Left-click clears manual annotations on AI turn and post-game', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pve', diff: '3', side: 'b', tc: '0' });

      const baseD4 = await sampleSquareRGB(page, 'd4', { side: 'b' });
      await rightClickSquare(page, 'd4', { side: 'b' });
      await sleep(60);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd4', { side: 'b' }), baseD4) > 12);

      await clickSquare(page, 'd4', { button: 'left', side: 'b' });
      await sleep(80);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd4', { side: 'b' }), baseD4) < 12, 'Left-click should clear mark during AI turn');

      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnViewBoard', 'Missing #btnViewBoard element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);
      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: 2500 });

      const postBase = await sampleSquareRGB(page, 'd5', { side: 'b' });
      await rightClickSquare(page, 'd5', { side: 'b' });
      await sleep(60);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd5', { side: 'b' }), postBase) > 12);
      await clickSquare(page, 'a5', { button: 'left', side: 'b' });
      await sleep(80);
      assert.ok(colorDist(await sampleSquareRGB(page, 'd5', { side: 'b' }), postBase) < 12, 'Left-click should clear mark post-game');
      page.assertNoErrors('T2.2.3');
    });

    it('T2.2.4 Zero-distance right-drag on single square behaves cleanly with 0 errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const xy = await squareToXY(page, 'e4', { side: 'w' });
      await page.mouseDrag(xy.x, xy.y, xy.x + 1, xy.y + 1, { button: 'right', steps: 3 });
      await sleep(80);
      assert.equal(await getHistPlies(page), 0);
      page.assertNoErrors('T2.2.4');
    });

    it('T2.2.5 Mobile narrow viewports (360x740 & 390x844) pass HUD non-overlap across game, arrowMode & eval states', async () => {
      for (const vp of [
        { width: 360, height: 740, mobile: true, hasTouch: true },
        { width: 390, height: 844, mobile: true, hasTouch: true }
      ]) {
        await ensureLoadedFresh(page, server.url, { viewport: vp });
        await requireSelector(page, '#btnArrows', 'Missing mobile #btnArrows button');
        await page.click('#btnSettings');
        await page.click('#segEval .seg[data-val="1"]');
        await page.click('#btnCloseSettings');

        await startLocalMatch(page, { mode: 'pvp', tc: '180000' });
        await assertHudNoOverlap(page);

        const btnBox = await page.boundingBox('#btnArrows');
        await page.touchTap(btnBox.cx, btnBox.cy);
        await page.waitForSelector('#arrowChip', { visible: true, timeoutMs: 2500 });
        await assertHudNoOverlap(page);
      }
      page.assertNoErrors('T2.2.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 3: 3D Hint Boundaries
     ---------------------------------------------------------- */
  describe('Area 3 — 3D Hint Boundaries', () => {
    it('T2.3.1 Stale-FEN hint guard: playing a move while hint is computing discards stale hint', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');

      const seq = [
        ['e2', 'e4', 'w'], ['e7', 'e5', 'b'],
        ['g1', 'f3', 'w'], ['b8', 'c6', 'b'],
        ['f1', 'c4', 'w'], ['f8', 'c5', 'b'],
        ['b1', 'c3', 'w'], ['g8', 'f6', 'b']
      ];
      for (const [f, t, s] of seq) {
        await pvpMove(page, f, t, { side: s, waitForFlip: true });
      }

      await page.click('#btnHint');
      await clickSquare(page, 'a2', { side: 'w' });
      await sleep(30);
      await clickSquare(page, 'a3', { side: 'w' });
      await waitForPlies(page, 9, 5000);

      await sleep(1500);
      assert.equal(await page.isVisible('#hintBanner'), false, 'Stale hint from superseded FEN must not appear');
      page.assertNoErrors('T2.3.1');
    });

    it('T2.3.2 Hint unavailable when game over (#btnHint hidden and shortcut H blocked)', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnViewBoard', 'Missing #btnViewBoard element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);

      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: 2500 });
      assert.equal(await page.isVisible('#btnHint'), false);

      await page.pressKey('h');
      await sleep(400);
      assert.equal(await page.isVisible('#hintBanner'), false);
      page.assertNoErrors('T2.3.2');
    });

    it('T2.3.4 Clicking #btnUndo clears active #hintBanner', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });

      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });

      await page.click('#btnUndo');
      await page.waitFor(async () => !(await page.isVisible('#hintBanner')), { timeoutMs: 2500 });
      page.assertNoErrors('T2.3.4');
    });

    it('T2.3.5 Rapid double-click on #btnHint produces single clean banner without errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#hintBanner', 'Missing #hintBanner element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      await page.click('#btnHint');
      await page.evalJs(() => document.querySelector('#btnHint')?.click());
      await page.waitForSelector('#hintBanner:not(.hide)', { visible: true, timeoutMs: 8000 });
      const count = await page.evalJs(() => document.querySelectorAll('#hintBanner').length);
      assert.equal(count, 1);
      page.assertNoErrors('T2.3.5');
    });
  });

  /* ----------------------------------------------------------
     SHARED NON-VIP ONLINE BROWSER (Areas 3.3, 4, 8.2-3, 9.2-3)
     ---------------------------------------------------------- */
  describe('Online Non-VIP Boundaries (Premove, Rooms, Eval/Hint Block & Inputs)', () => {
    let onlineBrowser;
    let tabA;
    let tabB;

    before(async () => {
      onlineBrowser = await launchBrowser({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: NON_VIP_EMAIL,
        onlineNick: 'PREA'
      });
      tabA = onlineBrowser.page;
      tabB = await onlineBrowser.newPage({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: NON_VIP_EMAIL,
        onlineNick: 'PREB'
      });
      await safeGoto(tabA, server.url);
      await safeGoto(tabB, server.url);
    });

    after(async () => {
      await onlineBrowser?.close();
    });

    async function setupOnlinePair() {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabB.bringToFront();
      await ensureLoadedFresh(tabB, server.url);

      await tabA.bringToFront();
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.click('#btnCreateRoom');
      await tabA.waitForSelector('#roomBox', { visible: true, timeoutMs: 3000 });
      const code = (await tabA.text('#roomCodeTxt')).trim();

      await tabB.bringToFront();
      await tabB.click('#segMode .seg[data-val="online"]');
      await tabB.click('#btnShowJoin');
      await tabB.type('#joinInput', code);
      await tabB.click('#btnJoinRoom');
      await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });
      await tabA.bringToFront();
      await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });

      await toggleView2D(tabA, true);
      await tabB.bringToFront();
      await toggleView2D(tabB, true);
      await tabA.bringToFront();
    }

    it('T2.3.3 Hint unavailable for Non-VIP in Online mode even via shortcut H', async () => {
      await setupOnlinePair();
      assert.equal(await tabA.isVisible('#btnHint'), false);
      await tabA.pressKey('h');
      await sleep(400);
      assert.equal(await tabA.isVisible('#hintBanner'), false);
      tabA.assertNoErrors('T2.3.3-A');
      tabB.assertNoErrors('T2.3.3-B');
    });

    it('T2.4.1 Premove canceled via Escape does NOT execute when opponent moves', async () => {
      await setupOnlinePair();
      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 1);

      await tabA.bringToFront();
      await clickSquare(tabA, 'd2', { side: 'w' });
      await sleep(40);
      await clickSquare(tabA, 'd4', { side: 'w' });
      await sleep(60);
      await tabA.pressKey('Escape');
      await sleep(60);

      await tabB.bringToFront();
      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });

      await tabA.bringToFront();
      await waitForPlies(tabA, 2);
      await sleep(300);
      assert.equal(await getHistPlies(tabA), 2, 'Canceled premove must not auto-execute');
      assert.equal(await tabA.text('#turnTxt'), 'VEZ DAS BRANCAS');
      tabA.assertNoErrors('T2.4.1-A');
      tabB.assertNoErrors('T2.4.1-B');
    });

    it('T2.4.2 Premove canceled via right-click on #c3d does NOT execute', async () => {
      await setupOnlinePair();
      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 1);

      await tabA.bringToFront();
      await clickSquare(tabA, 'd2', { side: 'w' });
      await sleep(40);
      await clickSquare(tabA, 'd4', { side: 'w' });
      await sleep(60);
      await rightClickSquare(tabA, 'a1', { side: 'w' });
      await sleep(60);

      await tabB.bringToFront();
      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });

      await tabA.bringToFront();
      await waitForPlies(tabA, 2);
      await sleep(300);
      assert.equal(await getHistPlies(tabA), 2, 'Right-click canceled premove must not execute');
      tabA.assertNoErrors('T2.4.2-A');
      tabB.assertNoErrors('T2.4.2-B');
    });

    it('T2.4.3 Illegal premove aborts cleanly when opponent delivers check blocking target square', async () => {
      await setupOnlinePair();
      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 1);
      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });
      await tabA.bringToFront();
      await waitForPlies(tabA, 2);

      await playMove(tabA, 'd2', 'd4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 3);

      await tabA.bringToFront();
      await clickSquare(tabA, 'e1', { side: 'w' });
      await sleep(40);
      await clickSquare(tabA, 'd2', { side: 'w' });
      await sleep(60);

      await tabB.bringToFront();
      await playMove(tabB, 'f8', 'b4', { side: 'b', ensure2D: false });

      await tabA.bringToFront();
      await waitForPlies(tabA, 4);
      await sleep(350);
      assert.equal(await getHistPlies(tabA), 4, 'Illegal premove Ke1->d2 must abort cleanly');
      assert.match(await tabA.text('#turnSub'), /XEQUE/i);

      await playMove(tabA, 'c2', 'c3', { side: 'w', ensure2D: false });
      assert.equal(await getHistPlies(tabA), 5);
      tabA.assertNoErrors('T2.4.3-A');
      tabB.assertNoErrors('T2.4.3-B');
    });

    it('T2.4.4 Off-turn click on empty square or opponent piece does not arm invalid premove', async () => {
      await setupOnlinePair();
      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 1);

      await tabA.bringToFront();
      await clickSquare(tabA, 'd4', { side: 'w' });
      await clickSquare(tabA, 'e7', { side: 'w' });
      await clickSquare(tabA, 'e5', { side: 'w' });

      await tabB.bringToFront();
      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });

      await tabA.bringToFront();
      await waitForPlies(tabA, 2);
      await sleep(250);
      assert.equal(await getHistPlies(tabA), 2);
      tabA.assertNoErrors('T2.4.4-A');
      tabB.assertNoErrors('T2.4.4-B');
    });

    it('T2.4.5 Premove replacement: arming a new premove replaces the prior armed premove', async () => {
      await setupOnlinePair();
      await playMove(tabA, 'e2', 'e4', { side: 'w', ensure2D: false });
      await tabB.bringToFront();
      await waitForPlies(tabB, 1);

      await tabA.bringToFront();
      await clickSquare(tabA, 'd2', { side: 'w' });
      await sleep(40);
      await clickSquare(tabA, 'd4', { side: 'w' });
      await sleep(50);
      await clickSquare(tabA, 'c2', { side: 'w' });
      await sleep(40);
      await clickSquare(tabA, 'c4', { side: 'w' });
      await sleep(50);

      await tabB.bringToFront();
      await playMove(tabB, 'e7', 'e5', { side: 'b', ensure2D: false });

      await tabA.bringToFront();
      await waitForPlies(tabA, 3);
      assert.deepEqual(await getHistMoves(tabA), ['e4', 'e5', 'c4']);
      tabA.assertNoErrors('T2.4.5-A');
      tabB.assertNoErrors('T2.4.5-B');
    });

    it('T2.4.6 Invalid/empty room join code shows error toast and keeps menu open', async () => {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.click('#btnShowJoin');
      await tabA.type('#joinInput', 'ZZZZ99');
      await tabA.click('#btnJoinRoom');

      await tabA.waitForSelector('#toast.show', { visible: true, timeoutMs: 3000 });
      assert.equal(await tabA.hasClass('#menuOverlay', 'hide'), false);
      tabA.assertNoErrors('T2.4.6');
    });

    it('T2.8.2 Non-VIP online #evalWrap stays hidden even with evalVisible=1 persisted', async () => {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabA.click('#btnSettings');
      await tabA.click('#segEval .seg[data-val="1"]');
      await tabA.click('#btnCloseSettings');

      await tabB.bringToFront();
      await ensureLoadedFresh(tabB, server.url);

      await tabA.bringToFront();
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.click('#btnCreateRoom');
      await tabA.waitForSelector('#roomBox', { visible: true, timeoutMs: 3000 });
      const code = (await tabA.text('#roomCodeTxt')).trim();

      await tabB.bringToFront();
      await tabB.click('#segMode .seg[data-val="online"]');
      await tabB.click('#btnShowJoin');
      await tabB.type('#joinInput', code);
      await tabB.click('#btnJoinRoom');
      await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });

      await tabA.bringToFront();
      await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: 8000 });
      assert.equal(await tabA.isVisible('#evalWrap'), false, 'Non-VIP online player must not see #evalWrap even when evalVisible=1');
      tabA.assertNoErrors('T2.8.2-A');
      tabB.assertNoErrors('T2.8.2-B');
    });

    it('T2.8.3 Non-VIP online cannot trigger eval bar by toggling #segEval mid-match', async () => {
      await setupOnlinePair();
      await tabA.click('#btnSettings');
      await tabA.click('#segEval .seg[data-val="1"]');
      await tabA.click('#btnCloseSettings');

      assert.equal(await tabA.isVisible('#evalWrap'), false);
      tabA.assertNoErrors('T2.8.3-A');
      tabB.assertNoErrors('T2.8.3-B');
    });

    it('T2.9.2 Keyboard shortcuts (M, F, V, H, Arrows) are suppressed inside #nickInput and #joinInput', async () => {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.waitForSelector('#nickInput', { visible: true, timeoutMs: 3000 });

      await tabA.type('#nickInput', 'mfvh');
      assert.equal(await tabA.text('#btnSound'), '🔊', 'Typing m in #nickInput must not mute');
      assert.equal(await tabA.hasClass('#btnView2D', 'active'), false, 'Typing v in #nickInput must not toggle 2D');
      assert.equal(await tabA.evalJs(() => document.querySelector('#nickInput').value), 'mfvh');

      await tabA.click('#btnShowJoin');
      await tabA.type('#joinInput', 'mfvh');
      assert.equal(await tabA.text('#btnSound'), '🔊', 'Typing m in #joinInput must not mute');
      assert.equal(await tabA.evalJs(() => document.querySelector('#joinInput').value), 'mfvh');
      tabA.assertNoErrors('T2.9.2');
    });

    it('T2.9.3 Pressing Enter inside #joinInput submits room join identically to #btnJoinRoom', async () => {
      await tabA.bringToFront();
      await ensureLoadedFresh(tabA, server.url);
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.click('#btnShowJoin');
      await tabA.type('#joinInput', 'BAD123');
      await tabA.pressKey('Enter');

      await tabA.waitForSelector('#toast.show', { visible: true, timeoutMs: 3000 });
      tabA.assertNoErrors('T2.9.3');
    });
  });

  /* ----------------------------------------------------------
     AREA 5: History Navigation & Undo Boundaries
     ---------------------------------------------------------- */
  describe('Area 5 — History Navigation & Undo Boundaries', () => {
    it('T2.5.1 Move attempts while inspecting history (viewPly < N) are blocked', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnHistPrev', 'Missing #btnHistPrev element');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'g1', 'f3', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'b8', 'c6', { side: 'b', waitForFlip: true });

      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });

      await clickSquare(page, 'f1', { side: 'w' });
      await sleep(40);
      await clickSquare(page, 'c4', { side: 'w' });
      await sleep(120);

      assert.equal(await getHistPlies(page), 4, 'Board must block moves while viewPly < totalPlies');
      assert.equal(await page.isVisible('#liveBanner'), true);
      page.assertNoErrors('T2.5.1');
    });

    it('T2.5.2 #btnUndo after capture restores #capsW and material lead +1 cleanly', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnHistPrev', 'Missing #btnHistPrev element');

      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await pvpMove(page, 'd7', 'd5', { side: 'b', waitForFlip: true });
      await pvpMove(page, 'e4', 'd5', { side: 'w', waitForFlip: true });

      const capsAfterCap = (await page.text('#capsW')) || '';
      assert.match(capsAfterCap, /♟/);
      assert.match(capsAfterCap, /\+1/);

      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      assert.equal((await page.text('#capsW')).trim(), '');

      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });
      assert.match(await page.text('#capsW'), /♟/);

      await page.click('#btnUndo');
      await page.waitFor(async () => (await getHistPlies(page)) === 2, { timeoutMs: 2500 });
      assert.equal((await page.text('#capsW')).trim(), '');
      assert.equal(await page.text('#turnTxt'), 'VEZ DAS BRANCAS');

      await pvpMove(page, 'e4', 'd5', { side: 'w', waitForFlip: true });
      assert.equal(await getHistPlies(page), 3);
      assert.match(await page.text('#capsW'), /♟/);
      page.assertNoErrors('T2.5.2');
    });

    it('T2.5.3 Captures in #capsW are sorted Q > R > B > N > P with accurate +N lead', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const seq = [
        ['e2', 'e4', 'w'], ['d7', 'd5', 'b'],
        ['e4', 'd5', 'w'], ['b8', 'a6', 'b'],
        ['f1', 'a6', 'w'], ['e7', 'e6', 'b'],
        ['d2', 'd4', 'w'], ['d8', 'g5', 'b'],
        ['c1', 'g5', 'w']
      ];
      for (let i = 0; i < seq.length; i++) {
        const [f, t, s] = seq[i];
        await pvpMove(page, f, t, { side: s, waitForFlip: i < seq.length - 1 });
      }

      const capsW = (await page.text('#capsW')) || '';
      const iQ = capsW.indexOf('♛');
      const iN = capsW.indexOf('♞');
      const iP = capsW.indexOf('♟');
      assert.ok(iQ !== -1 && iN !== -1 && iP !== -1, `Expected ♛, ♞, ♟ in #capsW, got "${capsW}"`);
      assert.ok(iQ < iN && iN < iP, `Expected sorted order ♛ < ♞ < ♟ in "${capsW}"`);
      assert.match(capsW, /\+13/);
      page.assertNoErrors('T2.5.3');
    });

    it('T2.5.4 #btnHistFirst / #btnHistLast clamp cleanly at 0 and N', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await requireSelector(page, '#btnHistFirst', 'Missing #btnHistFirst element');
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });

      await page.click('#btnHistFirst');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      await page.click('#btnHistPrev');
      assert.equal(await page.isVisible('#liveBanner'), true);

      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });
      await page.click('#btnHistNext');
      assert.equal(await page.isVisible('#liveBanner'), false);
      page.assertNoErrors('T2.5.4');
    });

    it('T2.5.5 #btnUndo is hidden and safe when history has 0 plies', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      assert.equal(await page.isVisible('#btnUndo'), false);
      await page.evalJs(() => document.querySelector('#btnUndo')?.click());
      assert.equal(await getHistPlies(page), 0);
      page.assertNoErrors('T2.5.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 6: Post-Game Analysis Boundaries
     ---------------------------------------------------------- */
  describe('Area 6 — Post-Game Analysis Boundaries', () => {
    it('T2.6.1 Starting #btnRematch / new match mid-analysis cancels analyzeGame cleanly', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });

      const scholars = [
        ['e2', 'e4', 'w'], ['e7', 'e5', 'b'],
        ['f1', 'c4', 'w'], ['b8', 'c6', 'b'],
        ['d1', 'h5', 'w'], ['g8', 'f6', 'b'],
        ['h5', 'f7', 'w']
      ];
      for (let i = 0; i < scholars.length; i++) {
        const [f, t, s] = scholars[i];
        await pvpMove(page, f, t, { side: s, waitForFlip: i < scholars.length - 1 });
      }
      await page.waitForSelector('#overOverlay:not(.hide)', { visible: true, timeoutMs: 4000 });

      await page.click('#btnAnalyze');
      await page.waitForSelector('#analysisPanel:not(.hide)', { visible: true, timeoutMs: 2500 });

      await page.click('#btnNewMenu');
      await page.waitForSelector('#menuOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await page.click('#btnStartLocal');
      await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), { timeoutMs: 2500 });

      await sleep(1500);
      assert.equal(await page.isVisible('#analysisPanel'), false, 'Canceled analysis must not re-open during new match');
      assert.equal(await getHistPlies(page), 0);
      page.assertNoErrors('T2.6.1');
    });

    it('T2.6.2 Analysis on short 4-ply Checkmate succeeds with valid accuracy & SVG', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);

      await page.click('#btnAnalyze');
      await page.waitFor(
        async () => {
          const txt = (await page.text('#analysisPanel')) || '';
          return /\d+(?:\.\d+)?\s*%/.test(txt) && Boolean(await page.exists('#analysisPanel svg'));
        },
        { timeoutMs: 15000, intervalMs: 100 }
      );
      page.assertNoErrors('T2.6.2');
    });

    it('T2.6.3 Repeated clicks across SVG eval graph nodes jump plies cleanly and #btnHistLast returns to end', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);

      await page.click('#btnAnalyze');
      await page.waitFor(
        async () => {
          const txt = (await page.text('#analysisPanel')) || '';
          return /\d+(?:\.\d+)?\s*%/.test(txt) && Boolean(await page.exists('#analysisPanel svg'));
        },
        { timeoutMs: 15000, intervalMs: 100 }
      );

      for (const plyIdx of [1, 3]) {
        await page.evalJs((p) => {
          const svg = document.querySelector('#analysisPanel svg');
          const el = svg?.querySelector(`[data-ply="${p}"]`) || svg?.querySelectorAll('circle, rect')[p];
          el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }, plyIdx);
        await sleep(80);
      }
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: 2500 });
      page.assertNoErrors('T2.6.3');
    });

    it('T2.6.4 Post-game analysis works on Threefold Repetition draw', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnAnalyze', 'Missing #btnAnalyze element');
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
      await page.click('#btnAnalyze');
      await page.waitFor(
        async () => /\d+(?:\.\d+)?\s*%/.test((await page.text('#analysisPanel')) || ''),
        { timeoutMs: 15000, intervalMs: 100 }
      );
      page.assertNoErrors('T2.6.4');
    });

    it('T2.6.5 #btnViewBoard after game over keeps #btnNewMenu & #histNav functional', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#btnViewBoard', 'Missing #btnViewBoard element');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await playFoolsMatePvP(page);

      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: 2500 });
      await page.click('#btnHistFirst');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: 2500 });
      await page.click('#btnNewMenu');
      await page.waitForSelector('#menuOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      page.assertNoErrors('T2.6.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 7: PBR Quality & Theme Boundaries
     ---------------------------------------------------------- */
  describe('Area 7 — PBR Quality & Theme Boundaries', () => {
    it('T2.7.1 SwiftShader "auto" quality renders non-empty #c3d with 0 WebGL errors', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await requireSelector(page, '#segQuality .seg[data-val="auto"]', 'Missing #segQuality controls');
      await page.click('#btnSettings');
      assert.equal(await page.hasClass('#segQuality .seg[data-val="auto"]', 'active'), true);
      await page.click('#btnCloseSettings');

      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      const stats = await sampleCenterCanvasStats(page);
      assert.ok(stats.meanLum > 8 && stats.contrast > 25);
      page.assertNoErrors('T2.7.1');
    });

    it('T2.7.2 Rapid quality tier cycling (auto -> high -> medium -> low -> high -> low) has 0 errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#segQuality .seg[data-val="high"]', 'Missing #segQuality controls');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await page.click('#btnSettings');

      for (const q of ['auto', 'high', 'medium', 'low', 'high', 'medium', 'low']) {
        await page.click(`#segQuality .seg[data-val="${q}"]`);
        await sleep(30);
      }
      await page.click('#btnCloseSettings');
      const stats = await sampleCenterCanvasStats(page);
      assert.ok(stats.contrast > 20);
      page.assertNoErrors('T2.7.2');
    });

    it('T2.7.3 Startup .seg.active & .swatch-btn.active sync across page reload', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#segQuality .seg[data-val="low"]', 'Missing #segQuality controls');
      await requireSelector(page, '#segHaptics .seg[data-val="0"]', 'Missing #segHaptics controls');

      await page.click('#segDiff .seg[data-val="3"]');
      await page.click('#btnSound');
      await page.click('#btnSettings');
      await page.click('#segEval .seg[data-val="1"]');
      await page.click('#segQuality .seg[data-val="low"]');
      await page.click('#segHaptics .seg[data-val="0"]');
      await page.evalJs(() => {
        document.querySelectorAll('#boardSwatches .swatch-btn')[1]?.click();
        document.querySelectorAll('#pieceSwatches .swatch-btn')[3]?.click();
      });
      await page.click('#btnCloseSettings');

      await safeReload(page);

      const sync = await page.evalJs(() => ({
        diff3: document.querySelector('#segDiff .seg[data-val="3"]')?.classList.contains('active'),
        eval1: document.querySelector('#segEval .seg[data-val="1"]')?.classList.contains('active'),
        qualLow: document.querySelector('#segQuality .seg[data-val="low"]')?.classList.contains('active'),
        hap0: document.querySelector('#segHaptics .seg[data-val="0"]')?.classList.contains('active'),
        board1: document.querySelectorAll('#boardSwatches .swatch-btn')[1]?.classList.contains('active'),
        piece3: document.querySelectorAll('#pieceSwatches .swatch-btn')[3]?.classList.contains('active'),
        soundTxt: document.querySelector('#btnSound')?.textContent?.trim(),
        soundPressed: document.querySelector('#btnSound')?.getAttribute('aria-pressed')
      }));

      assert.equal(sync.diff3, true, 'Difficulty Mestre should be .active after reload');
      assert.equal(sync.eval1, true, 'Eval Visivel should be .active after reload');
      assert.equal(sync.qualLow, true, 'Quality low should be .active after reload');
      assert.equal(sync.hap0, true, 'Haptics 0 should be .active after reload');
      assert.equal(sync.board1, true, 'Board swatch 1 should be .active after reload');
      assert.equal(sync.piece3, true, 'Piece swatch 3 should be .active after reload');
      assert.equal(sync.soundTxt, '🔇');
      assert.equal(sync.soundPressed, 'true');

      await startLocalMatch(page, { mode: 'pvp', tc: '0', to2D: false });
      assert.equal(await page.isVisible('#evalWrap'), true, '#evalWrap should show on local start when evalVisible=1 persisted');
      page.assertNoErrors('T2.7.3');
    });

    it('T2.7.4 Switching all themes while in low quality updates #c3d without errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await requireSelector(page, '#segQuality .seg[data-val="low"]', 'Missing #segQuality controls');
      await page.click('#btnSettings');
      await page.click('#segQuality .seg[data-val="low"]');
      for (let i = 0; i < 4; i++) {
        await page.evalJs((idx) => {
          document.querySelectorAll('#boardSwatches .swatch-btn')[idx]?.click();
          document.querySelectorAll('#pieceSwatches .swatch-btn')[idx]?.click();
        }, i);
        await sleep(35);
      }
      await page.click('#btnCloseSettings');
      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      const stats = await sampleCenterCanvasStats(page);
      assert.ok(stats.contrast > 20);
      page.assertNoErrors('T2.7.4');
    });

    it('T2.7.5 Rapid viewport resize (1280x800 <-> 360x740) keeps #c3d fitted with 0 errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '0', to2D: false });

      await page.setViewport({ width: 360, height: 740, mobile: true, hasTouch: true });
      await sleep(120);
      let box = await page.boundingBox('#c3d');
      assert.equal(box.width, 360);
      assert.equal(box.height, 740);

      await page.setViewport({ width: 1280, height: 800, mobile: false, hasTouch: false });
      await sleep(120);
      box = await page.boundingBox('#c3d');
      assert.equal(box.width, 1280);
      assert.equal(box.height, 800);
      page.assertNoErrors('T2.7.5');
    });
  });

  /* ----------------------------------------------------------
     AREA 8: VIP & Eval Bar Boundaries (Local + Unconfigured + Case VIP)
     ---------------------------------------------------------- */
  describe('Area 8 — VIP & Eval Bar Boundaries', () => {
    it('T2.8.1 Mate-score eval displays M1 / -M1 on #evalNum and NEVER 999.9', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await page.click('#btnSettings');
      await page.click('#segEval .seg[data-val="1"]');
      await page.click('#btnCloseSettings');

      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      const seq = [
        ['e2', 'e4', 'w'], ['e7', 'e5', 'b'],
        ['f1', 'c4', 'w'], ['b8', 'c6', 'b'],
        ['d1', 'h5', 'w'], ['g8', 'f6', 'b']
      ];
      for (const [f, t, s] of seq) {
        await pvpMove(page, f, t, { side: s, waitForFlip: true });
      }

      await page.waitFor(
        async () => /^-?M\d+$/.test(((await page.text('#evalNum')) || '').trim()),
        { timeoutMs: 8000, message: `Expected M<n> mate score on #evalNum, got "${await page.text('#evalNum')}"` }
      );
      const evalTxt = (await page.text('#evalNum')).trim();
      assert.doesNotMatch(evalTxt, /999/);
      assert.match(evalTxt, /^M1$/);
      page.assertNoErrors('T2.8.1');
    });

    it('T2.8.4 Unconfigured Firebase (VITE_FIREBASE_API_KEY="") shows friendly message with 0 errors', async () => {
      await ensureLoadedFresh(page, server.url);
      await page.click('#segMode .seg[data-val="online"]');
      await page.waitForSelector('#onlineStatus', { visible: true, timeoutMs: 3000 });
      assert.match(await page.text('#onlineStatus'), /VITE_FIREBASE/i);
      page.assertNoErrors('T2.8.4');
    });

    it('T2.8.5 Uppercase VIP email still grants VIP access via case-insensitive comparison', async () => {
      const vipBrowser = await launchBrowser({
        viewport: { width: 1280, height: 800 },
        interceptOnline: true,
        onlineEmail: 'ELKAUA1227@GMAIL.COM',
        onlineNick: 'VIPUPPER'
      });
      try {
        const p = vipBrowser.page;
        await safeGoto(p, server.url);
        await p.click('#segMode .seg[data-val="online"]');
        await p.waitFor(
          async () => /VIP/i.test((await p.text('#ratingLine')) || ''),
          { timeoutMs: 4000, message: 'Case-insensitive VIP email failed' }
        );
        p.assertNoErrors('T2.8.5');
      } finally {
        await vipBrowser.close();
      }
    });
  });

  /* ----------------------------------------------------------
     AREA 9: UI/UX, Shortcuts, Resign & Modal Boundaries
     ---------------------------------------------------------- */
  describe('Area 9 — UI/UX, Shortcuts, Resign & Modal Boundaries', () => {
    it('T2.9.1 #btnResign 3.5s confirm timeout reverts back to normal without resigning', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 1280, height: 800, mobile: false, hasTouch: false } });
      await startLocalMatch(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });

      await page.click('#btnResign');
      assert.match(await page.text('#btnResign'), /confirmar/i);
      assert.equal(await page.hasClass('#overOverlay', 'hide'), true);

      await sleep(3700);
      assert.equal(await page.hasClass('#overOverlay', 'hide'), true);
      assert.match(await page.text('#btnResign'), /DESISTIR/i);

      await page.click('#btnResign');
      assert.equal(await page.hasClass('#overOverlay', 'hide'), true);
      assert.match(await page.text('#btnResign'), /confirmar/i);
      page.assertNoErrors('T2.9.1');
    });

    it('T2.9.4 Escape priority chain: closes topmost modal, does not dismiss initial menu when no game active', async () => {
      await ensureLoadedFresh(page, server.url, { hardReload: true });
      await page.pressKey('Escape');
      await sleep(100);
      assert.equal(await page.hasClass('#menuOverlay', 'hide'), false);

      await startLocalMatch(page, { mode: 'pvp', tc: '0' });
      await page.click('#btnHome');
      await page.waitForSelector('#menuOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await page.pressKey('Escape');
      await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), { timeoutMs: 2500 });
      page.assertNoErrors('T2.9.4');
    });

    it('T2.9.5 Opening #settingsOverlay during timed local game keeps UI responsive', async () => {
      await ensureLoadedFresh(page, server.url);
      await startLocalMatch(page, { mode: 'pvp', tc: '180000' });

      await page.click('#btnSettings');
      await page.waitForSelector('#settingsOverlay:not(.hide)', { visible: true, timeoutMs: 2500 });
      await sleep(300);
      await page.pressKey('Escape');
      await page.waitFor(() => page.hasClass('#settingsOverlay', 'hide'), { timeoutMs: 2500 });
      assert.equal(await page.isVisible('#clockW'), true);
      page.assertNoErrors('T2.9.5');
    });

    it('T2.9.6 Mobile 360x740 narrow viewport HUD non-overlap with #evalWrap & active #arrowChip', async () => {
      await ensureLoadedFresh(page, server.url, { viewport: { width: 360, height: 740, mobile: true, hasTouch: true } });
      await requireSelector(page, '#btnArrows', 'Missing mobile #btnArrows button');
      await page.click('#btnSettings');
      await page.click('#segEval .seg[data-val="1"]');
      await page.click('#btnCloseSettings');

      await startLocalMatch(page, { mode: 'pvp', tc: '180000' });
      await pvpMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await assertHudNoOverlap(page);

      const boxBtn = await page.boundingBox('#btnArrows');
      await page.touchTap(boxBtn.cx, boxBtn.cy);
      await page.waitForSelector('#arrowChip', { visible: true, timeoutMs: 2500 });
      await assertHudNoOverlap(page);
      page.assertNoErrors('T2.9.6');
    });
  });
});
