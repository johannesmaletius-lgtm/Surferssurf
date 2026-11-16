// Der Surfer: lädt models/surfer.glb (gebaut von tools/build-surfer.mjs), Cartoon-Material mit Kontur,
// und die Bewegung auf dem Brett: Gelenkpunkte per IK, daraus die Knochen-Lagen aus rig.js. Federn sorgen für
// Gewicht und Nachschwingen (Körper, Arme, Kopf, Haare, Hosenbeine), dazu Atmen, Umschauen, Blinzeln.
import * as THREE from './vendor/three.min.js';
import { BONES, REST, LEN, HIP_OFS, SHOULDER_OFS, ANKLE_H, BONE, boneFrames, fromFrame } from './rig.js';

/* ---------- glTF-Binärdatei lesen (nur was das Modell braucht) ---------- */
function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('keine GLB-Datei');
  const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binOfs = 20 + jl + 8;
  const TYPES = { 5120: Int8Array, 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array, 5125: Uint32Array }, SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const acc = i => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = TYPES[a.componentType];
    const n = SIZE[a.type], ofs = binOfs + (v.byteOffset || 0) + (a.byteOffset || 0), st = v.byteStride ? v.byteStride / T.BYTES_PER_ELEMENT : n;
    if (st === n) return { arr: new T(buf, ofs, a.count * n), n, norm: !!a.normalized };
    const src = new T(buf, ofs, a.count * st - (st - n)), arr = new T(a.count * n); // mit Lücken abgelegt (byteStride)
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) arr[i * n + k] = src[i * st + k];
    return { arr, n, norm: !!a.normalized }; };
  const prim = json.meshes[0].primitives[0], at = prim.attributes, skin = json.skins[0];
  return { json, acc, at, prim, skin, names: skin.joints.map(j => json.nodes[j].name) };
}


/* ---------- Material: weiche Cartoon-Stufen, warme Haut, Glanz, Gegenlicht-Kante ----------
   Im Modell steckt je Punkt das Material (uv.x: 1 Haut / 0.5 Haar / 0 Stoff, uv.y: Glanz). Schatten sind farbig
   (Stoff kühl, Haut warm), an der Licht-Schatten-Grenze schimmert die Haut rötlich durch, Haare und Augen
   bekommen Glanzlichter, und rundum liegt eine helle Kante vom Himmelslicht. */
const TOON_LIGHT = /* glsl */`
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction );
  float skin = step( 0.75, vMat.x ), hair = step( 0.25, vMat.x ) * ( 1.0 - skin );
  // zwei weiche Stufen: Kernschatten → Mittelton → Licht
  float lit = smoothstep( -0.07, 0.09, ndl ) * 0.74 + smoothstep( 0.46, 0.68, ndl ) * 0.26;
  vec3 shade = mix( vec3( 0.40, 0.45, 0.62 ), vec3( 0.66, 0.42, 0.40 ), skin );
  shade = mix( shade, vec3( 0.58, 0.44, 0.36 ), hair );
  vec3 ramp = mix( shade, vec3( 1.0 ), lit );
  float term = ndl - 0.01; term = exp( -term * term * 34.0 );
  ramp += skin * term * vec3( 0.26, 0.05, 0.0 );
  reflectedLight.directDiffuse += ramp * directLight.color * BRDF_Lambert( material.diffuseColor );
  // Glanzlicht
  float ndh = max( dot( geometryNormal, normalize( directLight.direction + geometryViewDir ) ), 0.0 );
  float gl = vMat.y;
  float sp = smoothstep( 0.90, 0.985, ndh ) * 0.32 * gl;
  sp = mix( sp, smoothstep( 0.62, 0.9, ndh ) * 0.2 + smoothstep( 0.93, 0.98, ndh ) * 0.14, hair );
  sp += smoothstep( 0.985, 0.995, ndh ) * step( 0.9, gl ) * 0.8;
  reflectedLight.directDiffuse += sp * lit * directLight.color * mix( vec3( 1.0 ), material.diffuseColor * 3.0 + 0.25, hair ) * RECIPROCAL_PI;
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;
function toonMaterial(rim) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRim = rim;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vMat;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMat;\nuniform vec3 uRim;')
      .replace('#include <lights_toon_pars_fragment>', TOON_LIGHT)
      .replace('#include <opaque_fragment>', /* glsl */`
        { float fres = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
          float rimK = smoothstep( 0.58, 0.88, fres ) * ( 0.3 + 0.7 * saturate( inverseTransformDirection( normal, viewMatrix ).y * 0.8 + 0.55 ) );
          outgoingLight += rimK * uRim * ( 0.3 + 0.7 * diffuseColor.rgb ) * ( 1.0 + step( 0.75, vMat.x ) * 0.25 ); }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'surfer-toon-2';
  return mat;
}
// Kontur: umgestülpte Hülle. Die Breite hängt am Bildschirm (Anteil der Bildhöhe), nicht an der Welt – sie bleibt
// in der Nahaufnahme und auf hochauflösenden Bildschirmen fein. Die Farbe ist ein dunkler Ton der Fläche darunter.
function outlineMaterial(color, width, frac) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTh: { value: width }, uFrac: { value: frac }, uCol: { value: new THREE.Color(color) } }]),
    vertexShader: /* glsl */`uniform float uTh, uFrac; attribute float outline; attribute vec3 color; varying vec3 vCol;
      #include <common>
      #include <skinning_pars_vertex>
      #include <fog_pars_vertex>
      void main(){
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv0 = modelViewMatrix * vec4(transformed, 1.);
        float w = clamp(uFrac * -mv0.z * 2. / projectionMatrix[1][1], uTh * 0.2, uTh);
        transformed += normalize(objectNormal) * w * outline;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.);
        gl_Position = projectionMatrix * mvPosition;
        vCol = color;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform vec3 uCol; varying vec3 vCol;
      #include <fog_pars_fragment>
      void main(){ gl_FragColor = vec4(mix(uCol, vCol * vCol * 0.5, 0.45), 1.);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.BackSide, fog: true,
  });
}

// Lädt das Modell und gibt den Surfer zurück: root (Gruppe), bones, pose(st), react(was) und Hilfen
export async function loadSurfer(url, { outlineColor = '#101a36', outlineWidth = 0.012, outlineFrac = 0.0021, rimColor = '#a8dcff', rimStrength = 0.5 } = {}) {
  const res = await fetch(url); if (!res.ok) throw new Error('Modell fehlt: ' + url);
  const g = parseGLB(await res.arrayBuffer());
  const geo = new THREE.BufferGeometry();
  const pos = g.acc(g.at.POSITION), nrm = g.acc(g.at.NORMAL), col = g.acc(g.at.COLOR_0), uv = g.acc(g.at.TEXCOORD_0), jn = g.acc(g.at.JOINTS_0), wt = g.acc(g.at.WEIGHTS_0), idx = g.acc(g.prim.indices);
  const n = pos.arr.length / 3, c3 = new Float32Array(n * 3), ol = new Float32Array(n);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) c3[i * 3 + k] = col.arr[i * 4 + k] / 65535; ol[i] = col.arr[i * 4 + 3] / 65535; }
  // Knochen-Nummern der Datei auf die Reihenfolge in rig.js abbilden
  const remap = g.names.map(nm => BONES.indexOf(nm)), ji = new Uint8Array(jn.arr.length);
  for (let i = 0; i < ji.length; i++) ji[i] = remap[jn.arr[i]];
  geo.setAttribute('position', new THREE.BufferAttribute(pos.arr.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm.arr.slice(), 3, nrm.norm));
  geo.setAttribute('color', new THREE.BufferAttribute(c3, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv.arr.slice(), 2, uv.norm));
  geo.setAttribute('outline', new THREE.BufferAttribute(ol, 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wt.arr.slice(), 4, true));
  geo.setIndex(new THREE.BufferAttribute(idx.arr.slice(), 1));
  const ibm = g.acc(g.skin.inverseBindMatrices).arr;

  const root = new THREE.Group(); root.name = 'surfer';
  const bones = BONES.map(name => { const b = new THREE.Bone(); b.name = name; b.matrixAutoUpdate = false; root.add(b); return b; });
  const inverses = BONES.map(name => new THREE.Matrix4().fromArray(ibm, g.names.indexOf(name) * 16));
  const skeleton = new THREE.Skeleton(bones, inverses);
  const rim = { value: new THREE.Color(rimColor).multiplyScalar(rimStrength) };
  const mesh = new THREE.SkinnedMesh(geo, toonMaterial(rim)), outline = new THREE.SkinnedMesh(geo, outlineMaterial(outlineColor, outlineWidth, outlineFrac));
  for (const m of [mesh, outline]) { m.frustumCulled = false; root.add(m); m.bind(skeleton, new THREE.Matrix4()); }

  const J = makeJoints(), F = new Float32Array(BONES.length * 16);
  const s = { root, bones, mesh, outline, skeleton, J, frames: F, rim: rim.value, anim: makeAnim(), triangles: idx.arr.length / 3,
    // Gelenkpunkte → Knochen
    apply() { boneFrames(J, F); for (let i = 0; i < bones.length; i++) { bones[i].matrix.fromArray(F, i * 16); bones[i].matrixWorldNeedsUpdate = true; } },
    pose(st) { surfPose(s, st); s.apply(); },
    rest() { for (const k in REST) J[k] = Array.isArray(REST[k]) ? REST[k].slice() : REST[k]; root.rotation.set(0, 0, 0); s.anim = makeAnim(); s.apply(); },
    // kurze Reaktionen: 'coin' (Münze), 'power' (Power-up, Jubel), 'bump' (angestoßen)
    react(what, dir = 0) { const A = s.anim; if (what === 'coin') A.coin = Math.min(1.6, A.coin + 1); else if (what === 'power') A.cheer = 1; else if (what === 'bump') { A.ln.v += dir * 9; A.cr.v += 2; } },
    // Punkt an der Hand (für die Drachenleinen), in Weltkoordinaten
    handWorld(side, out) { const i = BONE['hand' + side]; fromFrame(F, i, [0, 0.07, 0], _a); return root.localToWorld(out.set(_a[0], _a[1], _a[2])); },
  };
  s.rest();
  return s;
}
const _a = [0, 0, 0];

/* ---------- Bewegung ---------- */
function makeJoints() { const J = {}; for (const k in REST) J[k] = Array.isArray(REST[k]) ? REST[k].slice() : REST[k]; return J; }
const sp1 = () => ({ x: 0, v: 0 }), sp3 = () => ({ x: [0, 0, 0], v: [0, 0, 0], init: false });
function makeAnim() {
  return { cr: { x: 0.42, v: 0 }, ln: sp1(), hy: sp1(), hpi: sp1(), hL: sp3(), hR: sp3(), hairB: [sp1(), sp1()], hairL: [sp1(), sp1()], hairR: [sp1(), sp1()], sink: sp1(),
    wasAir: false, vy: 0, land: 0, coin: 0, cheer: 0, blinkT: 2, blink: 0, lookT: 0, lookYaw: 0, lookPitch: 0, crashed: false, flail: 0 };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const set = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
const addTo = (o, a, x, y, z) => set(o, a[0] + x, a[1] + y, a[2] + z);
const nrm = o => { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
const lerpTo = (o, b, t) => set(o, lerp(o[0], b[0], t), lerp(o[1], b[1], t), lerp(o[2], b[2], t));
// gedämpfte Feder (w = Tempo, z = Dämpfung: < 1 schwingt über)
function spring(o, target, w, z, dt) { const n = dt > 0.017 ? 2 : 1, h = dt / n; for (let i = 0; i < n; i++) { o.v += ((target - o.x) * w * w - 2 * z * w * o.v) * h; o.x += o.v * h; } return o.x; }
function spring3(o, target, w, z, dt) {
  if (!o.init) { o.init = true; set(o.x, target[0], target[1], target[2]); set(o.v, 0, 0, 0); }
  const n = dt > 0.017 ? 2 : 1, h = dt / n;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { o.v[k] += ((target[k] - o.x[k]) * w * w - 2 * z * w * o.v[k]) * h; o.x[k] += o.v[k] * h; }
  return o.x;
}

// Zwei-Glied-IK: Knie/Ellbogen aus Start a, Ziel t, Längen, Beugerichtung; side = Richtung, in die das Gelenk zeigt
function ik(a, t, l1, l2, bend, out, side) {
  let dx = t[0] - a[0], dy = t[1] - a[1], dz = t[2] - a[2], d = Math.hypot(dx, dy, dz) || 1e-6; const maxL = (l1 + l2) * 0.999;
  if (d > maxL) { const k = maxL / d; dx *= k; dy *= k; dz *= k; d = maxL; set(t, a[0] + dx, a[1] + dy, a[2] + dz); }
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const nx = dx / d, ny = dy / d, nz = dz / d, bd = bend[0] * nx + bend[1] * ny + bend[2] * nz;
  set(side, bend[0] - nx * bd, bend[1] - ny * bd, bend[2] - nz * bd); nrm(side);
  return set(out, a[0] + nx * x + side[0] * h, a[1] + ny * x + side[1] * h, a[2] + nz * x + side[2] * h);
}
const BEND_KL = [1, 0.2, -0.3], BEND_KR = [1, 0.2, 0.3], BEND_E = [0, 0.35, 1], BEND_EL = [-0.5, 0.2, 0.9], BEND_ER = [0.6, 0.1, 0.8];
const FOOT_XL = nrm([1, 0, -0.32]), FOOT_XR = nrm([1, 0, 0.14]), UPV = [0, 1, 0];
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4(), _d = [0, 0, 0], _tl = [0, 0, 0], _tr = [0, 0, 0], _u = [0, 0, 0], _r = [0, 0, 0], _f = [0, 0, 0];
// Ziel = Schulter + a·rechts + b·vorn + c·oben
const armTo = (o, sh, r, f, a, b, c) => set(o, sh[0] + r[0] * a + f[0] * b, sh[1] + r[1] * a + f[1] * b + c, sh[2] + r[2] * a + f[2] * b);

function headPose(J, dir, yaw, pitch, roll) {
  addTo(J.neck, J.chest, dir[0] * 0.13, dir[1] * 0.13, dir[2] * 0.13);
  set(_u, dir[0] * 0.45, dir[1] * 0.45 + 0.55, dir[2] * 0.45); nrm(_u);
  addTo(J.head, J.neck, _u[0] * 0.168, _u[1] * 0.168, _u[2] * 0.168);
  _e.set(pitch, yaw, roll); _m.makeRotationFromEuler(_e); const me = _m.elements;
  J.headX = [me[0], me[1], me[2]]; J.headY = [me[4], me[5], me[6]];
}
function attach(s, breath) {
  const J = s.J;
  boneFrames(J, s.frames);
  fromFrame(s.frames, BONE.pelvis, [-HIP_OFS[0], HIP_OFS[1], 0], J.hpL); fromFrame(s.frames, BONE.pelvis, [HIP_OFS[0], HIP_OFS[1], 0], J.hpR);
  fromFrame(s.frames, BONE.chest, [-SHOULDER_OFS[0], SHOULDER_OFS[1] + breath, 0], J.shL); fromFrame(s.frames, BONE.chest, [SHOULDER_OFS[0], SHOULDER_OFS[1] + breath, 0], J.shR);
}
function blinking(A, dt, extra) {
  A.blinkT -= dt; if (A.blinkT <= 0) { A.blinkT = 2 + Math.random() * 3.5; A.blink = 0.15; }
  A.blink = Math.max(0, A.blink - dt);
  return clamp(0.2 + Math.sin(A.blink / 0.15 * Math.PI) * 0.8 + extra, 0, 1);
}

// st: { t, dt, lean, air, airT, vy, speed, kite, duck (0..1), trick, trickT, idle, crashT (≥ 0 = Sturz), wet, rot }
export function surfPose(s, st) {
  const J = s.J, A = s.anim, t = st.t, dt = Math.min(st.dt || 0, 0.05);
  if (st.crashT >= 0) return crashPose(s, st, dt);
  if (A.crashed) { A.crashed = false; s.root.rotation.set(0, 0, 0); A.sink.x = A.sink.v = 0; A.hL.init = A.hR.init = false; A.cr.x = 0.42; A.cr.v = 0; }
  const kite = !!st.kite, air = !!st.air && !kite, lean = st.lean || 0, vy = st.vy || 0, dk = st.duck || 0, fl = clamp((st.speed ?? 14) / 20, 0, 1.5);
  // Landung: der Aufprall drückt in die Knie, die Feder holt wieder hoch
  if (A.wasAir && !st.air) { A.cr.v += clamp(-A.vy * 0.5, 2.5, 9); A.land = 1; }
  A.wasAir = !!st.air; A.vy = vy;
  A.land = Math.max(0, A.land - dt * 3.2); A.coin = Math.max(0, A.coin - dt * 5.5); A.cheer = Math.max(0, A.cheer - dt / 0.9);
  const cheer = A.cheer > 0 ? Math.pow(Math.sin((1 - A.cheer) * Math.PI), 0.6) : 0, coin = Math.min(1, A.coin);
  // Kurvenlage federt nach: erst zögern, dann überschwingen
  spring(A.ln, lean, 15, 0.42, dt); const ln = A.ln.x, lnV = clamp(A.ln.v, -8, 8);
  const breath = Math.sin(t * 1.7);
  // --- wie tief in den Knien ---
  let crT = 0.42 + breath * 0.012 + Math.sin(t * 3.1) * 0.022 * fl + Math.abs(ln) * 0.2 + Math.max(ln, 0) * 0.08 - coin * 0.05 - cheer * 0.14;
  let tuck = 0, fall = 0, up = 0, grab = 0, shaka = 0, spin = 0;
  if (air) {
    const a = st.airT; fall = smooth01((-vy - 4) / 7); tuck = smooth01((a - 0.14) / 0.2) * (1 - fall); up = smooth01(a / 0.14);
    const w = st.trick ? smooth01(st.trickT / 0.2) * (1 - fall) : 0;
    grab = st.trick === 'grab' ? w : 0; shaka = st.trick === 'shaka' ? w : 0; spin = st.trick === 'spin' ? w : 0;
    crT = a < 0.05 ? 1.0 : lerp(0.2, 0.74, tuck);       // erst ausholen, dann strecken, dann anhocken
    crT = lerp(crT, 0.32, fall * 0.85); crT = lerp(crT, 1.32, grab); crT = lerp(crT, 0.95, spin);
  }
  if (kite) crT = 0.27 + Math.sin(t * 2) * 0.05;
  crT = lerp(crT, 1.3, dk);
  spring(A.cr, crT, air ? 34 : 19, air ? 0.8 : 0.44, dt);
  const crouch = A.cr.x = clamp(A.cr.x, 0.2, 1.45), deep = smooth01((crouch - 0.7) / 0.55);
  // Füße stehen fest auf dem Brett (Regular: linker Fuß vorne), Sohle auf dem Deck
  const footY = 0.09 + ANKLE_H;
  set(J.ftL, 0.02, footY, -0.42); set(J.ftR, -0.02, footY, 0.36);
  J.footXL = FOOT_XL; J.footXR = FOOT_XR; J.footYL = J.footYR = UPV;
  set(J.hip, 0.05 - ln * 0.12 - deep * 0.1 + Math.sin(t * 0.9) * 0.012, 1.07 - crouch * 0.42, -0.03 + Math.sin(t * 1.3 + 1) * 0.012 - dk * 0.04);
  // --- Oberkörper: seitlich zur Fahrtrichtung, beugt sich über die Zehen und legt sich in die Kurve ---
  const bend = clamp(0.24 + crouch * 0.4 + dk * 0.2 + grab * 0.25 - (air ? up * (1 - tuck) * 0.22 : 0) - cheer * 0.2 - (kite ? 0.2 : 0), 0.04, 1.2);
  const tilt = ln * 0.32 + Math.sin(t * 1.1) * 0.025 - lnV * 0.006;
  const sb = Math.sin(bend), cb = Math.cos(bend);
  set(_d, 0.84 * sb + tilt * 0.6, cb, -0.54 * sb - dk * 0.25 - grab * 0.1); nrm(_d);
  addTo(J.chest, J.hip, _d[0] * 0.5, _d[1] * 0.5 + breath * 0.004, _d[2] * 0.5);
  const yp = 1.15 + ln * 0.12, yc = 0.72 + ln * 0.34 + lnV * 0.012 + Math.sin(t * 0.8) * 0.04 - cheer * 0.25 + shaka * 0.2 - dk * 0.3;
  J.pelvisX = [Math.cos(yp), 0, Math.sin(yp)]; J.chestX = set(_r, Math.cos(yc), 0, Math.sin(yc)).slice(); set(_f, Math.sin(yc), 0, -Math.cos(yc));
  J.pelvisY = nrm([_d[0] * 0.4, 0.6 + _d[1] * 0.4, _d[2] * 0.4]);
  // --- Kopf: schaut voraus, führt in die Kurve, schaut sich im Leerlauf um ---
  A.lookT -= dt;
  if (A.lookT <= 0) { A.lookT = st.idle ? 1.4 + Math.random() * 2.6 : 0.8 + Math.random() * 2; A.lookYaw = st.idle ? (Math.random() < 0.3 ? -1.25 : -0.9 + Math.random() * 1.3) : (Math.random() - 0.5) * 0.3; A.lookPitch = (Math.random() - 0.4) * (st.idle ? 0.3 : 0.1); }
  const yawT = -0.1 - lean * 0.5 + A.lookYaw * (air || dk > 0.3 ? 0.2 : 1) - cheer * 0.2;
  const pitchT = -0.06 + A.lookPitch + bend * 0.12 + coin * 0.1 + cheer * 0.3 + (air ? up * 0.2 - fall * 0.45 - grab * 0.2 : 0) - A.land * 0.2;
  spring(A.hy, yawT, st.idle ? 5 : 11, 0.8, dt); spring(A.hpi, pitchT, 11, 0.7, dt);
  headPose(J, _d, A.hy.x, A.hpi.x, -tilt * 0.5 + Math.sin(t * 0.7) * 0.02);
  attach(s, breath * 0.006 + cheer * 0.02);
  // --- Arme: balancieren; in der Kurve greift die innere Hand zum Wasser, die äußere geht hoch ---
  const sway = Math.sin(t * 1.9) * 0.03, lag = -lnV * 0.014, r = _r, f = _f;
  const k = clamp(crouch - 0.42, -0.2, 0.6);
  armTo(_tl, J.shL, r, f, -0.3 + Math.min(ln, 0) * 0.12, 0.3 - k * 0.1, -0.2 + ln * 0.3 + sway - k * 0.12);
  armTo(_tr, J.shR, r, f, 0.4 + Math.max(ln, 0) * 0.1, 0.02, -0.18 - ln * 0.32 - sway + coin * 0.12 - k * 0.1);
  _tl[0] += lag; _tr[0] += lag;
  if (A.land > 0) { _tl[1] -= A.land * 0.16; _tr[1] -= A.land * 0.16; }
  if (air) { // Absprung: Arme schwingen hoch; im Fallen breit zum Ausbalancieren
    const w = up * (1 - grab) * (1 - spin);
    lerpTo(_tl, armTo(_u, J.shL, r, f, -0.36 - fall * 0.08, 0.2, 0.22 + fall * 0.12 - tuck * 0.12), w);
    lerpTo(_tr, armTo(_u, J.shR, r, f, 0.42 + fall * 0.06, -0.08, 0.3 + fall * 0.12 - tuck * 0.14), w);
    if (grab > 0) { lerpTo(_tr, set(_u, 0.33, 0.21, 0.02), grab); lerpTo(_tl, armTo(_u, J.shL, r, f, -0.3, 0.2, 0.36), grab); } // hintere Hand an die Kante, vordere hoch
    if (shaka > 0) lerpTo(_tr, armTo(_u, J.shR, r, f, 0.22 + Math.sin(t * 16) * 0.05, 0.12, 0.52), shaka);
    if (spin > 0) { lerpTo(_tl, armTo(_u, J.shL, r, f, -0.08, 0.26, -0.12), spin); lerpTo(_tr, armTo(_u, J.shR, r, f, 0.1, 0.26, -0.16), spin); }
  }
  if (kite) { armTo(_tl, J.shL, r, f, -0.16, 0.08, 0.53); armTo(_tr, J.shR, r, f, 0.16, 0.08, 0.53); }
  if (dk > 0) { lerpTo(_tl, set(_u, 0.26, 0.4, -0.56), dk); lerpTo(_tr, armTo(_u, J.shR, r, f, 0.34, -0.2, 0.02), dk); } // vorn tief, hinten als Gegengewicht
  if (cheer > 0) { lerpTo(_tr, armTo(_u, J.shR, r, f, 0.16, 0.1, 0.56), cheer); lerpTo(_tl, armTo(_u, J.shL, r, f, -0.34, 0.16, -0.02), cheer * 0.6); }
  // die Hände folgen ihrem Ziel mit Schwung (Nachschwingen)
  const aw = air ? 24 : 20;
  set(J.hdL, ...spring3(A.hL, _tl, aw, 0.5, dt)); set(J.hdR, ...spring3(A.hR, _tr, aw, 0.5, dt));
  ik(J.hpL, J.ftL, LEN.thigh, LEN.shin, BEND_KL, J.knL, J.kneeL);
  ik(J.hpR, J.ftR, LEN.thigh, LEN.shin, BEND_KR, J.knR, J.kneeR);
  ik(J.shL, J.hdL, LEN.upper, LEN.lower, BEND_EL, J.elL, J.elbowL);
  ik(J.shR, J.hdR, LEN.upper, LEN.lower, BEND_ER, J.elR, J.elbowR);
  // --- Haare und Hosenbeine: Fahrtwind, Trägheit ---
  const lift = clamp(A.cr.v * 0.035 + (air ? -vy * 0.022 : 0), -0.3, 0.5), flare = 0.04 + fl * 0.05 + Math.max(lift, 0) * 0.8;
  secondary(s, dt, t, fl, -(0.06 + 0.1 * fl) - lift, ln * 0.3 + lnV * 0.03 - A.hy.v * 0.05, flare, A.cr.v * 0.02);
  J.blink = blinking(A, dt, A.land * 0.5 + (cheer > 0.3 ? 0.35 : 0));
}
function secondary(s, dt, t, fl, backX, sideZ, flare, hem) {
  const J = s.J, A = s.anim, W = 13, Z = 0.24;
  J.hairB[0] = clamp(spring(A.hairB[0], backX + Math.sin(t * 9.1) * 0.035 * fl, W, Z, dt), -0.9, 0.25); J.hairB[1] = clamp(spring(A.hairB[1], sideZ + Math.sin(t * 7.3) * 0.03 * fl, W, Z, dt), -0.6, 0.6);
  J.hairL[0] = clamp(spring(A.hairL[0], backX * 0.7 + Math.sin(t * 8.3 + 1) * 0.03 * fl, W, Z, dt), -0.7, 0.2); J.hairL[1] = clamp(spring(A.hairL[1], -flare + sideZ * 0.7 + Math.sin(t * 6.7 + 2) * 0.03 * fl, W, Z, dt), -0.8, 0.12);
  J.hairR[0] = clamp(spring(A.hairR[0], backX * 0.7 + Math.sin(t * 8.9 + 3) * 0.03 * fl, W, Z, dt), -0.7, 0.2); J.hairR[1] = clamp(spring(A.hairR[1], flare + sideZ * 0.7 + Math.sin(t * 7.1 + 4) * 0.03 * fl, W, Z, dt), -0.12, 0.8);
  J.hemL[0] = clamp(Math.sin(t * 11.3) * 0.05 * fl + hem, -0.12, 0.12); J.hemL[1] = Math.sin(t * 13.1 + 1) * 0.04 * fl;
  J.hemR[0] = clamp(Math.sin(t * 10.7 + 2) * 0.05 * fl + hem, -0.12, 0.12); J.hemR[1] = Math.sin(t * 12.4 + 3) * 0.04 * fl;
}

// Sturz: erst wirbelt er mit rudernden Armen und Beinen durch die Luft, dann taucht er auf, schüttelt den Kopf
// und winkt ab – alles ok
function crashPose(s, st, dt) {
  const J = s.J, A = s.anim, t = st.t, ct = st.crashT, wet = !!st.wet;
  if (!A.crashed) { A.crashed = true; A.sink.x = A.sink.v = 0; A.wetT = 0; A.hL.init = A.hR.init = false; }
  if (wet) A.wetT += dt;
  const wk = spring(A.sink, wet ? 1 : 0, 9, 0.6, dt), wt = A.wetT, fly = 1 - smooth01(wk), rot = st.rot || 0;
  s.root.rotation.set(lerp(-rot * 0.85, -0.2 + Math.sin(t * 2.3) * 0.05, smooth01(wk)), lerp(rot * 0.3, 0.5, smooth01(wk)), lerp(rot * 0.45, Math.sin(t * 3) * 0.07, smooth01(wk)));
  const base = 1.0 - clamp(wk, 0, 1.15) * 0.98 + (wet ? Math.sin(t * 3) * 0.03 : 0), ph = ct * 13;
  set(J.hip, 0, base, 0); set(_d, Math.sin(ph * 0.5) * 0.2 * fly, 1, 0.3 * fly + 0.05); nrm(_d);
  addTo(J.chest, J.hip, _d[0] * 0.5, _d[1] * 0.5, _d[2] * 0.5);
  J.pelvisX = [1, 0, 0]; J.chestX = set(_r, 1, 0, Math.sin(ph * 0.5) * 0.3 * fly).slice(); set(_f, 0, 0, -1); J.pelvisY = UPV;
  const shake = wet ? Math.sin(wt * 22) * 0.5 * Math.exp(-wt * 2.2) * smooth01(wt / 0.3) : 0;
  headPose(J, _d, shake + Math.sin(ph * 0.7) * 0.3 * fly, 0.3 * fly + (wet ? 0.12 : 0), 0);
  attach(s, 0);
  // Beine: strampeln in der Luft, treten im Wasser
  const kick = wet ? t * 5 : ph, ka = wet ? 0.16 : 0.34;
  addTo(J.ftL, J.hpL, -0.1 - 0.1 * fly, -0.8 + fly * 0.22 + Math.sin(kick) * ka * 0.5, -0.1 - Math.cos(kick) * ka);
  addTo(J.ftR, J.hpR, 0.1 + 0.1 * fly, -0.8 + fly * 0.22 - Math.sin(kick) * ka * 0.5, -0.1 + Math.cos(kick) * ka);
  J.footXL = J.footXR = nrm([0, -0.5 * fly - 0.2, -1]); J.footYL = J.footYR = UPV;
  // Arme: rudern, dann im Wasser paddeln; nach kurzer Zeit winkt die rechte Hand
  const wave = wet ? smooth01((wt - 0.7) / 0.35) : 0;
  set(_tl, J.shL[0] - 0.42, J.shL[1] + (wet ? -0.02 + Math.sin(t * 4) * 0.05 : 0.2 + Math.sin(ph) * 0.3), J.shL[2] + (wet ? -0.18 + Math.cos(t * 4) * 0.1 : Math.cos(ph) * 0.3));
  set(_tr, J.shR[0] + 0.42, J.shR[1] + (wet ? -0.02 - Math.sin(t * 4) * 0.05 : 0.2 - Math.sin(ph + 1) * 0.3), J.shR[2] + (wet ? -0.18 - Math.cos(t * 4) * 0.1 : -Math.cos(ph + 1) * 0.3));
  if (wave > 0) lerpTo(_tr, set(_u, J.shR[0] + 0.2 + Math.sin(t * 9) * 0.1, J.shR[1] + 0.5, J.shR[2] - 0.08), wave);
  set(J.hdL, ...spring3(A.hL, _tl, 22, 0.5, dt)); set(J.hdR, ...spring3(A.hR, _tr, 22, 0.5, dt));
  ik(J.hpL, J.ftL, LEN.thigh, LEN.shin, [0, 0.2, -1], J.knL, J.kneeL);
  ik(J.hpR, J.ftR, LEN.thigh, LEN.shin, [0, 0.2, -1], J.knR, J.kneeR);
  ik(J.shL, J.hdL, LEN.upper, LEN.lower, BEND_E, J.elL, J.elbowL);
  ik(J.shR, J.hdR, LEN.upper, LEN.lower, BEND_E, J.elR, J.elbowR);
  secondary(s, dt, t, 0.4, wet ? 0.05 : -0.5 + Math.sin(ph) * 0.3, Math.sin(ph * 0.6) * 0.4 * fly + shake * 0.8, wet ? 0 : 0.5, 0.08 * fly);
  J.blink = wet ? blinking(A, dt, wt < 0.5 ? 0.9 : 0) : 0; // in der Luft: Augen weit auf
}
