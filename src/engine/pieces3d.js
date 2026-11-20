/* ============================================================
   XADREZ ROYALE — Peças Staunton 3D Esculpidas
   Geometrias compartilhadas por tipo (p, r, n, b, q, k) + UVs + PBR
   ============================================================ */

import * as THREE from 'three';
import { worldPos } from './board3d.js';
import { PIECE_THEMES } from './themes.js';
import { tween, easeIO } from '../core/utils.js';

const _pieceTexCache = new Map();

function normalizeTier(tier) {
  return tier === 'low' || tier === 'medium' ? tier : 'high';
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function clampByte(v) {
  return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
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

function lathe(pts, segs = 28) {
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

function normalizeLatheV(geo, minY, maxY) {
  const pos = geo.attributes.position;
  let uv = geo.attributes.uv;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  const span = Math.max(1e-5, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const u = clamp01(uv.getX(i));
    const v = clamp01((pos.getY(i) - minY) / span);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

function applyCylindricalFoldedUV(geo, minY, maxY) {
  const pos = geo.attributes.position;
  let uv = geo.attributes.uv;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  const span = Math.max(1e-5, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const u = clamp01(Math.abs(Math.atan2(x, z)) / Math.PI);
    const v = clamp01((y - minY) / span);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

function applyCrownBoxUV(geo, minY, maxY) {
  const pos = geo.attributes.position;
  let uv = geo.attributes.uv;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  const span = Math.max(1e-5, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const u = clamp01(0.35 + clamp01(uv.getX(i)) * 0.30);
    const v = clamp01((pos.getY(i) - minY) / span);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

function applyHeightV(geo, minY, maxY) {
  const pos = geo.attributes.position;
  let uv = geo.attributes.uv;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  const span = Math.max(1e-5, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const u = clamp01(uv.getX(i));
    const v = clamp01((pos.getY(i) - minY) / span);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

/* Merge de BufferGeometries estáticas preservando position, normal e UVs normalizados */
function mergeGeos(geos) {
  const nonIndexed = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let totalVerts = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const g of nonIndexed) {
    const p = g.attributes.position;
    totalVerts += p.count;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const spanY = Math.max(1e-5, maxY - minY);

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  let offset3 = 0;
  let offset2 = 0;

  for (const g of nonIndexed) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const pAttr = g.attributes.position;
    const nAttr = g.attributes.normal;
    const uvAttr = g.attributes.uv;
    const count = pAttr.count;

    pos.set(pAttr.array, offset3);
    norm.set(nAttr.array, offset3);

    if (uvAttr) {
      for (let i = 0; i < count; i++) {
        uv[offset2 + i * 2] = clamp01(uvAttr.getX(i));
        uv[offset2 + i * 2 + 1] = clamp01(uvAttr.getY(i));
      }
    } else {
      for (let i = 0; i < count; i++) {
        const x = pAttr.getX(i);
        const y = pAttr.getY(i);
        const z = pAttr.getZ(i);
        uv[offset2 + i * 2] = clamp01(Math.abs(Math.atan2(x, z)) / Math.PI);
        uv[offset2 + i * 2 + 1] = clamp01((y - minY) / spanY);
      }
    }

    offset3 += count * 3;
    offset2 += count * 2;
  }

  for (let i = 0; i < geos.length; i++) {
    if (nonIndexed[i] !== geos[i]) nonIndexed[i].dispose();
    geos[i].dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

export function createChessGeometries(tier = 'high') {
  const t = normalizeTier(tier);
  const segs = t === 'low' ? 18 : 28;

  /* 1. Peão (Pawn) */
  const pawn = normalizeLatheV(lathe([
    [0.001, 0], [0.27, 0], [0.28, 0.05], [0.22, 0.09],
    [0.14, 0.16], [0.09, 0.36], [0.16, 0.40], [0.09, 0.43],
    [0.14, 0.52], [0.12, 0.62], [0.001, 0.67]
  ], segs), 0, 0.67);

  /* 2. Torre (Rook) */
  const rookBase = normalizeLatheV(lathe([
    [0.001, 0], [0.30, 0], [0.31, 0.06], [0.24, 0.11],
    [0.19, 0.20], [0.16, 0.56], [0.24, 0.62], [0.24, 0.75],
    [0.16, 0.75], [0.16, 0.69], [0.001, 0.69]
  ], segs), 0, 0.83);
  const battlementParts = [rookBase];
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    const b = new THREE.BoxGeometry(0.11, 0.08, 0.08);
    b.translate(Math.cos(ang) * 0.20, 0.79, Math.sin(ang) * 0.20);
    b.rotateY(-ang);
    applyCrownBoxUV(b, 0, 0.83);
    battlementParts.push(b);
  }
  const rook = mergeGeos(battlementParts);

  /* 3. Cavalo (Knight) */
  const knightBase = normalizeLatheV(lathe([
    [0.001, 0], [0.30, 0], [0.31, 0.06], [0.23, 0.12],
    [0.18, 0.20], [0.001, 0.21]
  ], segs), 0, 0.915);
  const shape = new THREE.Shape();
  shape.moveTo(-0.14, 0.20);
  shape.lineTo(0.15, 0.20);
  shape.quadraticCurveTo(0.18, 0.42, 0.10, 0.58);
  shape.lineTo(0.22, 0.63);
  shape.lineTo(0.18, 0.72);
  shape.lineTo(0.06, 0.80);
  shape.lineTo(0.02, 0.88);
  shape.lineTo(-0.06, 0.82);
  shape.quadraticCurveTo(-0.18, 0.74, -0.19, 0.50);
  shape.quadraticCurveTo(-0.18, 0.34, -0.14, 0.20);
  const head = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 2
  });
  head.translate(0, 0, -0.08);
  head.rotateY(Math.PI / 2);
  applyCylindricalFoldedUV(head, 0, 0.915);
  const knight = mergeGeos([knightBase, head]);

  /* 4. Bispo (Bishop) */
  const bishop = normalizeLatheV(lathe([
    [0.001, 0], [0.29, 0], [0.30, 0.06], [0.22, 0.11],
    [0.14, 0.22], [0.10, 0.52], [0.17, 0.56], [0.11, 0.59],
    [0.15, 0.72], [0.11, 0.84], [0.04, 0.90], [0.06, 0.94], [0.001, 0.96]
  ], segs), 0, 0.96);

  /* 5. Dama (Queen) */
  const queenBody = normalizeLatheV(lathe([
    [0.001, 0], [0.33, 0], [0.34, 0.07], [0.25, 0.13],
    [0.17, 0.26], [0.12, 0.66], [0.21, 0.72], [0.14, 0.75],
    [0.21, 0.92], [0.14, 0.94], [0.08, 1.02], [0.001, 1.05]
  ], segs), 0, 1.145);
  const qSphere = new THREE.SphereGeometry(0.055, 12, 10);
  qSphere.translate(0, 1.09, 0);
  applyHeightV(qSphere, 0, 1.145);
  const queen = mergeGeos([queenBody, qSphere]);

  /* 6. Rei (King) */
  const kingBody = normalizeLatheV(lathe([
    [0.001, 0], [0.35, 0], [0.36, 0.07], [0.26, 0.14],
    [0.18, 0.28], [0.13, 0.72], [0.22, 0.78], [0.15, 0.82],
    [0.21, 0.98], [0.16, 1.04], [0.001, 1.06]
  ], segs), 0, 1.25);
  const crossV = new THREE.BoxGeometry(0.055, 0.20, 0.055);
  crossV.translate(0, 1.15, 0);
  applyCrownBoxUV(crossV, 0, 1.25);
  const crossH = new THREE.BoxGeometry(0.16, 0.055, 0.055);
  crossH.translate(0, 1.18, 0);
  applyCrownBoxUV(crossH, 0, 1.25);
  const king = mergeGeos([kingBody, crossV, crossH]);

  return { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
}

function makePieceCanvasTex(size, colorSpace, anisotropy, fn) {
  const cvs = document.createElement('canvas');
  cvs.width = size;
  cvs.height = size;
  const cx = cvs.getContext('2d');
  const img = cx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const v = 1 - y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const val = clampByte(fn(u, v, x, y));
      const idx = (y * size + x) * 4;
      d[idx] = val;
      d[idx + 1] = val;
      d[idx + 2] = val;
      d[idx + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

export function getPieceTextures(texKind = 'wood', tier = 'high') {
  const t = normalizeTier(tier);
  if (t === 'low' || typeof document === 'undefined') return null;

  const k = texKind === 'ivory' || texKind === 'metal' || texKind === 'matte' ? texKind : 'wood';
  const cacheKey = `${k}:${t}`;
  if (_pieceTexCache.has(cacheKey)) return _pieceTexCache.get(cacheKey);

  const size = t === 'high' ? 256 : 128;
  const anisotropy = t === 'high' ? 4 : 2;
  const seedBase = k === 'wood' ? 701 : k === 'ivory' ? 809 : k === 'metal' ? 911 : 1013;
  const rngM = mulberry32(seedBase + size);
  const rngB = mulberry32(seedBase + size + 19);
  const rngR = mulberry32(seedBase + size + 37);
  const tau = Math.PI * 2;

  let map, bumpMap, roughnessMap;

  if (k === 'wood') {
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, (u, v) => {
      const fiber = Math.sin((u * 12 + Math.sin(v * tau * 2) * 0.25) * tau);
      const sub = Math.sin((u * 26 + v * 2) * tau) * 0.4;
      return 241 + fiber * 8 + sub * 4 + (rngM() - 0.5) * 4;
    });
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const fiber = Math.sin((u * 12 + Math.sin(v * tau * 2) * 0.25) * tau);
      return 128 + fiber * 16 + (rngB() - 0.5) * 12;
    });
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const fiber = Math.sin((u * 12 + Math.sin(v * tau * 2) * 0.25) * tau);
      return 222 - fiber * 18 + (rngR() - 0.5) * 14;
    });
  } else if (k === 'ivory') {
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, (u, v) => {
      const vein = Math.sin((u * 3 + v * 5 + Math.sin(u * tau * 2) * 0.3) * tau);
      return 247 + vein * 5 + (rngM() - 0.5) * 3;
    });
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const vein = Math.sin((u * 3 + v * 5) * tau);
      return 128 + vein * 8 + (rngB() - 0.5) * 8;
    });
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const sheen = Math.cos((u * 2 + v * 4) * tau);
      return 228 + sheen * 12 + (rngR() - 0.5) * 10;
    });
  } else if (k === 'metal') {
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, (u, v) => {
      const band = Math.sin(v * tau * 42) * 5 + Math.cos(u * tau * 2) * 3;
      return 242 + band + (rngM() - 0.5) * 6;
    });
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const brush = Math.sin(v * tau * 42) * 16;
      return 128 + brush + (rngB() - 0.5) * 12;
    });
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const brush = Math.sin(v * tau * 42) * 20 + Math.sin(u * tau * 3) * 6;
      return 220 + brush + (rngR() - 0.5) * 16;
    });
  } else {
    /* 'matte' */
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, () => 250 + (rngM() - 0.5) * 5);
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, () => 128 + (rngB() - 0.5) * 14);
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, () => 242 + (rngR() - 0.5) * 12);
  }

  const set = { map, bumpMap, roughnessMap };
  _pieceTexCache.set(cacheKey, set);
  return set;
}

export function newPieceMaterial(colorHex, theme, tier = 'high') {
  const t = normalizeTier(tier);
  const isMetal = !!theme?.metal;
  const texKind = theme?.tex || (isMetal ? 'metal' : 'wood');
  const isMatte = texKind === 'matte';

  if (t === 'low') {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: isMetal ? 0.30 : (isMatte ? 0.54 : 0.42),
      metalness: isMetal ? 0.82 : 0.06
    });
  }

  const tex = getPieceTextures(texKind, t);
  const texMaps = tex ? { map: tex.map, bumpMap: tex.bumpMap, roughnessMap: tex.roughnessMap } : {};

  if (isMetal) {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.24,
      metalness: 0.88,
      ...texMaps,
      bumpScale: tex ? 0.004 : 0
    });
  }

  if (isMatte) {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.52,
      metalness: 0.02,
      ...texMaps,
      bumpScale: tex ? 0.002 : 0
    });
  }

  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    roughness: texKind === 'ivory' ? 0.26 : 0.32,
    metalness: 0.05,
    clearcoat: t === 'high' ? 0.65 : 0.40,
    clearcoatRoughness: texKind === 'ivory' ? 0.18 : 0.22,
    ...texMaps,
    bumpScale: tex ? (texKind === 'ivory' ? 0.0025 : 0.005) : 0
  });
}

export function createPieceMesh(type, color, geos, theme, tier = 'high') {
  const t = normalizeTier(tier);
  const resolvedTheme = theme || PIECE_THEMES[0];
  const colorHex = color === 'w' ? resolvedTheme.w : resolvedTheme.b;
  const mat = newPieceMaterial(colorHex, resolvedTheme, t);
  const mesh = new THREE.Mesh(geos[type], mat);
  mesh.castShadow = t !== 'low';
  mesh.receiveShadow = t !== 'low';
  /* Pretas olham para o lado oposto (importante para o Cavalo) */
  if (type === 'n' && color === 'b') mesh.rotation.y = Math.PI;
  return mesh;
}

export function makeChessPiece(scene, geos, type, color, r, c, theme, tier = 'high') {
  const mesh = createPieceMesh(type, color, geos, theme, tier);
  const pos = worldPos(r, c);
  mesh.position.set(pos.x, 0, pos.z);
  scene.add(mesh);
  const piece = { mesh, type, color, r, c };
  mesh.userData.piece = piece;
  return piece;
}

function resolveMeshList(ctx) {
  if (!ctx) return { all: [], captured: [] };
  if (Array.isArray(ctx)) return { all: ctx.map(p => p?.mesh || p).filter(Boolean), captured: [] };
  const board = (ctx.pieceMeshes || ctx.meshes || []).map(p => p?.mesh || p).filter(Boolean);
  const captured = (ctx.capturedMeshes || []).map(p => p?.mesh || p).filter(Boolean);
  return { all: [...board, ...captured], captured };
}

export function applyPieceTheme(theme, tier = 'high', ctx = {}) {
  const t = normalizeTier(tier);
  const resolvedTheme = typeof theme === 'number'
    ? (PIECE_THEMES[theme] || PIECE_THEMES[0])
    : (theme || PIECE_THEMES[0]);
  const { all } = resolveMeshList(ctx);

  for (const mesh of all) {
    const pieceInfo = mesh.userData?.piece;
    const color = pieceInfo?.color || 'w';
    const colorHex = color === 'w' ? resolvedTheme.w : resolvedTheme.b;
    const oldMat = mesh.material;
    const nextMat = newPieceMaterial(colorHex, resolvedTheme, t);

    if (oldMat && oldMat.emissiveIntensity > 0 && nextMat.emissive) {
      nextMat.emissive.copy(oldMat.emissive);
      nextMat.emissiveIntensity = oldMat.emissiveIntensity;
    }

    mesh.material = nextMat;
    if (oldMat && typeof oldMat.dispose === 'function') oldMat.dispose();
  }
}

export function setPieceQuality(tier, ctx = {}) {
  const t = normalizeTier(tier);
  const { all, captured } = resolveMeshList(ctx);
  const theme = ctx.theme || ctx.pieceTheme || PIECE_THEMES[0];

  if (all.length > 0) {
    applyPieceTheme(theme, t, ctx);
  }

  for (const mesh of all) {
    mesh.castShadow = t !== 'low';
    mesh.receiveShadow = t !== 'low';
  }
  for (const mesh of captured) {
    mesh.visible = t !== 'low';
  }

  if (ctx.geos) {
    const newGeos = createChessGeometries(t);
    for (const mesh of all) {
      const pType = mesh.userData?.piece?.type;
      if (pType && newGeos[pType]) mesh.geometry = newGeos[pType];
    }
    disposeChessGeometries(ctx.geos);
    Object.assign(ctx.geos, newGeos);
  }

  if (ctx.disposeOldTextures) {
    disposePieceTextures(t === 'low' ? '__none__' : t);
  }
}

export function disposePieceTextures(keepTier = null) {
  for (const [key, set] of _pieceTexCache.entries()) {
    if (keepTier && key.endsWith(`:${keepTier}`)) continue;
    set.map?.dispose();
    set.bumpMap?.dispose();
    set.roughnessMap?.dispose();
    _pieceTexCache.delete(key);
  }
}

export function disposeChessGeometries(geos) {
  if (!geos) return;
  for (const k of ['p', 'r', 'n', 'b', 'q', 'k']) {
    if (geos[k] && typeof geos[k].dispose === 'function') {
      geos[k].dispose();
    }
  }
}

export async function animatePieceMove(piece, toR, toC, isJump = false, dur = 240) {
  const from = worldPos(piece.r, piece.c);
  const to = worldPos(toR, toC);
  piece.r = toR;
  piece.c = toC;
  const arc = isJump ? 0.65 : 0.12;
  await tween(dur, k => {
    const e = easeIO(k);
    piece.mesh.position.x = from.x + (to.x - from.x) * e;
    piece.mesh.position.z = from.z + (to.z - from.z) * e;
    piece.mesh.position.y = Math.sin(e * Math.PI) * arc;
  });
  piece.mesh.position.set(to.x, 0, to.z);
}
