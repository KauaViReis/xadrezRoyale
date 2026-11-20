/* ============================================================
   XADREZ ROYALE — Peças Staunton 3D Esculpidas
   Geometrias compartilhadas por tipo (p, r, n, b, q, k) + LOD
   ============================================================ */

import * as THREE from 'three';
import { worldPos } from './board3d.js';
import { tween, easeIO } from '../core/utils.js';

function lathe(pts, segs = 28) {
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

/* Merge simples de BufferGeometries estáticas (sem index) para manter 1 draw call por peça */
function mergeGeos(geos) {
  const nonIndexed = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let totalVerts = 0;
  for (const g of nonIndexed) totalVerts += g.attributes.position.count;

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  let offset = 0;

  for (const g of nonIndexed) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    pos.set(p, offset);
    norm.set(n, offset);
    offset += p.length;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return merged;
}

export function createChessGeometries(tier = 'high') {
  const segs = tier === 'low' ? 18 : 28;

  /* 1. Peão (Pawn) */
  const pawn = lathe([
    [0.001, 0], [0.27, 0], [0.28, 0.05], [0.22, 0.09],
    [0.14, 0.16], [0.09, 0.36], [0.16, 0.40], [0.09, 0.43],
    [0.14, 0.52], [0.12, 0.62], [0.001, 0.67]
  ], segs);

  /* 2. Torre (Rook) */
  const rookBase = lathe([
    [0.001, 0], [0.30, 0], [0.31, 0.06], [0.24, 0.11],
    [0.19, 0.20], [0.16, 0.56], [0.24, 0.62], [0.24, 0.75],
    [0.16, 0.75], [0.16, 0.69], [0.001, 0.69]
  ], segs);
  const battlementParts = [rookBase];
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    const b = new THREE.BoxGeometry(0.11, 0.08, 0.08);
    b.translate(Math.cos(ang) * 0.20, 0.79, Math.sin(ang) * 0.20);
    b.rotateY(-ang);
    battlementParts.push(b);
  }
  const rook = mergeGeos(battlementParts);

  /* 3. Cavalo (Knight) */
  const knightBase = lathe([
    [0.001, 0], [0.30, 0], [0.31, 0.06], [0.23, 0.12],
    [0.18, 0.20], [0.001, 0.21]
  ], segs);
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
  const knight = mergeGeos([knightBase, head]);

  /* 4. Bispo (Bishop) */
  const bishop = lathe([
    [0.001, 0], [0.29, 0], [0.30, 0.06], [0.22, 0.11],
    [0.14, 0.22], [0.10, 0.52], [0.17, 0.56], [0.11, 0.59],
    [0.15, 0.72], [0.11, 0.84], [0.04, 0.90], [0.06, 0.94], [0.001, 0.96]
  ], segs);

  /* 5. Dama (Queen) */
  const queenBody = lathe([
    [0.001, 0], [0.33, 0], [0.34, 0.07], [0.25, 0.13],
    [0.17, 0.26], [0.12, 0.66], [0.21, 0.72], [0.14, 0.75],
    [0.21, 0.92], [0.14, 0.94], [0.08, 1.02], [0.001, 1.05]
  ], segs);
  const qSphere = new THREE.SphereGeometry(0.055, 12, 10);
  qSphere.translate(0, 1.09, 0);
  const queen = mergeGeos([queenBody, qSphere]);

  /* 6. Rei (King) */
  const kingBody = lathe([
    [0.001, 0], [0.35, 0], [0.36, 0.07], [0.26, 0.14],
    [0.18, 0.28], [0.13, 0.72], [0.22, 0.78], [0.15, 0.82],
    [0.21, 0.98], [0.16, 1.04], [0.001, 1.06]
  ], segs);
  const crossV = new THREE.BoxGeometry(0.055, 0.20, 0.055);
  crossV.translate(0, 1.15, 0);
  const crossH = new THREE.BoxGeometry(0.16, 0.055, 0.055);
  crossH.translate(0, 1.18, 0);
  const king = mergeGeos([kingBody, crossV, crossH]);

  return { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
}

export function newPieceMaterial(colorHex, theme, tier = 'high') {
  const isMetal = !!theme?.metal;
  if (tier === 'low') {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: isMetal ? 0.30 : 0.42,
      metalness: isMetal ? 0.82 : 0.06
    });
  }
  if (isMetal) {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.24,
      metalness: 0.88
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    roughness: 0.32,
    metalness: 0.06,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22
  });
}

export function makeChessPiece(scene, geos, type, color, r, c, theme, tier = 'high') {
  const mat = newPieceMaterial(color === 'w' ? theme.w : theme.b, theme, tier);
  const mesh = new THREE.Mesh(geos[type], mat);
  mesh.castShadow = tier !== 'low';
  mesh.receiveShadow = tier !== 'low';
  const pos = worldPos(r, c);
  mesh.position.set(pos.x, 0, pos.z);
  /* Pretas olham para o lado oposto (importante para o Cavalo) */
  if (type === 'n' && color === 'b') mesh.rotation.y = Math.PI;
  scene.add(mesh);
  const piece = { mesh, type, color, r, c };
  mesh.userData.piece = piece;
  return piece;
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
