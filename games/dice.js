// Dados: tirás un número de 0,00 a 99,99 y elegís si va a salir "menos" o "más" que tu objetivo.
// Paga 99% / probabilidad de ganar (ventaja de la casa: 1%).
import { tx } from '../lib/db.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf, parseBet } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

const EDGE = 0.99;

/** Cantidad de resultados (de 10000) que ganan, según el objetivo y la dirección */
export function winningCount(target, direction) {
  const t = Math.round(target * 100); // objetivo en centésimas
  return direction === 'under' ? t : 9999 - t;
}

export function multiplierFor(target, direction) {
  const count = winningCount(target, direction);
  return Math.floor((EDGE * 10000 * 100) / count) / 100; // 2 decimales, hacia abajo
}

export function roll(userId, body) {
  const bet = parseBet(body?.bet);
  const direction = body?.direction;
  const target = Math.round(Number(body?.target) * 100) / 100;
  if (direction !== 'under' && direction !== 'over') throw new GameError('Elegí "menos" o "más".');
  if (!Number.isFinite(target)) throw new GameError('Objetivo inválido.');
  const count = winningCount(target, direction);
  const chance = count / 10000;
  if (chance < 0.02 || chance > 0.98) throw new GameError('La probabilidad de ganar tiene que estar entre 2% y 98%.');
  const multiplier = multiplierFor(target, direction);

  return tx(() => {
    debit(userId, bet, 'bet', 'dice');
    const value = rng.int(0, 10000); // 0..9999
    const won = direction === 'under' ? value < Math.round(target * 100) : value > Math.round(target * 100);
    const payout = won ? Math.round(bet * multiplier) : 0;
    if (payout > 0) credit(userId, payout, 'win', 'dice');
    recordRound(userId, 'dice', bet, payout, { roll: value / 100, target, direction });
    return {
      roll: value / 100,
      won,
      target,
      direction,
      multiplier,
      chance,
      bet,
      payout,
      net: payout - bet,
      balance: balanceOf(userId),
    };
  });
}
