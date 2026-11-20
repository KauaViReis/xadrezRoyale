import * as THREE from 'three';

export function worldPos(r, c) {
  return new THREE.Vector3(c - 3.5, 0, r - 3.5);
}

const _texCache = new Map();

export function getBoardTexture(kind = 'wood') {
  if (kind === 'none') return null;
  if (_texCache.has(kind)) return _texCache.get(kind);

  const cvs = document.createElement('canvas');
  cvs.width = 256;
  cvs.height = 256;
  const cx = cvs.getContext('2d');
  cx.fillStyle = '#efefef';
  cx.fillRect(0, 0, 256, 256);

  if (kind === 'wood') {
    for (let y = 0; y < 256; y += 2) {
      const v = 226 + Math.floor(Math.sin(y * 0.12) * 14 + (Math.random() - 0.5) * 12);
      cx.fillStyle = `rgb(${v},${v},${v})`;
      cx.fillRect(0, y, 256, 2);
    }
    cx.strokeStyle = 'rgba(0,0,0,0.06)';
    cx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const y = (i / 16) * 256;
      cx.beginPath();
      cx.moveTo(0, y);
      cx.bezierCurveTo(85, y + (Math.random() - 0.5) * 14, 170, y + (Math.random() - 0.5) * 14, 256, y);
      cx.stroke();
    }
  } else if (kind === 'marble') {
    for (let i = 0; i < 800; i++) {
      const v = 230 + Math.floor(Math.random() * 24);
      cx.fillStyle = `rgb(${v},${v},${v})`;
      cx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
    cx.strokeStyle = 'rgba(0,0,0,0.08)';
    cx.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      let x = Math.random() * 256, y = 0;
      cx.beginPath();
      cx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (Math.random() - 0.5) * 55;
        y += 42;
        cx.lineTo(x, y);
      }
      cx.stroke();
    }
  } else if (kind === 'slate') {
    for (let i = 0; i < 1200; i++) {
      const v = 216 + Math.floor(Math.random() * 34);
      cx.fillStyle = `rgb(${v},${v},${v})`;
      cx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _texCache.set(kind, tex);
  return tex;
}

export function createBoard(scene, materials) {
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const sqGeo = new THREE.BoxGeometry(1, 0.16, 1);
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = (r + c) % 2 === 0;
      const m = new THREE.Mesh(sqGeo, isLight ? materials.lightSq : materials.darkSq);
      m.position.set(c - 3.5, -0.08, r - 3.5);
      m.receiveShadow = true;
      m.userData = { sq: true, r, c };
      boardGroup.add(m);
      squares.push(m);
    }
  }

  const t = 0.55, h = 0.34, L = 8 + 2 * t;
  const mkFrame = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.frame);
    m.position.set(x, -0.16 + h / 2 - 0.18, z);
    m.castShadow = true;
    m.receiveShadow = true;
    boardGroup.add(m);
  };
  mkFrame(L, t, 0, -(4 + t / 2));
  mkFrame(L, t, 0, (4 + t / 2));
  mkFrame(t, 8, -(4 + t / 2), 0);
  mkFrame(t, 8, (4 + t / 2), 0);

  const base = new THREE.Mesh(new THREE.BoxGeometry(L, 0.3, L), materials.frame);
  base.position.y = -0.31;
  base.receiveShadow = true;
  base.castShadow = true;
  boardGroup.add(base);

  const createCoord = (text, x, z) => {
    const cvs = document.createElement('canvas');
    cvs.width = 64; cvs.height = 64;
    const cx = cvs.getContext('2d');
    cx.fillStyle = '#E6D3B3';
    cx.font = '600 34px Georgia, serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.globalAlpha = 0.55;
    cx.fillText(text, 32, 34);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvs), transparent: true, depthWrite: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), mat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.02, z);
    boardGroup.add(p);
  };

  for (let i = 0; i < 8; i++) {
    createCoord(String.fromCharCode(65 + i), i - 3.5, 4.22);
    createCoord(String.fromCharCode(65 + i), i - 3.5, -4.22);
    createCoord(String(8 - i), -4.22, i - 3.5);
    createCoord(String(8 - i), 4.22, i - 3.5);
  }

  const table = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 9.4, 0.5, 64), materials.table);
  table.position.y = -0.72;
  table.receiveShadow = true;
  scene.add(table);

  return { boardGroup, squares, table };
}
