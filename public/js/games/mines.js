// Minas: destapá gemas, evitá las bombas y retirate cuando quieras.
import { el, fmt, fmtMult, store } from '../util.js';
import { betControl, toast } from '../ui.js';

export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  let alive = true;
  let active = false;
  let busy = false;
  let revealed = [];
  let mines = store.get('mines.count', 3);
  let state = null;

  const tiles = Array.from({ length: 25 }, (_, i) => el('button', { class: 'tile-m', type: 'button', 'aria-label': `Casillero ${i + 1}`, disabled: true, onclick: () => reveal(i) }));
  const grid = el('div', { class: 'mines-grid' }, tiles);
  const bet = betControl({ game: 'mines', min: ctx.config.minBet, max: ctx.config.maxBet, start: 100 });
  const slider = el('input', { type: 'range', min: 1, max: 24, step: 1, value: mines, 'aria-label': 'Cantidad de minas' });
  const minesLabel = el('b', {}, String(mines));
  slider.addEventListener('input', () => { mines = Number(slider.value); minesLabel.textContent = mines; store.set('mines.count', mines); });
  const startBtn = el('button', { class: 'btn primary big', onclick: start }, 'Empezar');
  const cashBtn = el('button', { class: 'btn good big', onclick: cashout, disabled: true }, 'Retirar');
  const multEl = el('b', {}, '1.00x');
  const nextEl = el('b', {}, '—');
  const potEl = el('b', { class: 'gold' }, '0');
  const info = el('div', { class: 'result-line' });

  function paintStats(s) {
    multEl.textContent = s ? fmtMult(s.multiplier) : '1.00x';
    nextEl.textContent = s?.next ? fmtMult(s.next) : '—';
    potEl.textContent = s ? fmt(s.potential) : '0';
    cashBtn.textContent = s && s.revealed.length ? `Retirar ${fmt(s.potential)}` : 'Retirar';
    cashBtn.disabled = !(active && s && s.revealed.length > 0) || busy;
  }

  function resetTiles() {
    tiles.forEach((t) => { t.className = 'tile-m'; t.textContent = ''; t.disabled = true; });
  }

  function setActive(on) {
    active = on;
    bet.disable(on);
    slider.disabled = on;
    startBtn.disabled = on;
    tiles.forEach((t, i) => { if (!revealed.includes(i)) t.disabled = !on; });
  }

  async function start() {
    const amount = bet.value;
    if (wallet.display < amount) return toast('No te alcanzan las fichas para esa apuesta.', 'error');
    busy = true;
    try {
      const s = await api.post('/mines/start', { bet: amount, mines });
      resetTiles();
      revealed = [];
      state = s;
      wallet.setServer(s.balance);
      setActive(true);
      info.textContent = `Hay ${mines} ${mines === 1 ? 'bomba escondida' : 'bombas escondidas'}. ¡Destapá!`;
      sfx.click();
    } catch (e) { toast(e.message, 'error'); }
    busy = false;
    paintStats(state?.active ? state : null);
  }

  async function reveal(i) {
    if (!active || busy) return;
    busy = true;
    tiles.forEach((t) => (t.disabled = true));
    try {
      const s = await api.post('/mines/reveal', { cell: i });
      if (s.boom) return boom(s);
      revealed = s.revealed;
      tiles[i].classList.add('safe');
      tiles[i].textContent = '💎';
      sfx.gem(s.revealed.length);
      state = s;
      if (s.cleared) return finish(s, true);
      busy = false;
      tiles.forEach((t, k) => { if (!revealed.includes(k)) t.disabled = false; });
      paintStats(s);
    } catch (e) {
      toast(e.message, 'error');
      busy = false;
      tiles.forEach((t, k) => { if (!revealed.includes(k)) t.disabled = false; });
    }
  }

  function showAll(s) {
    tiles.forEach((t, k) => {
      t.disabled = true;
      if (s.mineCells.includes(k)) {
        if (!t.classList.contains('mine')) { t.classList.add('mine', 'dim'); t.textContent = '💣'; }
      } else if (!revealed.includes(k)) { t.classList.add('safe', 'dim'); t.textContent = '💎'; }
    });
  }

  function boom(s) {
    const pay = wallet.settle(s.balance, 0);
    tiles[s.cell].classList.add('mine');
    tiles[s.cell].textContent = '💣';
    showAll(s);
    tiles[s.cell].classList.remove('dim');
    sfx.boom();
    info.innerHTML = `<span class="lose">¡Bomba! Perdiste ${fmt(s.bet)} fichas.</span>`;
    pay.reveal();
    setActive(false);
    busy = false;
    state = null;
    paintStats(null);
  }

  function finish(s, cleared) {
    const pay = wallet.settle(s.balance, s.payout);
    showAll(s);
    info.innerHTML = `<span class="win">${cleared ? '¡Despejaste todo! ' : ''}Cobraste ${fmt(s.payout)} (${fmtMult(s.multiplier)}) · +${fmt(s.net)}</span>`;
    pay.reveal();
    sfx.cash();
    fx.win(s.payout, s.bet);
    setActive(false);
    busy = false;
    state = null;
    paintStats(null);
  }

  async function cashout() {
    if (!active || busy) return;
    busy = true;
    cashBtn.disabled = true;
    try {
      finish(await api.post('/mines/cashout'), false);
    } catch (e) { toast(e.message, 'error'); busy = false; paintStats(state); }
  }

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Minas'), el('p', {}, 'Cada gema que destapás sube tu multiplicador. Con más bombas, cada gema paga más pero es más peligroso. Retirate cuando quieras.')),
    el('div', { class: 'layout' },
      el('div', { class: 'panel' }, grid),
      el('div', { class: 'side' },
        el('div', { class: 'panel' },
          bet.el, el('div', { style: { height: '10px' } }),
          el('label', { class: 'field' }, el('span', {}, 'Bombas: ', minesLabel), slider),
          el('div', { style: { height: '12px' } }), startBtn, el('div', { style: { height: '8px' } }), cashBtn, info),
        el('div', { class: 'stat-grid' },
          el('div', { class: 'stat' }, el('small', {}, 'Multiplicador'), multEl),
          el('div', { class: 'stat' }, el('small', {}, 'Siguiente gema'), nextEl),
          el('div', { class: 'stat', style: { gridColumn: 'span 2' } }, el('small', {}, 'Si te retirás ahora cobrás'), potEl))),
    ),
  );

  // Si había una partida abierta, se retoma
  (async () => {
    try {
      const s = await api.get('/mines/state');
      if (s.active && alive) {
        state = s;
        revealed = s.revealed;
        mines = s.mines;
        slider.value = mines; minesLabel.textContent = mines;
        resetTiles();
        revealed.forEach((i) => { tiles[i].classList.add('safe'); tiles[i].textContent = '💎'; });
        setActive(true);
        paintStats(s);
        info.textContent = 'Retomaste tu partida.';
      }
    } catch {}
  })();

  return () => { alive = false; };
}
