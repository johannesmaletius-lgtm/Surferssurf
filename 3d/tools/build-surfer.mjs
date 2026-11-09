// Baut die 3D-Modelle der Surfer: 3d/models/surfer.glb (Kai) und surfer-<id>.glb für alle anderen Figuren
// (glTF 2.0 mit Skelett, ansehen z. B. in 3d/surfer.html?f=lei).
//
// Der Körper ist aus weichen Grundformen modelliert (Abstandsfelder: Ellipsoide, Kegel, Kapseln, weich verschmolzen),
// daraus wird eine geschlossene Oberfläche berechnet („Surface Nets“), genau auf die Formen gezogen und mit
// meshoptimizer vereinfacht. Kleidung (Lycra-Shirt, Boardshorts, Neoprenanzug, Kapuze, Kopftuch) und Haare sind
// eigene Schichten über der Haut, deshalb entstehen echte Säume. Kappe, Augen, Brauen, Mund, Logos, Blüte,
// Taucherbrille, Schnorchel, Flasche und Haizähne sind eigene, scharfe Formen.
// Jeder Punkt bekommt Gewichte für die Knochen aus rig.js – das Spiel bewegt sie per IK.
//
// Die Figuren (Namen und Preise wie im 2D-Spiel) stehen unten in VARIANTS.
//
// Neu bauen (einmalig npm i meshoptimizer im Ordner 3d/tools):
//   node build-surfer.mjs            alle Figuren (je knapp eine Minute)
//   node build-surfer.mjs lei finn   nur diese
//   (STEP=0.006 für feineres Raster, TRIS=… für mehr/weniger Dreiecke)
import { writeFileSync, mkdirSync } from 'node:fs';
import { BONES, BONE, REST, boneFrames } from '../rig.js';

const STEP = +(process.env.STEP || 0.0065);
const TARGET_TRIS = +(process.env.TRIS || 12500);

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

const grow = (b, r) => [b[0] - r, b[1] - r, b[2] - r, b[3] + r, b[4] + r, b[5] + r];
// flach gedrückt in x (für Flossen): Form in x um den Faktor k dünner
const flatX = (f, k) => ({ bb: f.bb, d: (x, y, z) => f.d(x * k, y, z) / k });

/* =========================================================================
   Die Figuren – gleiche Namen, Preise und Kennungen wie im 2D-Spiel (gemeinsamer Spielstand)
   ========================================================================= */
const VARIANTS = {
  kai: {
    file: 'surfer.glb', skin: '#eaa679', blush: '#f0907a', sole: '#f3c4a0', iris: ['#2f86d6', '#1c5ea6'], brow: '#a8711f', mouth: '#7a3531',
    hair: { style: 'short', root: '#c08a2c', mid: '#f0bd4a', tip: '#ffe28e' },
    cap: { crown: '#ffd23f', inner: '#c99a22', brim: '#1f43a0', brimD: '#18357f', logo: '#ff6a3d', logoRing: '#fff7e8' },
    top: { sleeves: 'short', col: '#ff6a3d', trim: '#fff4e6', side: true },
    bottom: { col: '#1f43a0', trim: '#ffd23f', band: '#16307a', hem: 0.84 },
    logo: { type: 'sun', col: '#ffd23f', ring: '#fff7e8' },
  },
  lei: {
    file: 'surfer-lei.glb', skin: '#c1845a', blush: '#e07a64', sole: '#dca07a', iris: ['#7a4a26', '#4f2c14'], brow: '#2e1a0e', browW: 0.8, lash: 1.25, mouth: '#a83c3c',
    hair: { style: 'ponytail', root: '#2a170c', mid: '#4f2e1a', tip: '#7c5032', tie: '#ffd166' },
    flower: { petal: '#ff5d8f', petalD: '#d42a5e', center: '#ffd166' },
    top: { sleeves: 'short', col: '#e2493f', trim: '#ffd166', side: true },
    bottom: { col: '#ffd166', trim: '#e2493f', band: '#c9302a', hem: 0.6 },
    logo: { type: 'flower', col: '#fff7e8', ring: '#ffd166' },
  },
  nalu: {
    file: 'surfer-nalu.glb', skin: '#8c5637', blush: '#a8604a', sole: '#b47a58', iris: ['#5a3418', '#36200e'], brow: '#140b05', mouth: '#4a1e18',
    hair: { style: 'curly', root: '#160b05', mid: '#3a2416', tip: '#77502f' },
    top: { sleeves: 'long', col: '#1f9a75', trim: '#bff5e0', side: true, band: true },
    bottom: { col: '#ff8a3d', trim: '#ffe28a', band: '#c9551a', hem: 0.86 },
  },
  koko: {
    file: 'surfer-koko.glb', skin: '#e3a47c', blush: '#f08a78', sole: '#f0c0a0', iris: ['#4f7fa8', '#345d82'], brow: '#e8e8e8', browW: 1.5, mouth: '#7a3531',
    hair: { style: 'short', root: '#8a8a8a', mid: '#c8c8c8', tip: '#f4f4f4' }, beard: true, belly: true,
    bandana: { col: '#d63a2f', dot: '#fff4e6' },
    suit: { col: '#2a4d8f', trim: '#f4f1ea', panel: '#4c75c0', side: true },
  },
  diver: {
    file: 'surfer-diver.glb', skin: '#eaa679', blush: '#f0907a', sole: '#f3c4a0', iris: ['#2f86d6', '#1c5ea6'], brow: '#5a3a1a', noMouth: true,
    hood: { col: '#1b2a3a', trim: '#ff8a1f', th: 0.013, open: { c: [0, -0.025, -0.13], r: [0.088, 0.108, 0.09] } },
    mask: { frame: '#ff8a1f', skirt: '#141a22', strap: '#141a22', glint: '#ffffff', snorkel: '#1b2a3a', top: '#ff8a1f' },
    suit: { col: '#1b2a3a', trim: '#ff8a1f', panel: '#3c5670', side: true, harness: '#0b0f14' },
    tank: { col: '#ffd23f', band: '#141a22', valve: '#c8d2dc' },
  },
  finn: {
    file: 'surfer-finn.glb', skin: '#ecb48d', blush: '#f29a80', sole: '#f3c4a0', iris: ['#3a9a5a', '#22703c'], brow: '#6a4422', mouth: '#7a3531',
    hood: { col: '#6f8599', light: '#a3b7c8', belly: '#f4f8fb', gum: '#d8475a', th: 0.016, shark: true, open: { c: [0, -0.018, -0.13], r: [0.098, 0.118, 0.092] } },
    teeth: '#ffffff', sharkEyes: true,
    suit: { col: '#6f8599', trim: '#a3b7c8', belly: '#f4f8fb', fins: true },
  },
};

/* =========================================================================
   Das Modell – was bei allen Figuren gleich ist
   ========================================================================= */
const R = REST, H = R.head;
const hp = (p, o) => add(H, o);
const SIDES = [[-1, 'L'], [1, 'R']];

const neck = roundCone([0, 1.55, 0.004], [0, 1.735, -0.012], 0.062, 0.054);

// Kopf
const headNoEyes = U([
  [ellipsoid(hp(H, [0, 0.028, 0.012]), [0.117, 0.128, 0.13]), 0],                        // Schädel
  [ellipsoid(hp(H, [0, -0.035, -0.032]), [0.097, 0.1, 0.1]), 0.05],                     // Gesicht
  [ellipsoid(hp(H, [0, -0.08, -0.04]), [0.078, 0.05, 0.078]), 0.04],                    // Kiefer
  [ellipsoid(hp(H, [0, -0.108, -0.084]), [0.032, 0.026, 0.028]), 0.03],                 // Kinn
  [capsule(hp(H, [-0.058, 0.044, -0.108]), hp(H, [0.058, 0.044, -0.108]), 0.014), 0.03], // Brauenbogen
  [roundCone(hp(H, [0, 0.012, -0.122]), hp(H, [0, -0.03, -0.142]), 0.009, 0.0145), 0.018], // Nase
  ...SIDES.flatMap(([s]) => [
    [ellipsoid(hp(H, [s * 0.056, -0.018, -0.086]), [0.032, 0.024, 0.03]), 0.03],        // Wangenknochen
    [sphere(hp(H, [s * 0.0125, -0.034, -0.132]), 0.0105), 0.01],                         // Nasenflügel
    [oellipsoid(hp(H, [s * 0.116, -0.012, 0.006]), [0, 1, 0.15], [s, 0, -0.35], 0.04, 0.018, 0.029), 0.012], // Ohr
  ]),
]);

// Arme und Hände
const arm = {};
for (const [s, k] of SIDES) {
  const sh = R['sh' + k], el = R['el' + k], hd = R['hd' + k], d = norm(sub(el, sh)), fr = [0, 0, -1];
  const n = norm([-s * 0.643, -0.766, 0]); // Handfläche zeigt zum Körper
  arm[k] = { sh, el, hd, d, n };
  arm[k].skin = U([
    [roundCone(sh, el, 0.061, 0.048), 0],
    [oellipsoid(add(add(sh, d, 0.15), fr, 0.013), d, fr, 0.088, 0.05, 0.05), 0.03],          // Bizeps
    [oellipsoid(add(add(sh, d, 0.13), fr, -0.012), d, fr, 0.09, 0.048, 0.048), 0.03],        // Trizeps
    [roundCone(el, hd, 0.046, 0.034), 0.03],
    [oellipsoid(add(el, d, 0.07), d, fr, 0.08, 0.046, 0.043), 0.03],                          // Unterarm
    [oellipsoid(add(hd, d, 0.048), d, fr, 0.05, 0.04, 0.02), 0.02],                           // Handfläche (u=d, v=vorn, w=Handdicke)
    [oellipsoid(add(add(hd, d, 0.112), n, 0.007), d, fr, 0.045, 0.037, 0.017), 0.016],        // Finger
    [roundCone(add(add(add(hd, d, 0.028), fr, 0.03), n, 0.012), add(add(add(hd, d, 0.083), fr, 0.048), n, 0.022), 0.015, 0.011), 0.01], // Daumen
  ]);
  // Ende eines langen Ärmels kurz vor dem Handgelenk (>0 = abgeschnitten)
  const wc = add(hd, d, -0.012);
  arm[k].cut = (x, y, z) => (x - wc[0]) * d[0] + (y - wc[1]) * d[1] + (z - wc[2]) * d[2];
  arm[k].suit = fn(grow(arm[k].skin.bb, 0.01), (x, y, z) => smax(arm[k].skin.d(x, y, z) - 0.0065, arm[k].cut(x, y, z), 0.006));
}
// Beine und Füße (Sohle bei y = 0)
const leg = {};
for (const [s, k] of SIDES) {
  const h = R['hp' + k], kn = R['kn' + k], ft = R['ft' + k], d = norm(sub(kn, h)), dl = norm(sub(ft, kn)), fr = [0, 0, -1];
  leg[k] = { hp: h, kn, ft, d, dl };
  const foot = U([
    [ellipsoid(add(ft, [0, -0.038, 0.028]), [0.034, 0.036, 0.044]), 0],                     // Ferse
    [ellipsoid(add(ft, [-s * 0.004, -0.042, -0.062]), [0.043, 0.032, 0.108]), 0.03],       // Mittelfuß
    [ellipsoid(add(ft, [-s * 0.006, -0.054, -0.152]), [0.046, 0.02, 0.036]), 0.02],        // Zehen
    [ellipsoid(add(ft, [-s * 0.022, -0.051, -0.172]), [0.016, 0.018, 0.026]), 0.012],      // großer Zeh
  ]);
  const footFlat = fn(foot.bb, (x, y, z) => smax(foot.d(x, y, z), -y, 0.012));
  leg[k].skin = U([
    [roundCone(h, kn, 0.088, 0.06), 0],
    [oellipsoid(add(add(h, d, 0.2), fr, 0.018), d, fr, 0.2, 0.07, 0.07), 0.04],              // Oberschenkel vorn
    [ellipsoid(add(kn, [0, 0.01, -0.042]), [0.032, 0.038, 0.022]), 0.025],                   // Kniescheibe
    [roundCone(kn, ft, 0.055, 0.034), 0.03],
    [oellipsoid(add(add(kn, dl, 0.13), fr, -0.022), dl, fr, 0.13, 0.052, 0.05), 0.04],       // Wade
    [sphere(ft, 0.038), 0.02],
    [footFlat, 0.02],
  ]);
  // Ende eines langen Hosenbeins über dem Knöchel
  const ac = add(ft, dl, -0.035);
  leg[k].cut = (x, y, z) => (x - ac[0]) * dl[0] + (y - ac[1]) * dl[1] + (z - ac[2]) * dl[2];
  leg[k].suit = fn(grow(leg[k].skin.bb, 0.01), (x, y, z) => smax(leg[k].skin.d(x, y, z) - 0.0065, leg[k].cut(x, y, z), 0.006));
}

// Augen: Lage aus der Gesichtsoberfläche
function surfaceAlong(f, from, dir, maxT = 0.3) {
  // vom Inneren nach außen, bis das Feld positiv wird, dann halbieren
  let a = 0, b = 0;
  for (let t = 0; t <= maxT; t += 0.002) { const p = add(from, dir, t); if (f.d(...p) > 0) { b = t; break; } a = t; }
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (f.d(...add(from, dir, m)) > 0) b = m; else a = m; }
  return add(from, dir, (a + b) / 2);
}
const EYE_R = 0.0275;
const eyes = SIDES.map(([s]) => {
  const surf = surfaceAlong(headNoEyes, hp(H, [s * 0.046, 0.01, -0.02]), [0, 0, -1]);
  return { s, c: add(surf, [0, 0, 0.0135]), gaze: norm([s * 0.08, -0.04, -1]) };
});
const sockets = U(eyes.map(e => [sphere(e.c, EYE_R + 0.0035), 0]));
const innerEar = U(SIDES.map(([s]) => [ellipsoid(hp(H, [s * 0.127, -0.01, 0.002]), [0.008, 0.024, 0.016]), 0]));

/* =========================================================================
   Oberfläche: Surface Nets auf einem Raster, dann genau auf die Form gezogen
   ========================================================================= */
function surfaceNets(f, b, S) {
  const x0 = b[0] - 2 * S, y0 = b[1] - 2 * S, z0 = b[2] - 2 * S;
  const nx = Math.ceil((b[3] - x0) / S) + 3, ny = Math.ceil((b[4] - y0) / S) + 3, nz = Math.ceil((b[5] - z0) / S) + 3;
  console.log(`  Raster ${nx}×${ny}×${nz} (${(nx * ny * nz / 1e6).toFixed(1)} Mio. Punkte)`);
  const V = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V[i + nx * (j + ny * k)] = f(x0 + i * S, y0 + j * S, z0 + k * S);
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

/* ---------- Knochen-Gewichte: Abstand zu Knochen-Kapseln, links/rechts und Kopf/Brust getrennt ---------- */
const L = n => R[n];
const segs = {
  pelvis: [L('hpL'), L('hpR'), 0.11], spine: [[0, 1.14, 0], [0, 1.3, 0], 0.125], chest: [[-0.11, 1.42, 0], [0.11, 1.42, 0], 0.15],
  neck: [[0, 1.6, 0], [0, 1.74, -0.012], 0.055], head: [[0, 1.8, -0.02], [0, 1.93, -0.01], 0.1],
};
for (const [s, k] of SIDES) {
  const a = arm[k], g = leg[k];
  segs['up' + k] = [a.sh, a.el, 0.055]; segs['lo' + k] = [a.el, a.hd, 0.04]; segs['hand' + k] = [a.hd, add(a.hd, a.d, 0.15), 0.03];
  segs['thigh' + k] = [g.hp, g.kn, 0.085]; segs['shin' + k] = [g.kn, g.ft, 0.05]; segs['foot' + k] = [add(g.ft, [0, -0.04, 0.03]), add(g.ft, [0, -0.045, -0.17]), 0.03];
}
function segDist(p, a, b) { const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / dot(ab, ab), 0, 1); return len(sub(p, add(a, ab, t))); }
function weightsAt(p) {
  const w = BONES.map(name => {
    const [a, b, r] = segs[name]; let g = 1;
    if (name.endsWith('L') && name !== 'pelvis') g = smoothstep(0.03, -0.03, p[0]);
    if (name.endsWith('R')) g = smoothstep(-0.03, 0.03, p[0]);
    if (name === 'head') g = smoothstep(1.67, 1.75, p[1]);
    if (name === 'chest') g *= smoothstep(1.76, 1.68, p[1]);
    const d = Math.max(segDist(p, a, b) - r, 0.004);
    return g / (d * d * d * d);
  });
  return w;
}
function top4(w) {
  const idx = w.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 4);
  const sum = idx.reduce((a, [v]) => a + v, 0);
  let q = idx.map(([v]) => Math.round(v / sum * 255)); q[0] += 255 - q.reduce((a, b) => a + b, 0);
  return { j: idx.map(([, i]) => i), w: q };
}

/* ---------- Zusätze mit scharfen Kanten ---------- */
let extra = []; // {pos, nrm, col, out(Outline-Faktor), bone ('head' oder null = Gewichte berechnen), idx}
function part(bone = 'head', out = 1) { const p = { pos: [], nrm: [], col: [], idx: [], out, bone }; extra.push(p); return p; }
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
// Röhre entlang einer Linie, Radius r(t); Farbe fest oder als Funktion von t
function tube(pt, pts, rf, col, seg = 8) {
  const N = pts.length;
  const frames = pts.map((p, i) => { const t = norm(sub(pts[Math.min(N - 1, i + 1)], pts[Math.max(0, i - 1)])); const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const a = norm(cross(t, up)); return [a, cross(a, t)]; });
  grid(pt, seg, N - 1, (u, v) => { const i = Math.round(v * (N - 1)), [a, b] = frames[i], ang = u * Math.PI * 2, n = add(mul(a, Math.cos(ang)), b, Math.sin(ang)), r = rf(i / (N - 1)); return [add(pts[i], n, r), n, typeof col === 'function' ? col(i / (N - 1)) : col]; }, true);
}
// Kugel bzw. Ellipsoid als Gitter
function ball(pt, c, r, col, nu = 16, nv = 10) {
  const rr = Array.isArray(r) ? r : [r, r, r];
  grid(pt, nu, nv, (u, v) => { const th = v * Math.PI, ph = u * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; return [add(c, [n[0] * rr[0], n[1] * rr[1], n[2] * rr[2]]), norm([n[0] / rr[0], n[1] / rr[1], n[2] / rr[2]]), col]; }, true);
}
// dünnes, zweiseitiges Blatt (Blütenblätter): Fläche P(u, v), Normale aus den Ableitungen
function sheet(pt, nu, nv, P, col, th = 0.0012) {
  const nAt = (u, v) => { const e = 0.003, du = sub(P(Math.min(1, u + e), v), P(Math.max(0, u - e), v)), dv = sub(P(u, Math.min(1, v + e)), P(u, Math.max(0, v - e))); return norm(cross(du, dv)); };
  for (const sg of [1, -1]) grid(pt, nu, nv, (u, v) => { const n = mul(nAt(u, v), sg); return [add(P(u, v), n, th), n, col(u, v)]; });
}
// Drehkörper um eine senkrechte Achse durch c: Profil [[radius, höhe], …] von unten nach oben
function lathe(pt, c, prof, col, seg = 20) {
  const N = prof.length;
  grid(pt, seg, N - 1, (u, v) => {
    const i = Math.round(v * (N - 1)), [r, h] = prof[i], a = prof[Math.max(0, i - 1)], b = prof[Math.min(N - 1, i + 1)];
    const dr = b[0] - a[0], dh = b[1] - a[1], l = Math.hypot(dr, dh) || 1, ang = u * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
    return [add(c, [cs * r, h, sn * r]), [cs * dh / l, -dr / l, sn * dh / l], col(h, i)];
  }, true);
}
// weiche Kurve durch Stützpunkte (Catmull-Rom)
function spline(P, per = 6) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))); }
  }
  out.push(P[P.length - 1]);
  return out;
}
const bezier = (a, b, c, t) => lerp3(lerp3(a, b, t), lerp3(b, c, t), t);
// gleichmäßig verteilte Richtungen auf der Kugel
const fib = n => Array.from({ length: n }, (_, i) => { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963; return [Math.cos(a) * r, y, Math.sin(a) * r]; });

/* =========================================================================
   Eine Figur bauen
   ========================================================================= */
function build(id, V) {
  const t0 = Date.now();
  console.log(`${id}:`);
  extra = [];

  // Rumpf (Haut): Brustkorb, Brust, Rücken, Schultern, Bauch, Becken, Po
  const torsoItems = [
    [ellipsoid([0, 1.37, 0.005], [0.158, 0.2, 0.112]), 0],
    [ellipsoid([0, 1.45, 0.015], [0.186, 0.11, 0.106]), 0.06],
    [ellipsoid([0, 1.22, -0.004], [0.134, 0.15, 0.099]), 0.07],
    [ellipsoid([0, 1.045, 0.0], [0.15, 0.13, 0.106]), 0.07],
  ];
  for (const [s] of SIDES) {
    torsoItems.push(
      [ellipsoid([s * 0.071, 1.44, -0.052], [0.088, 0.068, 0.058]), 0.04],           // Brust
      [ellipsoid([s * 0.084, 1.43, 0.084], [0.07, 0.088, 0.034]), 0.04],             // Schulterblatt
      [roundCone([0, 1.585, 0.018], [s * 0.2, 1.528, 0.01], 0.068, 0.054), 0.05],    // Nacken-Schulter
      [ellipsoid([s * 0.222, 1.503, 0.0], [0.079, 0.09, 0.082]), 0.05],              // Schulterkappe
      [ellipsoid([s * 0.068, 0.985, 0.036], [0.084, 0.094, 0.074]), 0.05],           // Po
      [ellipsoid([s * 0.108, 1.11, -0.01], [0.05, 0.08, 0.075]), 0.06],              // Flanke/Hüfte
    );
  }
  if (V.belly) torsoItems.push([ellipsoid([0, 1.17, -0.04], [0.14, 0.13, 0.105]), 0.08]); // Käpt'n-Bauch
  const torso = U(torsoItems);

  // Haut gesamt (ohne Augenhöhlen)
  const skinNoEyes = U([[torso, 0], [neck, 0.045], [headNoEyes, 0.035],
    [arm.L.skin, 0.035], [arm.R.skin, 0.035], [leg.L.skin, 0.05], [leg.R.skin, 0.05]]);
  const skin = fn(skinNoEyes.bb, (x, y, z) => smax(smax(skinNoEyes.d(x, y, z), -sockets.d(x, y, z), 0.01), -innerEar.d(x, y, z), 0.006));
  const LAYERS = [['skin', skin]];

  // Shirt: Rumpf etwas aufgeblasen (unten weiter, fällt über die Shorts), kurze Ärmel mit Saum oder lange bis zum Handgelenk
  const SHIRT_HEM = 1.085;
  let shirt = null;
  if (V.top) {
    const sleeves = V.top.sleeves === 'long' ? U([[arm.L.suit, 0], [arm.R.suit, 0]])
      : U(SIDES.map(([s, k]) => [cappedCone(add(arm[k].sh, arm[k].d, -0.04), add(arm[k].sh, arm[k].d, 0.155), 0.082, 0.07, 0.006), 0]));
    shirt = fn(torso.bb, (x, y, z) => {
      if (y < SHIRT_HEM - 0.03) return BIG;
      const inflate = 0.0055 + 0.0115 * smoothstep(1.2, 1.1, y);
      let d = smin(torso.d(x, y, z) - inflate, sleeves.d(x, y, z), 0.03);
      return smax(d, SHIRT_HEM - y, 0.008);
    });
    LAYERS.push(['shirt', shirt]);
  }
  // Boardshorts: Becken aufgeblasen bis zum Bund, weite Hosenbeine bis knapp übers Knie (Länge je Figur)
  const SHORTS_TOP = 1.135, HEM_T = V.bottom ? V.bottom.hem : 0.84;
  if (V.bottom) {
    const legTubes = U(SIDES.map(([s, k]) => [cappedCone(add(leg[k].hp, [0, 0.06, 0]), add(leg[k].hp, leg[k].d, 0.46 * HEM_T), 0.113, 0.101, 0.007), 0]));
    const shorts = fn(torso.bb, (x, y, z) => {
      if (y > SHORTS_TOP + 0.03 || y < 0.45) return BIG;
      const d = smin(torso.d(x, y, z) - 0.013, legTubes.d(x, y, z), 0.05);
      return smax(d, y - SHORTS_TOP, 0.008);
    });
    LAYERS.push(['shorts', shorts]);
  }
  // Neoprenanzug: Rumpf, Arme bis zum Handgelenk, Beine bis über den Knöchel, Kragen am Hals
  const COLLAR = 1.63;
  let fins = null;
  if (V.suit) {
    const items = [
      [fn(grow(torso.bb, 0.01), (x, y, z) => torso.d(x, y, z) - 0.007), 0],
      [fn(grow(neck.bb, 0.01), (x, y, z) => smax(neck.d(x, y, z) - 0.007, y - COLLAR, 0.006)), 0.02],
      [arm.L.suit, 0.03], [arm.R.suit, 0.03], [leg.L.suit, 0.045], [leg.R.suit, 0.045],
    ];
    if (V.suit.fins) {
      // Hai-Kostüm: Rückenflosse und Schwanz mit Schwanzflosse
      fins = U([
        [flatX(roundCone([0, 1.47, 0.08], [0, 1.6, 0.29], 0.075, 0.012), 4), 0],
        [flatX(roundCone([0, 1.29, 0.09], [0, 1.6, 0.29], 0.05, 0.012), 4), 0.03],
        [flatX(roundCone([0, 1.0, 0.09], [0, 0.86, 0.3], 0.075, 0.032), 1.5), 0],
        [flatX(roundCone([0, 0.86, 0.3], [0, 1.02, 0.45], 0.036, 0.008), 3.5), 0.025],
        [flatX(roundCone([0, 0.86, 0.3], [0, 0.73, 0.42], 0.03, 0.008), 3.5), 0.025],
      ]);
      items.push([fins, 0.03]);
    }
    LAYERS.push(['suit', U(items)]);
  }

  // Haare
  let hair = null;
  const faceCut = ellipsoid(hp(H, [0, -0.03, -0.115]), [0.098, 0.125, 0.11]); // Gesicht frei (Haaransatz)
  const PONY = [[0, 0.05, 0.13], [0, 0.0, 0.19], [0, -0.09, 0.215], [0, -0.18, 0.2]].map(o => hp(H, o));
  if (V.hair && V.hair.style === 'short') {
    // kurz, unter Kappe/Kopftuch; Nacken, Schläfen und ein paar Strähnen, die frech herausstehen
    const hairItems = [];
    for (let i = 0; i < 9; i++) {
      const a = (-1 + i / 4) * 1.6, ca = Math.cos(a), sa = Math.sin(a), lift = 0.008 * Math.cos(i * 2.1), y0 = -0.035 + 0.01 * Math.sin(i * 1.7);
      hairItems.push([roundCone(hp(H, [sa * 0.11, y0, ca * 0.118 + 0.016]), hp(H, [sa * 0.15, y0 - 0.04 + lift, ca * 0.158 + 0.03]), 0.022, 0.004), 0.01]);
    }
    for (const [s] of SIDES) {
      hairItems.push([roundCone(hp(H, [s * 0.105, 0.02, -0.04]), hp(H, [s * 0.123, -0.048, -0.064]), 0.024, 0.004), 0.01]);     // Koteletten
      hairItems.push([roundCone(hp(H, [s * 0.11, 0.025, -0.0]), hp(H, [s * 0.138, -0.03, 0.01]), 0.026, 0.004), 0.01]);
    }
    if (V.beard) {
      // Seebär: Vollbart rund ums Kinn (Mund bleibt frei) und ein buschiger Schnurrbart
      const mouthFree = ellipsoid(hp(H, [0, -0.07, -0.13]), [0.034, 0.017, 0.05]);
      const beard = fn(bbox([H], 0.2), (x, y, z) => {
        let d = headNoEyes.d(x, y, z) - 0.013;
        d = smax(d, (y - H[1]) - (-0.086 + 0.06 * smoothstep(0.035, 0.1, Math.abs(x))), 0.01);  // oben: unter dem Mund, zu den Ohren hin höher
        d = smax(d, (z - H[2]) - 0.035, 0.015);                                                   // nur vorn
        d = smax(d, -(y - H[1]) - 0.175, 0.02);                                                   // unten
        return smax(d, -mouthFree.d(x, y, z), 0.01);
      });
      hairItems.push([beard, 0.006]);
      for (const [s] of SIDES) hairItems.push([roundCone(hp(H, [s * 0.004, -0.051, -0.146]), hp(H, [s * 0.05, -0.072, -0.118]), 0.0145, 0.008), 0.012]);
    }
    const hairShell = ellipsoid(hp(H, [0, 0.005, 0.018]), [0.124, 0.135, 0.13]);
    const hairU = U(hairItems);
    hair = fn(bbox([H], 0.2), (x, y, z) => {
      if (Math.abs(x - H[0]) > 0.2 || Math.abs(y - H[1]) > 0.2 || Math.abs(z - H[2]) > 0.22) return BIG;
      let sh = hairShell.d(x, y, z);
      sh = smax(sh, (y - H[1]) - 0.07, 0.01);            // oben: Kappe
      sh = smax(sh, (H[1] - 0.085) - y + Math.max(0, -(z - H[2])) * 0.4, 0.012); // unten: Nackenlinie
      sh = smax(sh, (H[2] - 0.035) - z + Math.max(0, (y - H[1]) * -0.3), 0.012); // vorn: Gesicht frei
      return smin(sh, hairU.d(x, y, z), 0.014);
    });
  } else if (V.hair && V.hair.style === 'ponytail') {
    // lang, straff nach hinten gekämmt, Pferdeschwanz
    const shell = ellipsoid(hp(H, [0, 0.024, 0.016]), [0.127, 0.14, 0.137]);
    const tail = U([[roundCone(PONY[0], PONY[1], 0.034, 0.042), 0], [roundCone(PONY[1], PONY[2], 0.042, 0.036), 0.02], [roundCone(PONY[2], PONY[3], 0.036, 0.01), 0.02]]);
    hair = fn(bbox([H], 0.3), (x, y, z) => {
      if (Math.abs(x - H[0]) > 0.2 || y < H[1] - 0.25 || y > H[1] + 0.2 || Math.abs(z - H[2]) > 0.3) return BIG;
      let sh = shell.d(x, y, z);
      sh = smax(sh, -faceCut.d(x, y, z), 0.016);
      sh = smax(sh, (H[1] - 0.075) - y + Math.max(0, -(z - H[2])) * 0.3, 0.012);
      return smin(sh, tail.d(x, y, z), 0.025);
    });
  } else if (V.hair && V.hair.style === 'curly') {
    // Lockenkopf: viele kleine Kugeln auf der Haarschale
    const c0 = hp(H, [0, 0.03, 0.016]), rr = [0.122, 0.135, 0.133];
    const shell = ellipsoid(c0, rr), curls = [];
    for (const u of fib(120)) {
      const p = add(c0, [u[0] * rr[0], u[1] * rr[1], u[2] * rr[2]]);
      if (faceCut.d(...p) < 0.012 || p[1] < H[1] - 0.06 + Math.max(0, -(p[2] - H[2])) * 0.3) continue;
      curls.push([sphere(add(p, u, 0.004), 0.029 + 0.006 * Math.sin(p[0] * 91 + p[2] * 57)), 0.012]);
    }
    const cu = U(curls);
    hair = fn(bbox([H], 0.25), (x, y, z) => {
      if (Math.abs(x - H[0]) > 0.22 || Math.abs(y - H[1]) > 0.22 || Math.abs(z - H[2]) > 0.24) return BIG;
      let sh = shell.d(x, y, z);
      sh = smax(sh, -faceCut.d(x, y, z), 0.014);
      sh = smax(sh, (H[1] - 0.075) - y + Math.max(0, -(z - H[2])) * 0.3, 0.012);
      return smin(sh, smax(cu.d(x, y, z), -faceCut.d(x, y, z) + 0.004, 0.01), 0.012);
    });
  }
  if (hair) LAYERS.push(['hair', hair]);

  // Kopftuch (Käpt'n Koko): über dem Schädel, hinten geknotet, zwei Zipfel
  if (V.bandana) {
    const shell = fn(headNoEyes.bb, (x, y, z) => headNoEyes.d(x, y, z) - 0.014);
    const knot = U([
      [ellipsoid(hp(H, [0, 0.03, 0.152]), [0.032, 0.026, 0.024]), 0],
      [oellipsoid(hp(H, [0.024, -0.035, 0.172]), [0.3, -1, 0.15], [1, 0, 0], 0.058, 0.024, 0.008), 0.012],
      [oellipsoid(hp(H, [-0.018, -0.025, 0.178]), [-0.25, -1, 0.25], [1, 0, 0], 0.05, 0.021, 0.008), 0.012],
    ]);
    LAYERS.push(['bandana', fn(bbox([H], 0.25), (x, y, z) => {
      if (Math.abs(x - H[0]) > 0.2 || Math.abs(y - H[1]) > 0.2 || Math.abs(z - H[2]) > 0.24) return BIG;
      const d = smax(shell.d(x, y, z), (H[1] + 0.065 - 0.3 * (z - H[2])) - y, 0.008);
      return smin(d, knot.d(x, y, z), 0.012);
    })]);
  }
  // Kapuze (Taucher: Neopren, Hai: Kostüm mit Schnauze und Flosse), Gesicht bleibt frei
  let hoodF = null;
  const open = V.hood ? ellipsoid(hp(H, V.hood.open.c), V.hood.open.r) : null;
  if (V.hood) {
    const base = U([[headNoEyes, 0], [neck, 0.04]]), th = V.hood.th;
    const snout = V.hood.shark ? ellipsoid(hp(H, [0, 0.07, -0.08]), [0.122, 0.09, 0.12]) : null;
    const fin = V.hood.shark ? U([
      [flatX(roundCone(hp(H, [0, 0.11, -0.03]), hp(H, [0, 0.27, 0.1]), 0.06, 0.009), 4), 0],
      [flatX(roundCone(hp(H, [0, 0.12, 0.08]), hp(H, [0, 0.27, 0.1]), 0.045, 0.009), 4), 0.02],
    ]) : null;
    hoodF = fn(bbox([H], 0.3), (x, y, z) => {
      if (y < 1.5 || y > H[1] + 0.32 || Math.abs(x) > 0.25 || Math.abs(z - H[2]) > 0.3) return BIG;
      let d = base.d(x, y, z) - th;
      if (snout) d = smin(d, snout.d(x, y, z), 0.05);
      d = smax(d, -open.d(x, y, z), 0.008);
      d = smax(d, 1.585 - y, 0.01);
      if (fin) d = smin(d, fin.d(x, y, z), 0.02);
      return d;
    });
    LAYERS.push(['hood', hoodF]);
  }

  const LF = LAYERS.map(([, l]) => l);
  const F = LF.length === 4 ? (x, y, z) => Math.min(LF[0].d(x, y, z), LF[1].d(x, y, z), LF[2].d(x, y, z), LF[3].d(x, y, z))
    : (x, y, z) => { let d = BIG; for (const l of LF) d = Math.min(d, l.d(x, y, z)); return d; };
  const FF = { bb: skin.bb, d: F };
  function layerAt(x, y, z) {
    let best = 0, bd = Infinity;
    LAYERS.forEach(([, l], i) => { const d = l.d(x, y, z) - (i ? 0.0004 : 0); if (d < bd) { bd = d; best = i; } }); // Stoff liegt bei Gleichstand oben
    return LAYERS[best][0];
  }

  /* ---------- Farben ---------- */
  const S = hex => srgb(hex);
  const C = { skin: S(V.skin), blush: S(V.blush), sole: S(V.sole) };
  if (V.hair) Object.assign(C, { hairRoot: S(V.hair.root), hair: S(V.hair.mid), hairTip: S(V.hair.tip) });
  if (V.top) Object.assign(C, { shirt: S(V.top.col), shirtL: S(V.top.trim) });
  if (V.bottom) Object.assign(C, { shorts: S(V.bottom.col), shortsL: S(V.bottom.trim), band: S(V.bottom.band) });
  const torsoSide = (x, y, z) => { const th = Math.abs(Math.atan2(x, -(z - 0.005))); return th > 1.36 && th < 1.86 && y < 1.43 + 0.05 * Math.cos((th - 1.6) * 3); };
  const dots = V.bandana ? fib(140) : null;
  function colorAt(p, n, layer) {
    const [x, y, z] = p;
    if (layer === 'skin') {
      let c = C.skin;
      for (const [s] of SIDES) { const dc = len(sub(p, hp(H, [s * 0.062, -0.04, -0.098]))); c = mixc(c, C.blush, (1 - smoothstep(0.008, 0.032, dc)) * 0.3); }
      if (y < 0.012) c = C.sole;
      return c;
    }
    if (layer === 'shirt') {
      if (V.top.sleeves === 'long') { for (const [, k] of SIDES) { const a = arm[k]; if (segDist(p, a.el, add(a.hd, a.d, 0.03)) < 0.08 && a.cut(x, y, z) > -0.026) return C.shirtL; } }
      else for (const [s, k] of SIDES) { // Ärmelbündchen
        const a = arm[k], t = dot(sub(p, a.sh), a.d);
        if (s * x > 0.2 && t > 0.118 && t < 0.165) return C.shirtL;
      }
      if (y < SHIRT_HEM + 0.022) return C.shirtL;                         // Saum
      if (neck.d(x, y, z) < 0.016 && y > 1.5) return C.shirtL;           // Kragen
      if (V.top.band && y > 1.35 && y < 1.4 && Math.abs(x) < 0.21) return C.shirtL; // Brust-/Rückenstreifen
      return V.top.side && torsoSide(x, y, z) && (V.top.sleeves !== 'long' || Math.abs(x) < 0.19) ? C.shirtL : C.shirt;       // Seitenstreifen
    }
    if (layer === 'shorts') {
      if (y > SHORTS_TOP - 0.022) return C.band;
      for (const [s, k] of SIDES) { const g = leg[k], t = dot(sub(p, g.hp), g.d) / 0.46; if (s * x > 0.0 && t > HEM_T - 0.07 && t < HEM_T - 0.035) return C.shortsL; }
      if (Math.abs(n[0]) > 0.965 && Math.abs(x) > 0.08) return C.shortsL;
      return C.shorts;
    }
    if (layer === 'suit') {
      const U2 = V.suit, col = S(U2.col), trim = S(U2.trim);
      if (fins && fins.d(x, y, z) < 0.004) return mixc(col, S('#ffffff'), 0.08);
      for (const [, k] of SIDES) {
        const a = arm[k], g = leg[k];
        if (segDist(p, a.el, add(a.hd, a.d, 0.03)) < 0.08 && a.cut(x, y, z) > -0.026) return trim;    // Ärmelbündchen
        if (segDist(p, g.kn, g.ft) < 0.09 && g.cut(x, y, z) > -0.03) return trim;                     // Beinabschluss
      }
      if (y > COLLAR - 0.022 && neck.d(x, y, z) < 0.03) return trim;                                  // Kragen
      if (U2.belly && n[2] < -0.3 && (x / 0.15) ** 2 + ((y - 1.24) / 0.28) ** 2 < 1) return S(U2.belly);  // heller Bauch
      const onTorso = Math.abs(x) < 0.2 && y > 0.95 && y < 1.64;
      if (U2.harness && onTorso && y > 1.12) {
        if ((Math.abs(Math.abs(x) - 0.09) < 0.017 && y > 1.15) || y < 1.152) return S(U2.harness);  // Gurte der Flasche
      }
      if (U2.side && onTorso && y > 1.02 && torsoSide(x, y, z)) return trim;                          // Seitenstreifen
      if (U2.side && y < 1.0 && Math.abs(n[0]) > 0.94 && Math.abs(x) > 0.08) return trim;            // Streifen außen am Bein
      if (U2.panel && onTorso && y > 1.38) return S(U2.panel);                                        // Schulterpartie
      return col;
    }
    if (layer === 'bandana') {
      const u = norm(sub(p, hp(H, [0, 0.012, 0.016])));
      let best = -2; for (const q of dots) best = Math.max(best, dot(u, q));
      return best > 0.9965 ? S(V.bandana.dot) : S(V.bandana.col);
    }
    if (layer === 'hood') {
      const Hd = V.hood, col = S(Hd.col);
      if (Hd.gum && open.d(x, y, z) < 0.012) return S(Hd.gum);                                       // Haimaul-Rand
      if (Hd.trim && open.d(x, y, z) < 0.009) return S(Hd.trim);
      if (Hd.belly && n[1] < -0.35 && z < H[2] + 0.02 && y < H[1] - 0.06) return S(Hd.belly);       // helle Kehle
      if (Hd.shark) {                                                                                   // Kiemen
        const zz = z - H[2] - 0.0, k = (zz + 0.05) / 0.028;
        if (Math.abs(x) > 0.06 && y > 1.63 && y < 1.725 && zz > -0.05 && zz < 0.034 && k - Math.floor(k) < 0.28) return S('#3e4f60');
        if (y > H[1] + 0.1) return mixc(col, S('#4d6173'), 0.6);                                     // dunkler Rücken
      }
      return col;
    }
    // Haare
    if (V.hair.style === 'ponytail') {
      const strand = 0.5 + 0.5 * Math.sin(x * 160 + Math.sin(y * 40) * 2);
      const r = len(sub(p, hp(H, [0, 0.0, 0.015])));
      const base = z > H[2] + 0.17 ? mixc(C.hair, C.hairTip, smoothstep(0.17, 0.24, z - H[2]) * 0.6) : mixc(C.hairRoot, C.hair, smoothstep(0.11, 0.15, r));
      return mixc(base, C.hairTip, strand * 0.22);
    }
    if (V.hair.style === 'curly') {
      const r = len(sub(p, hp(H, [0, 0.03, 0.016])));
      return r < 0.14 ? mixc(C.hairRoot, C.hair, smoothstep(0.125, 0.14, r)) : mixc(C.hair, C.hairTip, smoothstep(0.145, 0.165, r));
    }
    const r = len(sub(p, hp(H, [0, 0.0, 0.015])));
    return r < 0.13 ? mixc(C.hairRoot, C.hair, smoothstep(0.112, 0.13, r)) : mixc(C.hair, C.hairTip, smoothstep(0.135, 0.165, r));
  }
  // Welche Punkte fest an einem Knochen hängen (statt Gewichte zu mischen)
  function lockAt(p, layer) {
    const [, y, z] = p;
    if (layer === 'hair' && V.hair.style === 'ponytail' && z > H[2] + 0.11) return 'head';
    if (layer === 'bandana') return 'head';
    if (layer === 'hood' && V.hood.shark && y > H[1] + 0.09) return 'head';
    if (layer === 'suit' && fins && z > 0.13) return y < 1.15 ? 'pelvis' : y > 1.22 ? 'chest' : null;
    return null;
  }

  /* ---------- Zusätze mit scharfen Kanten ---------- */
  const projectFace = (x, y, off = 0.0018) => { const p = surfaceAlong(skin, [x, y, H[2] - 0.02], [0, 0, -1]); const n = norm(grad(skin.d, ...p)); return add(p, n, off); };

  // Kappe: Krone aus sechs Bahnen mit Nähten, Knopf, Schweißband, Schirm, Logo
  const CAP_TILT = 0.1, CAPC = hp(H, [0, 0.062, 0.012]), CR = [0.126, 0.11, 0.142];
  const capT = p => rotX(p, H, CAP_TILT), capN = n => rotXv(n, CAP_TILT);
  const crownPt = (th, ph, k = 1) => [CAPC[0] + CR[0] * k * Math.sin(th) * Math.sin(ph), CAPC[1] + CR[1] * k * Math.cos(th), CAPC[2] - CR[2] * k * Math.sin(th) * Math.cos(ph)];
  const crownN = (th, ph) => norm([Math.sin(th) * Math.sin(ph) / CR[0], Math.cos(th) / CR[1], -Math.sin(th) * Math.cos(ph) / CR[2]]);
  const TH_RIM = Math.PI / 2 + 0.13;
  const cWhite = srgb('#fff7e8');
  if (V.cap) {
    const cYel = S(V.cap.crown), cBlue = S(V.cap.brim), cBlueD = S(V.cap.brimD), cOr = S(V.cap.logo), cRing = S(V.cap.logoRing);
    const cap = part('head', 1);
    grid(cap, 48, 12, (u, v) => { const th = v * TH_RIM, ph = u * Math.PI * 2; return [capT(crownPt(th, ph)), capN(crownN(th, ph)), cYel]; }, true);
    const inner = part('head', 0);
    grid(inner, 48, 6, (u, v) => { const th = Math.PI / 2 - 0.25 + v * (TH_RIM - Math.PI / 2 + 0.25), ph = u * Math.PI * 2; return [capT(crownPt(th, ph, 0.985)), mul(capN(crownN(th, ph)), -1), S(V.cap.inner)]; }, true, true);
    const band = part('head', 0.4);
    grid(band, 48, 1, (u, v) => { const th = TH_RIM - 0.2 + v * 0.2, ph = u * Math.PI * 2; return [capT(crownPt(th, ph, 1.012)), capN(crownN(th, ph)), cBlue]; }, true);
    const seams = part('head', 0);
    for (let i = 0; i < 6; i++) { const ph = i / 6 * Math.PI * 2 + Math.PI / 6, pts = []; for (let t = 0; t <= 14; t++) pts.push(capT(crownPt(0.02 + t / 14 * (TH_RIM - 0.2), ph, 1.008))); tube(seams, pts, () => 0.0027, cBlue, 4); }
    const btn = part('head', 0.5);
    grid(btn, 16, 6, (u, v) => { const th = v * Math.PI * 0.5, ph = u * Math.PI * 2, c = add(crownPt(0, 0), [0, 0.002, 0]); return [capT(add(c, [Math.sin(th) * Math.sin(ph) * 0.019, Math.cos(th) * 0.011, Math.sin(th) * Math.cos(ph) * 0.019])), capN([Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)]), cBlue]; }, true);
    // Schirm: von der Kronenkante nach vorn, an den Seiten leicht nach unten gebogen
    const brim = part('head', 0.55), PH = 1.42, NU = 36, NV = 6, TH2 = 0.0065;
    const brimPt = (u, v) => {
      const ph = (u * 2 - 1) * PH, reach = 0.098 * Math.pow(Math.cos(ph * 0.92), 0.8);
      const inner = crownPt(TH_RIM - 0.04, ph, 0.995), outR = [Math.sin(ph) * (CR[0] + 0.022), 0, -Math.cos(ph) * (CR[2] + reach)];
      const p = [mix(inner[0], CAPC[0] + outR[0], v), mix(inner[1], CAPC[1] - 0.012, v) - (0.026 * Math.sin(ph) ** 2 + 0.006) * v * v, mix(inner[2], CAPC[2] + outR[2], v)];
      return p;
    };
    const brimNormal = (u, v) => { const e = 0.01, a = sub(brimPt(Math.min(1, u + e), v), brimPt(Math.max(0, u - e), v)), b = sub(brimPt(u, Math.min(1, v + e)), brimPt(u, Math.max(0, v - e))); const n = norm(cross(b, a)); return n[1] < 0 ? mul(n, -1) : n; };
    grid(brim, NU, NV, (u, v) => { const n = brimNormal(u, v); return [capT(add(brimPt(u, v), n, TH2)), capN(n), cBlue]; }, false, true);
    grid(brim, NU, NV, (u, v) => { const n = brimNormal(u, v); return [capT(add(brimPt(u, v), n, -TH2)), capN(mul(n, -1)), cBlueD]; }, false, false);
    grid(brim, NU, 1, (u, v) => { const n = brimNormal(u, 1), p = brimPt(u, 1), o = norm(sub(brimPt(u, 1), brimPt(u, 0.85))); return [capT(add(p, n, (v * 2 - 1) * TH2)), capN(o), cBlueD]; }, false, true);
    // Logo vorn: oranger Kreis mit hellem Ring und Welle
    const logo = part('head', 0), lc = [0.0, 0.0], LTH = 0.98;
    const onCrown = (dx, dy, lift) => { const th = LTH - dy / CR[1], ph = dx / CR[0] / Math.sin(LTH); return [capT(crownPt(th, ph, 1 + lift)), capN(crownN(th, ph))]; };
    const disc = (r0, r1, col, lift) => grid(logo, 32, 1, (u, v) => { const a = u * Math.PI * 2, r = mix(r0, r1, v), [p, n] = onCrown(lc[0] + Math.cos(a) * r, lc[1] + Math.sin(a) * r, lift); return [p, n, col]; }, true, true);
    disc(0, 0.034, cRing, 0.012); disc(0, 0.027, cOr, 0.018);
    const wave = []; for (let i = 0; i <= 16; i++) { const t = i / 16; wave.push(onCrown(-0.019 + t * 0.038, -0.004 + Math.sin(t * Math.PI * 2) * 0.006, 0.026)[0]); }
    tube(logo, wave, () => 0.0028, cRing, 6);
  }
  // Augen: Augapfel mit Iris und Pupille (Ringe genau an den Farbgrenzen), Glanzpunkt, Oberlid, Wimpernlinie
  {
    const cEye = srgb('#ffffff'), cIris = S(V.iris[0]), cIrisD = S(V.iris[1]), cPupil = srgb('#11161f'), cLash = srgb('#1c1720'), cLid = C.skin, LW = V.lash || 1;
    for (const e of eyes) {
      const ball = part('head', 0), g = e.gaze, ax = norm(cross(g, [0, 1, 0])), ay = cross(ax, g);
      const rings = [0, 0.12, 0.25, 0.25, 0.38, 0.5, 0.56, 0.56, 0.75, 1.0, 1.3, 1.6, 1.9, 2.2, 2.5, 2.8, Math.PI];
      const colAt = (th, j) => j <= 2 ? cPupil : j <= 6 ? (th > 0.48 ? cIrisD : cIris) : cEye;
      const base = ball.pos.length / 3, NA = 24;
      rings.forEach((th, j) => { for (let i = 0; i < NA; i++) { const a = i / NA * Math.PI * 2, n = add(add(mul(g, Math.cos(th)), ax, Math.sin(th) * Math.cos(a)), ay, Math.sin(th) * Math.sin(a)); vert(ball, add(e.c, n, EYE_R), n, colAt(th, j)); } });
      for (let j = 0; j < rings.length - 1; j++) { if (rings[j] === rings[j + 1]) continue; for (let i = 0; i < NA; i++) { const i1 = (i + 1) % NA, a = base + j * NA + i, b = base + j * NA + i1, c = base + (j + 1) * NA + i, d = base + (j + 1) * NA + i1; ball.idx.push(a, c, b, b, c, d); } }
      // Glanzpunkt oben, zur Sonne hin
      const hlDir = norm(add(add(g, ay, 0.55), ax, -0.35 * e.s)), hlC = add(e.c, hlDir, EYE_R + 0.001);
      grid(ball, 10, 6, (u, v) => { const th = v * Math.PI, ph = u * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; return [add(hlC, n, 0.0052), n, cEye]; }, true);
      // Oberlid als Schale über dem oberen Teil des Auges, an der Kante eine dunkle Wimpernlinie
      const lid = part('head', 0), lAx = norm(add(mul([0, 1, 0], 1), g, 0.32)), lX = norm(cross(lAx, g)), lY = cross(lX, lAx), LID = 1.02, LR = EYE_R * 1.07;
      grid(lid, 28, 6, (u, v) => { const th = v * LID, a = u * Math.PI * 2, n = add(add(mul(lAx, Math.cos(th)), lX, Math.sin(th) * Math.cos(a)), lY, Math.sin(th) * Math.sin(a)); return [add(e.c, n, LR), n, cLid]; }, true, true);
      const lash = [];
      for (let i = 0; i <= 20; i++) { const a = Math.PI * (0.05 + i / 20 * 0.9), n = add(add(mul(lAx, Math.cos(LID)), lX, Math.sin(LID) * Math.cos(a)), lY, Math.sin(LID) * Math.sin(a)); lash.push(add(e.c, n, LR + 0.0008)); }
      tube(lid, lash, t => (0.0026 + 0.0012 * Math.sin(t * Math.PI) + (e.s * (t - 0.5) > 0.3 ? 0.0012 * LW : 0)) * LW, cLash, 6);
    }
    // Augenbrauen (leicht schräg – lässiger Blick) und ein schiefes Lächeln
    const face = part('head', 0), cBrow = S(V.brow), cMouth = S(V.mouth || '#7a3531'), BW = V.browW || 1;
    for (const [s] of SIDES) {
      const a = [s * 0.018, H[1] + 0.054], b = [s * 0.05, H[1] + 0.068 + (s > 0 ? 0.004 : 0)], c = [s * 0.082, H[1] + 0.058];
      const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12, q = bezier([...a, 0], [...b, 0], [...c, 0], t); pts.push(projectFace(q[0], q[1], 0.003)); }
      tube(face, pts, t => (0.0068 - t * 0.003) * BW, cBrow, 6);
    }
    if (!V.noMouth) {
      const m = []; for (let i = 0; i <= 14; i++) { const t = i / 14, q = bezier([-0.024, H[1] - 0.064, 0], [0.002, H[1] - 0.076, 0], [0.027, H[1] - 0.06, 0], t); m.push(projectFace(q[0], q[1], 0.0015)); }
      tube(face, m, t => 0.0028 * Math.sin(0.15 + t * 2.85) + 0.001, cMouth, 6);
    }
  }
  // Logo auf dem Rücken des Shirts (folgt der Rückenform): Sonne oder Blüte
  if (V.logo && shirt) {
    const logo = part(null, 0), cSun = S(V.logo.col), cRing = S(V.logo.ring), cx = 0, cy = 1.4;
    const onBack = (x, y, lift) => { const p = surfaceAlong(shirt, [x, y, 0], [0, 0, 1]); const n = norm(grad(shirt.d, ...p)); return [add(p, n, lift), n]; };
    const ring = (r0, r1, col, lift, ox = 0, oy = 0) => grid(logo, 40, 2, (u, v) => { const a = u * Math.PI * 2, r = mix(r0, r1, v), [p, n] = onBack(cx + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r, lift); return [p, n, col]; }, true);
    if (V.logo.type === 'sun') {
      ring(0, 0.054, cRing, 0.0018); ring(0, 0.044, cSun, 0.0032);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + 0.31, ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca;
        grid(logo, 1, 3, (u, v) => { const r = mix(0.062, 0.09, v), w = mix(0.0085, 0.004, v) * (u * 2 - 1), [p, n] = onBack(cx + ca * r + tx * w, cy + sa * r + ty * w, 0.0018); return [p, n, cRing]; });
      }
    } else if (V.logo.type === 'flower') {
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + Math.PI / 2; ring(0, 0.034, cSun, 0.0018, Math.cos(a) * 0.04, Math.sin(a) * 0.04); }
      ring(0, 0.024, cRing, 0.0034);
    }
  }
  // Hibiskusblüte hinter dem rechten Ohr (Leilani) und Haargummi am Pferdeschwanz
  if (V.flower) {
    const fl = part('head', 0.4), cP = S(V.flower.petal), cPD = S(V.flower.petalD), cC = S(V.flower.center);
    const base = surfaceAlong(FF, hp(H, [0.0, 0.035, 0.0]), norm([1, 0.5, 0.12]), 0.4), N = norm(grad(F, ...base)), c = add(base, N, 0.002);
    const T1 = norm(cross(N, [0, 0, 1])), T2 = cross(N, T1);
    for (let i = 0; i < 5; i++) {
      const th = i / 5 * Math.PI * 2 + 0.4, di = add(mul(T1, Math.cos(th)), T2, Math.sin(th)), si = cross(N, di);
      sheet(fl, 8, 6, (u, v) => {
        const r = 0.006 + u * 0.05, w = (0.004 + 0.026 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)), 0.7)) * (v * 2 - 1);
        return add(add(add(c, di, r), si, w), N, 0.018 * u * u + 0.004 * u + 0.004 * (v * 2 - 1) ** 2 * u);
      }, (u) => mixc(cPD, cP, smoothstep(0.05, 0.45, u)));
    }
    tube(fl, [c, add(add(c, N, 0.022), T1, 0.008), add(add(c, N, 0.036), T1, 0.016)], t => 0.0032 - t * 0.001, cC, 6);
    ball(fl, add(add(c, N, 0.037), T1, 0.017), 0.005, cC, 8, 5);
  }
  if (V.hair && V.hair.tie) {
    const tie = part('head', 0.6), ax = norm(sub(PONY[1], PONY[0])), c = add(PONY[0], ax, 0.034);
    const B1 = norm(cross(ax, [1, 0, 0])), B2 = cross(ax, B1), pts = [];
    for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; pts.push(add(add(c, B1, Math.cos(a) * 0.043), B2, Math.sin(a) * 0.043)); }
    tube(tie, pts, () => 0.0085, S(V.hair.tie), 6);
  }
  // Taucherbrille mit Band, Schnorchel mit Mundstück (Tauchanzug)
  if (V.mask) {
    const M = V.mask, ec = [0, (eyes[0].c[1] + eyes[1].c[1]) / 2 + 0.004];
    const lens = (k, off) => { const pts = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = ec[0] + 0.085 * k * Math.sign(c) * Math.pow(Math.abs(c), 0.65), y = ec[1] + 0.045 * k * Math.sign(s) * Math.pow(Math.abs(s), 0.65) - (s < 0 ? 0.012 * Math.pow(Math.max(0, 1 - Math.abs(c) * 2.2), 2) : 0);
      pts.push(projectFace(x, y, off)); } return pts; };
    const mk = part('head', 0.6);
    tube(mk, lens(1.0, 0.009), () => 0.011, S(M.skirt), 8);
    tube(mk, lens(0.96, 0.019), () => 0.0075, S(M.frame), 8);
    const gl = part('head', 0);
    for (const [a, b, r] of [[[-0.062, 0.018], [-0.036, 0.036], 0.0032], [[-0.045, 0.006], [-0.03, 0.017], 0.0022]]) {
      const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(projectFace(ec[0] + mix(a[0], b[0], t), ec[1] + mix(a[1], b[1], t), 0.03)); }
      tube(gl, pts, t => r * Math.sin(0.2 + t * 2.7), S(M.glint), 6);
    }
    // Band rund um den Kopf
    const st = part('head', 0.6), sp = [];
    for (let i = 0; i <= 30; i++) { const ph = 0.6 + i / 30 * (Math.PI * 2 - 1.2), y = ec[1] - H[1] + 0.012 + 0.02 * Math.sin(i / 30 * Math.PI);
      const d = norm([Math.sin(ph), 0.05, -Math.cos(ph)]), q = surfaceAlong(FF, hp(H, [0, y, 0.012]), d, 0.3); sp.push(add(q, d, 0.005)); }
    tube(st, sp, () => 0.008, S(M.strap), 6);
    // Schnorchel rechts (die Kamera sieht im Spiel die rechte Seite)
    const sn = part('head', 1);
    const path = spline([[0.0, -0.077, -0.158], [0.06, -0.085, -0.142], [0.128, -0.06, -0.07], [0.154, 0.0, -0.015], [0.158, 0.1, 0.005], [0.145, 0.2, 0.022], [0.128, 0.262, 0.034]].map(o => hp(H, o)), 6);
    tube(sn, path, t => t < 0.06 ? 0.0085 : 0.011, t => t > 0.78 ? S(M.top) : S(M.snorkel), 10);
    ball(sn, hp(H, [0, -0.077, -0.153]), [0.024, 0.015, 0.012], S(M.snorkel), 14, 8);
    ball(sn, path[path.length - 1], 0.011, S(M.top), 10, 6);
  }
  // Pressluftflasche auf dem Rücken (hängt am Brustkorb)
  if (V.tank) {
    const T = V.tank, tk = part('chest', 1), Rr = 0.07, y0 = 1.17, y1 = 1.5, prof = [];
    for (let i = 0; i <= 5; i++) { const a = i / 5 * Math.PI / 2; prof.push([Math.max(0.004, Rr * Math.sin(a)), Rr * 0.6 * (1 - Math.cos(a))]); }
    for (let i = 1; i <= 6; i++) prof.push([Rr, Rr * 0.6 + (y1 - y0 - Rr * 0.6) * i / 6]);
    for (let i = 1; i <= 5; i++) { const a = i / 5 * Math.PI / 2; prof.push([Math.max(0.016, Rr * Math.cos(a)), (y1 - y0) + Rr * 0.7 * Math.sin(a)]); }
    prof.push([0.016, (y1 - y0) + Rr * 0.7 + 0.025]);
    const hb = [0.1, 0.27];
    lathe(tk, [0, y0, 0.19], prof, (h) => hb.some(b => Math.abs(h - b) < 0.016) ? S(T.band) : S(T.col), 22);
    const vv = part('chest', 0.6), top = y0 + (y1 - y0) + Rr * 0.7 + 0.025;
    lathe(vv, [0, top, 0.19], [[0.004, 0], [0.022, 0.004], [0.022, 0.03], [0.012, 0.04], [0.004, 0.042]], () => S(T.valve), 14);
    ball(vv, [0.03, top + 0.018, 0.19], [0.01, 0.014, 0.014], S(T.band), 10, 6);
  }
  // Haizähne rund um die Gesichtsöffnung und Kulleraugen oben auf der Kapuze
  if (V.teeth) {
    const tt = part('head', 0.5), oc = hp(H, V.hood.open.c), orr = V.hood.open.r, N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI * 2, x = oc[0] + orr[0] * Math.cos(a) * 1.07, y = oc[1] + orr[1] * Math.sin(a) * 1.05;
      if (F(x, y, H[2] - 0.01) >= 0) continue; // unten am Hals kein Kopf mehr dahinter
      const b = surfaceAlong(hoodF, [x, y, H[2] - 0.01], [0, 0, -1], 0.4), inw = norm([oc[0] - x, oc[1] - y, -0.35]);
      const ref = Math.abs(inw[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], e1 = norm(cross(inw, ref)), e2 = cross(e1, inw), base = add(b, inw, -0.004);
      grid(tt, 8, 3, (u, v) => { const ang = u * Math.PI * 2, rr = 0.0095 * (1 - v), n = norm(add(add(mul(e1, Math.cos(ang)), e2, Math.sin(ang)), inw, 0.35)); return [add(add(add(base, inw, v * 0.03), e1, Math.cos(ang) * rr), e2, Math.sin(ang) * rr * 0.55), n, S(V.teeth)]; }, true);
    }
  }
  if (V.sharkEyes) {
    for (const [s] of SIDES) {
      const ey = part('head', 0.5), d = norm([s * 0.8, 0.45, -0.55]), b = surfaceAlong(hoodF, hp(H, [s * 0.03, 0.08, -0.04]), d, 0.3), n = norm(grad(hoodF.d, ...b));
      ball(ey, add(b, n, 0.004), 0.018, srgb('#11161f'), 14, 8);
      ball(ey, add(add(b, n, 0.019), [0, 1, 0], 0.007), 0.0055, srgb('#ffffff'), 8, 5);
    }
  }

  /* =========================================================================
     Bauen
     ========================================================================= */
  const bb = [-0.86, -0.03, V.suit && V.suit.fins ? -0.27 : -0.27, 0.86, 2.04 + (V.hood && V.hood.shark ? 0.14 : 0), V.suit && V.suit.fins ? 0.5 : (V.hair && V.hair.style === 'ponytail' ? 0.27 : 0.24)];
  const sn = surfaceNets(F, bb, STEP);
  let pos = sn.pos;
  const nv = pos.length / 3;
  console.log(`  Oberfläche: ${nv} Punkte, ${sn.quads.length} Vierecke (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  // auf die Fläche ziehen
  for (let i = 0; i < nv; i++) {
    let p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    for (let it = 0; it < 5; it++) { const d = F(...p), g = grad(F, ...p), gg = dot(g, g); if (gg < 1e-8) break; const st = clamp(d / gg, -STEP, STEP); p = sub(p, mul(g, st)); }
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
  }
  let tris = [];
  for (const q of sn.quads) {
    const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    if (len(sub(P(q[0]), P(q[2]))) < len(sub(P(q[1]), P(q[3])))) tris.push(q[0], q[1], q[2], q[0], q[2], q[3]); else tris.push(q[0], q[1], q[3], q[1], q[2], q[3]);
  }
  // Ausrichtung prüfen (Normale zeigt nach außen?)
  { const a = tris[0], b = tris[1], c = tris[2], P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const n = cross(sub(P(b), P(a)), sub(P(c), P(a))), g = grad(F, ...P(a)); if (dot(n, g) < 0) for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; } }

  // Farben, Normalen, Schichten pro Punkt
  let nrm = [], col = [], lock = [];
  for (let i = 0; i < nv; i++) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n = norm(grad(F, ...p)), layer = layerAt(...p);
    nrm.push(...n); col.push(...colorAt(p, n, layer)); lock.push(lockAt(p, layer));
  }
  // vereinfachen (Farbgrenzen bleiben erhalten)
  if (MS) {
    const P32 = new Float32Array(pos), A = new Float32Array(nv * 6);
    for (let i = 0; i < nv; i++) { for (let c = 0; c < 3; c++) { A[i * 6 + c] = col[i * 3 + c]; A[i * 6 + 3 + c] = nrm[i * 3 + c]; } }
    const [out, err] = MS.simplifyWithAttributes(new Uint32Array(tris), P32, 3, A, 6, [3, 3, 3, 0.25, 0.25, 0.25], null, TARGET_TRIS * 3, 0.01, ['ErrorAbsolute']);
    console.log(`  vereinfacht: ${tris.length / 3} → ${out.length / 3} Dreiecke (Fehler ${(err * 1000).toFixed(2)} mm)`);
    tris = Array.from(out);
  }
  // unbenutzte Punkte entfernen
  { const map = new Int32Array(nv).fill(-1), P = [], N = [], Cc = [], Lk = []; let n = 0;
    tris = tris.map(i => { if (map[i] < 0) { map[i] = n++; P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); N.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]); Cc.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); Lk.push(lock[i]); } return map[i]; });
    pos = P; nrm = N; col = Cc; lock = Lk; }
  // Normalen leicht glätten: ruhige, saubere Cartoon-Schattierung ohne Flecken
  { const n = pos.length / 3, nb = Array.from({ length: n }, () => new Set());
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + (e + 1) % 3]; nb[a].add(b); nb[b].add(a); }
    for (let it = 0; it < 4; it++) {
      const nn = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) { let x = nrm[i * 3] * 2, y = nrm[i * 3 + 1] * 2, z = nrm[i * 3 + 2] * 2; for (const j of nb[i]) { x += nrm[j * 3]; y += nrm[j * 3 + 1]; z += nrm[j * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; nn[i * 3] = x / l; nn[i * 3 + 1] = y / l; nn[i * 3 + 2] = z / l; }
      nrm = Array.from(nn);
    }
  }
  // Kontur nur dort, wo sie nicht in Falten durchsticht (Rückenrinne, Achseln, unter der Kappe …)
  const OUTLINE_W = 0.017;
  const crownSolid = (() => { const e = ellipsoid(CAPC, CR); return (x, y, z) => e.d(...rotX([x, y, z], H, -CAP_TILT)); })();
  const occ = V.cap ? (x, y, z) => Math.min(F(x, y, z), crownSolid(x, y, z) + 0.002) : F;
  const outArr = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
    if (fins && fins.d(...p) < 0.006) { outArr.push(1); continue; }
    outArr.push(smoothstep(0.25, 0.9, occ(...add(p, n, OUTLINE_W)) / OUTLINE_W) * smoothstep(0.1, 0.6, occ(...add(p, n, OUTLINE_W * 0.5)) / (OUTLINE_W * 0.5)));
  }
  const body = { pos, nrm, col, idx: tris, out: 1, outArr, bone: null, lock };
  // Kappe & Co. dürfen nicht im Körper stecken: Punkte notfalls nach außen schieben
  for (const pt of extra) if (pt.out > 0.3) for (let i = 0; i < pt.pos.length; i += 3) {
    let p = pt.pos.slice(i, i + 3), d = F(...p);
    for (let it = 0; it < 12 && d < 0.003; it++) { p = add(p, norm(grad(F, ...p)), 0.003 - d + 0.0005); d = F(...p); }
    pt.pos.splice(i, 3, ...p);
  }

  // alles zusammenführen
  const parts = [body, ...extra];
  const NV = parts.reduce((a, p) => a + p.pos.length / 3, 0), NI = parts.reduce((a, p) => a + p.idx.length, 0);
  const POS = new Float32Array(NV * 3), NRM = new Float32Array(NV * 3), COL = new Uint16Array(NV * 4), JNT = new Uint8Array(NV * 4), WGT = new Uint8Array(NV * 4);
  const IDX = NV > 65535 ? new Uint32Array(NI) : new Uint16Array(NI);
  { let vo = 0, io = 0;
    for (const p of parts) {
      const n = p.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const v = vo + i, q = [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]];
        POS.set(q, v * 3); NRM.set(norm([p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]]), v * 3);
        for (let c = 0; c < 3; c++) COL[v * 4 + c] = Math.round(clamp(p.col[i * 3 + c], 0, 1) * 65535);
        COL[v * 4 + 3] = Math.round((p.outArr ? p.outArr[i] : p.out) * 65535);
        const bone = p.bone || (p.lock && p.lock[i]);
        const tw = bone ? { j: [BONE[bone], 0, 0, 0], w: [255, 0, 0, 0] } : top4(weightsAt(q));
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
  console.log(`  Modell: ${NV} Punkte, ${NI / 3} Dreiecke`);
  writeGLB(new URL('../models/' + V.file, import.meta.url), { NV, NI, POS, NRM, COL, JNT, WGT, IDX }, t0);
}

/* ---------- glTF-Binärdatei schreiben ---------- */
function writeGLB(OUT, { NV, NI, POS, NRM, COL, JNT, WGT, IDX }, t0) {
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
  function view(arr, target) { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) }); off += b.length + pad; return views.length - 1; }
  function accessor(arr, type, componentType, count, extra = {}) { accessors.push({ bufferView: view(arr, extra.target), componentType, count, type, ...extra, target: undefined }); return accessors.length - 1; }
  const pmin = [0, 1, 2].map(c => Math.min(...Array.from({ length: NV }, (_, i) => POS[i * 3 + c]))), pmax = [0, 1, 2].map(c => Math.max(...Array.from({ length: NV }, (_, i) => POS[i * 3 + c])));
  const aPos = accessor(POS, 'VEC3', 5126, NV, { min: pmin, max: pmax, target: 34962 });
  const aNrm = accessor(NRM, 'VEC3', 5126, NV, { target: 34962 });
  const aCol = accessor(COL, 'VEC4', 5123, NV, { normalized: true, target: 34962 });
  const aJnt = accessor(JNT, 'VEC4', 5121, NV, { target: 34962 });
  const aWgt = accessor(WGT, 'VEC4', 5121, NV, { normalized: true, target: 34962 });
  const aIdx = accessor(IDX, 'SCALAR', IDX instanceof Uint32Array ? 5125 : 5123, NI, { target: 34963 });
  const aIbm = accessor(ibm, 'MAT4', 5126, BONES.length);
  const gltf = {
    asset: { version: '2.0', generator: 'Surfers Surf – 3d/tools/build-surfer.mjs', extras: { note: 'COLOR_0.a = Stärke der Kontur (Toon-Outline)' } },
    scene: 0, scenes: [{ name: 'Surfer', nodes: [0] }],
    nodes: [{ name: 'Surfer', children: [1, ...BONES.map((_, i) => i + 2)] }, { name: 'Body', mesh: 0, skin: 0 },
      ...BONES.map((name, i) => ({ name, matrix: Array.from(rest.subarray(i * 16, i * 16 + 16)) }))],
    meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, JOINTS_0: aJnt, WEIGHTS_0: aWgt }, indices: aIdx, material: 0 }] }],
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
  console.log(`  geschrieben: ${OUT.pathname} (${((12 + 16 + json.length + bin.length) / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

/* ---------- los ---------- */
let MS = null;
try { ({ MeshoptSimplifier: MS } = await import('meshoptimizer')); await MS.ready; } catch (e) { console.log('ohne Vereinfachung (meshoptimizer fehlt):', e.message); MS = null; }
const want = process.argv.slice(2);
for (const w of want) if (!VARIANTS[w]) { console.error(`unbekannte Figur: ${w} (es gibt ${Object.keys(VARIANTS).join(', ')})`); process.exit(1); }
for (const id of want.length ? want : Object.keys(VARIANTS)) build(id, VARIANTS[id]);
