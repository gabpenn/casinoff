// Ruleta europea: rueda animada + mesa de apuestas con todas las jugadas (pleno, caballo, calle, cuadro, línea, docenas, columnas, rojo/negro...).
import { el, fmt, short, sleep } from '../util.js';
import { toast } from '../ui.js';

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const DENOMS = [10, 50, 100, 500, 1000, 5000];
const STEP = (Math.PI * 2) / 37;
const U = 56; // tamaño de cada casillero del tablero (px)
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const keyOf = (d) => [d.type, d.n ?? '', d.a ?? '', d.b ?? ''].join(':');
const chipFor = (amount) => [...DENOMS].reverse().find((d) => d <= amount) ?? 10;

// ---------------------------------------------------------------- La rueda
function createWheel(canvas, onTick) {
  const g = canvas.getContext('2d');
  let S = 360;
  let angle = 0;
  let ball = null; // { phiEnd, turns, t0, ms, resolve }
  let rest = null; // pocket index donde descansa la bolita
  let raf = 0;
  let last = performance.now();
  let lastSlot = 0;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    S = canvas.clientWidth || 360;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawStatic(R) {
    // aro de madera
    let grd = g.createRadialGradient(0, 0, R * 0.8, 0, 0, R);
    grd.addColorStop(0, '#6b4520');
    grd.addColorStop(1, '#2a180a');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#cfae5a'; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, R - 2, 0, Math.PI * 2); g.stroke();
    // pista de la bolita
    grd = g.createRadialGradient(0, 0, R * 0.78, 0, 0, R * 0.9);
    grd.addColorStop(0, '#0b2c3a'); grd.addColorStop(1, '#154a5e');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, R * 0.9, 0, Math.PI * 2); g.fill();
  }

  function drawWheel(R) {
    const r0 = R * 0.5;
    const r1 = R * 0.78;
    g.save();
    g.rotate(angle);
    for (let i = 0; i < 37; i++) {
      const a0 = -Math.PI / 2 + i * STEP;
      const n = WHEEL[i];
      g.beginPath();
      g.arc(0, 0, r1, a0, a0 + STEP);
      g.arc(0, 0, r0, a0 + STEP, a0, true);
      g.closePath();
      g.fillStyle = n === 0 ? '#0b7a4b' : RED.has(n) ? '#b3202a' : '#12161a';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.stroke();
      g.save();
      g.rotate(a0 + STEP / 2);
      g.translate(R * 0.7, 0);
      g.rotate(Math.PI / 2);
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(R * 0.075)}px Georgia, serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, 0);
      g.restore();
    }
    // cono central
    const grd = g.createRadialGradient(0, 0, R * 0.05, 0, 0, r0);
    grd.addColorStop(0, '#e8c668'); grd.addColorStop(0.5, '#8a6a22'); grd.addColorStop(1, '#3d2a0c');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, r0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#cfae5a'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#f7dc92'; g.lineWidth = 5; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      g.save(); g.rotate((k * Math.PI) / 2);
      g.beginPath(); g.moveTo(R * 0.1, 0); g.lineTo(R * 0.4, 0); g.stroke();
      g.fillStyle = '#f7dc92'; g.beginPath(); g.arc(R * 0.4, 0, 5, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.fillStyle = '#f7dc92';
    g.beginPath(); g.arc(0, 0, R * 0.09, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawBall(R, phi, r) {
    const a = angle + phi;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.arc(x + 2, y + 3, R * 0.035, 0, Math.PI * 2); g.fill();
    const grd = g.createRadialGradient(x - 2, y - 2, 1, x, y, R * 0.04);
    grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#b9c4c8');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, R * 0.036, 0, Math.PI * 2); g.fill();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    angle += dt * 0.55;
    const R = S / 2 - 4;
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(S / 2, S / 2);
    drawStatic(R);
    drawWheel(R);
    const Rt = R * 0.835;
    const Rp = R * 0.645;
    if (ball) {
      const t = Math.min(1, (now - ball.t0) / ball.ms);
      const ease = 1 - (1 - t) ** 3.2;
      const phi = ball.phiEnd + ball.turns * Math.PI * 2 * (1 - ease);
      const s = Math.max(0, Math.min(1, (t - 0.55) / 0.45));
      const e = 1 - (1 - s) ** 2;
      const bounce = s > 0.55 ? (1 - s) * R * 0.05 * Math.sin(s * 46) : 0;
      const r = Rt + (Rp - Rt) * e + bounce;
      drawBall(R, phi, r);
      const slot = Math.floor(phi / STEP);
      if (slot !== lastSlot) { lastSlot = slot; if (t < 0.97) onTick?.(); }
      if (t >= 1) {
        rest = ball.index;
        const done = ball.resolve;
        ball = null;
        done?.();
      }
    } else if (rest != null) {
      drawBall(R, -Math.PI / 2 + (rest + 0.5) * STEP, Rp);
    }
    g.restore();
    raf = requestAnimationFrame(frame);
  }

  resize();
  raf = requestAnimationFrame(frame);
  return {
    resize,
    destroy: () => cancelAnimationFrame(raf),
    clearBall() { rest = null; },
    spinTo(number, ms = 6200) {
      const index = WHEEL.indexOf(number);
      rest = null;
      return new Promise((resolve) => {
        ball = { index, phiEnd: -Math.PI / 2 + (index + 0.5) * STEP, turns: 5 + Math.random() * 1.5, t0: performance.now(), ms, resolve };
      });
    },
  };
}

// ---------------------------------------------------------------- Pantalla
export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  const maxBet = ctx.config.maxBet;
  let chip = 100;
  let busy = false;
  let lastBets = [];
  const bets = new Map(); // key -> { desc, numbers, amount, cx, cy }
  const undo = [];
  const regions = new Map(); // key -> { desc, numbers, cx, cy }
  const cellEls = new Map(); // número -> elemento

  // ----- Tablero
  const board = el('div', { class: 'board', style: { width: 14 * U + 'px', height: 5 * U + 'px' } });
  const boardBox = el('div', { class: 'board-box' }, board);
  const boardScroll = el('div', { class: 'board-scroll' }, boardBox);

  function highlight(numbers, on) {
    for (const n of numbers) cellEls.get(n)?.classList.toggle('hl', on);
  }

  function addRegion({ desc, numbers, x, y, w, h, label, cls, spot }) {
    const key = keyOf(desc);
    const cx = x + w / 2;
    const cy = y + h / 2;
    regions.set(key, { desc, numbers, cx, cy });
    const b = el('button', {
      type: 'button', class: spot ? 'spot' : `cell ${cls ?? ''}`, 'aria-label': label ?? key,
      style: { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' },
      onclick: () => place(key),
      oncontextmenu: (e) => { e.preventDefault(); removeAt(key); },
      onmouseenter: () => highlight(numbers, true),
      onmouseleave: () => highlight(numbers, false),
    }, spot ? null : label);
    board.append(b);
    return b;
  }

  // zero
  cellEls.set(0, addRegion({ desc: { type: 'straight', n: 0 }, numbers: [0], x: 0, y: 0, w: U, h: 3 * U, label: '0', cls: 'zero' }));
  // números 1..36
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const n = 3 * c + (3 - r);
      cellEls.set(n, addRegion({ desc: { type: 'straight', n }, numbers: [n], x: U * (1 + c), y: U * r, w: U, h: U, label: String(n), cls: colorOf(n) }));
    }
  }
  // columnas 2:1
  [3, 2, 1].forEach((n, r) => addRegion({ desc: { type: 'column', n }, numbers: range(1, 36).filter((x) => x % 3 === n % 3), x: U * 13, y: U * r, w: U, h: U, label: '2:1', cls: 'out' }));
  // docenas
  ['1ª docena', '2ª docena', '3ª docena'].forEach((label, d) => addRegion({ desc: { type: 'dozen', n: d + 1 }, numbers: range(d * 12 + 1, d * 12 + 12), x: U * (1 + 4 * d), y: 3 * U, w: 4 * U, h: U, label, cls: 'out' }));
  // chances simples
  [['low', '1-18', range(1, 18), ''], ['even', 'Par', range(1, 36).filter((x) => x % 2 === 0), ''], ['red', 'Rojo', [...RED], 'red'], ['black', 'Negro', range(1, 36).filter((x) => !RED.has(x)), 'black'], ['odd', 'Impar', range(1, 36).filter((x) => x % 2 === 1), ''], ['high', '19-36', range(19, 36), '']]
    .forEach(([type, label, numbers, cls], i) => addRegion({ desc: { type }, numbers, x: U * (1 + 2 * i), y: 4 * U, w: 2 * U, h: U, label, cls: `out ${cls}` }));

  // zonas finas: caballos, calles, cuadros, líneas
  const spot = (desc, numbers, cx, cy, w, h, label) => addRegion({ desc, numbers, x: cx - w / 2, y: cy - h / 2, w, h, label, spot: true });
  for (let r = 0; r < 3; r++) spot({ type: 'split', a: 0, b: 3 - r }, [0, 3 - r], U, U * r + U / 2, 18, 30, `Caballo 0 y ${3 - r}`);
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const n = 3 * c + (3 - r);
      if (c < 11) spot({ type: 'split', a: n, b: n + 3 }, [n, n + 3], U * (2 + c), U * r + U / 2, 18, 30, `Caballo ${n} y ${n + 3}`);
      if (r < 2) spot({ type: 'split', a: n - 1, b: n }, [n - 1, n], U * (1 + c) + U / 2, U * (r + 1), 30, 18, `Caballo ${n - 1} y ${n}`);
      if (c < 11 && r < 2) {
        const bl = 3 * c + 2 - r;
        spot({ type: 'corner', n: bl }, [bl, bl + 1, bl + 3, bl + 4], U * (2 + c), U * (r + 1), 20, 20, `Cuadro ${bl}, ${bl + 1}, ${bl + 3}, ${bl + 4}`);
      }
    }
    const s = 3 * c + 1;
    spot({ type: 'street', n: s }, [s, s + 1, s + 2], U * (1 + c) + U / 2, 3 * U, 30, 16, `Calle ${s}-${s + 2}`);
    if (c < 11) spot({ type: 'line', n: s }, range(s, s + 5), U * (2 + c), 3 * U, 20, 16, `Línea ${s}-${s + 5}`);
  }

  // ----- Apuestas
  const total = () => [...bets.values()].reduce((s, b) => s + b.amount, 0);

  function renderStacks() {
    board.querySelectorAll('.stack').forEach((n) => n.remove());
    for (const [key, b] of bets) {
      board.append(el('div', { class: 'stack', 'data-key': key, style: { left: b.cx + 'px', top: b.cy + 'px' } },
        el('div', { class: 'chip mini', 'data-v': chipFor(b.amount) }, el('span', {}, short(b.amount)))));
    }
    totalEl.textContent = fmt(total());
    spinBtn.disabled = busy || bets.size === 0;
    [undoBtn, clearBtn, doubleBtn].forEach((b) => (b.disabled = busy || bets.size === 0));
    repeatBtn.disabled = busy || lastBets.length === 0;
  }

  function addAmount(key, amount, record = true) {
    const reg = regions.get(key);
    if (!reg) return false;
    if (total() + amount > wallet.display) { toast('No te alcanzan las fichas para esa apuesta.', 'error'); return false; }
    const cur = bets.get(key);
    if ((cur?.amount ?? 0) + amount > maxBet) { toast(`El máximo por apuesta es ${fmt(maxBet)}.`, 'error'); return false; }
    if (cur) cur.amount += amount;
    else bets.set(key, { desc: reg.desc, numbers: reg.numbers, amount, cx: reg.cx, cy: reg.cy });
    if (record) undo.push({ key, amount });
    return true;
  }

  function place(key) {
    if (busy) return;
    if (addAmount(key, chip)) { sfx.chip(); renderStacks(); }
  }
  function removeAt(key) {
    if (busy || !bets.has(key)) return;
    bets.delete(key);
    for (let i = undo.length - 1; i >= 0; i--) if (undo[i].key === key) undo.splice(i, 1);
    sfx.click(); renderStacks();
  }
  function undoLast() {
    const u = undo.pop();
    if (!u) return;
    const b = bets.get(u.key);
    if (b) { b.amount -= u.amount; if (b.amount <= 0) bets.delete(u.key); }
    sfx.click(); renderStacks();
  }
  function clearAll() { bets.clear(); undo.length = 0; renderStacks(); }
  function repeat() {
    clearAll();
    let ok = true;
    for (const b of lastBets) ok = addAmount(keyOf(b), b.amount) && ok;
    if (!ok) toast('No alcanzan las fichas para repetir todo: se pusieron las que se pudo.', 'error');
    sfx.chip(); renderStacks();
  }
  function doubleAll() {
    const need = total();
    if (need * 2 > wallet.display) return toast('No te alcanzan las fichas para duplicar.', 'error');
    for (const [key, b] of [...bets]) addAmount(key, b.amount);
    sfx.chip(); renderStacks();
  }

  // ----- Panel lateral
  const chipBtns = DENOMS.map((v) => el('button', {
    type: 'button', class: 'chip', 'data-v': v, 'aria-pressed': String(v === chip), 'aria-label': `Ficha de ${v}`,
    onclick: () => { chip = v; chipBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === chip))); sfx.click(); },
  }, el('span', {}, short(v))));
  const totalEl = el('b', {}, '0');
  const resultEl = el('div', { class: 'result-line' }, 'Elegí una ficha y tocá la mesa.');
  const undoBtn = el('button', { class: 'btn small', onclick: undoLast }, 'Deshacer');
  const clearBtn = el('button', { class: 'btn small', onclick: () => { sfx.click(); clearAll(); } }, 'Borrar todo');
  const repeatBtn = el('button', { class: 'btn small', onclick: repeat }, 'Repetir');
  const doubleBtn = el('button', { class: 'btn small', onclick: doubleAll }, 'Duplicar');
  const spinBtn = el('button', { class: 'btn primary big', onclick: spin }, 'Girar');

  // ----- Rueda y resultados
  const canvas = el('canvas', { 'aria-label': 'Rueda de la ruleta' });
  const badge = el('div', { class: 'result-badge' });
  const hist = el('div', { class: 'hist', 'aria-label': 'Últimos números' });
  const wheel = createWheel(canvas, () => sfx.tick());
  const ro = new ResizeObserver(() => { wheel.resize(); fit(); });
  ro.observe(canvas);

  function fit() {
    const avail = boardScroll.clientWidth || 14 * U;
    const scale = Math.max(0.62, Math.min(1, avail / (14 * U + 10)));
    boardBox.style.transform = `scale(${scale})`;
    boardBox.style.width = 14 * U + 6 + 'px';
    boardBox.style.height = 5 * U + 6 + 'px';
    boardScroll.style.height = (5 * U + 6) * scale + 12 + 'px';
  }

  function pushHistory(n) {
    hist.prepend(el('span', { class: colorOf(n) }, String(n)));
    while (hist.children.length > 14) hist.lastChild.remove();
  }

  async function spin() {
    if (busy || bets.size === 0) return;
    busy = true;
    const list = [...bets.values()].map((b) => ({ ...b.desc, amount: b.amount }));
    renderStacks();
    let res;
    try {
      res = await api.post('/roulette/spin', { bets: list });
    } catch (e) {
      toast(e.message, 'error');
      busy = false; renderStacks();
      return;
    }
    const pay = wallet.settle(res.balance, res.payout);
    lastBets = list;
    badge.classList.remove('show');
    resultEl.textContent = 'La bolita está girando...';
    sfx.spin();
    await wheel.spinTo(res.number);

    badge.className = `result-badge ${res.color} show`;
    badge.textContent = res.number;
    cellEls.get(res.number)?.classList.add('hit');
    pushHistory(res.number);
    for (const w of res.wins) board.querySelector(`.stack[data-key="${keyOf(w)}"]`)?.classList.add('win');
    const colorName = { red: 'rojo', black: 'negro', green: 'verde' }[res.color];
    if (res.payout > 0) {
      resultEl.innerHTML = `Salió el <b>${res.number}</b> ${colorName}. <span class="win">Cobrás ${fmt(res.payout)}</span> (${res.net >= 0 ? '+' : ''}${fmt(res.net)})`;
      pay.reveal();
      fx.win(res.payout, res.bet);
    } else {
      resultEl.innerHTML = `Salió el <b>${res.number}</b> ${colorName}. <span class="lose">No hubo suerte esta vez.</span>`;
      sfx.lose();
    }
    await sleep(2200);
    cellEls.get(res.number)?.classList.remove('hit');
    clearAll();
    busy = false;
    renderStacks();
  }

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Ruleta'), el('p', {}, 'Un solo cero. Paga 35 a 1 al número, 2 a 1 a docenas y columnas, 1 a 1 a rojo/negro, par/impar y bajo/alto. Clic derecho en una ficha la saca.')),
    el('div', { class: 'layout' },
      el('div', {},
        el('div', { class: 'panel' },
          el('div', { class: 'roulette-stage' }, el('div', { class: 'wheel-wrap' }, canvas, badge), el('div', {}, el('h3', {}, 'Últimos números'), hist, el('p', { class: 'muted', style: { marginTop: '12px', maxWidth: '34ch' } }, 'Elegí una ficha y tocá la mesa. Tocando entre dos números apostás a los dos; en la esquina, a cuatro. Clic derecho saca la apuesta.')))),
        el('div', { style: { height: '14px' } }),
        el('div', { class: 'panel' }, boardScroll)),
      el('div', { class: 'side' },
        el('div', { class: 'panel' },
          el('h3', {}, 'Tu ficha'),
          el('div', { class: 'chip-row' }, chipBtns),
          el('div', { class: 'tools' }, undoBtn, clearBtn, repeatBtn, doubleBtn),
          el('div', { class: 'stat', style: { margin: '12px 0' } }, el('small', {}, 'Total en la mesa'), totalEl),
          spinBtn,
          resultEl)),
    ),
  );
  fit();
  renderStacks();
  const onResize = () => fit();
  window.addEventListener('resize', onResize);

  return () => {
    wheel.destroy();
    ro.disconnect();
    window.removeEventListener('resize', onResize);
  };
}
