import * as THREE from 'three';
import { clamp, tween, easeIO } from '../core/utils.js';

export class CameraController {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.theta = 0;
    this.phi = 0.92;
    this.radius = 11.4;
    this.target = new THREE.Vector3(0, -0.05, 0);
    this.minRadius = 6.2;
    this.maxRadius = 32;
    this.topDown = false;
    this.savedPhi = this.phi;
    this.savedRadius = this.radius;

    this.pointers = new Map();
    this.dragging = false;
    this.downX = 0;
    this.downY = 0;
    this.moved = 0;
    this.pinchD = 0;
    this.onTap = null;

    this._bind();
    this.sync();
  }

  sync() {
    const t = this.target;
    this.camera.position.set(
      t.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta),
      t.y + this.radius * Math.cos(this.phi),
      t.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta)
    );
    this.camera.lookAt(t);
  }

  fitRadius(margin = 1.08, phi = this.phi) {
    const half = 4.65;
    const corners = [[-half, -half], [half, -half], [-half, half], [half, half]];
    const v = new THREE.Vector3();
    const lim = 1 / margin;
    const t = this.target;
    const saved = this.camera.position.clone();
    const fits = rad => {
      this.camera.position.set(
        t.x + rad * Math.sin(phi) * Math.sin(this.theta),
        t.y + rad * Math.cos(phi),
        t.z + rad * Math.sin(phi) * Math.cos(this.theta)
      );
      this.camera.lookAt(t);
      this.camera.updateMatrixWorld();
      for (const [x, z] of corners) {
        v.set(x, 0, z).project(this.camera);
        if (Math.abs(v.x) > lim || Math.abs(v.y) > lim) return false;
      }
      return true;
    };
    let lo = this.minRadius, hi = this.maxRadius, found = this.maxRadius;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) { found = mid; hi = mid; } else lo = mid;
    }
    this.camera.position.copy(saved);
    this.camera.lookAt(t);
    this.camera.updateMatrixWorld();
    return clamp(found, this.minRadius, this.maxRadius);
  }

  resetView(side = 'w') {
    this.target.set(0, -0.05, 0);
    this.theta = side === 'b' ? Math.PI : 0;
    this.phi = this.topDown ? 0.08 : 0.92;
    this.radius = this.fitRadius();
    this.sync();
  }

  async toggleTopDown() {
    this.topDown = !this.topDown;
    const fromPhi = this.phi;
    const fromRad = this.radius;
    if (this.topDown) {
      this.savedPhi = fromPhi;
      this.savedRadius = fromRad;
    }
    const toPhi = this.topDown ? 0.08 : this.savedPhi;
    const toRad = this.fitRadius(1.08, toPhi);
    await tween(360, k => {
      const e = easeIO(k);
      this.phi = fromPhi + (toPhi - fromPhi) * e;
      this.radius = fromRad + (toRad - fromRad) * e;
      this.sync();
    });
    return this.topDown;
  }

  async flipBoard() {
    const from = this.theta;
    const to = from + Math.PI;
    await tween(520, k => {
      this.theta = from + (to - from) * easeIO(k);
      this.sync();
    });
  }

  _bind() {
    const el = this.canvas;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.downX = e.clientX;
        this.downY = e.clientY;
        this.moved = 0;
      } else if (this.pointers.size === 2) {
        this.dragging = false;
        const pts = [...this.pointers.values()];
        this.pinchD = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    el.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1 && this.dragging) {
        this.moved += Math.hypot(dx, dy);
        if (this.moved > 5) {
          this.theta -= dx * 0.0065;
          if (!this.topDown) this.phi = clamp(this.phi - dy * 0.0055, 0.25, 1.38);
          this.sync();
        }
      } else if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinchD > 0) {
          this.radius = clamp(this.radius * (this.pinchD / d), this.minRadius, this.maxRadius);
          this.sync();
        }
        this.pinchD = d;
      }
    });

    const up = e => {
      const wasTap = this.pointers.size === 1 && this.dragging && this.moved < 8;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchD = 0;
      if (this.pointers.size === 0) this.dragging = false;
      if (wasTap && this.onTap) this.onTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.radius = clamp(this.radius * (1 + e.deltaY * 0.001), this.minRadius, this.maxRadius);
      this.sync();
    }, { passive: false });
  }
}
