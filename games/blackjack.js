// Blackjack contra la casa. Reglas:
//  - 6 mazos, se mezclan en cada mano.
//  - Blackjack paga 3 a 2. La banca se planta en todos los 17 (también en 17 blando).
//  - Podés pedir, plantarte, doblar (con las dos primeras cartas) y dividir pares (hasta 4 manos).
//  - Dividir ases: una sola carta por as. Un 21 después de dividir cuenta como 21, no como blackjack.
//  - Sin seguro ni rendición.
import { tx, getActive, putActive, delActive } from '../lib/db.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf, parseBet } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const MAX_HANDS = 4;

function newShoe() {
  const cards = [];
  for (let d = 0; d < 6; d++) for (const s of SUITS) for (const r of RANKS) cards.push(r + s);
  return rng.shuffle(cards);
}

const rankOf = (c) => c.slice(0, -1);
export function cardValue(c) {
  const r = rankOf(c);
  if (r === 'A') return 11;
  if (r === 'J' || r === 'Q' || r === 'K' || r === '10') return 10;
  return Number(r);
}

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (rankOf(c) === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;

function draw(s) {
  return s.shoe.pop();
}

// ---------- Vista para el cliente (nunca incluye el mazo ni la carta oculta) ----------
function view(s, extra = {}) {
  const hands = s.hands.map((h, i) => {
    const t = handTotal(h.cards);
    return {
      cards: h.cards,
      bet: h.bet,
      total: t.total,
      soft: t.soft,
      status: h.status,
      doubled: h.doubled,
      result: h.result ?? null,
      payout: h.payout ?? null,
      current: !s.done && i === s.current,
    };
  });
  const dealerCards = s.done ? s.dealer : [s.dealer[0]];
  const dt = handTotal(dealerCards);
  const out = {
    active: !s.done,
    dealer: { cards: dealerCards, total: dt.total, hidden: !s.done },
    hands,
    current: s.current,
    ...extra,
  };
  if (!s.done) out.actions = actions(s);
  return out;
}

function actions(s) {
  const h = s.hands[s.current];
  if (!h || h.status !== 'playing') return { hit: false, stand: false, double: false, split: false };
  const two = h.cards.length === 2;
  return {
    hit: true,
    stand: true,
    double: two && !h.doubled,
    split:
      two &&
      s.hands.length < MAX_HANDS &&
      cardValue(h.cards[0]) === cardValue(h.cards[1]) &&
      !(h.splitAces === true), // no se vuelven a dividir ases
  };
}

// ---------- Flujo de la mano ----------
function advance(s) {
  // Pasa a la siguiente mano que todavía se esté jugando
  while (s.current < s.hands.length && s.hands[s.current].status !== 'playing') s.current++;
  return s.current >= s.hands.length;
}

function autoCheck(s) {
  // Si la mano actual llegó a 21 o se pasó, se cierra sola.
  const h = s.hands[s.current];
  if (!h || h.status !== 'playing') return;
  const { total } = handTotal(h.cards);
  if (total > 21) h.status = 'bust';
  else if (total === 21) h.status = 'stand';
}

function finishRound(userId, s) {
  // Juega la banca (solo si quedó alguna mano en pie) y liquida
  const alive = s.hands.some((h) => h.status === 'stand' || h.status === 'blackjack');
  if (alive && !s.skipDealer) {
    while (handTotal(s.dealer).total < 17) s.dealer.push(draw(s));
  }
  const dealerTotal = handTotal(s.dealer).total;
  const dealerBJ = isBlackjack(s.dealer);

  let totalPayout = 0;
  let totalBet = 0;
  for (const h of s.hands) {
    const { total } = handTotal(h.cards);
    totalBet += h.bet;
    if (h.status === 'bust') {
      h.result = 'bust';
      h.payout = 0;
    } else if (h.status === 'blackjack') {
      if (dealerBJ) {
        h.result = 'push';
        h.payout = h.bet;
      } else {
        h.result = 'blackjack';
        h.payout = Math.round(h.bet * 2.5);
      }
    } else if (dealerBJ) {
      h.result = 'lose';
      h.payout = 0;
    } else if (dealerTotal > 21 || total > dealerTotal) {
      h.result = 'win';
      h.payout = h.bet * 2;
    } else if (total === dealerTotal) {
      h.result = 'push';
      h.payout = h.bet;
    } else {
      h.result = 'lose';
      h.payout = 0;
    }
    totalPayout += h.payout;
  }

  s.done = true;
  delActive(userId, 'blackjack');
  if (totalPayout > 0) credit(userId, totalPayout, 'win', 'blackjack');
  recordRound(userId, 'blackjack', totalBet, totalPayout, { hands: s.hands.length });
  return { payout: totalPayout, bet: totalBet, net: totalPayout - totalBet, balance: balanceOf(userId) };
}

/** Después de cada acción: avanza de mano y, si no queda ninguna, cierra la ronda. */
function afterAction(userId, s) {
  autoCheck(s);
  const over = advance(s);
  if (over) {
    const summary = finishRound(userId, s);
    return view(s, { finished: true, ...summary });
  }
  autoCheck(s);
  if (s.hands[s.current]?.status !== 'playing') return afterAction(userId, s);
  putActive(userId, 'blackjack', s);
  return view(s, { balance: balanceOf(userId) });
}

// ---------- Acciones ----------
export function state(userId) {
  const s = getActive(userId, 'blackjack');
  if (!s || s.done) return { active: false };
  return { ...view(s), balance: balanceOf(userId) };
}

export function deal(userId, body) {
  const bet = parseBet(body?.bet);
  return tx(() => {
    const cur = getActive(userId, 'blackjack');
    if (cur && !cur.done) throw new GameError('Ya tenés una mano en juego.');
    debit(userId, bet, 'bet', 'blackjack');

    const s = { shoe: newShoe(), dealer: [], hands: [{ cards: [], bet, status: 'playing', doubled: false }], current: 0, done: false };
    const h = s.hands[0];
    h.cards.push(draw(s));
    s.dealer.push(draw(s));
    h.cards.push(draw(s));
    s.dealer.push(draw(s));

    const playerBJ = isBlackjack(h.cards);
    const dealerBJ = isBlackjack(s.dealer);
    if (playerBJ || dealerBJ) {
      h.status = playerBJ ? 'blackjack' : 'stand';
      s.skipDealer = true;
      const summary = finishRound(userId, s);
      return view(s, { finished: true, ...summary });
    }
    putActive(userId, 'blackjack', s);
    return view(s, { balance: balanceOf(userId) });
  });
}

function withRound(userId, fn) {
  return tx(() => {
    const s = getActive(userId, 'blackjack');
    if (!s || s.done) throw new GameError('No tenés ninguna mano en juego.');
    return fn(s, s.hands[s.current]);
  });
}

export function hit(userId) {
  return withRound(userId, (s, h) => {
    h.cards.push(draw(s));
    return afterAction(userId, s);
  });
}

export function stand(userId) {
  return withRound(userId, (s, h) => {
    h.status = 'stand';
    return afterAction(userId, s);
  });
}

export function double(userId) {
  return withRound(userId, (s, h) => {
    if (!actions(s).double) throw new GameError('Solo podés doblar con las dos primeras cartas.');
    debit(userId, h.bet, 'bet', 'blackjack-double');
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(draw(s));
    h.status = handTotal(h.cards).total > 21 ? 'bust' : 'stand';
    return afterAction(userId, s);
  });
}

export function split(userId) {
  return withRound(userId, (s, h) => {
    if (!actions(s).split) throw new GameError('No podés dividir esta mano.');
    debit(userId, h.bet, 'bet', 'blackjack-split');
    const aces = rankOf(h.cards[0]) === 'A';
    const second = { cards: [h.cards.pop()], bet: h.bet, status: 'playing', doubled: false, splitAces: aces };
    h.splitAces = aces;
    h.cards.push(draw(s));
    second.cards.push(draw(s));
    s.hands.splice(s.current + 1, 0, second);
    if (aces) {
      // Una sola carta por cada as
      h.status = 'stand';
      second.status = 'stand';
    }
    return afterAction(userId, s);
  });
}
