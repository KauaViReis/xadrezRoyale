import * as THREE from 'three';
import { worldPos } from './board3d.js';
import { squareToRC } from '../core/chess-engine.js';

export const FX_ANNOTATION_COLORS = {
  green:  0x2ECC71,
  red:    0xE74C3C,
  blue:   0x3B82F6,
  yellow: 0xF1C40F
};

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function resolveRC(sqOrR, maybeC) {
  if (typeof sqOrR === 'string') return squareToRC(sqOrR);
  if (sqOrR && typeof sqOrR === 'object' && typeof sqOrR.r === 'number' && typeof sqOrR.c === 'number') {
    return { r: sqOrR.r, c: sqOrR.c };
  }
  if (typeof sqOrR === 'number' && typeof maybeC === 'number') {
    return { r: sqOrR, c: maybeC };
  }
  return null;
}

function isValidRC(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r <= 7 && c >= 0 && c <= 7;
}

function resolveColorHex(colorKey) {
  if (typeof colorKey === 'number') return colorKey;
  return FX_ANNOTATION_COLORS[colorKey] ?? FX_ANNOTATION_COLORS.green;
}

export class FXManager {
  constructor(scene) {
    this.scene = scene;
    this.fxGroup = new THREE.Group();
    scene.add(this.fxGroup);

    this.qualityTier = 'high';
    this.particleScale = 1;

    this.dotGeo = new THREE.CircleGeometry(0.16, 24);
    this.ringGeo = new THREE.RingGeometry(0.36, 0.45, 32);
    this.markGeo = new THREE.PlaneGeometry(0.96, 0.96);
    this.particleGeo = new THREE.BoxGeometry(0.045, 0.045, 0.045);

    this.indicators = [];
    this.lastMarks = [];
    this.premoveMarks = [];
    this.checkMark = null;
    this.particles = [];

    this.manualMarks = new Map();
    this.manualArrows = new Map();
    this.previewArrow = null;

    this.hintGroup = new THREE.Group();
    this.fxGroup.add(this.hintGroup);
    this.hintState = null;
    this._hintGeos = null;
    this._hintTheme = null;
  }

  setQuality(tier) {
    this.qualityTier = tier;
    this.particleScale = tier === 'low' ? 0.25 : (tier === 'medium' ? 0.6 : 1);
  }

  /* ==================== MOVE INDICATORS (y = 0.018, rO = 4) ==================== */
  addMoveDot(r, c, isCapture = false) {
    const mat = new THREE.MeshBasicMaterial({
      color: isCapture ? 0xD1493F : 0xC99A3E,
      transparent: true,
      opacity: isCapture ? 0.72 : 0.65,
      depthWrite: false
    });
    const m = new THREE.Mesh(isCapture ? this.ringGeo : this.dotGeo, mat);
    m.rotation.x = -Math.PI / 2;
    const p = worldPos(r, c);
    m.position.set(p.x, 0.018, p.z);
    m.renderOrder = 4;
    m.userData = { ph: Math.random() * 6, isCapture, sharedGeo: true };
    this.fxGroup.add(m);
    this.indicators.push(m);
  }

  clearIndicators() {
    for (const m of this.indicators) {
      this.fxGroup.remove(m);
      if (m.material) m.material.dispose();
    }
    this.indicators = [];
    this.clearDragRing();
  }

  setDragRing(r, c, isCapture = false) {
    if (!isValidRC(r, c)) { this.clearDragRing(); return; }
    if (!this.dragRing) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00F0FF,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      this.dragRing = new THREE.Mesh(this.ringGeo, mat);
      this.dragRing.rotation.x = -Math.PI / 2;
      this.dragRing.renderOrder = 6;
      this.dragRing.userData = { sharedGeo: true };
      this.fxGroup.add(this.dragRing);
    }
    const p = worldPos(r, c);
    this.dragRing.position.set(p.x, 0.024, p.z);
    this.dragRing.material.color.setHex(isCapture ? 0xEF4444 : 0x00F0FF);
    this.dragRing.visible = true;
  }

  clearDragRing() {
    if (this.dragRing) this.dragRing.visible = false;
  }

  /* ==================== LAST MOVE (y = 0.012, rO = 1) ==================== */
  setLastMove(fromR, fromC, toR, toC) {
    this.clearLastMove();
    for (const [r, c] of [[fromR, fromC], [toR, toC]]) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xC99A3E,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      });
      const m = new THREE.Mesh(this.markGeo, mat);
      m.rotation.x = -Math.PI / 2;
      const p = worldPos(r, c);
      m.position.set(p.x, 0.012, p.z);
      m.renderOrder = 1;
      m.userData = { sharedGeo: true };
      this.fxGroup.add(m);
      this.lastMarks.push(m);
    }
  }

  clearLastMove() {
    for (const m of this.lastMarks) {
      this.fxGroup.remove(m);
      if (m.material) m.material.dispose();
    }
    this.lastMarks = [];
  }

  /* ==================== PREMOVE (y = 0.013, rO = 2) ==================== */
  setPremove(fr, fc, tr, tc) {
    this.clearPremove();
    let coords;
    if (typeof fr === 'string' && typeof fc === 'string') {
      const a = squareToRC(fr);
      const b = squareToRC(fc);
      coords = [[a.r, a.c], [b.r, b.c]];
    } else {
      if ([fr, fc, tr, tc].some(v => v === null || v === undefined)) return;
      coords = [[fr, fc], [tr, tc]];
    }
    for (const [r, c] of coords) {
      if (!isValidRC(r, c)) continue;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6C5CE7,
        transparent: true,
        opacity: 0.36,
        depthWrite: false
      });
      const m = new THREE.Mesh(this.markGeo, mat);
      m.rotation.x = -Math.PI / 2;
      const p = worldPos(r, c);
      m.position.set(p.x, 0.013, p.z);
      m.renderOrder = 2;
      m.userData = { sharedGeo: true };
      this.fxGroup.add(m);
      this.premoveMarks.push(m);
    }
  }

  clearPremove() {
    for (const m of this.premoveMarks) {
      this.fxGroup.remove(m);
      if (m.material) m.material.dispose();
    }
    this.premoveMarks = [];
  }

  /* ==================== CHECK SQUARE (y = 0.015, rO = 3) ==================== */
  setCheckSquare(r, c) {
    this.clearCheckSquare();
    if (r === null || r === undefined) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xD1493F,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const m = new THREE.Mesh(this.markGeo, mat);
    m.rotation.x = -Math.PI / 2;
    const p = worldPos(r, c);
    m.position.set(p.x, 0.015, p.z);
    m.renderOrder = 3;
    m.userData = { sharedGeo: true };
    this.fxGroup.add(m);
    this.checkMark = m;
  }

  clearCheckSquare() {
    if (this.checkMark) {
      this.fxGroup.remove(this.checkMark);
      if (this.checkMark.material) this.checkMark.material.dispose();
      this.checkMark = null;
    }
  }

  /* ==================== MANUAL ANNOTATIONS (y = 0.021..0.032, rO = 5..7) ==================== */
  toggleManualMark(r, c, colorKey = 'green') {
    if (!isValidRC(r, c)) return false;
    const hex = resolveColorHex(colorKey);
    const key = `${r},${c}`;
    const existing = this.manualMarks.get(key);
    if (existing) {
      if (existing.colorKey === colorKey) {
        this.fxGroup.remove(existing.mesh);
        if (existing.mesh.material) existing.mesh.material.dispose();
        this.manualMarks.delete(key);
        return false;
      }
      existing.mesh.material.color.setHex(hex);
      existing.colorKey = colorKey;
      return true;
    }

    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    const m = new THREE.Mesh(this.markGeo, mat);
    m.rotation.x = -Math.PI / 2;
    const p = worldPos(r, c);
    m.position.set(p.x, 0.021, p.z);
    m.renderOrder = 5;
    m.userData = { sharedGeo: true };
    this.fxGroup.add(m);
    this.manualMarks.set(key, { mesh: m, colorKey });
    return true;
  }

  _createFlatArrowMesh(fr, fc, tr, tc, hex, y, opacity, renderOrder, widthScale = 1) {
    const from = worldPos(fr, fc);
    const to = worldPos(tr, tc);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return null;

    const startOffset = Math.min(0.22, len * 0.2);
    const endInset = Math.min(0.12, len * 0.12);
    const arrowEnd = Math.max(startOffset + 0.18, len - endInset);
    const headLen = Math.min(0.34 * Math.max(0.75, widthScale), (arrowEnd - startOffset) * 0.48);
    const shaftEnd = arrowEnd - headLen;
    const shaftHalf = 0.075 * widthScale;
    const headHalf = 0.21 * widthScale;

    const shape = new THREE.Shape();
    shape.moveTo(startOffset, -shaftHalf);
    shape.lineTo(shaftEnd, -shaftHalf);
    shape.lineTo(shaftEnd, -headHalf);
    shape.lineTo(arrowEnd, 0);
    shape.lineTo(shaftEnd, headHalf);
    shape.lineTo(shaftEnd, shaftHalf);
    shape.lineTo(startOffset, shaftHalf);
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(from.x, y, from.z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  toggleManualArrow(fr, fc, tr, tc, colorKey = 'green') {
    if (!isValidRC(fr, fc) || !isValidRC(tr, tc)) return false;
    if (fr === tr && fc === tc) return false;
    const hex = resolveColorHex(colorKey);
    const key = `${fr},${fc}->${tr},${tc}`;
    const existing = this.manualArrows.get(key);
    if (existing) {
      if (existing.colorKey === colorKey) {
        this.fxGroup.remove(existing.mesh);
        if (existing.mesh.geometry) existing.mesh.geometry.dispose();
        if (existing.mesh.material) existing.mesh.material.dispose();
        this.manualArrows.delete(key);
        return false;
      }
      existing.mesh.material.color.setHex(hex);
      existing.colorKey = colorKey;
      return true;
    }

    const y = 0.026 + (this.manualArrows.size % 7) * 0.001;
    const mesh = this._createFlatArrowMesh(fr, fc, tr, tc, hex, y, 0.78, 6, 1);
    if (!mesh) return false;
    this.fxGroup.add(mesh);
    this.manualArrows.set(key, { mesh, colorKey });
    return true;
  }

  setManualPreviewArrow(fr, fc, tr, tc, colorKey = 'green') {
    this.clearManualPreviewArrow();
    if (!isValidRC(fr, fc) || !isValidRC(tr, tc)) return;
    if (fr === tr && fc === tc) return;
    const hex = resolveColorHex(colorKey);
    const mesh = this._createFlatArrowMesh(fr, fc, tr, tc, hex, 0.031, 0.52, 7, 1);
    if (!mesh) return;
    this.fxGroup.add(mesh);
    this.previewArrow = { mesh, key: `${fr},${fc}->${tr},${tc}` };
  }

  clearManualPreviewArrow() {
    if (this.previewArrow) {
      const m = this.previewArrow.mesh;
      this.fxGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
      this.previewArrow = null;
    }
  }

  clearManualAnnotations() {
    for (const { mesh } of this.manualMarks.values()) {
      this.fxGroup.remove(mesh);
      if (mesh.material) mesh.material.dispose();
    }
    this.manualMarks.clear();

    for (const { mesh } of this.manualArrows.values()) {
      this.fxGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    this.manualArrows.clear();

    this.clearManualPreviewArrow();
  }

  /* ==================== 3D HINT FX (y = 0.036+, rO = 8..10) ==================== */
  setHintAssets(geos, pieceTheme = null) {
    this._hintGeos = geos || null;
    this._hintTheme = pieceTheme || null;
  }

  setHint(opts = {}) {
    this.clearHint();
    if (!opts) return;
    if (opts.geos) this._hintGeos = opts.geos;
    if (opts.pieceTheme) this._hintTheme = opts.pieceTheme;

    const fromRC = resolveRC(opts.from);
    const toRC = resolveRC(opts.to);
    if (!fromRC || !toRC) return;

    const fromPos = worldPos(fromRC.r, fromRC.c);
    const toPos = worldPos(toRC.r, toRC.c);
    const dist = Math.hypot(toPos.x - fromPos.x, toPos.z - fromPos.z);

    /* Origin & target subtle glowing rings (y = 0.036, rO = 8) */
    const padMats = [];
    for (const [pos, col] of [[fromPos, 0xF5C451], [toPos, 0x10B981]]) {
      const padMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.72,
        depthWrite: false
      });
      const pad = new THREE.Mesh(this.ringGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(pos.x, 0.036, pos.z);
      pad.renderOrder = 8;
      pad.userData = { sharedGeo: true };
      this.hintGroup.add(pad);
      padMats.push(padMat);
    }

    /* 3D arched gold-emerald Tube + Cone arrowhead (rO = 9) */
    const p0 = new THREE.Vector3(fromPos.x, 0.05, fromPos.z);
    const p1 = new THREE.Vector3(toPos.x, 0.16, toPos.z);
    const arcHeight = 0.48 + Math.min(0.45, dist * 0.09);
    const pMid = new THREE.Vector3((fromPos.x + toPos.x) * 0.5, arcHeight, (fromPos.z + toPos.z) * 0.5);
    const curve = new THREE.QuadraticBezierCurve3(p0, pMid, p1);

    const tubularSegments = 24;
    const radialSegments = 10;
    const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.068, radialSegments, false);
    const tubePosCount = tubeGeo.attributes.position.count;
    const tubeColors = new Float32Array(tubePosCount * 3);
    const gold = new THREE.Color(0xF5C451);
    const emerald = new THREE.Color(0x10B981);
    const tmpColor = new THREE.Color();
    const ringVerts = radialSegments + 1;
    for (let i = 0; i < tubePosCount; i++) {
      const segIdx = Math.min(tubularSegments, Math.floor(i / ringVerts));
      const u = segIdx / tubularSegments;
      tmpColor.lerpColors(gold, emerald, u);
      tubeColors[i * 3] = tmpColor.r;
      tubeColors[i * 3 + 1] = tmpColor.g;
      tubeColors[i * 3 + 2] = tmpColor.b;
    }
    tubeGeo.setAttribute('color', new THREE.BufferAttribute(tubeColors, 3));

    const arrowMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: 0x16A34A,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });

    const tubeMesh = new THREE.Mesh(tubeGeo, arrowMat);
    tubeMesh.renderOrder = 9;
    this.hintGroup.add(tubeMesh);

    const coneGeo = new THREE.ConeGeometry(0.175, 0.36, 14);
    const conePosCount = coneGeo.attributes.position.count;
    const coneColors = new Float32Array(conePosCount * 3);
    for (let i = 0; i < conePosCount; i++) {
      coneColors[i * 3] = emerald.r;
      coneColors[i * 3 + 1] = emerald.g;
      coneColors[i * 3 + 2] = emerald.b;
    }
    coneGeo.setAttribute('color', new THREE.BufferAttribute(coneColors, 3));

    const tangent = curve.getTangent(1).normalize();
    const coneMesh = new THREE.Mesh(coneGeo, arrowMat);
    coneMesh.quaternion.setFromUnitVectors(UP_AXIS, tangent);
    coneMesh.position.copy(p1).addScaledVector(tangent, 0.05);
    coneMesh.renderOrder = 9;
    this.hintGroup.add(coneMesh);

    /* Translucent ghost piece at target square (rO = 10) */
    const ghostType = opts.promotion || opts.pieceType;
    const geos = opts.geos || this._hintGeos;
    let ghostMat = null;
    let ghostMesh = null;
    if (ghostType && geos && geos[ghostType]) {
      ghostMat = new THREE.MeshStandardMaterial({
        color: 0x34D399,
        emissive: 0xC99A3E,
        emissiveIntensity: 0.38,
        transparent: true,
        opacity: 0.48,
        roughness: 0.22,
        metalness: 0.12,
        depthWrite: false
      });
      ghostMesh = new THREE.Mesh(geos[ghostType], ghostMat);
      ghostMesh.userData = { sharedGeo: true };
      ghostMesh.position.set(toPos.x, 0.04, toPos.z);
      if (ghostType === 'n' && opts.color === 'b') {
        ghostMesh.rotation.y = Math.PI;
      }
      ghostMesh.renderOrder = 10;
      this.hintGroup.add(ghostMesh);
    }

    /* Subtle PV continuation arrows (pv.slice(1)) */
    if (Array.isArray(opts.pv) && opts.pv.length > 1) {
      const opacities = [0.42, 0.28, 0.18];
      for (let i = 1; i < Math.min(opts.pv.length, 4); i++) {
        const step = opts.pv[i];
        if (!step || !step.from || !step.to) continue;
        const sFrom = resolveRC(step.from);
        const sTo = resolveRC(step.to);
        if (!sFrom || !sTo || (sFrom.r === sTo.r && sFrom.c === sTo.c)) continue;
        const tint = i % 2 === 1 ? 0x60A5FA : 0x34D399;
        const op = opacities[i - 1] ?? 0.18;
        const pvMesh = this._createFlatArrowMesh(
          sFrom.r, sFrom.c, sTo.r, sTo.c,
          tint, 0.037 + i * 0.0015, op, 8, 0.65
        );
        if (pvMesh) this.hintGroup.add(pvMesh);
      }
    }

    this.hintState = { arrowMat, ghostMat, ghostMesh, padMats };
  }

  clearHint() {
    const children = [...this.hintGroup.children];
    const disposedMats = new Set();
    for (const child of children) {
      this.hintGroup.remove(child);
      if (child.geometry && !child.userData?.sharedGeo && typeof child.geometry.dispose === 'function') {
        child.geometry.dispose();
      }
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m && !disposedMats.has(m) && typeof m.dispose === 'function') {
          disposedMats.add(m);
          m.dispose();
        }
      }
    }
    this.hintState = null;
  }

  clearAll() {
    this.clearIndicators();
    this.clearLastMove();
    this.clearPremove();
    this.clearCheckSquare();
    this.clearManualAnnotations();
    this.clearHint();
  }

  setWeather(type = 'none') {
    this.weatherType = type || 'none';
  }

  /* ==================== PARTICLES & FRAME UPDATE ==================== */
  spawnParticles(r, c, colorHex, baseCount = 12) {
    const count = Math.max(2, Math.round(baseCount * this.particleScale));
    const origin = worldPos(r, c);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
      const m = new THREE.Mesh(this.particleGeo, mat);
      m.position.set(origin.x, 0.16, origin.z);
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 1.6 + Math.random() * 2.2;
      m.userData = {
        vel: new THREE.Vector3(Math.cos(ang) * spd, 2.5 + Math.random() * 2.5, Math.sin(ang) * spd),
        life: 0,
        maxLife: 0.45 + Math.random() * 0.25,
        gravity: -13
      };
      this.scene.add(m);
      this.particles.push(m);
    }
  }

  update(time, dt) {
    for (const m of this.indicators) {
      m.material.opacity = (m.userData.isCapture ? 0.58 : 0.52) + 0.18 * Math.sin(time * 4.5 + m.userData.ph);
    }
    if (this.premoveMarks.length > 0) {
      const pOp = 0.30 + 0.10 * Math.sin(time * 3.8);
      for (const m of this.premoveMarks) m.material.opacity = pOp;
    }
    if (this.checkMark) {
      this.checkMark.material.opacity = 0.32 + 0.22 * Math.sin(time * 6);
    }
    if (this.hintState) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
      this.hintState.arrowMat.emissiveIntensity = 0.45 + 0.35 * pulse;
      for (const pm of this.hintState.padMats) {
        pm.opacity = 0.52 + 0.28 * pulse;
      }
      if (this.hintState.ghostMesh && this.hintState.ghostMat) {
        const hover = 0.5 + 0.5 * Math.sin(time * 3.2);
        this.hintState.ghostMesh.position.y = 0.04 + 0.045 * hover;
        this.hintState.ghostMat.opacity = 0.38 + 0.16 * hover;
      }
    }

    /* Clima atmosférico por tema (desativado no tier low) */
    const wType = this.weatherType || 'none';
    const wChance = this.qualityTier === 'low' ? 0 : (this.qualityTier === 'medium' ? 0.10 : 0.22);
    if (wType !== 'none' && this.particles.length < 70 && Math.random() < wChance) {
      let col = 0xE6C88A;
      let vy = 0.12 + Math.random() * 0.18;
      if (wType === 'shimmer') {
        col = 0xDCE8F5;
        vy = -0.15 - Math.random() * 0.15;
      } else if (wType === 'vice') {
        col = Math.random() < 0.5 ? 0xFF5FA2 : 0x27D8E8;
        vy = 0.22 + Math.random() * 0.25;
      }
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false });
      const m = new THREE.Mesh(this.particleGeo, mat);
      m.position.set((Math.random() - 0.5) * 14, 0.2 + Math.random() * 4.5, (Math.random() - 0.5) * 14);
      m.scale.setScalar(0.55);
      m.userData = {
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.35, vy, (Math.random() - 0.5) * 0.35),
        life: 0,
        maxLife: 2.8 + Math.random() * 2.2,
        gravity: 0
      };
      this.scene.add(m);
      this.particles.push(m);
    }

    if (this.particles.length === 0) return;
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.userData.life += dt;
      if (p.userData.life >= p.userData.maxLife) {
        this.scene.remove(p);
        if (p.material) p.material.dispose();
        continue;
      }
      const v = p.userData.vel;
      p.position.x += v.x * dt;
      p.position.y += v.y * dt;
      p.position.z += v.z * dt;
      const g = p.userData.gravity !== undefined ? p.userData.gravity : -13;
      v.y += g * dt;
      const alpha = 1 - p.userData.life / p.userData.maxLife;
      p.material.opacity = alpha;
      p.scale.setScalar(alpha);
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }
}
