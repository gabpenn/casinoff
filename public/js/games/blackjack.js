// Blackjack contra la banca.
import { el, fmt, sleep } from '../util.js';
import { betControl, toast } from '../ui.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RESULT = { win: 'Ganaste', lose: 'Perdiste', push: 'Empate', bust: 'Te pasaste', blackjack: 'Blackjack' };

function cardEl(code, { deal = false, delay = 0, flip = false } = {}) {
  if (!code) return el('div', { class: `card back${deal ? ' deal' : ''}`, style: { animationDelay: delay + 'ms' } });
  const rank = code.slice(0, -1);
  const suit = SUIT[code.slice(-1)];
  const red = code.endsWith('H') || code.endsWith('D');
  return el('div', { class: `card ${red ? 'red' : 'black'}${deal ? ' deal' : ''}${flip ? ' flip' : ''}`, style: { animationDelay: delay + 'ms' }, 'aria-label': `${rank} de ${suit}` },
    el('span', { class: 'r' }, rank), el('span', { class: 's' }, suit), el('span', { class: 'c' }, suit));
}

export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  let alive = true;
  let busy = false;
  let shown = { dealer: 0, hands: [], dealerHidden: false };

  const dealerZone = el('div', { class: 'zone' });
  const playerZone = el('div', { class: 'zone' });
  const actions = el('div', { class: 'bj-actions' });
  const felt = el('div', { class: 'felt' }, dealerZone, playerZone, actions);
  const bet = betControl({ game: 'blackjack', min: ctx.config.minBet, max: ctx.config.maxBet, start: 100 });
  const dealBtn = el('button', { class: 'btn primary big', onclick: deal }, 'Repartir');
  const info = el('div', { class: 'result-line' }, 'Hacé tu apuesta y repartí.');

  function totalLabel(h) {
    return h.soft && h.total < 21 ? `${h.total - 10} / ${h.total}` : String(h.total);
  }

  /** Dibuja el estado. Las cartas nuevas entran con animación, escalonadas. */
  function render(view, { finalDealer = false } = {}) {
    let order = 0; // para escalonar las cartas nuevas
    const step = 330;

    // Banca
    const dc = view.dealer.cards;
    const dealerCards = el('div', { class: 'cards' });
    dc.forEach((c, i) => {
      const isNew = i >= shown.dealer;
      const wasHidden = shown.dealerHidden && i === 1 && !view.dealer.hidden;
      dealerCards.append(cardEl(c, { deal: isNew && !wasHidden, delay: isNew ? order++ * step : 0, flip: wasHidden }));
    });
    if (view.dealer.hidden) dealerCards.append(cardEl(null, { deal: shown.dealer < 2, delay: shown.dealer < 2 ? order++ * step : 0 }));
    dealerZone.replaceChildren(
      el('h3', {}, 'Banca'),
      dealerCards,
      dc.length ? el('span', { class: `total${view.dealer.total > 21 ? ' bust' : ''}` }, view.dealer.hidden ? String(view.dealer.total) : String(view.dealer.total)) : null,
    );
    shown.dealer = dc.length + (view.dealer.hidden ? 1 : 0);
    shown.dealerHidden = view.dealer.hidden;

    // Manos del jugador
    const hands = el('div', { class: 'hands' });
    view.hands.forEach((h, idx) => {
      const prev = shown.hands[idx] ?? 0;
      const cards = el('div', { class: 'cards' });
      h.cards.forEach((c, i) => cards.append(cardEl(c, { deal: i >= prev, delay: i >= prev ? order++ * step : 0 })));
      shown.hands[idx] = h.cards.length;
      hands.append(el('div', { class: `hand${h.current ? ' current' : ''}` },
        cards,
        el('span', { class: `total${h.total > 21 ? ' bust' : ''}` }, totalLabel(h)),
        el('span', { class: 'bet-tag' }, el('span', { class: 'chip mini', 'data-v': 100, style: { transform: 'none' } }, el('span', {}, '')), fmt(h.bet) + (h.doubled ? ' (doblada)' : '')),
        h.result ? el('span', { class: `verdict ${h.result}` }, `${RESULT[h.result]}${h.payout != null ? ` · ${h.payout - h.bet >= 0 ? '+' : ''}${fmt(h.payout - h.bet)}` : ''}`) : null,
      ));
    });
    shown.hands.length = view.hands.length;
    playerZone.replaceChildren(el('h3', {}, view.hands.length > 1 ? 'Tus manos' : 'Vos'), hands);
    return order * step;
  }

  function showActions(view) {
    actions.replaceChildren();
    if (!view?.active) return;
    const a = view.actions;
    const mk = (label, key, cls = '') => el('button', { class: `btn ${cls}`, disabled: !a[key] || busy, onclick: () => act(key) }, label);
    actions.append(mk('Pedir carta', 'hit', 'good'), mk('Plantarse', 'stand', 'danger'), mk('Doblar', 'double'), mk('Dividir', 'split'));
  }

  async function act(name) {
    if (busy) return;
    busy = true;
    showActions(lastView);
    try {
      const v = await api.post(`/blackjack/${name}`);
      await handle(v);
    } catch (e) {
      toast(e.message, 'error');
      busy = false;
      showActions(lastView);
    }
  }

  let lastView = null;

  async function handle(v) {
    lastView = v;
    if (v.finished) {
      const pay = wallet.settle(v.balance, v.payout);
      const ms = render(v);
      sfx.deal();
      await sleep(Math.max(ms, 300) + 350);
      if (!alive) return;
      finish(v, pay);
    } else {
      wallet.setServer(v.balance);
      const ms = render(v);
      sfx.deal();
      await sleep(Math.min(ms, 900) + 150);
      busy = false;
      showActions(v);
    }
  }

  function finish(v, pay) {
    busy = false;
    actions.replaceChildren();
    bet.disable(false);
    dealBtn.disabled = false;
    const net = v.net;
    if (v.payout > v.bet) {
      info.innerHTML = `<span class="win">¡Ganaste ${fmt(net)} fichas!</span>`;
      pay.reveal();
      fx.win(v.payout, v.bet);
    } else if (v.payout === v.bet) {
      info.textContent = 'Empate: te devolvemos la apuesta.';
      pay.reveal();
      sfx.click();
    } else {
      info.innerHTML = `<span class="lose">Perdiste ${fmt(-net)} fichas.</span>`;
      pay.reveal();
      sfx.lose();
    }
    lastView = null;
  }

  async function deal() {
    if (busy) return;
    const amount = bet.value;
    if (wallet.display < amount) return toast('No te alcanzan las fichas para esa apuesta.', 'error');
    busy = true;
    bet.disable(true);
    dealBtn.disabled = true;
    info.textContent = '';
    shown = { dealer: 0, hands: [], dealerHidden: false };
    try {
      const v = await api.post('/blackjack/deal', { bet: amount });
      await handle(v);
    } catch (e) {
      toast(e.message, 'error');
      busy = false;
      bet.disable(false);
      dealBtn.disabled = false;
    }
  }

  const onKey = (e) => {
    if (!lastView?.active || busy || /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '')) return;
    const map = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
    const k = map[e.key.toLowerCase()];
    if (k && lastView.actions[k]) act(k);
  };
  document.addEventListener('keydown', onKey);

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Blackjack'), el('p', {}, 'Llegá a 21 sin pasarte. La banca se planta en 17. Blackjack paga 3 a 2. Atajos: H pedir, S plantarse, D doblar, P dividir.')),
    el('div', { class: 'layout' },
      felt,
      el('div', { class: 'side' }, el('div', { class: 'panel' }, bet.el, el('div', { style: { height: '10px' } }), dealBtn, info),
        el('div', { class: 'panel' }, el('h3', {}, 'Reglas'), el('p', { class: 'fineprint', style: { margin: 0 } }, '6 mazos, mezclados en cada mano. Podés doblar con las dos primeras cartas y dividir pares (hasta 4 manos). Sin seguro ni rendición.'))),
    ),
  );
  dealerZone.append(el('h3', {}, 'Banca'));
  playerZone.append(el('p', { class: 'hint' }, 'Hacé tu apuesta y repartí'), el('h3', {}, 'Vos'));

  // Si había una mano a medio jugar, se retoma
  (async () => {
    try {
      const s = await api.get('/blackjack/state');
      if (s.active && alive) {
        bet.disable(true);
        dealBtn.disabled = true;
        wallet.setServer(s.balance);
        lastView = s;
        render(s);
        showActions(s);
        info.textContent = 'Retomaste tu mano.';
      }
    } catch {}
  })();

  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
