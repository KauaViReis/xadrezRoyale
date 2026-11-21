import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectHardwareTier } from './quality.js';

export const LIGHTING_MODES = {
  dark: { id: 'dark', label: '🌑 Escuro',   hemi: 0.34, sun: 0.90, fill: 0.10, rim: 0.12, exposure: 0.84 },
  dim:  { id: 'dim',  label: '🕯️ Penumbra', hemi: 0.52, sun: 1.25, fill: 0.32, rim: 0.24, exposure: 1.00 },
  lit:  { id: 'lit',  label: '💡 Estúdio',  hemi: 0.70, sun: 1.50, fill: 0.52, rim: 0.36, exposure: 1.15 }
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const qualityTier = detectHardwareTier(renderer);
  renderer.setPixelRatio(qualityTier === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, qualityTier === 'medium' ? 1.5 : 2));
  renderer.shadowMap.enabled = qualityTier !== 'low';
  renderer.shadowMap.type = qualityTier === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

  /* Estúdio PMREM com RoomEnvironment para reflexos PBR realistas */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new RoomEnvironment();
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  env.dispose();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xF5EFE6, 0x1A1510, 0.65);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xFFF3DE, 1.35);
  sun.position.set(6, 13, 5);
  sun.castShadow = qualityTier !== 'low';
  const smSize = qualityTier === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(smSize, smSize);
  sun.shadow.camera.left = -7.5;
  sun.shadow.camera.right = 7.5;
  sun.shadow.camera.top = 7.5;
  sun.shadow.camera.bottom = -7.5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = qualityTier === 'high' ? 3.5 : 2;
  scene.add(sun);

  const fill = new THREE.PointLight(0xFFE0B2, qualityTier === 'low' ? 0 : (qualityTier === 'medium' ? 0.35 : 0.45), 36);
  fill.position.set(-7, 6, -6);
  scene.add(fill);

  const rim = new THREE.PointLight(0x9AB4D6, qualityTier === 'high' ? 0.25 : 0, 30);
  rim.position.set(6, 4, -8);
  scene.add(rim);

  function setLightingMode(modeId = 'lit') {
    const cfg = LIGHTING_MODES[modeId] || LIGHTING_MODES.lit;
    hemi.intensity = cfg.hemi;
    sun.intensity = cfg.sun;
    fill.intensity = qualityTier === 'low' ? 0 : cfg.fill;
    rim.intensity = qualityTier === 'high' ? cfg.rim : 0;
    renderer.toneMappingExposure = cfg.exposure;
    return cfg.id;
  }

  const materials = {
    lightSq: new THREE.MeshStandardMaterial({ roughness: 0.52, metalness: 0.04 }),
    darkSq:  new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.06 }),
    frame:   new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.14 }),
    table:   new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.04 }),
    fillet:  new THREE.MeshStandardMaterial({ color: 0xC99A3E, metalness: 0.85, roughness: 0.24 })
  };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { scene, camera, renderer, materials, lights: { hemi, sun, fill, rim }, qualityTier, resize, setLightingMode };
}
