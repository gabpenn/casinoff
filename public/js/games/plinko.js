// Plinko: la bolita baja rebotando por las clavijas y cae en un casillero con multiplicador.
import { el, fmt, fmtMult } from '../util.js';
import { betControl, seg, toast } from '../ui.js';

const SEG_MS = 150; // duración de cada rebote

function binColor(m) {
  if (m < 1) return '#1b6f86';
  if (m < 2) return '#2f9a86';
  if (m < 5) return '#d8a537';
  if (m < 30) return '#e0692f';
  return '#c1283c';
}

export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  const cfg = ctx.config.plinko;
  let alive = true;
  let rows = 12;
  let risk = 'medium';
  let balls = [];
  let flashes = new Map(); // "i:j" -> hasta cuándo brilla
  let pops = new Map(); // casillero -> hasta cuándo "salta"
  let autoOn = false;
  let autoTimer = 0;
  let raf = 0;
  let G = null; // geometría

  const canvas = el('canvas', { 'aria-label': 'Tablero de Plinko' });
  const wrap = el('div', { class: 'plinko-box' }, canvas);
  const bet = betControl({ game: 'plinko', min: ctx.config.minBet, max: ctx.config.maxBet, start: 100 });
  const rowsSeg = seg(cfg.rows.map((r) => ({ value: r, label: String(r) })), rows, (v) => { rows = Number(v); layout(); });
  const riskSeg = seg([{ value: 'low', label: 'Bajo' }, { value: 'medium', label: 'Medio' }, { value: 'high', label: 'Alto' }], risk, (v) => { risk = v; });
  const dropBtn = el('button', { class: 'btn primary big', onclick: () => drop() }, 'Soltar bolita');
  const autoBtn = el('button', { class: 'btn', onclick: toggleAuto }, 'Auto: no');
  const info = el('div', { class: 'result-line' });
  const recent = el('div', { class: 'hist', style: { marginTop: '10px' } });

  function layout() {
    const W = Math.max(280, canvas.clientWidth || wrap.clientWidth - 20 || 600);
    const dx = W / (rows + 2);
    const dy = Math.min(dx * 0.9, 38);
    const top = 34;
    const binsH = Math.max(22, Math.min(34, dx * 0.9));
    const H = top + (rows - 1) * dy + 36 + binsH + 8;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    G = { W, H, dx, dy, top, binsH, dpr, cx: W / 2, binsY: top + (rows - 1) * dy + 36 };
  }

  const pegPos = (i, j) => [G.cx + (j - i / 2) * G.dx, G.top + i * G.dy];
  const binX = (k) => G.cx + (k - rows / 2) * G.dx;

  /** Posición de una bolita según el tiempo */
  function ballPos(b, now) {
    const t = now - b.t0;
    const r = Math.max(4, G.dx * 0.17);
    // tramo 0: caída inicial hasta la primera clavija
    const intro = 200;
    const [x0, y0] = pegPos(0, 0);
    if (t < intro) {
      const k = t / intro;
      return { x: G.cx, y: (y0 - r - 4 - G.dy * 1.1) + (G.dy * 1.1) * k * k, seg: -1 };
    }
    const sIdx = Math.floor((t - intro) / SEG_MS);
    if (sIdx >= rows) return { x: binX(b.bin), y: G.binsY + G.binsH * 0.5, seg: rows, landed: true };
    const k = ((t - intro) % SEG_MS) / SEG_MS;
    // k_i = cantidad de derechas antes de la fila sIdx
    let ki = 0;
    for (let i = 0; i < sIdx; i++) ki += b.path[i];
    const kn = ki + b.path[sIdx];
    const [ax, ay] = pegPos(sIdx, ki);
    let bx, by;
    if (sIdx === rows - 1) { bx = binX(kn); by = G.binsY + 6; }
    else [bx, by] = pegPos(sIdx + 1, kn);
    const lift = r + 4;
    const x = ax + (bx - ax) * k;
    const y = ay - lift + (by - lift - (ay - lift)) * k - Math.sin(Math.PI * k) * G.dy * 0.38;
    return { x, y, seg: sIdx, peg: [sIdx, ki] };
  }

  function draw(now) {
    const g = canvas.getContext('2d');
    g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    g.clearRect(0, 0, G.W, G.H);
    const pegR = Math.max(2.4, G.dx * 0.07);

    // casilleros
    const table = cfg.tables[rows][risk];
    const bw = G.dx * 0.88;
    table.forEach((m, k) => {
      const pop = Math.max(0, (pops.get(k) ?? 0) - now);
      const x = binX(k) - bw / 2;
      const y = G.binsY + (pop > 0 ? -Math.sin((pop / 450) * Math.PI) * 8 : 0);
      g.fillStyle = binColor(m);
      g.beginPath(); g.roundRect(x, y, bw, G.binsH, 6); g.fill();
      if (pop > 0) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
      g.fillStyle = '#fff';
      g.font = `800 ${Math.max(9, Math.min(13, G.dx * 0.36))}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(m >= 100 ? String(Math.round(m)) : String(m), x + bw / 2, y + G.binsH / 2 + 1);
    });

    // clavijas
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j <= i; j++) {
        const [x, y] = pegPos(i, j);
        const f = (flashes.get(`${i}:${j}`) ?? 0) - now;
        g.fillStyle = f > 0 ? '#f7dc92' : '#dbe9ee';
        g.shadowColor = '#f7dc92';
        g.shadowBlur = f > 0 ? 14 : 0;
        g.beginPath(); g.arc(x, y, f > 0 ? pegR * 1.7 : pegR, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }
    }

    // bolitas
    const r = Math.max(4, G.dx * 0.17);
    for (const b of balls) {
      const p = ballPos(b, now);
      if (p.seg !== b.lastSeg) {
        b.lastSeg = p.seg;
        if (p.seg >= 0 && p.seg < rows) { flashes.set(`${p.peg[0]}:${p.peg[1]}`, now + 220); sfx.bounce(p.seg); }
      }
      if (p.landed && !b.done) land(b, now);
      const grd = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 1, p.x, p.y, r);
      grd.addColorStop(0, '#fff3c4'); grd.addColorStop(1, '#d99a1e');
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.beginPath(); g.arc(p.x + 2, p.y + 3, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = grd;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    }
    balls = balls.filter((b) => !(b.done && now - b.doneAt > 120));
  }

  function land(b, now) {
    b.done = true;
    b.doneAt = now;
    pops.set(b.bin, now + 450);
    b.pay.reveal();
    const label = fmtMult(b.mult);
    recent.prepend(el('span', { class: b.mult >= 1 ? 'green' : 'black', style: { width: 'auto', padding: '0 10px', borderRadius: '999px', background: binColor(b.mult) } }, label));
    while (recent.children.length > 12) recent.lastChild.remove();
    if (b.payout > b.bet) {
      info.innerHTML = `<span class="win">${label} → +${fmt(b.payout - b.bet)}</span>`;
      fx.win(b.payout, b.bet);
    } else {
      info.innerHTML = `<span class="${b.payout === b.bet ? '' : 'lose'}">${label} → ${b.payout - b.bet >= 0 ? '+' : ''}${fmt(b.payout - b.bet)}</span>`;
      sfx.tick();
    }
    if (balls.every((x) => x.done)) setLock(false);
  }

  function setLock(b) {
    rowsSeg.disable(b);
    riskSeg.disable(b);
  }

  async function drop() {
    const amount = bet.value;
    if (wallet.display < amount) {
      stopAuto();
      return toast('No te alcanzan las fichas para esa apuesta.', 'error');
    }
    try {
      const res = await api.post('/plinko/drop', { bet: amount, rows, risk });
      const pay = wallet.settle(res.balance, res.payout);
      setLock(true);
      sfx.click();
      balls.push({ path: res.path, bin: res.bin, mult: res.multiplier, payout: res.payout, bet: res.bet, pay, t0: performance.now(), done: false, lastSeg: -2 });
    } catch (e) {
      toast(e.message, 'error');
      stopAuto();
    }
  }

  function stopAuto() {
    autoOn = false;
    clearInterval(autoTimer);
    autoBtn.textContent = 'Auto: no';
  }
  function toggleAuto() {
    sfx.click();
    if (autoOn) return stopAuto();
    autoOn = true;
    autoBtn.textContent = 'Auto: sí (parar)';
    drop();
    autoTimer = setInterval(() => { if (balls.length < 4) drop(); }, 650);
  }

  function frame(now) {
    if (!alive) return;
    if (G) draw(now);
    raf = requestAnimationFrame(frame);
  }

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Plinko'), el('p', {}, 'Soltá la bolita: en cada clavija va a la izquierda o a la derecha. Más riesgo = los extremos pagan muchísimo más y el centro menos.')),
    el('div', { class: 'layout' },
      el('div', {}, wrap, recent),
      el('div', { class: 'side' },
        el('div', { class: 'panel' },
          bet.el, el('div', { style: { height: '10px' } }),
          el('div', { class: 'field' }, el('span', {}, 'Filas'), rowsSeg.el),
          el('div', { style: { height: '8px' } }),
          el('div', { class: 'field' }, el('span', {}, 'Riesgo'), riskSeg.el),
          el('div', { style: { height: '12px' } }),
          dropBtn, el('div', { style: { height: '8px' } }), autoBtn, info)),
    ),
  );
  layout();
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => { if (!balls.length) layout(); });
  ro.observe(wrap);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    clearInterval(autoTimer);
    ro.disconnect();
  };
}
