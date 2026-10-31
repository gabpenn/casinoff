// Sonidos sintetizados en el momento (no hay archivos de audio).
import { store } from './util.js';

let ctx = null;
let master = null;
let enabled = store.get('sound', true);

function ensure() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.15, slide = 0, delay = 0 } = {}) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.1, freq = 2000, delay = 0, q = 0.7 } = {}) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    store.set('sound', enabled);
    if (enabled) this.click();
    return enabled;
  },
  unlock() { ensure(); },
  click() { tone(660, 0.06, { type: 'triangle', gain: 0.08 }); },
  chip() { tone(1200, 0.05, { type: 'square', gain: 0.05 }); noise(0.05, { gain: 0.08, freq: 4000 }); },
  tick() { tone(1800, 0.025, { type: 'square', gain: 0.03 }); },
  deal() { noise(0.12, { gain: 0.14, freq: 3000 }); },
  spin() { tone(180, 0.5, { type: 'sawtooth', gain: 0.05, slide: 260 }); },
  reelStop() { tone(140, 0.12, { type: 'triangle', gain: 0.2, slide: -60 }); noise(0.05, { gain: 0.1, freq: 1200 }); },
  win(level = 1) {
    const base = [523, 659, 784, 1047, 1319];
    const n = Math.min(base.length, 2 + level);
    for (let i = 0; i < n; i++) tone(base[i], 0.22, { type: 'triangle', gain: 0.14, delay: i * 0.08 });
  },
  bigWin() {
    [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.16, delay: i * 0.1 }));
    for (let i = 0; i < 14; i++) tone(1800 + Math.random() * 1500, 0.05, { type: 'square', gain: 0.04, delay: 0.2 + i * 0.07 });
  },
  lose() { tone(220, 0.25, { type: 'sine', gain: 0.1, slide: -90 }); },
  cash() { tone(880, 0.12, { type: 'triangle', gain: 0.15 }); tone(1320, 0.2, { type: 'triangle', gain: 0.15, delay: 0.1 }); },
  crash() { noise(0.5, { gain: 0.3, freq: 500, q: 0.4 }); tone(120, 0.5, { type: 'sawtooth', gain: 0.12, slide: -80 }); },
  boom() { noise(0.6, { gain: 0.4, freq: 300, q: 0.3 }); tone(90, 0.5, { type: 'sawtooth', gain: 0.2, slide: -60 }); },
  gem(step = 0) { tone(700 + step * 70, 0.15, { type: 'triangle', gain: 0.13 }); tone(1100 + step * 90, 0.18, { type: 'sine', gain: 0.08, delay: 0.07 }); },
  bonus() { [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.14, delay: i * 0.09 })); },
  bounce(i = 0) { tone(500 + (i % 5) * 60, 0.05, { type: 'sine', gain: 0.05 }); },
};
