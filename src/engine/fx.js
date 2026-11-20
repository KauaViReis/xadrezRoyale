import * as THREE from 'three';
import { worldPos } from './board3d.js';

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
    this.checkMark = null;
    this.particles = [];
  }

  setQuality(tier) {
    this.qualityTier = tier;
    this.particleScale = tier === 'low' ? 0.25 : (tier === 'medium' ? 0.6 : 1);
  }

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
    m.userData = { ph: Math.random() * 6, isCapture };
    this.fxGroup.add(m);
    this.indicators.push(m);
  }

  clearIndicators() {
    for (const m of this.indicators) {
      this.fxGroup.remove(m);
      if (m.material) m.material.dispose();
    }
    this.indicators = [];
  }

  setLastMove(fromR, fromC, toR, toC) {
    this.clearLastMove();
    for (const [r, c] of [[fromR, fromC], [toR, toC]]) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xC99A3E, transparent: true, opacity: 0.22, depthWrite: false
      });
      const m = new THREE.Mesh(this.markGeo, mat);
      m.rotation.x = -Math.PI / 2;
      const p = worldPos(r, c);
      m.position.set(p.x, 0.012, p.z);
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

  setCheckSquare(r, c) {
    this.clearCheckSquare();
    if (r === null || r === undefined) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xD1493F, transparent: true, opacity: 0.45, depthWrite: false
    });
    const m = new THREE.Mesh(this.markGeo, mat);
    m.rotation.x = -Math.PI / 2;
    const p = worldPos(r, c);
    m.position.set(p.x, 0.015, p.z);
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
        maxLife: 0.45 + Math.random() * 0.25
      };
      this.scene.add(m);
      this.particles.push(m);
    }
  }

  update(time, dt) {
    for (const m of this.indicators) {
      m.material.opacity = (m.userData.isCapture ? 0.58 : 0.52) + 0.18 * Math.sin(time * 4.5 + m.userData.ph);
    }
    if (this.checkMark) {
      this.checkMark.material.opacity = 0.32 + 0.22 * Math.sin(time * 6);
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
      v.y -= 13 * dt;
      const alpha = 1 - p.userData.life / p.userData.maxLife;
      p.material.opacity = alpha;
      p.scale.setScalar(alpha);
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }
}
