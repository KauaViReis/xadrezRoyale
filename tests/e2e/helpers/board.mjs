/* ============================================================
   Deterministic #c3d Square Projection & Board/HUD Helpers
   Matches src/engine/camera.js, board3d.js, scene.js geometry
   ============================================================ */

import assert from 'node:assert/strict';
import { sleep } from './cdp.mjs';

const FOV_DEG = 42;
const TARGET = [0, -0.05, 0];
const HALF = 4.65;
const MARGIN = 1.08;
const MIN_RADIUS = 6.2;
const MAX_RADIUS = 32;

export function squareToRC(sq) {
  const c = sq.charCodeAt(0) - 97;
  const r = 8 - parseInt(sq[1], 10);
  return { r, c };
}

export function rcToSquare(r, c) {
  return String.fromCharCode(97 + c) + String(8 - r);
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function computeCameraPos(radius, phi, theta) {
  return [
    TARGET[0] + radius * Math.sin(phi) * Math.sin(theta),
    TARGET[1] + radius * Math.cos(phi),
    TARGET[2] + radius * Math.sin(phi) * Math.cos(theta)
  ];
}

function projectPoint(point, camPos, target, fovDeg, aspect) {
  const zAxis = normalize(sub(camPos, target));
  const up = [0, 1, 0];
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);

  const d = sub(point, camPos);
  const vx = dot(d, xAxis);
  const vy = dot(d, yAxis);
  const vz = dot(d, zAxis);

  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const ndcX = (vx * (f / aspect)) / (-vz);
  const ndcY = (vy * f) / (-vz);
  return [ndcX, ndcY];
}

export function fitRadius(aspect, margin = MARGIN, phi = 0.08, theta = 0) {
  const corners = [
    [-HALF, 0, -HALF],
    [HALF, 0, -HALF],
    [-HALF, 0, HALF],
    [HALF, 0, HALF]
  ];
  const lim = 1 / margin;
  const fits = (rad) => {
    const camPos = computeCameraPos(rad, phi, theta);
    for (const corner of corners) {
      const [nx, ny] = projectPoint(corner, camPos, TARGET, FOV_DEG, aspect);
      if (Math.abs(nx) > lim || Math.abs(ny) > lim) return false;
    }
    return true;
  };

  let lo = MIN_RADIUS;
  let hi = MAX_RADIUS;
  let found = MAX_RADIUS;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) {
      found = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return clamp(found, MIN_RADIUS, MAX_RADIUS);
}

export function projectSquareToRect(sq, rect, opts = {}) {
  const side = opts.side || 'w';
  const topDown = opts.topDown ?? true;
  const phi = opts.phi ?? (topDown ? 0.08 : 0.92);
  const theta = opts.theta ?? (side === 'b' ? Math.PI : 0);
  const aspect = rect.width / rect.height;
  const radius = opts.radius ?? fitRadius(aspect, MARGIN, phi, theta);
  const camPos = computeCameraPos(radius, phi, theta);

  const { r, c } = squareToRC(sq);
  const world = [c - 3.5, 0, r - 3.5];
  const [ndcX, ndcY] = projectPoint(world, camPos, TARGET, FOV_DEG, aspect);

  return {
    x: rect.left + (ndcX + 1) * 0.5 * rect.width,
    y: rect.top + (1 - ndcY) * 0.5 * rect.height,
    ndcX,
    ndcY,
    radius
  };
}

export async function ensureView2D(page) {
  const active = await page.hasClass('#btnView2D', 'active');
  if (!active) {
    await page.click('#btnView2D');
    await sleep(430);
    await page.waitFor(() => page.hasClass('#btnView2D', 'active'), {
      timeoutMs: 3000,
      message: '#btnView2D did not become active'
    });
  }
}

export async function squareToXY(page, sq, opts = {}) {
  const rect = await page.boundingBox('#c3d');
  if (!rect) throw new Error('#c3d boundingBox is null');
  return projectSquareToRect(sq, rect, opts);
}

export const squareToClientXY = squareToXY;

export async function clickSquare(page, sq, opts = {}) {
  const { x, y } = await squareToXY(page, sq, opts);
  await page.mouseClick(x, y, {
    button: opts.button || 'left',
    shift: opts.shift,
    alt: opts.alt,
    ctrl: opts.ctrl
  });
}

export async function getHistPlies(page) {
  return await page.evalJs(() => {
    const list = document.querySelector('#histList');
    if (!list) return 0;
    const plyEls = list.querySelectorAll('[data-ply]');
    if (plyEls.length > 0) return plyEls.length;
    let count = 0;
    const rows = list.querySelectorAll('.hist-row');
    for (const row of rows) {
      const cells = row.querySelectorAll('span:not(.hist-num), button:not(.hist-num)');
      for (const cell of cells) {
        if (cell.textContent && cell.textContent.trim().length > 0) count++;
      }
    }
    return count;
  });
}

export async function getHistMoves(page) {
  return await page.evalJs(() => {
    const list = document.querySelector('#histList');
    if (!list) return [];
    const plyEls = list.querySelectorAll('[data-ply]');
    if (plyEls.length > 0) {
      return [...plyEls].map((el) => el.textContent.trim()).filter(Boolean);
    }
    const moves = [];
    const rows = list.querySelectorAll('.hist-row');
    for (const row of rows) {
      const cells = row.querySelectorAll('span:not(.hist-num), button:not(.hist-num)');
      for (const cell of cells) {
        const txt = cell.textContent?.trim();
        if (txt) moves.push(txt);
      }
    }
    return moves;
  });
}

export async function playMove(page, fromSq, toSq, opts = {}) {
  const {
    side = 'w',
    topDown = true,
    promotion = null,
    waitForFlip = false,
    waitForAI = false,
    timeoutMs = 10000
  } = opts;

  if (topDown && opts.ensure2D !== false) {
    await ensureView2D(page);
  }

  const beforePlies = await getHistPlies(page);
  await clickSquare(page, fromSq, { side, topDown });
  await sleep(50);
  await clickSquare(page, toSq, { side, topDown });

  if (promotion) {
    await page.waitForSelector('#promoModal:not(.hide)', { visible: true, timeoutMs: 5000 });
    await page.click(`.promo-btn[data-piece="${promotion}"]`);
  }

  await page.waitFor(
    async () => {
      const plies = await getHistPlies(page);
      const gameOver = !(await page.hasClass('#overOverlay', 'hide'));
      return plies > beforePlies || gameOver;
    },
    { timeoutMs, intervalMs: 40, message: `Move ${fromSq}->${toSq} did not advance history` }
  );

  if (waitForAI) {
    await page.waitFor(
      async () => {
        const gameOver = !(await page.hasClass('#overOverlay', 'hide'));
        if (gameOver) return true;
        const plies = await getHistPlies(page);
        const turnTxt = await page.text('#turnTxt');
        return plies >= beforePlies + 2 && Boolean(turnTxt) && !turnTxt.includes('PENSANDO');
      },
      { timeoutMs, intervalMs: 50, message: `AI move after ${fromSq}->${toSq} did not complete` }
    );
  }

  if (waitForFlip) {
    const isOver = !(await page.hasClass('#overOverlay', 'hide'));
    if (!isOver) await sleep(620);
  } else {
    await sleep(60);
  }
}

export async function rightClickSquare(page, sq, opts = {}) {
  const { x, y } = await squareToXY(page, sq, opts);
  await page.mouseClick(x, y, {
    button: 'right',
    shift: opts.shift,
    alt: opts.alt,
    ctrl: opts.ctrl
  });
}

export async function rightDragArrow(page, fromSq, toSq, opts = {}) {
  const from = await squareToXY(page, fromSq, opts);
  const to = await squareToXY(page, toSq, opts);
  await page.mouseDrag(from.x, from.y, to.x, to.y, {
    button: 'right',
    steps: opts.steps ?? 10,
    shift: opts.shift,
    alt: opts.alt,
    ctrl: opts.ctrl
  });
}

export async function touchTapSquare(page, sq, opts = {}) {
  const { x, y } = await squareToXY(page, sq, opts);
  await page.touchTap(x, y);
}

export async function touchDragArrow(page, fromSq, toSq, opts = {}) {
  const from = await squareToXY(page, fromSq, opts);
  const to = await squareToXY(page, toSq, opts);
  await page.touchDrag(from.x, from.y, to.x, to.y, {
    steps: opts.steps ?? 10
  });
}

export async function assertHudNoOverlap(page, opts = {}) {
  const report = await page.evalJs((checkMinSize) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overflowX = document.documentElement.scrollWidth > vw;
    const overflowY = document.documentElement.scrollHeight > vh;

    const selectors = [
      '#btnHome',
      '#turnPill',
      '#btnArrows',
      '#btnView2D',
      '#btnFlip',
      '#btnSound',
      '#btnSettings',
      '#cardW',
      '#cardB',
      '#evalWrap',
      '#historyBox',
      '#btnHint',
      '#btnUndo',
      '#btnDraw',
      '#btnResign',
      '#btnNewMenu',
      '#arrowChip',
      '#liveBanner',
      '#hintBanner',
      '#drawBar'
    ];

    const buttonSelectors = new Set([
      '#btnHome',
      '#btnArrows',
      '#btnView2D',
      '#btnFlip',
      '#btnSound',
      '#btnSettings',
      '#btnHint',
      '#btnUndo',
      '#btnDraw',
      '#btnResign',
      '#btnNewMenu'
    ]);

    const visibleItems = [];
    const outOfBounds = [];
    const undersized = [];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const item = {
        sel,
        el,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      };
      visibleItems.push(item);

      if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) {
        outOfBounds.push({ sel, rect: item.rect, vw, vh });
      }
      if (checkMinSize && buttonSelectors.has(sel) && (r.width < 31.5 || r.height < 31.5)) {
        undersized.push({ sel, width: r.width, height: r.height });
      }
    }

    const overlaps = [];
    for (let i = 0; i < visibleItems.length; i++) {
      for (let j = i + 1; j < visibleItems.length; j++) {
        const A = visibleItems[i];
        const B = visibleItems[j];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        const a = A.rect;
        const b = B.rect;
        const intersects = !(
          a.right <= b.left + 0.5 ||
          a.left >= b.right - 0.5 ||
          a.bottom <= b.top + 0.5 ||
          a.top >= b.bottom - 0.5
        );
        if (intersects) {
          overlaps.push({ a: A.sel, b: B.sel, rectA: a, rectB: b });
        }
      }
    }

    return {
      vw,
      vh,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      overflowX,
      overflowY,
      outOfBounds,
      undersized,
      overlaps
    };
  }, opts.checkMinSize !== false);

  assert.equal(
    report.overflowX,
    false,
    `Horizontal overflow detected: scrollWidth=${report.scrollWidth} > innerWidth=${report.vw}`
  );
  assert.equal(
    report.outOfBounds.length,
    0,
    `HUD elements outside viewport (${report.vw}x${report.vh}): ${JSON.stringify(report.outOfBounds)}`
  );
  assert.equal(
    report.undersized.length,
    0,
    `HUD touch targets smaller than 32px: ${JSON.stringify(report.undersized)}`
  );
  assert.equal(
    report.overlaps.length,
    0,
    `HUD element overlaps detected: ${JSON.stringify(report.overlaps)}`
  );
}
