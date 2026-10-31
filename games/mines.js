// Minas: tablero de 5x5 con minas escondidas. Cada casillero seguro que destapás sube el multiplicador.
// Te retirás cuando quieras; si pisás una mina, perdés la apuesta. Ventaja de la casa: 1%.
import { tx, getActive, putActive, delActive } from '../lib/db.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf, parseBet } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

const SIZE = 25;
const EDGE = 0.99;

/** Multiplicador después de destapar `safe` casilleros seguros con `mines` minas */
export function multiplier(mines, safe) {
  if (safe <= 0) return 1;
  let m = EDGE;
  for (let i = 0; i < safe; i++) m *= (SIZE - i) / (SIZE - mines - i);
  return Math.floor(m * 100) / 100;
}

const view = (s, extra = {}) => {
  const safe = s.revealed.length;
  const maxSafe = SIZE - s.mines;
  return {
    active: !s.done,
    bet: s.bet,
    mines: s.mines,
    revealed: s.revealed,
    multiplier: multiplier(s.mines, safe),
    next: safe < maxSafe ? multiplier(s.mines, safe + 1) : null,
    potential: Math.round(s.bet * multiplier(s.mines, safe)),
    ...extra,
  };
};

export function state(userId) {
  const s = getActive(userId, 'mines');
  if (!s || s.done) return { active: false };
  return view(s);
}

export function start(userId, body) {
  const bet = parseBet(body?.bet);
  const mines = Number(body?.mines);
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new GameError('Elegí entre 1 y 24 minas.');

  return tx(() => {
    const cur = getActive(userId, 'mines');
    if (cur && !cur.done) throw new GameError('Ya tenés una partida de minas en juego.');
    debit(userId, bet, 'bet', 'mines');
    const cells = rng.shuffle(Array.from({ length: SIZE }, (_, i) => i));
    const s = { bet, mines, mineCells: cells.slice(0, mines), revealed: [], done: false };
    putActive(userId, 'mines', s);
    return { ...view(s), balance: balanceOf(userId) };
  });
}

function finish(userId, s, payout, detail) {
  s.done = true;
  delActive(userId, 'mines');
  if (payout > 0) credit(userId, payout, 'win', 'mines');
  recordRound(userId, 'mines', s.bet, payout, { mines: s.mines, safe: s.revealed.length, ...detail });
}

export function reveal(userId, body) {
  const cell = Number(body?.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE) throw new GameError('Casillero inválido.');

  return tx(() => {
    const s = getActive(userId, 'mines');
    if (!s || s.done) throw new GameError('No tenés ninguna partida de minas en juego.');
    if (s.revealed.includes(cell)) throw new GameError('Ese casillero ya está destapado.');

    if (s.mineCells.includes(cell)) {
      finish(userId, s, 0, { hit: cell });
      return {
        ...view(s),
        active: false,
        boom: true,
        cell,
        mineCells: s.mineCells,
        payout: 0,
        net: -s.bet,
        balance: balanceOf(userId),
      };
    }

    s.revealed.push(cell);
    // Si destapó todos los seguros, se cobra solo.
    if (s.revealed.length === SIZE - s.mines) {
      const payout = Math.round(s.bet * multiplier(s.mines, s.revealed.length));
      finish(userId, s, payout, { cleared: true });
      return {
        ...view(s),
        active: false,
        cell,
        cleared: true,
        mineCells: s.mineCells,
        payout,
        net: payout - s.bet,
        balance: balanceOf(userId),
      };
    }
    putActive(userId, 'mines', s);
    return { ...view(s), cell, balance: balanceOf(userId) };
  });
}

export function cashout(userId) {
  return tx(() => {
    const s = getActive(userId, 'mines');
    if (!s || s.done) throw new GameError('No tenés ninguna partida de minas en juego.');
    if (s.revealed.length === 0) throw new GameError('Destapá al menos un casillero antes de retirarte.');
    const payout = Math.round(s.bet * multiplier(s.mines, s.revealed.length));
    finish(userId, s, payout, { cashed: true });
    return {
      ...view(s),
      active: false,
      cashedOut: true,
      mineCells: s.mineCells,
      payout,
      net: payout - s.bet,
      balance: balanceOf(userId),
    };
  });
}
