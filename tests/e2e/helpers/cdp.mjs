/* ============================================================
   Zero-Dependency Node 24 CDP & Vite Lifecycle Harness
   Uses only Node built-ins + /usr/bin/chromium + Vite
   ============================================================ */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONLINE_DOUBLE_SOURCE } from './online-double.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const VITE_BIN = path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js');
const CHROMIUM_BIN = '/usr/bin/chromium';

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  const exited = new Promise((resolve) => {
    proc.once('exit', resolve);
    proc.once('close', resolve);
  });
  try {
    proc.kill('SIGTERM');
  } catch { /* noop */ }
  await Promise.race([exited, sleep(2000)]);
  if (proc.exitCode === null) {
    try {
      proc.kill('SIGKILL');
    } catch { /* noop */ }
    await Promise.race([exited, sleep(1000)]);
  }
}

export async function startViteServer({ mode = 'dev', env = {}, envOverride = {} } = {}) {
  const args = mode === 'preview'
    ? [VITE_BIN, 'preview', '--port', '0', '--host', '127.0.0.1']
    : [VITE_BIN, '--port', '0', '--host', '127.0.0.1'];

  const mergedEnv = {
    ...process.env,
    ...env,
    ...envOverride
  };

  const proc = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: mergedEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdoutBuf = '';
  let stderrBuf = '';

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Vite (${mode}) did not emit URL within 15s.\nSTDOUT:\n${stdoutBuf}\nSTDERR:\n${stderrBuf}`));
    }, 15000);

    const onData = (chunk, isErr = false) => {
      const text = stripAnsi(chunk.toString('utf8'));
      if (isErr) stderrBuf += text;
      else stdoutBuf += text;

      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };

    proc.stdout.on('data', (c) => onData(c, false));
    proc.stderr.on('data', (c) => onData(c, true));
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite (${mode}) exited early with code ${code}.\nSTDOUT:\n${stdoutBuf}\nSTDERR:\n${stderrBuf}`));
    });
  });

  const parsed = new URL(url);
  return {
    url,
    port: Number(parsed.port),
    process: proc,
    async close() {
      await killProcessTree(proc);
    }
  };
}

function createCdpConnection(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    const onOpen = () => {
      cleanupInit();
      resolve(client);
    };
    const onErr = (err) => {
      cleanupInit();
      reject(new Error(`CDP WebSocket error connecting to ${wsUrl}: ${err?.message || err}`));
    };
    function cleanupInit() {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onErr);
    }
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onErr);

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(`CDP ${p.method} error (${msg.error.code}): ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        }
      } else if (msg.method) {
        const set = listeners.get(msg.method);
        if (set) {
          for (const fn of [...set]) {
            try { fn(msg.params || {}); } catch { /* noop */ }
          }
        }
      }
    });

    ws.addEventListener('close', () => {
      for (const [, p] of pending) {
        p.reject(new Error(`CDP WebSocket closed while waiting for ${p.method}`));
      }
      pending.clear();
    });

    const client = {
      send(method, params = {}) {
        if (ws.readyState !== WebSocket.OPEN) {
          return Promise.reject(new Error(`CDP WebSocket not open when calling ${method}`));
        }
        const id = nextId++;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej, method });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      on(method, fn) {
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(fn);
        return () => listeners.get(method)?.delete(fn);
      },
      once(method, predicate = null, timeoutMs = 15000) {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            off();
            rej(new Error(`Timed out waiting for CDP event ${method} (${timeoutMs}ms)`));
          }, timeoutMs);
          const off = client.on(method, (params) => {
            if (!predicate || predicate(params)) {
              clearTimeout(timer);
              off();
              res(params);
            }
          });
        });
      },
      close() {
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch { /* noop */ }
      }
    };
  });
}

function buildModifiers(opts = {}) {
  if (typeof opts.modifiers === 'number') return opts.modifiers;
  let mod = 0;
  const src = (opts.modifiers && typeof opts.modifiers === 'object' && !Array.isArray(opts.modifiers))
    ? opts.modifiers
    : opts;
  if (src.alt || opts.alt) mod |= 1;
  if (src.ctrl || src.control || opts.ctrl || opts.control) mod |= 2;
  if (src.meta || opts.meta) mod |= 4;
  if (src.shift || opts.shift) mod |= 8;
  if (Array.isArray(opts.modifiers)) {
    for (const m of opts.modifiers) {
      const k = String(m).toLowerCase();
      if (k === 'alt') mod |= 1;
      if (k === 'ctrl' || k === 'control') mod |= 2;
      if (k === 'meta') mod |= 4;
      if (k === 'shift') mod |= 8;
    }
  }
  return mod;
}

const KEY_DEFS = {
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 }
};

function resolveKeyDef(key) {
  if (KEY_DEFS[key]) return KEY_DEFS[key];
  if (typeof key === 'string' && key.length === 1) {
    const ch = key;
    const upper = ch.toUpperCase();
    const codePoint = ch.charCodeAt(0);
    if (upper >= 'A' && upper <= 'Z') {
      return {
        key: ch,
        code: `Key${upper}`,
        keyCode: upper.charCodeAt(0),
        text: ch
      };
    }
    if (ch >= '0' && ch <= '9') {
      return {
        key: ch,
        code: `Digit${ch}`,
        keyCode: codePoint,
        text: ch
      };
    }
    return {
      key: ch,
      code: '',
      keyCode: codePoint,
      text: ch
    };
  }
  return { key: String(key), code: String(key), keyCode: 0 };
}

function buildSpyInitScript({ onlineEmail = '', onlineNick = 'JogadorE2E' }) {
  return `(() => {
    window.__E2E_AUTH_EMAIL__ = ${JSON.stringify(onlineEmail || '')};
    window.__E2E_TEST_EMAIL__ = ${JSON.stringify(onlineEmail || '')};
    window.__E2E_AUTH_NICK__ = ${JSON.stringify(onlineNick || 'JogadorE2E')};

    window.__e2eAudioSpy = { starts: 0, creates: 0 };
    const patchAudioProto = (Ctor) => {
      if (!Ctor || !Ctor.prototype || Ctor.prototype.__e2ePatched) return;
      Ctor.prototype.__e2ePatched = true;
      const origCreateOsc = Ctor.prototype.createOscillator;
      if (typeof origCreateOsc === 'function') {
        Ctor.prototype.createOscillator = function (...args) {
          const osc = origCreateOsc.apply(this, args);
          if (osc && typeof osc.start === 'function' && !osc.__e2eStartPatched) {
            osc.__e2eStartPatched = true;
            const origStart = osc.start.bind(osc);
            osc.start = function (...sArgs) {
              window.__e2eAudioSpy.starts += 1;
              return origStart(...sArgs);
            };
          }
          return osc;
        };
      }
    };
    const wrapAudioCtor = (name) => {
      const Orig = window[name];
      if (!Orig || Orig.__e2eWrapped) return;
      patchAudioProto(Orig);
      try {
        const Wrapped = new Proxy(Orig, {
          construct(target, args, newTarget) {
            window.__e2eAudioSpy.creates += 1;
            return Reflect.construct(target, args, newTarget);
          }
        });
        Wrapped.__e2eWrapped = true;
        window[name] = Wrapped;
      } catch { /* fallback: prototype patched */ }
    };
    wrapAudioCtor('AudioContext');
    wrapAudioCtor('webkitAudioContext');

    window.__e2eVibrateCalls = [];
    const spyVibrate = function (pattern) {
      window.__e2eVibrateCalls.push(Array.isArray(pattern) ? [...pattern] : pattern);
      return true;
    };
    try {
      Object.defineProperty(Navigator.prototype, 'vibrate', {
        configurable: true,
        writable: true,
        value: spyVibrate
      });
    } catch {
      try { navigator.vibrate = spyVibrate; } catch { /* noop */ }
    }

    window.__e2eContextMenuEvents = [];
    window.addEventListener('contextmenu', (e) => {
      if (e.target && e.target.id === 'c3d') {
        window.__e2eContextMenuEvents.push({
          targetId: e.target.id,
          defaultPrevented: e.defaultPrevented,
          clientX: e.clientX,
          clientY: e.clientY,
          timeStamp: e.timeStamp
        });
      }
    }, false);
  })();`;
}

function formatRemoteObject(arg) {
  if (!arg) return '';
  if (arg.value !== undefined) return String(arg.value);
  if (arg.description) return arg.description;
  return arg.type || '';
}

async function createPageSession({
  targetId,
  wsUrl,
  browserClient,
  isMultiTab = () => false,
  viewport = { width: 1280, height: 800 },
  mobile = false,
  hasTouch = false,
  interceptOnline = false,
  onlineEmail = '',
  onlineNick = 'JogadorE2E'
}) {
  const cdp = await createCdpConnection(wsUrl);
  const errors = [];
  let closed = false;

  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const desc = exceptionDetails?.exception?.description || exceptionDetails?.text || 'Uncaught exception';
    errors.push(`Runtime.exceptionThrown: ${desc}`);
  });

  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') {
      const msg = (args || []).map(formatRemoteObject).join(' ');
      errors.push(`console.error: ${msg}`);
    }
  });

  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = request?.url || '';
    try {
      if (url.includes('fonts.googleapis.com')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/css; charset=utf-8' }],
          body: ''
        });
        return;
      }
      if (url.includes('fonts.gstatic.com')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'font/woff2' }],
          body: ''
        });
        return;
      }
      if (interceptOnline && url.includes('/src/online/firebase.js')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }],
          body: Buffer.from(ONLINE_DOUBLE_SOURCE, 'utf8').toString('base64')
        });
        return;
      }
      if (!interceptOnline && (
        url.includes('googleapis.com') ||
        url.includes('firebaseio.com') ||
        url.includes('firebaseapp.com')
      )) {
        await cdp.send('Fetch.failRequest', {
          requestId,
          errorReason: 'BlockedByClient'
        });
        return;
      }
      await cdp.send('Fetch.continueRequest', { requestId });
    } catch { /* page/request may have closed */ }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  const patterns = [
    { urlPattern: '*fonts.googleapis.com*', requestStage: 'Request' },
    { urlPattern: '*fonts.gstatic.com*', requestStage: 'Request' }
  ];
  if (interceptOnline) {
    patterns.push({ urlPattern: '*/src/online/firebase.js*', requestStage: 'Request' });
  } else {
    patterns.push({ urlPattern: '*googleapis.com*', requestStage: 'Request' });
    patterns.push({ urlPattern: '*firebaseio.com*', requestStage: 'Request' });
  }
  await cdp.send('Fetch.enable', { patterns });

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: buildSpyInitScript({ onlineEmail, onlineNick })
  });

  async function setViewport({ width, height, mobile: mob = false, hasTouch: touch = false }) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mob ? 2 : 1,
      mobile: Boolean(mob),
      screenWidth: width,
      screenHeight: height
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: Boolean(touch || mob),
      maxTouchPoints: 5
    });
    await evalJs(() => new Promise((r) => {
      const done = () => r();
      setTimeout(done, 80);
      if (!document.hidden) requestAnimationFrame(() => requestAnimationFrame(done));
    })).catch(() => {});
  }

  await setViewport({
    width: viewport.width,
    height: viewport.height,
    mobile,
    hasTouch
  });

  async function evalJs(fnOrStr, arg) {
    const expression = typeof fnOrStr === 'function'
      ? `(${fnOrStr.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
      : String(fnOrStr);

    const res = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });

    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed';
      throw new Error(`evalJs error: ${msg}`);
    }
    return res.result?.value;
  }

  async function bringToFront() {
    await cdp.send('Page.bringToFront').catch(() => {});
  }

  async function ensureActiveTab() {
    if (isMultiTab()) await bringToFront();
  }

  async function goto(url) {
    await ensureActiveTab();
    const loadPromise = cdp.once('Page.loadEventFired', null, 15000);
    await cdp.send('Page.navigate', { url });
    await loadPromise;
    await waitFor(() => document.readyState === 'complete', { timeoutMs: 10000, message: 'document.readyState complete' });
    await evalJs(() => new Promise((r) => {
      const done = () => r();
      setTimeout(done, 80);
      if (!document.hidden) requestAnimationFrame(() => requestAnimationFrame(done));
    }));
  }

  async function reload() {
    await ensureActiveTab();
    const loadPromise = cdp.once('Page.loadEventFired', null, 15000);
    await cdp.send('Page.reload', { ignoreCache: false });
    await loadPromise;
    await waitFor(() => document.readyState === 'complete', { timeoutMs: 10000, message: 'reload complete' });
    await evalJs(() => new Promise((r) => {
      const done = () => r();
      setTimeout(done, 80);
      if (!document.hidden) requestAnimationFrame(() => requestAnimationFrame(done));
    }));
  }

  async function waitFor(fn, { timeoutMs = 10000, intervalMs = 50, message = 'waitFor timeout' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    let useBrowser = typeof fn === 'string';

    while (Date.now() < deadline) {
      try {
        let val;
        if (useBrowser) {
          val = await evalJs(fn);
        } else {
          try {
            val = await fn();
          } catch (err) {
            if (err instanceof ReferenceError && /\b(document|window|localStorage|sessionStorage|navigator|location)\b/.test(err.message)) {
              useBrowser = true;
              val = await evalJs(fn);
            } else {
              throw err;
            }
          }
        }
        if (val) return val;
      } catch (err) {
        lastErr = err;
      }
      await sleep(intervalMs);
    }
    throw new Error(`${message} (after ${timeoutMs}ms)${lastErr ? `: ${lastErr.message}` : ''}`);
  }

  async function exists(sel) {
    return Boolean(await evalJs((s) => Boolean(document.querySelector(s)), sel));
  }

  async function isVisible(sel) {
    return Boolean(await evalJs((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, sel));
  }

  async function hasClass(sel, cls) {
    return Boolean(await evalJs(([s, c]) => {
      const el = document.querySelector(s);
      return Boolean(el && el.classList.contains(c));
    }, [sel, cls]));
  }

  async function text(sel) {
    return await evalJs((s) => {
      const el = document.querySelector(s);
      return el ? el.textContent : null;
    }, sel);
  }

  async function boundingBox(sel) {
    return await evalJs((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2
      };
    }, sel);
  }

  async function waitForSelector(sel, { visible = true, timeoutMs = 10000 } = {}) {
    await waitFor(
      async () => (visible ? await isVisible(sel) : await exists(sel)),
      { timeoutMs, intervalMs: 40, message: `waitForSelector("${sel}", visible=${visible})` }
    );
  }

  async function mouseMove(x, y, opts = {}) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: opts.button || 'none',
      buttons: opts.buttons ?? 0,
      modifiers: buildModifiers(opts)
    });
  }

  async function mouseDown(x, y, opts = {}) {
    const button = opts.button || 'left';
    const buttons = opts.buttons ?? (button === 'right' ? 2 : button === 'middle' ? 4 : 1);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons,
      clickCount: opts.clickCount ?? 1,
      modifiers: buildModifiers(opts)
    });
  }

  async function mouseUp(x, y, opts = {}) {
    const button = opts.button || 'left';
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: opts.buttons ?? 0,
      clickCount: opts.clickCount ?? 1,
      modifiers: buildModifiers(opts)
    });
  }

  async function mouseClick(x, y, opts = {}) {
    await ensureActiveTab();
    const button = opts.button || 'left';
    await mouseMove(x, y, { ...opts, button: 'none', buttons: 0 });
    await mouseDown(x, y, { ...opts, button });
    await sleep(opts.delayMs ?? 20);
    await mouseUp(x, y, { ...opts, button, buttons: 0 });
  }

  async function mouseDrag(x1, y1, x2, y2, opts = {}) {
    await ensureActiveTab();
    const button = opts.button || 'left';
    const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
    const steps = Math.max(2, opts.steps ?? 10);
    await mouseMove(x1, y1, { ...opts, button: 'none', buttons: 0 });
    await mouseDown(x1, y1, { ...opts, button, buttons });
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = x1 + (x2 - x1) * k;
      const y = y1 + (y2 - y1) * k;
      await mouseMove(x, y, { ...opts, button, buttons });
      await sleep(opts.stepDelayMs ?? 12);
    }
    await mouseUp(x2, y2, { ...opts, button, buttons: 0 });
  }

  async function touchTap(x, y) {
    await ensureActiveTab();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    });
    await sleep(30);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
  }

  async function touchDrag(x1, y1, x2, y2, opts = {}) {
    await ensureActiveTab();
    const steps = Math.max(2, opts.steps ?? 10);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x1, y: y1, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    });
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = x1 + (x2 - x1) * k;
      const y = y1 + (y2 - y1) * k;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
      });
      await sleep(opts.stepDelayMs ?? 14);
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
  }

  async function pinchZoom(cx, cy, startDist = 100, endDist = 220, opts = {}) {
    await ensureActiveTab();
    const steps = Math.max(2, opts.steps ?? 10);
    const half0 = startDist / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - half0, y: cy, id: 1, radiusX: 4, radiusY: 4, force: 1 },
        { x: cx + half0, y: cy, id: 2, radiusX: 4, radiusY: 4, force: 1 }
      ]
    });
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const half = (startDist + (endDist - startDist) * k) / 2;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - half, y: cy, id: 1, radiusX: 4, radiusY: 4, force: 1 },
          { x: cx + half, y: cy, id: 2, radiusX: 4, radiusY: 4, force: 1 }
        ]
      });
      await sleep(opts.stepDelayMs ?? 16);
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
  }

  async function pressKey(key, opts = {}) {
    await ensureActiveTab();
    const def = resolveKeyDef(key);
    const modifiers = buildModifiers(opts);
    const isChar = Boolean(def.text);
    const downParams = {
      type: isChar ? 'keyDown' : 'rawKeyDown',
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
      modifiers
    };
    if (isChar) {
      downParams.text = def.text;
      downParams.unmodifiedText = def.text;
    }
    await cdp.send('Input.dispatchKeyEvent', downParams);
    await sleep(opts.delayMs ?? 15);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
      modifiers
    });
  }

  async function click(sel) {
    await ensureActiveTab();
    await waitForSelector(sel, { visible: true, timeoutMs: 10000 });
    await evalJs((s) => {
      const el = document.querySelector(s);
      if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, sel);
    const box = await boundingBox(sel);
    if (!box) throw new Error(`click("${sel}"): element has no boundingBox`);
    await mouseClick(box.cx, box.cy);
  }

  async function type(sel, value, opts = {}) {
    await click(sel);
    if (opts.clear !== false) {
      await evalJs((s) => {
        const el = document.querySelector(s);
        if (el && 'value' in el) {
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, sel);
    }
    for (const ch of String(value)) {
      await pressKey(ch);
    }
  }

  async function screenshot(filePath) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(data, 'base64');
    if (filePath) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buf);
    }
    return buf;
  }

  function getErrors() {
    return [...errors];
  }

  function clearErrors() {
    errors.length = 0;
  }

  function assertNoErrors(label = '') {
    assert.equal(
      errors.length,
      0,
      `Expected 0 browser/console errors${label ? ` (${label})` : ''}, got:\n${errors.join('\n')}`
    );
  }

  async function close() {
    if (closed) return;
    closed = true;
    cdp.close();
    if (browserClient && targetId) {
      await browserClient.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  return {
    targetId,
    cdp,
    goto,
    reload,
    evalJs,
    waitFor,
    waitForSelector,
    text,
    exists,
    isVisible,
    hasClass,
    boundingBox,
    click,
    type,
    pressKey,
    mouseMove,
    mouseDown,
    mouseUp,
    mouseClick,
    mouseDrag,
    touchTap,
    touchDrag,
    pinchZoom,
    setViewport,
    bringToFront,
    screenshot,
    getErrors,
    clearErrors,
    assertNoErrors,
    close
  };
}

export async function launchBrowser(options = {}) {
  const {
    viewport = { width: 1280, height: 800 },
    mobile = false,
    hasTouch = false,
    interceptOnline = false,
    onlineEmail = options.authEmail || '',
    onlineNick = 'JogadorE2E'
  } = options;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xadrez-e2e-'));
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];

  const proc = spawn(CHROMIUM_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrBuf = '';
  const browserWsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Chromium did not emit DevTools WS URL within 15s.\nSTDERR:\n${stderrBuf}`));
    }, 15000);

    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      stderrBuf += s;
      const m = s.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });

    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited early with code ${code}.\nSTDERR:\n${stderrBuf}`));
    });
  });

  const parsedWs = new URL(browserWsUrl);
  const httpBase = `http://127.0.0.1:${parsedWs.port}`;
  const browserClient = await createCdpConnection(browserWsUrl);
  const pages = [];

  let initialTarget = null;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${httpBase}/json/list`);
    const list = await res.json();
    initialTarget = list.find((t) => t.type === 'page');
    if (initialTarget) break;
    await sleep(50);
  }
  if (!initialTarget) {
    const created = await browserClient.send('Target.createTarget', { url: 'about:blank' });
    initialTarget = {
      id: created.targetId,
      webSocketDebuggerUrl: `ws://127.0.0.1:${parsedWs.port}/devtools/page/${created.targetId}`
    };
  }

  const initialPage = await createPageSession({
    targetId: initialTarget.id,
    wsUrl: initialTarget.webSocketDebuggerUrl,
    browserClient,
    isMultiTab: () => pages.length > 1,
    viewport,
    mobile,
    hasTouch,
    interceptOnline,
    onlineEmail,
    onlineNick
  });
  pages.push(initialPage);

  async function newPage(pageOpts = {}) {
    const { targetId } = await browserClient.send('Target.createTarget', {
      url: 'about:blank',
      newWindow: pageOpts.newWindow ?? false
    });
    const wsUrl = `ws://127.0.0.1:${parsedWs.port}/devtools/page/${targetId}`;
    const page = await createPageSession({
      targetId,
      wsUrl,
      browserClient,
      isMultiTab: () => pages.length > 1,
      viewport: pageOpts.viewport || viewport,
      mobile: pageOpts.mobile ?? mobile,
      hasTouch: pageOpts.hasTouch ?? hasTouch,
      interceptOnline: pageOpts.interceptOnline ?? interceptOnline,
      onlineEmail: pageOpts.onlineEmail ?? pageOpts.authEmail ?? onlineEmail,
      onlineNick: pageOpts.onlineNick ?? onlineNick
    });
    pages.push(page);
    return page;
  }

  let browserClosed = false;
  async function close() {
    if (browserClosed) return;
    browserClosed = true;
    for (const p of pages) {
      try { p.cdp.close(); } catch { /* noop */ }
    }
    browserClient.close();
    await killProcessTree(proc);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return {
    page: initialPage,
    pages,
    newPage,
    close,
    goto: (...a) => initialPage.goto(...a),
    reload: (...a) => initialPage.reload(...a),
    evalJs: (...a) => initialPage.evalJs(...a),
    waitFor: (...a) => initialPage.waitFor(...a),
    waitForSelector: (...a) => initialPage.waitForSelector(...a),
    text: (...a) => initialPage.text(...a),
    exists: (...a) => initialPage.exists(...a),
    isVisible: (...a) => initialPage.isVisible(...a),
    hasClass: (...a) => initialPage.hasClass(...a),
    boundingBox: (...a) => initialPage.boundingBox(...a),
    click: (...a) => initialPage.click(...a),
    type: (...a) => initialPage.type(...a),
    pressKey: (...a) => initialPage.pressKey(...a),
    mouseMove: (...a) => initialPage.mouseMove(...a),
    mouseDown: (...a) => initialPage.mouseDown(...a),
    mouseUp: (...a) => initialPage.mouseUp(...a),
    mouseClick: (...a) => initialPage.mouseClick(...a),
    mouseDrag: (...a) => initialPage.mouseDrag(...a),
    touchTap: (...a) => initialPage.touchTap(...a),
    touchDrag: (...a) => initialPage.touchDrag(...a),
    pinchZoom: (...a) => initialPage.pinchZoom(...a),
    setViewport: (...a) => initialPage.setViewport(...a),
    screenshot: (...a) => initialPage.screenshot(...a),
    getErrors: () => pages.flatMap((p) => p.getErrors()),
    clearErrors: () => pages.forEach((p) => p.clearErrors()),
    assertNoErrors: (label = '') => {
      for (const p of pages) p.assertNoErrors(label);
    }
  };
}
