// Surfers Surf 3D – Shop: Bretter, Welten und Power-Up-Stufen.
// Der Spielstand wird mit der 2D-Version geteilt (gleicher Speicherplatz): Münzen, Bretter, Welten und Stufen gelten in beiden.
const SAVE_KEY = 'surfersSurf.web.v1';
const NOSAVE = /[?&]nosave\b/.test(location.search);
const FIELDS = ['coins', 'board', 'boards', 'up', 'worlds'];
const DEFAULT = { coins: 0, board: 'classic', boards: ['classic'], up: { magnet: 1, shield: 1, kite: 1, double: 1 }, worlds: ['tropen'] };

function readStore() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch (e) { return {}; } }
export const save = JSON.parse(JSON.stringify(DEFAULT));
function load() {
  const d = readStore();
  for (const k of FIELDS) if (d[k] !== undefined) save[k] = k === 'up' ? Object.assign({}, DEFAULT.up, d[k]) : d[k];
  if (!Array.isArray(save.boards) || !save.boards.includes('classic')) save.boards = ['classic', ...(Array.isArray(save.boards) ? save.boards : [])];
  if (!Array.isArray(save.worlds) || !save.worlds.includes('tropen')) save.worlds = ['tropen', ...(Array.isArray(save.worlds) ? save.worlds : [])];
  if (!save.boards.includes(save.board)) save.board = 'classic';
  save.coins = Math.max(0, Math.floor(+save.coins || 0));
}
load();
// nur die eigenen Felder zurückschreiben – alles andere (Surfer, Challenges, Einstellungen der 2D-Version) bleibt unberührt
export function persist() {
  if (NOSAVE) return;
  const d = readStore(); for (const k of FIELDS) d[k] = save[k];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) {}
}
export function addCoins(n) { if (n > 0) { save.coins += n; persist(); } }

/* ---------- Bretter: dieselben wie in 2D, als Deck-Bemalung fürs 3D-Brett ---------- */
export const BOARDS = [
  { id: 'classic', name: 'Muschelweiß', price: 0, desc: 'Das Brett vom Titelbild: cremeweiß mit blauer Welle.', base: ['#fff8e6', '#ead9b4'], rail: '#b9a27a', accent: '#2f7fd8', design: 'wave', trail: '#ffffff' },
  { id: 'sunset', name: 'Sonnenuntergang', price: 300, desc: 'Warme Streifen für den Abendsurf.', base: ['#ffc463', '#ff5e62'], rail: '#b8433a', accent: '#fff1c1', design: 'stripes', trail: '#ffd6a5' },
  { id: 'shark', name: 'Hai-Zahn', price: 700, desc: 'Beißt sich durch jede Welle.', base: ['#c3d2de', '#7f96aa'], rail: '#56697b', accent: '#ffffff', design: 'shark', trail: '#e3f6ff' },
  { id: 'tiki', name: 'Tiki-Holz', price: 1200, desc: 'Handgeschnitzt, mit Maske und Maserung.', base: ['#d9a263', '#9a6333'], rail: '#6b4020', accent: '#e8442e', design: 'tiki', trail: '#ffe0b8' },
  { id: 'metal', name: 'Metallbrett', price: 1800, desc: 'Gebürsteter Stahl mit Nieten.', base: ['#f1f5f8', '#8f9ba6'], rail: '#56616b', accent: '#3d4852', design: 'metal', trail: '#e6eef4' },
  { id: 'rainbow', name: 'Regenbogen', price: 2000, desc: 'Hinterlässt eine bunte Gischtspur.', base: ['#ffffff', '#ffffff'], rail: '#6a4bb8', accent: '#ffffff', design: 'rainbow', trail: 'rainbow' },
  { id: 'sub', name: 'U-Boot-Board', price: 3000, desc: 'Bullaugen, Schraube, druckfest.', base: ['#ffe066', '#f2a90f'], rail: '#b36b00', accent: '#1d5c8c', design: 'sub', trail: '#bff0ff' },
  { id: 'lava', name: 'Obsidian', price: 3200, desc: 'Schwarzes Vulkanglas mit glühenden Adern.', base: ['#3a3a46', '#18181e'], rail: '#0e0e12', accent: '#ff7a1a', design: 'lava', trail: '#ff9a3c' },
  { id: 'gold', name: 'Goldrausch', price: 5000, desc: 'Für echte Legenden. Glitzert in der Sonne.', base: ['#fff0a0', '#e0a21e'], rail: '#9a6508', accent: '#fffbe0', design: 'gold', trail: '#ffe066' },
];
export const getBoard = id => BOARDS.find(b => b.id === id) || BOARDS[0];
export const RAINBOW = ['#ff4d4d', '#ff9f1a', '#ffd23f', '#3cd070', '#2fa3ff', '#8a5cff'];
// gleicher Umriss wie das 3D-Brett: v = 0 Heck, 1 Nase
const halfW = v => v < 0.42 ? 0.62 + 0.38 * Math.sin(v / 0.42 * Math.PI / 2) : Math.pow(Math.max(0, Math.cos((v - 0.42) / 0.58 * Math.PI / 2)), 0.7);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Deck-Bild: 128 breit (quer zum Brett), 512 lang; oben das Heck, unten die Nase. glow: Leucht-Bild für Obsidian/Gold
const deckCache = new Map();
export function deckCanvas(b) {
  if (deckCache.has(b.id)) return deckCache.get(b.id);
  const W = 128, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  let glow = null, gx = null;
  if (b.design === 'lava' || b.design === 'gold') { glow = document.createElement('canvas'); glow.width = W; glow.height = H; gx = glow.getContext('2d'); gx.fillStyle = '#000'; gx.fillRect(0, 0, W, H); }
  const R = rng(b.id.length * 977 + b.price);
  const lin = (x0, y0, x1, y1, cols) => { const g = x.createLinearGradient(x0, y0, x1, y1); cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col)); return g; };
  // Grund: Verlauf quer (gewölbtes Deck) und längs
  x.fillStyle = lin(0, 0, 0, H, [b.base[1], b.base[0], b.base[0], b.base[1]]); x.fillRect(0, 0, W, H);
  x.fillStyle = lin(0, 0, W, 0, ['rgba(0,0,0,.14)', 'rgba(255,255,255,.12)', 'rgba(255,255,255,0)', 'rgba(0,0,0,.14)']); x.fillRect(0, 0, W, H);
  const stringer = (col, w = 3) => { x.fillStyle = col; x.fillRect(W / 2 - w / 2, 0, w, H); };
  switch (b.design) {
    case 'wave': {
      stringer('rgba(185,162,122,.8)');
      x.lineCap = 'round';
      for (const [w, col, off] of [[26, b.accent, 0], [9, '#7cc6ff', -24], [6, '#ff6b4a', 22]]) {
        x.strokeStyle = col; x.lineWidth = w; x.beginPath();
        for (let i = 0; i <= 40; i++) { const t = i / 40, yy = 250 + off + Math.sin(t * Math.PI * 2.2) * 26 + t * 40; i ? x.lineTo(t * W, yy) : x.moveTo(t * W, yy); } x.stroke();
      }
      x.fillStyle = b.accent; x.beginPath(); x.arc(64, 360, 22, 0, Math.PI * 2); x.fill(); x.fillStyle = b.base[0]; x.beginPath(); x.arc(72, 352, 13, 0, Math.PI * 2); x.fill();
      break;
    }
    case 'stripes': {
      x.fillStyle = lin(0, 0, 0, H, ['#ff5e62', '#ff8a5b', '#ffc463', '#ff8a5b']); x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(255,241,193,.95)'; x.beginPath(); x.arc(64, 300, 34, Math.PI, 0); x.fill();
      for (let i = 0; i < 5; i++) { x.fillStyle = i % 2 ? '#b8433a' : '#fff1c1'; x.fillRect(0, 312 + i * 14, W, 7); }
      stringer('rgba(184,67,58,.55)', 2);
      break;
    }
    case 'shark': {
      x.fillStyle = lin(0, 0, W, 0, ['#7f96aa', '#c3d2de', '#eef3f7', '#c3d2de', '#7f96aa']); x.fillRect(0, 0, W, H);
      // Zahnreihe an der Nase und Kiemen
      x.fillStyle = '#56697b'; x.beginPath(); x.moveTo(0, 380); for (let i = 0; i <= 8; i++) x.lineTo(i * 16, 380 + (i % 2 ? 22 : 0)); x.lineTo(W, 512); x.lineTo(0, 512); x.fill();
      x.fillStyle = '#ffffff'; for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(i * 16 + 1, 392); x.lineTo(i * 16 + 8, 418); x.lineTo(i * 16 + 15, 392); x.fill(); }
      x.strokeStyle = '#56697b'; x.lineWidth = 4; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(64, 200 + i * 22, 30, Math.PI * 1.15, Math.PI * 1.85); x.stroke(); }
      x.fillStyle = '#141a24'; x.beginPath(); x.arc(42, 350, 6, 0, Math.PI * 2); x.arc(86, 350, 6, 0, Math.PI * 2); x.fill();
      break;
    }
    case 'tiki': {
      x.strokeStyle = 'rgba(107,64,32,.45)'; x.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const x0 = R() * W; x.beginPath(); for (let y = 0; y <= H; y += 16) x.lineTo(x0 + Math.sin(y * 0.02 + i) * 6, y); x.stroke(); }
      // Maske
      x.fillStyle = '#6b4020'; x.fillRect(30, 200, 68, 120); x.fillStyle = b.accent; x.fillRect(34, 204, 60, 112);
      x.fillStyle = '#ffe0b8'; x.fillRect(40, 226, 18, 14); x.fillRect(70, 226, 18, 14);
      x.fillStyle = '#1d1208'; x.fillRect(45, 229, 8, 8); x.fillRect(75, 229, 8, 8);
      x.fillStyle = '#ffe0b8'; x.fillRect(40, 280, 48, 18); x.fillStyle = '#1d1208'; for (let i = 0; i < 5; i++) x.fillRect(43 + i * 9, 283, 5, 12);
      x.fillStyle = '#ffd23f'; x.beginPath(); x.moveTo(64, 248); x.lineTo(72, 272); x.lineTo(56, 272); x.fill();
      break;
    }
    case 'metal': {
      for (let y = 0; y < H; y += 2) { x.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '60,70,80'},${(R() * 0.08).toFixed(3)})`; x.fillRect(0, y, W, 1); }
      x.fillStyle = 'rgba(61,72,82,.55)'; x.fillRect(0, 170, W, 3); x.fillRect(0, 340, W, 3);
      for (const yy of [60, 170, 260, 340, 430]) for (const xx of [22, 106]) { x.fillStyle = '#56616b'; x.beginPath(); x.arc(xx, yy, 5, 0, Math.PI * 2); x.fill(); x.fillStyle = '#e6eef4'; x.beginPath(); x.arc(xx - 1.5, yy - 1.5, 2, 0, Math.PI * 2); x.fill(); }
      break;
    }
    case 'rainbow': {
      RAINBOW.forEach((col, i) => { x.fillStyle = col; x.fillRect(i * W / 6, 0, W / 6 + 1, H); });
      x.fillStyle = lin(0, 0, 0, H, ['rgba(255,255,255,.35)', 'rgba(255,255,255,0)', 'rgba(255,255,255,.25)']); x.fillRect(0, 0, W, H);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 300, 20, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#6a4bb8'; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 7 : 15; x.lineTo(64 + Math.cos(a) * r, 300 + Math.sin(a) * r); } x.fill();
      break;
    }
    case 'sub': {
      x.fillStyle = '#1d5c8c'; x.fillRect(0, 150, W, 10); x.fillRect(0, 380, W, 10);
      for (const yy of [215, 270, 325]) { x.fillStyle = '#b36b00'; x.beginPath(); x.arc(64, yy, 22, 0, Math.PI * 2); x.fill(); x.fillStyle = '#9ad8ff'; x.beginPath(); x.arc(64, yy, 15, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,.8)'; x.beginPath(); x.ellipse(58, yy - 5, 5, 3, -0.6, 0, Math.PI * 2); x.fill(); }
      for (let i = 0; i < 3; i++) { x.save(); x.translate(64, 60); x.rotate(i * Math.PI * 2 / 3); x.fillStyle = '#1d5c8c'; x.beginPath(); x.ellipse(0, -14, 7, 14, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
      break;
    }
    case 'lava': {
      // glühende Adern: verzweigte Risse, leuchten auch im Schatten
      const crack = (x0, y0, len, a, w) => {
        let px = x0, py = y0;
        for (let i = 0; i < len; i++) { const nx = px + Math.cos(a) * 10, ny = py + Math.sin(a) * 10;
          for (const [ctx, col, lw] of [[x, '#ff7a1a', w + 2], [x, '#ffd27a', w * 0.5], [gx, '#ff8a2a', w + 4]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke(); }
          px = nx; py = ny; a += (R() - 0.5) * 0.9; if (R() < 0.12 && w > 1.2) crack(px, py, len - i - 2, a + (R() < 0.5 ? 0.8 : -0.8), w * 0.6); }
      };
      for (let i = 0; i < 5; i++) crack(R() * W, R() * 120, 40, Math.PI / 2 + (R() - 0.5) * 0.6, 3);
      break;
    }
    case 'gold': {
      x.fillStyle = lin(0, 0, W, 0, ['#c98a12', '#ffe58a', '#fff6c8', '#f2c14e', '#c98a12']); x.fillRect(0, 0, W, H);
      x.fillStyle = lin(0, 0, 0, H, ['rgba(255,255,255,0)', 'rgba(255,255,255,.35)', 'rgba(255,255,255,0)', 'rgba(255,255,255,.3)', 'rgba(255,255,255,0)']); x.fillRect(0, 0, W, H);
      stringer('#9a6508', 3);
      const star = (ctx, cx, cy, r, col) => { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.25 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.fill(); };
      for (let i = 0; i < 18; i++) { const cx = 14 + R() * 100, cy = 30 + R() * 450, r = 4 + R() * 9; star(x, cx, cy, r, '#fffbe0'); star(gx, cx, cy, r, '#fff1b0'); }
      break;
    }
  }
  const out = { deck: c, glow };
  deckCache.set(b.id, out);
  return out;
}

// Vorschaubild fürs Shop-Kärtchen: Brett von oben, Nase rechts, mit Schatten und Glanz
export function drawBoardPreview(cvs, b) {
  const x = cvs.getContext('2d'), W = cvs.width, H = cvs.height, { deck, glow } = deckCanvas(b);
  x.clearRect(0, 0, W, H);
  const sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#7fd3f0'); sky.addColorStop(1, '#1b8fc4'); x.fillStyle = sky; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 3; for (let i = 0; i < 5; i++) { x.beginPath(); for (let k = 0; k <= W; k += 10) x.lineTo(k, H * (0.2 + i * 0.17) + Math.sin(k * 0.05 + i) * 4); x.stroke(); }
  const len = W * 0.86, wid = H * 0.2, left = (W - len) / 2, cy = H / 2;
  const outline = (dx = 0, dy = 0, grow = 0) => { x.beginPath(); for (let i = 0; i <= 60; i++) { const v = i / 60; x.lineTo(left + v * len + dx, cy - halfW(v) * (wid + grow) + dy); } for (let i = 60; i >= 0; i--) { const v = i / 60; x.lineTo(left + v * len + dx, cy + halfW(v) * (wid + grow) + dy); } x.closePath(); };
  x.fillStyle = 'rgba(0,30,60,.3)'; outline(6, 10, 2); x.fill();
  x.fillStyle = b.rail; outline(0, 3, 3); x.fill();
  x.save(); outline(); x.clip();
  x.setTransform(0, 2 * wid / deck.width, len / deck.height, 0, left, cy - wid); x.drawImage(deck, 0, 0);
  if (glow) { x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5; x.drawImage(glow, 0, 0); }
  x.restore();
  x.save(); outline(); x.clip(); const gl = x.createLinearGradient(0, cy - wid, 0, cy + wid); gl.addColorStop(0, 'rgba(255,255,255,.45)'); gl.addColorStop(0.35, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = gl; x.fillRect(0, 0, W, H); x.restore();
  x.strokeStyle = '#0d2a4a'; x.lineWidth = 3; outline(0, 0, 1); x.stroke();
}

/* ---------- Welten ---------- */
export const WORLDS = [
  { id: 'tropen', themes: ['mittag', 'abend'], name: 'Tropeninsel', price: 0, desc: 'Palmen, Inseln, Delfine – am Mittag oder im Abendrot.' },
  { id: 'canyon', themes: ['canyon'], name: 'Canyon', price: 800, desc: 'Rote Felswände, Wasserfälle und wackelige Hängebrücken.' },
];
export const worldOf = theme => WORLDS.find(w => w.themes.includes(theme)) || WORLDS[0];
export const themeUnlocked = theme => save.worlds.includes(worldOf(theme).id);
function drawWorldThumb(cvs, w) {
  const x = cvs.getContext('2d'), W = cvs.width, H = cvs.height, hz = H * 0.52, g = (y0, y1, a) => { const gr = x.createLinearGradient(0, y0, 0, y1); a.forEach((c, i) => gr.addColorStop(i / (a.length - 1), c)); return gr; };
  if (w.id === 'canyon') {
    x.fillStyle = g(0, hz, ['#4a78c8', '#9fb8d8', '#ffd7a6']); x.fillRect(0, 0, W, hz);
    x.fillStyle = g(hz, H, ['#3fb9a6', '#1f8c80', '#0d5650']); x.fillRect(0, hz, W, H - hz);
    const cols = ['#a63e25', '#c4552e', '#d9733f', '#e89a5c', '#bf5230'];
    for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) { const t = i / 6, top = H * (0.05 + t * 0.3), inner = W / 2 + sd * W * (0.42 - t * 0.36);
      x.fillStyle = cols[i % 5]; x.beginPath(); x.moveTo(sd < 0 ? 0 : W, H * 0.98); x.lineTo(inner + sd * 8, H * (0.98 - t * 0.38)); x.lineTo(inner, top + 12); x.lineTo(inner + sd * 12, top); x.lineTo(sd < 0 ? 0 : W, top); x.fill(); }
    x.fillStyle = 'rgba(255,255,255,.75)'; x.fillRect(W * 0.24, H * 0.2, 5, H * 0.5);
    x.strokeStyle = '#7a5230'; x.lineWidth = 3; x.beginPath(); x.moveTo(W * 0.18, H * 0.38); x.quadraticCurveTo(W / 2, H * 0.62, W * 0.82, H * 0.38); x.stroke();
  } else {
    x.fillStyle = g(0, hz, ['#2a7fd4', '#7fc8ee', '#ffd0a0']); x.fillRect(0, 0, W, hz);
    x.fillStyle = '#fff2b0'; x.beginPath(); x.arc(W * 0.78, hz * 0.55, 18, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#3c9a48'; x.beginPath(); x.moveTo(W * 0.05, hz); x.quadraticCurveTo(W * 0.2, hz * 0.2, W * 0.42, hz); x.fill();
    x.fillStyle = '#2a7a3c'; x.beginPath(); x.moveTo(W * 0.3, hz); x.quadraticCurveTo(W * 0.42, hz * 0.45, W * 0.56, hz); x.fill();
    x.fillStyle = g(hz, H, ['#3fd0d8', '#1d8fbf', '#0b5f86']); x.fillRect(0, hz, W, H - hz);
    x.fillStyle = '#f3d9a0'; x.beginPath(); x.ellipse(W * 0.66, hz + 14, 50, 10, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#7a5230'; x.lineWidth = 4; x.beginPath(); x.moveTo(W * 0.66, hz + 10); x.quadraticCurveTo(W * 0.68, hz - 20, W * 0.64, hz - 42); x.stroke();
    x.fillStyle = '#4fa944'; for (let i = 0; i < 6; i++) { x.save(); x.translate(W * 0.64, hz - 42); x.rotate(i * 1.05); x.beginPath(); x.ellipse(16, 0, 18, 5, 0.3, 0, Math.PI * 2); x.fill(); x.restore(); }
  }
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 2; for (let i = 0; i < 4; i++) { x.beginPath(); for (let k = 0; k <= W; k += 10) x.lineTo(k, hz + 16 + i * 18 + Math.sin(k * 0.06 + i) * 3); x.stroke(); }
}

/* ---------- Power-Up-Stufen (wie in 2D) ---------- */
export const POWERS = {
  magnet: { name: 'Münzmagnet', desc: 'Zieht Münzen aus allen Spuren zu dir.', dur: [8, 10, 12, 14.5, 17] },
  shield: { name: 'Schutzblase', desc: 'Fängt einen Aufprall ab.', dur: [10, 13, 16, 19.5, 23] },
  kite: { name: 'Drachen', desc: 'Hebt dich über alles hinweg – Münzen in der Luft.', dur: [6, 7.5, 9, 10.5, 12] },
};
const UP_COST = [250, 600, 1200, 2200];
export const powerDur = k => POWERS[k].dur[Math.min(5, Math.max(1, save.up[k] || 1)) - 1];

/* ---------- Oberfläche ---------- */
const $ = id => document.getElementById(id);
let hooks = {}, tab = 'boards', coinUrl = '';
const fmt = n => n.toLocaleString('de-DE');
function toast(text) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 2300); }
function coinImg() { const i = document.createElement('span'); i.className = 'coin'; return i; }
function priceBtn(price, label) {
  const b = document.createElement('button'); b.className = 'sbtn gold' + (save.coins < price ? ' poor' : '');
  if (label) b.append(label + ' '); b.append(coinImg(), ' ' + fmt(price)); return b;
}
function plainBtn(text, cls, disabled) { const b = document.createElement('button'); b.className = 'sbtn ' + cls; b.textContent = text; b.disabled = !!disabled; return b; }
function tryBuy(price, btn, ok) {
  if (save.coins < price) { hooks.sound.nope(); btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); toast(`Dir fehlen noch ${fmt(price - save.coins)} Münzen.`); return; }
  save.coins -= price; ok(); persist(); hooks.sound.buy(); render(); hooks.onChange && hooks.onChange();
}
function card({ prev, title, desc, button, equipped, tag, tagCls, pips, wide }) {
  const c = document.createElement('div'); c.className = 'card' + (equipped ? ' equipped' : '') + (wide ? ' wide' : '');
  if (prev) { prev.classList.add('prev'); c.appendChild(prev); }
  if (tag) { const t = document.createElement('span'); t.className = 'tag ' + (tagCls || ''); t.textContent = tag; c.appendChild(t); }
  const h = document.createElement('h3'); h.textContent = title; c.appendChild(h);
  if (pips !== undefined) { const p = document.createElement('div'); p.className = 'pips'; for (let i = 1; i <= 5; i++) { const e = document.createElement('i'); if (i <= pips) e.className = 'on'; p.appendChild(e); } c.appendChild(p); }
  const d = document.createElement('p'); d.textContent = desc; c.appendChild(d);
  c.appendChild(button); return c;
}
export function render() {
  const grid = $('shopGrid'); grid.textContent = '';
  $('shopCoins').textContent = fmt(save.coins);
  document.querySelectorAll('#shop .tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (tab === 'boards') {
    for (const b of BOARDS) {
      const owned = save.boards.includes(b.id), eq = save.board === b.id;
      let btn;
      if (eq) btn = plainBtn('Im Einsatz', 'leaf', true);
      else if (owned) { btn = plainBtn('Auswählen', 'sea'); btn.onclick = () => { hooks.sound.click(); save.board = b.id; persist(); render(); hooks.onChange(); }; }
      else { btn = priceBtn(b.price); btn.onclick = () => tryBuy(b.price, btn, () => { save.boards.push(b.id); save.board = b.id; toast(`${b.name} gehört jetzt dir!`); }); }
      const cvs = document.createElement('canvas'); cvs.width = 330; cvs.height = 200; drawBoardPreview(cvs, b);
      grid.appendChild(card({ prev: cvs, title: b.name, desc: b.desc, button: btn, equipped: eq, tag: eq ? 'Aktiv' : '' }));
    }
  } else if (tab === 'worlds') {
    WORLDS.forEach(w => {
      const unlocked = save.worlds.includes(w.id), active = w.themes.includes(hooks.theme());
      let btn;
      if (!unlocked) { btn = priceBtn(w.price, 'Freischalten'); btn.onclick = () => tryBuy(w.price, btn, () => { save.worlds.push(w.id); hooks.selectTheme(w.themes[0]); toast(`${w.name} ist freigeschaltet – viel Spaß!`); }); }
      else if (active) btn = plainBtn('Hier surfst du', 'leaf', true);
      else { btn = plainBtn('Hier surfen', 'sea'); btn.onclick = () => { hooks.sound.click(); hooks.selectTheme(w.themes[0]); render(); }; }
      const cvs = document.createElement('canvas'); cvs.width = 450; cvs.height = 250; drawWorldThumb(cvs, w);
      grid.appendChild(card({ prev: cvs, title: w.name, desc: w.desc, button: btn, equipped: active, wide: true, tag: active ? 'Aktiv' : unlocked ? (w.price ? 'Freigeschaltet' : 'Startwelt') : 'Gesperrt', tagCls: unlocked ? '' : 'lock' }));
    });
  } else {
    for (const k of Object.keys(POWERS)) {
      const pw = POWERS[k], lvl = save.up[k] || 1, dur = pw.dur[lvl - 1];
      let btn;
      if (lvl >= 5) btn = plainBtn('Maximal', 'leaf', true);
      else { const price = UP_COST[lvl - 1]; btn = priceBtn(price, 'Stufe ' + (lvl + 1)); btn.onclick = () => tryBuy(price, btn, () => { save.up[k] = lvl + 1; toast(`${pw.name} hält jetzt ${pw.dur[lvl]} s.`); }); }
      const img = document.createElement('img'); img.src = hooks.icons[k]; img.alt = ''; img.className = 'icon';
      grid.appendChild(card({ prev: img, title: pw.name, desc: `${pw.desc} Dauer: ${String(dur).replace('.', ',')} s${lvl < 5 ? ' → ' + String(pw.dur[lvl]).replace('.', ',') + ' s' : ''}.`, pips: lvl, button: btn }));
    }
  }
}
export function openShop(t) { if (t) tab = t; load(); render(); $('shop').hidden = false; }
export function closeShop() { $('shop').hidden = true; hooks.onClose && hooks.onClose(); }
export function initShop(h) {
  hooks = h;
  document.querySelectorAll('#shop .tabs button').forEach(b => b.addEventListener('click', () => { hooks.sound.click(); tab = b.dataset.tab; render(); }));
  $('shopBack').addEventListener('click', () => { hooks.sound.click(); closeShop(); });
  // Änderungen aus der 2D-Version (anderer Tab) übernehmen
  addEventListener('storage', e => { if (e.key === SAVE_KEY) { load(); hooks.onChange(); if (!$('shop').hidden) render(); } });
}
