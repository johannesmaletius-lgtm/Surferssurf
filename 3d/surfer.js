// Der Surfer: lädt models/surfer.glb (gebaut von tools/build-surfer.mjs), Cartoon-Material mit Kontur,
// und die Posen auf dem Brett (Gelenkpunkte per IK, daraus die Knochen-Lagen aus rig.js).
import * as THREE from './vendor/three.min.js';
import { BONES, REST, LEN, HIP_OFS, SHOULDER_OFS, ANKLE_H, BONE, boneFrames, fromFrame } from './rig.js';

/* ---------- glTF-Binärdatei lesen (nur was das Modell braucht) ---------- */
function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('keine GLB-Datei');
  const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binOfs = 20 + jl + 8;
  const TYPES = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array, 5125: Uint32Array }, SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
  const acc = i => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = TYPES[a.componentType];
    return { arr: new T(buf, binOfs + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * SIZE[a.type]), n: SIZE[a.type], norm: !!a.normalized }; };
  const prim = json.meshes[0].primitives[0], at = prim.attributes, skin = json.skins[0];
  return { json, acc, at, prim, skin, names: skin.joints.map(j => json.nodes[j].name) };
}

// weiche Cartoon-Stufen: klare Licht/Schatten-Flächen, aber ohne ausgefranste Ränder
let _ramp = null;
function softRamp() {
  if (_ramp) return _ramp;
  const N = 64, d = new Uint8Array(N), steps = [[0, 92], [0.42, 150], [0.62, 212], [0.8, 255]];
  for (let i = 0; i < N; i++) { const x = i / (N - 1); let v = steps[0][1]; for (let k = 1; k < steps.length; k++) { const t = Math.min(1, Math.max(0, (x - steps[k][0]) / 0.06 + 0.5)); v += (steps[k][1] - steps[k - 1][1]) * t * t * (3 - 2 * t); } d[i] = Math.round(v); }
  _ramp = new THREE.DataTexture(d, N, 1, THREE.RedFormat); _ramp.minFilter = _ramp.magFilter = THREE.LinearFilter; _ramp.needsUpdate = true;
  return _ramp;
}
function outlineMaterial(color, width) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTh: { value: width }, uCol: { value: new THREE.Color(color) } }]),
    vertexShader: /* glsl */`uniform float uTh; attribute float outline;
      #include <common>
      #include <skinning_pars_vertex>
      #include <fog_pars_vertex>
      void main(){
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        transformed += normalize(objectNormal) * uTh * outline;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform vec3 uCol;
      #include <fog_pars_fragment>
      void main(){ gl_FragColor = vec4(uCol, 1.);
        #include <fog_fragment>
      }`,
    side: THREE.BackSide, fog: true,
  });
}

// Lädt das Modell und gibt den Surfer zurück: root (Gruppe), bones, pose(st) und Hilfen
export async function loadSurfer(url, { gradientMap, outlineColor = '#0a1020', outlineWidth = 0.017 } = {}) {
  const res = await fetch(url); if (!res.ok) throw new Error('Modell fehlt: ' + url);
  const g = parseGLB(await res.arrayBuffer());
  const geo = new THREE.BufferGeometry();
  const pos = g.acc(g.at.POSITION), nrm = g.acc(g.at.NORMAL), col = g.acc(g.at.COLOR_0), jn = g.acc(g.at.JOINTS_0), wt = g.acc(g.at.WEIGHTS_0), idx = g.acc(g.prim.indices);
  const n = pos.arr.length / 3, c3 = new Float32Array(n * 3), ol = new Float32Array(n);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) c3[i * 3 + k] = col.arr[i * 4 + k] / 65535; ol[i] = col.arr[i * 4 + 3] / 65535; }
  // Knochen-Nummern der Datei auf die Reihenfolge in rig.js abbilden
  const remap = g.names.map(nm => BONES.indexOf(nm)), ji = new Uint8Array(jn.arr.length);
  for (let i = 0; i < ji.length; i++) ji[i] = remap[jn.arr[i]];
  geo.setAttribute('position', new THREE.BufferAttribute(pos.arr.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm.arr.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(c3, 3));
  geo.setAttribute('outline', new THREE.BufferAttribute(ol, 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wt.arr.slice(), 4, true));
  geo.setIndex(new THREE.BufferAttribute(idx.arr.slice(), 1));
  const ibm = g.acc(g.skin.inverseBindMatrices).arr;

  const root = new THREE.Group(); root.name = 'surfer';
  const bones = BONES.map(name => { const b = new THREE.Bone(); b.name = name; b.matrixAutoUpdate = false; root.add(b); return b; });
  const inverses = BONES.map(name => new THREE.Matrix4().fromArray(ibm, g.names.indexOf(name) * 16));
  const skeleton = new THREE.Skeleton(bones, inverses);
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp() });
  const mesh = new THREE.SkinnedMesh(geo, mat), outline = new THREE.SkinnedMesh(geo, outlineMaterial(outlineColor, outlineWidth));
  for (const m of [mesh, outline]) { m.frustumCulled = false; root.add(m); m.bind(skeleton, new THREE.Matrix4()); }

  const J = makeJoints(), F = new Float32Array(BONES.length * 16);
  const s = { root, bones, mesh, outline, skeleton, J, frames: F, sec: { hx: 0, hvx: 0 },
    // Gelenkpunkte → Knochen
    apply() { boneFrames(J, F); for (let i = 0; i < bones.length; i++) { bones[i].matrix.fromArray(F, i * 16); bones[i].matrixWorldNeedsUpdate = true; } },
    pose(st) { surfPose(s, st); s.apply(); },
    rest() { for (const k in REST) J[k] = REST[k].slice(); s.apply(); },
    // Punkt an der Hand (für die Drachenleinen), in Weltkoordinaten
    handWorld(side, out) { const i = BONE['hand' + side]; fromFrame(F, i, [0, 0.07, 0], _a); return root.localToWorld(out.set(_a[0], _a[1], _a[2])); },
  };
  s.rest();
  return s;
}
const _a = [0, 0, 0];

/* ---------- Posen ---------- */
function makeJoints() { const J = {}; for (const k in REST) J[k] = REST[k].slice(); return J; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const set = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
const addTo = (o, a, x, y, z) => set(o, a[0] + x, a[1] + y, a[2] + z);
const nrm = o => { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
const lerpTo = (o, b, t) => set(o, lerp(o[0], b[0], t), lerp(o[1], b[1], t), lerp(o[2], b[2], t));

// Zwei-Glied-IK: Knie/Ellbogen aus Start a, Ziel t, Längen, Beugerichtung; side = Richtung, in die das Gelenk zeigt
function ik(a, t, l1, l2, bend, out, side) {
  let dx = t[0] - a[0], dy = t[1] - a[1], dz = t[2] - a[2], d = Math.hypot(dx, dy, dz) || 1e-6; const maxL = (l1 + l2) * 0.999;
  if (d > maxL) { const k = maxL / d; dx *= k; dy *= k; dz *= k; d = maxL; set(t, a[0] + dx, a[1] + dy, a[2] + dz); }
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const nx = dx / d, ny = dy / d, nz = dz / d, bd = bend[0] * nx + bend[1] * ny + bend[2] * nz;
  set(side, bend[0] - nx * bd, bend[1] - ny * bd, bend[2] - nz * bd); nrm(side);
  return set(out, a[0] + nx * x + side[0] * h, a[1] + ny * x + side[1] * h, a[2] + nz * x + side[2] * h);
}
const BEND_KL = [1, 0.2, -0.3], BEND_KR = [1, 0.2, 0.3], BEND_E = [0, 0.35, 1];
const FOOT_XL = nrm([1, 0, -0.32]), FOOT_XR = nrm([1, 0, 0.14]);
const _e = new THREE.Euler(), _m = new THREE.Matrix4(), _t = [0, 0, 0], _u = [0, 0, 0];

// st: { t, dt, lean, air, airT, kite, landT, duck (0..1), trick, trickT }
export function surfPose(s, st) {
  const J = s.J, SEC = s.sec, t = st.t, dt = st.dt || 0;
  const pump = Math.sin(t * 3.2);
  let crouch = 0.42 + pump * 0.04, armA = 0.95, armUp = 0, tuck = 0;
  const lean = st.lean || 0;
  if (st.air) { const k = smooth01((st.airT - 0.05) / 0.25); crouch = lerp(0.2, 0.75, k); tuck = k; armUp = 0.6; }
  if (st.kite) { crouch = 0.25 + Math.sin(t * 2) * 0.05; tuck = 0; }
  if (st.landT > 0) { const ph = 1 - st.landT / 0.34, c = Math.exp(-ph * 4.2) * Math.cos(ph * 7.5) * smooth01(st.landT / 0.06); crouch += 0.45 * c; armUp -= 0.3 * c; }
  crouch += Math.abs(lean) * 0.18;
  const dk = st.duck || 0;
  crouch = lerp(crouch, 1.2, dk);
  // Füße stehen fest auf dem Brett (Regular: linker Fuß vorne), Sohle auf dem Deck
  const footY = 0.09 + ANKLE_H;
  set(J.ftL, 0.02, footY, -0.42); set(J.ftR, -0.02, footY, 0.36);
  J.footXL = FOOT_XL; J.footXR = FOOT_XR; J.footYL = J.footYR = [0, 1, 0];
  set(J.hip, 0.05 - lean * 0.12, 1.07 - crouch * 0.42, -0.03);
  // Oberkörper: seitlich zur Fahrtrichtung, beugt sich vor und in die Kurve
  const fwd = 0.25 + crouch * 0.35 + tuck * 0.2 + dk * 0.55;
  const tilt = lean * 0.35 + Math.sin(t * 1.1) * 0.03;
  set(_t, Math.sin(tilt) * 0.5 + fwd * 0.12, Math.cos(tilt) * 0.5 * (1 - fwd * 0.25), -fwd * 0.2); nrm(_t);
  addTo(J.chest, J.hip, _t[0] * 0.5, _t[1] * 0.5, _t[2] * 0.5);
  J.pelvisX = nrm([0.12, 0, 1]); J.chestX = nrm([0.42, 0.0, 0.18 + dk * 0.1]);
  J.pelvisY = nrm([_t[0] * 0.45, 0.55 + _t[1] * 0.45, _t[2] * 0.45]);
  addTo(J.neck, J.chest, Math.sin(tilt) * 0.12 + _t[0] * 0.05, 0.13, -0.02 + _t[2] * 0.08);
  addTo(J.head, J.neck, Math.sin(tilt) * 0.06, 0.165, -0.03);
  _e.set(-0.1 - dk * 0.15, -lean * 0.2, -tilt * 0.6); _m.makeRotationFromEuler(_e); const me = _m.elements;
  J.headX = [me[0], me[1], me[2]]; J.headY = [me[4], me[5], me[6]];
  // Hüft- und Schultergelenke sitzen fest an Becken und Brustkorb
  boneFrames(J, s.frames);
  fromFrame(s.frames, BONE.pelvis, [-HIP_OFS[0], HIP_OFS[1], 0], J.hpL); fromFrame(s.frames, BONE.pelvis, [HIP_OFS[0], HIP_OFS[1], 0], J.hpR);
  fromFrame(s.frames, BONE.chest, [-SHOULDER_OFS[0], SHOULDER_OFS[1], 0], J.shL); fromFrame(s.frames, BONE.chest, [SHOULDER_OFS[0], SHOULDER_OFS[1], 0], J.shR);
  // Arme balancieren: seitlich ausgestreckt, äußerer Arm in der Kurve höher
  const sway = Math.sin(t * 1.9) * 0.08;
  const aL = armA + armUp + lean * 0.7 + sway + SEC.hx * 0.2, aR = armA + armUp - lean * 0.7 - sway - SEC.hx * 0.2;
  addTo(J.hdL, J.shL, -0.5 - Math.cos(aL) * 0.06 + tuck * 0.15, -0.3 + (aL - 0.95) * 0.45, -0.1 + tuck * 0.05);
  addTo(J.hdR, J.shR, 0.5 + Math.cos(aR) * 0.06 - tuck * 0.15, -0.3 + (aR - 0.95) * 0.45, 0.04 + tuck * 0.05);
  if (st.kite) { addTo(J.hdL, J.shL, -0.18, 0.52, -0.05); addTo(J.hdR, J.shR, 0.18, 0.52, 0.05); }
  if (dk > 0) { lerpTo(J.hdL, set(_t, -0.32, 0.46, -0.62), dk); lerpTo(J.hdR, set(_u, 0.32, 0.42, -0.3), dk); }
  if (st.trick === 'grab' && st.air) { const w = Math.sin(clamp(st.trickT / 0.55, 0, 1) * Math.PI); lerpTo(J.hdL, set(_t, 0.3, 0.24, -0.1), w); }
  if (st.trick === 'shaka' && st.air) { const w = Math.sin(clamp(st.trickT / 0.55, 0, 1) * Math.PI); lerpTo(J.hdR, addTo(_t, J.shR, 0.05, 0.55, 0.15), w); }
  ik(J.hpL, J.ftL, LEN.thigh, LEN.shin, BEND_KL, J.knL, J.kneeL);
  ik(J.hpR, J.ftR, LEN.thigh, LEN.shin, BEND_KR, J.knR, J.kneeR);
  ik(J.shL, J.hdL, LEN.upper, LEN.lower, BEND_E, J.elL, J.elbowL);
  ik(J.shR, J.hdR, LEN.upper, LEN.lower, BEND_E, J.elR, J.elbowR);
  // Arme federn der Kurvenbewegung hinterher
  SEC.hvx += ((-lean * 0.9 - SEC.hx) * 55 - SEC.hvx * 5.5) * dt; SEC.hx += SEC.hvx * dt;
}
