export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = t => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function tween(ms, onStep) {
  return new Promise(resolve => {
    const t0 = performance.now();
    function frame(now) {
      const k = Math.min(1, (now - t0) / ms);
      onStep(k);
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

let hapticsEnabled = true;
export function setHaptics(on) { hapticsEnabled = !!on; }
export function vibrate(pattern) {
  if (!hapticsEnabled || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* noop */ }
}
