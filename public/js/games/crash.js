// Crash: el multiplicador sube hasta que se cae. Retirate a tiempo.
import { el, fmt, fmtMult, store, sleep } from '../util.js';
import { betControl, toast } from '../ui.js';

const RATE = 0.1; // igual que en el servidor: m(t) = e^(0.1 t)
const multAt = (ms) => Math.floor(100 * Math.exp((RATE * ms) / 1000)) / 100;
const timeFor = (m) => (Math.log(m) / RATE) * 1000;

export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  let alive = true;
  let phase = 'idle'; // idle | running (apostando) | ghost (ya te retiraste, la curva sigue) | crashed
  let round = null; // { startedAt, offset, bet, auto, crashPoint }
  let poll = 0;
  let raf = 0;
  let flash = 0;
  let readText = '';

  // ----- Pantalla
  const canvas = el('canvas', { 'aria-label': 'Gráfico del multiplicador' });
  const readB = el('b', {}, '1.00x');
  const readS = el('span', {}, 'Hacé tu apuesta');
  const read = el('div', { class: 'crash-read', 'aria-live': 'polite' }, readB, readS);
  const box = el('div', { class: 'crash-box' }, canvas, read);
  const recent = el('div', { class: 'recent', 'aria-label': 'Últimas caídas' });

  const bet = betControl({ game: 'crash', min: ctx.config.minBet, max: ctx.config.maxBet, start: 100 });
  const auto = el('input', { type: 'number', min: 1.01, step: 0.01, placeholder: 'Ej: 2.00 (opcional)', value: store.get('crash.auto', ''), 'aria-label': 'Retiro automático' });
  auto.addEventListener('change', () => store.set('crash.auto', auto.value));
  const mainBtn = el('button', { class: 'btn primary big', onclick: onMain }, 'Apostar');
  const info = el('div', { class: 'result-line' });

  function paintRecent(list) {
    recent.replaceChildren(...list.slice(0, 18).map((x) => el('span', { class: x < 2 ? 'lo' : x < 10 ? 'mid' : 'hi' }, fmtMult(x))));
  }

  const serverNow = () => Date.now() + (round?.offset ?? 0);
  const elapsed = () => (round ? Math.max(0, serverNow() - round.startedAt) : 0);

  function setRead(text, status, cls = '') {
    if (readB.textContent !== text) readB.textContent = text;
    readS.textContent = status;
    read.className = `crash-read ${cls}`;
  }

  function setButton() {
    if (phase === 'running') {
      mainBtn.className = 'btn good big';
      mainBtn.disabled = false;
      const m = multAt(elapsed());
      mainBtn.textContent = `Retirar ${fmt(round.bet * m)}`;
    } else {
      mainBtn.className = 'btn primary big';
      mainBtn.textContent = 'Apostar';
      mainBtn.disabled = !(phase === 'idle' || phase === 'crashed');
    }
  }

  // ----- Dibujo
  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const padL = 44, padB = 26, padT = 14, padR = 14;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const ms = phase === 'idle' ? 0 : elapsed();
    let mNow = Math.exp((RATE * ms) / 1000);
    if (phase === 'crashed' && round?.crashPoint) mNow = round.crashPoint;
    else if (round?.crashPoint && mNow > round.crashPoint) mNow = round.crashPoint;
    const tNow = Math.log(Math.max(1, mNow)) / RATE;
    const tMax = Math.max(8, tNow * 1.12);
    const mMax = Math.max(2, mNow * 1.18);
    const X = (t) => padL + (t / tMax) * pw;
    const Y = (m) => padT + ph - ((m - 1) / (mMax - 1)) * ph;

    // cuadrícula
    g.lineWidth = 1;
    g.font = '12px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const rough = (mMax - 1) / 4;
    const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000].find((s) => s >= rough) ?? 1000;
    for (let m = 1; m <= mMax; m += nice) {
      g.strokeStyle = 'rgba(141,176,191,.14)';
      g.beginPath(); g.moveTo(padL, Y(m)); g.lineTo(W - padR, Y(m)); g.stroke();
      g.fillStyle = '#8db0bf';
      g.textAlign = 'right';
      g.fillText(m.toFixed(m < 10 && nice < 1 ? 2 : 0) + 'x', padL - 6, Y(m));
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (let t = 0; t <= tMax; t += tMax > 40 ? 10 : 2) g.fillText(t + 's', X(t), H - 8);

    if (phase === 'idle') return;

    const color = phase === 'crashed' ? '#ff6f6f' : phase === 'ghost' ? '#8db0bf' : '#e8b94a';
    const pts = [];
    const stepT = Math.max(0.05, tNow / 400);
    for (let t = 0; t < tNow; t += stepT) pts.push([X(t), Y(Math.exp(RATE * t))]);
    pts.push([X(tNow), Y(Math.exp(RATE * tNow))]);

    g.beginPath();
    g.moveTo(pts[0][0], H - padB);
    pts.forEach(([x, y]) => g.lineTo(x, y));
    g.lineTo(pts.at(-1)[0], H - padB);
    g.closePath();
    const fill = g.createLinearGradient(0, padT, 0, H - padB);
    fill.addColorStop(0, color + '55');
    fill.addColorStop(1, color + '00');
    g.fillStyle = fill;
    g.fill();

    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.shadowColor = color;
    g.shadowBlur = phase === 'crashed' ? 0 : 14;
    g.stroke();
    g.shadowBlur = 0;

    const [tx, ty] = pts.at(-1);
    if (phase !== 'crashed') {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(tx, ty, 6, 0, Math.PI * 2); g.fill();
    }
    draw.tip = [tx, ty];
  }

  function frame() {
    if (!alive) return;
    if (phase === 'running') {
      const m = multAt(elapsed());
      setRead(m.toFixed(2) + 'x', round.auto ? `Retiro automático en ${round.auto.toFixed(2)}x` : 'Apretá Retirar antes de que se caiga');
      setButton();
    } else if (phase === 'ghost') {
      const el_ = elapsed();
      const m = Math.min(multAt(el_), round.crashPoint);
      setRead(m.toFixed(2) + 'x', info.dataset.cash || 'Ya te retiraste', 'cashed');
      if (el_ >= timeFor(round.crashPoint + 0.01)) crashed();
    }
    draw();
    box.style.boxShadow = flash > 0 ? `inset 0 0 ${flash * 120}px rgba(255,80,80,${flash * 0.7})` : '';
    if (flash > 0) flash = Math.max(0, flash - 0.03);
    raf = requestAnimationFrame(frame);
  }

  function crashed() {
    phase = 'crashed';
    clearInterval(poll);
    setRead(round.crashPoint.toFixed(2) + 'x', '¡Se cayó!', 'crashed');
    sfx.crash();
    flash = 1;
    const r = canvas.getBoundingClientRect();
    const [x, y] = draw.tip ?? [r.width / 2, r.height / 2];
    fx.burst(r.left + x, r.top + y, 26, { coin: false, power: 8 });
    if (pendingRecent) paintRecent(pendingRecent);
    pendingRecent = null;
    bet.disable(false);
    setButton();
  }

  let pendingRecent = null; // las últimas caídas se muestran recién cuando termina la curva

  // ----- Flujo
  async function onMain() {
    if (phase === 'running') return cashout();
    if (phase === 'crashed' || phase === 'idle') return start();
  }

  async function start() {
    const amount = bet.value;
    if (wallet.display < amount) return toast('No te alcanzan las fichas para esa apuesta.', 'error');
    const a = auto.value === '' ? null : Number(auto.value);
    if (a != null && (!(a >= 1.01) || a > 10000)) return toast('El retiro automático tiene que ser de 1.01 en adelante.', 'error');
    mainBtn.disabled = true;
    bet.disable(true);
    info.textContent = '';
    info.dataset.cash = '';
    try {
      const t0 = Date.now();
      const r = await api.post('/crash/bet', { bet: amount, auto: a });
      const t1 = Date.now();
      round = { startedAt: r.startedAt, offset: r.serverNow - (t0 + t1) / 2, bet: amount, auto: r.auto, crashPoint: null };
      wallet.setServer(r.balance);
      phase = 'running';
      sfx.click();
      clearInterval(poll);
      poll = setInterval(check, 130);
    } catch (e) {
      toast(e.message, 'error');
      bet.disable(false);
      phase = 'idle';
      setButton();
    }
  }

  async function check() {
    if (phase !== 'running') return;
    try {
      const s = await api.get('/crash/state');
      if (phase !== 'running') return;
      if (s.state === 'ended') ended(s);
    } catch {}
  }

  function ended(s) {
    clearInterval(poll);
    round.crashPoint = s.crashPoint;
    const pay = wallet.settle(s.balance, s.payout);
    if (s.win) {
      phase = 'ghost';
      setButton();
      pendingRecent = s.recent ?? null;
      info.dataset.cash = `Retiraste en ${s.cashAt.toFixed(2)}x · +${fmt(s.payout - s.bet)}`;
      info.innerHTML = `<span class="win">Cobraste ${fmt(s.payout)} (+${fmt(s.payout - s.bet)}) en ${s.cashAt.toFixed(2)}x</span>`;
      pay.reveal();
      sfx.cash();
      fx.win(s.payout, s.bet);
      mainBtn.disabled = true;
    } else {
      pendingRecent = s.recent ?? null;
      info.innerHTML = `<span class="lose">Se cayó en ${s.crashPoint.toFixed(2)}x. Perdiste ${fmt(s.bet)}.</span>`;
      pay.reveal();
      crashed();
    }
  }

  async function cashout() {
    mainBtn.disabled = true;
    try {
      const s = await api.post('/crash/cashout');
      if (phase === 'running') ended(s);
    } catch (e) {
      if (e.code !== 'too_early') toast(e.message, 'error');
      mainBtn.disabled = false;
    }
  }

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Crash'), el('p', {}, 'El multiplicador sube y en algún momento se cae. Si te retirás antes, cobrás tu apuesta por el multiplicador. Si no, la perdés. Podés poner un retiro automático.')),
    el('div', { class: 'layout' },
      el('div', {}, recent, box),
      el('div', { class: 'side' }, el('div', { class: 'panel' }, bet.el, el('div', { style: { height: '10px' } }),
        el('label', { class: 'field' }, el('span', {}, 'Retiro automático (opcional)'), auto), el('div', { style: { height: '12px' } }), mainBtn, info)),
    ),
  );

  setRead('1.00x', 'Hacé tu apuesta');
  raf = requestAnimationFrame(frame);

  // Si había una ronda en juego (cerraste la página), se retoma
  (async () => {
    try {
      const t0 = Date.now();
      const s = await api.get('/crash/state');
      const t1 = Date.now();
      paintRecent(s.recent ?? []);
      wallet.setServer(s.balance);
      if (s.state === 'running' && alive) {
        round = { startedAt: s.startedAt, offset: s.serverNow - (t0 + t1) / 2, bet: s.bet, auto: s.auto, crashPoint: null };
        phase = 'running';
        bet.disable(true);
        poll = setInterval(check, 130);
      }
    } catch {}
  })();

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    clearInterval(poll);
  };
}
void sleep;
