export function detectHardwareTier(renderer) {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'low';
    }
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const isMobile = (navigator.maxTouchPoints || 0) > 0 && window.innerWidth <= 900;

    let gpu = '';
    if (renderer) {
      const gl = renderer.getContext();
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) gpu = (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    }
    if (/swiftshader|llvmpipe|software|mali-4|adreno \(tm\) [234]/.test(gpu)) return 'low';
    if (mem <= 2 || cores <= 2) return 'low';
    if (isMobile || mem <= 4 || cores <= 4 || /intel\(r\) (hd|uhd) graphics/.test(gpu)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export function applyQualityTier(tier, { renderer, lights, fx }) {
  const dpr = window.devicePixelRatio || 1;
  const sun = lights?.sun;
  const fill = lights?.fill;
  const rim = lights?.rim;

  if (tier === 'high') {
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.shadowMap.enabled = true;
    if (sun) {
      sun.castShadow = true;
      if (sun.shadow.mapSize.x !== 2048) {
        sun.shadow.mapSize.set(2048, 2048);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    if (fill) fill.intensity = 0.45;
    if (rim) rim.intensity = 0.25;
  } else if (tier === 'medium') {
    renderer.setPixelRatio(Math.min(dpr, 1.5));
    renderer.shadowMap.enabled = true;
    if (sun) {
      sun.castShadow = true;
      if (sun.shadow.mapSize.x !== 1024) {
        sun.shadow.mapSize.set(1024, 1024);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    if (fill) fill.intensity = 0.35;
    if (rim) rim.intensity = 0;
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
    if (sun) sun.castShadow = false;
    if (fill) fill.intensity = 0;
    if (rim) rim.intensity = 0;
  }

  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (fx && typeof fx.setQuality === 'function') fx.setQuality(tier);
}
