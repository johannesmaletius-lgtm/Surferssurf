// Surfers Surf 3D – Prototyp mit Three.js (MIT, siehe vendor/LICENSE-three.txt)
import * as THREE from './vendor/three.min.js';
import * as Sound from './sound.js';
const { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, FXAAShader } = THREE;

/* =========================================================================
   Grundlagen
   ========================================================================= */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const $ = id => document.getElementById(id);
const TEST = /[?&]test\b/.test(location.search);

const LANE_W = 2.5, EDGE = 4.6;
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = matchMedia('(pointer: coarse)').matches ? Math.min(MAX_DPR, 1.5) : MAX_DPR;
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000); // nicht zu nah: genauere Tiefe, kein Flimmern an fernen Stränden

/* =========================================================================
   Himmel, Sonne, Licht
   ========================================================================= */
const HORIZON = new THREE.Color('#c4e8f5');
const ZENITH = new THREE.Color('#2a7fd4');
scene.fog = new THREE.Fog(HORIZON, 45, 600);
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 48), THREE.MathUtils.degToRad(28)); // hinten rechts: Surfer gut beleuchtet, keine Blendung
// Himmel: Verlauf, Sonne mit Hof, weiche Wolken – alles im Shader, keine Bilddateien
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uZenith: { value: ZENITH }, uHorizon: { value: HORIZON }, uSun: { value: SUN_DIR }, uSunCol: { value: new THREE.Color('#fff2cf') }, uTime: { value: 0 }, uCloud: { value: new THREE.Color('#ffffff') }, uGlow: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 uZenith, uHorizon, uSun, uSunCol, uCloud; uniform float uTime, uGlow; varying vec3 vDir;
    float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + 7.1; a *= .5; } return v; }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0., 1.), .5));
      float sd = max(dot(d, uSun), 0.);
      col += uSunCol * (pow(sd, 1400.) * 8. + pow(sd, 24.) * .22 + pow(sd, 4.) * .07);
      // warmes Glühen am Horizont in Richtung Sonne (Abendstimmung)
      float az = max(dot(normalize(vec3(d.x, 0., d.z) + 1e-4), normalize(vec3(uSun.x, 0., uSun.z) + 1e-4)), 0.);
      col += uSunCol * pow(az, 3.) * smoothstep(.4, 0., h) * uGlow;
      vec2 uv = d.xz / max(h + .08, .06) * .55 + vec2(uTime * .004, 0.);
      float c = fbm(uv * 1.3);
      float cm = smoothstep(.58, .74, c) * smoothstep(.0, .2, h);
      float shade = smoothstep(.5, .85, fbm(uv * 1.3 + vec2(.05, .09)));
      vec3 cc = mix(uCloud * 1.02, mix(uHorizon, uZenith, .25) * 1.02, shade * .55) + uSunCol * pow(sd, 6.) * .25 + uSunCol * pow(az, 4.) * uGlow * .3 * (1. - shade);
      col = mix(col, cc, cm * .9);
      col = mix(col, uHorizon, smoothstep(.06, -.02, h));
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyMat);
sky.frustumCulled = false; sky.renderOrder = -1;
scene.add(sky);

const hemi = new THREE.HemisphereLight('#cfeeff', '#1a6f8c', 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.position.copy(SUN_DIR).multiplyScalar(60);
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#9fd8ff', 0.9); // Licht von hinten auf den Rücken des Surfers
fill.position.set(-4, 6, 12);
scene.add(fill, fill.target);

// Umgebungslicht aus dem Himmel (für glänzende Münzen)
const envGround = new THREE.MeshBasicMaterial({ color: '#0d5f86' });
function buildEnv() {
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const s2 = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat); envScene.add(s2);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24), envGround); ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
  if (scene.environment) scene.environment.dispose();
  scene.environment = pm.fromScene(envScene, 0, 0.1, 300).texture;
  pm.dispose();
}
buildEnv();

/* =========================================================================
   Wellen: dieselben Gerstner-Wellen auf CPU (Brett, Bojen) und GPU (Wasser)
   ========================================================================= */
const WAVES = [
  { d: [0.18, 1], A: 0.34, L: 24 },
  { d: [-0.62, 0.78], A: 0.17, L: 12.5 },
  { d: [0.82, 0.57], A: 0.1, L: 7.3 },
  { d: [-0.25, -1], A: 0.05, L: 4.4 },
  { d: [1, 0.12], A: 0.035, L: 2.9 },
  { d: [-0.7, -0.7], A: 0.022, L: 1.7 },
].map(w => { const l = Math.hypot(w.d[0], w.d[1]), k = TAU / w.L; return { dx: w.d[0] / l, dz: w.d[1] / l, A: w.A, k, c: Math.sqrt(9.81 / k), Q: 0 }; });
WAVES.forEach(w => { w.Q = 0.62 / (w.k * w.A * WAVES.length); });
let time = 0;
// Gerstner verschiebt Wasser auch seitlich: Ausgangspunkt suchen, dessen verschobene Lage (x, z) trifft
function waveH(x, z, n = 5) {
  let x0 = x, z0 = z;
  for (let it = 0; it < 3; it++) {
    let dx = 0, dz = 0;
    for (let i = 0; i < n; i++) { const w = WAVES[i], c = Math.cos(w.k * (w.dx * x0 + w.dz * z0 - w.c * time)); dx += w.Q * w.A * w.dx * c; dz += w.Q * w.A * w.dz * c; }
    x0 = x - dx; z0 = z - dz;
  }
  let y = 0;
  for (let i = 0; i < n; i++) { const w = WAVES[i]; y += w.A * Math.sin(w.k * (w.dx * x0 + w.dz * z0 - w.c * time)); }
  return y;
}
const _n = new THREE.Vector3();
function waveN(x, z, out = _n) {
  let nx = 0, ny = 1, nz = 0;
  for (let i = 0; i < 5; i++) { const w = WAVES[i], f = w.k * (w.dx * x + w.dz * z - w.c * time), wa = w.k * w.A, c = Math.cos(f), s = Math.sin(f); nx -= w.dx * wa * c; nz -= w.dz * wa * c; ny -= w.Q * wa * s; }
  return out.set(nx, ny, nz).normalize();
}

/* ---------- Wasserfläche: dichtes Gitter nah, grobes fern; Licht pro Pixel ---------- */
function waterGeometry() {
  const xs = [], zs = [];
  for (let x = -30; x <= 30; x += 0.5) xs.push(x);
  for (let i = 1, x = 30; i <= 26; i++) { x += 0.5 * Math.pow(1.22, i); xs.push(x); xs.unshift(-x); }
  for (let z = 22; z >= -70; z -= 0.5) zs.push(z);
  for (let i = 1, z = -70; i <= 34; i++) { z -= 0.5 * Math.pow(1.17, i); zs.push(z); }
  const pos = new Float32Array(xs.length * zs.length * 3); let p = 0;
  for (const z of zs) for (const x of xs) { pos[p++] = x; pos[p++] = 0; pos[p++] = z; }
  const idx = [], W = xs.length;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -400), 2000);
  return g;
}
const waveU = WAVES.map(w => new THREE.Vector4(w.dx, w.dz, w.k, w.A));
const waterMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uW: { value: waveU }, uQ: { value: WAVES.map(w => w.Q) }, uC: { value: WAVES.map(w => w.c) },
    uSun: { value: SUN_DIR.clone() }, uDeep: { value: new THREE.Color('#05486e') }, uShallow: { value: new THREE.Color('#1fb8c8') }, uSss: { value: new THREE.Color('#5ff0e0') },
    uZenith: { value: ZENITH.clone() }, uHorizon: { value: HORIZON.clone() }, uSunCol: { value: new THREE.Color('#fff4d8') },
    uWake: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSpec: { value: 1 }, uIsl: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, -1, 0)) }, uLagoon: { value: new THREE.Color('#38e0cf') }, uSand: { value: new THREE.Color('#bff3dc') },
  },
  vertexShader: /* glsl */`
    uniform float uTime; uniform vec3 uCam; uniform vec4 uW[6]; uniform float uQ[6]; uniform float uC[6];
    varying vec3 vWorld; varying float vH;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.);
      float fade = 1. - smoothstep(45., 120., length(wp.xz - uCam.xz));
      vec3 d = vec3(0.);
      for (int i = 0; i < 5; i++) { vec4 w = uW[i]; float f = w.z * (dot(w.xy, wp.xz) - uC[i] * uTime); float c = cos(f);
        d.x += uQ[i] * w.w * w.x * c; d.z += uQ[i] * w.w * w.y * c; d.y += w.w * sin(f); }
      wp.xyz += d * fade; vH = d.y * fade; vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uCam, uSun, uDeep, uShallow, uSss, uZenith, uHorizon, uSunCol, uLagoon, uSand; uniform float uSpec; uniform vec4 uW[6]; uniform float uQ[6]; uniform float uC[6]; uniform vec4 uIsl[12];
    varying vec3 vWorld; varying float vH;
    // Hash ohne sin(): bleibt auch bei großen Koordinaten (weit gefahren) stabil
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      vec2 xz = vWorld.xz; float foot = length(fwidth(xz));
      vec3 n = vec3(0., 1., 0.);
      for (int i = 0; i < 6; i++) { vec4 w = uW[i];
        float aa = 1. - smoothstep(.12, .45, foot * w.z / 6.2832);   // zu feine Wellen in der Ferne ausblenden (kein Flimmern)
        float f = w.z * (dot(w.xy, xz) - uC[i] * uTime), wa = w.z * w.w * aa;
        n.x -= w.x * wa * cos(f); n.z -= w.y * wa * cos(f); n.y -= uQ[i] * wa * sin(f); }
      // feine Kräuselung, nur in der Nähe
      float near = 1. - smoothstep(8., 40., length(vWorld - uCam));
      vec2 q = xz * 1.7 + vec2(uTime * .35, uTime * .8);
      n.xz += (vec2(noise(q), noise(q + 17.3)) - .5) * .12 * near;
      n = normalize(n);
      vec3 V = normalize(uCam - vWorld);
      float ndv = max(dot(n, V), 0.);
      float fres = .02 + .98 * pow(clamp(1. - ndv, 0., 1.), 5.); // nie pow() mit negativer Basis: ergibt NaN, das Leuchten macht daraus einen Blitz
      vec3 R = reflect(-V, n); R.y = abs(R.y);
      vec3 skyc = mix(uHorizon * .9, uZenith, pow(clamp(R.y, 0., 1.), .45));
      skyc += uSunCol * pow(max(dot(R, uSun), 0.), 12.) * .25;
      float h = clamp(vH * 1.25 + .5, 0., 1.1);
      // Licht scheint durch die Wellenkämme
      float sss = pow(max(dot(V, -uSun) * .5 + .5, 0.), 3.) * smoothstep(.45, 1., h);
      vec3 water = mix(uDeep, uShallow, h * .55 + .1) + uSss * sss * .55;
      // Flachwasser um die Inseln: türkis, zum Strand hin hell und sandig
      float dI = 99.;
      for (int i = 0; i < 12; i++) { vec4 is = uIsl[i]; if (is.z > 0.) dI = min(dI, length(xz - is.xy) - is.z); }
      float lagoon = 1. - smoothstep(0., 14., dI), sandy = 1. - smoothstep(0., 3.5, dI);
      water = mix(water, uLagoon * (.85 + h * .25), lagoon * .85);
      water = mix(water, uSand, sandy * .7);
      vec3 col = mix(water, skyc, fres * .7 * (1. - lagoon * .4));
      // breiter, weicher Sonnenglanz (keine Glitzerpunkte)
      float sp = max(dot(R, uSun), 0.);
      col += uSunCol * (pow(sp, 300.) * .9 + pow(sp, 40.) * .05) * uSpec;
      // Schaum auf hohen Kämmen
      float fn = noise(xz * .9 + uTime * .2) * .6 + noise(xz * 2.3 - uTime * .3) * .4;
      float lace = noise(xz * 2.2 + vec2(uTime * .3, 0.)) * .6 + noise(xz * 4.7 - vec2(0., uTime * .4)) * .4;
      float foam = smoothstep(.9, 1.06, h + fn * .16) * smoothstep(.42, .78, lace) * near;
      col = mix(col, vec3(.9, .97, 1.), foam * .42);
      // Brandung: Schaumsaum am Strand, läuft in Wellen an
      float far = 1. - smoothstep(150., 420., length(vWorld.xz - uCam.xz));
      float surf = sin(dI * 2.4 - uTime * 1.8 + noise(xz * .4) * 3.) * .5 + .5;
      float shore = (1. - smoothstep(.15, 1.3 + surf * .9, dI + noise(xz * 1.6 + uTime * .3) * .5)) * step(-1.5, dI);
      col = mix(col, vec3(.96, .99, 1.), shore * .85 * far);
      // Dunst zum Horizont
      float dist = length(vWorld.xz - uCam.xz);
      col = mix(col, uHorizon, smoothstep(60., 560., dist) * .92);
      gl_FragColor = vec4(col, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const water = new THREE.Mesh(waterGeometry(), waterMat);
water.frustumCulled = false;
scene.add(water);

/* =========================================================================
   Materialien: Cartoon-Licht mit dunkler Kontur
   ========================================================================= */
const toonRamp = (() => { const d = new Uint8Array([70, 140, 205, 255]); const t = new THREE.DataTexture(d, 4, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra });
const OUTLINE = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTh: { value: 0.022 }, uCol: { value: new THREE.Color('#0a1020') } }]),
  vertexShader: `uniform float uTh;
    #include <fog_pars_vertex>
    void main(){ vec4 mvPosition = modelViewMatrix * vec4(position + normal * uTh, 1.); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    }`,
  fragmentShader: `uniform vec3 uCol;
    #include <fog_pars_fragment>
    void main(){ gl_FragColor = vec4(uCol, 1.);
    #include <fog_fragment>
    }`,
  side: THREE.BackSide, fog: true,
});
const outlineThick = th => { const m = OUTLINE.clone(); m.uniforms.uTh.value = th; return m; };
function withOutline(mesh, th = 0.022) {
  const o = new THREE.Mesh(mesh.geometry, th === 0.022 ? OUTLINE : outlineThick(th)); o.raycast = () => {}; mesh.add(o); return mesh;
}

/* =========================================================================
   Der Surfer: Gelenkpunkte pro Bild berechnet, Glieder dazwischen ausgerichtet
   ========================================================================= */
const KAI = { skin: '#eaa979', shirt: '#ff6a3d', shirtL: '#fff4e6', shorts: '#1f43a0', shortsL: '#ffd23f', cap: '#ffd23f', brim: '#1f43a0', hair: '#f4c95d', hairD: '#d39a2a' };
const UP = new THREE.Vector3(0, 1, 0);
function limb(r, len, mat) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 12);
  const m = withOutline(new THREE.Mesh(g, mat), 0.018); m.userData.len = len; return m;
}
function place(mesh, a, b) {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const dir = _v1.copy(b).sub(a); const l = dir.length();
  if (l > 1e-5) mesh.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / l));
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
// Zwei-Glied-IK: Knie/Ellbogen-Position aus Start, Ziel, Gliedlängen und Beugerichtung
function ik(a, t, l1, l2, bend, out) {
  const d = _v2.copy(t).sub(a); let len = d.length(); const maxL = (l1 + l2) * 0.999;
  if (len > maxL) { d.multiplyScalar(maxL / len); len = maxL; t = _v3.copy(a).add(d); }
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const dn = d.clone().normalize(); const side = bend.clone().sub(dn.clone().multiplyScalar(bend.dot(dn))).normalize();
  return out.copy(a).addScaledVector(dn, x).addScaledVector(side, h);
}
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _mb = new THREE.Matrix4(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
// Glied mit voller Ausrichtung: Längsachse a→b, Querachse entlang „side“ (für nicht runde Teile wie den Oberkörper)
function placeBasis(mesh, a, b, side) {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  _by.copy(b).sub(a).normalize(); _bx.copy(side).addScaledVector(_by, -side.dot(_by)).normalize(); _bz.crossVectors(_bx, _by);
  _mb.makeBasis(_bx, _by, _bz); mesh.quaternion.setFromRotationMatrix(_mb);
}
function suitTexture() {
  // Lycra-Shirt oben, Boardshorts unten; u = 0 / 1 ist der Rücken (zur Kamera)
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = KAI.shirt; x.fillRect(0, 0, 256, 256);
  for (const u of [64, 192]) { x.fillStyle = KAI.shirtL; x.fillRect(u - 10, 20, 20, 180); }
  // Sonne als Logo auf dem Rücken (über die Naht gezeichnet, damit sie ganz bleibt)
  for (const u of [0, 256]) {
    x.fillStyle = KAI.shirtL; x.beginPath(); x.arc(u, 92, 30, 0, TAU); x.fill();
    x.fillStyle = KAI.shortsL; x.beginPath(); x.arc(u, 92, 22, 0, TAU); x.fill();
    x.strokeStyle = KAI.shirtL; x.lineWidth = 5; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; x.beginPath(); x.moveTo(u + Math.cos(a) * 34, 92 + Math.sin(a) * 34); x.lineTo(u + Math.cos(a) * 44, 92 + Math.sin(a) * 44); x.stroke(); }
  }
  // Boardshorts mit Bund und Seitenstreifen
  x.fillStyle = KAI.shorts; x.fillRect(0, 196, 256, 60);
  x.fillStyle = KAI.shortsL; x.fillRect(0, 196, 256, 8);
  for (const u of [64, 192]) x.fillRect(u - 6, 204, 12, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeSurfer() {
  const root = new THREE.Group();
  const M = { skin: toon(KAI.skin), skinD: toon('#d08a5a'), shirt: toon(KAI.shirt), shirtL: toon(KAI.shirtL), shorts: toon(KAI.shorts), shortsL: toon(KAI.shortsL), cap: toon(KAI.cap), brim: toon(KAI.brim), hair: toon(KAI.hair), hairD: toon(KAI.hairD), ink: new THREE.MeshBasicMaterial({ color: '#141a24' }) };
  // Oberkörper: tailliert, breite Schultern, vorne/hinten etwas flacher
  const prof = [[0.001, -0.31], [0.12, -0.3], [0.17, -0.25], [0.178, -0.13], [0.162, -0.02], [0.185, 0.1], [0.212, 0.2], [0.205, 0.27], [0.16, 0.32], [0.08, 0.35], [0.001, 0.356]].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoGeo = new THREE.LatheGeometry(prof, 28); torsoGeo.scale(1, 1, 0.8);
  const torso = withOutline(new THREE.Mesh(torsoGeo, toon('#ffffff', { map: suitTexture() })), 0.018);
  const hand = () => { const h = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 10), M.skin), 0.014); h.geometry = h.geometry.clone().scale(0.85, 0.72, 1.2); h.children[0].geometry = h.geometry;
    const th = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.skin); th.position.set(0.05, 0.02, -0.02); h.add(th); return h; };
  const foot = () => { const g = new THREE.CapsuleGeometry(0.058, 0.16, 4, 10); g.rotateX(Math.PI / 2); g.scale(1, 0.7, 1); return withOutline(new THREE.Mesh(g, M.skin), 0.014); };
  const parts = {
    torso, hips: withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 12).scale(1, 0.85, 0.9), M.shorts), 0.018),
    // weite Boardshorts bis zum Knie, darunter nackte Beine
    thighL: limb(0.112, 0.32, M.shorts), thighR: limb(0.112, 0.32, M.shorts), shinL: limb(0.074, 0.37, M.skin), shinR: limb(0.074, 0.37, M.skin),
    upL: limb(0.072, 0.23, M.shirt), upR: limb(0.072, 0.23, M.shirt), loL: limb(0.054, 0.22, M.skin), loR: limb(0.054, 0.22, M.skin),
    handL: hand(), handR: hand(), footL: foot(), footR: foot(),
    neck: limb(0.062, 0.07, M.skin),
    shoulderL: withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.087, 12, 10), M.shirt), 0.016), shoulderR: withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.087, 12, 10), M.shirt), 0.016),
  };
  for (const k of ['thighL', 'thighR']) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 18), M.shortsL); b.rotation.x = Math.PI / 2; b.position.y = -0.2; parts[k].add(b); }
  for (const k of ['upL', 'upR']) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14), M.shirtL); b.rotation.x = Math.PI / 2; b.position.y = -0.13; parts[k].add(b); }
  // Kopf: Gesicht schaut nach -Z (Fahrtrichtung)
  const head = new THREE.Group();
  const skull = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.155, 22, 16).scale(0.95, 1.08, 1), M.skin), 0.016); head.add(skull);
  for (const sd of [-1, 1]) {
    const ear = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8).scale(0.6, 1, 0.9), M.skin), 0.01); ear.position.set(sd * 0.148, -0.01, 0.01); head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M.ink); eye.position.set(sd * 0.055, 0.015, -0.14); head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.skinD); nose.position.set(0, -0.025, -0.155); head.add(nose);
  // kurze Haare schauen nur unten im Nacken und über den Ohren unter der Kappe hervor
  const hairBack = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.163, 18, 8, -Math.PI * 0.1, Math.PI * 1.2, Math.PI * 0.42, Math.PI * 0.26), M.hair), 0.012); hairBack.position.set(0, 0.0, 0.01); head.add(hairBack);
  for (let i = 0; i < 3; i++) { const t = withOutline(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), i === 1 ? M.hairD : M.hair), 0.008); t.position.set((i - 1) * 0.06, -0.07, 0.15); t.rotation.set(2.6, 0, (i - 1) * 0.4); head.add(t); }
  // Basecap: Kuppel aus sechs Bahnen, Knopf oben, Schirm nach vorn, Verschluss hinten
  const cap = new THREE.Group(); cap.position.y = 0.035; cap.rotation.x = -0.12; head.add(cap);
  const crown = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.172, 24, 12, 0, TAU, 0, Math.PI * 0.5).scale(1, 0.82, 1.06), M.cap), 0.014); cap.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.173, 0.175, 0.03, 24, 1, true).scale(1, 1, 1.06), M.brim); band.position.y = 0.012; cap.add(band);
  for (let i = 0; i < 3; i++) { const seam = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.004, 4, 24, Math.PI), M.brim); seam.scale.set(1, 0.82, 1.06); seam.rotation.y = i * Math.PI / 3; cap.add(seam); }
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), M.brim); btn.position.y = 0.14; cap.add(btn);
  const brimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.02, 24, 1, false, Math.PI / 2, Math.PI); brimGeo.scale(1.08, 1, 1.45);
  const brim = withOutline(new THREE.Mesh(brimGeo, M.brim), 0.012); brim.position.set(0, 0.01, -0.105); brim.rotation.x = 0.12; cap.add(brim);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), M.brim); strap.position.set(0, 0.012, 0.178); cap.add(strap);
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), M.shirt); logo.position.set(0, 0.075, -0.16); logo.rotation.set(0.55, Math.PI, 0); cap.add(logo);
  parts.head = head;
  for (const k in parts) root.add(parts[k]);
  return { root, parts };
}

/* ---------- Surfbrett: Umriss extrudiert, runde Kanten, Deck mit Streifen ---------- */
function makeBoard() {
  const sh = new THREE.Shape(), L = 2.2, W = 0.29;
  const halfW = v => v < 0.42 ? lerp(0.62, 1, Math.sin(v / 0.42 * Math.PI / 2)) : Math.pow(Math.max(0, Math.cos((v - 0.42) / 0.58 * Math.PI / 2)), 0.7);
  const N = 30; const pts = [];
  for (let i = 0; i <= N; i++) { const v = i / N; pts.push([halfW(v) * W, v * L - 0.6]); }
  sh.moveTo(-pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(-pts[i][0], pts[i][1]);
  for (let i = pts.length - 2; i >= 0; i--) sh.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.035, bevelSegments: 4, curveSegments: 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, 0.03, 0); // Spitze zeigt nach -Z
  // Nase leicht hochgebogen (Rocker)
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) { const z = pa.getZ(i); if (z < -0.9) pa.setY(i, pa.getY(i) + Math.pow((-0.9 - z) / 0.7, 2) * 0.13); if (z > 0.45) pa.setY(i, pa.getY(i) + Math.pow((z - 0.45) / 0.2, 2) * 0.02); }
  g.computeVertexNormals();
  const deckTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#f6ecd2'; x.fillRect(0, 0, 64, 256); x.fillStyle = '#34a3ec'; x.fillRect(28, 0, 8, 256); x.fillStyle = '#ff6b4a'; x.fillRect(22, 0, 3, 256); x.fillRect(39, 0, 3, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  // UV entlang der Länge für den Streifen
  const uv = new Float32Array(pa.count * 2); for (let i = 0; i < pa.count; i++) { uv[i * 2] = pa.getX(i) / (W * 2) + 0.5; uv[i * 2 + 1] = (pa.getZ(i) + 1.6) / 2.2; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = withOutline(new THREE.Mesh(g, toon('#ffffff', { map: deckTex })), 0.02);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.18), toon('#1d2636')); fin.position.set(0, -0.07, 0.5); m.add(fin);
  return m;
}

const surfer = makeSurfer();
const board = makeBoard();
const player = new THREE.Group(); // folgt Position + Wellenneigung
player.add(board, surfer.root);
scene.add(player);

// weicher Schatten unter dem Surfer
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(0,20,40,.55)'); g.addColorStop(1, 'rgba(0,20,40,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, depthTest: false }));
blob.rotation.x = -Math.PI / 2; blob.renderOrder = 2; scene.add(blob);

/* =========================================================================
   Posen
   ========================================================================= */
const P = { x: 0, lane: 0, fromX: 0, toX: 0, laneT: 1, z: 0, y: 0, vy: 0, air: false, airT: 0, speed: 14, lean: 0, landT: 0, alive: true, trick: null, trickT: 0, flinch: 0, duck: 0 };
const SEC = { hx: 0, hvx: 0, hy: 0, hvy: 0 };
const J = {}; ['hip', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'hdL', 'hdR', 'knL', 'knR', 'ftL', 'ftR', 'hpL', 'hpR'].forEach(k => J[k] = new THREE.Vector3());
function pose(t, dt) {
  const pump = Math.sin(t * 3.2);
  let crouch = 0.42 + pump * 0.04, lean = P.lean, armA = 0.95, armUp = 0, tuck = 0;
  if (P.air) { const k = smooth01((P.airT - 0.05) / 0.25); crouch = lerp(0.2, 0.75, k); tuck = k; armUp = 0.6; }
  if (pw.kite > 0 && state === 'play') { crouch = 0.25 + Math.sin(t * 2) * 0.05; tuck = 0; }
  if (P.landT > 0) { const ph = 1 - P.landT / 0.34, c = Math.exp(-ph * 4.2) * Math.cos(ph * 7.5) * smooth01(P.landT / 0.06); crouch += 0.45 * c; armUp -= 0.3 * c; }
  crouch += Math.abs(lean) * 0.18;
  const dk = P.duck > 0 ? smooth01((DUCK_T - P.duck) / 0.1) * smooth01(P.duck / 0.15) : 0;
  crouch = lerp(crouch, 1.2, dk);
  // Füße stehen fest auf dem Brett (Regular: linker Fuß vorne)
  J.ftL.set(0.02, 0.12, -0.42); J.ftR.set(-0.02, 0.12, 0.36);
  const hipY = 1.02 - crouch * 0.42;
  J.hip.set(0.05 - lean * 0.12, hipY, -0.03);
  // Oberkörper: seitlich zur Fahrtrichtung, beugt sich vor und in die Kurve
  const fwd = 0.25 + crouch * 0.35 + tuck * 0.2 + dk * 0.55;
  const tilt = lean * 0.35 + Math.sin(t * 1.1) * 0.03;
  J.chest.set(J.hip.x + Math.sin(tilt) * 0.5 + fwd * 0.12, J.hip.y + Math.cos(tilt) * 0.5 * (1 - fwd * 0.25), J.hip.z - fwd * 0.2);
  J.neck.copy(J.chest).add(_v1.set(Math.sin(tilt) * 0.12, 0.13, -0.03));
  J.head.copy(J.neck).add(_v1.set(Math.sin(tilt) * 0.06, 0.16, -0.05));
  J.hpL.set(J.hip.x, J.hip.y - 0.05, J.hip.z - 0.12); J.hpR.set(J.hip.x, J.hip.y - 0.05, J.hip.z + 0.12);
  J.shL.copy(J.chest).add(_v1.set(-0.21, -0.02, -0.09)); J.shR.copy(J.chest).add(_v1.set(0.21, -0.02, 0.09));
  // Arme balancieren: seitlich ausgestreckt, äußerer Arm in der Kurve höher
  const sway = Math.sin(t * 1.9) * 0.08;
  const aL = armA + armUp + lean * 0.7 + sway + SEC.hx * 0.2, aR = armA + armUp - lean * 0.7 - sway - SEC.hx * 0.2;
  J.hdL.copy(J.shL).add(_v1.set(-0.5 - Math.cos(aL) * 0.06 + tuck * 0.15, -0.3 + (aL - 0.95) * 0.45, -0.1 + tuck * 0.05));
  J.hdR.copy(J.shR).add(_v1.set(0.5 + Math.cos(aR) * 0.06 - tuck * 0.15, -0.3 + (aR - 0.95) * 0.45, 0.04 + tuck * 0.05));
  if (pw.kite > 0 && state === 'play') { J.hdL.copy(J.shL).add(_v1.set(-0.18, 0.52, -0.05)); J.hdR.copy(J.shR).add(_v1.set(0.18, 0.52, 0.05)); }
  if (dk > 0) { J.hdL.lerp(_v1.set(-0.32, 0.42, -0.62), dk); J.hdR.lerp(_v2.set(0.32, 0.38, -0.3), dk); }
  if (P.trick === 'grab' && P.air) { const w = Math.sin(clamp(P.trickT / 0.55, 0, 1) * Math.PI); J.hdL.lerp(_v1.set(0.3, 0.2, -0.1), w); }
  if (P.trick === 'shaka' && P.air) { const w = Math.sin(clamp(P.trickT / 0.55, 0, 1) * Math.PI); J.hdR.lerp(_v1.copy(J.shR).add(_v2.set(0.05, 0.55, 0.15)), w); }
  ik(J.hpL, J.ftL, 0.46, 0.46, _v1.set(1, 0.2, -0.3), J.knL);
  ik(J.hpR, J.ftR, 0.46, 0.46, _v1.set(1, 0.2, 0.3), J.knR);
  ik(J.shL, J.hdL, 0.31, 0.28, _v1.set(0, 0.35, 1), J.elL);
  ik(J.shR, J.hdR, 0.31, 0.28, _v1.set(0, 0.35, 1), J.elR);
  const p = surfer.parts;
  placeBasis(p.torso, _v3.copy(J.hip).lerp(J.chest, -0.04), _v2.copy(J.chest).lerp(J.hip, -0.06), _v1.copy(J.shR).sub(J.shL)); p.hips.position.copy(J.hip); p.hips.quaternion.copy(p.torso.quaternion);
  p.shoulderL.position.copy(J.shL); p.shoulderR.position.copy(J.shR);
  place(p.neck, J.chest, J.head);
  place(p.thighL, J.hpL, J.knL); place(p.shinL, J.knL, J.ftL); place(p.thighR, J.hpR, J.knR); place(p.shinR, J.knR, J.ftR);
  place(p.upL, J.shL, J.elL); place(p.loL, J.elL, J.hdL); place(p.upR, J.shR, J.elR); place(p.loR, J.elR, J.hdR);
  p.handL.position.copy(J.hdL); p.handR.position.copy(J.hdR);
  p.handL.quaternion.setFromUnitVectors(Z_AXIS, _v1.copy(J.hdL).sub(J.elL).normalize()); p.handR.quaternion.setFromUnitVectors(Z_AXIS, _v1.copy(J.hdR).sub(J.elR).normalize());
  p.footL.position.copy(J.ftL).y -= 0.06; p.footR.position.copy(J.ftR).y -= 0.06; p.footL.rotation.y = 0.5; p.footR.rotation.y = 0.5;
  p.head.position.copy(J.head); p.head.rotation.set(-0.1, -lean * 0.2, -tilt * 0.6);
  // Arme federn der Kurvenbewegung hinterher
  SEC.hvx += ((-lean * 0.9 - SEC.hx) * 55 - SEC.hvx * 5.5) * dt; SEC.hx += SEC.hvx * dt;
}

/* =========================================================================
   Welt: Inseln mit Palmen, Berge, Bojen, Hindernisse, Münzen
   ========================================================================= */
const frondTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512; const x = c.getContext('2d');
  x.strokeStyle = '#ffffff'; x.lineCap = 'round';
  x.lineWidth = 7; x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 512); x.stroke();
  for (let i = 0; i < 34; i++) { const y = 10 + i * 14.5, l = 58 * Math.sin((i + 2) / 37 * Math.PI) + 6; x.lineWidth = 9 - i * 0.12;
    for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(64, y); x.quadraticCurveTo(64 + sd * l * 0.5, y + 6, 64 + sd * l, y + 26); x.stroke(); } }
  const t = new THREE.CanvasTexture(c); return t;
})();
const M_FROND = [toon('#3f9a3a', { map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide }), toon('#5cb848', { map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide })];
const M_TRUNK = [toon('#9a6b3d'), toon('#7a5230')], M_SAND = toon('#f3d9a0'), M_GRASS = toon('#4fa944'), M_ROCK = toon('#6f7a8a'), M_ROCKD = toon('#4d5766');
function frondGeo(len, droop) {
  const seg = 8, g = new THREE.PlaneGeometry(0.9, len, 2, seg); g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), t = y / len, x = p.getX(i); p.setZ(i, -Math.sin(t * Math.PI * 0.5) * 0 + Math.abs(x) * 0.25); p.setY(i, y * Math.cos(t * droop)); p.setZ(i, p.getZ(i) - Math.pow(t, 2) * droop * len * 0.55); }
  g.rotateX(-Math.PI / 2); g.computeVertexNormals(); return g;
}
const FRONDS = [frondGeo(2.6, 1.2), frondGeo(2.2, 1.5), frondGeo(2.9, 1.0)];
function makePalm(h, bend) {
  const g = new THREE.Group(); let pos = new THREE.Vector3(), dir = new THREE.Vector3(0, 1, 0);
  const segs = 7; for (let i = 0; i < segs; i++) {
    const l = h / segs, r = lerp(0.2, 0.12, i / segs);
    const c = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, l * 1.05, 8), M_TRUNK[i % 2]), 0.02);
    const nd = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), bend / segs).normalize();
    c.position.copy(pos).addScaledVector(nd, l / 2); c.quaternion.setFromUnitVectors(UP, nd); g.add(c);
    pos.addScaledVector(nd, l); dir = nd;
  }
  const n = 8; for (let i = 0; i < n; i++) {
    const f = new THREE.Mesh(pick(FRONDS), M_FROND[i % 2]); f.position.copy(pos); f.rotation.set(0, i / n * TAU + rand(0.3), 0); f.rotateX(rand(-0.25, 0.15)); g.add(f);
  }
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), toon('#5a3a1a')); nut.position.copy(pos).add(new THREE.Vector3(0.1, -0.15, 0.1)); g.add(nut);
  return g;
}
function makeRockMesh(seed, sx, sy, sz, mossy) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  const R = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233 + seed * 37.7) * 43758.5453; return s - Math.floor(s); };
  const cache = new Map();
  for (let i = 0; i < p.count; i++) { const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; let f = cache.get(k); if (f === undefined) { f = 0.75 + R(p.getX(i) * 3 + p.getZ(i), p.getY(i) * 5) * 0.5; cache.set(k, f); } p.setXYZ(i, p.getX(i) * f * sx, Math.max(-0.2, p.getY(i)) * f * sy, p.getZ(i) * f * sz); }
  g.computeVertexNormals();
  const m = withOutline(new THREE.Mesh(g, mossy ? M_ROCK : M_ROCKD), 0.03);
  if (mossy) { const moss = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, 0.9), toon('#5aa04a')); moss.scale.set(sx * 0.7, sy * 0.35, sz * 0.7); moss.position.y = sy * 0.62; m.add(moss); }
  return m;
}
function makeIsland(seed) {
  const g = new THREE.Group(), r = rand(5, 9); g.userData.r = r;
  const sand = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 10, 0, TAU, 0, Math.PI / 2), M_SAND); sand.scale.y = 0.16; g.add(sand);
  const grass = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 18, 8, 0, TAU, 0, Math.PI / 2), M_GRASS); grass.scale.y = 0.28; grass.position.y = 0.2; g.add(grass);
  const n = 1 + Math.floor(rand(3)); for (let i = 0; i < n; i++) { const pm = makePalm(rand(5, 7.5), rand(-0.6, 0.6)); pm.position.set(rand(-r * 0.4, r * 0.4), 0.6, rand(-r * 0.4, r * 0.4)); pm.rotation.y = rand(TAU); g.add(pm); }
  for (let i = 0; i < 3; i++) { const rk = makeRockMesh(seed * 10 + i, rand(0.6, 1.3), rand(0.5, 1), rand(0.6, 1.2), true); const a = rand(TAU); rk.position.set(Math.cos(a) * r * 0.85, 0, Math.sin(a) * r * 0.85); g.add(rk); }
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(rand(0.5, 0.9), 8, 6), M_GRASS); b.position.set(rand(-r * 0.5, r * 0.5), 0.5, rand(-r * 0.5, r * 0.5)); g.add(b); }
  return g;
}
const islands = [];
for (let i = 0; i < 12; i++) { const isl = makeIsland(i); isl.userData.side = i % 2 ? 1 : -1; isl.userData.r = isl.userData.r || 7; isl.position.set(isl.userData.side * rand(16, 30), -0.25, -i * 38 - rand(20)); islands.push(isl); scene.add(isl); }

// ferne Berginseln: verrauschte Kegel mit Strand am Fuß, Dschungel und Fels (wandern mit der Kamera = wirken weit weg)
const hash2 = (x, y) => { const s2 = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s2 - Math.floor(s2); };
function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), ux), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), ux), uy); }
function fbm2(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5, y * 2.1) * 0.3 + vnoise(x * 4.3 + 9, y * 4.3) * 0.15; }
function makeMountain(R, H, seed) {
  const g = new THREE.ConeGeometry(R, H, 40, 14, true); g.translate(0, H / 2, 0);
  const p = g.attributes.position, cols = new Float32Array(p.count * 3);
  const SAND = new THREE.Color('#ead9a2'), J1 = new THREE.Color('#3c9a48'), J2 = new THREE.Color('#2a7a3c'), ROCK = new THREE.Color('#6f8c6c'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / H, a = Math.atan2(z, x), ca = Math.cos(a), sa = Math.sin(a);
    const n = fbm2(ca * 1.6 + seed, sa * 1.6 + t * 2.2), ridge = 1 - Math.abs(vnoise(ca * 3 + seed * 2, sa * 3 + t * 5) * 2 - 1);
    let f = 0.72 + n * 0.55 + ridge * 0.18; if (t < 0.06) f *= 1 + (0.06 - t) * 5; // flacher Fuß
    p.setXYZ(i, x * f, y * (0.92 + n * 0.16), z * f);
    const tt = t + (n - 0.5) * 0.18;
    if (tt < 0.035) c.copy(SAND); else if (tt < 0.62) c.copy(J1).lerp(J2, clamp(n * 1.4 - 0.3, 0, 1)); else c.copy(J2).lerp(ROCK, smooth01((tt - 0.62) / 0.25));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, M_MOUNTAIN);
}
// Berge bekommen eigenen, weiteren Dunst: sie tauchen weit vorn aus dem Dunst auf und ziehen seitlich vorbei
const mountainHaze = { uHN: { value: 180 }, uHF: { value: 1500 }, uHMax: { value: 0.82 } };
const M_MOUNTAIN = toon('#ffffff', { vertexColors: true });
M_MOUNTAIN.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, mountainHaze);
  sh.fragmentShader = 'uniform float uHN, uHF, uHMax;\n' + sh.fragmentShader.replace('#include <fog_fragment>',
    '#ifdef USE_FOG\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(uHN, uHF, vFogDepth) * uHMax);\n#endif');
};
const MOUNT_N = 12, MOUNT_GAP = 130;
const mountains = [];
function placeMountain(m, z) {
  const R = m.userData.R; m.userData.side = -m.userData.side;
  m.position.set(m.userData.side * (R + rand(45, 130)), -3, z); m.rotation.y = rand(TAU);
}
for (let i = 0; i < MOUNT_N; i++) {
  const R = rand(55, 95), m = makeMountain(R, rand(55, 135), i * 7.3 + 1); m.userData.R = R; m.userData.side = i % 2 ? -1 : 1;
  placeMountain(m, 60 - i * MOUNT_GAP - rand(40)); mountains.push(m); scene.add(m);
}
function updateMountains() {
  for (const m of mountains) if (m.position.z > camera.position.z + m.userData.R + 60) placeMountain(m, m.position.z - MOUNT_N * MOUNT_GAP - rand(-20, 20));
}

// Bojenleinen am Rand des Spielbereichs
const BUOY_N = 70;
const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 12, 8), toon('#ffffff'), BUOY_N * 2);
buoys.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BUOY_N * 2 * 3), 3);
{ const cR = new THREE.Color('#ff4a3a'), cW = new THREE.Color('#ffffff'); for (let i = 0; i < BUOY_N * 2; i++) buoys.setColorAt(i, (i >> 1) % 2 ? cR : cW); }
buoys.frustumCulled = false; scene.add(buoys);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
function updateBuoys() {
  const z0 = Math.floor(P.z / 2.5) * 2.5 + 8;
  for (let i = 0; i < BUOY_N; i++) { const z = z0 - i * 2.5; for (const sd of [0, 1]) { const x = sd ? EDGE : -EDGE; _p.set(x, waveH(x, z, 3) + 0.05, z); _m4.compose(_p, _q, _s); buoys.setMatrixAt(i * 2 + sd, _m4); } }
  buoys.instanceMatrix.needsUpdate = true;
}

// Hindernisse
const OBS_TYPES = {
  rock: { w: 2.1, d: 1.8, h: 2.6 },
  log: { w: 2.3, d: 0.8, h: 0.6, jump: true },
  turtle: { w: 1.8, d: 1.6, h: 0.6, jump: true },
  arch: { w: 12, d: 1.4, h: 99, duck: true },
  boat: { w: 1.9, d: 4.4, h: 1.8 },
  shark: { w: 1.1, d: 1.2, h: 0.95, jump: true },
  buoy: { w: 1.4, d: 1.4, h: 2.8 },
  jetty: { w: 2.5, d: 0.6, h: 99, duck: true },
  ramp: { w: 2.4, d: 4.0, h: 0, ramp: true },
};
const obstacles = [];
const ROCKS = [0, 1, 2, 3].map(s => makeRockMesh(100 + s, 1.25, 1.8, 1.1, true));
const LOG = (() => { const g = new THREE.Group(); const body = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 2.3, 12), toon('#8a5a32')), 0.03); body.rotation.z = Math.PI / 2; g.add(body);
  for (const sd of [-1, 1]) { const end = new THREE.Mesh(new THREE.CircleGeometry(0.32, 14), toon('#e0b47a')); end.position.x = sd * 1.16; end.rotation.y = sd * Math.PI / 2; g.add(end); }
  const br = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.7, 6), toon('#7a4e2a')), 0.02); br.position.set(0.4, 0.35, 0); br.rotation.z = -0.6; g.add(br); return g; })();
const foamTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 22, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.35, 'rgba(255,255,255,.95)'); g.addColorStop(.55, 'rgba(235,250,255,.55)'); g.addColorStop(1, 'rgba(235,250,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) { const a = Math.random() * TAU, r = 30 + Math.random() * 26; x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + Math.random() * 4, 0, TAU); x.fill(); }
  return new THREE.CanvasTexture(c); })();
const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, fog: true });
const foamGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
// Felsbogen über alle Spuren: nur geduckt kommt man durch
const ARCH = (() => {
  const g = new THREE.Group();
  for (const sd of [-1, 1]) { const pl = makeRockMesh(300 + sd, 1.2, 2.6, 1.1, true); pl.position.set(sd * 5.4, -0.3, 0); g.add(pl); }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-5.6, 1.45, 0), new THREE.Vector3(-3.2, 1.95, 0), new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(3.2, 1.95, 0), new THREE.Vector3(5.6, 1.45, 0)]);
  const tg = new THREE.TubeGeometry(curve, 40, 0.5, 10, false), tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) { const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i), n = vnoise(x * 1.3 + 3, z * 2 + y) - 0.5; tp.setXYZ(i, x, y + n * 0.18, z * 1.25 + n * 0.12); }
  tg.computeVertexNormals();
  g.add(withOutline(new THREE.Mesh(tg, M_ROCK), 0.03));
  const moss = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.3, 8, false), toon('#5aa04a')); moss.position.y = 0.32; moss.scale.z = 1.6; g.add(moss);
  // Lianen hängen herab
  for (let i = 0; i < 9; i++) { const x = -4 + i, top = curve.getPoint((x + 5.6) / 11.2).y - 0.4, len = rand(0.25, 0.6);
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, len, 5), toon('#3f8a3a')); v.position.set(x + rand(-0.3, 0.3), top - len / 2, rand(-0.2, 0.2)); g.add(v);
    const lf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4).scale(1, 0.6, 1), toon('#5cb848')); lf.position.set(v.position.x, top - len, v.position.z); g.add(lf); }
  return g;
})();
// Meeresschildkröte: flacher Panzer mit Wabenmuster, paddelnde Flossen
const shellTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#6b7a2e'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#3e4a18'; x.lineWidth = 4; x.fillStyle = '#8a9a3c';
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const cx = i * 30 + (j % 2) * 15 - 4, cy = j * 26 + 6; x.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; x.lineTo(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13); } x.closePath(); x.fill(); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
function makeTurtle() {
  const g = new THREE.Group(), skin = toon('#8fbf6a');
  const shell = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.8, 20, 12, 0, TAU, 0, Math.PI / 2).scale(1, 0.42, 1.15), toon('#ffffff', { map: shellTex })), 0.03); g.add(shell);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.86, 0.08, 20).scale(1, 1, 1.15), toon('#c9b77a')); rim.position.y = 0.02; g.add(rim);
  const head = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10).scale(1, 0.85, 1.2), skin), 0.02); head.position.set(0, 0.1, -1.05); g.add(head);
  for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: '#141a24' })); e.position.set(sd * 0.13, 0.17, -1.2); g.add(e); }
  const fl = [];
  for (const [sx, sz, big] of [[-1, -0.55, 1], [1, -0.55, 1], [-1, 0.6, 0], [1, 0.6, 0]]) {
    const piv = new THREE.Group(); piv.position.set(sx * 0.7, 0, sz); g.add(piv);
    const f = withOutline(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6).scale(big ? 0.45 : 0.25, 0.05, big ? 0.18 : 0.14), skin), 0.015); f.position.x = sx * (big ? 0.38 : 0.2); piv.add(f);
    fl.push({ piv, sx, big });
  }
  return g; // Flossen werden beim Klonen neu gesucht (keine Objekte in userData, die würden beim Klonen serialisiert)
}
const TURTLE = makeTurtle();
const stripeTex = (cols, n, w = 16, h = 128, vertical = false) => { const c = document.createElement('canvas'); c.width = vertical ? h : w; c.height = vertical ? w : h; const x = c.getContext('2d');
  for (let i = 0; i < n; i++) { x.fillStyle = cols[i % cols.length]; if (vertical) x.fillRect(i * h / n, 0, h / n + 1, w); else x.fillRect(0, i * h / n, w, h / n + 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
// Motorboot: kommt in seiner Spur entgegen – nur ausweichen hilft
const BOAT = (() => {
  const g = new THREE.Group();
  const sh = new THREE.Shape(); // Draufsicht, spitzer Bug zeigt nach +Z (auf den Surfer zu)
  sh.moveTo(0, -2.25); sh.quadraticCurveTo(0.95, -1.2, 0.92, 0.4); sh.lineTo(0.85, 1.95); sh.lineTo(-0.85, 1.95); sh.lineTo(-0.92, 0.4); sh.quadraticCurveTo(-0.95, -1.2, 0, -2.25);
  const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.75, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 10 });
  hg.rotateX(-Math.PI / 2); const hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) { const z = hp.getZ(i); if (z > 0.8) hp.setY(i, hp.getY(i) + Math.pow((z - 0.8) / 1.45, 2) * 0.32); }
  hg.computeVertexNormals();
  const hull = withOutline(new THREE.Mesh(hg, toon('#f6f3ea')), 0.03); hull.position.y = -0.3; g.add(hull);
  const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false, curveSegments: 10 }); sg.rotateX(-Math.PI / 2); sg.scale(1.04, 1, 1.03);
  const stripe = new THREE.Mesh(sg, toon('#e8483a')); stripe.position.y = 0.05; g.add(stripe);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(sh, 10).rotateX(-Math.PI / 2).scale(0.86, 1, 0.86), toon('#b9834f')); deck.position.y = 0.56; g.add(deck);
  const glass = withOutline(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.45, 0.08), toon('#9fe3ff')), 0.02); glass.position.set(0, 0.85, 0.35); glass.rotation.x = -0.45; g.add(glass);
  const seat = withOutline(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.6), toon('#2a5db8')), 0.02); seat.position.set(0, 0.74, -0.75); g.add(seat);
  // Fahrer mit Sonnenhut winkt
  const drv = new THREE.Group(); drv.position.set(0.25, 0.9, -0.55); g.add(drv);
  drv.add(withOutline(new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.3, 4, 10), toon('#3cc0a0')), 0.02));
  const hd = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), toon('#c98a5e')), 0.015); hd.position.y = 0.45; drv.add(hd);
  const hat = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 0.12, 16), toon('#f4e2a4')), 0.015); hat.position.y = 0.6; drv.add(hat);
  for (const sd of [-1, 1]) { const gl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: '#141a24' })); gl.position.set(sd * 0.06, 0.47, 0.16); drv.add(gl); }
  const arm = withOutline(new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), toon('#c98a5e')), 0.012); arm.geometry = arm.geometry.clone().translate(0, 0.2, 0); arm.children[0].geometry = arm.geometry;
  arm.position.set(0.2, 0.18, 0); arm.name = 'arm'; drv.add(arm);
  const motor = withOutline(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.4), toon('#2b2f38')), 0.02); motor.position.set(0, 0.55, -2.05); g.add(motor);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), toon('#e8e2d4')); pole.position.set(-0.6, 1.1, -1.6); g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), toon('#ffcc33', { side: THREE.DoubleSide })); flag.position.set(-0.6, 1.5, -1.85); flag.rotation.y = Math.PI / 2; flag.name = 'flag'; g.add(flag);
  return g;
})();
// Hai: Rückenflosse zieht zwischen zwei Spuren hin und her – drüberspringen
const SHARK = (() => {
  const g = new THREE.Group(), grey = toon('#5f7186');
  const fs = new THREE.Shape(); fs.moveTo(-0.5, 0); fs.quadraticCurveTo(-0.1, 0.35, 0.22, 1.0); fs.quadraticCurveTo(0.2, 0.42, 0.48, 0); fs.lineTo(-0.5, 0);
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }); fg.translate(0, -0.12, -0.04);
  const fin = withOutline(new THREE.Mesh(fg, grey), 0.025); g.add(fin);
  const tg = new THREE.ExtrudeGeometry(fs, { depth: 0.05, bevelEnabled: false }); tg.scale(0.45, 0.45, 1); tg.translate(1.5, -0.1, -0.025);
  g.add(withOutline(new THREE.Mesh(tg, grey), 0.02));
  const body = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#06223a', transparent: true, opacity: 0.38, depthWrite: false, fog: true }));
  body.scale.set(1.9, 1, 0.55); body.position.set(0.55, -0.08, 0); body.renderOrder = 1; g.add(body);
  // weiße Bugwelle an der Flosse: auch von weitem gut zu sehen
  const ring = new THREE.Mesh(foamGeo, foamMat); ring.scale.set(1.1, 1, 0.5); ring.position.set(-0.45, -0.06, 0); ring.renderOrder = 1; g.add(ring);
  g.children[0].scale.setScalar(1.35); g.children[1].scale.setScalar(1.2);
  return g;
})();
// große Seezeichen-Tonne mit Blinklicht – ausweichen
const lampMat = new THREE.MeshStandardMaterial({ color: '#ffe680', emissive: '#ffcc33', emissiveIntensity: 1.2 });
const BUOY = (() => {
  const g = new THREE.Group();
  const base = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.6, 18), toon('#d8392c')), 0.03); base.position.y = 0.05; g.add(base);
  const body = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 1.5, 16), toon('#ffffff', { map: stripeTex(['#d8392c', '#f8f4ea'], 4) })), 0.03); body.position.y = 1.1; g.add(body);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.35, 8, 1, true), toon('#2b2f38', { wireframe: true })); cage.position.y = 2.05; g.add(cage);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), lampMat); lamp.position.y = 2.05; g.add(lamp);
  const top = withOutline(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 12), toon('#d8392c')), 0.02); top.position.y = 2.45; g.add(top);
  return g;
})();
// Holzsteg über einer Spur: tief geduckt drunter durch
const JETTY = (() => {
  const g = new THREE.Group(), wood = toon('#9a6b3d'), woodD = toon('#7a5230');
  for (const sd of [-1, 1]) { const post = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3, 10), woodD), 0.025); post.position.set(sd * 1.18, 0.6, 0); g.add(post);
    const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 10), wood); cap2.position.set(sd * 1.18, 2.12, 0); g.add(cap2); }
  const beamTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d'); x.fillStyle = '#ffd23f'; x.fillRect(0, 0, 256, 32);
    x.fillStyle = '#1d2636'; for (let i = -2; i < 18; i++) { x.beginPath(); x.moveTo(i * 18, 32); x.lineTo(i * 18 + 9, 32); x.lineTo(i * 18 + 25, 0); x.lineTo(i * 18 + 16, 0); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const beam = withOutline(new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.34, 0.4), [wood, wood, wood, wood, toon('#ffffff', { map: beamTex }), wood]), 0.025); beam.position.y = 1.82; g.add(beam);
  for (let i = 0; i < 4; i++) { const pl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 1.4), i % 2 ? wood : woodD); pl.position.set(-0.98 + i * 0.65, 2.02, 0); g.add(pl); }
  // bunte Wimpel hängen herab – gut sichtbar, dass man hier tief muss
  const cols = ['#ff4d4d', '#ffcc33', '#2fa3ff', '#3cd070'];
  for (let i = 0; i < 7; i++) { const tri = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 3), toon(cols[i % 4])); tri.rotation.x = Math.PI; tri.scale.z = 0.2; tri.position.set(-1.0 + i * 0.333, 1.53, 0.21); g.add(tri); }
  return g;
})();
// Sprungschanze: Fahr drauf und flieg weit – oben warten Münzen
const RAMP = (() => {
  const g = new THREE.Group();
  const sh = new THREE.Shape(); sh.moveTo(-2, 0); sh.lineTo(-2, 0.06); sh.lineTo(2, 1.15); sh.lineTo(2, 0); sh.lineTo(-2, 0);
  const rg = new THREE.ExtrudeGeometry(sh, { depth: 2.2, bevelEnabled: false }); rg.rotateY(Math.PI / 2); rg.translate(-1.1, 0, 0);
  const plank = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#c58a4f'; x.fillRect(0, 0, 64, 256);
    x.fillStyle = '#9a6634'; for (let i = 0; i < 256; i += 32) x.fillRect(0, i, 64, 3);
    x.fillStyle = '#ffd23f'; for (let i = 0; i < 3; i++) { const y = 40 + i * 70; x.beginPath(); x.moveTo(10, y + 26); x.lineTo(32, y); x.lineTo(54, y + 26); x.lineTo(44, y + 26); x.lineTo(32, y + 12); x.lineTo(20, y + 26); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  // Planken-Textur auf die schräge Fläche legen (UV entlang der Länge)
  const uv = rg.attributes.uv, pp = rg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pp.getX(i) + 1.1) / 2.2, (2 - pp.getZ(i)) / 4);
  g.add(withOutline(new THREE.Mesh(rg, toon('#ffffff', { map: plank })), 0.03));
  for (const sd of [-1, 1]) {
    const len = Math.hypot(4, 1.1), rail = withOutline(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, len), toon('#ff5a3c')), 0.02);
    rail.position.set(sd * 1.12, 0.62, 0); rail.rotation.x = Math.atan2(1.1, 4); g.add(rail);
    const pon = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4.2, 12).rotateX(Math.PI / 2), toon('#2a5db8')), 0.025); pon.position.set(sd * 0.85, -0.05, 0); g.add(pon);
  }
  return g;
})();
const OBS_MESH = { rock: () => pick(ROCKS).clone(), log: () => LOG.clone(), turtle: () => TURTLE.clone(), arch: () => ARCH.clone(), boat: () => BOAT.clone(), shark: () => SHARK.clone(), buoy: () => BUOY.clone(), jetty: () => JETTY.clone(), ramp: () => RAMP.clone() };
const FOAM_SIZE = { rock: [3.6, 3.2], log: [3.4, 1.6], turtle: [2.8, 3], boat: [3.2, 6], shark: [1.8, 1.4], buoy: [2.6, 2.6], jetty: [3.4, 1.4], ramp: [3.4, 5] };
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function addObstacle(type, lane, z, opt = {}) {
  const mesh = OBS_MESH[type]();
  if (type === 'turtle') mesh.userData.fl = mesh.children.filter(c => c.type === 'Group').map((piv, i) => ({ piv, sx: i % 2 ? 1 : -1, big: i < 2 }));
  if (type === 'arch') lane = 0;
  mesh.rotation.y = type === 'rock' ? rand(TAU) : 0;
  const o = { type, lane, x: lane * LANE_W, z, mesh, ...OBS_TYPES[type], hit: false, ph: rand(TAU), born: time, ...opt };
  if (type === 'shark') { o.cx = o.x; o.x = o.cx; }
  mesh.position.set(o.x, -2, z); mesh.scale.setScalar(0.01); scene.add(mesh); obstacles.push(o);
  if (type === 'arch') { o.foam = new THREE.Group(); for (const sd of [-1, 1]) { const f2 = new THREE.Mesh(foamGeo, foamMat); f2.scale.set(3.4, 1, 3); f2.position.set(sd * 5.4, 0.05, 0); f2.renderOrder = 1; mesh.add(f2); } }
  else { o.foam = new THREE.Mesh(foamGeo, foamMat); const fs = FOAM_SIZE[type]; o.foam.scale.set(fs[0], 1, fs[1]); o.foam.userData.s = fs; o.foam.renderOrder = 1; }
  scene.add(o.foam);
  return o;
}

// Münzen (eine Instanz-Gruppe, glänzendes Gold)
const COIN_N = 320;
const coinGeo = (() => { const g = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 28); g.rotateX(Math.PI / 2); return g; })();
const coinMat = new THREE.MeshStandardMaterial({ color: '#ffd24a', metalness: 0.6, roughness: 0.4, emissive: '#c88400', emissiveIntensity: 0.4, envMapIntensity: 0.8, fog: true });
const coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, COIN_N); coinMesh.frustumCulled = false; scene.add(coinMesh);
const coins = [];
function addCoin(x, y, z) { if (coins.length >= COIN_N) return; coins.push({ x, y, z, taken: false, t: 0, born: time }); }

/* =========================================================================
   Power-ups: Magnet, Schild, Drachen – schwebende Blasen mit Symbol
   ========================================================================= */
const PW = { magnet: { dur: 10, col: '#ff5a6e' }, shield: { dur: 15, col: '#5fd0ff' }, kite: { dur: 6, col: '#ffcc33' } };
const pw = { magnet: 0, shield: 0, kite: 0, grace: 0 };
function iconTex(type) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.lineCap = x.lineJoin = 'round'; x.translate(64, 64);
  if (type === 'magnet') {
    x.lineWidth = 30; x.strokeStyle = '#0d2a4a'; x.beginPath(); x.arc(0, -4, 30, Math.PI, 0); x.lineTo(30, 34); x.moveTo(-30, -4); x.lineTo(-30, 34); x.stroke();
    x.lineWidth = 20; x.strokeStyle = '#ff4a5e'; x.beginPath(); x.arc(0, -4, 30, Math.PI, 0); x.lineTo(30, 22); x.moveTo(-30, -4); x.lineTo(-30, 22); x.stroke();
    x.fillStyle = '#e8eef4'; x.fillRect(-41, 22, 22, 16); x.fillRect(19, 22, 22, 16);
  } else if (type === 'shield') {
    x.fillStyle = '#0d2a4a'; x.beginPath(); x.moveTo(0, -46); x.quadraticCurveTo(40, -40, 42, -26); x.quadraticCurveTo(40, 22, 0, 48); x.quadraticCurveTo(-40, 22, -42, -26); x.quadraticCurveTo(-40, -40, 0, -46); x.fill();
    x.fillStyle = '#4fc8ff'; x.beginPath(); x.moveTo(0, -36); x.quadraticCurveTo(32, -31, 33, -21); x.quadraticCurveTo(31, 16, 0, 37); x.quadraticCurveTo(-31, 16, -33, -21); x.quadraticCurveTo(-32, -31, 0, -36); x.fill();
    x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.ellipse(-12, -14, 9, 15, -0.4, 0, TAU); x.fill();
  } else {
    x.fillStyle = '#0d2a4a'; x.beginPath(); x.moveTo(0, -50); x.lineTo(40, -6); x.lineTo(0, 34); x.lineTo(-40, -6); x.closePath(); x.fill();
    const g = x.createLinearGradient(-34, 0, 34, 0); g.addColorStop(0, '#ff4d4d'); g.addColorStop(.33, '#ffcc33'); g.addColorStop(.66, '#2fa3ff'); g.addColorStop(1, '#3cd070');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -41); x.lineTo(31, -6); x.lineTo(0, 25); x.lineTo(-31, -6); x.closePath(); x.fill();
    x.strokeStyle = '#0d2a4a'; x.lineWidth = 5; x.beginPath(); x.moveTo(0, 34); x.quadraticCurveTo(14, 46, 2, 58); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const ICONS = { magnet: iconTex('magnet'), shield: iconTex('shield'), kite: iconTex('kite') };
const ICON_URL = Object.fromEntries(Object.entries(ICONS).map(([k, t]) => [k, t.image.toDataURL()]));
const bubbleMat = new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color('#bff4ff') }, uA: { value: 0.85 } },
  vertexShader: `varying vec3 vN, vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uCol; uniform float uA; varying vec3 vN, vV; void main(){ vec3 n = normalize(vN), v = normalize(vV); float f = pow(clamp(1. - abs(dot(n, v)), 0., 1.), 2.2); vec3 c = mix(uCol * .6, vec3(1.), f * .7);
    float hl = smoothstep(.93, .99, dot(n, normalize(vec3(-.5, .6, .6)))); gl_FragColor = vec4(min(c + hl, vec3(1.2)), clamp((f * .9 + .08 + hl) * uA, 0., 1.));
    #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false,
});
const pickups = [];
function addPickup(type, lane, z) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), bubbleMat); g.add(b);
  const ic = new THREE.Sprite(new THREE.SpriteMaterial({ map: ICONS[type], transparent: true, depthWrite: false })); ic.scale.setScalar(0.8); g.add(ic);
  g.position.set(lane * LANE_W, 1.1, z); g.scale.setScalar(0.01); scene.add(g);
  pickups.push({ type, x: lane * LANE_W, z, g, taken: false, t: 0, born: time });
}
// Schutzblase um den Surfer
const shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 20), bubbleMat.clone());
shieldMesh.material.uniforms = { uCol: { value: new THREE.Color('#7fe0ff') }, uA: { value: 0.75 } };
shieldMesh.visible = false; scene.add(shieldMesh);
// Drachen: bunter Lenkdrachen mit Leinen zu den Händen
const kite = (() => {
  const g = new THREE.Group();
  const kc = document.createElement('canvas'); kc.width = 256; kc.height = 128; const x = kc.getContext('2d');
  ['#ff4d4d', '#ffcc33', '#ffffff', '#2fa3ff', '#ffffff', '#ffcc33', '#ff4d4d'].forEach((c, i) => { x.fillStyle = c; x.fillRect(i * 256 / 7, 0, 256 / 7 + 1, 128); });
  const kt = new THREE.CanvasTexture(kc); kt.colorSpace = THREE.SRGBColorSpace;
  const sh = new THREE.Shape(); sh.moveTo(-1.7, 0.2); sh.bezierCurveTo(-1.4, 1.1, 1.4, 1.1, 1.7, 0.2); sh.bezierCurveTo(1.1, 0.55, -1.1, 0.55, -1.7, 0.2);
  const sg = new THREE.ShapeGeometry(sh, 16); const uv = sg.attributes.uv, ps = sg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (ps.getX(i) + 1.7) / 3.4, ps.getY(i));
  // leicht gewölbt
  for (let i = 0; i < ps.count; i++) ps.setZ(i, -Math.pow(ps.getX(i) / 1.7, 2) * 0.35);
  sg.computeVertexNormals();
  g.add(withOutline(new THREE.Mesh(sg, toon('#ffffff', { map: kt, side: THREE.DoubleSide })), 0.03));
  const lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: '#1d2636', transparent: true, opacity: 0.7 }));
  lines.frustumCulled = false; scene.add(lines);
  g.userData.lines = lines; g.visible = false; scene.add(g); return g;
})();
function activate(type) {
  if (type === 'kite') { pw.kite = PW.kite.dur; P.air = true; P.vy = 0; P.trick = null; P.duck = 0; kiteCoins(); }
  else pw[type] = PW[type].dur;
  Sound.fx.power(); popup({ magnet: 'Magnet!', shield: 'Schutzblase!', kite: 'Drachen!' }[type], PW[type].col);
  for (let i = 0; i < 24; i++) { const a = rand(TAU); addPart(P.x + Math.cos(a) * 0.8, P.y + 1 + Math.sin(a) * 0.8, P.z, Math.cos(a) * 3, Math.sin(a) * 3, 0, rand(0.4, 0.7), rand(0.08, 0.15), PW[type].col, 2); }
}
// Drachenflug: sofort eine Münzspur in Flughöhe über die ganze Flugstrecke legen, Bodenmünzen darunter weg
let kiteEndZ = null;
function kiteCoins() {
  const len = P.speed * (PW.kite.dur - 0.6); kiteEndZ = P.z - len;
  for (let i = coins.length - 1; i >= 0; i--) { const c = coins[i]; if (!c.taken && c.z < P.z && c.z > kiteEndZ - 6) coins.splice(i, 1); }
  let lane = P.lane, run = 0;
  for (let z = P.z - P.speed * 0.6; z > kiteEndZ + 4; z -= 2.4) {
    if (++run > 6 && Math.random() < 0.35) { lane = clamp(lane + (Math.random() < 0.5 ? -1 : 1), -1, 1); run = 0; }
    addCoin(lane * LANE_W, 6.3, z);
  }
}
function popShield(o) {
  pw.shield = 0; pw.grace = 1.2; Sound.fx.pop(); shake = Math.max(shake, 0.3); popup('Blase geplatzt!', '#9fe6ff');
  for (let i = 0; i < 30; i++) { const a = rand(TAU), b = rand(-1, 1); addPart(P.x + Math.cos(a) * 1.2, P.y + 1 + b, P.z + Math.sin(a) * 1.2, Math.cos(a) * 4, b * 3 + 1, Math.sin(a) * 4, rand(0.4, 0.8), rand(0.08, 0.16), '#bff0ff', 3); }
  smashObstacle(o);
}
function smashObstacle(o) {
  o.hit = true; scene.remove(o.mesh, o.foam);
  for (let i = 0; i < 30; i++) addPart(o.x + rand(-1, 1), rand(0, 1.5), o.z, rand(-4, 4), rand(2, 6), rand(-2, 3), rand(0.5, 0.9), rand(0.1, 0.2), '#ffffff');
  if (o.type !== 'turtle') for (let i = 0; i < 12; i++) addPart(o.x + rand(-0.8, 0.8), rand(0.3, 1.5), o.z, rand(-4, 4), rand(3, 7), rand(-2, 3), rand(0.8, 1.2), rand(0.12, 0.24), o.type === 'log' ? '#8a5a32' : '#6f7a8a');
}
function updatePowers(dt) {
  const play = state === 'play';
  for (const k of ['magnet', 'shield', 'kite']) if (pw[k] > 0 && play) pw[k] = Math.max(0, pw[k] - dt);
  pw.grace = Math.max(0, pw.grace - dt);
  if (pw.kite > 0 && pw.kite - dt <= 0.0001 && play) { pw.grace = Math.max(pw.grace, 1.4); }
  if (pw.kite <= 0) kiteEndZ = null;
  // Blasen auf der Strecke
  for (let i = pickups.length - 1; i >= 0; i--) {
    const u = pickups[i]; u.t += dt;
    if (u.z > P.z + 1.5 || (u.taken && u.t > 0.3)) { scene.remove(u.g); pickups.splice(i, 1); continue; }
    if (u.taken) { const k = u.t / 0.3; u.g.scale.setScalar(1 + k * 0.8); u.g.children[0].material.opacity = 1 - k; continue; }
    u.g.position.y = 1.1 + waveH(u.x, u.z, 2) * 0.5 + Math.sin(time * 2.4 + u.z) * 0.15; u.g.children[0].rotation.y = time;
    u.g.scale.setScalar(Math.max(0.01, easeOutBack(smooth01((time - u.born) / 0.5))));
    if (play && P.alive && Math.abs(u.z - P.z) < 1 && Math.abs(u.x - P.x) < 1.1 && Math.abs(u.g.position.y - (P.y + 1)) < 2.2) { u.taken = true; u.t = 0; activate(u.type); }
  }
  // Magnet zieht Münzen vor dem Surfer heran
  if (pw.magnet > 0 && play) for (const c of coins) if (!c.taken && c.z < P.z + 1 && c.z > P.z - 16 && Math.abs(c.x - P.x) < 7) { c.mag = true; }
  for (const c of coins) if (c.mag && !c.taken) { c.x = damp(c.x, P.x, 7, dt); c.y = damp(c.y, P.y + 1, 7, dt); c.z = damp(c.z, P.z, 5, dt); }
  if (pw.magnet > 0 && play && Math.random() < 0.6) { const a = time * 6 + rand(TAU); addPart(P.x + Math.cos(a) * 1.1, P.y + 0.6 + rand(1), P.z + Math.sin(a) * 1.1, -Math.cos(a) * 1.5, 0.5, -Math.sin(a) * 1.5 - P.speed, 0.4, rand(0.05, 0.09), Math.random() < 0.5 ? '#ff5a78' : '#ffd0d8', 0); }
  // Anzeige
  const box = $('pow'); let html = '';
  for (const k of ['magnet', 'shield', 'kite']) if (pw[k] > 0 && play) html += `<div class="pw" style="--c:${PW[k].col}"><img src="${ICON_URL[k]}" alt=""><i style="width:${(pw[k] / PW[k].dur * 100).toFixed(0)}%"></i><span>${{ magnet: 'Magnet', shield: 'Blase', kite: 'Drachen' }[k]}</span></div>`;
  if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
}
// kurze Texte über dem Surfer
const popups = [];
function popup(text, col) {
  const el = document.createElement('div'); el.className = 'pop'; el.textContent = text; el.style.color = col; document.body.appendChild(el);
  popups.push({ el, t: 0, slot: popups.filter(u => u.t < 0.6).length });
}
function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) { const u = popups[i]; u.t += dt;
    if (u.t > 1.2) { u.el.remove(); popups.splice(i, 1); continue; }
    _v1.set(P.x, P.y + 2.7 + u.slot * 0.7 + u.t * 0.8, P.z).project(camera);
    u.el.style.transform = `translate(${((_v1.x + 1) / 2 * innerWidth).toFixed(0)}px,${((1 - _v1.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%,-50%) scale(${(1 + Math.max(0, 0.25 - u.t) * 2).toFixed(2)})`;
    u.el.style.opacity = String(Math.min(1, (1.2 - u.t) * 3)); }
}

/* =========================================================================
   Leben: Delfine springen neben der Strecke, Möwen kreisen, Segelboote am Horizont
   ========================================================================= */
function makeDolphin() {
  const g = new THREE.Group();
  const prof = [[0.001, -1.02], [0.045, -1.0], [0.065, -0.9], [0.075, -0.82], [0.17, -0.74], [0.27, -0.55], [0.33, -0.25], [0.32, 0.1], [0.24, 0.45], [0.13, 0.72], [0.07, 0.9], [0.001, 1.0]].map(([r, y]) => new THREE.Vector2(r, y));
  const bg = new THREE.LatheGeometry(prof, 22); bg.rotateX(Math.PI / 2); bg.scale(1, 0.92, 1);
  const pa = bg.attributes.position, cols = new Float32Array(pa.count * 3), TOP = new THREE.Color('#58789a'), BEL = new THREE.Color('#e4edf2'), c = new THREE.Color();
  for (let i = 0; i < pa.count; i++) { c.copy(TOP).lerp(BEL, smooth01((-pa.getY(i) + 0.02) / 0.14)); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  bg.setAttribute('color', new THREE.BufferAttribute(cols, 3)); bg.computeVertexNormals();
  const mat = toon('#ffffff', { vertexColors: true }), dark = toon('#58789a');
  g.add(withOutline(new THREE.Mesh(bg, mat), 0.02));
  const finShape = new THREE.Shape(); finShape.moveTo(-0.22, 0); finShape.quadraticCurveTo(0.05, 0.12, 0.2, 0.36); finShape.quadraticCurveTo(0.12, 0.12, 0.2, 0); finShape.lineTo(-0.22, 0);
  const fin = withOutline(new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.04, bevelEnabled: false }), dark), 0.015); fin.rotation.y = -Math.PI / 2; fin.position.set(0.02, 0.24, 0.02); g.add(fin);
  for (const sd of [-1, 1]) {
    const fl = withOutline(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6).scale(0.2, 0.03, 0.09), dark), 0.012); fl.position.set(sd * 0.3, -0.12, -0.38); fl.rotation.set(0, sd * 0.5, sd * -0.5); g.add(fl);
    const fk = withOutline(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6).scale(0.24, 0.025, 0.1), dark), 0.012); fk.position.set(sd * 0.17, 0, 1.0); fk.rotation.y = sd * 0.45; g.add(fk);
  }
  for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: '#141a24' })); e.position.set(sd * 0.13, 0.03, -0.66); g.add(e); }
  g.scale.setScalar(1.15);
  return g;
}
const dolphins = [];
for (let i = 0; i < 3; i++) { const m = makeDolphin(); scene.add(m); dolphins.push({ m, side: i % 2 ? 1 : -1, x: 0, z: -40 - i * 25, wait: rand(0.5, 2.5), t: -1, dur: 1.2, h: 2 }); }
function respawnDolphin(d) { d.side = Math.random() < 0.5 ? -1 : 1; d.x = d.side * rand(7, 11); d.z = P.z - rand(30, 70); d.t = -1; d.wait = rand(0.8, 3); }
dolphins.forEach(respawnDolphin);
function splash(x, y, z, n, s = 1) { for (let i = 0; i < n; i++) { const a = rand(TAU); addPart(x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.5, Math.cos(a) * rand(0.5, 2.5) * s, rand(2, 5) * s, Math.sin(a) * rand(0.5, 2) * s, rand(0.5, 0.9), rand(0.1, 0.2), '#ffffff'); } }
function dolphinSound(d) { const dist = Math.hypot(d.x - P.x, d.z - P.z); if (dist < 45) Sound.fx.dolphin(clamp((d.x - P.x) / 10, -1, 1), clamp(1.4 - dist / 35, 0.1, 1)); }
function updateDolphins(dt) {
  const sp = state === 'crash' ? 4 : P.speed * 0.93;
  for (const d of dolphins) {
    d.z -= sp * dt;
    if (d.z > P.z + 12 || d.z < P.z - 140) { respawnDolphin(d); continue; }
    const wy = waveH(d.x, d.z, 3);
    if (d.t < 0) { // schwimmt: nur die Rückenflosse schneidet durchs Wasser
      d.wait -= dt; d.m.position.set(d.x, wy - 0.42, d.z); d.m.rotation.set(0, 0, Math.sin(time * 2 + d.x) * 0.05);
      if (d.wait <= 0) { d.t = 0; d.dur = rand(1.05, 1.35); d.h = rand(1.6, 2.6); splash(d.x, wy, d.z - 0.8, 14); dolphinSound(d); }
    } else {
      d.t += dt; const q = d.t / d.dur, y = wy - 0.42 + Math.sin(q * Math.PI) * d.h, vy = Math.cos(q * Math.PI) * Math.PI * d.h / d.dur;
      d.m.position.set(d.x, y, d.z); d.m.rotation.set(Math.atan2(vy, sp + 6), 0, Math.sin(q * Math.PI) * 0.15 * d.side);
      if (q >= 1) { d.t = -1; d.wait = rand(1.5, 4); splash(d.x, wy, d.z + 0.6, 22); dolphinSound(d); }
    }
  }
}

function makeGull() {
  const g = new THREE.Group(), W = toon('#ffffff'), G = toon('#9aa8b4'), K = toon('#222a33');
  g.add(withOutline(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 8).rotateX(Math.PI / 2), W), 0.012));
  const head = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), W), 0.012); head.position.set(0, 0.04, -0.24); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 6).rotateX(-Math.PI / 2), toon('#ffb020')); beak.position.set(0, 0.03, -0.34); g.add(beak);
  const wings = [];
  for (const sd of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(sd * 0.06, 0.03, -0.04); g.add(piv);
    const inner = withOutline(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.2), W), 0.01); inner.position.x = sd * 0.21; piv.add(inner);
    const op = new THREE.Group(); op.position.x = sd * 0.42; piv.add(op);
    const outer = withOutline(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.018, 0.15), G), 0.01); outer.position.set(sd * 0.2, 0, 0.02); op.add(outer);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.12), K); tip.position.set(sd * 0.42, 0, 0.03); op.add(tip);
    wings.push({ piv, op, sd });
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.14), W); tail.position.set(0, 0, 0.26); g.add(tail);
  g.userData.wings = wings; g.scale.setScalar(1.4); return g;
}
const gulls = [];
for (let i = 0; i < 5; i++) { const m = makeGull(); scene.add(m); gulls.push({ m, cx: rand(-14, 14), cy: rand(7, 13), dz: rand(18, 60), r: rand(5, 10), w: rand(0.35, 0.6) * (Math.random() < 0.5 ? -1 : 1), a: rand(TAU), ph: rand(TAU) }); }
function updateGulls(dt) {
  for (const b of gulls) {
    b.a += b.w * dt; b.dz -= dt * 3; if (b.dz < 12) { b.dz = rand(50, 80); b.cx = rand(-16, 16); b.cy = rand(7, 13); }
    const cz = P.z - b.dz, x = b.cx + Math.cos(b.a) * b.r, z = cz + Math.sin(b.a) * b.r * 0.7, y = b.cy + Math.sin(b.a * 1.7 + b.ph) * 0.8;
    b.m.position.set(x, y, z);
    b.m.rotation.set(0, -b.a - (b.w > 0 ? 0 : Math.PI), 0, 'YXZ'); b.m.rotation.z = -Math.sign(b.w) * 0.35;
    const flap = Math.sin(time * 0.9 + b.ph) > 0.2, ang = flap ? Math.sin(time * 9 + b.ph) * 0.6 : 0.08 + Math.sin(time * 1.3 + b.ph) * 0.05;
    for (const w of b.m.userData.wings) { w.piv.rotation.z = w.sd * ang; w.op.rotation.z = w.sd * ang * 0.6; }
  }
}

function makeSailboat(stripe) {
  const g = new THREE.Group();
  const hull = withOutline(new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 3.2, 4, 10).rotateX(Math.PI / 2).scale(1, 0.5, 1), toon('#f4f1e8')), 0.03); hull.position.y = 0.1; g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 3.2), toon('#b07a4a')); deck.position.y = 0.42; g.add(deck);
  const mast = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 6.5, 6), toon('#e8e2d4')), 0.02); mast.position.set(0, 3.6, -0.4); g.add(mast);
  const sc = document.createElement('canvas'); sc.width = 64; sc.height = 128; const x = sc.getContext('2d'); x.fillStyle = '#fbfaf5'; x.fillRect(0, 0, 64, 128); x.fillStyle = stripe; x.fillRect(0, 70, 64, 18); x.fillRect(0, 96, 64, 8);
  const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 6); sh.quadraticCurveTo(1.4, 2.6, 2.6, 0); sh.lineTo(0, 0);
  const sg = new THREE.ShapeGeometry(sh); const uv = sg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.6, uv.getY(i) / 6);
  const sail = withOutline(new THREE.Mesh(sg, toon('#ffffff', { map: st, side: THREE.DoubleSide })), 0.02); sail.rotation.y = -Math.PI / 2; sail.position.set(0, 0.7, -0.35); g.add(sail);
  return g;
}
const boats = [makeSailboat('#e8483a'), makeSailboat('#2f8fe0')];
boats.forEach((b, i) => { b.position.set((i ? 1 : -1) * rand(60, 110), 0, P.z - rand(120, 260)); b.rotation.y = rand(TAU); scene.add(b); });
function updateBoats() {
  for (const b of boats) {
    if (b.position.z > P.z + 30) { b.position.set((Math.random() < 0.5 ? -1 : 1) * rand(60, 110), 0, P.z - rand(220, 320)); b.rotation.y = rand(TAU); }
    b.position.y = waveH(b.position.x, b.position.z, 2) * 0.8; b.rotation.z = Math.sin(time * 0.8 + b.position.x) * 0.06; b.rotation.x = Math.sin(time * 0.6 + b.position.z) * 0.04;
  }
}

/* =========================================================================
   Partikel: Gischt, Funken (weiche Punkte)
   ========================================================================= */
const PART_N = 900;
const partGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PART_N * 3), pCol = new Float32Array(PART_N * 4), pSize = new Float32Array(PART_N);
partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
partGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
partGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
const partMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 } },
  vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
    void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); float z = max(-mv.z, .01);
      // dicht vor der Kamera ausblenden und Größe begrenzen – sonst blitzen riesige Flecken übers Bild
      vC.a *= smoothstep(1.2, 3., z);
      gl_PointSize = min(size * uScale / z, uScale * .06); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - .5; float r = length(d); float a = smoothstep(.5, .2, r); vec3 c = vC.rgb + (1. - smoothstep(0., .35, length(d + vec2(.12, .12)))) * .25; gl_FragColor = vec4(c, a * vC.a);
    #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false,
});
const partPoints = new THREE.Points(partGeo, partMat); partPoints.frustumCulled = false; partPoints.renderOrder = 3; scene.add(partPoints);
const parts = [];
const _c = new THREE.Color();
function addPart(x, y, z, vx, vy, vz, life, size, col, grav = 14) { if (parts.length >= PART_N) return; _c.set(col); parts.push({ x, y, z, vx, vy, vz, life, max: life, size, r: _c.r, g: _c.g, b: _c.b, grav }); }
function updateParts(dt) {
  let n = 0;
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; } p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  for (const p of parts) { const k = p.life / p.max; pPos[n * 3] = p.x; pPos[n * 3 + 1] = p.y; pPos[n * 3 + 2] = p.z; pCol[n * 4] = p.r; pCol[n * 4 + 1] = p.g; pCol[n * 4 + 2] = p.b; pCol[n * 4 + 3] = Math.min(1, k * 2.2) * 0.95; pSize[n] = p.size * (0.6 + 0.6 * (1 - k)); n++; }
  partGeo.setDrawRange(0, n);
  for (const a of ['position', 'color', 'size']) partGeo.attributes[a].needsUpdate = true;
}

/* ---------- Kielwelle: zwei Schaumbänder, folgen der gefahrenen Linie ---------- */
const WAKE_SEG = 36;
const trail = []; // {x, z, air}
const wakeGeo = new THREE.BufferGeometry();
const wPos = new Float32Array(2 * (WAKE_SEG + 1) * 2 * 3), wA = new Float32Array(2 * (WAKE_SEG + 1) * 2), wU = new Float32Array(2 * (WAKE_SEG + 1) * 2 * 2);
wakeGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage));
wakeGeo.setAttribute('alpha', new THREE.BufferAttribute(wA, 1).setUsage(THREE.DynamicDrawUsage));
wakeGeo.setAttribute('uv', new THREE.BufferAttribute(wU, 2).setUsage(THREE.DynamicDrawUsage));
{ const idx = []; for (let s = 0; s < 2; s++) { const o = s * (WAKE_SEG + 1) * 2; for (let i = 0; i < WAKE_SEG; i++) { const a = o + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } } wakeGeo.setIndex(idx); }
const wakeMat = new THREE.ShaderMaterial({
  vertexShader: `attribute float alpha; varying float vA; varying vec2 vUv; void main(){ vA = alpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `varying float vA; varying vec2 vUv; float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main(){ float edge = smoothstep(0., .35, vUv.x) * smoothstep(1., .55, vUv.x); float f = n(vec2(vUv.x * 4., vUv.y * 1.3)) * .6 + n(vec2(vUv.x * 9., vUv.y * 3.1)) * .4;
      float a = vA * edge * smoothstep(.25, .6, f + vA * .25); gl_FragColor = vec4(vec3(.95, .99, 1.), a * .9);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, depthTest: false,
});
const wake = new THREE.Mesh(wakeGeo, wakeMat); wake.frustumCulled = false; wake.renderOrder = 1; scene.add(wake);
function trailAt(z) {
  for (let i = trail.length - 1; i > 0; i--) { const a = trail[i - 1], b = trail[i]; if (a.z >= z && b.z <= z) { const t = (a.z - z) / Math.max(1e-3, a.z - b.z); return { x: lerp(a.x, b.x, t), air: a.air || b.air }; } }
  return null;
}
function updateWake() {
  const last = trail[trail.length - 1];
  if (!last || last.z - P.z > 0.25) trail.push({ x: P.x, z: P.z, air: P.air || !P.alive }); else { last.x = P.x; last.air = last.air && (P.air || !P.alive); }
  while (trail.length > 2 && trail[0].z > P.z + 30) trail.shift();
  for (let s = 0; s < 2; s++) {
    const sd = s ? 1 : -1;
    for (let i = 0; i <= WAKE_SEG; i++) {
      const d = i / WAKE_SEG * 18, z = P.z + 0.65 + d, w = trailAt(z), o = (s * (WAKE_SEG + 1) + i) * 2;
      const off = 0.22 + d * 0.32, hw = 0.12 + d * 0.06, cx = (w ? w.x : P.x) + sd * off;
      for (let e = 0; e < 2; e++) {
        const x = cx + (e ? 1 : -1) * hw, y = waveH(x, z, 3) + 0.04;
        wPos[(o + e) * 3] = x; wPos[(o + e) * 3 + 1] = y; wPos[(o + e) * 3 + 2] = z;
        wA[o + e] = w && !w.air ? (1 - d / 18) * smooth01(d / 0.6) : 0;
        wU[(o + e) * 2] = e; wU[(o + e) * 2 + 1] = (z) * 0.35;
      }
    }
  }
  for (const a of ['position', 'alpha', 'uv']) wakeGeo.attributes[a].needsUpdate = true;
}

/* =========================================================================
   Nachbearbeitung: Leuchten, Kantenglättung, Farbwiedergabe
   ========================================================================= */
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  partMat.uniforms.uScale.value = h * pixelRatio * 1.1;
}
let resizePending = false;
addEventListener('resize', () => { resizePending = true; });

/* =========================================================================
   Welten (Tageszeiten): Farben, Sonne, Licht und Wasser wechseln gemeinsam
   ========================================================================= */
const THEMES = {
  mittag: { name: 'Mittag', zenith: '#2a7fd4', horizon: '#c4e8f5', el: 48, az: 28, sunCol: '#fff2cf', cloud: '#ffffff', glow: 0, deep: '#05486e', shallow: '#1fb8c8', sss: '#5ff0e0', lagoon: '#38e0cf', sand: '#bff3dc',
    hemi: ['#cfeeff', '#1a6f8c', 1.15], sun: ['#fff1d6', 2.4], fill: ['#9fd8ff', 0.9], spec: 1, bloom: 0.28, ground: '#0d5f86', fogFar: 600 },
  abend: { name: 'Abend', zenith: '#2b3a8f', horizon: '#ffb27a', el: 12, az: 156, sunCol: '#ffcf86', cloud: '#ffb4a0', glow: 0.75, deep: '#173b6c', shallow: '#2b7494', sss: '#ff9a62', lagoon: '#47aba8', sand: '#f3c6a0',
    hemi: ['#ffc39a', '#283a6a', 1.05], sun: ['#ffae6a', 2.1], fill: ['#ff9fc4', 1.0], spec: 0.55, bloom: 0.42, ground: '#3a3f6e', fogFar: 520 },
};
const THEME_KEY = 'surfersSurf3d.world';
let themeId = 'mittag'; try { const t = localStorage.getItem(THEME_KEY); if (THEMES[t]) themeId = t; } catch (e) {}
function applyTheme(id) {
  const T = THEMES[id] || THEMES.mittag; themeId = id;
  ZENITH.set(T.zenith); HORIZON.set(T.horizon);
  SUN_DIR.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - T.el), THREE.MathUtils.degToRad(T.az));
  const su2 = skyMat.uniforms; su2.uSunCol.value.set(T.sunCol); su2.uCloud.value.set(T.cloud); su2.uGlow.value = T.glow;
  const wu = waterMat.uniforms; wu.uSun.value.copy(SUN_DIR); wu.uZenith.value.set(T.zenith); wu.uHorizon.value.set(T.horizon); wu.uSunCol.value.set(T.sunCol);
  wu.uDeep.value.set(T.deep); wu.uShallow.value.set(T.shallow); wu.uSss.value.set(T.sss); wu.uLagoon.value.set(T.lagoon); wu.uSand.value.set(T.sand); wu.uSpec.value = T.spec;
  scene.fog.color.set(T.horizon); scene.fog.far = T.fogFar;
  hemi.color.set(T.hemi[0]); hemi.groundColor.set(T.hemi[1]); hemi.intensity = T.hemi[2];
  sun.color.set(T.sun[0]); sun.intensity = T.sun[1]; fill.color.set(T.fill[0]); fill.intensity = T.fill[1];
  bloom.strength = T.bloom; envGround.color.set(T.ground);
  document.body.style.background = T.horizon;
  buildEnv();
  try { localStorage.setItem(THEME_KEY, id); } catch (e) {}
  document.querySelectorAll('.wbtn').forEach(b => b.classList.toggle('on', b.dataset.w === id));
}

/* =========================================================================
   Spielablauf
   ========================================================================= */
const BEST_KEY = 'surfersSurf3d.best';
let best = 0; try { best = +localStorage.getItem(BEST_KEY) || 0; } catch (e) {}
let recordShown = false;
let state = 'ready', runCoins = 0, startZ = 0, nextRowZ = -40, crashT = 0, shake = 0, hitStop = 0;
const CR = { body: new THREE.Vector3(), vel: new THREE.Vector3(), rot: 0, board: new THREE.Vector3(), bvel: new THREE.Vector3(), brot: new THREE.Vector3() };
const camState = { pos: new THREE.Vector3(0, 3, 7), look: new THREE.Vector3(), fov: 0 };
function reset() {
  for (const o of obstacles) scene.remove(o.mesh, o.foam); obstacles.length = 0; coins.length = 0;
  for (const u of pickups) scene.remove(u.g); pickups.length = 0; pw.magnet = pw.shield = pw.kite = pw.grace = 0;
  Object.assign(P, { lane: 0, x: 0, fromX: 0, toX: 0, laneT: 1, y: 0, vy: 0, air: false, airT: 0, speed: 14, lean: 0, landT: 0, alive: true, trick: null, duck: 0, duckBuf: false, jumpBuf: 0, bump: 0 });
  kiteEndZ = null; runCoins = 0; startZ = P.z; nextRowZ = P.z - 45; recordShown = false; $('coins').textContent = '0';
  surfer.root.rotation.set(0, 0, 0); surfer.root.position.set(0, 0, 0); board.rotation.set(0, 0, 0); board.position.set(0, 0, 0);
}
function pause() { if (state !== 'play') return; state = 'pause'; $('pause').hidden = false; }
function resume() { if (state !== 'pause') return; state = 'play'; $('pause').hidden = true; last = performance.now(); canvas.focus(); }
function showBest() { $('best').textContent = best > 0 ? `Rekord: ${best} m` : ''; }
function start() { const first = state === 'ready'; reset(); state = 'play'; camBlendT = first ? 0 : 1; $('start').hidden = true; $('over').hidden = true; $('hud').hidden = false; canvas.focus(); Sound.init(); Sound.fx.start(); }
const LANE_T = 0.15;           // Spurwechsel: kurz und knackig
const JUMP_V = 11, RAMP_V = 13.5, GRAV = 30;
// Schwerkraft mit kurzem Schweben am höchsten Punkt: Sprünge lesen sich klarer
const gravAt = vy => GRAV * (Math.abs(vy) < 2.5 ? 0.55 : 1);
function moveLane(d) { if (state !== 'play' || !P.alive) return; const nl = clamp(P.lane + d, -1, 1); if (nl === P.lane) { P.bump = 0.18 * d; return; } P.lane = nl; P.fromX = P.x; P.toX = nl * LANE_W; P.laneT = 0; Sound.fx.swish();
  for (let i = 0; i < 18; i++) addPart(P.x - d * 0.2, P.y + 0.1, P.z + rand(-0.4, 0.6), -d * rand(2, 5), rand(1.5, 4), rand(-1, 1) - P.speed * 0.6, rand(0.3, 0.55), rand(0.08, 0.16), '#ffffff'); }
const DUCK_T = 0.75, SPAWN_AHEAD = 150;
function duck() {
  if (state !== 'play' || !P.alive) return;
  if (P.air && pw.kite <= 0) { P.vy = Math.min(P.vy, -20); P.trick = null; P.duckBuf = true; P.jumpBuf = 0; return; } // in der Luft: schnell runter, dann ducken
  if (P.air) return;
  if (P.duck <= 0) Sound.fx.duck();
  P.duck = DUCK_T;
  for (let i = 0; i < 14; i++) addPart(P.x + rand(-0.5, 0.5), P.y + 0.1, P.z + rand(-0.3, 0.8), rand(-2.5, 2.5), rand(1.5, 3.5), rand(-1, 2) - P.speed * 0.6, rand(0.3, 0.55), rand(0.08, 0.15), '#ffffff');
}
function jump(v = JUMP_V) {
  if (state !== 'play' || !P.alive) return;
  if (P.air) { P.jumpBuf = 0.2; return; } // kurz vor der Landung gedrückt: springt direkt wieder ab
  P.air = true; P.vy = v; P.airT = 0; P.duck = 0; P.duckBuf = false; P.jumpBuf = 0;
  P.trick = Math.random() < 0.4 ? null : pick(['grab', 'shaka', 'spin']); P.trickT = 0; Sound.fx.jump();
  for (let i = 0; i < 16; i++) addPart(P.x + rand(-0.4, 0.4), P.y + 0.05, P.z + rand(-0.6, 0.6), rand(-1.5, 1.5), rand(2, 5), rand(-1, 1) - P.speed * 0.6, rand(0.3, 0.6), rand(0.08, 0.16), '#ffffff'); }
function launch(o) {
  o.used = true; jump(RAMP_V); P.trick = pick(['grab', 'shaka', 'spin']); popup('Schanze!', '#ffe9b0'); camKickV += 2;
}
function land() { if (P.trick && P.trickT > 0.35 && state === 'play') popup({ grab: 'Grab!', shaka: 'Shaka!', spin: '360!' }[P.trick], '#ffe9b0'); P.air = false; P.vy = 0; P.landT = 0.34; P.trick = null; camKickV -= 1.6; Sound.fx.land();
  for (let i = 0; i < 30; i++) { const a = rand(TAU); addPart(P.x + Math.cos(a) * 0.5, P.y + 0.05, P.z + Math.sin(a) * 0.9, Math.cos(a) * rand(1, 3.5), rand(1.5, 4), Math.sin(a) * rand(1, 3) - P.speed * 0.6, rand(0.3, 0.6), rand(0.09, 0.18), '#ffffff'); }
  if (P.jumpBuf > 0 && state === 'play') { P.jumpBuf = 0; jump(); return; }
  if (P.duckBuf) { P.duckBuf = false; P.duck = DUCK_T * 0.85; Sound.fx.duck(); } }
let camKick = 0, camKickV = 0, coinStreak = 0, lastCoinT = -9, camBlendT = 0;

/* ---------- Strecke: Reihen mit wechselnden Mustern, immer mit mindestens einem Weg ---------- */
const coinLine = (l, z, n = 6, y = 0.9) => { for (let i = 0; i < n; i++) addCoin(l * LANE_W, y, z + 10 - i * 2.2); };
const coinHop = (l, z) => { for (let i = -2; i <= 2; i++) addCoin(l * LANE_W, 1.2 + Math.cos(i / 2.5 * Math.PI / 2) * 1.7, z + i * 1.5); };
// Münzbogen genau auf der Flugbahn der Schanze (gleiche Physik wie im Spiel)
function coinArc(l, z0, v0) {
  const sp = P.speed + 0.5; let y = 0.3, vy = v0, t = 0, next = 0.12;
  while (t < 2) { const dt = 1 / 120; vy -= gravAt(vy) * dt; y += vy * dt; t += dt; if (y < 0.4 && vy < 0) break; if (t >= next) { addCoin(l * LANE_W, y + 0.9, z0 - sp * t); next += 0.1; } }
}
const PATTERNS = [
  // [Gewicht abhängig von Strecke d und Stufe lv, Muster] – liefert zusätzlichen Abstand zur nächsten Reihe
  [(d, lv) => 3 - lv, (z, f, o) => { let n = 0; for (const l of o) if (Math.random() < 0.75 || (n === 0 && l === o[1])) { addObstacle('rock', l, z); n++; } coinLine(f, z); }],
  [() => 1.6, (z, f, o) => { addObstacle('rock', pick(o), z); coinLine(f, z); }],
  [() => 2, (z, f, o) => { const l = pick([-1, 0, 1]); addObstacle('log', l, z); coinHop(l, z); }],
  [d => d > 40 ? 1.3 : 0, (z) => { const l = pick([-1, 0, 1]); addObstacle('turtle', l, z); coinHop(l, z); }],
  [d => d > 120 ? 1.1 : 0, (z, f) => { addObstacle('arch', 0, z); for (let i = 0; i < 5; i++) addCoin(f * LANE_W, 0.55, z + 4 - i * 2); }],
  // Motorboot kommt entgegen, später mit Fels daneben
  [(d, lv) => d > 180 ? 1 + lv : 0, (z, f, o, lv) => { const l = pick(o); addObstacle('boat', l, z - 6); if (lv > 0.3 && Math.random() < 0.6) addObstacle('rock', o.find(k => k !== l), z - 6); coinLine(f, z - 6, 7); return 10; }],
  // Hai pendelt zwischen zwei Spuren, Münzen in der dritten
  [d => d > 100 ? 1.2 : 0, (z) => { const pair = pick([[-1, 0], [0, 1]]), rest = [-1, 0, 1].find(k => !pair.includes(k)); addObstacle('shark', (pair[0] + pair[1]) / 2, z); coinLine(rest, z); }],
  // Bojen in zwei Spuren, in der dritten manchmal Treibholz
  [() => 1.4, (z, f, o, lv) => { for (const l of o) addObstacle('buoy', l, z + rand(-1, 1)); if (lv > 0.25 && Math.random() < 0.5) { addObstacle('log', f, z); coinHop(f, z); } else coinLine(f, z); }],
  // Steg: drunter ducken; später ist der Ausweg zu
  [d => d > 140 ? 1.3 : 0, (z, f, o, lv) => { const two = Math.random() < 0.5 + lv * 0.3, js = two ? o : [pick(o)]; for (const l of js) addObstacle('jetty', l, z);
    if (two && lv > 0.4 && Math.random() < 0.5) addObstacle('rock', f, z); else coinLine(f, z, 5);
    for (let i = 0; i < 4; i++) addCoin(js[0] * LANE_W, 0.5, z + 3 - i * 2); }],
  // Schanze mit Münzbogen in der Luft
  [d => d > 70 ? 1.1 : 0, (z, f, o, lv) => { const l = pick([-1, 0, 1]); addObstacle('ramp', l, z); for (const k of [-1, 0, 1]) if (k !== l && (lv > 0.2 || Math.random() < 0.5)) addObstacle('rock', k, z - 1); coinArc(l, z + 2, RAMP_V); return 8; }],
  // Mauer: zwei Felsen, in der freien Spur Treibholz – springen!
  [(d, lv) => d > 260 ? 0.5 + lv : 0, (z, f, o) => { for (const l of o) addObstacle('rock', l, z); addObstacle('log', f, z); coinHop(f, z); }],
];
function spawnRow(z) {
  if (kiteEndZ !== null && z > kiteEndZ - 12) return 0; // unter dem Drachenflug: Münzen liegen schon in der Luft
  const lanes = [-1, 0, 1], f = pick(lanes), o = lanes.filter(l => l !== f), d = startZ - z, lv = clamp((d - 200) / 1600, 0, 1);
  if (Math.random() < 0.12 && d > 60) addPickup(pick(['magnet', 'shield', 'kite']), f, z + 9);
  const ws = PATTERNS.map(([w]) => w(d, lv)), sum = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum, i = 0; while (r > ws[i]) r -= ws[i++];
  return PATTERNS[Math.min(i, PATTERNS.length - 1)][1](z, f, o, lv) || 0;
}
function collide() {
  const wy = waveH(P.x, P.z, 3), above = P.y - wy;
  for (const o of obstacles) {
    if (o.hit || o.used || time - o.born < 0.3) continue;
    if (Math.abs(o.z - P.z) > o.d / 2 + 0.55) continue;
    if (Math.abs(o.x - P.x) > o.w / 2 + 0.3) continue;
    if (o.ramp) { if (!P.air && pw.kite <= 0) launch(o); continue; }
    if (pw.kite > 0 || pw.grace > 0) continue;
    if (above > o.h * (o.jump ? 0.7 : 1)) continue;   // drübergesprungen
    if (o.duck && P.duck > 0 && !P.air) continue;     // drunter geduckt
    if (pw.shield > 0) { popShield(o); return; }
    o.hit = true; crash(o); return;
  }
  for (const c of coins) { if (c.taken) continue; if (Math.abs(c.z - P.z) < 0.9 && Math.abs(c.x - P.x) < 1.0 && Math.abs(c.y - (P.y + 0.9)) < 1.3) { c.taken = true; runCoins++; $('coins').textContent = runCoins; coinStreak = time - lastCoinT < 0.6 ? coinStreak + 1 : 0; lastCoinT = time; Sound.fx.coin(coinStreak);
    // Funken fliegen mit dem Surfer mit (sonst rast die Kamera durch sie hindurch)
    for (let i = 0; i < 8; i++) addPart(c.x, c.y, c.z, rand(-2, 2), rand(0, 3), rand(-2, 2) - P.speed, rand(0.25, 0.45), rand(0.08, 0.14), pick(['#fff4a0', '#ffd23f']), 4); } }
}
let lastCrash = null;
function crash(o) {
  lastCrash = o; P.alive = false; state = 'crash'; crashT = 0; shake = 0.9; hitStop = 0.12; Sound.fx.crash();
  CR.body.set(0, 0, 0); if (o.type === 'rock') CR.vel.set((Math.random() < 0.5 ? -1 : 1) * rand(1.5, 2.5), 5.5, 3.5); else CR.vel.set(rand(-1, 1), 5.5, -P.speed * 0.25); CR.rot = 0; CR.wet = false;
  CR.board.set(0, 0, 0); CR.bvel.set(rand(-2, 2), 7.5, -P.speed * 0.2); CR.brot.set(rand(-6, 6), rand(-4, 4), rand(8, 12));
  for (let i = 0; i < 60; i++) addPart(P.x + rand(-0.8, 0.8), P.y + rand(0, 1.2), P.z + rand(-0.6, 0.4), rand(-4, 4), rand(2, 7), rand(-6, 1), rand(0.6, 1.1), rand(0.1, 0.24), '#ffffff');
  if (o.type === 'rock') for (let i = 0; i < 14; i++) addPart(o.x + rand(-0.6, 0.6), rand(0.5, 2), o.z + 0.5, rand(-3, 3), rand(2, 5), rand(0, 3), 1, rand(0.12, 0.22), '#6f7a8a');
}
function update(dt) {
  time += dt;
  const play = state === 'play';
  if (play) P.speed = Math.min(30, P.speed + dt * 0.35);
  Sound.wind(play ? clamp((P.speed - 12) / 30, 0, 0.45) : 0.04);
  if (state === 'ready') { P.speed = 12; P.x = Math.sin(time * 0.5) * 1.2; P.lean = Math.cos(time * 0.5) * 0.35; }
  if (state !== 'crash') {
    P.z -= P.speed * dt;
    if (state === 'play') {
      if (P.laneT < 1) { P.laneT = Math.min(1, P.laneT + dt / LANE_T); const e = 1 - Math.pow(1 - P.laneT, 3); P.x = lerp(P.fromX, P.toX, e); }
      // gegen den Rand gewischt: kurzes Anstoßen statt gar keiner Reaktion
      if (P.bump) { const b = P.bump; P.bump = Math.abs(b) < 0.01 ? 0 : b - Math.sign(b) * Math.min(Math.abs(b), dt * 1.5); P.x = P.lane * LANE_W + Math.sin(Math.abs(P.bump) / 0.18 * Math.PI) * Math.sign(b) * 0.25; }
      const vx = (P.x - (P.px ?? P.x)) / Math.max(dt, 1e-4); P.lean = damp(P.lean, clamp(vx / 16, -1, 1), 14, dt);
      P.jumpBuf = Math.max(0, (P.jumpBuf || 0) - dt);
    }
    P.px = P.x;
    const wy = waveH(P.x, P.z) + 0.06;
    if (pw.kite > 0 && state === 'play') { P.air = true; P.vy = 0; P.airT += dt; P.y = damp(P.y, wy + 5.4, 2.4, dt); }
    else if (P.air) { P.airT += dt; P.vy -= gravAt(P.vy) * dt; P.y += P.vy * dt; if (P.trick) P.trickT += dt; if (P.y <= wy && P.vy < 0) { P.y = wy; land(); } }
    else P.y = damp(P.y, wy, 30, dt);
    P.landT = Math.max(0, P.landT - dt); P.duck = Math.max(downHeld && !P.air && state === 'play' && P.duck > 0 ? 0.2 : 0, P.duck - dt);
    // Gischt an den Kanten des Bretts
    if (!P.air) {
      const n = Math.floor(rand(2, 4) + P.speed * 0.1);
      for (let i = 0; i < n; i++) { const sd = Math.random() < 0.5 ? -1 : 1; addPart(P.x + sd * 0.3, P.y + 0.04, P.z + rand(0.1, 0.8), sd * rand(1.2, 3.6) - P.lean * 2.5, rand(1.4, 3.6), rand(-P.speed * 0.15, 0.5), rand(0.3, 0.55), rand(0.05, 0.11), Math.random() < 0.3 ? '#c8f8ff' : '#ffffff'); }
      if (Math.random() < 0.6) { const sd = Math.random() < 0.5 ? -1 : 1; addPart(P.x + sd * 0.4, P.y + 0.15, P.z + rand(0.3, 1), sd * rand(0.5, 1.5), rand(0.5, 1.2), rand(-P.speed * 0.2, 0), rand(0.5, 0.9), rand(0.25, 0.45), '#eafcff', 2); }
    }
    if (play) {
      collide();
      while (nextRowZ > P.z - SPAWN_AHEAD) { const extra = spawnRow(nextRowZ); nextRowZ -= rand(17, 25) * (1 + (P.speed - 14) / 40) + extra; }
      const dist = Math.floor(startZ - P.z); $('dist').textContent = dist + ' m';
      if (!recordShown && best > 50 && dist > best) { recordShown = true; popup('Neuer Rekord!', '#b8ffb0'); Sound.fx.record(); }
    }
  } else {
    crashT += dt;
    CR.vel.y -= 18 * dt; CR.body.addScaledVector(CR.vel, dt); const surf = waveH(P.x + CR.body.x, P.z + CR.body.z) - 0.55 - P.y; if (CR.body.y < surf) { if (!CR.wet) { CR.wet = true; for (let i = 0; i < 40; i++) { const a = rand(TAU); addPart(P.x + CR.body.x + Math.cos(a) * 0.4, P.y + CR.body.y + 0.5, P.z + CR.body.z + Math.sin(a) * 0.4, Math.cos(a) * rand(1, 4), rand(2, 6), Math.sin(a) * rand(1, 4), rand(0.5, 1), rand(0.1, 0.22), '#ffffff'); } } CR.body.y = surf; CR.vel.set(CR.vel.x * 0.9, 0, CR.vel.z * 0.9); CR.rot = damp(CR.rot, Math.PI * 0.5, 4, dt); } else CR.rot += dt * 7;
    CR.bvel.y -= 18 * dt; CR.board.addScaledVector(CR.bvel, dt); if (CR.board.y + P.y < waveH(P.x + CR.board.x, P.z + CR.board.z) - P.y * 0) { CR.bvel.set(CR.bvel.x * 0.5, Math.abs(CR.bvel.y) * 0.25, CR.bvel.z * 0.5); CR.brot.multiplyScalar(0.6); }
    board.rotation.x += CR.brot.x * dt; board.rotation.y += CR.brot.y * dt; board.rotation.z += CR.brot.z * dt;
    if (crashT > 1.3 && $('over').hidden) {
      const dist = Math.floor(startZ - P.z), rec = dist > best;
      if (rec) { best = dist; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }
      $('overText').textContent = rec && dist > 20 ? 'Neuer Rekord!' : pick(['Platsch!', 'Wipeout!', 'Autsch!']);
      $('overStats').textContent = `${dist} m · ${runCoins} Münzen · Rekord ${best} m`;
      $('over').hidden = false; $('hud').hidden = true; showBest();
    }
  }
  // Hindernisse treiben auf den Wellen, tauchen weit vorn sanft auf und verschwinden hinter der Kamera
  for (let i = obstacles.length - 1; i >= 0; i--) { const o = obstacles[i]; if (o.z > P.z + 15) { scene.remove(o.mesh, o.foam); obstacles.splice(i, 1); continue; }
    if (o.type === 'arch' || o.type === 'jetty') o.mesh.visible = o.z < P.z + 0.9; // hinter dem Surfer ausblenden, sonst verdeckt er die Sicht
    if (o.type === 'boat') { // fährt los, wenn der Surfer nah ist
      if (!o.moving && P.z - o.z < 46 && play) { o.moving = true; Sound.fx.horn(); }
      if (o.moving && state !== 'crash') { o.z += 5 * dt; if (Math.random() < 0.7) { const sd = Math.random() < 0.5 ? -1 : 1; addPart(o.x + sd * 0.7, 0.2, o.z + 2.2, sd * rand(1, 3), rand(1, 3), rand(2, 5), rand(0.4, 0.7), rand(0.12, 0.22), '#ffffff'); } }
      const arm = o.mesh.getObjectByName('arm'); if (arm) arm.rotation.z = -0.6 + Math.sin(time * 9 + o.ph) * 0.5;
      const fl = o.mesh.getObjectByName('flag'); if (fl) fl.rotation.x = Math.sin(time * 12 + o.ph) * 0.25;
    }
    if (o.type === 'shark') { const a = time * 1.5 + o.ph; o.x = o.cx + Math.sin(a) * LANE_W * 0.55; o.mesh.scale.x = Math.cos(a) > 0 ? -1 : 1; if (Math.random() < 0.4) addPart(o.x, 0.1, o.z, rand(-1, 1), rand(0.5, 1.5), rand(-0.5, 0.5), 0.4, rand(0.08, 0.14), '#ffffff'); }
    const h = waveH(o.x, o.z, 3), e = smooth01((time - o.born) / 0.5), grow = Math.max(0.01, easeOutBack(e));
    const baseY = { log: h + 0.12, turtle: h - 0.05, arch: 0, boat: h * 0.8, shark: h, buoy: h * 0.9 - 0.15, jetty: h * 0.5, ramp: h * 0.7 }[o.type] ?? h * 0.4 - 0.25;
    o.mesh.position.set(o.x, baseY - (1 - e) * 1.5, o.z);
    if (o.type === 'shark') o.mesh.scale.set(Math.sign(o.mesh.scale.x) * grow, grow, grow); else o.mesh.scale.setScalar(grow);
    if (o.type === 'turtle') { for (const f of o.mesh.userData.fl) f.piv.rotation.z = Math.sin(time * 3 + o.ph + (f.big ? 0 : 1.5)) * (f.big ? 0.5 : 0.3) * f.sx; o.mesh.rotation.y = Math.sin(time * 0.7 + o.ph) * 0.25; o.z -= dt * 0.8; }
    if (o.type === 'log' || o.type === 'buoy' || o.type === 'boat' || o.type === 'ramp') { waveN(o.x, o.z); const k = o.type === 'buoy' ? 1.6 : o.type === 'log' ? 0.8 : 0.4; o.mesh.rotation.z = _n.x * -k; o.mesh.rotation.x = _n.z * k + (o.type === 'buoy' ? Math.sin(time * 1.7 + o.ph) * 0.06 : 0); }
    if (!o.foam.isGroup) { const fs = o.foam.userData.s; o.foam.scale.set(fs[0] * e, 1, fs[1] * e); }
    o.foam.position.set(o.x, h + 0.05, o.z); o.foam.rotation.y = o.type === 'boat' || o.type === 'ramp' || o.type === 'jetty' ? 0 : time * 0.3 + o.ph; }
  lampMat.emissiveIntensity = Math.sin(time * 4) > 0.3 ? 2.2 : 0.4;
  for (let i = coins.length - 1; i >= 0; i--) { const c = coins[i]; if (c.z > P.z + (c.taken ? 12 : 2)) coins.splice(i, 1); else if (c.taken) c.t += dt; } // verpasste Münzen nicht an der Kamera vorbeiblitzen lassen
  for (const isl of islands) if (isl.position.z > P.z + 40) { isl.position.z -= islands.length * 38; isl.position.x = isl.userData.side * rand(16, 30); isl.rotation.y = rand(TAU); }
  islands.forEach((isl, i) => waterMat.uniforms.uIsl.value[i].set(isl.position.x, isl.position.z, isl.userData.r * 0.97, 0));
  updatePowers(dt); updatePopups(dt); updateDolphins(dt); updateGulls(dt); updateBoats(); updateMountains();
  updateParts(dt);
}

/* ---------- Zeichnen ---------- */
function syncScene(dt) {
  // Spieler auf der Welle: Position, Neigung nach Wellennormale, Schräglage in der Kurve
  player.position.set(P.x, P.y, P.z);
  if (state !== 'crash') {
    waveN(P.x, P.z);
    const tgtPitch = Math.atan2(-_n.z, _n.y) * 0.8, tgtRoll = Math.atan2(_n.x, _n.y) * 0.8 - P.lean * 0.35;
    player.rotation.x = damp(player.rotation.x, P.air ? -0.12 + Math.min(0.3, P.vy * 0.02) : tgtPitch, 8, dt);
    player.rotation.z = damp(player.rotation.z, P.air ? 0 : tgtRoll, 8, dt);
    let spin = 0; if (P.trick === 'spin' && P.air) spin = smooth01(P.trickT / 0.6) * TAU;
    player.rotation.y = -P.lean * 0.25 + spin;
    pose(time, dt);
  } else {
    surfer.root.position.copy(CR.body); surfer.root.rotation.set(CR.wet ? -CR.rot : CR.rot * 0.7, 0, CR.wet ? Math.sin(time * 3) * 0.15 : CR.rot); board.position.copy(CR.board); if (CR.wet) pose(time, dt);
    player.rotation.set(0, 0, 0);
  }
  shieldMesh.visible = pw.shield > 0 && state === 'play' && (pw.shield > 2 || Math.floor(time * 8) % 2 === 0);
  if (shieldMesh.visible) { shieldMesh.position.set(P.x, P.y + 1.05, P.z); const w = Math.sin(time * 5) * 0.03; shieldMesh.scale.set(1 + w, 1 - w, 1 + w); }
  kite.visible = pw.kite > 0 && state === 'play' && (pw.kite > 1.2 || Math.floor(time * 8) % 2 === 0);
  if (kite.visible) {
    kite.position.set(P.x + Math.sin(time * 0.9) * 0.4, P.y + 3.6, P.z - 1.2); kite.rotation.set(-0.25, 0, Math.sin(time * 1.3) * 0.1);
    const la = kite.userData.lines.geometry.attributes.position, hl = surfer.parts.handL.getWorldPosition(_v1), hr = surfer.parts.handR.getWorldPosition(_v2);
    la.setXYZ(0, hl.x, hl.y, hl.z); la.setXYZ(1, kite.position.x - 1.5, kite.position.y + 0.2, kite.position.z); la.setXYZ(2, hr.x, hr.y, hr.z); la.setXYZ(3, kite.position.x + 1.5, kite.position.y + 0.2, kite.position.z); la.needsUpdate = true;
  }
  kite.userData.lines.visible = kite.visible;
  blob.position.set(P.x, waveH(P.x, P.z, 3) + 0.05, P.z + 0.05);
  const hAir = Math.max(0, P.y - waveH(P.x, P.z, 3)); blob.material.opacity = state === 'crash' ? 0 : clamp(1 - hAir * 0.12, 0.45, 1); blob.scale.setScalar(clamp(1 - hAir * 0.08, 0.6, 1));
  // Münzen
  let n = 0;
  for (const c of coins) {
    const k = c.taken ? smooth01(c.t / 0.25) : 0; if (k >= 1) continue;
    const g = easeOutBack(smooth01((time - c.born) / 0.45));
    _p.set(lerp(c.x, P.x, k), lerp(c.y, P.y + 1.4, k), lerp(c.z, P.z, k)); _q.setFromAxisAngle(UP, time * 3 + c.z * 0.3); _s.setScalar(Math.max(0.01, g * (1 - k * 0.6)));
    _m4.compose(_p, _q, _s); coinMesh.setMatrixAt(n++, _m4);
  }
  coinMesh.count = n; coinMesh.instanceMatrix.needsUpdate = true; _s.set(1, 1, 1);
  updateBuoys(); updateWake();
  // Wasser und ferne Kulisse folgen der Kamera
  water.position.set(Math.round(P.x / 0.5) * 0.5, 0, Math.round(P.z / 0.5) * 0.5);
  sky.position.copy(camera.position);
  waterMat.uniforms.uTime.value = time; skyMat.uniforms.uTime.value = time; waterMat.uniforms.uCam.value.copy(camera.position);
  // Kamera: hinter dem Surfer, federt bei der Landung, weitet sich mit Tempo
  camKickV += (-170 * camKick - 15 * camKickV) * Math.min(dt, 1 / 30); camKick += camKickV * Math.min(dt, 1 / 30);
  // hoch und weiter hinten, Blick weit nach vorn: alle drei Spuren und kommende Hindernisse gut sichtbar.
  // Hochformat (Handy): noch höher, weiter weg und breiter, damit die äußeren Spuren im Bild bleiben
  const ka = clamp((camera.aspect - 0.5) / 0.8, 0, 1);
  const back = lerp(8.2, 6.4, ka), up = lerp(5.6, 4.6, ka), follow = lerp(0.3, 0.45, ka), ahead = lerp(11, 9, ka);
  const flying = pw.kite > 0 && state === 'play', tx = state === 'crash' ? P.x : P.x * follow, ty = flying ? P.y + 2.4 + camKick : (state === 'crash' ? P.y : Math.max(P.y, 0)) * 0.3 + up + camKick, tz = P.z + back;
  camState.pos.x = damp(camState.pos.x, tx, 7, dt); camState.pos.y = damp(camState.pos.y, ty, 5, dt); camState.zOff = damp(camState.zOff || 0, flying ? 1.5 : 0, 3, dt); camState.pos.z = tz + camState.zOff;
  camState.look.set(camState.pos.x * 0.5 + P.x * 0.25, flying ? P.y + 0.2 : (state === 'crash' ? P.y : Math.max(P.y, 0)) * 0.25 + 0.3, P.z - ahead);
  camera.position.copy(camState.pos);
  // Startbildschirm: Kamera kreist langsam um den Surfer, beim Start weicher Übergang in die Verfolgerkamera
  if (state === 'ready' || camBlendT < 1) {
    if (state !== 'ready') camBlendT = Math.min(1, camBlendT + dt / 1.3);
    const e = state === 'ready' ? 0 : smooth01(camBlendT), a = time * 0.16 + 0.5, R = camera.aspect < 0.8 ? 7.5 : 6.2;
    _v3.set(P.x + Math.sin(a) * R, P.y + 2.3, P.z + Math.cos(a) * R);
    camera.position.lerpVectors(_v3, camState.pos, e);
    camState.look.lerpVectors(_v2.set(P.x, P.y + (camera.aspect < 0.8 ? 3.6 : 3.1), P.z), camState.look, e);
  }
  if (shake > 0) { camera.position.x += (Math.sin(time * 61) + Math.sin(time * 37)) * shake * 0.08; camera.position.y += (Math.sin(time * 53) + Math.sin(time * 29)) * shake * 0.08; }
  camera.lookAt(camState.look);
  if (window.surf3d && surf3d.camOverride) { const o = surf3d.camOverride, l = surf3d.lookOverride; camera.position.set(P.x + o[0], P.y + o[1], P.z + o[2]);
    if (surf3d.lookAtGull) camera.lookAt(gulls[0].m.position); else if (l) camera.lookAt(P.x + l[0], l[1], P.z + l[2]); else camera.lookAt(P.x, P.y + 1.0, P.z); }
  const fovT = lerp(76, 58, ka) + clamp((P.speed - 14) / 16, 0, 1) * 6;
  camState.fov = damp(camState.fov || fovT, fovT, 2, dt);
  if (Math.abs(camera.fov - camState.fov) > 0.01) { camera.fov = camState.fov; camera.updateProjectionMatrix(); }
  sun.target.position.copy(player.position); sun.position.copy(player.position).addScaledVector(SUN_DIR, 60);
  fill.target.position.copy(player.position); fill.position.copy(player.position).add(_v1.set(-4, 6, 12));
}

/* ---------- Schleife mit automatischer Auflösung ---------- */
let last = performance.now(), acc = 0, frames = 0, goodFor = 0, lowered = 0;
// Bildrate halten: Auflösung stufenweise anpassen. Wird VOR dem Zeichnen geändert – eine Größenänderung
// nach dem Zeichnen leert die Leinwand, dann blitzt für ein Bild der Seitenhintergrund durch (orangenes Flackern).
function adaptResolution(dtReal) {
  if (TEST || state !== 'play') { acc = 0; frames = 0; return; }
  acc += dtReal; frames++;
  if (acc < 2) return;
  const fps = frames / acc; acc = 0; frames = 0;
  if (fps < 45 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, +(pixelRatio - 0.15).toFixed(2)); lowered++; goodFor = 0; resize(); }
  // nur selten wieder hoch, und nach mehrmaligem Absenken gar nicht mehr (sonst Pendeln)
  else if (fps > 58 && pixelRatio < MAX_DPR && lowered < 3 && ++goodFor > 5) { pixelRatio = Math.min(MAX_DPR, +(pixelRatio + 0.1).toFixed(2)); goodFor = 0; resize(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  if (resizePending) { resizePending = false; resize(); }
  if (state === 'pause') { composer.render(dtReal); return; }
  adaptResolution(dtReal);
  if (hitStop > 0) hitStop -= dtReal; else if (!(window.surf3d && surf3d.freeze)) update(dtReal);
  shake = Math.max(0, shake - dtReal * 1.8);
  syncScene(dtReal);
  composer.render(dtReal);
}

/* ---------- Eingaben ---------- */
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if ((k === 'escape' || k === 'p') && (state === 'play' || state === 'pause')) { state === 'play' ? pause() : resume(); e.preventDefault(); return; }
  if (state === 'pause') { if (k === ' ' || k === 'enter') { resume(); e.preventDefault(); } return; }
  if (state !== 'play' && (k === ' ' || k === 'enter') && (state === 'ready' || !$('over').hidden)) { start(); e.preventDefault(); return; }
  if (k === 'arrowleft' || k === 'a') moveLane(-1);
  else if (k === 'arrowright' || k === 'd') moveLane(1);
  else if (k === 'arrowup' || k === 'w' || k === ' ') jump();
  else if (k === 'arrowdown' || k === 's') { downHeld = true; duck(); }
  else return;
  e.preventDefault();
});
// Runter gedrückt halten: bleibt geduckt
let downHeld = false;
addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k === 'arrowdown' || k === 's') downHeld = false; });
addEventListener('blur', () => { downHeld = false; });
// Wischen reagiert sofort, sobald der Finger weit genug gewandert ist – nicht erst beim Loslassen.
// Ohne Absetzen kann man weiterwischen (z. B. erst zur Seite, dann hoch).
let touch = null;
const swipeTh = () => clamp(Math.min(innerWidth, innerHeight) * 0.045, 16, 42);
canvas.addEventListener('pointerdown', e => {
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), acted: false };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => {
  if (!touch || e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x, dy = e.clientY - touch.y, th = swipeTh() * (touch.acted ? 1.4 : 1);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < th) return;
  if (Math.abs(dx) > Math.abs(dy) * 0.9) moveLane(dx > 0 ? 1 : -1); else if (dy < 0) jump(); else duck();
  touch.x = e.clientX; touch.y = e.clientY; touch.acted = true;
});
const endTouch = (e, tap) => {
  if (!touch || e.pointerId !== touch.id) return;
  if (tap && !touch.acted && performance.now() - touch.t < 300) jump(); // kurzes Tippen springt
  touch = null;
};
canvas.addEventListener('pointerup', e => endTouch(e, true));
canvas.addEventListener('pointercancel', e => endTouch(e, false));
$('go').addEventListener('click', start);
document.querySelectorAll('.wbtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); applyTheme(b.dataset.w); }));
applyTheme(themeId);
$('pauseBtn').addEventListener('click', e => { e.stopPropagation(); pause(); });
$('resume').addEventListener('click', resume);
$('quit').addEventListener('click', () => { $('pause').hidden = true; state = 'ready'; reset(); $('hud').hidden = true; $('start').hidden = false; camBlendT = 0; showBest(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
showBest();
const sndBtn = $('snd'), syncSnd = () => { sndBtn.className = 'snd ' + (Sound.isOn() ? 'on' : 'off'); };
sndBtn.addEventListener('click', e => { e.stopPropagation(); Sound.toggle(); syncSnd(); canvas.focus(); }); syncSnd();
// Meeresrauschen schon im Startbildschirm, sobald der Browser Ton erlaubt (erste Berührung/Taste)
const wakeAudio = () => { Sound.init(); removeEventListener('pointerdown', wakeAudio); removeEventListener('keydown', wakeAudio); };
addEventListener('pointerdown', wakeAudio); addEventListener('keydown', wakeAudio);
$('again').addEventListener('click', start);
// Wechsel zur 2D-Version merken, damit die Web-App beim nächsten Start dort weitermacht
document.querySelectorAll('a.to2d').forEach(a => a.addEventListener('click', () => { try { localStorage.setItem('surfersSurf.mode', '2d'); } catch (e) {} }));

resize();
requestAnimationFrame(t => { last = t; frame(t); });
// Testzugang für automatische Bildprüfung
window.surf3d = { P, get state() { return state; }, get time() { return time; }, get startZ() { return startZ; }, get runCoins() { return runCoins; }, get lastCrash() { return lastCrash; }, obstacles, coins, step: dt => { update(dt); syncScene(dt); }, duck, start, jump, moveLane, addObstacle, setDpr: v => { pixelRatio = v; resize(); }, bloom, renderer, scene, sky, water, composer, wakeGeo, trail, CR, surfer, board, player, camera, dolphins, gulls, boats, pw, addPickup, activate, applyTheme };
