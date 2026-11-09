// Skelett des Surfers – gemeinsam genutzt vom Spiel (surfer.js) und vom Bau-Skript des Modells
// (tools/build-surfer.mjs). Reines JavaScript ohne Three.js, damit beide exakt dieselben Knochen-Lagen rechnen.
//
// Jeder Knochen bekommt eine volle Lage (Matrix im Raum des Surfers) aus Gelenkpunkten:
// y-Achse = Richtung des Glieds, x-Achse = Bezugsrichtung (z. B. wohin das Knie zeigt), z = x × y.
// Das Modell steht in Ruhe aufrecht, Blick nach -Z, rechte Körperseite bei +X, Arme leicht abgespreizt.

export const BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'upL', 'loL', 'handL', 'upR', 'loR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const BONE = Object.fromEntries(BONES.map((b, i) => [b, i]));

// Gliedlängen (passen zur Zwei-Glied-IK im Spiel)
export const LEN = { thigh: 0.46, shin: 0.46, upper: 0.31, lower: 0.28 };
// Gelenke relativ zu Becken bzw. Brustkorb (in deren eigener Lage)
export const HIP_OFS = [0.11, -0.05, 0];      // Hüftgelenk rechts (links gespiegelt)
export const SHOULDER_OFS = [0.225, -0.02, 0]; // Schultergelenk rechts
export const ANKLE_H = 0.07;                    // Knöchel über der Fußsohle

const ARM_A = 50 * Math.PI / 180; // Ruhehaltung der Arme: 50° vom Lot
const armDir = s => [s * Math.sin(ARM_A), -Math.cos(ARM_A), 0];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export const REST = (() => {
  const J = { hip: [0, 1.04, 0], chest: [0, 1.54, 0], neck: [0, 1.67, -0.01], head: [0, 1.84, -0.02] };
  for (const [s, k] of [[-1, 'L'], [1, 'R']]) {
    J['sh' + k] = add(J.chest, [s * SHOULDER_OFS[0], SHOULDER_OFS[1], 0]);
    J['el' + k] = add(J['sh' + k], armDir(s), LEN.upper);
    J['hd' + k] = add(J['el' + k], armDir(s), LEN.lower);
    J['hp' + k] = add(J.hip, [s * HIP_OFS[0], HIP_OFS[1], 0]);
    J['kn' + k] = add(J['hp' + k], [s * 0.005, -LEN.thigh, 0]);
    J['ft' + k] = add(J['kn' + k], [s * 0.005, -LEN.shin, 0]);
    J['knee' + k] = [0, 0, -1];   // Knie zeigt nach vorn
    J['elbow' + k] = [0, 0, 1];   // Ellbogen zeigt nach hinten
    J['footX' + k] = [0, 0, -1];  // Zehen nach vorn
    J['footY' + k] = [0, 1, 0];
  }
  J.pelvisX = [1, 0, 0]; J.pelvisY = [0, 1, 0]; J.chestX = [1, 0, 0]; J.headX = [1, 0, 0]; J.headY = [0, 1, 0];
  return J;
})();

function basis(out, i, o, y, xr) {
  let l = Math.hypot(y[0], y[1], y[2]) || 1; const y0 = y[0] / l, y1 = y[1] / l, y2 = y[2] / l;
  const d = xr[0] * y0 + xr[1] * y1 + xr[2] * y2;
  let x0 = xr[0] - y0 * d, x1 = xr[1] - y1 * d, x2 = xr[2] - y2 * d; l = Math.hypot(x0, x1, x2) || 1; x0 /= l; x1 /= l; x2 /= l;
  const z0 = x1 * y2 - x2 * y1, z1 = x2 * y0 - x0 * y2, z2 = x0 * y1 - x1 * y0;
  const m = i * 16;
  out[m] = x0; out[m + 1] = x1; out[m + 2] = x2; out[m + 3] = 0;
  out[m + 4] = y0; out[m + 5] = y1; out[m + 6] = y2; out[m + 7] = 0;
  out[m + 8] = z0; out[m + 9] = z1; out[m + 10] = z2; out[m + 11] = 0;
  out[m + 12] = o[0]; out[m + 13] = o[1]; out[m + 14] = o[2]; out[m + 15] = 1;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const nsum = (a, b) => { const v = [a[0] + b[0], a[1] + b[1], a[2] + b[2]], l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// Lagen aller Knochen als 4×4-Matrizen (Spalten zuerst, wie in Three.js und glTF)
export function boneFrames(J, out = new Float32Array(BONES.length * 16)) {
  const up = sub(J.chest, J.hip);
  basis(out, BONE.pelvis, J.hip, J.pelvisY || up, J.pelvisX);
  basis(out, BONE.spine, mid(J.hip, J.chest), up, nsum(J.pelvisX, J.chestX));
  basis(out, BONE.chest, J.chest, up, J.chestX);
  basis(out, BONE.neck, J.neck, sub(J.head, J.neck), nsum(J.chestX, J.headX));
  basis(out, BONE.head, J.head, J.headY, J.headX);
  for (const k of ['L', 'R']) {
    const sh = J['sh' + k], el = J['el' + k], hd = J['hd' + k], e = J['elbow' + k];
    basis(out, BONE['up' + k], sh, sub(el, sh), e);
    basis(out, BONE['lo' + k], el, sub(hd, el), e);
    basis(out, BONE['hand' + k], hd, sub(hd, el), e);
    const hp = J['hp' + k], kn = J['kn' + k], ft = J['ft' + k], n = J['knee' + k];
    basis(out, BONE['thigh' + k], hp, sub(kn, hp), n);
    basis(out, BONE['shin' + k], kn, sub(ft, kn), n);
    basis(out, BONE['foot' + k], ft, J['footY' + k], J['footX' + k]);
  }
  return out;
}

// Punkt aus der Lage eines Knochens in den Raum des Surfers (für Hüft- und Schultergelenke)
export function fromFrame(m, i, v, out = [0, 0, 0]) {
  const o = i * 16;
  out[0] = m[o] * v[0] + m[o + 4] * v[1] + m[o + 8] * v[2] + m[o + 12];
  out[1] = m[o + 1] * v[0] + m[o + 5] * v[1] + m[o + 9] * v[2] + m[o + 13];
  out[2] = m[o + 2] * v[0] + m[o + 6] * v[1] + m[o + 10] * v[2] + m[o + 14];
  return out;
}
