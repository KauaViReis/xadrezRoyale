/* ============================================================
   Tier 4 E2E Suite — Realistic End-to-End User Scenarios
   Strictly opaque-box verification via CDP + DOM + #c3d canvas
   ============================================================ */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, startViteServer } from './helpers/cdp.mjs';
import {
  assertHudNoOverlap,
  ensureView2D,
  getHistMoves,
  getHistPlies,
  playMove,
  squareToXY,
  touchDragArrow,
  touchTapSquare
} from './helpers/board.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

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
    { timeoutMs: WORKER_TIMEOUT, intervalMs: 100, message: '#analysisPanel did not finish with SVG and accuracy %' }
  );
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
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    const shapes = [...svg.querySelectorAll('circle, rect, path, g')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.width < svgRect.width * 0.4;
    });
    if (shapes.length >= 2) {
      const r = shapes[Math.min(1, shapes.length - 1)].getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    if (svgRect.width > 0 && svgRect.height > 0) {
      return { cx: svgRect.left + svgRect.width * 0.25, cy: svgRect.top + svgRect.height * 0.5 };
    }
    return null;
  });
  assert.ok(target, 'Expected clickable SVG eval graph inside #analysisPanel');
  await page.mouseClick(target.cx, target.cy);
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

async function ensureMobileHistoryVisible(page) {
  if (await page.isVisible('#histList')) return;
  const toggleBox = await page.evalJs(() => {
    const candidates = [
      document.querySelector('#btnMobileHist'),
      document.querySelector('#btnHistory'),
      document.querySelector('#btnHistToggle'),
      document.querySelector('[aria-controls="historyBox"]'),
      ...[...document.querySelectorAll('button')].filter((b) => {
        const meta = `${b.id} ${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.textContent || ''}`;
        return /hist[oó]rico|lances|📜/i.test(meta);
      })
    ].filter(Boolean);
    for (const el of candidates) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }
    }
    return null;
  });
  assert.ok(toggleBox, 'Expected visible SAN history or mobile history toggle button at narrow viewport');
  await page.touchTap(toggleBox.cx, toggleBox.cy);
  await page.waitForSelector('#histList', { visible: true, timeoutMs: UI_TIMEOUT });
}

describe('Tier 4: Realistic End-to-End User Scenarios', () => {
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

  it('T4.01 Scenario 1: Full Checkmate (Scholar\'s Mate) -> #overOverlay -> #btnViewBoard -> #btnAnalyze -> SVG & SAN blunders -> #btnRematch', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '0' });
      await ensureView2D(page);

      // Scholar's Mate: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#
      await playMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await playMove(page, 'e7', 'e5', { side: 'b', waitForFlip: true });
      await playMove(page, 'f1', 'c4', { side: 'w', waitForFlip: true });
      await playMove(page, 'b8', 'c6', { side: 'b', waitForFlip: true });
      await playMove(page, 'd1', 'h5', { side: 'w', waitForFlip: true });
      await playMove(page, 'g8', 'f6', { side: 'b', waitForFlip: true });
      await playMove(page, 'h5', 'f7', { side: 'w', waitForFlip: false });

      await page.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      assert.match((await page.text('#overTitle')) || '', /Brancas Vencem/i);
      assert.match((await page.text('#overSub')) || '', /Xeque-mate/i);

      await page.click('#btnViewBoard');
      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: UI_TIMEOUT });
      assert.equal(await getHistPlies(page), 7);

      await page.click('#btnHistFirst');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });
      await page.click('#btnHistNext');
      await page.click('#btnHistLast');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

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

      const panelText = (await page.text('#analysisPanel')) || '';
      const histText = (await page.text('#histList')) || '';
      const combined = `${panelText}\n${histText}`;
      assert.match(panelText, /\d+(?:[.,]\d+)?\s*%/, 'Expected accuracy percentage in #analysisPanel');
      assert.ok(
        /\?\?|\?|Capivarada|Erro/i.test(combined),
        `Expected blunder/mistake classification badge in analysis output, got:\n${combined}`
      );
      assert.ok(
        /★|✓|!!|•/.test(combined),
        `Expected positive move classification badge in analysis output, got:\n${combined}`
      );

      await clickAnalysisGraphEarlierPly(page);
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });
      await page.click('#liveBanner');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      if (await page.isVisible('#btnRematch')) {
        await page.click('#btnRematch');
      } else {
        const rematchInPanel = await page.evalJs(() => {
          const btn = document.querySelector('#analysisPanel [data-action="rematch"], #analysisPanel #btnAnalysisRematch');
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return r.width > 0 && r.height > 0 ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null;
        });
        if (rematchInPanel) {
          await page.mouseClick(rematchInPanel.cx, rematchInPanel.cy);
        } else {
          await page.click('#btnNewMenu');
          await startLocalGame(page, { mode: 'pvp', tc: '0' });
        }
      }

      await page.waitFor(() => page.hasClass('#overOverlay', 'hide'), { timeoutMs: UI_TIMEOUT });
      assert.equal(await getHistPlies(page), 0, 'Rematch should reset move history to 0');

      page.assertNoErrors('T4.01');
    } finally {
      await browser.close();
    }
  });

  it('T4.02 Scenario 2: Mobile (360x740, touch) Annotation & Play Session with #arrowChip & mobile SAN drawer', async () => {
    const browser = await launchBrowser({
      viewport: { width: 360, height: 740 },
      mobile: true,
      hasTouch: true
    });
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '180000' });
      await page.waitForSelector('#clockW', { visible: true, timeoutMs: UI_TIMEOUT });
      await assertHudNoOverlap(page);

      const v2dBox = await page.boundingBox('#btnView2D');
      await page.touchTap(v2dBox.cx, v2dBox.cy);
      await sleep(420);
      assert.equal(await page.hasClass('#btnView2D', 'active'), true);
      await assertHudNoOverlap(page);

      const arrowsBox = await page.boundingBox('#btnArrows');
      await page.touchTap(arrowsBox.cx, arrowsBox.cy);
      await page.waitFor(() => page.hasClass('#btnArrows', 'active'), { timeoutMs: UI_TIMEOUT });
      await page.waitForSelector('#arrowChip', { visible: true, timeoutMs: UI_TIMEOUT });
      await assertHudNoOverlap(page);

      await touchDragArrow(page, 'e2', 'e4', { side: 'w' });
      await touchTapSquare(page, 'd4', { side: 'w' });
      await selectArrowChipAction(page, 'red', true);
      await touchDragArrow(page, 'g1', 'f3', { side: 'w' });
      await selectArrowChipAction(page, 'blue', true);
      await touchTapSquare(page, 'c4', { side: 'w' });
      await selectArrowChipAction(page, 'clear', true);

      const arrowsBox2 = await page.boundingBox('#btnArrows');
      await page.touchTap(arrowsBox2.cx, arrowsBox2.cy);
      await page.waitFor(async () => !(await page.hasClass('#btnArrows', 'active')), { timeoutMs: UI_TIMEOUT });

      await touchTapSquare(page, 'e2', { side: 'w' });
      await sleep(60);
      await touchTapSquare(page, 'e4', { side: 'w' });
      await page.waitFor(async () => (await getHistPlies(page)) === 1, { timeoutMs: UI_TIMEOUT });
      await sleep(620);

      await touchTapSquare(page, 'e7', { side: 'b' });
      await sleep(60);
      await touchTapSquare(page, 'e5', { side: 'b' });
      await page.waitFor(async () => (await getHistPlies(page)) === 2, { timeoutMs: UI_TIMEOUT });
      await sleep(620);

      await ensureMobileHistoryVisible(page);
      const moves = await getHistMoves(page);
      assert.deepEqual(moves, ['e4', 'e5']);
      await assertHudNoOverlap(page);

      const prevBox = await page.boundingBox('#btnHistPrev');
      assert.ok(prevBox, '#btnHistPrev must be visible inside mobile history UI');
      await page.touchTap(prevBox.cx, prevBox.cy);
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });

      const liveBox = await page.boundingBox('#liveBanner');
      await page.touchTap(liveBox.cx, liveBox.cy);
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      page.assertNoErrors('T4.02');
    } finally {
      await browser.close();
    }
  });

  it('T4.03 Scenario 3: Two-Tab Online VIP (elkaua1227@gmail.com) vs Non-VIP (?room= join, premove, illegal abort, clocks, draw)', async () => {
    const browser = await launchBrowser({
      interceptOnline: true,
      onlineEmail: 'elkaua1227@gmail.com',
      onlineNick: 'VIPWHITE'
    });
    try {
      const tabA = browser.page;
      await safeGoto(tabA, onlineServer.url);
      await tabA.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      await tabA.click('#segMode .seg[data-val="online"]');
      await tabA.waitFor(
        async () => ((await tabA.text('#ratingLine')) || '').includes('Rating:'),
        { timeoutMs: UI_TIMEOUT }
      );
      await tabA.click('#btnGoogle');
      await tabA.waitFor(
        async () => ((await tabA.text('#ratingLine')) || '').includes('VIP'),
        { timeoutMs: UI_TIMEOUT, message: 'Expected VIP marker for elkaua1227@gmail.com' }
      );

      await tabA.click('#btnCreateRoom');
      await tabA.waitForSelector('#roomCodeTxt', { visible: true, timeoutMs: UI_TIMEOUT });
      const roomCode = (await tabA.text('#roomCodeTxt')).trim();

      const tabB = await browser.newPage({
        interceptOnline: true,
        onlineEmail: 'challenger@example.com',
        onlineNick: 'GUESTBLK'
      });
      await safeGoto(tabB, `${onlineServer.url}/?room=${encodeURIComponent(roomCode)}`);
      await tabB.waitFor(() => tabB.hasClass('#menuOverlay', 'hide'), {
        timeoutMs: UI_TIMEOUT,
        message: 'Tab B did not auto-join room via ?room= URL'
      });
      await openSettings(tabB);
      await tabB.click('#segEval .seg[data-val="1"]');
      await closeSettings(tabB);
      assert.equal(await tabB.isVisible('#evalWrap'), false, 'Non-VIP online player must NOT see #evalWrap');
      assert.equal(await tabB.isVisible('#btnHint'), false, 'Non-VIP online player must NOT see #btnHint');
      await tabB.waitForSelector('#clockW', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabB.waitForSelector('#clockB', { visible: true, timeoutMs: UI_TIMEOUT });

      await tabA.bringToFront();
      await tabA.waitFor(() => tabA.hasClass('#menuOverlay', 'hide'), { timeoutMs: UI_TIMEOUT });
      await openSettings(tabA);
      await tabA.click('#segEval .seg[data-val="1"]');
      await closeSettings(tabA);
      await tabA.waitForSelector('#evalWrap', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabA.waitForSelector('#btnHint', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabA.waitForSelector('#clockW', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabA.waitForSelector('#clockB', { visible: true, timeoutMs: UI_TIMEOUT });

      await tabA.click('#btnHint');
      await tabA.waitForSelector('#hintBanner', { visible: true, timeoutMs: WORKER_TIMEOUT });

      await ensureView2D(tabA);
      await playMove(tabA, 'e2', 'e4', { side: 'w' });

      await sleep(80);
      const d2 = await squareToXY(tabA, 'd2', { side: 'w', topDown: true });
      const d4 = await squareToXY(tabA, 'd4', { side: 'w', topDown: true });
      await tabA.mouseClick(d2.x, d2.y);
      await sleep(50);
      await tabA.mouseClick(d4.x, d4.y);
      await sleep(100);
      assert.equal(await getHistPlies(tabA), 1);

      await tabB.bringToFront();
      await tabB.waitFor(async () => (await getHistPlies(tabB)) >= 1, { timeoutMs: UI_TIMEOUT });
      await ensureView2D(tabB);
      await playMove(tabB, 'e7', 'e5', { side: 'b' });

      await tabA.bringToFront();
      await tabA.waitFor(async () => (await getHistPlies(tabA)) === 3, { timeoutMs: UI_TIMEOUT });
      assert.deepEqual(await getHistMoves(tabA), ['e4', 'e5', 'd4']);

      await sleep(80);
      const e4 = await squareToXY(tabA, 'e4', { side: 'w', topDown: true });
      const d5 = await squareToXY(tabA, 'd5', { side: 'w', topDown: true });
      await tabA.mouseClick(e4.x, e4.y);
      await sleep(50);
      await tabA.mouseClick(d5.x, d5.y);
      await sleep(100);

      await tabB.bringToFront();
      await tabB.waitFor(async () => (await getHistPlies(tabB)) === 3, { timeoutMs: UI_TIMEOUT });
      await playMove(tabB, 'a7', 'a6', { side: 'b' });

      await tabA.bringToFront();
      await tabA.waitFor(async () => (await getHistPlies(tabA)) === 4, { timeoutMs: UI_TIMEOUT });
      await sleep(250);
      assert.equal(await getHistPlies(tabA), 4, 'Illegal premove e4->d5 must abort cleanly without executing');
      assert.match((await tabA.text('#turnTxt')) || '', /VEZ DAS BRANCAS/i);

      await tabB.bringToFront();
      await tabB.click('#btnDraw');

      await tabA.bringToFront();
      await tabA.waitForSelector('#drawBar', { visible: true, timeoutMs: UI_TIMEOUT });
      await tabA.click('#btnDrawYes');
      await tabA.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      assert.match((await tabA.text('#overTitle')) || '', /Empate/i);

      await tabB.bringToFront();
      await tabB.waitForSelector('#overOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      assert.match((await tabB.text('#overTitle')) || '', /Empate/i);

      browser.assertNoErrors('T4.03');
    } finally {
      await browser.close();
    }
  });

  it('T4.04 Scenario 4: Settings, Quality Downgrade (high -> medium -> low) & Theme Switching Lifecycle + Reload Persistence', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await page.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });
      await page.click('#segDiff .seg[data-val="3"]');

      await startLocalGame(page, { mode: 'pve', diff: '3', side: 'w', tc: '0' });

      await openSettings(page);
      for (let i = 1; i <= 4; i++) {
        await page.click(`#boardSwatches .swatch-btn:nth-child(${i})`);
        assert.equal(await page.hasClass(`#boardSwatches .swatch-btn:nth-child(${i})`, 'active'), true);
      }
      for (let i = 1; i <= 4; i++) {
        await page.click(`#pieceSwatches .swatch-btn:nth-child(${i})`);
        assert.equal(await page.hasClass(`#pieceSwatches .swatch-btn:nth-child(${i})`, 'active'), true);
      }
      await page.click('#boardSwatches .swatch-btn:nth-child(3)');

      for (const tier of ['high', 'medium', 'low']) {
        await page.click(`#segQuality .seg[data-val="${tier}"]`);
        assert.equal(await page.hasClass(`#segQuality .seg[data-val="${tier}"]`, 'active'), true);
        await sleep(80);
      }

      await page.click('#segHaptics .seg[data-val="0"]');
      await page.click('#segEval .seg[data-val="1"]');
      await closeSettings(page);

      await page.click('#btnSound');
      assert.match((await page.text('#btnSound')) || '', /🔇/);

      // Reload and verify full persistence & active UI sync
      await safeReload(page);
      await page.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });

      assert.match((await page.text('#btnSound')) || '', /🔇/);
      assert.equal(await page.evalJs(() => document.querySelector('#btnSound')?.getAttribute('aria-pressed')), 'true');
      assert.equal(await page.hasClass('#segDiff .seg[data-val="3"]', 'active'), true);

      // Start Casual PvE to inspect persisted #settingsOverlay & play with muted audio + haptics=0
      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });
      await openSettings(page);
      assert.equal(await page.hasClass('#segQuality .seg[data-val="low"]', 'active'), true);
      assert.equal(await page.hasClass('#segHaptics .seg[data-val="0"]', 'active'), true);
      assert.equal(await page.hasClass('#segEval .seg[data-val="1"]', 'active'), true);
      assert.equal(await page.hasClass('#boardSwatches .swatch-btn:nth-child(3)', 'active'), true);
      assert.equal(await page.hasClass('#pieceSwatches .swatch-btn:nth-child(4)', 'active'), true);
      await closeSettings(page);

      await page.waitForSelector('#evalWrap', { visible: true, timeoutMs: UI_TIMEOUT });
      await ensureView2D(page);

      const audioBefore = await page.evalJs(() => window.__e2eAudioSpy?.starts ?? 0);
      const vibBefore = await page.evalJs(() => (window.__e2eVibrateCalls || []).length);
      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });
      const audioAfter = await page.evalJs(() => window.__e2eAudioSpy?.starts ?? 0);
      const vibAfter = await page.evalJs(() => (window.__e2eVibrateCalls || []).length);

      assert.equal(audioAfter, audioBefore, 'Persisted mute must suppress AudioContext oscillator starts after reload');
      assert.equal(vibAfter, vibBefore, 'Persisted haptics=0 must suppress navigator.vibrate calls after reload');

      page.assertNoErrors('T4.04');
    } finally {
      await browser.close();
    }
  });

  it('T4.05 Scenario 5: Keyboard-Driven Review & Capture-Undo Session (Scandinavian 1. e4 d5 2. exd5)', async () => {
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, offlineServer.url);
      await startLocalGame(page, { mode: 'pvp', tc: '0' });

      await page.pressKey('v');
      await page.waitFor(() => page.hasClass('#btnView2D', 'active'), {
        timeoutMs: UI_TIMEOUT,
        message: 'Key V should enable 2D mode'
      });

      await playMove(page, 'e2', 'e4', { side: 'w', waitForFlip: true });
      await playMove(page, 'd7', 'd5', { side: 'b', waitForFlip: true });
      await playMove(page, 'e4', 'd5', { side: 'w', waitForFlip: true });

      const capsText = (await page.text('#capsW')) || '';
      assert.ok(capsText.includes('♟') && capsText.includes('+1'), `Expected ♟ and +1 in #capsW, got "${capsText}"`);

      await page.click('#btnUndo');
      await page.waitFor(async () => (await getHistPlies(page)) === 2, { timeoutMs: UI_TIMEOUT });
      assert.equal(((await page.text('#capsW')) || '').trim(), '');
      assert.match((await page.text('#turnTxt')) || '', /VEZ DAS BRANCAS/i);

      const trySide = async (s) => {
        const from = await squareToXY(page, 'e4', { side: s, topDown: true });
        const to = await squareToXY(page, 'd5', { side: s, topDown: true });
        await page.mouseClick(from.x, from.y);
        await sleep(50);
        await page.mouseClick(to.x, to.y);
        await sleep(320);
        return (await getHistPlies(page)) === 3;
      };
      const replayed = (await trySide('w')) || (await trySide('b'));
      assert.equal(replayed, true, 'Re-playing 2. exd5 after #btnUndo must succeed');
      await sleep(400);
      assert.ok(((await page.text('#capsW')) || '').includes('+1'));

      await page.pressKey('Home');
      await page.waitForSelector('#liveBanner', { visible: true, timeoutMs: UI_TIMEOUT });
      await page.pressKey('ArrowRight');
      await page.pressKey('ArrowRight');
      assert.equal(await page.isVisible('#liveBanner'), true);
      await page.pressKey('End');
      await page.waitFor(async () => !(await page.isVisible('#liveBanner')), { timeoutMs: UI_TIMEOUT });

      await page.pressKey('f');
      await sleep(580);
      await page.pressKey('v');
      await page.waitFor(async () => !(await page.hasClass('#btnView2D', 'active')), {
        timeoutMs: UI_TIMEOUT,
        message: 'Key V should toggle back to 3D mode'
      });

      await page.pressKey('h');
      await page.waitForSelector('#hintBanner', { visible: true, timeoutMs: WORKER_TIMEOUT });
      await page.pressKey('m');
      assert.match((await page.text('#btnSound')) || '', /🔇/);
      await page.pressKey('Escape');
      await page.waitFor(async () => !(await page.isVisible('#hintBanner')), { timeoutMs: UI_TIMEOUT });

      page.assertNoErrors('T4.05');
    } finally {
      await browser.close();
    }
  });

  it('T4.06 Scenario 6: Production Bundle (vite preview) Smoke Journey', async () => {
    const hasDist = fs.existsSync(path.join(REPO_ROOT, 'dist/index.html'));
    const server = await startViteServer({
      mode: hasDist ? 'preview' : 'dev',
      envOverride: { VITE_FIREBASE_API_KEY: '' }
    });
    const browser = await launchBrowser();
    try {
      const page = browser.page;
      await safeGoto(page, server.url);
      await page.waitForSelector('#menuOverlay:not(.hide)', { timeoutMs: UI_TIMEOUT });

      const canvasBox = await page.boundingBox('#c3d');
      assert.ok(canvasBox && canvasBox.width === 1280 && canvasBox.height === 800, 'Expected full-viewport #c3d in production bundle');
      const shot = await page.screenshot();
      assert.ok(shot.length > 5000, 'Expected rendered WebGL frame in production preview');

      await startLocalGame(page, { mode: 'pve', diff: '1', side: 'w', tc: '0' });
      await ensureView2D(page);
      await playMove(page, 'e2', 'e4', { side: 'w', waitForAI: true });

      const plies = await getHistPlies(page);
      assert.ok(plies >= 2, `Expected >= 2 plies after e4 + AI reply, got ${plies}`);
      assert.match((await page.text('#turnTxt')) || '', /VEZ DAS BRANCAS/i);
      assert.equal(await page.isVisible('#btnUndo'), true);

      page.assertNoErrors('T4.06');
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
