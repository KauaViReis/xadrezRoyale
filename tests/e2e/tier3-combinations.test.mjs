/* ============================================================
   Tier 3 E2E Suite — Pairwise Cross-Feature Combination Tests
   Strictly opaque-box verification via CDP + DOM + #c3d canvas
   ============================================================ */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchBrowser, sleep, startViteServer } from './helpers/cdp.mjs';
import {
  assertHudNoOverlap,
  ensureView2D,
  getHistMoves,
  getHistPlies,
  playMove,
  rightClickSquare,
  rightDragArrow,
  squareToXY,
  touchDragArrow,
  touchTapSquare
} from './helpers/board.mjs';

const UI_TIMEOUT = 4500;
const WORKER_TIMEOUT = 15000;

async function safeGoto(page, url) {
  try {
    await page.goto(url);
  } catch (err) {
    if (!String(err?.message || err).includes('Page.loadEventFired')) throw err;
    await page.waitFor(
      () => document.readyState === 'complete' && Boolean(document.querySelector('#menuOverlay')),
      { timeoutMs: 15000, message: 'Page did not finish loading after goto timeout' }
    );
    await sleep(150);
  }
}

async function safeReload(page) {
  try {
    await page.reload();
  } catch (err) {
    if (!String(err?.message || err).includes('Page.loadEventFired')) throw err;
    await page.waitFor(
      () => document.readyState === 'complete' && Boolean(document.querySelector('#menuOverlay')),
      { timeoutMs: 15000, message: 'Page did not finish reloading after timeout' }
    );
    await sleep(150);
  }
}

async function startLocalGame(page, { mode = 'pve', diff = '1', side = 'w', tc = '0' } = {}) {
  await page.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
  await page.click(`#segMode .seg[data-val="${mode}"]`);
  if (mode === 'pve') {
    await page.click(`#segDiff .seg[data-val="${diff}"]`);
    await page.click(`#segSide .seg[data-val="${side}"]`);
  }
  await page.click(`#segTcLocal .seg[data-val="${tc}"]`);
  await page.click('#btnStartLocal');
  await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), {
    timeoutMs: UI_TIMEOUT,
    message: '#menuOverlay did not hide after #btnStartLocal'
  });
}

async function openSettings(page) {
  await page.click('#btnSettings');
  await page.waitFor(async () => !(await page.hasClass('#settingsOverlay', 'hide')), {
    timeoutMs: UI_TIMEOUT,
    message: '#settingsOverlay did not open'
  });
}

async function closeSettings(page) {
  await page.click('#btnCloseSettings');
  await page.waitFor(() => page.hasClass('#settingsOverlay', 'hide'), {
    timeoutMs: UI_TIMEOUT,
    message: '#settingsOverlay did not close'
  });
}

async function dismissHintBanner(page) {
  const clicked = await page.evalJs(() => {
    const banner = document.querySelector('#hintBanner');
    if (!banner) return null;
    const btn = banner.querySelector('button, [role="button"], .hint-close');
    const target = btn || banner;
    const r = target.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null;
  });
  assert.ok(clicked, '#hintBanner dismiss target should have a bounding box');
  await page.mouseClick(clicked.cx, clicked.cy);
}

async function clickAnalysisGraphEarlierPly(page) {
  const target = await page.evalJs(() => {
    const svg = document.querySelector('#analysisPanel svg');
    if (!svg) return null;
    const svgRect = svg.getBoundingClientRect();
    const plyNodes = [...svg.querySelectorAll('[data-ply]')].filter((el) => {
      const ply = Number(el.getAttribute('data-ply'));
      const r = el.getBoundingClientRect();
      return Number.isFinite(ply) && ply >= 1 && r.width > 0 && r.height > 0;
    });
    if (plyNodes.length >= 2) {
      const el = plyNodes[1];
      const r = el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, ply: el.getAttribute('data-ply') };
    }
    const shapes = [...svg.querySelectorAll('circle, rect, path, g')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.width < svgRect.width * 0.4;
    });
    if (shapes.length >= 2) {
      const r = shapes[Math.min(1, shapes.length - 1)].getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, ply: null };
    }
    if (svgRect.width > 0 && svgRect.height > 0) {
      return { cx: svgRect.left + svgRect.width * 0.25, cy: svgRect.top + svgRect.height * 0.5, ply: null };
    }
    return null;
  });
  assert.ok(target, 'Expected clickable SVG eval graph inside #analysisPanel');
  await page.mouseClick(target.cx, target.cy);
}

async function waitForAnalysisComplete(page) {
  await page.waitForSelector('#analysisPanel', { visible: true, timeoutMs: UI_TIMEOUT });
  await page.waitFor(
    async () => {
      return await page.evalJs(() => {
        const panel = document.querySelector('#analysisPanel');
        if (!panel) return false;
        const st = getComputedStyle(panel);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const txt = panel.textContent || '';
        const hasSvg = Boolean(panel.querySelector('svg'));
        const hasPct = /\d+(?:[.,]\d+)?\s*%/.test(txt);
        return hasSvg && hasPct;
      });
    },
    { timeoutMs: WORKER_TIMEOUT, intervalMs: 100, message: '#analysisPanel did not complete with SVG and accuracy %' }
  );
}

async function selectArrowChipAction(page, kind, isTouch = false) {
  const box = await page.evalJs((k) => {
    const chip = document.querySelector('#arrowChip');
    if (!chip) return null;
    const btns = [...chip.querySelectorAll('button')];
    const matchers = {
      green: /verde|green/i,
      red: /vermelh|red/i,
      blue: /azul|blue/i,
      yellow: /amarel|yellow/i,
      clear: /limpar|clear|apagar|🗑|✕/i
    };
    const found = btns.find((b) => {
      const dc = (b.dataset.color || b.dataset.arrowColor || b.dataset.action || b.dataset.val || '').toLowerCase();
      if (dc === k) return true;
      const meta = `${b.id} ${b.className} ${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.textContent || ''}`;
      return matchers[k].test(meta);
    });
    if (!found) return null;
    const r = found.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null;
  }, kind);
  assert.ok(box, `Expected #arrowChip button for "${kind}"`);
  if (isTouch) await page.touchTap(box.cx, box.cy);
  else await page.mouseClick(box.cx, box.cy);
}

async function setupTwoTabOnlineMatch(browser, tabAOpts = {}, tabBOpts = {}) {
  const tabA = browser.page;
  const tabB = await browser.newPage({
    interceptOnline: true,
    onlineEmail: tabBOpts.email ?? 'challenger@example.com',
    onlineNick: tabBOpts.nick ?? 'OPONENTE'
  });

  await safeGoto(tabA, tabAOpts.url);
  await tabA.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
  await tabA.click('#segMode .seg[data-val="online"]');
  await tabA.waitFor(
    async () => {
      const txt = await tabA.text('#ratingLine');
      return Boolean(txt && txt.includes('Rating:'));
    },
    { timeoutMs: UI_TIMEOUT, message: 'Tab A online init did not populate #ratingLine' }
  );
  if (tabAOpts.linkGoogle) {
    await tabA.click('#btnGoogle');
    await tabA.waitFor(
      async () => ((await tabA.text('#btnGoogle')) || '').includes('Conectado'),
      { timeoutMs: UI_TIMEOUT, message: 'Tab A Google link did not finish' }
    );
  }
  await tabA.click('#btnCreateRoom');
  await tabA.waitForSelector('#roomCodeTxt', { visible: true, timeoutMs: UI_TIMEOUT });
  const code = (await tabA.text('#roomCodeTxt')).trim();
  assert.match(code, /^[A-Z0-9]{4,8}$/, `Expected valid room code, got "${code}"`);

  await safeGoto(tabB, tabAOpts.url);
  await tabB.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
  await tabB.click('#segMode .seg[data-val="online"]');
  await tabB.waitFor(
    async () => {
      const txt = await tabB.text('#ratingLine');
      return Boolean(txt && txt.includes('Rating:'));
    },
    { timeoutMs: UI_TIMEOUT, message: 'Tab B online init did not populate #ratingLine' }
  );
  if (tabBOpts.linkGoogle) {
    await tabB.click('#btnGoogle');
    await tabB.waitFor(
      async () => ((await tabB.text('#btnGoogle')) || '').includes('Conectado'),
      { timeoutMs: UI_TIMEOUT, message: 'Tab B Google link did not finish' }
    );
  }
  await tabB.click('#btnShowJoin');
  await tabB.waitForSelector('#joinInput', { visible: true, timeoutMs: UI_TIMEOUT });
  await tabB.type('#joinInput', code);
  await tabB.click('#btnJoinRoom');

  await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), {
    timeoutMs: UI_TIMEOUT,
    message: 'Tab B did not enter online game'
  });
  await tabA.bringToFront();
  await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), {
    timeoutMs: UI_TIMEOUT,
    message: 'Tab A did not enter online game'
  });

  return { tabA, tabB, code };
}

describe('Tier 3: Pairwise Cross-Feature Combination Tests', () => {
  let offlineServer;
  let onlineServer;

  before(async () => {
    offlineServer = await startViteServer({ mode: 'dev', envOverride: { VITE_FIREBASE_API_KEY: '' } });
    onlineServer = await startViteServer({ mode: 'dev', envOverride: { VITE_FIREBASE_API_KEY: 'e2e-test-key' } });
    await fetch(offlineServer.url).catch(() => {});
    await fetch(onlineServer.url).catch(() => {});
  });

  after(async () => {
    await offlineServer?.close();
    await onlineServer?.close();
  });

  it('T3.01 Flipped board (#btnFlip) + PC right-drag arrows + 3D hint (#btnHint / #hintBanner)', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });
      await ensureView2D(page);
      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });

      await page.click('#btnFlip');
      await sleep(600);

      await rightDragArrow(page, 'd2', 'd4', { side: 'b', shift: true });
      await rightDragArrow(page, 'g1', 'f3', { side: 'b' });
      await rightClickSquare(page, 'c4', { side: 'b', alt: true });

      const ctxEvents = await page.evalJs(() => window.__e2eContextMenuEvents || []);
      assert.ok(ctxEvents.length >= 2, 'Expected contextmenu events recorded on #c3d');
      assert.ok(ctxEvents.every((e) => e.defaultPrevented === true), 'Expected contextmenu suppressed on #c3d');

      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner', { visible: true, timeoutMs: WORKER_TIMEOUT });
      const hintText = await page.text('#hintBanner');
      assert.ok(hintText && hintText.trim().length > 0, '#hintBanner should display recommended move / PV');

      const emptySq = await squareToXY(page, 'a3', { side: 'b', topDown: true });
      await page.mouseClick(emptySq.x, emptySq.y, { button: 'left' });

      await dismissHintBanner(page);
      await playMove(page, 'd2', 'd4', { side: 'b', waitForAI: true });
      assert.ok((await getHistPlies(page)) >= 4, 'Play should continue cleanly on flipped board after arrows + hint');

      page.assertNoErrors('T3.01');
    } finally {
      await browser.close();
    }
  });

  it('T3.02 History navigation (viewPly < N, #liveBanner) + post-game analysis (#btnAnalyze) + quality switch (high -> low)', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '0' });
      await ensureView2D(page);

      // Fool's Mate
      await playMove(page, 'f2', 'f3', { side: 'w', waitForFlip: true });
      await playMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await playMove(page, 'g2', 'g4', { side: 'w', waitForFlip: true });
      await playMove(page, 'd8', 'h4', { side: 'b', waitForFlip: false });

      await page.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: UI_TIMEOUT });

      await page.click('#btnHistPrev');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });
      assert.match((await page.text('#liveBanner')) || '', /voltar ao vivo/i);
      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      await openSettings(page);
      await page.click('#segQuality .seg[data-val="high"]');
      assert.equal(await page.hasClass('#segQuality .seg[data-val="high"]', 'active'), true);
      await page.click('#segQuality .seg[data-val="low"]');
      assert.equal(await page.hasClass('#segQuality .seg[data-val="low"]', 'active'), true);
      await closeSettings(page);

      if (!(await page.isVisible('#btnAnalyze'))) {
        await page.click('#btnNewMenu');
        await page.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
        await startLocalGame(page, { mode: 'pvp', tc: '0' });
        await ensureView2D(page);
        await playMove(page, 'f2', 'f3', { side: 'w', waitForFlip: true });
        await playMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
        await playMove(page, 'g2', 'g4', { side: 'w', waitForFlip: true });
        await playMove(page, 'd8', 'h4', { side: 'b', waitForFlip: false });
        await page.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      }
      await page.click('#btnAnalyze');
      await waitForAnalysisComplete(page);

      await clickAnalysisGraphEarlierPly(page);
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });

      page.assertNoErrors('T3.02');
    } finally {
      await browser.close();
    }
  });

  it('T3.03 Mobile 360x740 arrowMode (#btnArrows + #arrowChip) + 2D view + orbit lock + piece tap lock + toggle back to play', async () => {
    const browser = await launchBrowser({
      viewport: { width: 360, height: 740 },
      mobile: true,
      hasTouch: true
    });
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });

      const btn2DBox = await page.boundingBox('#btnView2D');
      assert.ok(btn2DBox, '#btnView2D must be visible on mobile');
      await page.touchTap(btn2DBox.cx, btn2DBox.cy);
      await sleep(430);
      assert.equal(await page.hasClass('#btnView2D', 'active'), true);
      await assertHudNoOverlap(page);

      const arrowsBtnBox = await page.boundingBox('#btnArrows');
      assert.ok(arrowsBtnBox, '#btnArrows must be visible on mobile');
      await page.touchTap(arrowsBtnBox.cx, arrowsBtnBox.cy);
      await page.waitFor(() => page.hasClass('#btnArrows', 'active'), { timeoutMs: UI_TIMEOUT });
      await page.waitForSelector('#arrowChip', { visible: true, timeoutMs: UI_TIMEOUT });
      assert.equal(await page.evalJs(() => document.querySelector('#btnArrows')?.getAttribute('aria-pressed')), 'true');
      await assertHudNoOverlap(page);

      const beforeShot = await page.screenshot();
      await touchDragArrow(page, 'e2', 'e4', { side: 'w' });
      await touchTapSquare(page, 'e2', { side: 'w' });
      await sleep(120);
      assert.equal(await getHistPlies(page), 0, 'No move should occur while arrowMode is active');
      const afterShot = await page.screenshot();
      assert.equal(beforeShot.equals(afterShot), false, 'Annotation draw should visibly update #c3d without orbiting');

      await selectArrowChipAction(page, 'red', true);
      await touchDragArrow(page, 'g1', 'f3', { side: 'w' });
      await selectArrowChipAction(page, 'clear', true);

      const arrowsBtnBox2 = await page.boundingBox('#btnArrows');
      await page.touchTap(arrowsBtnBox2.cx, arrowsBtnBox2.cy);
      await page.waitFor(async () => !(await page.hasClass('#btnArrows', 'active')), { timeoutMs: UI_TIMEOUT });
      await page.waitFor(async () => !(await page.isVisible('#arrowChip')), { timeoutMs: UI_TIMEOUT });

      await touchTapSquare(page, 'e2', { side: 'w' });
      await sleep(60);
      await touchTapSquare(page, 'e4', { side: 'w' });
      await page.waitFor(async () => (await getHistPlies(page)) >= 2, {
        timeoutMs: WORKER_TIMEOUT,
        message: 'Touch move e2->e4 + AI reply did not execute after exiting arrowMode'
      });

      page.assertNoErrors('T3.03');
    } finally {
      await browser.close();
    }
  });

  it('T3.04 VIP online (elkaua1227@gmail.com) + #evalWrap + #btnHint + off-turn premove arm & execute', async () => {
    const browser = await launchBrowser({
      interceptOnline: true,
      onlineEmail: 'elkaua1227@gmail.com',
      onlineNick: 'VIPHOST'
    });
    try {
      const { tabA, tabB } = await setupTwoTabOnlineMatch(
        browser,
        { url: onlineServer.url, linkGoogle: true },
        { email: 'nonvip@example.com', nick: 'GUESTBLK', linkGoogle: true }
      );

      await tabA.bringToFront();
      assert.match((await tabA.text('#ratingLine')) || '', /VIP/);
      await openSettings(tabA);
      await tabA.click('#segEval .seg[data-val="1"]');
      await closeSettings(tabA);

      await tabA.waitForSelector('#evalWrap', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabA.waitForSelector('#btnHint', { visible: true, timeoutMs: UI_TIMEOUT });

      await tabA.click('#btnHint');
      await tabA.waitForSelector('#hintBanner', { visible: true, timeoutMs: WORKER_TIMEOUT });

      await ensureView2D(tabA);
      await playMove(tabA, 'e2', 'e4', { side: 'w' });
      assert.equal(await getHistPlies(tabA), 1);

      await sleep(80);
      const d2 = await squareToXY(tabA, 'd2', { side: 'w', topDown: true });
      const d4 = await squareToXY(tabA, 'd4', { side: 'w', topDown: true });
      await tabA.mouseClick(d2.x, d2.y);
      await sleep(60);
      await tabA.mouseClick(d4.x, d4.y);
      await sleep(120);
      assert.equal(await getHistPlies(tabA), 1, 'Off-turn premove must not advance chess history before opponent moves');

      await tabB.bringToFront();
      await tabB.waitFor(async () => (await getHistPlies(tabB)) >= 1, { timeoutMs: UI_TIMEOUT });
      await ensureView2D(tabB);
      await playMove(tabB, 'e7', 'e5', { side: 'b' });

      await tabA.bringToFront();
      await tabA.waitFor(async () => (await getHistPlies(tabA)) === 3, {
        timeoutMs: UI_TIMEOUT,
        message: 'Armed premove d2->d4 did not auto-execute after opponent move e5'
      });
      const movesA = await getHistMoves(tabA);
      assert.deepEqual(movesA, ['e4', 'e5', 'd4']);
      assert.equal(await tabA.isVisible('#evalWrap'), true);

      browser.assertNoErrors('T3.04');
    } finally {
      await browser.close();
    }
  });

  it('T3.05 Captures + #btnUndo + sorted #capsW/#capsB + +N material lead + eval bar update', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '0' });
      await openSettings(page);
      await page.click('#segEval .seg[data-val="1"]');
      await closeSettings(page);

      await ensureView2D(page);
      await page.waitForSelector('#evalWrap', { visible: true, timeoutMs: UI_TIMEOUT });

      // 1. e4 d5 2. exd5 Nc6 3. dxc6
      await playMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await playMove(page, 'd7', 'd5', { side: 'b', waitForFlip: true });
      await playMove(page, 'e4', 'd5', { side: 'w', waitForFlip: true });
      const capsAfterPawn = (await page.text('#capsW')) || '';
      assert.ok(capsAfterPawn.includes('♟'), `Expected captured pawn in #capsW, got "${capsAfterPawn}"`);
      assert.ok(capsAfterPawn.includes('+1'), `Expected +1 material lead in #capsW, got "${capsAfterPawn}"`);

      await playMove(page, 'b8', 'c6', { side: 'b', waitForFlip: true });
      await playMove(page, 'd5', 'c6', { side: 'w', waitForFlip: true });

      const capsAfterKnight = (await page.text('#capsW')) || '';
      assert.ok(capsAfterKnight.includes('♞') && capsAfterKnight.includes('♟'), `Expected knight + pawn in #capsW, got "${capsAfterKnight}"`);
      assert.ok(capsAfterKnight.indexOf('♞') < capsAfterKnight.indexOf('♟'), `Expected knight sorted before pawn in #capsW: "${capsAfterKnight}"`);
      assert.ok(capsAfterKnight.includes('+4'), `Expected +4 material lead in #capsW, got "${capsAfterKnight}"`);

      await page.waitFor(
        async () => {
          const val = parseFloat((await page.text('#evalNum')) || '0');
          return Number.isFinite(val) && val > 1.5;
        },
        { timeoutMs: WORKER_TIMEOUT, message: 'Expected #evalNum to reflect White +4 material advantage' }
      );

      await page.click('#btnUndo');
      await page.waitFor(async () => (await getHistPlies(page)) === 4, { timeoutMs: UI_TIMEOUT });
      const capsReverted = (await page.text('#capsW')) || '';
      assert.equal(capsReverted.includes('♞'), false, 'Undoing dxc6 must remove captured knight from #capsW');
      assert.ok(capsReverted.includes('♟') && capsReverted.includes('+1'), `Expected +1 pawn capture restored in #capsW, got "${capsReverted}"`);
      assert.equal(((await page.text('#capsB')) || '').trim(), '');

      page.assertNoErrors('T3.05');
    } finally {
      await browser.close();
    }
  });

  it('T3.06 Board/piece theme switches + PBR quality profile switches + 3D hint ghost piece', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });
      await ensureView2D(page);
      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });

      await page.click('#btnView2D');
      await page.waitFor(async () => !(await page.hasClass('#btnView2D', 'active')), {
        timeoutMs: UI_TIMEOUT,
        message: '#btnView2D did not toggle back to 3D mode'
      });

      await openSettings(page);
      await page.click('#boardSwatches .swatch-btn:nth-child(2)');
      await page.click('#pieceSwatches .swatch-btn:nth-child(4)');
      await page.click('#segQuality .seg[data-val="high"]');
      await closeSettings(page);

      const shotHigh = await page.screenshot();
      assert.ok(shotHigh.length > 5000, 'Expected non-empty WebGL screenshot in high quality');

      await page.click('#btnHint');
      await page.waitForSelector('#hintBanner', { visible: true, timeoutMs: WORKER_TIMEOUT });
      const shotHint = await page.screenshot();
      assert.equal(shotHigh.equals(shotHint), false, '3D hint arrow + ghost + banner should visibly update rendered frame');

      await openSettings(page);
      await page.click('#boardSwatches .swatch-btn:nth-child(3)');
      await page.click('#pieceSwatches .swatch-btn:nth-child(2)');
      await page.click('#segQuality .seg[data-val="medium"]');
      await page.click('#segQuality .seg[data-val="low"]');
      await closeSettings(page);

      const canvasBox = await page.boundingBox('#c3d');
      assert.equal(canvasBox.width, 1280);
      assert.equal(canvasBox.height, 800);

      page.assertNoErrors('T3.06');
    } finally {
      await browser.close();
    }
  });

  it('T3.07 #menuOverlay clock pause + #btnResumeGame + #settingsOverlay reload persistence', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '180000' });

      await openSettings(page);
      await page.click('#segQuality .seg[data-val="medium"]');
      await page.click('#segHaptics .seg[data-val="0"]');
      await page.click('#segEval .seg[data-val="1"]');
      await page.click('#boardSwatches .swatch-btn:nth-child(3)');
      await page.click('#pieceSwatches .swatch-btn:nth-child(2)');
      await closeSettings(page);

      await page.waitForSelector('#clockW', { visible: true, timeoutMs: UI_TIMEOUT });
      await sleep(1100);

      // Open #menuOverlay -> clock must pause and #btnResumeGame must appear
      await page.click('#btnHome');
      await page.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      await page.waitForSelector('#btnResumeGame', { visible: true, timeoutMs: UI_TIMEOUT });
      const pausedClock = (await page.text('#clockW')).trim();
      await sleep(2200);
      assert.equal((await page.text('#clockW')).trim(), pausedClock, 'Local clock must stay paused while #menuOverlay is open');

      await page.click('#btnResumeGame');
      await page.waitFor(() => page.hasClass('#menuOverlay', 'hide'), { timeoutMs: UI_TIMEOUT });
      await page.waitFor(
        async () => ((await page.text('#clockW')) || '').trim() !== pausedClock,
        { timeoutMs: 3000, message: 'Local clock did not resume counting down after #btnResumeGame' }
      );

      // Reload and verify #settingsOverlay active controls persisted
      await safeReload(page);
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });
      await openSettings(page);
      assert.equal(await page.hasClass('#segQuality .seg[data-val="medium"]', 'active'), true);
      assert.equal(await page.hasClass('#segHaptics .seg[data-val="0"]', 'active'), true);
      assert.equal(await page.hasClass('#segEval .seg[data-val="1"]', 'active'), true);
      assert.equal(await page.hasClass('#boardSwatches .swatch-btn:nth-child(3)', 'active'), true);
      assert.equal(await page.hasClass('#pieceSwatches .swatch-btn:nth-child(2)', 'active'), true);
      await closeSettings(page);

      page.assertNoErrors('T3.07');
    } finally {
      await browser.close();
    }
  });

  it('T3.08 Online draw offer (#drawBar) + history inspection + 2-tap #btnResign', async () => {
    const browser = await launchBrowser({
      interceptOnline: true,
      onlineEmail: 'white@example.com',
      onlineNick: 'WHITEP'
    });
    try {
      const { tabA, tabB } = await setupTwoTabOnlineMatch(
        browser,
        { url: onlineServer.url },
        { email: 'black@example.com', nick: 'BLACKP' }
      );

      await tabA.bringToFront();
      await ensureView2D(tabA);
      await playMove(tabA, 'e2', 'e4', { side: 'w' });

      await tabB.bringToFront();
      await tabB.waitFor(async () => (await getHistPlies(tabB)) >= 1, { timeoutMs: UI_TIMEOUT });
      await ensureView2D(tabB);
      await playMove(tabB, 'e7', 'e5', { side: 'b' });

      await tabA.bringToFront();
      await tabA.waitFor(async () => (await getHistPlies(tabA)) >= 2, { timeoutMs: UI_TIMEOUT });
      await tabA.click('#btnHistPrev');
      await tabA.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });

      await tabB.bringToFront();
      await tabB.click('#btnDraw');

      await tabA.bringToFront();
      await tabA.waitForSelector('#drawBar', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabA.click('#btnDrawNo');
      await tabA.waitFor(async () => !(await tabA.isVisible('#drawBar')), { timeoutMs: UI_TIMEOUT });

      await tabA.click('#liveBanner');
      await tabA.waitFor(async () => !(await tabA.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      const initialResignTxt = await tabA.text('#btnResign');
      await tabA.click('#btnResign');
      await sleep(120);
      assert.equal(await tabA.hasClass('#overOverlay', 'hide'), true, 'First click on #btnResign must not forfeit immediately');
      const confirmTxt = await tabA.text('#btnResign');
      assert.notEqual(confirmTxt, initialResignTxt, '#btnResign should show confirmation prompt on first tap');

      await tabA.click('#btnResign');
      await tabA.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      assert.match((await tabA.text('#overTitle')) || '', /Pretas Vencem/i);

      await tabB.bringToFront();
      await tabB.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      assert.match((await tabB.text('#overTitle')) || '', /Pretas Vencem/i);

      browser.assertNoErrors('T3.08');
    } finally {
      await browser.close();
    }
  });

  it('T3.09 Keyboard shortcuts (V, F, H, ArrowLeft, ArrowRight, End, Esc) combined workflow', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });

      await page.pressKey('v');
      await page.waitFor(() => page.hasClass('#btnView2D', 'active'), {
        timeoutMs: UI_TIMEOUT,
        message: 'Key V should enable 2D mode'
      });

      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });
      await playMove(page, 'd2', 'd4', { side: 'w', waitForAI: true });

      await page.pressKey('h');
      await page.waitForSelector('#hintBanner', { visible: true, timeoutMs: WORKER_TIMEOUT });

      await page.pressKey('Escape');
      await page.waitFor(async () => !(await page.isVisible('#hintBanner')), {
        timeoutMs: UI_TIMEOUT,
        message: 'Escape should dismiss #hintBanner before opening menu'
      });

      await page.pressKey('ArrowLeft');
      await page.pressKey('ArrowLeft');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });

      await page.pressKey('ArrowRight');
      assert.equal(await page.isVisible('#liveBanner'), true);

      await page.pressKey('End');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      await page.pressKey('f');
      await sleep(580);

      await playMove(page, 'c2', 'c4', { side: 'b', waitForAI: true });
      assert.ok((await getHistPlies(page)) >= 6);

      await page.pressKey('v');
      await page.waitFor(async () => !(await page.hasClass('#btnView2D', 'active')), {
        timeoutMs: UI_TIMEOUT,
        message: 'Key V should toggle back to 3D mode'
      });

      page.assertNoErrors('T3.09');
    } finally {
      await browser.close();
    }
  });

  it('T3.10 Analysis SVG eval graph click + #liveBanner + manual arrow overlay', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '0' });
      await ensureView2D(page);

      await playMove(page, 'f2', 'f3', { side: 'w', waitForFlip: true });
      await playMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await playMove(page, 'g2', 'g4', { side: 'w', waitForFlip: true });
      await playMove(page, 'd8', 'h4', { side: 'b', waitForFlip: false });

      await page.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      await page.click('#btnAnalyze');
      await waitForAnalysisComplete(page);

      await clickAnalysisGraphEarlierPly(page);
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });

      const beforeAnnot = await page.screenshot();
      await rightDragArrow(page, 'e5', 'h4', { side: 'b' });
      await rightDragArrow(page, 'g2', 'g4', { side: 'b', shift: true });
      const afterAnnot = await page.screenshot();
      assert.equal(beforeAnnot.equals(afterAnnot), false, 'Manual arrows should render over inspected analysis position');

      const empty = await squareToXY(page, 'a3', { side: 'b', topDown: true });
      await page.mouseClick(empty.x, empty.y, { button: 'left' });

      await page.click('#liveBanner');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      page.assertNoErrors('T3.10');
    } finally {
      await browser.close();
    }
  });

  it('T3.11 Timed PvE + mobile 390x844 + #evalWrap + #btnSound mute + assertHudNoOverlap', async () => {
    const browser = await launchBrowser({
      viewport: { width: 390, height: 844 },
      mobile: true,
      hasTouch: true
    });
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '180000' });

      await openSettings(page);
      await page.click('#segEval .seg[data-val="1"]');
      await closeSettings(page);

      await page.waitForSelector('#clockW', { visible: true, timeoutMs: UI_TIMEOUT });
      await page.waitForSelector('#clockB', { visible: true, timeoutMs: UI_TIMEOUT });
      await page.waitForSelector('#evalWrap', { visible: true, timeoutMs: UI_TIMEOUT });

      const soundBox = await page.boundingBox('#btnSound');
      await page.touchTap(soundBox.cx, soundBox.cy);
      await page.waitFor(async () => ((await page.text('#btnSound')) || '').includes('🔇'), { timeoutMs: UI_TIMEOUT });
      assert.equal(await page.evalJs(() => document.querySelector('#btnSound')?.getAttribute('aria-pressed')), 'true');

      await assertHudNoOverlap(page);

      const v2dBox = await page.boundingBox('#btnView2D');
      await page.touchTap(v2dBox.cx, v2dBox.cy);
      await sleep(420);

      const startsBefore = await page.evalJs(() => window.__e2eAudioSpy?.starts ?? 0);
      await touchTapSquare(page, 'e2', { side: 'w' });
      await sleep(60);
      await touchTapSquare(page, 'e4', { side: 'w' });
      await page.waitFor(async () => (await getHistPlies(page)) >= 2, {
        timeoutMs: WORKER_TIMEOUT,
        message: 'Timed mobile PvE move + AI reply failed'
      });
      const startsAfter = await page.evalJs(() => window.__e2eAudioSpy?.starts ?? 0);
      assert.equal(startsAfter, startsBefore, 'Muted #btnSound must suppress AudioContext oscillator starts');

      await assertHudNoOverlap(page);
      page.assertNoErrors('T3.11');
    } finally {
      await browser.close();
    }
  });

  it('T3.12 Pawn promotion (#promoModal) + mate eval M1/-M1 + post-game #btnAnalyze', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '0' });
      await openSettings(page);
      await page.click('#segEval .seg[data-val="1"]');
      await closeSettings(page);

      await ensureView2D(page);
      await page.waitForSelector('#evalWrap', { visible: true, timeoutMs: UI_TIMEOUT });

      const sequence = [
        ['e2', 'e4', 'w'],
        ['f7', 'f5', 'b'],
        ['e4', 'f5', 'w'],
        ['g7', 'g6', 'b'],
        ['f5', 'g6', 'w'],
        ['h7', 'h6', 'b'],
        ['g6', 'g7', 'w'],
        ['g8', 'f6', 'b']
      ];
      for (const [f, t, s] of sequence) {
        await playMove(page, f, t, { side: s, waitForFlip: true });
        await sleep(220);
      }

      await playMove(page, 'g7', 'h8', { side: 'w', promotion: 'q', waitForFlip: true });
      await sleep(220);
      const movesAfterPromo = await getHistMoves(page);
      assert.ok(movesAfterPromo.some((m) => m.includes('=Q')), `Expected =Q promotion in history: ${JSON.stringify(movesAfterPromo)}`);

      await playMove(page, 'a7', 'a6', { side: 'b', waitForFlip: true });
      await playMove(page, 'h8', 'g7', { side: 'w', waitForFlip: true });
      await playMove(page, 'a6', 'a5', { side: 'b', waitForFlip: true });

      await page.waitFor(
        async () => /^-?M\d+$/.test(((await page.text('#evalNum')) || '').trim()),
        { timeoutMs: WORKER_TIMEOUT, message: 'Expected mate notation (e.g. M1) on #evalNum before Qg6#' }
      );
      const mateText = ((await page.text('#evalNum')) || '').trim();
      assert.match(mateText, /^M1$/, `Expected M1 on #evalNum, got "${mateText}"`);

      await playMove(page, 'g7', 'g6', { side: 'w', waitForFlip: false });
      await page.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      assert.match((await page.text('#overTitle')) || '', /Brancas Vencem/i);

      await page.click('#btnAnalyze');
      await waitForAnalysisComplete(page);

      page.assertNoErrors('T3.12');
    } finally {
      await browser.close();
    }
  });
});
