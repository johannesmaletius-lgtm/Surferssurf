// Ton für den 3D-Prototyp: alles per WebAudio erzeugt (keine Dateien) – übernommen aus dem 2D-Spiel
const KEY = 'surfersSurf3d.sound';
let on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* kein Speicher – Ton bleibt an */ }

let ac = null, master, sfxBus, musicBus, ambBus, windGain, noise, mTimer = null, mNext = 0, mStep = 0, motif = [];
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const pick = a => a[Math.floor(Math.random() * a.length)];

export function init() {
  if (ac) { resume(); return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try { ac = new AC(); } catch (e) { return false; }
  master = ac.createGain(); master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ac.destination);
  sfxBus = ac.createGain(); musicBus = ac.createGain(); ambBus = ac.createGain();
  sfxBus.connect(master); musicBus.connect(master); ambBus.connect(master);
  const len = ac.sampleRate * 2;
  noise = ac.createBuffer(1, len, ac.sampleRate);
  const d = noise.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
  // Meeresrauschen, langsam an- und abschwellend
  const s1 = ac.createBufferSource(); s1.buffer = noise; s1.loop = true;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
  const g1 = ac.createGain(); g1.gain.value = 0.22;
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.12; const lg = ac.createGain(); lg.gain.value = 0.12;
  lfo.connect(lg); lg.connect(g1.gain); s1.connect(lp); lp.connect(g1); g1.connect(ambBus); s1.start(); lfo.start();
  // Fahrtwind
  const s2 = ac.createBufferSource(); s2.buffer = noise; s2.loop = true; s2.playbackRate.value = 1.4;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.5;
  windGain = ac.createGain(); windGain.gain.value = 0;
  s2.connect(bp); bp.connect(windGain); windGain.connect(ambBus); s2.start();
  apply();
  return true;
}
export function resume() { if (ac && ac.state !== 'running') ac.resume().catch(() => {}); }
function apply() {
  if (!ac) return;
  const t = ac.currentTime;
  sfxBus.gain.setTargetAtTime(on ? 0.85 : 0, t, 0.05);
  ambBus.gain.setTargetAtTime(on ? 0.8 : 0, t, 0.1);
  musicBus.gain.setTargetAtTime(on ? 0.3 : 0, t, 0.1);
  if (on) startMusic(); else stopMusic();
}
export function toggle() { on = !on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {} if (on) init(); apply(); return on; }
export const isOn = () => on;
export function wind(v) { if (ac) windGain.gain.setTargetAtTime(on ? v : 0, ac.currentTime, 0.25); }

function tone({ f = 440, f2 = 0, type = 'sine', dur = 0.15, vol = 0.25, att = 0.004, delay = 0 }) {
  if (!ac || !on) return;
  const t = ac.currentTime + delay, osc = ac.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(f, t);
  if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(sfxBus); osc.start(t); osc.stop(t + dur + 0.05);
}
function hiss({ dur = 0.3, vol = 0.3, f = 1000, f2 = 0, q = 1, type = 'bandpass', delay = 0, rate = 1, pan = 0 }) {
  if (!ac || !on) return;
  const t = ac.currentTime + delay, s = ac.createBufferSource(); s.buffer = noise; s.playbackRate.value = rate;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g;
  if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  s.connect(fl); fl.connect(g); out.connect(sfxBus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
export const fx = {
  coin(n) { const semi = [0, 2, 4, 5, 7, 9, 11, 12][Math.min(n, 7)], f = 1318 * 2 ** (semi / 12); tone({ f, type: 'triangle', dur: 0.09, vol: 0.15 }); tone({ f: f * 1.5, dur: 0.16, vol: 0.09, delay: 0.045 }); },
  swish() { hiss({ dur: 0.18, vol: 0.2, f: 2600, f2: 900, q: 1.2 }); },
  jump() { hiss({ dur: 0.32, vol: 0.26, f: 700, f2: 2600, q: 0.9 }); tone({ f: 260, f2: 540, dur: 0.2, vol: 0.09, type: 'triangle' }); },
  land() { hiss({ dur: 0.42, vol: 0.34, f: 2400, f2: 300, type: 'lowpass' }); },
  crash() { hiss({ dur: 1.3, vol: 0.6, f: 2600, f2: 160, type: 'lowpass' }); tone({ f: 330, f2: 70, type: 'sawtooth', dur: 0.7, vol: 0.09 }); tone({ f: 90, f2: 40, dur: 0.5, vol: 0.4, delay: 0.02 }); },
  duck() { hiss({ dur: 0.5, vol: 0.34, f: 400, f2: 1800, type: 'lowpass' }); tone({ f: 180, f2: 90, dur: 0.25, vol: 0.1 }); },
  dolphin(pan, vol) { hiss({ dur: 0.55, vol: 0.25 * vol, f: 1800, f2: 300, type: 'lowpass', pan }); tone({ f: 1900, f2: 2600, type: 'sine', dur: 0.12, vol: 0.03 * vol, delay: 0.05 }); },
  start() { [0, 4, 7, 12].forEach((s, i) => tone({ f: 587 * 2 ** (s / 12), type: 'triangle', dur: 0.2, vol: 0.12, delay: i * 0.06 })); },
};

/* --- Insel-Musik: Ukulele-Schlag, Bass, Shaker, Marimba (Tropen-Stimmung) --- */
const PROG = [[67, 71, 74, 78], [64, 67, 71, 74], [60, 64, 67, 71], [62, 66, 69, 72]], BASS = [43, 40, 36, 38], PENTA = [74, 76, 78, 79, 81, 83, 86], STEP = 60 / 90 / 4;
function newMotif() { motif = []; for (let i = 0; i < 32; i++) motif.push(Math.random() < (i % 4 === 0 ? 0.5 : 0.2) ? pick(PENTA) : 0); }
function pluck(m, t, v) {
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
  const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = mtof(m) * 1.004;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(650, t + 0.25);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  const g2 = ac.createGain(); g2.gain.value = 0.22;
  o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o2.start(t); o.stop(t + 0.55); o2.stop(t + 0.55);
}
function mallet(m, t, v) {
  const f = mtof(m);
  for (const [mul, vol, d] of [[1, v, 0.5], [4, v * 0.25, 0.12]]) {
    const o = ac.createOscillator(); o.frequency.value = f * mul;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d + 0.05);
  }
}
function bass(m, t, v) {
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.5);
}
function shaker(t, v) {
  const s = ac.createBufferSource(); s.buffer = noise;
  const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500;
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.08);
}
function schedule() {
  while (mNext < ac.currentTime + 0.15) {
    const s = mStep % 16, bar = Math.floor(mStep / 16) % 4, t = mNext;
    if (s === 0 || s === 4 || s === 6 || s === 10 || s === 12 || s === 14) {
      const up = s === 6 || s === 10 || s === 14, ch = up ? [...PROG[bar]].reverse() : PROG[bar];
      ch.forEach((m, i) => pluck(m, t + i * 0.013, s === 0 ? 0.06 : up ? 0.035 : 0.048));
    }
    if (s === 0 || s === 8 || s === 11) bass(BASS[bar], t, s === 0 ? 0.2 : 0.13);
    if (s % 2 === 0) shaker(t, s % 4 === 2 ? 0.045 : 0.022);
    const mi = (Math.floor(mStep / 16) % 2) * 16 + s;
    if (motif[mi]) mallet(motif[mi], t, 0.05);
    if (mStep % 128 === 127) newMotif();
    mNext += STEP * (s % 2 === 0 ? 1.1 : 0.9); mStep++;
  }
}
function startMusic() { if (!ac || mTimer) return; newMotif(); mNext = ac.currentTime + 0.08; mStep = 0; mTimer = setInterval(schedule, 30); }
function stopMusic() { if (mTimer) clearInterval(mTimer); mTimer = null; }
