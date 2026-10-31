// Billetera de fichas. TODO movimiento de fichas pasa por estas funciones,
// y la base de datos además impide que el saldo quede en negativo.
import { db } from './db.js';
import { CONFIG } from '../config.js';
import { GameError } from './errors.js';

const qDebit = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?');
const qCredit = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
const qBalance = db.prepare('SELECT balance FROM users WHERE id = ?');
const qLedger = db.prepare(
  'INSERT INTO ledger (user_id, ts, kind, delta, balance_after, note) VALUES (?, ?, ?, ?, ?, ?)'
);
const qRound = db.prepare(
  'INSERT INTO rounds (user_id, game, bet, payout, detail, ts) VALUES (?, ?, ?, ?, ?, ?)'
);
const qStats = db.prepare(
  'UPDATE users SET total_wagered = total_wagered + ?, total_won = total_won + ?, rounds_played = rounds_played + 1 WHERE id = ?'
);

export const balanceOf = (userId) => qBalance.get(userId)?.balance ?? 0;

/** Valida una apuesta que viene del cliente */
export function parseBet(value, { min = CONFIG.minBet, max = CONFIG.maxBet } = {}) {
  const bet = Number(value);
  if (!Number.isInteger(bet)) throw new GameError('La apuesta tiene que ser un número entero.');
  if (bet < min) throw new GameError(`La apuesta mínima es ${min} fichas.`);
  if (bet > max) throw new GameError(`La apuesta máxima es ${max.toLocaleString('es-AR')} fichas.`);
  return bet;
}

export function debit(userId, amount, kind, note = null) {
  if (!Number.isInteger(amount) || amount <= 0) throw new GameError('Monto inválido.');
  const r = qDebit.run(amount, userId, amount);
  if (r.changes !== 1) throw new GameError('No te alcanzan las fichas.', 402, 'insufficient');
  const bal = balanceOf(userId);
  qLedger.run(userId, Date.now(), kind, -amount, bal, note);
  return bal;
}

export function credit(userId, amount, kind, note = null) {
  if (!Number.isInteger(amount) || amount < 0) throw new GameError('Monto inválido.');
  if (amount === 0) return balanceOf(userId);
  qCredit.run(amount, userId);
  const bal = balanceOf(userId);
  qLedger.run(userId, Date.now(), kind, amount, bal, note);
  return bal;
}

/** Guarda la ronda terminada (historial + estadísticas). `bet` es el total apostado. */
export function recordRound(userId, game, bet, payout, detail = null) {
  qRound.run(userId, game, bet, payout, detail ? JSON.stringify(detail) : null, Date.now());
  qStats.run(bet, payout, userId);
}

/** Redondeo de fichas (al entero más cercano) */
export const chips = (x) => Math.round(x);
