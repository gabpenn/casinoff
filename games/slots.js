// Tragamonedas de 3 rodillos x 3 filas, 5 líneas de pago, con giros gratis.
//
// - Las 5 líneas son: fila de arriba, del medio, de abajo y las dos diagonales.
// - La apuesta se reparte en las 5 líneas (apuesta/5 por línea).
// - 3 símbolos iguales en una línea pagan según la tabla. 2 cerezas seguidas desde la izquierda también pagan.
// - 3 estrellas (en cualquier lugar) activan 8 giros gratis con premios x2.
import { tx } from '../lib/db.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf, parseBet } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

// Cinta de cada rodillo (32 posiciones). Las estrellas nunca quedan pegadas.
export const STRIP = [
  'cherry', 'lemon', 'star', 'grape', 'cherry', 'bell', 'lemon', 'cherry',
  'bar', 'grape', 'star', 'lemon', 'cherry', 'seven', 'grape', 'bell',
  'cherry', 'lemon', 'diamond', 'grape', 'star', 'cherry', 'bar', 'lemon',
  'bell', 'cherry', 'grape', 'seven', 'lemon', 'bar', 'cherry', 'bell',
];
const L = STRIP.length;

// Pago por línea, multiplicado por la apuesta de esa línea
export const PAY3 = { cherry: 8, lemon: 16, grape: 25, bell: 45, bar: 75, seven: 250, diamond: 1000 };
export const PAY2_CHERRY = 3;

export const LINES = [
  [0, 0, 0], // arriba
  [1, 1, 1], // medio
  [2, 2, 2], // abajo
  [0, 1, 2], // diagonal \
  [2, 1, 0], // diagonal /
];
export const FREE_SPINS = 8;
export const FREE_MULT = 2;
export const BET_STEP = 5; // la apuesta tiene que ser múltiplo de 5 (se divide en 5 líneas)

/** Dado el punto de parada de cada rodillo, arma la grilla visible: grid[fila][rodillo] */
export function gridFor(stops) {
  const grid = [[], [], []];
  stops.forEach((s, reel) => {
    grid[0][reel] = STRIP[(s - 1 + L) % L];
    grid[1][reel] = STRIP[s];
    grid[2][reel] = STRIP[(s + 1) % L];
  });
  return grid;
}

/** Evalúa una grilla. Devuelve la suma de multiplicadores de línea (sin dividir por 5) y el detalle. */
export function evaluate(grid) {
  let lineMult = 0;
  const wins = [];
  LINES.forEach((rows, idx) => {
    const syms = rows.map((row, reel) => grid[row][reel]);
    let mult = 0;
    let kind = null;
    if (syms[0] === syms[1] && syms[1] === syms[2] && PAY3[syms[0]]) {
      mult = PAY3[syms[0]];
      kind = 'three';
    } else if (syms[0] === 'cherry' && syms[1] === 'cherry') {
      mult = PAY2_CHERRY;
      kind = 'two';
    }
    if (mult) {
      lineMult += mult;
      wins.push({ line: idx, rows, symbol: syms[0], kind, mult });
    }
  });
  const stars = grid.flat().filter((s) => s === 'star').length;
  return { lineMult, wins, stars };
}

const randomStops = () => [rng.int(0, L), rng.int(0, L), rng.int(0, L)];

function spinOnce(bet, multiplier, allowTrigger) {
  const stops = randomStops();
  const grid = gridFor(stops);
  const { lineMult, wins, stars } = evaluate(grid);
  const payout = Math.round(((bet * lineMult) / 5) * multiplier);
  return { stops, grid, wins, stars, payout, trigger: allowTrigger && stars >= 3 };
}

export function spin(userId, body) {
  const bet = parseBet(body?.bet);
  if (bet % BET_STEP !== 0) throw new GameError(`La apuesta tiene que ser múltiplo de ${BET_STEP}.`);

  return tx(() => {
    debit(userId, bet, 'bet', 'slots');
    const base = spinOnce(bet, 1, true);
    let payout = base.payout;

    let free = null;
    if (base.trigger) {
      const spins = Array.from({ length: FREE_SPINS }, () => spinOnce(bet, FREE_MULT, false));
      const freePayout = spins.reduce((s, x) => s + x.payout, 0);
      free = { count: FREE_SPINS, multiplier: FREE_MULT, spins, payout: freePayout };
      payout += freePayout;
    }

    if (payout > 0) credit(userId, payout, 'win', 'slots');
    recordRound(userId, 'slots', bet, payout, { stops: base.stops, free: !!free });
    return {
      stops: base.stops,
      grid: base.grid,
      wins: base.wins,
      stars: base.stars,
      basePayout: base.payout,
      free,
      bet,
      payout,
      net: payout - bet,
      balance: balanceOf(userId),
    };
  });
}

/** Retorno teórico exacto (RTP): se recorren las 32768 combinaciones posibles. */
export function theoreticalRtp() {
  let lineSum = 0;
  let triggers = 0;
  let hits = 0;
  const total = L ** 3;
  for (let a = 0; a < L; a++)
    for (let b = 0; b < L; b++)
      for (let c = 0; c < L; c++) {
        const { lineMult, stars, wins } = evaluate(gridFor([a, b, c]));
        lineSum += lineMult / 5;
        if (stars >= 3) triggers++;
        if (wins.length) hits++;
      }
  const lineRtp = lineSum / total;
  const pTrigger = triggers / total;
  const rtp = lineRtp * (1 + pTrigger * FREE_SPINS * FREE_MULT);
  return { rtp, lineRtp, pTrigger, hitRate: hits / total };
}
