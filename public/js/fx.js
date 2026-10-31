// Efectos visuales: lluvia de monedas, texto flotante y el cartel de "premio grande".
import { el, fmt, reduceMotion, sleep } from './util.js';
import { sfx } from './sfx.js';

const canvas = document.getElementById('fx');
const g = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;
let parts = [];
let running = false;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

const COLORS = ['#f7dc92', '#e8b94a', '#c98d25', '#ffffff', '#e66a52', '#7b5ed8', '#3fe0a0'];

function loop() {
  g.clearRect(0, 0, W, H);
  for (const p of parts) {
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life--;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.globalAlpha = Math.max(0, Math.min(1, p.life / 25));
    g.fillStyle = p.color;
    if (p.coin) {
      g.scale(1, Math.abs(Math.cos(p.rot * 2)) * 0.8 + 0.2);
      g.beginPath();
      g.arc(0, 0, p.size, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(120,80,0,.7)';
      g.stroke();
    } else g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
    g.restore();
  }
  parts = parts.filter((p) => p.life > 0 && p.y < H + 40);
  if (parts.length) requestAnimationFrame(loop);
  else {
    running = false;
    g.clearRect(0, 0, W, H);
  }
}

function start() {
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

export const fx = {
  /** Explosión de monedas/papelitos desde un punto */
  burst(x, y, count = 40, { power = 9, coin = true } = {}) {
    if (reduceMotion()) count = Math.min(count, 8);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * power + 2;
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * 0.6, g: 0.28, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        size: coin ? 6 + Math.random() * 5 : 6 + Math.random() * 6, color: COLORS[(Math.random() * COLORS.length) | 0], life: 70 + Math.random() * 50, coin,
      });
    }
    start();
  },
  /** Lluvia desde arriba */
  rain(count = 120) {
    if (reduceMotion()) count = 10;
    for (let i = 0; i < count; i++) {
      parts.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4, g: 0.12,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, size: 7 + Math.random() * 6, color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 160 + Math.random() * 80, coin: Math.random() < 0.65,
      });
    }
    start();
  },
  /** Texto que sube y se desvanece, pegado a un elemento */
  float(text, target, cls = 'win') {
    const r = (target?.getBoundingClientRect?.() ?? { left: W / 2, top: H / 2, width: 0 });
    const t = el('div', { class: `floaty ${cls}`, style: { left: r.left + r.width / 2 + 'px', top: r.top + 'px' } }, text);
    t.style.transform = 'translateX(-50%)';
    document.body.append(t);
    setTimeout(() => t.remove(), 1500);
  },
  /** Cartel grande según cuántas veces se multiplicó la apuesta */
  async win(amount, bet) {
    const mult = amount / bet;
    if (mult < 2) {
      sfx.win(1);
      return;
    }
    if (mult < 10) {
      sfx.win(Math.min(4, Math.ceil(mult / 2)));
      this.burst(W / 2, H * 0.55, 30 + mult * 3);
      return;
    }
    const title = mult >= 200 ? 'PREMIAZO' : mult >= 50 ? 'MEGA PREMIO' : 'GRAN PREMIO';
    const box = el('div', { class: 'bigwin', role: 'status' }, el('div', { class: 'in' }, el('h2', {}, title), el('b', {}, '+' + fmt(amount))));
    document.body.append(box);
    sfx.bigWin();
    this.rain(mult >= 50 ? 220 : 120);
    this.burst(W / 2, H / 2, 60, { power: 12 });
    await sleep(mult >= 50 ? 3200 : 2300);
    box.classList.add('out');
    await sleep(500);
    box.remove();
  },
};
