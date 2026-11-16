// Baut das 3D-Modell des Surfers: 3d/models/surfer.glb (glTF 2.0 mit Skelett, ansehen z. B. in 3d/surfer.html).
//
// Der Körper ist aus weichen Grundformen modelliert (Abstandsfelder: Ellipsoide, Kegel, Kapseln, weich verschmolzen) –
// Muskeln, Gesicht, einzelne Finger und Zehen, Haarsträhnen, Stofffalten. Daraus wird eine geschlossene Oberfläche
// berechnet („Surface Nets“), genau auf die Formen gezogen und mit meshoptimizer vereinfacht.
// Kleidung (Lycra-Shirt, Boardshorts) und Haare sind eigene Schichten über der Haut, deshalb entstehen echte Säume.
// Farbflächen sind Zonen: Punkte neben einer Farbgrenze werden genau auf die Grenze geschoben und dort verdoppelt –
// die Ränder sind dadurch in jeder Auflösung glatt und scharf (ganz ohne Textur).
// Kappe, Augen, Lider, Brauen, Mund, Logo und Kordel sind eigene, scharfe Formen.
// Jeder Punkt bekommt Gewichte für die Knochen aus rig.js – das Spiel bewegt sie per IK.
// Im Modell stecken außerdem: COLOR_0.a = Stärke der Kontur, TEXCOORD_0 = Material (x: 1 Haut / 0.5 Haar / 0 Stoff, y: Glanz).
//
// Neu bauen (einmalig npm i meshoptimizer im Ordner 3d/tools):
//   node build-surfer.mjs            (STEP=0.008 für eine schnelle Vorschau, TRIS=… für mehr/weniger Dreiecke)
import { writeFileSync, mkdirSync } from 'node:fs';
import { BONES, BONE, REST, EYE_PIVOT, boneFrames } from '../rig.js';

const STEP = +(process.env.STEP || 0.005);
const TARGET_TRIS = +(process.env.TRIS || 28000);
const OUT = new URL('../models/surfer.glb', import.meta.url);

/* ---------- kleine Vektor-Helfer ---------- */
const v3 = (x, y, z) => [x, y, z];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const rotX = (p, c, a) => { const y = p[1] - c[1], z = p[2] - c[2], cs = Math.cos(a), sn = Math.sin(a); return [p[0], c[1] + y * cs - z * sn, c[2] + y * sn + z * cs]; };
const rotXv = (n, a) => rotX(n, [0, 0, 0], a);

const srgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); };
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* ---------- Abstandsfelder ---------- */
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
const BIG = 1e3;

function bbox(pts, r) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], p[i] - r); b[i + 3] = Math.max(b[i + 3], p[i] + r); }
  return b;
}
const boxDist = (b, x, y, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[1] - y, 0, y - b[4]), Math.max(b[2] - z, 0, z - b[5]));

function ellipsoid(c, r) {
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  return { bb: bbox([c], Math.max(rx, ry, rz)), d(x, y, z) {
    const px = x - cx, py = y - cy, pz = z - cz;
    const k0 = Math.hypot(px / rx, py / ry, pz / rz), k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
    return k1 < 1e-12 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
  } };
}
// gedrehtes Ellipsoid: Achse u (Radius ru), v (rv), w = u × v (rw)
function oellipsoid(c, u, vRef, ru, rv, rw) {
  u = norm(u); let v = norm(sub(vRef, mul(u, dot(vRef, u)))); const w = cross(u, v);
  const [cx, cy, cz] = c;
  return { bb: bbox([c], Math.max(ru, rv, rw)), d(x, y, z) {
    const px = x - cx, py = y - cy, pz = z - cz;
    const a = (px * u[0] + py * u[1] + pz * u[2]), b = (px * v[0] + py * v[1] + pz * v[2]), e = (px * w[0] + py * w[1] + pz * w[2]);
    const k0 = Math.hypot(a / ru, b / rv, e / rw), k1 = Math.hypot(a / (ru * ru), b / (rv * rv), e / (rw * rw));
    return k1 < 1e-12 ? -Math.min(ru, rv, rw) : k0 * (k0 - 1) / k1;
  } };
}
// Kegel mit runden Enden (Inigo Quilez)
function roundCone(a, b, r1, r2) {
  const ba = sub(b, a), l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return { bb: bbox([a, b], Math.max(r1, r2)), d(x, y, z) {
    const pa0 = x - a[0], pa1 = y - a[1], pa2 = z - a[2];
    const yy = pa0 * ba[0] + pa1 * ba[1] + pa2 * ba[2], zz = yy - l2;
    const q0 = pa0 * l2 - ba[0] * yy, q1 = pa1 * l2 - ba[1] * yy, q2 = pa2 * l2 - ba[2] * yy;
    const x2 = q0 * q0 + q1 * q1 + q2 * q2, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  } };
}
const capsule = (a, b, r) => roundCone(a, b, r, r);
// Kegelstumpf mit flachen Enden (für Säume), leicht abgerundet
function cappedCone(a, b, ra, rb, round = 0) {
  ra -= round; rb -= round;
  const ba = sub(b, a), baba = dot(ba, ba), rba = rb - ra, kk = rba * rba + baba;
  return { bb: bbox([a, b], Math.max(ra, rb) + round), d(x, y, z) {
    const pa0 = x - a[0], pa1 = y - a[1], pa2 = z - a[2];
    const papa = pa0 * pa0 + pa1 * pa1 + pa2 * pa2, paba = (pa0 * ba[0] + pa1 * ba[1] + pa2 * ba[2]) / baba;
    const xx = Math.sqrt(Math.max(0, papa - paba * paba * baba));
    const cax = Math.max(0, xx - (paba < 0.5 ? ra : rb)), cay = Math.abs(paba - 0.5) - 0.5;
    const f = clamp((rba * (xx - ra) + paba * baba) / kk, 0, 1);
    const cbx = xx - ra - f * rba, cby = paba - f;
    const s = (cbx < 0 && cay < 0) ? -1 : 1;
    return s * Math.sqrt(Math.min(cax * cax + cay * cay * baba, cbx * cbx + cby * cby * baba)) - round;
  } };
}
const sphere = (c, r) => ellipsoid(c, [r, r, r]);

// weiche Vereinigung: Liste aus [Form, Weichheit]
function U(items) {
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const [p] of items) for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], p.bb[i]); bb[i + 3] = Math.max(bb[i + 3], p.bb[i + 3]); }
  return { bb, d(x, y, z) {
    let d = BIG;
    for (const [p, k] of items) {
      if (boxDist(p.bb, x, y, z) > d + k) continue;
      const v = p.d(x, y, z); d = k > 0 ? smin(d, v, k) : Math.min(d, v);
    }
    return d;
  } };
}
const fn = (bb, d) => ({ bb, d });

/* =========================================================================
   Das Modell
   ========================================================================= */
const R = REST, H = R.head;
const SIDES = [[-1, 'L'], [1, 'R']];
const hp = (_, o) => add(H, o);
const memo = f => { let lx = NaN, ly = 0, lz = 0, lv = 0; return fn(f.bb, (x, y, z) => { if (x === lx && y === ly && z === lz) return lv; lx = x; ly = y; lz = z; return lv = f.d(x, y, z); }); };
// Der Kopf ist etwas größer als in echt (Cartoon-Proportionen): alles am Kopf wird in „Kopf-Maßen“ gebaut
// und dann um den Halsansatz vergrößert
const HS = 1.13, HPV = [0, 1.715, -0.012];
const hs = p => [HPV[0] + (p[0] - HPV[0]) * HS, HPV[1] + (p[1] - HPV[1]) * HS, HPV[2] + (p[2] - HPV[2]) * HS];
const uh = p => [HPV[0] + (p[0] - HPV[0]) / HS, HPV[1] + (p[1] - HPV[1]) / HS, HPV[2] + (p[2] - HPV[2]) / HS];
const scaled = f => fn([...hs(f.bb.slice(0, 3)), ...hs(f.bb.slice(3))], (x, y, z) => HS * f.d(HPV[0] + (x - HPV[0]) / HS, HPV[1] + (y - HPV[1]) / HS, HPV[2] + (z - HPV[2]) / HS));

// Rumpf (Haut): Brustkorb, Brust, Rücken, Schultern, Bauch, Becken, Po – breite Schultern, schmale Taille
const torsoItems = [
  [ellipsoid([0, 1.37, 0.005], [0.16, 0.2, 0.112]), 0],
  [ellipsoid([0, 1.455, 0.012], [0.196, 0.11, 0.108]), 0.06],
  [ellipsoid([0, 1.22, -0.004], [0.128, 0.15, 0.096]), 0.07],
  [ellipsoid([0, 1.045, 0.0], [0.148, 0.13, 0.106]), 0.07],
];
for (const [s] of SIDES) {
  torsoItems.push(
    [ellipsoid([s * 0.075, 1.445, -0.054], [0.092, 0.07, 0.06]), 0.035],           // Brust
    [ellipsoid([s * 0.086, 1.43, 0.084], [0.072, 0.09, 0.036]), 0.04],             // Schulterblatt
    [ellipsoid([s * 0.132, 1.33, 0.03], [0.045, 0.11, 0.06]), 0.05],               // Rückenmuskel (V-Form)
    [roundCone([0, 1.6, 0.02], [s * 0.2, 1.535, 0.01], 0.07, 0.054), 0.05],        // Nacken-Schulter
    [ellipsoid([s * 0.228, 1.505, 0.0], [0.084, 0.092, 0.086]), 0.045],            // Schulterkappe
    [capsule([s * 0.025, 1.572, -0.066], [s * 0.165, 1.59, -0.022], 0.012), 0.025],// Schlüsselbein
    [ellipsoid([s * 0.068, 0.985, 0.036], [0.084, 0.094, 0.074]), 0.05],           // Po
    [ellipsoid([s * 0.108, 1.11, -0.01], [0.05, 0.08, 0.075]), 0.06],              // Flanke/Hüfte
  );
}
const torso = memo(U(torsoItems));

const neck = U([
  [roundCone([0, 1.55, 0.004], [0, 1.745, -0.012], 0.064, 0.056), 0],
  ...SIDES.map(([s]) => [capsule([s * 0.058, 1.72, 0.012], [s * 0.016, 1.572, -0.06], 0.014), 0.03]), // Halsmuskel
]);

// Kopf (in Kopf-Maßen)
const headNoEyes = U([
  [ellipsoid(hp(H, [0, 0.028, 0.012]), [0.117, 0.128, 0.13]), 0],                        // Schädel
  [ellipsoid(hp(H, [0, -0.035, -0.032]), [0.098, 0.1, 0.1]), 0.05],                     // Gesicht
  [ellipsoid(hp(H, [0, -0.08, -0.04]), [0.08, 0.05, 0.078]), 0.04],                     // Kiefer
  [ellipsoid(hp(H, [0, -0.111, -0.084]), [0.042, 0.029, 0.031]), 0.03],                   // Kinn
  [capsule(hp(H, [-0.06, 0.047, -0.106]), hp(H, [0.06, 0.047, -0.106]), 0.015), 0.03],  // Brauenbogen
  [roundCone(hp(H, [0, 0.016, -0.12]), hp(H, [0, -0.03, -0.147]), 0.009, 0.0155), 0.02], // Nase
  [ellipsoid(hp(H, [0, -0.083, -0.118]), [0.024, 0.008, 0.012]), 0.016],                // Unterlippe
  [ellipsoid(hp(H, [0, -0.06, -0.122]), [0.03, 0.009, 0.012]), 0.02],                   // Oberlippe
  ...SIDES.flatMap(([s]) => [
    [capsule(hp(H, [s * 0.088, -0.05, -0.005]), hp(H, [s * 0.032, -0.113, -0.078]), 0.024), 0.035], // Kieferkante
    [ellipsoid(hp(H, [s * 0.058, -0.02, -0.086]), [0.033, 0.025, 0.03]), 0.03],         // Wangenknochen
    [sphere(hp(H, [s * 0.0135, -0.034, -0.135]), 0.0105), 0.01],                         // Nasenflügel
    [oellipsoid(hp(H, [s * 0.117, -0.012, 0.006]), [0, 1, 0.15], [s, 0, -0.35], 0.042, 0.019, 0.03), 0.012], // Ohr
  ]),
]);
function surfaceAlong(f, from, dir, maxT = 0.3) {
  // vom Inneren nach außen, bis das Feld positiv wird, dann halbieren
  let a = 0, b = 0;
  for (let t = 0; t <= maxT; t += 0.002) { const p = add(from, dir, t); if (f.d(...p) > 0) { b = t; break; } a = t; }
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (f.d(...add(from, dir, m)) > 0) b = m; else a = m; }
  return add(from, dir, (a + b) / 2);
}
// Augen: groß und ausdrucksstark, Lage aus der Gesichtsoberfläche
const EYE_R = 0.0275;
const eyes = SIDES.map(([s]) => {
  const surf = surfaceAlong(headNoEyes, hp(H, [s * 0.047, 0.006, -0.02]), [0, 0, -1]);
  return { s, c: add(surf, [0, 0, 0.0145]), gaze: norm([s * 0.07, -0.03, -1]) };
});
const sockets = U(eyes.map(e => [sphere(e.c, EYE_R + 0.0035), 0]));
const innerEar = U(SIDES.map(([s]) => [ellipsoid(hp(H, [s * 0.128, -0.01, 0.002]), [0.008, 0.025, 0.017]), 0]));
const headU = fn(headNoEyes.bb, (x, y, z) => smax(smax(headNoEyes.d(x, y, z), -sockets.d(x, y, z), 0.008), -innerEar.d(x, y, z), 0.006));
const headW = scaled(headU);
{ const w = sub(hs(eyes[1].c), H); if (Math.abs(w[1] - EYE_PIVOT[1]) + Math.abs(w[2] - EYE_PIVOT[2]) > 0.002) console.log(`Hinweis: EYE_PIVOT in rig.js sollte [0, ${w[1].toFixed(4)}, ${w[2].toFixed(4)}] sein`); }

// Arme und Hände (Hände etwas größer, mit einzelnen Fingern in lockerer Haltung)
const arm = {};
const HAND = 1.16;
for (const [s, k] of SIDES) {
  const sh = R['sh' + k], el = R['el' + k], hd = R['hd' + k], d = norm(sub(el, sh)), fr = [0, 0, -1];
  const n = norm([-s * 0.643, -0.766, 0]); // Handfläche zeigt zum Körper
  arm[k] = { sh, el, hd, d, n };
  const hpt = (a, b, c) => add(add(add(hd, d, a * HAND), fr, b * HAND), n, c * HAND);
  const items = [
    [roundCone(sh, el, 0.062, 0.047), 0],
    [oellipsoid(add(add(sh, d, 0.06), [0, 0.012, 0], 1), d, fr, 0.085, 0.066, 0.07), 0.03],  // Schultermuskel
    [oellipsoid(add(add(sh, d, 0.165), fr, 0.016), d, fr, 0.085, 0.05, 0.05), 0.025],        // Bizeps
    [oellipsoid(add(add(sh, d, 0.15), fr, -0.016), d, fr, 0.1, 0.047, 0.049), 0.025],        // Trizeps
    [sphere(add(el, fr, -0.012), 0.04), 0.02],                                               // Ellbogen
    [roundCone(el, hd, 0.045, 0.031), 0.03],
    [oellipsoid(add(add(el, d, 0.075), fr, 0.008), d, fr, 0.085, 0.048, 0.043), 0.03],       // Unterarm
    [oellipsoid(hpt(0.05, 0, 0), d, fr, 0.052 * HAND, 0.041 * HAND, 0.019 * HAND), 0.02],    // Handfläche (u=d, v=vorn, w=Dicke)
    [oellipsoid(hpt(0.04, 0.026, 0.008), add(d, fr, 0.5), n, 0.03 * HAND, 0.017 * HAND, 0.017 * HAND), 0.012], // Daumenballen
  ];
  // Finger: Zeige- bis kleiner Finger, je zwei Glieder, leicht gekrümmt und gespreizt
  const FING = [[0.03, 0.068, 0.0098, 0.14], [0.0105, 0.077, 0.0102, 0.04], [-0.009, 0.071, 0.0097, -0.06], [-0.027, 0.056, 0.0086, -0.17]];
  const fingers = [];
  for (const [o, L, r, spread] of FING) {
    const a = hpt(0.09 - Math.abs(o) * 0.25, o, 0.002), dir1 = norm(add(add(d, fr, spread), n, 0.18)), dir2 = norm(add(add(d, fr, spread * 1.2), n, 0.62));
    const b = add(a, dir1, L * 0.55 * HAND), c = add(b, dir2, L * 0.5 * HAND);
    fingers.push([roundCone(a, b, r * HAND, r * 0.92 * HAND), 0.004], [roundCone(b, c, r * 0.92 * HAND, r * 0.76 * HAND), 0.003]);
  }
  { const a = hpt(0.03, 0.036, 0.01), b = add(a, norm(add(add(d, fr, 0.95), n, 0.35)), 0.04 * HAND), c = add(b, norm(add(add(d, fr, 0.35), n, 0.5)), 0.033 * HAND); // Daumen
    fingers.push([roundCone(a, b, 0.0125 * HAND, 0.0108 * HAND), 0.004], [roundCone(b, c, 0.0108 * HAND, 0.009 * HAND), 0.003]); }
  items.push([U(fingers), 0.011]);
  arm[k].skin = U(items);
}
// Beine und Füße (Sohle bei y = 0)
const leg = {};
for (const [s, k] of SIDES) {
  const h = R['hp' + k], kn = R['kn' + k], ft = R['ft' + k], d = norm(sub(kn, h)), dl = norm(sub(ft, kn)), fr = [0, 0, -1];
  leg[k] = { hp: h, kn, ft, d, dl };
  const toes = [];
  for (let i = 0; i < 5; i++) { const u = i / 4, x = -s * (0.03 - u * 0.062), r = 0.0165 - u * 0.006; toes.push([ellipsoid(add(ft, [x, -0.07 + r + 0.001, -0.176 + u * u * 0.03 + (i === 0 ? -0.004 : 0)]), [r * 1.02, r, r * 1.5]), 0.004]); }
  const foot = U([
    [ellipsoid(add(ft, [0, -0.036, 0.03]), [0.036, 0.038, 0.046]), 0],                      // Ferse
    [ellipsoid(add(ft, [-s * 0.004, -0.04, -0.064]), [0.045, 0.034, 0.11]), 0.03],         // Mittelfuß
    [ellipsoid(add(ft, [-s * 0.004, -0.053, -0.142]), [0.05, 0.02, 0.04]), 0.02],          // Ballen
    [U(toes), 0.012],
  ]);
  const footFlat = fn(foot.bb, (x, y, z) => smax(foot.d(x, y, z), -y, 0.012));
  leg[k].skin = U([
    [roundCone(h, kn, 0.088, 0.06), 0],
    [oellipsoid(add(add(h, d, 0.2), fr, 0.02), d, fr, 0.2, 0.072, 0.072), 0.04],             // Oberschenkel vorn
    [oellipsoid(add(add(h, d, 0.25), fr, -0.03), d, fr, 0.17, 0.06, 0.062), 0.04],           // Oberschenkel hinten
    [ellipsoid(add(kn, [0, 0.008, -0.044]), [0.034, 0.04, 0.024]), 0.022],                   // Kniescheibe
    [roundCone(kn, ft, 0.056, 0.034), 0.03],
    [oellipsoid(add(add(kn, dl, 0.13), fr, -0.026), dl, fr, 0.13, 0.054, 0.052), 0.035],     // Wade
    [capsule(add(kn, [0, -0.05, -0.042]), add(ft, [0, 0.06, -0.022]), 0.016), 0.03],         // Schienbein
    [sphere(ft, 0.038), 0.02],
    [sphere(add(ft, [s * 0.03, 0.004, 0.004]), 0.017), 0.014],                               // Knöchel außen
    [sphere(add(ft, [-s * 0.028, 0.012, 0.0]), 0.016), 0.014],
    [footFlat, 0.02],
  ]);
}

// Haut gesamt
const skin = memo(U([[torso, 0], [neck, 0.045], [headW, 0.035],
  [arm.L.skin, 0.035], [arm.R.skin, 0.035], [leg.L.skin, 0.05], [leg.R.skin, 0.05]]));

// Winkel um eine Gliedachse (0 = nach außen, +π/2 = nach vorn)
const around = (p, o, d, s) => { const q = sub(p, o), t = dot(q, d), r = sub(q, mul(d, t)); return [Math.atan2(-r[2], s * r[0]), t, len(r)]; };

// Shirt (Lycra): liegt eng an, runder Halsausschnitt mit Bündchen, kurze Ärmel mit Saum, ein paar Zugfalten
const SHIRT_HEM = 1.08;
const sleeves = U(SIDES.map(([s, k]) => [cappedCone(add(arm[k].sh, arm[k].d, -0.04), add(arm[k].sh, arm[k].d, 0.165), 0.085, 0.072, 0.006), 0]));
const neckOpen = ellipsoid([0, 1.652, -0.022], [0.092, 0.085, 0.092]);
const shirt = fn(torso.bb, (x, y, z) => {
  if (y < SHIRT_HEM - 0.03) return BIG;
  let inflate = 0.0055 + 0.012 * smoothstep(1.2, 1.1, y);
  // Zugfalten: an der Taille quer, unter den Armen schräg
  const ax = Math.abs(x);
  inflate += 0.0022 * Math.sin(y * 82 + ax * 26 + Math.sin(z * 30) * 1.3) * smoothstep(1.34, 1.24, y) * smoothstep(1.09, 1.14, y) * smoothstep(0.02, 0.1, ax);
  inflate += 0.002 * Math.sin((y - ax * 0.9) * 95) * smoothstep(0.1, 0.15, ax) * smoothstep(1.3, 1.36, y) * smoothstep(1.46, 1.4, y);
  inflate += 0.0035 * smoothstep(SHIRT_HEM + 0.022, SHIRT_HEM + 0.016, y);          // Saum trägt auf
  const no = neckOpen.d(x, y, z);
  inflate += 0.0045 * smoothstep(0.019, 0.013, no);                                    // Halsbündchen
  let d = torso.d(x, y, z) - inflate, sl = sleeves.d(x, y, z);
  for (const [s, k] of SIDES) if (s * x > 0.2) { const t = dot(sub([x, y, z], arm[k].sh), arm[k].d); sl -= 0.0035 * smoothstep(0.124, 0.13, t); }
  d = smin(d, sl, 0.03);
  d = smax(d, -no, 0.0025);
  return smax(d, SHIRT_HEM - y, 0.003);
});

// Boardshorts: weit geschnitten, Bund, Hosenbeine bis knapp übers Knie mit welligem Saum und Falten
const SHORTS_TOP = 1.13, HEM_T = 0.75, LEGLEN = 0.46;
const legTubes = U(SIDES.map(([s, k]) => [cappedCone(add(leg[k].hp, [0, 0.06, 0]), add(leg[k].hp, leg[k].d, LEGLEN * HEM_T), 0.112, 0.106, 0.007), 0]));
const shorts = fn(torso.bb, (x, y, z) => {
  if (y > SHORTS_TOP + 0.03 || y < 0.45) return BIG;
  const s = x < 0 ? -1 : 1, g = leg[s < 0 ? 'L' : 'R'], [ang, t] = around([x, y, z], g.hp, g.d, s), tt = t / LEGLEN;
  let puff = 0.004 * Math.cos(ang * 5 + s * 0.7) * smoothstep(0.25, 0.8, tt)                    // Längsfalten zum Saum hin
    + 0.003 * Math.sin((y + Math.abs(x) * 0.7) * 70 + z * 20) * smoothstep(0.45, 0.2, tt) * smoothstep(1.1, 1.04, y) // Sitzfalten
    + 0.003 * smoothstep(HEM_T - 0.066, HEM_T - 0.056, tt)                                        // Saum
    + 0.004 * smoothstep(SHORTS_TOP - 0.03, SHORTS_TOP - 0.024, y);                              // Bund
  const d = smin(torso.d(x, y, z) - 0.014, legTubes.d(x, y, z), 0.05) - puff;
  return smax(d, y - SHORTS_TOP, 0.004);
});

// Haare: sonnengebleichte Surfer-Mähne – unter der Kappe quillt sie in dicken, geschwungenen Strähnen heraus
const hairItems = [];
const lock = (pts, radii, k = 0.007) => { for (let i = 0; i < pts.length - 1; i++) hairItems.push([roundCone(hp(H, pts[i]), hp(H, pts[i + 1]), radii[i], radii[i + 1]), k]); };
const rnd = i => { const v = Math.sin(i * 127.1 + 3.7) * 43758.5453; return v - Math.floor(v); };
// Hinterkopf und Nacken: Strähnen fallen nach unten und schwingen an der Spitze nach außen
for (let i = 0; i < 9; i++) {
  const a = (i - 4) / 4 * 1.75 + (rnd(i) - 0.5) * 0.12, sa = Math.sin(a), ca = Math.cos(a), Lk = 0.72 + rnd(i + 20) * 0.3 - Math.abs(i - 4) * 0.045, tw = (rnd(i + 40) - 0.5) * 0.5 + sa * 0.25;
  const P = (r, y, da = 0) => [Math.sin(a + da) * r * 0.95, y, Math.cos(a + da) * r + 0.014];
  lock([P(0.112, 0.03), P(0.132, -0.03 * Lk, tw * 0.15), P(0.128, -0.095 * Lk, tw * 0.35), P(0.148, -0.15 * Lk, tw * 0.6), P(0.176, -0.158 * Lk, tw * 0.8)], [0.03, 0.034, 0.03, 0.019, 0.004]);
}
for (const [s] of SIDES) {
  // Schläfen: vor dem Ohr nach unten, Spitze nach vorn
  lock([[s * 0.1, 0.04, -0.05], [s * 0.118, -0.01, -0.066], [s * 0.115, -0.062, -0.078], [s * 0.118, -0.092, -0.1]], [0.024, 0.024, 0.016, 0.003]);
  // über dem Ohr nach hinten
  lock([[s * 0.108, 0.04, -0.01], [s * 0.132, 0.0, 0.02], [s * 0.138, -0.05, 0.05], [s * 0.158, -0.085, 0.066]], [0.026, 0.03, 0.022, 0.004]);
}
// Pony: ein paar Strähnen schauen unter dem Schirm hervor, zur Seite gekämmt
lock([[0.05, 0.066, -0.1], [0.012, 0.058, -0.127], [-0.035, 0.046, -0.128], [-0.066, 0.03, -0.116]], [0.02, 0.02, 0.015, 0.003]);
lock([[0.088, 0.06, -0.074], [0.074, 0.05, -0.106], [0.062, 0.036, -0.118]], [0.02, 0.018, 0.003]);
lock([[-0.04, 0.062, -0.1], [-0.07, 0.045, -0.105], [-0.092, 0.018, -0.094]], [0.018, 0.018, 0.003]);
const CAP_TILT_ = 0.1, CAPC_ = hp(H, [0, 0.062, 0.012]), CR_ = [0.126, 0.11, 0.142], capBody = ellipsoid(CAPC_, CR_);
const hairShell = ellipsoid(hp(H, [0, 0.005, 0.018]), [0.124, 0.135, 0.13]);
const hairU = U(hairItems);
const hairHead = fn(bbox([H], 0.3), (x, y, z) => {
  if (Math.abs(x - H[0]) > 0.24 || Math.abs(y - H[1]) > 0.26 || Math.abs(z - H[2]) > 0.26) return BIG;
  let sh = hairShell.d(x, y, z);
  sh = smax(sh, (y - H[1]) - 0.07, 0.01);            // oben: Kappe
  sh = smax(sh, (H[1] - 0.085) - y + Math.max(0, -(z - H[2])) * 0.4, 0.012); // unten: Nackenlinie
  sh = smax(sh, (H[2] - 0.035) - z + Math.max(0, (y - H[1]) * -0.3), 0.012); // vorn: Gesicht frei
  let d = smin(sh, hairU.d(x, y, z), 0.01);
  const q = rotX([x, y, z], H, -CAP_TILT_);                 // unter der Kappe ist kein Haar (sonst drückt es durch)
  if (q[1] > CAPC_[1] - 0.016) d = smax(d, -(capBody.d(q[0], q[1], q[2]) + 0.004), 0.004);
  return d;
});
const hair = scaled(hairHead);

const LAYER = { skin, shirt, shorts, hair };
const LAYERS = Object.entries(LAYER);
const F = (x, y, z) => Math.min(skin.d(x, y, z), shirt.d(x, y, z), shorts.d(x, y, z), hair.d(x, y, z));
function layerAt(x, y, z) {
  let best = 0, bd = Infinity;
  LAYERS.forEach(([, l], i) => { const d = l.d(x, y, z) - (i ? 0.0004 : 0); if (d < bd) { bd = d; best = i; } }); // Stoff liegt bei Gleichstand oben
  return LAYERS[best][0];
}

/* ---------- Farben: jede Farbfläche ist eine Zone mit scharfem Rand ---------- */
const C = {
  skin: srgb('#eda476'), blush: srgb('#f08a70'), warm: srgb('#e88e66'), sole: srgb('#f6c9a6'), zinc: srgb('#f4fbff'),
  shirt: srgb('#ff6534'), shirtD: srgb('#f2521f'), shirtL: srgb('#fff4e6'),
  shorts: srgb('#2349b4'), shortsD: srgb('#1b3a96'), shortsL: srgb('#ffd23f'), band: srgb('#152d74'), wave: srgb('#eef8ff'),
  hairRoot: srgb('#b97f24'), hair: srgb('#f2bc42'), hairTip: srgb('#fff0a8'),
};
// Material je Punkt: [Haut-Anteil (1 = Haut, 0.5 = Haar, 0 = Stoff), Glanz]
const M = { skin: [1, 0.22], cloth: [0, 0.06], lycra: [0, 0.2], hair: [0.5, 0.6], eye: [0, 1], flat: [0, 0] };
const near = (p, c, r0, r1) => 1 - smoothstep(r0, r1, len(sub(p, c)));
function skinColor(p) {
  let c = C.skin;
  if (p[1] > 1.66) {
    const q = uh(p);
    for (const [s] of SIDES) { c = mixc(c, C.blush, near(q, hp(H, [s * 0.064, -0.04, -0.098]), 0.006, 0.036) * 0.38); c = mixc(c, C.blush, near(q, hp(H, [s * 0.122, -0.012, 0.004]), 0.01, 0.045) * 0.3); }
    c = mixc(c, C.blush, near(q, hp(H, [0, -0.03, -0.15]), 0.004, 0.026) * 0.3);
    c = mixc(c, C.blush, near(q, hp(H, [0, -0.074, -0.125]), 0.004, 0.022) * 0.4);
  }
  for (const [s, k] of SIDES) { // Knie, Ellbogen, Knöchel der Hand etwas wärmer
    c = mixc(c, C.warm, near(p, add(leg[k].kn, [0, 0, -0.04]), 0.02, 0.07) * 0.5);
    c = mixc(c, C.warm, near(p, arm[k].el, 0.02, 0.06) * 0.45);
    c = mixc(c, C.warm, near(p, add(arm[k].hd, arm[k].d, 0.1), 0.02, 0.07) * 0.35);
  }
  if (p[1] < 0.06) c = mixc(C.sole, c, smoothstep(0.008, 0.03, p[1]));
  return c;
}
function hairColor(p) {
  const q = uh(p), r = len(sub(q, hp(H, [0, 0.0, 0.015]))), a = Math.atan2(q[0], q[2] - H[2]);
  let c = r < 0.132 ? mixc(C.hairRoot, C.hair, smoothstep(0.112, 0.132, r)) : mixc(C.hair, C.hairTip, smoothstep(0.14, 0.185, r));
  const streak = 0.5 + 0.5 * Math.sin(a * 11 + Math.sin(q[1] * 40) * 0.6);
  return mixc(c, C.hairTip, streak * streak * 0.22);
}
const ZONES = [];
const zone = (layer, col, mat) => ZONES.push({ layer, col, mat }) - 1;
const Z = {
  skin: zone('skin', skinColor, M.skin), zinc: zone('skin', C.zinc, M.cloth),
  shirt: zone('shirt', p => mixc(C.shirtD, C.shirt, smoothstep(1.1, 1.5, p[1])), M.lycra), trim: zone('shirt', C.shirtL, M.lycra),
  shorts: zone('shorts', p => mixc(C.shortsD, C.shorts, smoothstep(0.62, 1.05, p[1])), M.cloth), band: zone('shorts', C.band, M.cloth),
  stripe: zone('shorts', C.shortsL, M.cloth), wave: zone('shorts', C.wave, M.cloth), shortsIn: zone('shorts', srgb('#0d1d4d'), M.flat), shirtIn: zone('shirt', srgb('#8a2c10'), M.flat),
  hair: zone('hair', hairColor, M.hair),
};
const ZINC = process.env.ZINC === '1';
function zoneAt(x, y, z) {
  const layer = layerAt(x, y, z), p = [x, y, z];
  if (layer === 'skin') {
    if (ZINC && y > 1.78) { // Sonnencreme-Streifen quer über Nase und Wangen
      const q = uh(p), dy = q[1] - (H[1] - 0.012 - Math.abs(q[0]) * 0.1);
      if (Math.abs(dy) < 0.0085 && q[2] < H[2] - 0.09 && Math.abs(q[0]) < 0.062) return Z.zinc;
    }
    return Z.skin;
  }
  if (layer === 'shirt') {
    for (const [s, k] of SIDES) { // Ärmelbündchen
      const a = arm[k], t = dot(sub(p, a.sh), a.d);
      if (s * x > 0.2 && t > 0.1662) return Z.shirtIn;                  // Blick in den Ärmel
      if (s * x > 0.2 && t > 0.127) return Z.trim;
    }
    if (y < SHIRT_HEM + 0.0012) return Z.shirtIn;
    if (y < SHIRT_HEM + 0.02) return Z.trim;                             // Saum
    if (neckOpen.d(x, y, z) < 0.017) return Z.trim;                      // Kragen
    const th = Math.abs(Math.atan2(x, -(z - 0.005)));                    // Seitenstreifen, läuft unter der Achsel aus
    if (th > 1.36 && th < 1.84 && y < 1.44 - 2.2 * (th - 1.6) * (th - 1.6)) return Z.trim;
    return Z.shirt;
  }
  if (layer === 'shorts') {
    if (y > SHORTS_TOP - 0.027) return Z.band;
    const s = x < 0 ? -1 : 1, g = leg[s < 0 ? 'L' : 'R'], [ang, t] = around(p, g.hp, g.d, s), tt = t / LEGLEN;
    if (t > LEGLEN * HEM_T + 0.0004) return Z.shortsIn;                    // Blick ins Hosenbein
    if (tt > HEM_T - 0.058) return Z.stripe;                              // Saum
    if (Math.abs(ang) < 0.3) return Z.stripe;                              // Seitenstreifen
    const w = tt - (0.45 + 0.03 * Math.sin(ang * 4 + 1));                 // Wellenlinie
    if (w > 0 && w < 0.045) return Z.wave;
    return Z.shorts;
  }
  return Z.hair;
}

/* =========================================================================
   Oberfläche: Surface Nets auf einem Raster, dann genau auf die Form gezogen
   ========================================================================= */
function surfaceNets(f, b, S) {
  const x0 = b[0] - 2 * S, y0 = b[1] - 2 * S, z0 = b[2] - 2 * S, CO = 4;
  const rnd4 = n => Math.ceil((n - 1) / CO) * CO + 1;
  const nx = rnd4(Math.ceil((b[3] - x0) / S) + 3), ny = rnd4(Math.ceil((b[4] - y0) / S) + 3), nz = rnd4(Math.ceil((b[5] - z0) / S) + 3);
  const V = new Float32Array(nx * ny * nz).fill(NaN);
  // erst grob abtasten, nur nahe der Oberfläche fein rechnen
  const skip = [], lim = CO * S * 0.87 * 2.3; let evals = 0;
  for (let k = 0; k < nz - 1; k += CO) for (let j = 0; j < ny - 1; j += CO) for (let i = 0; i < nx - 1; i += CO) {
    const dc = f(x0 + (i + CO / 2) * S, y0 + (j + CO / 2) * S, z0 + (k + CO / 2) * S);
    if (Math.abs(dc) > lim) { skip.push(i, j, k, dc < 0 ? -BIG : BIG); continue; }
    for (let c = k; c <= k + CO; c++) for (let bq = j; bq <= j + CO; bq++) for (let a = i; a <= i + CO; a++) { const o = a + nx * (bq + ny * c); if (V[o] !== V[o]) { V[o] = f(x0 + a * S, y0 + bq * S, z0 + c * S); evals++; } }
  }
  for (let q = 0; q < skip.length; q += 4) { const i = skip[q], j = skip[q + 1], k = skip[q + 2], v = skip[q + 3];
    for (let c = k; c <= k + CO; c++) for (let bq = j; bq <= j + CO; bq++) for (let a = i; a <= i + CO; a++) { const o = a + nx * (bq + ny * c); if (V[o] !== V[o]) V[o] = v; } }
  console.log(`Raster ${nx}×${ny}×${nz} (${(nx * ny * nz / 1e6).toFixed(1)} Mio. Punkte, ${(evals / 1e6).toFixed(1)} Mio. gerechnet)`);
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), ci = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let m = 0;
    for (let c = 0; c < 8; c++) { const [a, bb, e] = corners[c]; cv[c] = V[(i + a) + nx * ((j + bb) + ny * (k + e))]; if (cv[c] < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, bb] of edges) {
      if ((cv[a] < 0) === (cv[bb] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[bb]), A = corners[a], B = corners[bb];
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; n++;
    }
    cell[ci(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / n) * S, y0 + (j + sy / n) * S, z0 + (k + sz / n) * S);
  }
  const quads = [];
  const val = (i, j, k) => V[i + nx * (j + ny * k)];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val(i, j, k) < 0;
    if (v0 !== (val(i + 1, j, k) < 0)) { const q = [ci(i, j - 1, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i, j - 1, k)]; quads.push(v0 ? q : q.reverse()); }
    if (v0 !== (val(i, j + 1, k) < 0)) { const q = [ci(i - 1, j, k - 1), ci(i - 1, j, k), ci(i, j, k), ci(i, j, k - 1)]; quads.push(v0 ? q : q.reverse()); }
    if (v0 !== (val(i, j, k + 1) < 0)) { const q = [ci(i - 1, j - 1, k), ci(i, j - 1, k), ci(i, j, k), ci(i - 1, j, k)]; quads.push(v0 ? q : q.reverse()); }
  }
  return { pos, quads: quads.map(q => q.map(c => cell[c])) };
}
const grad = (f, x, y, z, h = 0.0008) => [f(x + h, y, z) - f(x - h, y, z), f(x, y + h, z) - f(x, y - h, z), f(x, y, z + h) - f(x, y, z - h)].map(v => v / (2 * h));
const project = (p, it = 5) => { for (let i = 0; i < it; i++) { const d = F(...p), g = grad(F, ...p), gg = dot(g, g); if (gg < 1e-8) break; p = sub(p, mul(g, clamp(d / gg, -STEP, STEP))); } return p; };

/* ---------- Knochen-Gewichte ----------
   Grundverteilung: Abstand zu Knochen-Kapseln, links/rechts und Kopf/Brust getrennt. An Knie und Ellbogen
   übernimmt ein Hilfsknochen, der nur halb mitdreht – das Gelenk biegt sich rund statt einzuknicken.
   Haarsträhnen und Hosensaum hängen an eigenen Knochen und schwingen nach. */
const L = n => R[n];
const segs = {
  pelvis: [L('hpL'), L('hpR'), 0.11], spine: [[0, 1.14, 0], [0, 1.3, 0], 0.125], chest: [[-0.11, 1.42, 0], [0.11, 1.42, 0], 0.15],
  neck: [[0, 1.6, 0], [0, 1.74, -0.012], 0.055], head: [[0, 1.8, -0.02], [0, 1.93, -0.01], 0.1],
};
for (const [s, k] of SIDES) {
  const a = arm[k], g = leg[k];
  segs['up' + k] = [a.sh, a.el, 0.055]; segs['lo' + k] = [a.el, a.hd, 0.04]; segs['hand' + k] = [add(a.hd, a.d, 0.03), add(a.hd, a.d, 0.17), 0.035];
  segs['thigh' + k] = [g.hp, g.kn, 0.085]; segs['shin' + k] = [g.kn, g.ft, 0.05]; segs['foot' + k] = [add(g.ft, [0, -0.04, 0.03]), add(g.ft, [0, -0.045, -0.17]), 0.03];
}
const BASE = Object.keys(segs);
function segDist(p, a, b) { const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / dot(ab, ab), 0, 1); return len(sub(p, add(a, ab, t))); }
const CAP_RIM_Y = H[1] + 0.05; // Unterkante der Kappe (Kopf-Maße)
function weightsAt(p, layer) {
  const w = new Array(BONES.length).fill(0);
  if (layer === 'hair') { // Kopf, zu den Spitzen hin zunehmend die Haarknochen
    const q = uh(p), free = smoothstep(CAP_RIM_Y - 0.03, CAP_RIM_Y - 0.15, q[1]) * 0.92 * smoothstep(H[2] - 0.11, H[2] - 0.05, q[2]);
    const wl = smoothstep(-0.03, -0.11, q[0]), wr = smoothstep(0.03, 0.11, q[0]);
    w[BONE.head] = 1 - free; w[BONE.hairL] = free * wl; w[BONE.hairR] = free * wr; w[BONE.hairB] = free * (1 - wl - wr);
    return w;
  }
  for (const name of BASE) {
    const [a, b, r] = segs[name]; let g = 1;
    if (name.endsWith('L') && name !== 'pelvis') g = smoothstep(0.03, -0.03, p[0]);
    if (name.endsWith('R')) g = smoothstep(-0.03, 0.03, p[0]);
    if (name === 'head') g = smoothstep(1.67, 1.75, p[1]);
    if (name === 'chest') g *= smoothstep(1.76, 1.68, p[1]);
    const d = Math.max(segDist(p, a, b) - r, 0.004);
    w[BONE[name]] = g / (d * d * d * d);
  }
  const sum = w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) w[i] /= sum;
  for (const [s, k] of SIDES) {
    const g = leg[k], a = arm[k];
    for (const [up, lo, mid, o, d1, d2, h] of [['thigh', 'shin', 'knee', g.kn, g.d, g.dl, 0.12], ['up', 'lo', 'elb', a.el, a.d, a.d, 0.085]]) {
      const iu = BONE[up + k], il = BONE[lo + k], W = w[iu] + w[il]; if (W < 1e-4) continue;
      const q = sub(p, o), u = (dot(q, d1) + dot(q, d2)) / 2, km = (1 - smoothstep(0, h, Math.abs(u))) * (layer === 'shorts' ? 0.4 : 1);
      // die Aufteilung oben/unten wird weich über das Gelenk geführt
      const lower = smoothstep(-h * 0.5, h * 0.5, u);
      w[BONE[mid + k]] = W * km; w[iu] = W * (1 - km) * (1 - lower); w[il] = W * (1 - km) * lower;
    }
    if (layer === 'shorts') { // Hosenbein: zum Saum hin am Saumknochen
      const t = dot(sub(p, g.hp), g.d) / (LEGLEN * HEM_T), f = smoothstep(0.4, 1.0, t) * 0.85, it = BONE['thigh' + k], ik = BONE['knee' + k];
      const mv = (w[it] + w[ik]) * f; w[BONE['hem' + k]] = mv; w[it] *= 1 - f; w[ik] *= 1 - f;
    }
  }
  return w;
}
function top4(w) {
  const idx = w.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 4);
  const sum = idx.reduce((a, [v]) => a + v, 0);
  let q = idx.map(([v]) => Math.round(v / sum * 255)); q[0] += 255 - q.reduce((a, b) => a + b, 0);
  return { j: idx.map(([, i]) => i), w: q };
}

/* =========================================================================
   Zusätze mit scharfen Kanten: Kappe, Augen, Lider, Brauen, Mund, Logo, Kordel
   ========================================================================= */
const extra = []; // {pos, nrm, col, out (Kontur-Faktor), bone (Name oder null = Gewichte berechnen), mat, u (Kopf-Maße), idx}
function part(bone = 'head', out = 1, mat = M.cloth, layer = 'shirt') { const p = { pos: [], nrm: [], col: [], idx: [], out, bone, mat, u: bone !== null, layer }; extra.push(p); return p; }
function vert(pt, p, n, c) { pt.pos.push(...p); pt.nrm.push(...norm(n)); pt.col.push(...c); return pt.pos.length / 3 - 1; }
// Gitter aus Funktion (u, v) → [punkt, normale, farbe]
function grid(pt, nu, nv, f, closeU = false, flip = false) {
  const base = pt.pos.length / 3, cols = closeU ? nu : nu + 1;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { const [p, n, c] = f(i / nu, j / nv); vert(pt, p, n, c); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = closeU ? (i + 1) % nu : i + 1, a = base + j * cols + i, b = base + j * cols + i1, c = base + (j + 1) * cols + i, d = base + (j + 1) * cols + i1;
    if (flip) pt.idx.push(a, c, b, b, c, d); else pt.idx.push(a, b, c, b, d, c);
  }
}
// Röhre entlang einer Linie, Radius r(t)
function tube(pt, pts, rf, col, seg = 8) {
  const N = pts.length;
  const frames = pts.map((p, i) => { const t = norm(sub(pts[Math.min(N - 1, i + 1)], pts[Math.max(0, i - 1)])); const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const a = norm(cross(t, up)); return [a, cross(a, t)]; });
  grid(pt, seg, N - 1, (u, v) => { const i = Math.round(v * (N - 1)), [a, b] = frames[i], ang = u * Math.PI * 2, n = add(mul(a, Math.cos(ang)), b, Math.sin(ang)), r = rf(i / (N - 1)); return [add(pts[i], n, r), n, col]; }, true);
}
const projectFace = (x, y, off = 0.0018) => { const p = surfaceAlong(headU, [x, y, H[2] - 0.02], [0, 0, -1]); const n = norm(grad(headU.d, ...p)); return [add(p, n, off), n]; };
const bezier = (a, b, c, t) => lerp3(lerp3(a, b, t), lerp3(b, c, t), t);

// Kappe: Krone aus sechs Bahnen mit Nähten, Knopf, Schweißband, Schirm, Logo
const CAP_TILT = CAP_TILT_, CAPC = CAPC_, CR = CR_;
const capT = p => rotX(p, H, CAP_TILT), capN = n => rotXv(n, CAP_TILT);
const cYel = srgb('#ffd23f'), cYelD = srgb('#f7b92a'), cBlue = srgb('#2349b4'), cBlueD = srgb('#18357f'), cOr = srgb('#ff6534'), cWhite = srgb('#fff7e8');
const crownPt = (th, ph, k = 1) => [CAPC[0] + CR[0] * k * Math.sin(th) * Math.sin(ph), CAPC[1] + CR[1] * k * Math.cos(th), CAPC[2] - CR[2] * k * Math.sin(th) * Math.cos(ph)];
const crownN = (th, ph) => norm([Math.sin(th) * Math.sin(ph) / CR[0], Math.cos(th) / CR[1], -Math.sin(th) * Math.cos(ph) / CR[2]]);
const TH_RIM = Math.PI / 2 + 0.13;
{
  const cap = part('head', 1);
  // Bahnen leicht gewölbt: zwischen den Nähten steht der Stoff etwas vor
  const puff = ph => 1 + 0.008 * Math.abs(Math.sin((ph - Math.PI / 6) * 3));
  grid(cap, 56, 12, (u, v) => { const th = v * TH_RIM, ph = u * Math.PI * 2; return [capT(crownPt(th, ph, puff(ph))), capN(crownN(th, ph)), mixc(cYelD, cYel, smoothstep(1.5, 0.5, th))]; }, true);
  const inner = part('head', 0);
  grid(inner, 48, 4, (u, v) => { const th = Math.PI / 2 - 0.25 + v * (TH_RIM - Math.PI / 2 + 0.25), ph = u * Math.PI * 2; return [capT(crownPt(th, ph, 0.985)), mul(capN(crownN(th, ph)), -1), srgb('#c99a22')]; }, true, true);
  const band = part('head', 0.4);
  grid(band, 56, 2, (u, v) => { const th = TH_RIM - 0.2 + v * 0.2, ph = u * Math.PI * 2; return [capT(crownPt(th, ph, 1.014 + 0.004 * Math.sin(v * Math.PI))), capN(crownN(th, ph)), cBlue]; }, true);
  const seams = part('head', 0);
  for (let i = 0; i < 6; i++) { const ph = i / 6 * Math.PI * 2 + Math.PI / 6, pts = []; for (let t = 0; t <= 12; t++) pts.push(capT(crownPt(0.02 + t / 12 * (TH_RIM - 0.2), ph, 1.006))); tube(seams, pts, () => 0.0024, cBlue, 5); }
  const btn = part('head', 0.5);
  grid(btn, 20, 6, (u, v) => { const th = v * Math.PI * 0.5, ph = u * Math.PI * 2, c = add(crownPt(0, 0), [0, 0.002, 0]); return [capT(add(c, [Math.sin(th) * Math.sin(ph) * 0.019, Math.cos(th) * 0.011, Math.sin(th) * Math.cos(ph) * 0.019])), capN([Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)]), cBlue]; }, true);
  // Schirm: von der Kronenkante nach vorn, an den Seiten leicht nach unten gebogen, mit runder Kante
  const brim = part('head', 0.55), PH = 1.42, NU = 40, NV = 6, TH2 = 0.0065;
  const brimPt = (u, v) => {
    const ph = (u * 2 - 1) * PH, reach = 0.1 * Math.pow(Math.cos(ph * 0.92), 0.8);
    const inner = crownPt(TH_RIM - 0.04, ph, 0.995), outR = [Math.sin(ph) * (CR[0] + 0.022), 0, -Math.cos(ph) * (CR[2] + reach)];
    return [mix(inner[0], CAPC[0] + outR[0], v), mix(inner[1], CAPC[1] - 0.012, v) - (0.026 * Math.sin(ph) ** 2 + 0.006) * v * v, mix(inner[2], CAPC[2] + outR[2], v)];
  };
  const brimNormal = (u, v) => { const e = 0.01, a = sub(brimPt(Math.min(1, u + e), v), brimPt(Math.max(0, u - e), v)), b = sub(brimPt(u, Math.min(1, v + e)), brimPt(u, Math.max(0, v - e))); const n = norm(cross(b, a)); return n[1] < 0 ? mul(n, -1) : n; };
  grid(brim, NU, NV, (u, v) => { const n = brimNormal(u, v); return [capT(add(brimPt(u, v), n, TH2)), capN(n), cBlue]; }, false, true);
  grid(brim, NU, NV, (u, v) => { const n = brimNormal(u, v); return [capT(add(brimPt(u, v), n, -TH2)), capN(mul(n, -1)), cBlueD]; }, false, false);
  grid(brim, NU, 3, (u, v) => { const n = brimNormal(u, 1), p = brimPt(u, 1), o = norm(sub(brimPt(u, 1), brimPt(u, 0.85))), a = (v - 0.5) * Math.PI, nn = add(mul(o, Math.cos(a)), n, Math.sin(a)); return [capT(add(add(p, n, Math.sin(a) * TH2), o, Math.cos(a) * TH2 * 0.9)), capN(nn), v > 0.5 ? cBlue : cBlueD]; }, false, true);
  // Logo vorn: oranger Kreis mit hellem Ring und Welle
  const logo = part('head', 0), lc = [0.0, 0.0], LTH = 0.98;
  const onCrown = (dx, dy, lift) => { const th = LTH - dy / CR[1], ph = dx / CR[0] / Math.sin(LTH); return [capT(crownPt(th, ph, 1 + lift)), capN(crownN(th, ph))]; };
  const disc = (r0, r1, col, lift) => grid(logo, 40, 2, (u, v) => { const a = u * Math.PI * 2, r = mix(r0, r1, v), [p, n] = onCrown(lc[0] + Math.cos(a) * r, lc[1] + Math.sin(a) * r, lift); return [p, n, col]; }, true, true);
  disc(0, 0.034, cWhite, 0.014); disc(0, 0.027, cOr, 0.02);
  const wave = []; for (let i = 0; i <= 20; i++) { const t = i / 20; wave.push(onCrown(-0.019 + t * 0.038, -0.004 + Math.sin(t * Math.PI * 2) * 0.006, 0.028)[0]); }
  tube(logo, wave, () => 0.0028, cWhite, 6);
}
// Augen: Augapfel mit Iris (heller Ring unten), Pupille, zwei Glanzpunkte; Oberlid mit Wimpernkante am Lid-Knochen
{
  const cEye = srgb('#ffffff'), cEyeS = srgb('#dfe8f2'), cIris = srgb('#3fa2ea'), cIrisL = srgb('#7fd2ff'), cIrisD = srgb('#1a4f96'), cPupil = srgb('#0c1118'), cLash = srgb('#2a1c14'), cLid = mixc(C.skin, C.warm, 0.5), cCrease = srgb('#b9683f');
  for (const e of eyes) {
    const ball = part('head', 0, M.eye), g = e.gaze, ax = norm(cross(g, [0, 1, 0])), ay = cross(ax, g);
    const rings = [0, 0.1, 0.2, 0.27, 0.27, 0.36, 0.46, 0.56, 0.62, 0.62, 0.8, 1.05, 1.35, 1.7, 2.1, 2.6, Math.PI];
    const NA = 28, base = ball.pos.length / 3;
    rings.forEach((th, j) => { for (let i = 0; i < NA; i++) { const a = i / NA * Math.PI * 2, n = add(add(mul(g, Math.cos(th)), ax, Math.sin(th) * Math.cos(a)), ay, Math.sin(th) * Math.sin(a));
      // Iris: oben dunkler (Lidschatten), unten leuchtend; dunkler Rand
      const up = Math.sin(a), col = j <= 3 ? cPupil : j <= 8 ? mixc(mixc(cIris, cIrisL, smoothstep(0.2, -0.9, up) * smoothstep(0.3, 0.5, th)), cIrisD, Math.max(smoothstep(0.52, 0.62, th), smoothstep(0.1, 0.9, up) * 0.75)) : mixc(cEye, cEyeS, smoothstep(0.2, 1, up) * 0.8);
      vert(ball, add(e.c, n, EYE_R), n, col); } });
    for (let j = 0; j < rings.length - 1; j++) { if (rings[j] === rings[j + 1]) continue; for (let i = 0; i < NA; i++) { const i1 = (i + 1) % NA, a = base + j * NA + i, b = base + j * NA + i1, c = base + (j + 1) * NA + i, d = base + (j + 1) * NA + i1; ball.idx.push(a, c, b, b, c, d); } }
    // Glanzpunkte: groß oben zur Sonne hin, klein gegenüber
    const glint = part('head', 0, M.flat);
    for (const [du, dv, r] of [[0.5, -0.36 * e.s, 0.0062], [-0.42, 0.3 * e.s, 0.003]]) {
      const hlDir = norm(add(add(g, ay, du), ax, dv)), hlC = add(e.c, hlDir, EYE_R + 0.0006);
      grid(glint, 12, 6, (u, v) => { const th = v * Math.PI, ph = u * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; return [add(hlC, n, r), n, cEye]; }, true);
    }
    // Oberlid als Schale über dem oberen Teil des Auges, an der Kante die dunkle Wimpernlinie
    const lid = part('lids', 0, M.skin), lAx = norm(add([0, 1, 0], g, 0.3)), lX = norm(cross(lAx, g)), lY = cross(lX, lAx), LID = 1.0, LR = EYE_R * 1.07;
    grid(lid, 28, 6, (u, v) => { const th = v * LID, a = u * Math.PI * 2, n = add(add(mul(lAx, Math.cos(th)), lX, Math.sin(th) * Math.cos(a)), lY, Math.sin(th) * Math.sin(a)); return [add(e.c, n, LR), n, mixc(cLid, cCrease, smoothstep(0.75, 1.0, v) * 0.35)]; }, true, true);
    const lashP = part('lids', 0, M.flat), lash = [];
    for (let i = 0; i <= 24; i++) { const a = Math.PI * (0.03 + i / 24 * 0.94), n = add(add(mul(lAx, Math.cos(LID)), lX, Math.sin(LID) * Math.cos(a)), lY, Math.sin(LID) * Math.sin(a)); lash.push(add(e.c, n, LR + 0.0008)); }
    tube(lashP, lash, t => 0.001 + 0.0019 * Math.pow(Math.sin(t * Math.PI), 0.6), cLash, 6);
    // Unterlid: feine, warme Linie
    const low = part('head', 0, M.flat), lw = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI * (1.12 + i / 16 * 0.76), n = norm(add(add(mul(g, Math.cos(0.9)), ax, Math.sin(0.9) * Math.cos(a)), ay, Math.sin(0.9) * Math.sin(a))); lw.push(add(e.c, n, EYE_R + 0.0012)); }
    tube(low, lw, t => 0.0004 + 0.0011 * Math.sin(t * Math.PI), cCrease, 5);
  }
  // Augenbrauen: kräftig, dunkelblond, außen leicht hochgezogen – selbstbewusster Blick
  const face = part('head', 0, M.hair), cBrow = srgb('#9a6418');
  for (const [s] of SIDES) {
    const a = [s * 0.013, H[1] + 0.043], b = [s * 0.052, H[1] + 0.062 + (s > 0 ? 0.004 : 0)], c = [s * 0.09, H[1] + 0.05];
    const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, q = bezier([...a, 0], [...b, 0], [...c, 0], t); pts.push(projectFace(q[0], q[1], 0.0028)[0]); }
    tube(face, pts, t => 0.004 + 0.006 * Math.sin(Math.min(1, t * 1.6 + 0.25) * Math.PI * 0.5) * (1 - t * 0.75), cBrow, 8);
  }
  // Mund: breites, leicht schiefes Grinsen mit Zähnen
  const mouth = part('head', 0, M.flat), cMouth = srgb('#4a1b1a'), cTeeth = srgb('#fffdf6'), cLip = srgb('#c7775a'), cTongue = srgb('#e0685f');
  const MX0 = -0.023, MX1 = 0.027, upY = u => H[1] - 0.068 - 0.0065 * Math.sin(u * Math.PI) + u * 0.004 + 0.006 * Math.pow(Math.abs(u * 2 - 1), 2.2), open = u => 0.0095 * Math.pow(Math.sin(u * Math.PI), 0.8) + 0.0003;
  const mpt = (u, v, lift) => projectFace(mix(MX0, MX1, u), upY(u) - open(u) * v, lift);
  grid(mouth, 24, 3, (u, v) => { const [p, n] = mpt(u, v * 0.48, 0.0016); return [p, n, cTeeth]; });
  grid(mouth, 24, 2, (u, v) => { const [p, n] = mpt(u, 0.48 + v * 0.52, 0.0012); return [p, n, mixc(cMouth, cTongue, smoothstep(0.35, 1, v) * Math.sin(u * Math.PI) * 0.8)]; });
  const lipU = [], lipL = [];
  for (let i = 0; i <= 28; i++) { const u = -0.07 + i / 28 * 1.14, uc = clamp(u, 0, 1), [p] = projectFace(mix(MX0, MX1, u), upY(uc) + (u !== uc ? Math.abs(u - uc) * 0.035 : 0), 0.002); lipU.push(p); }
  for (let i = 0; i <= 20; i++) { const u = i / 20; lipL.push(mpt(u, 1, 0.002)[0]); }
  tube(mouth, lipU, t => 0.0007 + 0.0015 * Math.sin(t * Math.PI), cMouth, 6);
  tube(mouth, lipL, t => 0.0004 + 0.0009 * Math.sin(t * Math.PI), cLip, 6);
}
// Sonnen-Logo auf dem Rücken des Shirts (folgt der Rückenform)
{
  const logo = part(null, 0, M.lycra), cSun = srgb('#ffd23f'), cx = 0, cy = 1.4;
  const onBack = (x, y, lift) => { const p = surfaceAlong(shirt, [x, y, 0], [0, 0, 1]); const n = norm(grad(shirt.d, ...p)); return [add(p, n, lift), n]; };
  const ring = (r0, r1, col, lift) => grid(logo, 48, 2, (u, v) => { const a = u * Math.PI * 2, r = mix(r0, r1, v), [p, n] = onBack(cx + Math.cos(a) * r, cy + Math.sin(a) * r, lift); return [p, n, col]; }, true);
  ring(0, 0.054, cWhite, 0.0016); ring(0, 0.044, cSun, 0.0028);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + 0.31, ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca;
    grid(logo, 2, 4, (u, v) => { const r = mix(0.062, 0.092, v), w = mix(0.0085, 0.0025, v) * (u * 2 - 1), [p, n] = onBack(cx + ca * r + tx * w, cy + sa * r + ty * w, 0.0016); return [p, n, cWhite]; });
  }
}
// Kordel am Hosenbund: Schleife mit zwei Enden
{
  const cord = part(null, 0.3, M.cloth, 'shorts'), y0 = SHORTS_TOP - 0.016;
  const onFront = (x, y, lift) => { const p = surfaceAlong(shorts, [x, y, 0], [0, 0, -1]); return add(p, norm(grad(shorts.d, ...p)), lift); };
  for (const s of [-1, 1]) {
    const loop = []; for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI * 2, r = Math.sin(a / 2); loop.push(onFront(s * (0.003 + 0.03 * r * Math.cos((a - Math.PI) * 0.42)), y0 - 0.002 + 0.016 * r * Math.sin((a - Math.PI) * 0.42) - 0.006 * r, 0.004 + 0.004 * r)); }
    tube(cord, loop, () => 0.0032, cWhite, 6);
    const end = []; for (let i = 0; i <= 10; i++) { const t = i / 10; end.push(onFront(s * (0.004 + 0.012 * t + 0.004 * Math.sin(t * 3)), y0 - 0.004 - 0.062 * t * (s > 0 ? 1 : 0.82), 0.0045)); }
    tube(cord, end, t => t > 0.86 ? 0.0052 : 0.003, cWhite, 6);
  }
  grid(cord, 10, 6, (u, v) => { const th = v * Math.PI, ph = u * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)], c = onFront(0.002, y0 - 0.003, 0.006); return [add(c, n, 0.0062), n, cWhite]; }, true);
}

/* =========================================================================
   Bauen
   ========================================================================= */
const t0 = Date.now(), lap = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
const bb = [-0.9, -0.03, -0.3, 0.9, 2.1, 0.3];
const sn = surfaceNets(F, bb, STEP);
let pos = sn.pos;
const nv = pos.length / 3, PV = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
console.log(`Oberfläche: ${nv} Punkte, ${sn.quads.length} Vierecke (${lap()})`);
// auf die Fläche ziehen
for (let i = 0; i < nv; i++) { const p = project(PV(i)); pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
{ // dicht? (jede Kante an genau zwei Vierecken)
  const ec = new Map(); for (const q of sn.quads) for (let e = 0; e < 4; e++) { const a = q[e], b = q[(e + 1) % 4], k = a < b ? a * nv + b : b * nv + a; ec.set(k, (ec.get(k) || 0) + 1); }
  let open = 0; for (const c of ec.values()) if (c !== 2) open++; if (open) console.log(`WARNUNG: ${open} offene Kanten`);
}
// Farbzonen: Punkte neben einer Farbgrenze werden genau auf die Grenze geschoben – so entstehen glatte Ränder
const zv = new Int16Array(nv); for (let i = 0; i < nv; i++) zv[i] = zoneAt(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
const bnd = new Uint8Array(nv);
{
  const nbr = Array.from({ length: nv }, () => []);
  for (const q of sn.quads) for (let e = 0; e < 4; e++) { nbr[q[e]].push(q[(e + 1) % 4]); nbr[q[(e + 1) % 4]].push(q[e]); }
  const np = pos.slice(); let moved = 0;
  for (let i = 0; i < nv; i++) {
    let best = 2, tgt = null; const a = PV(i);
    for (const j of nbr[i]) if (zv[j] !== zv[i]) {
      const b = PV(j); let lo = 0, hi = 1;
      for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (zoneAt(...lerp3(a, b, m)) === zv[i]) lo = m; else hi = m; }
      if (hi < best) { best = hi; tgt = lerp3(a, b, (lo + hi) / 2); }
    }
    if (tgt && best <= 0.52) { const p = project(tgt, 3); np[i * 3] = p[0]; np[i * 3 + 1] = p[1]; np[i * 3 + 2] = p[2]; bnd[i] = 1; moved++; }
  }
  pos = np; console.log(`Farbgrenzen: ${moved} Punkte ausgerichtet (${lap()})`);
}
// Dreiecke je Zone, Punkte an Grenzen verdoppeln
let tris = [];
const sp = [], sn3 = [], sc = [], sOrig = [], sZone = [];
{
  const NZ = ZONES.length, map = new Map();
  const vtx = (i, z) => { const k = i * NZ + z; let v = map.get(k); if (v === undefined) { v = sOrig.length; map.set(k, v); const p = PV(i), zn = ZONES[z];
    sp.push(...p); sn3.push(...norm(grad(LAYER[zn.layer].d, ...p))); sc.push(...(typeof zn.col === 'function' ? zn.col(p) : zn.col)); sOrig.push(i); sZone.push(z); } return v; };
  const tri = (a, b, c) => {
    let z = -1; for (const v of [a, b, c]) if (!bnd[v]) { z = zv[v]; break; }
    if (z < 0) { const pa = PV(a), pb = PV(b), pc = PV(c); z = zoneAt((pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3); }
    tris.push(vtx(a, z), vtx(b, z), vtx(c, z));
  };
  for (const q of sn.quads) { if (len(sub(PV(q[0]), PV(q[2]))) < len(sub(PV(q[1]), PV(q[3])))) { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); } else { tri(q[0], q[1], q[3]); tri(q[1], q[2], q[3]); } }
}
// Ausrichtung prüfen (Normale zeigt nach außen?)
{ const P = i => [sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]]; let vote = 0;
  for (let t = 0; t < tris.length; t += 3 * 97) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; vote += Math.sign(dot(cross(sub(P(b), P(a)), sub(P(c), P(a))), grad(F, ...P(a)))); }
  if (vote < 0) for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; } }
// vereinfachen (Farbgrenzen bleiben als Nähte erhalten)
try {
  const { MeshoptSimplifier: MS } = await import('meshoptimizer');
  await MS.ready;
  const n = sOrig.length, P32 = new Float32Array(sp), A = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) { A[i * 6 + c] = sc[i * 3 + c]; A[i * 6 + 3 + c] = sn3[i * 3 + c]; } }
  const [out, err] = MS.simplifyWithAttributes(new Uint32Array(tris), P32, 3, A, 6, [2, 2, 2, 0.5, 0.5, 0.5], null, TARGET_TRIS * 3, 0.01, ['ErrorAbsolute']);
  console.log(`vereinfacht: ${tris.length / 3} → ${out.length / 3} Dreiecke (Fehler ${(err * 1000).toFixed(2)} mm, ${lap()})`);
  tris = Array.from(out);
} catch (e) { console.log('ohne Vereinfachung (meshoptimizer fehlt):', e.message); }
// unbenutzte Punkte entfernen
let nrm = [], col = [], vOrig = [], vZone = [];
{ const map = new Int32Array(sOrig.length).fill(-1), P = []; let n = 0;
  tris = tris.map(i => { if (map[i] < 0) { map[i] = n++; P.push(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]); nrm.push(sn3[i * 3], sn3[i * 3 + 1], sn3[i * 3 + 2]); col.push(sc[i * 3], sc[i * 3 + 1], sc[i * 3 + 2]); vOrig.push(sOrig[i]); vZone.push(sZone[i]); } return map[i]; });
  pos = P; }
// Normalen leicht glätten (über Farbgrenzen derselben Stoffschicht hinweg): ruhige Schattierung ohne Flecken
{ const n = pos.length / 3, gid = new Int32Array(n), gmap = new Map(); let ng = 0;
  const layerIdx = z => LAYERS.findIndex(([nm]) => nm === ZONES[z].layer);
  for (let i = 0; i < n; i++) { const k = vOrig[i] * 8 + layerIdx(vZone[i]); let g = gmap.get(k); if (g === undefined) { g = ng++; gmap.set(k, g); } gid[i] = g; }
  const nb = Array.from({ length: ng }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = gid[tris[t + e]], b = gid[tris[t + (e + 1) % 3]]; if (a !== b) { nb[a].add(b); nb[b].add(a); } }
  let gn = new Float64Array(ng * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) gn[gid[i] * 3 + c] = nrm[i * 3 + c];
  for (let it = 0; it < 2; it++) {
    const nn = new Float64Array(ng * 3);
    for (let i = 0; i < ng; i++) { let x = gn[i * 3] * 2.5, y = gn[i * 3 + 1] * 2.5, z = gn[i * 3 + 2] * 2.5; for (const j of nb[i]) { x += gn[j * 3]; y += gn[j * 3 + 1]; z += gn[j * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; nn[i * 3] = x / l; nn[i * 3 + 1] = y / l; nn[i * 3 + 2] = z / l; }
    gn = nn;
  }
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) nrm[i * 3 + c] = gn[gid[i] * 3 + c];
}
// Kontur nur dort, wo sie nicht in Falten durchsticht; dazu weiche Schatten in Mulden (in die Farbe gebacken)
const OUTLINE_W = 0.012;
const crownSolid = (() => { const e = ellipsoid(CAPC, CR); return (x, y, z) => HS * e.d(...rotX(uh([x, y, z]), H, -CAP_TILT)); })();
const occ = (x, y, z) => Math.min(F(x, y, z), crownSolid(x, y, z) + 0.002);
const outArr = [], uvArr = [];
for (let i = 0; i < pos.length / 3; i++) {
  const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]], zn = ZONES[vZone[i]];
  outArr.push(smoothstep(0.25, 0.9, occ(...add(p, n, OUTLINE_W)) / OUTLINE_W) * smoothstep(0.1, 0.6, occ(...add(p, n, OUTLINE_W * 0.5)) / (OUTLINE_W * 0.5)));
  let ao = 0; for (const r of [0.01, 0.025, 0.06]) ao += clamp(occ(...add(p, n, r)) / r, 0, 1) / 3;
  ao = smoothstep(0.15, 1, ao);
  const tint = zn.layer === 'skin' ? [0.74, 0.5, 0.46] : zn.layer === 'hair' ? [0.62, 0.48, 0.36] : [0.58, 0.56, 0.68];
  for (let c = 0; c < 3; c++) col[i * 3 + c] *= mix(tint[c], 1, ao);
  uvArr.push(zn.mat[0], zn.mat[1]);
}
const body = { pos, nrm, col, idx: tris, out: 1, outArr, uvArr, bone: null, layers: vZone.map(z => ZONES[z].layer) };
// Kopf-Zusätze auf Kopfgröße bringen
for (const pt of extra) if (pt.u) for (let i = 0; i < pt.pos.length; i += 3) pt.pos.splice(i, 3, ...hs(pt.pos.slice(i, i + 3)));
// Kappe & Co. dürfen nicht im Kopf stecken: Punkte notfalls nach außen schieben
for (const pt of extra) if (pt.push) for (let i = 0; i < pt.pos.length; i += 3) {
  let p = pt.pos.slice(i, i + 3), d = F(...p);
  for (let it = 0; it < 12 && d < 0.003; it++) { p = add(p, norm(grad(F, ...p)), 0.003 - d + 0.0005); d = F(...p); }
  pt.pos.splice(i, 3, ...p);
}

// alles zusammenführen
const parts = [body, ...extra];
const NV = parts.reduce((a, p) => a + p.pos.length / 3, 0), NI = parts.reduce((a, p) => a + p.idx.length, 0);
const POS = new Float32Array(NV * 3), NRM = new Int8Array(NV * 4), COL = new Uint16Array(NV * 4), UV = new Uint8Array(NV * 4), JNT = new Uint8Array(NV * 4), WGT = new Uint8Array(NV * 4);
const IDX = NV > 65535 ? new Uint32Array(NI) : new Uint16Array(NI);
{ let vo = 0, io = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const v = vo + i, q = [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]];
      POS.set(q, v * 3); NRM.set(norm([p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]]).map(c => Math.round(c * 127)), v * 4);
      for (let c = 0; c < 3; c++) COL[v * 4 + c] = Math.round(clamp(p.col[i * 3 + c], 0, 1) * 65535);
      COL[v * 4 + 3] = Math.round((p.outArr ? p.outArr[i] : p.out) * 65535);
      UV[v * 4] = Math.round((p.uvArr ? p.uvArr[i * 2] : p.mat[0]) * 255); UV[v * 4 + 1] = Math.round((p.uvArr ? p.uvArr[i * 2 + 1] : p.mat[1]) * 255);
      const tw = p.bone ? { j: [BONE[p.bone], 0, 0, 0], w: [255, 0, 0, 0] } : top4(weightsAt(q, p.layers ? p.layers[i] : p.layer));
      JNT.set(tw.j, v * 4); WGT.set(tw.w, v * 4);
    }
    // Dreiecke so drehen, dass sie zur Normale zeigen (Vorderseite außen)
    for (let t = 0; t < p.idx.length; t += 3) {
      const [a, b, c] = [p.idx[t], p.idx[t + 1], p.idx[t + 2]], P = i => [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]], Nn = i => [p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]];
      const fnrm = cross(sub(P(b), P(a)), sub(P(c), P(a))), vn = add(add(Nn(a), Nn(b)), Nn(c));
      IDX[io++] = vo + a; if (dot(fnrm, vn) < 0) { IDX[io++] = vo + c; IDX[io++] = vo + b; } else { IDX[io++] = vo + b; IDX[io++] = vo + c; }
    }
    vo += n;
  }
}
console.log(`Modell: ${NV} Punkte, ${NI / 3} Dreiecke`);

/* ---------- glTF-Binärdatei schreiben ---------- */
const rest = boneFrames(REST);
const ibm = new Float32Array(BONES.length * 16);
for (let b = 0; b < BONES.length; b++) { // starre Matrix invertieren: R^T, -R^T t
  const m = rest.subarray(b * 16, b * 16 + 16), o = b * 16;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ibm[o + c * 4 + r] = m[r * 4 + c];
  for (let r = 0; r < 3; r++) ibm[o + 12 + r] = -(m[r * 4] * m[12] + m[r * 4 + 1] * m[13] + m[r * 4 + 2] * m[14]);
  ibm[o + 15] = 1;
}
const chunks = [], views = [], accessors = [];
let off = 0;
function view(arr, target, byteStride) { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(byteStride ? { byteStride } : {}), ...(target ? { target } : {}) }); off += b.length + pad; return views.length - 1; }
function accessor(arr, type, componentType, count, extra = {}) { accessors.push({ bufferView: view(arr, extra.target, extra.byteStride), componentType, count, type, ...extra, target: undefined, byteStride: undefined }); return accessors.length - 1; }
const pmin = [0, 1, 2].map(c => Math.min(...Array.from({ length: NV }, (_, i) => POS[i * 3 + c]))), pmax = [0, 1, 2].map(c => Math.max(...Array.from({ length: NV }, (_, i) => POS[i * 3 + c])));
const aPos = accessor(POS, 'VEC3', 5126, NV, { min: pmin, max: pmax, target: 34962 });
const aNrm = accessor(NRM, 'VEC3', 5120, NV, { normalized: true, byteStride: 4, target: 34962 }); // platzsparend: 1 Byte je Achse (KHR_mesh_quantization)
const aCol = accessor(COL, 'VEC4', 5123, NV, { normalized: true, target: 34962 });
const aUv = accessor(UV, 'VEC2', 5121, NV, { normalized: true, byteStride: 4, target: 34962 });
const aJnt = accessor(JNT, 'VEC4', 5121, NV, { target: 34962 });
const aWgt = accessor(WGT, 'VEC4', 5121, NV, { normalized: true, target: 34962 });
const aIdx = accessor(IDX, 'SCALAR', IDX instanceof Uint32Array ? 5125 : 5123, NI, { target: 34963 });
const aIbm = accessor(ibm, 'MAT4', 5126, BONES.length);
const gltf = {
  asset: { version: '2.0', generator: 'Surfers Surf – 3d/tools/build-surfer.mjs', extras: { note: 'COLOR_0.a = Stärke der Kontur (Toon-Outline), TEXCOORD_0 = Material (x: Haut 1 / Haar 0.5 / Stoff 0, y: Glanz)' } },
  extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0, scenes: [{ name: 'Surfer', nodes: [0] }],
  nodes: [{ name: 'Surfer', children: [1, ...BONES.map((_, i) => i + 2)] }, { name: 'Body', mesh: 0, skin: 0 },
    ...BONES.map((name, i) => ({ name, matrix: Array.from(rest.subarray(i * 16, i * 16 + 16)) }))],
  meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, TEXCOORD_0: aUv, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
  materials: [{ name: 'Toon', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
  skins: [{ name: 'Rig', joints: BONES.map((_, i) => i + 2), inverseBindMatrices: aIbm, skeleton: 0 }],
  accessors, bufferViews: views, buffers: [{ byteLength: off }],
};
for (const a of accessors) delete a.target;
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
mkdirSync(new URL('../models/', import.meta.url), { recursive: true });
writeFileSync(OUT, Buffer.concat([head, jh, json, bh, bin]));
console.log(`geschrieben: ${OUT.pathname} (${((12 + 16 + json.length + bin.length) / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
