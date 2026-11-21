import * as THREE from 'three';
import { BOARD_THEMES } from './themes.js';

export function worldPos(r, c) {
  return new THREE.Vector3(c - 3.5, 0, r - 3.5);
}

const _pbrCache = new Map();
const _coordTexCache = new Map();

function normalizeTier(tier) {
  return tier === 'low' || tier === 'medium' ? tier : 'high';
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v) {
  return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
}

function makeCanvas(size) {
  const cvs = document.createElement('canvas');
  cvs.width = size;
  cvs.height = size;
  return cvs;
}

function fillGrayData(ctx, size, fn) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const val = clampByte(fn(x, y, size));
      const idx = (y * size + x) * 4;
      d[idx] = val;
      d[idx + 1] = val;
      d[idx + 2] = val;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function toCanvasTexture(cvs, colorSpace, anisotropy) {
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

function buildBoardTextureSet(kind, tier) {
  const size = tier === 'high' ? 512 : (tier === 'medium' ? 256 : 128);
  const needPBR = tier !== 'low';
  const anisotropy = tier === 'high' ? 4 : (tier === 'medium' ? 2 : 1);
  const seedMap = { wood: 101, marble: 202, slate: 303, table: 404 };
  const baseSeed = (seedMap[kind] || 505) + size;
  const rng = mulberry32(baseSeed);

  const mapCvs = makeCanvas(size);
  const mapCx = mapCvs.getContext('2d');
  const bumpCvs = needPBR ? makeCanvas(size) : null;
  const bumpCx = bumpCvs ? bumpCvs.getContext('2d') : null;
  const roughCvs = needPBR ? makeCanvas(size) : null;
  const roughCx = roughCvs ? roughCvs.getContext('2d') : null;

  const tau = Math.PI * 2;

  if (kind === 'wood') {
    const p1 = rng() * tau;
    const p2 = rng() * tau;
    fillGrayData(mapCx, size, (x, y) => {
      const u = x / size;
      const v = y / size;
      const warp = Math.sin(u * tau * 2 + p1) * 0.04 + Math.sin(u * tau * 5 + v * tau + p2) * 0.015;
      const ring = Math.sin((v + warp) * tau * 14);
      const fine = Math.sin((v * 48 + u * 2 + p1) * tau) * 0.3;
      const noise = (rng() - 0.5) * 6;
      return 234 + ring * 13 + fine * 5 + noise;
    });
    mapCx.strokeStyle = 'rgba(0,0,0,0.055)';
    mapCx.lineWidth = Math.max(1, size / 256);
    const fiberCount = Math.round(size / 24);
    for (let i = 0; i < fiberCount; i++) {
      const y0 = (i / fiberCount) * size;
      const dy1 = (rng() - 0.5) * (size * 0.05);
      const dy2 = (rng() - 0.5) * (size * 0.05);
      mapCx.beginPath();
      mapCx.moveTo(0, y0);
      mapCx.bezierCurveTo(size * 0.33, y0 + dy1, size * 0.66, y0 + dy2, size, y0);
      mapCx.stroke();
    }

    if (needPBR) {
      const brng = mulberry32(baseSeed + 17);
      fillGrayData(bumpCx, size, (x, y) => {
        const u = x / size;
        const v = y / size;
        const grain = Math.sin((v * 14 + Math.sin(u * tau * 2 + p1) * 0.04) * tau);
        const pore = brng() > 0.94 ? -28 : (brng() - 0.5) * 14;
        return 132 + grain * 18 + pore;
      });
      const rrng = mulberry32(baseSeed + 31);
      fillGrayData(roughCx, size, (x, y) => {
        const u = x / size;
        const v = y / size;
        const grain = Math.sin((v * 14 + Math.sin(u * tau * 2 + p1) * 0.04) * tau);
        const micro = (rrng() - 0.5) * 16;
        return 216 - grain * 18 + micro;
      });
    }
  } else if (kind === 'marble') {
    const p1 = rng() * tau;
    const p2 = rng() * tau;
    fillGrayData(mapCx, size, (x, y) => {
      const u = x / size;
      const v = y / size;
      const cloud = Math.sin(u * tau * 2 + p1) * Math.cos(v * tau * 2 + p2) * 8
        + Math.sin((u + v) * tau * 3 + p1) * 5;
      const noise = (rng() - 0.5) * 5;
      return 240 + cloud + noise;
    });

    const drawVeins = (ctx, strokeStyle, widthScale) => {
      const vrng = mulberry32(baseSeed + 71);
      ctx.strokeStyle = strokeStyle;
      const veins = Math.max(6, Math.round(size / 48));
      for (let i = 0; i < veins; i++) {
        let vx = vrng() * size;
        let vy = 0;
        ctx.lineWidth = (0.8 + vrng() * 1.4) * widthScale;
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        const steps = 8;
        for (let s = 0; s < steps; s++) {
          vx += (vrng() - 0.5) * (size * 0.22);
          vy += size / steps;
          ctx.lineTo(vx, vy);
        }
        ctx.stroke();
      }
    };
    drawVeins(mapCx, 'rgba(0,0,0,0.085)', size / 256);

    if (needPBR) {
      const brng = mulberry32(baseSeed + 83);
      fillGrayData(bumpCx, size, () => 136 + (brng() - 0.5) * 10);
      drawVeins(bumpCx, 'rgba(70,70,70,0.45)', size / 256);

      const rrng = mulberry32(baseSeed + 97);
      fillGrayData(roughCx, size, () => 192 + (rrng() - 0.5) * 14);
      drawVeins(roughCx, 'rgba(245,245,245,0.55)', size / 256);
    }
  } else if (kind === 'slate') {
    const p1 = rng() * tau;
    fillGrayData(mapCx, size, (x, y) => {
      const u = x / size;
      const v = y / size;
      const strata = Math.sin((u * 3 + v * 5) * tau + p1) * 7 + Math.cos((u * 7 - v * 4) * tau) * 4;
      const speck = (rng() - 0.5) * 20;
      return 228 + strata + speck;
    });
    if (needPBR) {
      const brng = mulberry32(baseSeed + 41);
      fillGrayData(bumpCx, size, (x, y) => {
        const u = x / size;
        const v = y / size;
        const ledge = Math.sin((u * 4 + v * 6) * tau + p1) * 16;
        return 128 + ledge + (brng() - 0.5) * 28;
      });
      const rrng = mulberry32(baseSeed + 59);
      fillGrayData(roughCx, size, (x, y) => {
        const u = x / size;
        const v = y / size;
        const strata = Math.sin((u * 3 + v * 5) * tau + p1) * 10;
        return 224 + strata + (rrng() - 0.5) * 20;
      });
    }
  } else {
    /* 'table' or fallback: dark-compatible subtle cross-grain / felt-wood */
    const p1 = rng() * tau;
    fillGrayData(mapCx, size, (x, y) => {
      const u = x / size;
      const v = y / size;
      const wave = Math.sin((u * 6 + p1) * tau) * 6 + Math.cos((v * 8) * tau) * 5;
      return 232 + wave + (rng() - 0.5) * 14;
    });
    if (needPBR) {
      const brng = mulberry32(baseSeed + 23);
      fillGrayData(bumpCx, size, (x, y) => {
        const weave = ((x + y) & 3) === 0 ? 10 : -4;
        return 128 + weave + (brng() - 0.5) * 20;
      });
      const rrng = mulberry32(baseSeed + 37);
      fillGrayData(roughCx, size, () => 228 + (rrng() - 0.5) * 18);
    }
  }

  return {
    map: toCanvasTexture(mapCvs, THREE.SRGBColorSpace, anisotropy),
    bumpMap: needPBR ? toCanvasTexture(bumpCvs, THREE.NoColorSpace, anisotropy) : null,
    roughnessMap: needPBR ? toCanvasTexture(roughCvs, THREE.NoColorSpace, anisotropy) : null
  };
}

export function getBoardPBRTextures(kind = 'wood', tier = 'high') {
  if (kind === 'none' || !kind) {
    return { map: null, bumpMap: null, roughnessMap: null };
  }
  if (typeof document === 'undefined') {
    return { map: null, bumpMap: null, roughnessMap: null };
  }
  const t = normalizeTier(tier);
  const k = kind === 'wood' || kind === 'marble' || kind === 'slate' || kind === 'table' ? kind : 'wood';
  const cacheKey = `${k}:${t}`;
  if (_pbrCache.has(cacheKey)) return _pbrCache.get(cacheKey);
  const set = buildBoardTextureSet(k, t);
  _pbrCache.set(cacheKey, set);
  return set;
}

export function getBoardTexture(kind = 'wood', tier = 'high') {
  return getBoardPBRTextures(kind, tier).map;
}

function applyMapsToMaterial(mat, maps, bumpScale) {
  if (!mat) return;
  mat.map = maps.map;
  mat.bumpMap = maps.bumpMap;
  mat.roughnessMap = maps.roughnessMap;
  mat.bumpScale = maps.bumpMap ? bumpScale : 0;
  mat.needsUpdate = true;
}

export function applyBoardMaterialTextures(materials, theme, tier = 'high') {
  if (!materials) return;
  const t = normalizeTier(tier);
  const activeTheme = theme || BOARD_THEMES[0];
  const boardMaps = getBoardPBRTextures(activeTheme.tex ?? 'wood', t);
  const tableMaps = getBoardPBRTextures('table', t);

  applyMapsToMaterial(materials.lightSq, boardMaps, 0.008);
  applyMapsToMaterial(materials.darkSq, boardMaps, 0.008);
  applyMapsToMaterial(materials.frame, boardMaps, 0.014);
  applyMapsToMaterial(materials.table, tableMaps, 0.018);

  if (materials.fillet && activeTheme.fillet != null) {
    materials.fillet.color.set(activeTheme.fillet);
  }
}

function getCoordTexture(text) {
  if (typeof document === 'undefined') return null;
  if (_coordTexCache.has(text)) return _coordTexCache.get(text);

  const cvs = document.createElement('canvas');
  cvs.width = 64;
  cvs.height = 64;
  const cx = cvs.getContext('2d');
  cx.fillStyle = '#FFFFFF';
  cx.font = '600 34px Georgia, serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText(text, 32, 34);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  _coordTexCache.set(text, tex);
  return tex;
}

function createRingExtrudeGeo({ outer, inner, depth, bevel = false, bevelThickness = 0, bevelSize = 0, bevelSegments = 1 }) {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel,
    bevelThickness,
    bevelSize,
    bevelSegments
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function createBoard(scene, materials, tier = 'high') {
  let currentTier = normalizeTier(tier);
  let currentTheme = BOARD_THEMES[0];

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  /* 64 casas com topo exatamente em y = 0.0 */
  const sqGeo = new THREE.BoxGeometry(1, 0.16, 1);
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = (r + c) % 2 === 0;
      const m = new THREE.Mesh(sqGeo, isLight ? materials.lightSq : materials.darkSq);
      m.position.set(c - 3.5, -0.08, r - 3.5);
      m.receiveShadow = currentTier !== 'low';
      m.userData = { sq: true, r, c };
      boardGroup.add(m);
      squares.push(m);
    }
  }

  /* Moldura chanfrada (high / medium) — outer max 4.52 + 0.045 = 4.565 <= 4.65 (fitRadius) */
  const bevelFrameGroup = new THREE.Group();
  const bevelDepth = 0.30;
  const bevelThick = 0.025;
  const bevelSize = 0.045;
  const frameTop = 0.008;
  const bevelGeo = createRingExtrudeGeo({
    outer: 4.52,
    inner: 4.05,
    depth: bevelDepth,
    bevel: true,
    bevelThickness: bevelThick,
    bevelSize,
    bevelSegments: 3
  });
  const bevelMesh = new THREE.Mesh(bevelGeo, materials.frame);
  bevelMesh.position.y = frameTop - (bevelDepth + bevelThick);
  bevelMesh.castShadow = currentTier !== 'low';
  bevelMesh.receiveShadow = currentTier !== 'low';
  bevelFrameGroup.add(bevelMesh);
  bevelFrameGroup.visible = currentTier !== 'low';
  boardGroup.add(bevelFrameGroup);

  /* Filete metálico embutido na moldura (high / medium) */
  const filletMat = materials.fillet || new THREE.MeshStandardMaterial({
    color: 0xC99A3E,
    metalness: 0.85,
    roughness: 0.24
  });
  const filletGeo = createRingExtrudeGeo({
    outer: 4.092,
    inner: 4.058,
    depth: 0.010,
    bevel: false
  });
  const filletMesh = new THREE.Mesh(filletGeo, filletMat);
  filletMesh.position.y = 0.001;
  filletMesh.castShadow = false;
  filletMesh.receiveShadow = currentTier !== 'low';
  filletMesh.visible = currentTier !== 'low';
  boardGroup.add(filletMesh);

  /* Moldura leve (low tier) — zero realocação ao alternar perfis */
  const simpleFrameGroup = new THREE.Group();
  const t = 0.55, h = 0.34, L = 8 + 2 * t;
  const simpleGeos = [];
  const mkSimpleBar = (w, d, x, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    simpleGeos.push(g);
    const m = new THREE.Mesh(g, materials.frame);
    m.position.set(x, -0.16 + h / 2 - 0.18, z);
    m.castShadow = false;
    m.receiveShadow = false;
    simpleFrameGroup.add(m);
  };
  mkSimpleBar(L, t, 0, -(4 + t / 2));
  mkSimpleBar(L, t, 0, (4 + t / 2));
  mkSimpleBar(t, 8, -(4 + t / 2), 0);
  mkSimpleBar(t, 8, (4 + t / 2), 0);
  simpleFrameGroup.visible = currentTier === 'low';
  boardGroup.add(simpleFrameGroup);

  /* Base sólida */
  const baseGeo = new THREE.BoxGeometry(9.08, 0.28, 9.08);
  const base = new THREE.Mesh(baseGeo, materials.frame);
  base.position.y = -0.32;
  base.receiveShadow = currentTier !== 'low';
  base.castShadow = currentTier !== 'low';
  boardGroup.add(base);

  /* Coordenadas (A–H, 1–8) com cache de 16 texturas e sem Z-fighting */
  const coordGroup = new THREE.Group();
  const coordPlaneGeo = new THREE.PlaneGeometry(0.40, 0.40);
  const coordMats = new Map();
  const coordY = 0.020; /* >= frameTop (0.008) + 0.006 */

  const getCoordMat = (text) => {
    if (coordMats.has(text)) return coordMats.get(text);
    const tex = getCoordTexture(text);
    const mat = new THREE.MeshBasicMaterial({
      color: currentTheme.coord ?? 0xE6D3B3,
      map: tex,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    coordMats.set(text, mat);
    return mat;
  };

  const addCoordMesh = (text, x, z) => {
    const tex = getCoordTexture(text);
    if (!tex) return;
    const p = new THREE.Mesh(coordPlaneGeo, getCoordMat(text));
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, coordY, z);
    coordGroup.add(p);
  };

  for (let i = 0; i < 8; i++) {
    const fileChar = String.fromCharCode(65 + i);
    const rankChar = String(8 - i);
    addCoordMesh(fileChar, i - 3.5, 4.30);
    addCoordMesh(fileChar, i - 3.5, -4.30);
    addCoordMesh(rankChar, -4.30, i - 3.5);
    addCoordMesh(rankChar, 4.30, i - 3.5);
  }
  boardGroup.add(coordGroup);

  /* Mesa */
  const tableGeo = new THREE.CylinderGeometry(8.8, 9.4, 0.5, 64);
  const table = new THREE.Mesh(tableGeo, materials.table);
  table.position.y = -0.72;
  table.receiveShadow = currentTier !== 'low';
  scene.add(table);

  function setQuality(nextTier, theme) {
    currentTier = normalizeTier(nextTier);
    if (theme) {
      currentTheme = typeof theme === 'number' ? (BOARD_THEMES[theme] || currentTheme) : theme;
    }
    const isRich = currentTier !== 'low';
    bevelFrameGroup.visible = isRich;
    filletMesh.visible = isRich;
    simpleFrameGroup.visible = !isRich;

    bevelMesh.castShadow = isRich;
    bevelMesh.receiveShadow = isRich;
    filletMesh.receiveShadow = isRich;
    base.castShadow = isRich;
    base.receiveShadow = isRich;
    table.receiveShadow = isRich;
    for (const sq of squares) sq.receiveShadow = isRich;

    applyBoardMaterialTextures(materials, currentTheme, currentTier);
  }

  function setTheme(themeOrIndex, nextTier) {
    const resolved = typeof themeOrIndex === 'number'
      ? (BOARD_THEMES[themeOrIndex] || BOARD_THEMES[0])
      : (themeOrIndex || BOARD_THEMES[0]);
    currentTheme = resolved;

    materials.lightSq?.color.set(resolved.light);
    materials.darkSq?.color.set(resolved.dark);
    materials.frame?.color.set(resolved.frame);
    materials.table?.color.set(resolved.table);
    if (materials.fillet && resolved.fillet != null) materials.fillet.color.set(resolved.fillet);
    if (filletMat !== materials.fillet && resolved.fillet != null) filletMat.color.set(resolved.fillet);

    const coordHex = resolved.coord ?? 0xE6D3B3;
    for (const mat of coordMats.values()) mat.color.set(coordHex);

    if (scene && resolved.bg != null) scene.background = new THREE.Color(resolved.bg);
    setQuality(nextTier || currentTier, resolved);
  }

  let activeCollapseToken = 0;
  function setCollapsedRings(collapsedRings = 0) {
    activeCollapseToken++;
    const token = activeCollapseToken;

    if (collapsedRings <= 0) {
      for (const sq of squares) {
        sq.position.y = -0.04;
        sq.rotation.set(0, 0, 0);
        sq.scale.setScalar(1);
        sq.visible = true;
        sq.userData.collapsed = false;
      }
      return;
    }

    const falling = [];
    for (const sq of squares) {
      const { r, c } = sq.userData;
      const out1 = r === 0 || r === 7 || c === 0 || c === 7;
      const out2 = r <= 1 || r >= 6 || c <= 1 || c >= 6;
      const shouldCollapse = (collapsedRings >= 1 && out1) || (collapsedRings >= 2 && out2);
      if (shouldCollapse && !sq.userData.collapsed) {
        sq.userData.collapsed = true;
        const delayMs = ((r + c) % 6) * 28;
        const rotDirX = (r < 4 ? -1 : 1) * (0.4 + Math.random() * 0.45);
        const rotDirZ = (c < 4 ? 1 : -1) * (0.4 + Math.random() * 0.45);
        falling.push({ sq, delayMs, rotDirX, rotDirZ });
      } else if (!shouldCollapse) {
        sq.position.y = -0.04;
        sq.rotation.set(0, 0, 0);
        sq.scale.setScalar(1);
        sq.visible = true;
        sq.userData.collapsed = false;
      }
    }

    if (!falling.length || typeof requestAnimationFrame !== 'function') {
      for (const item of falling) {
        item.sq.position.y = -1.65;
        item.sq.visible = false;
      }
      return;
    }

    const startTime = performance.now();
    const duration = 460;
    function step(now) {
      if (token !== activeCollapseToken) return;
      let anyAlive = false;
      for (const item of falling) {
        const elapsed = now - startTime - item.delayMs;
        if (elapsed < 0) {
          anyAlive = true;
          continue;
        }
        const k = Math.min(1, elapsed / duration);
        const grav = k * k;
        item.sq.position.y = -0.04 - grav * 2.1;
        item.sq.rotation.x = grav * item.rotDirX;
        item.sq.rotation.z = grav * item.rotDirZ;
        item.sq.scale.setScalar(1 - grav * 0.32);
        if (k >= 1) {
          item.sq.visible = false;
        } else {
          anyAlive = true;
        }
      }
      if (anyAlive) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function dispose() {
    scene.remove(boardGroup);
    scene.remove(table);
    sqGeo.dispose();
    bevelGeo.dispose();
    filletGeo.dispose();
    for (const g of simpleGeos) g.dispose();
    baseGeo.dispose();
    coordPlaneGeo.dispose();
    tableGeo.dispose();
    for (const mat of coordMats.values()) mat.dispose();
    coordMats.clear();
    if (!materials.fillet) filletMat.dispose();
  }

  return {
    boardGroup,
    squares,
    table,
    base,
    bevelFrameGroup,
    simpleFrameGroup,
    filletMesh,
    coordGroup,
    setQuality,
    setTheme,
    setCollapsedRings,
    dispose
  };
}

export function setBoardQuality(tier, boardOrContext, theme) {
  if (!boardOrContext) return;
  if (typeof boardOrContext.setQuality === 'function') {
    boardOrContext.setQuality(tier, theme);
    return;
  }
  const { board, materials, boardTheme } = boardOrContext;
  if (board && typeof board.setQuality === 'function') {
    board.setQuality(tier, theme || boardTheme);
  } else if (materials) {
    applyBoardMaterialTextures(materials, theme || boardTheme || BOARD_THEMES[0], tier);
  }
}

export function applyBoardTheme(themeOrIndex, target, tier = 'high') {
  if (!target) return;
  if (typeof target.setTheme === 'function') {
    target.setTheme(themeOrIndex, tier);
    return;
  }
  const resolved = typeof themeOrIndex === 'number'
    ? (BOARD_THEMES[themeOrIndex] || BOARD_THEMES[0])
    : (themeOrIndex || BOARD_THEMES[0]);
  const materials = target.materials || target;
  if (materials.lightSq) materials.lightSq.color.set(resolved.light);
  if (materials.darkSq) materials.darkSq.color.set(resolved.dark);
  if (materials.frame) materials.frame.color.set(resolved.frame);
  if (materials.table) materials.table.color.set(resolved.table);
  if (target.scene && resolved.bg != null) target.scene.background = new THREE.Color(resolved.bg);
  applyBoardMaterialTextures(materials, resolved, tier);
}
