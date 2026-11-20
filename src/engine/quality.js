import * as THREE from 'three';
import { applyBoardMaterialTextures } from './board3d.js';
import { setPieceQuality } from './pieces3d.js';

export function detectHardwareTier(renderer) {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'medium';
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

export function applyQualityTier(tier, context = {}) {
  const {
    renderer,
    lights,
    fx,
    board,
    pieces,
    materials,
    boardTheme,
    pieceTheme,
    onTierApplied
  } = context;

  const hasWin = typeof window !== 'undefined';
  const dpr = hasWin ? (window.devicePixelRatio || 1) : 1;
  const sun = lights?.sun;
  const fill = lights?.fill;
  const rim = lights?.rim;

  if (tier === 'high') {
    if (renderer) {
      renderer.setPixelRatio(Math.min(dpr, 2));
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.shadowMap.needsUpdate = true;
      }
    }
    if (sun) {
      sun.castShadow = true;
      sun.shadow.radius = 3.5;
      if (sun.shadow.mapSize.x !== 2048 || sun.shadow.mapSize.y !== 2048) {
        sun.shadow.mapSize.set(2048, 2048);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    if (fill) fill.intensity = 0.45;
    if (rim) rim.intensity = 0.25;
  } else if (tier === 'medium') {
    if (renderer) {
      renderer.setPixelRatio(Math.min(dpr, 1.5));
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.shadowMap.needsUpdate = true;
      }
    }
    if (sun) {
      sun.castShadow = true;
      sun.shadow.radius = 2;
      if (sun.shadow.mapSize.x !== 1024 || sun.shadow.mapSize.y !== 1024) {
        sun.shadow.mapSize.set(1024, 1024);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    if (fill) fill.intensity = 0.35;
    if (rim) rim.intensity = 0;
  } else {
    if (renderer) {
      renderer.setPixelRatio(1);
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = false;
      }
    }
    if (sun) {
      sun.castShadow = false;
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (fill) fill.intensity = 0;
    if (rim) rim.intensity = 0;
  }

  if (renderer && hasWin) {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  if (fx && typeof fx.setQuality === 'function') {
    fx.setQuality(tier);
  }

  if (typeof board === 'function') {
    board(tier, boardTheme);
  } else if (board && typeof board.setQuality === 'function') {
    board.setQuality(tier, boardTheme);
  } else if (materials && boardTheme) {
    applyBoardMaterialTextures(materials, boardTheme, tier);
  }

  if (typeof pieces === 'function') {
    pieces(tier, pieceTheme);
  } else if (pieces && typeof pieces.setQuality === 'function') {
    pieces.setQuality(tier, pieceTheme);
  } else if (pieces && typeof pieces === 'object') {
    setPieceQuality(tier, { ...pieces, theme: pieces.theme || pieceTheme });
  }

  if (typeof onTierApplied === 'function') {
    onTierApplied(tier);
  }
}
