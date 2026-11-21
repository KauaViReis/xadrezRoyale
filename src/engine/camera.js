import * as THREE from 'three';
import { rcToSquare } from '../core/chess-engine.js';
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

    this.arrowMode = false;
    this.arrowDragging = false;
    this.arrowPointerId = null;
    this.arrowMoved = 0;

    this.rightDown = false;
    this.rightPointerId = null;
    this.rightLastX = 0;
    this.rightLastY = 0;
    this.rightMoved = 0;

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._planeHit = new THREE.Vector3();

    this.onTap = null;
    this.onLeftTap = null;
    this.onRightDown = null;
    this.onRightDrag = null;
    this.onRightUp = null;
    this.onArrowDragStart = null;
    this.onArrowDragMove = null;
    this.onArrowDragEnd = null;

    this._bind();
    this.sync();
  }

  setArrowMode(enabled) {
    const next = Boolean(enabled);
    this.arrowMode = next;
    if (!next && this.arrowDragging) {
      this.arrowDragging = false;
      this.arrowPointerId = null;
      this.arrowMoved = 0;
      this.onArrowDragEnd?.({
        clientX: 0,
        clientY: 0,
        square: null,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        moved: 0,
        cancelled: true
      });
    }
    if (next && this.dragging) {
      this.dragging = false;
    }
  }

  screenToSquare(clientX, clientY) {
    if (!this.canvas || !this.camera) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.camera.updateMatrixWorld();
    this._raycaster.setFromCamera(this._ndc, this.camera);

    const hit = this._raycaster.ray.intersectPlane(this._boardPlane, this._planeHit);
    if (!hit) return null;

    const { x, z } = hit;
    if (x < -4 || x > 4 || z < -4 || z > 4) return null;

    const c = clamp(Math.floor(x + 4), 0, 7);
    const r = clamp(Math.floor(z + 4), 0, 7);
    return { r, c, sq: rcToSquare(r, c) };
  }

  _pointerPayload(e, moved = 0) {
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      square: this.screenToSquare(e.clientX, e.clientY),
      shiftKey: !!e.shiftKey,
      altKey: !!e.altKey,
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      moved,
      event: e
    };
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

  /* Killcam 3D de Xeque-Mate: aproxima em slow-motion da casa do Rei derrotado */
  async playKillcam(targetVec) {
    if (!targetVec || this.topDown) return;
    const startTarget = this.target.clone();
    const startRad = this.radius;
    const startPhi = this.phi;
    const startTheta = this.theta;
    const endRad = Math.max(this.minRadius, startRad * 0.62);
    const endPhi = 0.72;
    const endTheta = startTheta + 0.32;

    await tween(680, k => {
      const e = easeIO(k);
      this.target.lerpVectors(startTarget, targetVec, e * 0.65);
      this.radius = startRad + (endRad - startRad) * e;
      this.phi = startPhi + (endPhi - startPhi) * e;
      this.theta = startTheta + (endTheta - startTheta) * e;
      this.sync();
    });
  }

  _bind() {
    const el = this.canvas;
    if (!el || typeof el.addEventListener !== 'function') return;

    el.addEventListener('contextmenu', e => e.preventDefault());

    el.addEventListener('pointerdown', e => {
      try { el.setPointerCapture?.(e.pointerId); } catch { /* noop */ }

      /* Botão direito isolado para marcações / setas manuais no PC */
      if (e.pointerType === 'mouse' && e.button === 2) {
        this.rightDown = true;
        this.rightPointerId = e.pointerId;
        this.rightLastX = e.clientX;
        this.rightLastY = e.clientY;
        this.rightMoved = 0;
        this.onRightDown?.(this._pointerPayload(e, 0));
        return;
      }

      if (e.pointerType === 'mouse' && e.button !== 0) return;

      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        if (this.arrowMode) {
          this.dragging = false;
          this.arrowDragging = true;
          this.arrowPointerId = e.pointerId;
          this.arrowMoved = 0;
          this.onArrowDragStart?.(this._pointerPayload(e, 0));
        } else {
          this.dragging = true;
          this.downX = e.clientX;
          this.downY = e.clientY;
          this.moved = 0;
        }
      } else if (this.pointers.size === 2) {
        if (this.arrowDragging) {
          const moved = this.arrowMoved;
          this.arrowDragging = false;
          this.arrowPointerId = null;
          this.arrowMoved = 0;
          this.onArrowDragEnd?.({ ...this._pointerPayload(e, moved), cancelled: true });
        }
        this.dragging = false;
        const pts = [...this.pointers.values()];
        this.pinchD = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    el.addEventListener('pointermove', e => {
      if (this.rightDown && e.pointerId === this.rightPointerId) {
        const dx = e.clientX - this.rightLastX;
        const dy = e.clientY - this.rightLastY;
        this.rightLastX = e.clientX;
        this.rightLastY = e.clientY;
        this.rightMoved += Math.hypot(dx, dy);
        this.onRightDrag?.(this._pointerPayload(e, this.rightMoved));
        return;
      }

      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1 && this.arrowMode && this.arrowDragging && e.pointerId === this.arrowPointerId) {
        this.arrowMoved += Math.hypot(dx, dy);
        this.onArrowDragMove?.(this._pointerPayload(e, this.arrowMoved));
      } else if (this.pointers.size === 1 && this.dragging) {
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
      try { el.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }

      if (this.rightDown && e.pointerId === this.rightPointerId) {
        const moved = this.rightMoved;
        this.rightDown = false;
        this.rightPointerId = null;
        this.rightMoved = 0;
        this.onRightUp?.({ ...this._pointerPayload(e, moved), cancelled: e.type === 'pointercancel' });
        return;
      }

      if (this.arrowDragging && e.pointerId === this.arrowPointerId) {
        const moved = this.arrowMoved;
        this.arrowDragging = false;
        this.arrowPointerId = null;
        this.arrowMoved = 0;
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinchD = 0;
        this.onArrowDragEnd?.({ ...this._pointerPayload(e, moved), cancelled: e.type === 'pointercancel' });
        return;
      }

      const wasTap = e.type !== 'pointercancel' && this.pointers.size === 1 && this.dragging && this.moved < 8;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchD = 0;
      if (this.pointers.size === 0) this.dragging = false;
      if (wasTap) {
        this.onLeftTap?.(e.clientX, e.clientY, e);
        this.onTap?.(e.clientX, e.clientY, e);
      }
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
