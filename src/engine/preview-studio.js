/* ============================================================
   XADREZ ROYALE — Estúdio de Preview 3D Ao Vivo (Configurações)
   Pedestal iluminado com rotação 360° da peça selecionada.
   ============================================================ */

import * as THREE from 'three';
import { createPieceMesh, disposePieceObject } from './pieces3d.js';

export class PiecePreviewStudio {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0E0D0B);

    const w = canvas.clientWidth || 240;
    const h = canvas.clientHeight || 190;
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 20);
    this.camera.position.set(1.35, 1.25, 1.85);
    this.camera.lookAt(0, 0.55, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.48));
    const key = new THREE.DirectionalLight(0xFFF3DE, 1.25);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x9AB4D6, 0.55);
    rim.position.set(-3, 3, -3);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xC99A3E, 0.55, 8);
    warm.position.set(2, 1.5, -2);
    this.scene.add(warm);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.64, 0.10, 40),
      new THREE.MeshStandardMaterial({ color: 0x1A1714, metalness: 0.4, roughness: 0.42 })
    );
    base.position.y = -0.05;
    this.scene.add(base);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.57, 0.015, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0xC99A3E, metalness: 0.85, roughness: 0.24 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.currentObj = null;
    this._running = false;
    this._raf = null;
  }

  updatePiece(type, color, geos, theme, style) {
    if (this.currentObj) {
      this.pivot.remove(this.currentObj);
      disposePieceObject(this.currentObj);
      this.currentObj = null;
    }
    const obj = createPieceMesh(type, color, geos, theme, 'high', style);
    this.pivot.add(obj);
    this.currentObj = obj;
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.pivot.rotation.y += 0.014;
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }
}
