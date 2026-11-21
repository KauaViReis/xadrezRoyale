/* ============================================================
   XADREZ ROYALE — Peças Staunton Championship 3D Esculpidas
   Curvas Spline + Cavalo 3D Multi-Seção + Mitra com Corte +
   Coroa de Pérolas + Ameias Curvas + Cruz Pattée + Vertex AO/Feltro + LOD
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

/* Interpola seções curvas com SplineCurve preservando quinas vivas (colarinhos/anéis) */
function smoothLathe(sections, radialSegs = 28, subDiv = 4) {
  const out = [];
  for (const sec of sections) {
    if (sec.length <= 2 || subDiv <= 1) {
      for (const pt of sec) {
        if (!out.length || Math.hypot(pt[0] - out[out.length - 1][0], pt[1] - out[out.length - 1][1]) > 1e-4) {
          out.push(pt);
        }
      }
    } else {
      const curve = new THREE.SplineCurve(sec.map(([x, y]) => new THREE.Vector2(x, y)));
      const samples = curve.getPoints((sec.length - 1) * subDiv);
      for (const v of samples) {
        const pt = [Math.max(0.001, v.x), v.y];
        if (!out.length || Math.hypot(pt[0] - out[out.length - 1][0], pt[1] - out[out.length - 1][1]) > 1e-4) {
          out.push(pt);
        }
      }
    }
  }
  return lathe(out, radialSegs);
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

/* Calcula Ambient Occlusion procedural, base de feltro e anel metálico em vertex colors */
function computePieceVertexColor(x, y, z, ny, minY, maxY) {
  const h = clamp01((y - minY) / Math.max(1e-5, maxY - minY));
  const r = Math.hypot(x, z);

  /* 1. Base de feltro escuro (y < 0.022) */
  if (y < 0.022) {
    return [0.42, 0.40, 0.38];
  }

  /* 2. Anel de transição / filete polido na base (0.044 <= y <= 0.068) */
  if (y >= 0.044 && y <= 0.068 && r > 0.22) {
    return [1.06, 1.03, 0.96];
  }

  /* 3. Gradiente vertical natural + oclusão em sulcos voltados para baixo */
  const verticalLift = 0.88 + 0.14 * Math.pow(h, 0.55);
  const grooveShade = ny < -0.25 ? (1 + (ny + 0.25) * 0.22) : 1.0;
  const collarCrevice = (Math.abs(y - 0.12) < 0.018 || Math.abs(y - 0.19) < 0.018) ? 0.90 : 1.0;
  const s = clamp01(verticalLift * grooveShade * collarCrevice);
  return [s, s, s];
}

/* Merge de BufferGeometries estáticas preservando position, normal, UVs e vertex color AO */
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
  const col = new Float32Array(totalVerts * 3);
  let offset3 = 0;
  let offset2 = 0;

  for (const g of nonIndexed) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const pAttr = g.attributes.position;
    const nAttr = g.attributes.normal;
    const uvAttr = g.attributes.uv;
    const colAttr = g.attributes.color;
    const count = pAttr.count;

    pos.set(pAttr.array, offset3);
    norm.set(nAttr.array, offset3);

    for (let i = 0; i < count; i++) {
      const x = pAttr.getX(i);
      const y = pAttr.getY(i);
      const z = pAttr.getZ(i);
      const ny = nAttr.getY(i);

      if (uvAttr) {
        uv[offset2 + i * 2] = clamp01(uvAttr.getX(i));
        uv[offset2 + i * 2 + 1] = clamp01(uvAttr.getY(i));
      } else {
        uv[offset2 + i * 2] = clamp01(Math.abs(Math.atan2(x, z)) / Math.PI);
        uv[offset2 + i * 2 + 1] = clamp01((y - minY) / spanY);
      }

      if (colAttr) {
        col[offset3 + i * 3] = colAttr.getX(i);
        col[offset3 + i * 3 + 1] = colAttr.getY(i);
        col[offset3 + i * 3 + 2] = colAttr.getZ(i);
      } else {
        const [cr, cg, cb] = computePieceVertexColor(x, y, z, ny, minY, maxY);
        col[offset3 + i * 3] = cr;
        col[offset3 + i * 3 + 1] = cg;
        col[offset3 + i * 3 + 2] = cb;
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
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

/* Base Staunton Championship compartilhada (toro duplo, cavetto e filete de base) */
function stauntonBaseSections(rScale = 1.0) {
  const s = r => +(r * rScale).toFixed(4);
  return [
    [[0.001, 0], [s(0.305), 0], [s(0.312), 0.022], [s(0.305), 0.044]],
    [[s(0.305), 0.044], [s(0.318), 0.056], [s(0.302), 0.068]],
    [[s(0.302), 0.068], [s(0.258), 0.095], [s(0.275), 0.122], [s(0.245), 0.145]],
    [[s(0.245), 0.145], [s(0.205), 0.175], [s(0.222), 0.195], [s(0.188), 0.212]]
  ];
}

/* Merlão (ameia) curvo para a coroa da Torre */
function createCurvedMerlonGeo(innerR, outerR, height, startAng, endAng, arcSegs = 4) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= arcSegs; i++) {
    const a = startAng + (endAng - startAng) * (i / arcSegs);
    const x = Math.cos(a) * outerR;
    const y = Math.sin(a) * outerR;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = arcSegs; i >= 0; i--) {
    const a = startAng + (endAng - startAng) * (i / arcSegs);
    const x = Math.cos(a) * innerR;
    const y = Math.sin(a) * innerR;
    shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.008,
    bevelSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/* Esculpe o entalhe diagonal real (mitre slit) na cabeça do Bispo */
function carveBishopMitreSlit(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > 0.72 && y < 0.93 && z > 0.01) {
      /* Plano inclinado do corte da mitra */
      const planeDist = Math.abs((y - 0.825) - z * 0.45);
      if (planeDist < 0.032) {
        const depthFactor = 1 - (1 - planeDist / 0.032) * 0.34;
        pos.setXYZ(i, x * depthFactor, y, z * depthFactor);
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* Constrói a cabeça 3D orgânica do Cavalo Staunton (focinho, mandíbula, orelhas, olhos e crina) */
function createSculptedKnightParts(tier, maxH) {
  const isHigh = tier === 'high';
  const bevelSegs = tier === 'low' ? 1 : (isHigh ? 3 : 2);

  /* 1. Corpo central / pescoço arqueado / mandíbula / focinho */
  const headShape = new THREE.Shape();
  headShape.moveTo(-0.145, 0.205);
  headShape.lineTo(0.145, 0.205);
  headShape.bezierCurveTo(0.185, 0.32, 0.165, 0.46, 0.095, 0.54); // peito -> garganta
  headShape.lineTo(0.125, 0.515);                                 // queixo / mandíbula
  headShape.bezierCurveTo(0.195, 0.54, 0.255, 0.57, 0.275, 0.605); // parte inferior do focinho
  headShape.bezierCurveTo(0.288, 0.635, 0.268, 0.675, 0.235, 0.695); // ponta do focinho / narina
  headShape.bezierCurveTo(0.185, 0.735, 0.115, 0.785, 0.055, 0.835); // chanfro nasal -> testa
  headShape.lineTo(0.025, 0.875);
  headShape.bezierCurveTo(-0.045, 0.865, -0.135, 0.815, -0.175, 0.715); // nuca arqueada
  headShape.bezierCurveTo(-0.215, 0.585, -0.195, 0.365, -0.145, 0.205); // dorso do pescoço

  const headGeo = new THREE.ExtrudeGeometry(headShape, {
    depth: 0.13,
    bevelEnabled: true,
    bevelThickness: 0.042,
    bevelSize: 0.034,
    bevelSegments: bevelSegs,
    curveSegments: tier === 'low' ? 10 : 18
  });
  headGeo.translate(0, 0, -0.065);

  /* Afila o focinho em 3D (anatomia real: largo nas bochechas, fino no nariz, largo no peito) */
  const hPos = headGeo.attributes.position;
  for (let i = 0; i < hPos.count; i++) {
    const px = hPos.getX(i); // frente (+x) / trás (-x)
    const py = hPos.getY(i);
    const pz = hPos.getZ(i); // largura lateral

    let widthMul = 1.0;
    if (px > 0.08) {
      /* Afilamento progressivo até o focinho */
      const snoutT = clamp01((px - 0.08) / 0.20);
      widthMul *= 1.0 - snoutT * 0.46;
    }
    if (py > 0.52 && py < 0.74 && px > -0.05 && px < 0.11) {
      /* Volume muscular das bochechas/mandíbula */
      widthMul *= 1.14;
    }
    if (py < 0.34) {
      /* Base do pescoço encorpada para fundir na base torneada */
      const baseT = clamp01((0.34 - py) / 0.14);
      widthMul *= 1.0 + baseT * 0.24;
    }
    hPos.setZ(i, pz * widthMul);
  }
  hPos.needsUpdate = true;
  headGeo.rotateY(Math.PI / 2);
  applyCylindricalFoldedUV(headGeo, 0, maxH);

  const parts = [headGeo];

  /* 2. Duas orelhas alertas esculpidas em 3D (separadas lateralmente) */
  const earSegs = tier === 'low' ? 6 : 10;
  for (const side of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.036, 0.115, earSegs);
    ear.rotateZ(-0.22);
    ear.rotateX(side * 0.18);
    ear.translate(side * 0.046, 0.895, 0.015);
    applyCylindricalFoldedUV(ear, 0, maxH);
    parts.push(ear);
  }

  /* 3. Crina esculpida em gomos ao longo do dorso do pescoço */
  const maneCount = tier === 'low' ? 4 : 7;
  const maneSphereSegs = tier === 'low' ? 6 : 10;
  for (let i = 0; i < maneCount; i++) {
    const t = i / (maneCount - 1);
    const my = 0.28 + t * 0.54;
    const mz = -0.155 - Math.sin(t * Math.PI) * 0.042 + t * 0.035;
    const radius = 0.044 - Math.abs(t - 0.45) * 0.018;
    const ridge = new THREE.SphereGeometry(radius, maneSphereSegs, maneSphereSegs);
    ridge.scale(0.72, 0.95, 1.32);
    ridge.translate(0, my, mz);
    applyCylindricalFoldedUV(ridge, 0, maxH);
    parts.push(ridge);
  }

  /* 4. Olhos e narinas esculpidos (high / medium) */
  if (tier !== 'low') {
    for (const side of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.018, 8, 8);
      eye.translate(side * 0.068, 0.745, 0.085);
      applyCylindricalFoldedUV(eye, 0, maxH);
      parts.push(eye);

      const nostril = new THREE.SphereGeometry(0.014, 7, 7);
      nostril.translate(side * 0.034, 0.648, 0.242);
      applyCylindricalFoldedUV(nostril, 0, maxH);
      parts.push(nostril);
    }
  }

  return parts;
}

/* Cruz Pattée chanfrada para o topo do Rei */
function createKingPatteeCross(tier, maxH) {
  const s = new THREE.Shape();
  /* Cruz imperial com braços trapezoidais alargados nas pontas */
  s.moveTo(-0.026, 0.0);
  s.lineTo(0.026, 0.0);
  s.lineTo(0.022, 0.075);
  s.lineTo(0.082, 0.062);
  s.lineTo(0.082, 0.122);
  s.lineTo(0.022, 0.109);
  s.lineTo(0.032, 0.185);
  s.lineTo(-0.032, 0.185);
  s.lineTo(-0.022, 0.109);
  s.lineTo(-0.082, 0.122);
  s.lineTo(-0.082, 0.062);
  s.lineTo(-0.022, 0.075);
  s.closePath();

  const cross = new THREE.ExtrudeGeometry(s, {
    depth: 0.044,
    bevelEnabled: tier !== 'low',
    bevelThickness: 0.009,
    bevelSize: 0.008,
    bevelSegments: 1
  });
  cross.translate(0, 1.075, -0.022);
  applyCrownBoxUV(cross, 0, maxH);
  return cross;
}

export function createChessGeometries(tier = 'high') {
  const t = normalizeTier(tier);
  const segs = t === 'low' ? 18 : (t === 'medium' ? 28 : 40);
  const subDiv = t === 'low' ? 2 : 4;

  /* 1. Peão (Pawn) — Staunton com colarinho duplo e esfera polida */
  const pawnGeo = normalizeLatheV(smoothLathe([
    ...stauntonBaseSections(0.90),
    [[0.169, 0.212], [0.118, 0.295], [0.092, 0.385], [0.084, 0.445]],
    [[0.084, 0.445], [0.158, 0.462], [0.158, 0.478], [0.095, 0.492]],
    [[0.095, 0.492], [0.138, 0.535], [0.148, 0.595], [0.112, 0.652], [0.048, 0.682], [0.001, 0.69]]
  ], segs, subDiv), 0, 0.69);
  const pawn = mergeGeos([pawnGeo]);

  /* 2. Torre (Rook) — Fuste cônico, colarinho e 6 ameias curvas */
  const rookMaxH = 0.84;
  const rookBody = normalizeLatheV(smoothLathe([
    ...stauntonBaseSections(0.98),
    [[0.184, 0.212], [0.168, 0.38], [0.154, 0.56]],
    [[0.154, 0.56], [0.212, 0.585], [0.178, 0.612]],
    [[0.178, 0.612], [0.238, 0.65], [0.238, 0.76]],
    [[0.238, 0.76], [0.165, 0.76], [0.165, 0.705], [0.001, 0.705]]
  ], segs, subDiv), 0, rookMaxH);

  const rookParts = [rookBody];
  const merlonCount = 6;
  const arcSegs = t === 'low' ? 2 : 4;
  for (let i = 0; i < merlonCount; i++) {
    const step = (Math.PI * 2) / merlonCount;
    const a0 = i * step + 0.09;
    const a1 = (i + 1) * step - 0.09;
    const merlon = createCurvedMerlonGeo(0.165, 0.236, 0.075, a0, a1, arcSegs);
    merlon.translate(0, 0.758, 0);
    applyCrownBoxUV(merlon, 0, rookMaxH);
    rookParts.push(merlon);
  }
  const rook = mergeGeos(rookParts);

  /* 3. Cavalo (Knight) — Base torneada + escultura 3D orgânica multi-seção */
  const knightMaxH = 0.94;
  const knightBase = normalizeLatheV(smoothLathe([
    ...stauntonBaseSections(0.98),
    [[0.184, 0.212], [0.162, 0.232], [0.001, 0.235]]
  ], segs, subDiv), 0, knightMaxH);
  const knight = mergeGeos([knightBase, ...createSculptedKnightParts(t, knightMaxH)]);

  /* 4. Bispo (Bishop) — Colarinho duplo + Mitra com corte diagonal real + Finial */
  const bishopMaxH = 0.98;
  const bishopBody = normalizeLatheV(smoothLathe([
    ...stauntonBaseSections(0.96),
    [[0.180, 0.212], [0.132, 0.34], [0.102, 0.51]],
    [[0.102, 0.51], [0.175, 0.535], [0.145, 0.562], [0.165, 0.582], [0.108, 0.605]],
    [[0.108, 0.605], [0.158, 0.695], [0.155, 0.79], [0.105, 0.885], [0.036, 0.93], [0.001, 0.935]]
  ], segs, subDiv), 0, bishopMaxH);
  carveBishopMitreSlit(bishopBody);
  const bFinial = new THREE.SphereGeometry(0.036, t === 'low' ? 8 : 14, t === 'low' ? 6 : 10);
  bFinial.translate(0, 0.952, 0);
  applyHeightV(bFinial, 0, bishopMaxH);
  const bishop = mergeGeos([bishopBody, bFinial]);

  /* 5. Dama (Queen) — Colarinho duplo + Coroa real com 10 pérolas/pontas + Esfera central */
  const queenMaxH = 1.15;
  const queenBody = normalizeLatheV(smoothLathe([
    ...stauntonBaseSections(1.05),
    [[0.197, 0.212], [0.152, 0.38], [0.118, 0.64]],
    [[0.118, 0.64], [0.205, 0.672], [0.165, 0.702], [0.192, 0.728], [0.134, 0.752]],
    [[0.134, 0.752], [0.172, 0.86], [0.218, 0.955], [0.165, 0.985], [0.125, 1.035], [0.001, 1.05]]
  ], segs, subDiv), 0, queenMaxH);

  const queenParts = [queenBody];
  const pearlCount = t === 'low' ? 6 : 10;
  const pearlSegs = t === 'low' ? 6 : 10;
  for (let i = 0; i < pearlCount; i++) {
    const ang = (i / pearlCount) * Math.PI * 2;
    const pearl = new THREE.SphereGeometry(0.028, pearlSegs, pearlSegs);
    pearl.scale(0.85, 1.35, 0.85);
    pearl.translate(Math.cos(ang) * 0.192, 0.978, Math.sin(ang) * 0.192);
    applyHeightV(pearl, 0, queenMaxH);
    queenParts.push(pearl);
  }
  const qApex = new THREE.SphereGeometry(0.048, t === 'low' ? 8 : 14, t === 'low' ? 8 : 12);
  qApex.translate(0, 1.088, 0);
  applyHeightV(qApex, 0, queenMaxH);
  queenParts.push(qApex);
  const queen = mergeGeos(queenParts);

  /* 6. Rei (King) — Colarinho Imperial Duplo + Cúpula + Cruz Pattée Chanfrada */
  const kingMaxH = 1.28;
  const kingBody = normalizeLatheV(smoothLathe([
    ...stauntonBaseSections(1.10),
    [[0.207, 0.212], [0.162, 0.42], [0.128, 0.69]],
    [[0.128, 0.69], [0.222, 0.725], [0.175, 0.758], [0.206, 0.786], [0.146, 0.812]],
    [[0.146, 0.812], [0.188, 0.92], [0.224, 1.01], [0.168, 1.055], [0.075, 1.08], [0.001, 1.085]]
  ], segs, subDiv), 0, kingMaxH);
  const kingCross = createKingPatteeCross(t, kingMaxH);
  const king = mergeGeos([kingBody, kingCross]);

  return { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
}

export const PIECE_STYLES = [
  { id: 'staunton', name: '♔ Staunton' },
  { id: 'crystal',  name: '💎 Cristal' },
  { id: 'cyber',    name: '🌆 Cyber Neon' }
];

/* Geometrias 3D Lapidadas (Cristal / Bauhaus Geométrico) */
function createCrystalGeometries() {
  const facet = (geo, maxH) => {
    const out = mergeGeos(Array.isArray(geo) ? geo : [geo]);
    applyHeightV(out, 0, maxH);
    return out;
  };
  const hexBase = (rad = 0.25, h = 0.14) => {
    const g = new THREE.CylinderGeometry(rad * 0.88, rad, h, 6);
    g.translate(0, h / 2, 0);
    return g;
  };

  // Peão: base hexagonal + pirâmide invertida + diamante no topo
  const pBody = new THREE.CylinderGeometry(0.08, 0.19, 0.34, 6); pBody.translate(0, 0.30, 0);
  const pHead = new THREE.OctahedronGeometry(0.135, 0); pHead.translate(0, 0.56, 0);
  const pawn = facet([hexBase(0.22, 0.13), pBody, pHead], 0.70);

  // Torre: monolito prismático octogonal com 4 pilares angulares
  const rCol = new THREE.CylinderGeometry(0.18, 0.21, 0.50, 8); rCol.translate(0, 0.39, 0);
  const rTop = new THREE.CylinderGeometry(0.23, 0.19, 0.12, 8); rTop.translate(0, 0.69, 0);
  const rParts = [hexBase(0.25, 0.14), rCol, rTop];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pil = new THREE.BoxGeometry(0.10, 0.11, 0.10);
    pil.rotateY(a);
    pil.translate(Math.cos(a) * 0.155, 0.80, Math.sin(a) * 0.155);
    rParts.push(pil);
  }
  const rook = facet(rParts, 0.88);

  // Cavalo: escultura geométrica angular em prisma inclinado
  const nNeck = new THREE.CylinderGeometry(0.10, 0.19, 0.42, 6);
  nNeck.rotateX(0.24); nNeck.translate(0, 0.36, -0.02);
  const nHead = new THREE.ConeGeometry(0.14, 0.36, 5);
  nHead.rotateX(Math.PI / 2.2); nHead.translate(0, 0.64, 0.12);
  const nCrest = new THREE.OctahedronGeometry(0.12, 0);
  nCrest.scale(0.65, 1.4, 1.0); nCrest.translate(0, 0.72, -0.04);
  const knight = facet([hexBase(0.25, 0.14), nNeck, nHead, nCrest], 0.90);

  // Bispo: obelisco afilado com cristal suspenso
  const bCol = new THREE.CylinderGeometry(0.09, 0.19, 0.50, 6); bCol.translate(0, 0.39, 0);
  const bMitre = new THREE.OctahedronGeometry(0.16, 0);
  bMitre.scale(0.95, 1.55, 0.95); bMitre.translate(0, 0.76, 0);
  const bishop = facet([hexBase(0.24, 0.14), bCol, bMitre], 1.02);

  // Dama: torre de cristal + coroa hexagonal + estrela octaédrica
  const qCol = new THREE.CylinderGeometry(0.11, 0.21, 0.58, 6); qCol.translate(0, 0.43, 0);
  const qCrown = new THREE.CylinderGeometry(0.23, 0.12, 0.22, 6); qCrown.translate(0, 0.82, 0);
  const qGem = new THREE.OctahedronGeometry(0.13, 0); qGem.translate(0, 1.04, 0);
  const queen = facet([hexBase(0.27, 0.14), qCol, qCrown, qGem], 1.18);

  // Rei: obelisco imperial + prisma duplo + cruz geométrica
  const kCol = new THREE.CylinderGeometry(0.12, 0.22, 0.64, 6); kCol.translate(0, 0.46, 0);
  const kCrown = new THREE.CylinderGeometry(0.24, 0.14, 0.24, 6); kCrown.translate(0, 0.89, 0);
  const kV = new THREE.BoxGeometry(0.06, 0.24, 0.06); kV.translate(0, 1.13, 0);
  const kH = new THREE.BoxGeometry(0.19, 0.06, 0.06); kH.translate(0, 1.15, 0);
  const king = facet([hexBase(0.28, 0.15), kCol, kCrown, kV, kH], 1.28);

  return { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
}

/* Geometrias 3D Cyber Neon (Holograma Futurista com Anéis) */
function createCyberGeometries(tier = 'high') {
  const segs = tier === 'low' ? 12 : 20;
  const pack = (parts, maxH) => {
    const out = mergeGeos(parts);
    applyHeightV(out, 0, maxH);
    return out;
  };
  const discBase = (rad = 0.26) => {
    const b1 = new THREE.CylinderGeometry(rad, rad * 1.06, 0.08, segs); b1.translate(0, 0.04, 0);
    const ring = new THREE.TorusGeometry(rad * 0.85, 0.025, 8, segs);
    ring.rotateX(Math.PI / 2); ring.translate(0, 0.12, 0);
    return [b1, ring];
  };

  // Peão Cyber
  const pCore = new THREE.CylinderGeometry(0.07, 0.15, 0.34, segs); pCore.translate(0, 0.30, 0);
  const pOrb = new THREE.IcosahedronGeometry(0.13, 1); pOrb.translate(0, 0.56, 0);
  const pawn = pack([...discBase(0.22), pCore, pOrb], 0.70);

  // Torre Cyber (núcleo + 2 anéis flutuantes)
  const rCore = new THREE.CylinderGeometry(0.15, 0.18, 0.56, segs); rCore.translate(0, 0.40, 0);
  const rHalo1 = new THREE.TorusGeometry(0.21, 0.032, 8, segs); rHalo1.rotateX(Math.PI / 2); rHalo1.translate(0, 0.62, 0);
  const rHalo2 = new THREE.TorusGeometry(0.22, 0.036, 8, segs); rHalo2.rotateX(Math.PI / 2); rHalo2.translate(0, 0.76, 0);
  const rook = pack([...discBase(0.25), rCore, rHalo1, rHalo2], 0.85);

  // Cavalo Cyber (visor angular futurista)
  const nStem = new THREE.CylinderGeometry(0.11, 0.16, 0.38, segs); nStem.translate(0, 0.31, 0);
  const nVisor = new THREE.BoxGeometry(0.18, 0.24, 0.34);
  nVisor.rotateX(0.3); nVisor.translate(0, 0.62, 0.06);
  const nFin = new THREE.BoxGeometry(0.05, 0.34, 0.12); nFin.translate(0, 0.66, -0.10);
  const knight = pack([...discBase(0.25), nStem, nVisor, nFin], 0.90);

  // Bispo Cyber (haste + anel orbital diagonal + núcleo)
  const bStem = new THREE.CylinderGeometry(0.08, 0.16, 0.56, segs); bStem.translate(0, 0.40, 0);
  const bRing = new THREE.TorusGeometry(0.16, 0.026, 8, segs);
  bRing.rotateX(0.7); bRing.translate(0, 0.78, 0);
  const bCore = new THREE.OctahedronGeometry(0.10, 0); bCore.translate(0, 0.78, 0);
  const bishop = pack([...discBase(0.24), bStem, bRing, bCore], 0.98);

  // Dama Cyber (torre holográfica + duplo halo orbital)
  const qStem = new THREE.CylinderGeometry(0.10, 0.18, 0.68, segs); qStem.translate(0, 0.46, 0);
  const qRing1 = new THREE.TorusGeometry(0.21, 0.025, 8, segs); qRing1.rotateX(Math.PI / 2); qRing1.translate(0, 0.88, 0);
  const qRing2 = new THREE.TorusGeometry(0.17, 0.022, 8, segs); qRing2.rotateX(Math.PI / 3); qRing2.translate(0, 0.96, 0);
  const qOrb = new THREE.IcosahedronGeometry(0.10, 1); qOrb.translate(0, 0.96, 0);
  const queen = pack([...discBase(0.27), qStem, qRing1, qRing2, qOrb], 1.15);

  // Rei Cyber (obelisco + anel imperial + cruz neon)
  const kStem = new THREE.CylinderGeometry(0.11, 0.19, 0.74, segs); kStem.translate(0, 0.50, 0);
  const kRing = new THREE.TorusGeometry(0.22, 0.028, 8, segs); kRing.rotateX(Math.PI / 2); kRing.translate(0, 0.92, 0);
  const kV = new THREE.BoxGeometry(0.06, 0.26, 0.06); kV.translate(0, 1.12, 0);
  const kH = new THREE.BoxGeometry(0.22, 0.06, 0.06); kH.translate(0, 1.14, 0);
  const king = pack([...discBase(0.28), kStem, kRing, kV, kH], 1.28);

  return { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
}

export function createChessGeometriesByStyle(tier = 'high', style = 'staunton') {
  if (style === 'crystal') return createCrystalGeometries();
  if (style === 'cyber') return createCyberGeometries(normalizeTier(tier));
  return createChessGeometries(tier);
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
      const fiber = Math.sin((u * 14 + Math.sin(v * tau * 2.5) * 0.28) * tau);
      const latheGroove = Math.sin(v * tau * 64) * 3.5;
      const sub = Math.sin((u * 28 + v * 2) * tau) * 0.45;
      return 238 + fiber * 11 + latheGroove + sub * 5 + (rngM() - 0.5) * 5;
    });
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const fiber = Math.sin((u * 14 + Math.sin(v * tau * 2.5) * 0.28) * tau);
      const latheGroove = Math.sin(v * tau * 64) * 10;
      return 128 + fiber * 22 + latheGroove + (rngB() - 0.5) * 14;
    });
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const fiber = Math.sin((u * 14 + Math.sin(v * tau * 2.5) * 0.28) * tau);
      return 216 - fiber * 24 + (rngR() - 0.5) * 16;
    });
  } else if (k === 'ivory') {
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, (u, v) => {
      const vein = Math.sin((u * 3 + v * 5 + Math.sin(u * tau * 2) * 0.3) * tau);
      return 246 + vein * 6 + (rngM() - 0.5) * 3;
    });
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const vein = Math.sin((u * 3 + v * 5) * tau);
      const turn = Math.sin(v * tau * 52) * 6;
      return 128 + vein * 11 + turn + (rngB() - 0.5) * 8;
    });
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const sheen = Math.cos((u * 2 + v * 4) * tau);
      return 224 + sheen * 14 + (rngR() - 0.5) * 10;
    });
  } else if (k === 'metal') {
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, (u, v) => {
      const band = Math.sin(v * tau * 48) * 6 + Math.cos(u * tau * 2) * 3;
      return 240 + band + (rngM() - 0.5) * 6;
    });
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const brush = Math.sin(v * tau * 48) * 20;
      return 128 + brush + (rngB() - 0.5) * 12;
    });
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, (u, v) => {
      const brush = Math.sin(v * tau * 48) * 24 + Math.sin(u * tau * 3) * 6;
      return 216 + brush + (rngR() - 0.5) * 16;
    });
  } else {
    map = makePieceCanvasTex(size, THREE.SRGBColorSpace, anisotropy, () => 250 + (rngM() - 0.5) * 5);
    bumpMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, () => 128 + (rngB() - 0.5) * 14);
    roughnessMap = makePieceCanvasTex(size, THREE.NoColorSpace, anisotropy, () => 242 + (rngR() - 0.5) * 12);
  }

  const set = { map, bumpMap, roughnessMap };
  _pieceTexCache.set(cacheKey, set);
  return set;
}

export function newPieceMaterial(colorHex, theme, tier = 'high', style = 'staunton', color = 'w') {
  const t = normalizeTier(tier);
  const isMetal = !!theme?.metal;
  const texKind = theme?.tex || (isMetal ? 'metal' : 'wood');
  const isMatte = texKind === 'matte';

  if (style === 'crystal') {
    return new THREE.MeshPhysicalMaterial({
      color: colorHex,
      flatShading: true,
      roughness: 0.08,
      metalness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: 0.90
    });
  }

  if (style === 'cyber') {
    const neonHex = color === 'w' ? 0x00F0FF : 0xFF2E93;
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: new THREE.Color(neonHex),
      emissiveIntensity: 0.45,
      roughness: 0.18,
      metalness: 0.80,
      transparent: true,
      opacity: 0.92
    });
  }

  if (t === 'low') {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      vertexColors: true,
      roughness: isMetal ? 0.28 : (isMatte ? 0.52 : 0.38),
      metalness: isMetal ? 0.84 : 0.08
    });
  }

  const tex = getPieceTextures(texKind, t);
  const texMaps = tex ? { map: tex.map, bumpMap: tex.bumpMap, roughnessMap: tex.roughnessMap } : {};

  if (isMetal) {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      vertexColors: true,
      roughness: 0.22,
      metalness: 0.90,
      ...texMaps,
      bumpScale: tex ? 0.0065 : 0
    });
  }

  if (isMatte) {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.04,
      ...texMaps,
      bumpScale: tex ? 0.0035 : 0
    });
  }

  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    vertexColors: true,
    roughness: texKind === 'ivory' ? 0.22 : 0.28,
    metalness: 0.06,
    clearcoat: t === 'high' ? 0.78 : 0.48,
    clearcoatRoughness: texKind === 'ivory' ? 0.14 : 0.18,
    ...texMaps,
    bumpScale: tex ? (texKind === 'ivory' ? 0.0045 : 0.0085) : 0
  });
}

export function createPieceMesh(type, color, geos, theme, tier = 'high', style = 'staunton') {
  const t = normalizeTier(tier);
  const resolvedTheme = theme || PIECE_THEMES[0];
  const colorHex = color === 'w' ? resolvedTheme.w : resolvedTheme.b;
  const mat = newPieceMaterial(colorHex, resolvedTheme, t, style, color);
  const mesh = new THREE.Mesh(geos[type], mat);
  mesh.castShadow = t !== 'low';
  mesh.receiveShadow = t !== 'low';
  if (type === 'n' && color === 'b') mesh.rotation.y = Math.PI;
  return mesh;
}

export function makeChessPiece(scene, geos, type, color, r, c, theme, tier = 'high', style = 'staunton') {
  const mesh = createPieceMesh(type, color, geos, theme, tier, style);
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
  const style = ctx.style || 'staunton';
  const resolvedTheme = typeof theme === 'number'
    ? (PIECE_THEMES[theme] || PIECE_THEMES[0])
    : (theme || PIECE_THEMES[0]);
  const { all } = resolveMeshList(ctx);

  for (const mesh of all) {
    const pieceInfo = mesh.userData?.piece;
    const color = pieceInfo?.color || 'w';
    const colorHex = color === 'w' ? resolvedTheme.w : resolvedTheme.b;
    const oldMat = mesh.material;
    const nextMat = newPieceMaterial(colorHex, resolvedTheme, t, style, color);

    if (style === 'staunton' && oldMat && oldMat.emissiveIntensity > 0 && nextMat.emissive) {
      nextMat.emissive.copy(oldMat.emissive);
      nextMat.emissiveIntensity = oldMat.emissiveIntensity;
    }

    mesh.material = nextMat;
    if (oldMat && typeof oldMat.dispose === 'function') oldMat.dispose();
  }
}

export function setPieceQuality(tier, ctx = {}) {
  const t = normalizeTier(tier);
  const style = ctx.style || 'staunton';
  const { all, captured } = resolveMeshList(ctx);
  const theme = ctx.theme || ctx.pieceTheme || PIECE_THEMES[0];

  if (all.length > 0) {
    applyPieceTheme(theme, t, { ...ctx, style });
  }

  for (const mesh of all) {
    mesh.castShadow = t !== 'low';
    mesh.receiveShadow = t !== 'low';
  }
  for (const mesh of captured) {
    mesh.visible = t !== 'low';
  }

  if (ctx.geos) {
    const newGeos = createChessGeometriesByStyle(t, style);
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

/* Inclina/tomba o Rei derrotado a ~78 graus no Xeque-Mate */
export async function animateKingTopple(kingPiece) {
  if (!kingPiece || !kingPiece.mesh) return;
  const m = kingPiece.mesh;
  const tiltAngle = 1.36; // ~78°
  await tween(620, k => {
    const e = easeIO(k);
    m.rotation.z = tiltAngle * e;
    m.position.y = Math.sin(e * Math.PI) * 0.06;
  });
}

/* Animação cinematográfica de entrada das peças ao iniciar partida */
export function animatePiecesIntro(pieceMeshes = []) {
  for (let i = 0; i < pieceMeshes.length; i++) {
    const p = pieceMeshes[i];
    if (!p || !p.mesh) continue;
    const delay = (p.r * 22) + (p.c * 14);
    const startY = 1.8 + (i % 4) * 0.25;
    p.mesh.position.y = startY;
    setTimeout(() => {
      if (!p.mesh) return;
      tween(340, k => {
        const e = 1 - Math.pow(1 - k, 3);
        p.mesh.position.y = startY * (1 - e);
      }).then(() => {
        if (p.mesh) p.mesh.position.y = 0;
      });
    }, delay);
  }
}
