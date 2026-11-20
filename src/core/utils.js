export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = t => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function tween(ms, onStep) {
  if (!Number.isFinite(ms) || ms <= 0) {
    onStep(1);
    return Promise.resolve();
  }
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : cb => setTimeout(() => cb(performance.now()), 16);
  return new Promise(resolve => {
    const t0 = performance.now();
    function frame(now) {
      const k = Math.min(1, (now - t0) / ms);
      onStep(k);
      if (k < 1) raf(frame);
      else resolve();
    }
    raf(frame);
  });
}

let hapticsEnabled = true;
export function setHaptics(on) { hapticsEnabled = !!on; }
export function getHaptics() { return hapticsEnabled; }
export function vibrate(pattern) {
  if (!hapticsEnabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(pattern); } catch { /* noop */ }
}
