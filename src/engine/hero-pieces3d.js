/* ============================================================
   XADREZ ROYALE — Coleções 3D Procedurais:
   Medieval Fortaleza · Marvel (Vingadores) · DC (Liga da Justiça) · Marvel vs DC
   ============================================================ */

import * as THREE from 'three';

export const MARVEL_ROLE_MAP = {
  k: 'hero_ironman',
  q: 'hero_scarlet',
  r: 'hero_thor',
  b: 'hero_strange',
  n: 'hero_spiderman',
  p: 'hero_cap'
};

export const DC_ROLE_MAP = {
  k: 'hero_batman',
  q: 'hero_wonderwoman',
  r: 'hero_superman',
  b: 'hero_greenlantern',
  n: 'hero_flash',
  p: 'hero_aquaman'
};

export function isGroupPieceStyle(style) {
  return style === 'medieval' || style === 'marvel_heroes' || style === 'dc_heroes' || style === 'marvel_vs_dc';
}

const _geoCache = new Map();
const _matCache = new Map();

function cachedGeo(key, factory) {
  let g = _geoCache.get(key);
  if (!g) {
    g = factory();
    _geoCache.set(key, g);
  }
  return g;
}

function heroMat(hex, metalness = 0.35, roughness = 0.32, emissiveInt = 0) {
  const key = `${hex}:${metalness}:${roughness}:${emissiveInt}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      metalness,
      roughness,
      emissive: emissiveInt > 0 ? new THREE.Color(hex) : new THREE.Color(0x000000),
      emissiveIntensity: emissiveInt
    });
    _matCache.set(key, m);
  }
  return m;
}

const gCyl = (rt, rb, h, s = 14) => cachedGeo(`c:${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const gBox = (w, h, d) => cachedGeo(`b:${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const gSph = (r, w = 16, h = 14) => cachedGeo(`s:${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const gTor = (r, t, rs = 10, ts = 20) => cachedGeo(`t:${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
const gCon = (r, h, s = 10) => cachedGeo(`k:${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const gOct = (r, d = 0) => cachedGeo(`o:${r},${d}`, () => new THREE.OctahedronGeometry(r, d));
const gExt = (key, fn, opts) => cachedGeo(`e:${key}`, () => {
  const sh = new THREE.Shape();
  fn(sh);
  const g = new THREE.ExtrudeGeometry(sh, opts);
  g.center();
  return g;
});

function addPart(group, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], castShadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = castShadow;
  m.receiveShadow = castShadow;
  group.add(m);
  return m;
}

function buildMedievalGroup(type, color, mainMat, accentMat, castShadow) {
  const g = new THREE.Group();
  addPart(g, gCyl(0.28, 0.34, 0.14, 8), mainMat, [0, 0.07, 0], [0, 0, 0], [1, 1, 1], castShadow);
  addPart(g, gTor(0.26, 0.022, 8, 16), accentMat, [0, 0.14, 0], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);

  if (type === 'p') {
    addPart(g, gCyl(0.14, 0.22, 0.36, 8), mainMat, [0, 0.32, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gSph(0.15, 14, 12), mainMat, [0, 0.56, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gBox(0.22, 0.04, 0.22), accentMat, [0, 0.56, 0], [0, Math.PI / 4, 0], [1, 1, 1], castShadow);
  } else if (type === 'r') {
    addPart(g, gCyl(0.20, 0.25, 0.54, 8), mainMat, [0, 0.41, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gCyl(0.26, 0.22, 0.12, 8), accentMat, [0, 0.72, 0], [0, 0, 0], [1, 1, 1], castShadow);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addPart(g, gBox(0.09, 0.13, 0.09), mainMat, [Math.cos(a) * 0.19, 0.84, Math.sin(a) * 0.19], [0, -a, 0], [1, 1, 1], castShadow);
    }
  } else if (type === 'n') {
    const dir = color === 'w' ? -1 : 1;
    addPart(g, gCyl(0.16, 0.23, 0.36, 8), mainMat, [0, 0.32, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gBox(0.20, 0.28, 0.28), mainMat, [0, 0.62, dir * 0.04], [dir * 0.18, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gBox(0.22, 0.05, 0.08), accentMat, [0, 0.64, dir * 0.17], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gCon(0.06, 0.20, 6), accentMat, [0, 0.84, -dir * 0.04], [-dir * 0.3, 0, 0], [1, 1, 1], castShadow);
  } else if (type === 'b') {
    addPart(g, gCyl(0.13, 0.22, 0.54, 8), mainMat, [0, 0.41, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gCon(0.17, 0.34, 8), mainMat, [0, 0.82, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gOct(0.06, 0), accentMat, [0, 1.02, 0], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (type === 'q') {
    addPart(g, gCyl(0.15, 0.25, 0.66, 8), mainMat, [0, 0.47, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gCyl(0.24, 0.16, 0.20, 8), accentMat, [0, 0.88, 0], [0, 0, 0], [1, 1, 1], castShadow);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addPart(g, gCon(0.045, 0.14, 6), accentMat, [Math.cos(a) * 0.20, 1.04, Math.sin(a) * 0.20], [0, 0, 0], [1, 1, 1], castShadow);
    }
  } else if (type === 'k') {
    addPart(g, gCyl(0.16, 0.26, 0.72, 8), mainMat, [0, 0.50, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gCyl(0.25, 0.18, 0.20, 8), accentMat, [0, 0.94, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gBox(0.065, 0.24, 0.065), accentMat, [0, 1.15, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(g, gBox(0.20, 0.06, 0.065), accentMat, [0, 1.17, 0], [0, 0, 0], [1, 1, 1], castShadow);
  }
  return g;
}

function buildHeroGroup(heroId, type, color, mainMat, accentMat, castShadow) {
  const g = new THREE.Group();
  const dir = color === 'w' ? -1 : 1;

  // Pedestal com anel de identificação do time (Brancas vs Pretas)
  addPart(g, gCyl(0.29, 0.34, 0.14, 18), mainMat, [0, 0.07, 0], [0, 0, 0], [1, 1, 1], castShadow);
  addPart(g, gTor(0.29, 0.026, 8, 22), accentMat, [0, 0.14, 0], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);

  const inner = new THREE.Group();
  const rankScale = { k: 1.04, q: 0.98, r: 0.90, b: 0.92, n: 0.88, p: 0.76 }[type] || 0.90;
  inner.position.y = 0.15;
  inner.scale.setScalar(rankScale);

  const torsoGeo = gCyl(0.16, 0.21, 0.40, 14);
  const headGeo = gSph(0.155, 16, 14);

  const gold = heroMat('#D4AF37', 0.80, 0.22, 0);
  const darkGold = heroMat('#9E7B36', 0.72, 0.26, 0);
  const crimson = heroMat('#991B1B', 0.35, 0.32, 0);
  const red = heroMat('#DC2626', 0.28, 0.34, 0);
  const silver = heroMat('#CBD5E1', 0.78, 0.22, 0);
  const obsidian = heroMat('#141418', 0.32, 0.40, 0);
  const blue = heroMat('#1D4ED8', 0.25, 0.36, 0);
  const navy = heroMat('#1E3A5F', 0.28, 0.38, 0);
  const emerald = heroMat('#15803D', 0.35, 0.32, 0);
  const greenGlow = heroMat('#22C55E', 0.20, 0.25, 0.55);
  const arcCyan = heroMat('#67E8F9', 0.10, 0.20, 0.75);
  const chaosRed = heroMat('#EF4444', 0.15, 0.22, 0.65);
  const white = heroMat('#F1F5F9', 0.12, 0.30, 0);
  const teal = heroMat('#0F766E', 0.45, 0.32, 0);

  // Colarinho com a cor do time para fácil leitura tática de cima
  addPart(inner, gCyl(0.21, 0.23, 0.08, 14), mainMat, [0, 0.04, 0], [0, 0, 0], [1, 1, 1], castShadow);

  if (heroId === 'hero_ironman') {
    addPart(inner, torsoGeo, crimson, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.40, 0.10, 0.20), gold, [0, 0.40, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.065, 0.015, 8, 18), silver, [0, 0.27, dir * 0.17], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.045, 0.045, 0.025, 14), arcCyan, [0, 0.27, dir * 0.175], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, crimson, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.19, 0.20, 0.08), gold, [0, 0.59, dir * 0.12], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.052, 0.02, 0.03), arcCyan, [-0.046, 0.615, dir * 0.155], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.052, 0.02, 0.03), arcCyan, [0.046, 0.615, dir * 0.155], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_scarlet') {
    addPart(inner, torsoGeo, crimson, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.34, 0.24, 0.07), mainMat, [0, 0.25, -dir * 0.17], [dir * 0.18, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, mainMat, [0, 0.59, 0], [0, 0, 0], [1, 1, 1], castShadow);
    const tiara = gExt('scarlet_tiara', sh => {
      sh.moveTo(-0.17, 0); sh.lineTo(-0.14, 0.22); sh.lineTo(-0.07, 0.10); sh.lineTo(0, 0.17);
      sh.lineTo(0.07, 0.10); sh.lineTo(0.14, 0.22); sh.lineTo(0.17, 0); sh.closePath();
    }, { depth: 0.045, bevelEnabled: false });
    addPart(inner, tiara, red, [0, 0.70, dir * 0.10], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gSph(0.07, 12, 12), chaosRed, [0, 0.90, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.11, 0.012, 8, 18), chaosRed, [0, 0.90, 0], [Math.PI / 3, 0.4, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_thor') {
    addPart(inner, torsoGeo, navy, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.32, 0.34, 0.07), crimson, [0, 0.24, -dir * 0.18], [dir * 0.15, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, silver, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.12, 0.18, 0.03), silver, [-0.18, 0.70, 0], [0, 0, 0.35], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.12, 0.18, 0.03), silver, [0.18, 0.70, 0], [0, 0, -0.35], [1, 1, 1], castShadow);
    // Martelo Mjolnir erguido
    addPart(inner, gCyl(0.022, 0.022, 0.32, 8), gold, [0.25, 0.54, dir * 0.07], [0.28 * dir, 0, -0.15], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.22, 0.13, 0.13), silver, [0.28, 0.72, dir * 0.11], [0.2 * dir, 0, -0.15], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_strange') {
    addPart(inner, torsoGeo, navy, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.40, 0.26, 0.07), crimson, [0, 0.46, -dir * 0.16], [-0.22 * dir, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.065, 0.015, 8, 18), gold, [0, 0.28, dir * 0.175], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gSph(0.034, 10, 10), greenGlow, [0, 0.28, dir * 0.185], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, mainMat, [0, 0.61, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.22, 0.014, 8, 22), darkGold, [0, 0.66, -dir * 0.13], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_spiderman') {
    addPart(inner, torsoGeo, red, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.40, 0.22, 0.15), navy, [0, 0.17, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, red, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.08, 0.06, 0.04), obsidian, [-0.062, 0.62, dir * 0.14], [0, -0.25 * dir, -0.28], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.08, 0.06, 0.04), obsidian, [0.062, 0.62, dir * 0.14], [0, 0.25 * dir, 0.28], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.058, 0.038, 0.045), white, [-0.062, 0.62, dir * 0.146], [0, -0.25 * dir, -0.28], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.058, 0.038, 0.045), white, [0.062, 0.62, dir * 0.146], [0, 0.25 * dir, 0.28], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_cap') {
    addPart(inner, torsoGeo, navy, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, navy, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    const sp = [0, 0.30, dir * 0.22];
    const sr = [Math.PI / 2, 0, 0];
    addPart(inner, gCyl(0.22, 0.22, 0.032, 22), red, sp, sr, [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.17, 0.17, 0.038, 22), white, sp, sr, [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.12, 0.12, 0.044, 22), red, sp, sr, [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.075, 0.075, 0.050, 18), blue, sp, sr, [1, 1, 1], castShadow);
    addPart(inner, gOct(0.035, 0), white, [0, 0.30, dir * 0.25], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_batman') {
    addPart(inner, torsoGeo, mainMat, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.44, 0.13, 0.22), obsidian, [0, 0.38, -dir * 0.03], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.40, 0.32, 0.07), obsidian, [0, 0.23, -dir * 0.18], [dir * 0.18, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.20, 0.018, 8, 20), darkGold, [0, 0.10, 0], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.08, 0.08, 0.02, 16), darkGold, [0, 0.28, dir * 0.175], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, obsidian, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCon(0.04, 0.20, 4), obsidian, [-0.10, 0.81, -dir * 0.02], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCon(0.04, 0.20, 4), obsidian, [0.10, 0.81, -dir * 0.02], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.048, 0.018, 0.03), white, [-0.046, 0.61, dir * 0.15], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.048, 0.018, 0.03), white, [0.046, 0.61, dir * 0.15], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_wonderwoman') {
    addPart(inner, torsoGeo, crimson, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.195, 0.215, 0.12, 14), navy, [0, 0.11, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.225, 0.02, 8, 22), gold, [0, 0.09, 0], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, mainMat, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.15, 0.022, 8, 18), gold, [0, 0.70, 0], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gOct(0.034, 0), red, [0, 0.72, dir * 0.15], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_superman') {
    addPart(inner, torsoGeo, blue, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.34, 0.34, 0.07), crimson, [0, 0.24, -dir * 0.18], [dir * 0.18, 0, 0], [1, 1, 1], castShadow);
    const shield = gExt('supes_shield', sh => {
      sh.moveTo(-0.09, 0.07); sh.lineTo(0.09, 0.07); sh.lineTo(0.11, 0.01); sh.lineTo(0, -0.09); sh.lineTo(-0.11, 0.01); sh.closePath();
    }, { depth: 0.03, bevelEnabled: false });
    addPart(inner, shield, gold, [0, 0.29, dir * 0.175], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, shield, red, [0, 0.29, dir * 0.184], [0, 0, 0], [0.74, 0.74, 1], castShadow);
    addPart(inner, headGeo, mainMat, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.22, 0.09, 0.20), obsidian, [0, 0.72, -dir * 0.02], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_greenlantern') {
    addPart(inner, torsoGeo, emerald, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.40, 0.09, 0.20), obsidian, [0, 0.39, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.07, 0.07, 0.022, 16), white, [0, 0.28, dir * 0.175], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gTor(0.04, 0.014, 8, 16), greenGlow, [0, 0.28, dir * 0.188], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, mainMat, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.055, 0.075, 0.13, 8), greenGlow, [0, 0.82, 0], [0, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_flash') {
    addPart(inner, torsoGeo, red, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.07, 0.07, 0.022, 16), white, [0, 0.29, dir * 0.175], [Math.PI / 2, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.035, 0.11, 0.025), gold, [0, 0.29, dir * 0.19], [0, 0, 0.35], [1, 1, 1], castShadow);
    addPart(inner, headGeo, red, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.026, 0.085, 0.16), gold, [-0.165, 0.64, -dir * 0.04], [0.22 * dir, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.026, 0.085, 0.16), gold, [0.165, 0.64, -dir * 0.04], [0.22 * dir, 0, 0], [1, 1, 1], castShadow);
  } else if (heroId === 'hero_aquaman') {
    addPart(inner, torsoGeo, gold, [0, 0.24, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCyl(0.20, 0.22, 0.11, 14), teal, [0, 0.10, 0], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, headGeo, mainMat, [0, 0.60, 0], [0, 0, 0], [1, 1, 1], castShadow);
    // Tridente de Atlântida
    addPart(inner, gCyl(0.02, 0.02, 0.80, 8), gold, [0.26, 0.44, dir * 0.04], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gBox(0.16, 0.026, 0.026), gold, [0.26, 0.82, dir * 0.04], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCon(0.02, 0.13, 6), gold, [0.19, 0.89, dir * 0.04], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCon(0.022, 0.16, 6), gold, [0.26, 0.91, dir * 0.04], [0, 0, 0], [1, 1, 1], castShadow);
    addPart(inner, gCon(0.02, 0.13, 6), gold, [0.33, 0.89, dir * 0.04], [0, 0, 0], [1, 1, 1], castShadow);
  }

  g.add(inner);
  return g;
}

export function createGroupPieceObject(type, color, style, theme, tier = 'high') {
  const castShadow = tier !== 'low';
  const mainHex = color === 'w' ? (theme?.w ?? 0xEFECE4) : (theme?.b ?? 0x201D1A);
  const accentHex = color === 'w' ? 0xD4AF37 : 0x9E7B36;

  const mainMat = new THREE.MeshStandardMaterial({
    color: mainHex,
    roughness: 0.28,
    metalness: theme?.metal ? 0.82 : 0.22
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.22,
    metalness: 0.82
  });

  if (style === 'medieval') {
    return buildMedievalGroup(type, color, mainMat, accentMat, castShadow);
  }
  const heroId = style === 'marvel_heroes'
    ? (MARVEL_ROLE_MAP[type] || 'hero_cap')
    : style === 'dc_heroes'
      ? (DC_ROLE_MAP[type] || 'hero_aquaman')
      : (color === 'w' ? (MARVEL_ROLE_MAP[type] || 'hero_cap') : (DC_ROLE_MAP[type] || 'hero_aquaman'));

  return buildHeroGroup(heroId, type, color, mainMat, accentMat, castShadow);
}
