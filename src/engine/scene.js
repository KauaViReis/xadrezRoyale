import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectHardwareTier } from './quality.js';

export const LIGHTING_MODES = {
  dark: { id: 'dark', label: '🌑 Escuro',   hemi: 0.28, sun: 0.72, fill: 0.08, rim: 0.10, exposure: 0.78, env: 0.18 },
  dim:  { id: 'dim',  label: '🕯️ Penumbra', hemi: 0.42, sun: 0.92, fill: 0.20, rim: 0.16, exposure: 0.88, env: 0.24 },
  lit:  { id: 'lit',  label: '💡 Estúdio',  hemi: 0.50, sun: 1.05, fill: 0.28, rim: 0.20, exposure: 0.94, env: 0.28 }
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const qualityTier = detectHardwareTier(renderer);
  renderer.setPixelRatio(qualityTier === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, qualityTier === 'medium' ? 1.5 : 2));
  renderer.shadowMap.enabled = qualityTier !== 'low';
  renderer.shadowMap.type = qualityTier === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

  /* Estúdio PMREM com RoomEnvironment suavizado para reflexos PBR acetinados sem estouro */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new RoomEnvironment();
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.28;
  env.dispose();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xF5EFE6, 0x1A1510, 0.50);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xFFF3DE, 1.05);
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

  const fill = new THREE.PointLight(0xFFE0B2, qualityTier === 'low' ? 0 : (qualityTier === 'medium' ? 0.22 : 0.28), 36);
  fill.position.set(-7, 6, -6);
  scene.add(fill);

  const rim = new THREE.PointLight(0x9AB4D6, qualityTier === 'high' ? 0.20 : 0, 30);
  rim.position.set(6, 4, -8);
  scene.add(rim);

  function setLightingMode(modeId = 'lit') {
    const cfg = LIGHTING_MODES[modeId] || LIGHTING_MODES.lit;
    hemi.intensity = cfg.hemi;
    sun.intensity = cfg.sun;
    fill.intensity = qualityTier === 'low' ? 0 : cfg.fill;
    rim.intensity = qualityTier === 'high' ? cfg.rim : 0;
    renderer.toneMappingExposure = cfg.exposure;
    if ('environmentIntensity' in scene) scene.environmentIntensity = cfg.env ?? 0.28;
    return cfg.id;
  }

  const materials = {
    lightSq: new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.03, envMapIntensity: 0.25 }),
    darkSq:  new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.04, envMapIntensity: 0.25 }),
    frame:   new THREE.MeshStandardMaterial({ roughness: 0.50, metalness: 0.12, envMapIntensity: 0.30 }),
    table:   new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.03, envMapIntensity: 0.20 }),
    fillet:  new THREE.MeshStandardMaterial({ color: 0xC99A3E, metalness: 0.78, roughness: 0.32, envMapIntensity: 0.45 })
  };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { scene, camera, renderer, materials, lights: { hemi, sun, fill, rim }, qualityTier, resize, setLightingMode };
}
