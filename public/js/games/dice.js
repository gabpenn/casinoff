// Dados: elegís si el número (0 a 100) va a salir por debajo o por encima de tu objetivo.
import { el, fmt, fmtMult, store, sleep } from '../util.js';
import { betControl, seg, toast } from '../ui.js';

// Mismas cuentas que hace el servidor (para mostrar la probabilidad y el pago antes de tirar)
const winCount = (target, dir) => { const t = Math.round(target * 100); return dir === 'under' ? t : 9999 - t; };
const multFor = (target, dir) => Math.floor((0.99 * 10000 * 100) / winCount(target, dir)) / 100;

export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  let alive = true;
  let busy = false;
  let dir = store.get('dice.dir', 'under');
  let target = store.get('dice.target', 50);

  const bet = betControl({ game: 'dice', min: ctx.config.minBet, max: ctx.config.maxBet, start: 100 });
  const number = el('div', { class: 'dice-number' }, '—');
  const zone = el('div', { class: 'zone' });
  const marker = el('div', { class: 'marker', style: { left: '50%', opacity: 0 } });
  const bar = el('div', { class: 'dice-bar' }, zone, marker);
  const slider = el('input', { type: 'range', step: 0.5, 'aria-label': 'Objetivo' });
  const targetNum = el('input', { type: 'number', step: 0.5, 'aria-label': 'Objetivo (número)' });
  const chanceEl = el('b', {}, '');
  const multEl = el('b', {}, '');
  const profitEl = el('b', { class: 'gold' }, '');
  const dirSeg = seg([{ value: 'under', label: 'Menos que' }, { value: 'over', label: 'Más que' }], dir, (v) => { dir = v; store.set('dice.dir', v); limits(); refresh(); });
  const rollBtn = el('button', { class: 'btn primary big', onclick: roll }, 'Tirar');
  const info = el('div', { class: 'result-line' });
  const hist = el('div', { class: 'hist', style: { marginTop: '12px', justifyContent: 'center' } });

  function limits() {
    const [lo, hi] = dir === 'under' ? [2, 98] : [2, 97.5];
    slider.min = lo; slider.max = hi; targetNum.min = lo; targetNum.max = hi;
    target = Math.min(hi, Math.max(lo, target));
    slider.value = target; targetNum.value = target;
  }

  function refresh() {
    const count = winCount(target, dir);
    const chance = count / 100;
    const m = multFor(target, dir);
    chanceEl.textContent = chance.toFixed(2) + '%';
    multEl.textContent = fmtMult(m);
    profitEl.textContent = fmt(bet.value * m - bet.value);
    // zona de victoria
    if (dir === 'under') { zone.style.left = '0'; zone.style.width = target + '%'; }
    else { zone.style.left = target + '%'; zone.style.width = 100 - target + '%'; }
  }

  slider.addEventListener('input', () => { target = Number(slider.value); targetNum.value = target; store.set('dice.target', target); refresh(); });
  targetNum.addEventListener('change', () => { target = Number(targetNum.value) || 50; limits(); store.set('dice.target', target); refresh(); });

  async function roll() {
    if (busy) return;
    const amount = bet.value;
    if (wallet.display < amount) return toast('No te alcanzan las fichas para esa apuesta.', 'error');
    busy = true;
    rollBtn.disabled = true;
    bet.disable(true);
    dirSeg.disable(true);
    slider.disabled = true; targetNum.disabled = true;
    try {
      const res = await api.post('/dice/roll', { bet: amount, direction: dir, target });
      const pay = wallet.settle(res.balance, res.payout);
      sfx.spin();
      // número que "gira" antes de frenar en el resultado
      number.style.color = '';
      const t0 = performance.now();
      marker.style.opacity = 1;
      await new Promise((done) => {
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / 900);
          if (k < 1 && alive) {
            number.textContent = (Math.random() * 100).toFixed(2);
            requestAnimationFrame(tick);
          } else done();
        };
        requestAnimationFrame(tick);
      });
      if (!alive) return;
      number.textContent = res.roll.toFixed(2);
      marker.style.left = res.roll + '%';
      number.style.color = res.won ? 'var(--win)' : 'var(--lose)';
      hist.prepend(el('span', { class: res.won ? 'green' : 'red', style: { width: 'auto', padding: '0 10px', borderRadius: '999px' } }, res.roll.toFixed(2)));
      while (hist.children.length > 10) hist.lastChild.remove();
      await sleep(350);
      if (res.won) {
        info.innerHTML = `<span class="win">¡Ganaste! +${fmt(res.net)}</span>`;
        pay.reveal();
        fx.win(res.payout, res.bet);
      } else {
        info.innerHTML = `<span class="lose">Perdiste ${fmt(amount)} fichas.</span>`;
        pay.reveal();
        sfx.lose();
      }
    } catch (e) { toast(e.message, 'error'); }
    busy = false;
    rollBtn.disabled = false;
    bet.disable(false);
    dirSeg.disable(false);
    slider.disabled = false; targetNum.disabled = false;
  }

  limits();
  refresh();
  bet.el.addEventListener('input', refresh);
  bet.el.addEventListener('click', () => setTimeout(refresh, 0));
  bet.el.addEventListener('change', () => setTimeout(refresh, 0));

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Dados'), el('p', {}, 'Se tira un número entre 0 y 100. Elegí si va a salir por debajo o por encima de tu objetivo. Cuanto más difícil, más paga.')),
    el('div', { class: 'layout' },
      el('div', { class: 'panel dice-stage' }, number, bar,
        el('div', { class: 'dice-scale' }, ['0', '25', '50', '75', '100'].map((x) => el('span', {}, x))), hist),
      el('div', { class: 'side' },
        el('div', { class: 'panel' },
          bet.el, el('div', { style: { height: '10px' } }),
          el('div', { class: 'field' }, el('span', {}, 'Resultado'), dirSeg.el),
          el('div', { style: { height: '8px' } }),
          el('label', { class: 'field' }, el('span', {}, 'Objetivo'), targetNum), slider,
          el('div', { style: { height: '12px' } }), rollBtn, info),
        el('div', { class: 'stat-grid' },
          el('div', { class: 'stat' }, el('small', {}, 'Probabilidad'), chanceEl),
          el('div', { class: 'stat' }, el('small', {}, 'Multiplicador'), multEl),
          el('div', { class: 'stat', style: { gridColumn: 'span 2' } }, el('small', {}, 'Ganancia si ganás'), profitEl))),
    ),
  );

  return () => { alive = false; };
}
