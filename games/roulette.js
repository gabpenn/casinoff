// Ruleta europea (un solo cero). Ventaja de la casa: 2,70%.
// Cada apuesta es un conjunto de números; paga 36 / (cantidad de números) veces lo apostado.
import { tx } from '../lib/db.js';
import { CONFIG } from '../config.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

/** Devuelve los números que cubre una apuesta (o lanza error si no es válida) */
export function betNumbers(b) {
  const bad = () => new GameError('Apuesta de ruleta inválida.');
  switch (b?.type) {
    case 'straight':
      if (!isInt(b.n, 0, 36)) throw bad();
      return [b.n];
    case 'split': {
      const [a, c] = [b.a, b.b].sort((x, y) => x - y);
      if (!isInt(a, 0, 36) || !isInt(c, 0, 36)) throw bad();
      const zero = a === 0 && c >= 1 && c <= 3;
      const horizontal = a >= 1 && c - a === 3;
      const vertical = a >= 1 && c - a === 1 && a % 3 !== 0;
      if (!zero && !horizontal && !vertical) throw bad();
      return [a, c];
    }
    case 'street':
      if (!isInt(b.n, 1, 34) || b.n % 3 !== 1) throw bad();
      return [b.n, b.n + 1, b.n + 2];
    case 'corner':
      if (!isInt(b.n, 1, 32) || b.n % 3 === 0) throw bad();
      return [b.n, b.n + 1, b.n + 3, b.n + 4];
    case 'line':
      if (!isInt(b.n, 1, 31) || b.n % 3 !== 1) throw bad();
      return range(b.n, b.n + 5);
    case 'dozen':
      if (!isInt(b.n, 1, 3)) throw bad();
      return range((b.n - 1) * 12 + 1, b.n * 12);
    case 'column':
      if (!isInt(b.n, 1, 3)) throw bad();
      return range(1, 36).filter((x) => x % 3 === b.n % 3);
    case 'red':
      return range(1, 36).filter((x) => RED.has(x));
    case 'black':
      return range(1, 36).filter((x) => !RED.has(x));
    case 'even':
      return range(1, 36).filter((x) => x % 2 === 0);
    case 'odd':
      return range(1, 36).filter((x) => x % 2 === 1);
    case 'low':
      return range(1, 18);
    case 'high':
      return range(19, 36);
    default:
      throw bad();
  }
}

export function spin(userId, rawBets) {
  if (!Array.isArray(rawBets) || rawBets.length === 0) throw new GameError('Poné al menos una ficha en la mesa.');
  if (rawBets.length > 80) throw new GameError('Demasiadas apuestas en una misma tirada.');

  let total = 0;
  const bets = rawBets.map((raw) => {
    const amount = Number(raw?.amount);
    if (!Number.isInteger(amount) || amount < CONFIG.minBet)
      throw new GameError(`Cada apuesta tiene que ser de al menos ${CONFIG.minBet} fichas.`);
    if (amount > CONFIG.maxBet) throw new GameError('Una de las apuestas supera el máximo permitido.');
    total += amount;
    return { amount, numbers: betNumbers(raw), desc: { ...raw, amount } };
  });
  if (total > CONFIG.maxBet * 5) throw new GameError('El total apostado en la tirada supera el máximo permitido.');

  return tx(() => {
    debit(userId, total, 'bet', 'roulette');
    const number = rng.int(0, 37);

    let payout = 0;
    const wins = [];
    for (const b of bets) {
      if (b.numbers.includes(number)) {
        const p = Math.round((b.amount * 36) / b.numbers.length);
        payout += p;
        wins.push({ ...b.desc, payout: p });
      }
    }
    if (payout > 0) credit(userId, payout, 'win', 'roulette');
    recordRound(userId, 'roulette', total, payout, { number });

    return { number, color: colorOf(number), bet: total, payout, net: payout - total, wins, balance: balanceOf(userId) };
  });
}
