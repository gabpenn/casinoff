// Plinko: la bolita baja rebotando entre clavijas, en cada fila va a izquierda o derecha 50/50.
// Los multiplicadores se calculan para que el retorno total sea ~97% (ventaja de la casa ~3%).
import { tx } from '../lib/db.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf, parseBet } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

export const ROWS = [8, 12, 16];
export const RISKS = ['low', 'medium', 'high'];
const TARGET_RTP = 0.97;

// Forma de la tabla de cada riesgo: más riesgo = bordes mucho más altos y centro más bajo.
const SHAPE = {
  low: { a: 3.0, p: 1.7 },
  medium: { a: 5.0, p: 2.1 },
  high: { a: 7.2, p: 2.6 },
};

function binomial(n) {
  const out = [1];
  for (let k = 1; k <= n; k++) out.push((out[k - 1] * (n - k + 1)) / k);
  return out.map((c) => c / 2 ** n); // probabilidad de cada casillero
}

export const probabilities = (rows) => binomial(rows);

function makeTable(rows, risk) {
  const { p } = SHAPE[risk];
  const a = SHAPE[risk].a * (0.6 + (0.4 * rows) / 16); // menos filas = tabla menos extrema
  const prob = binomial(rows);
  const raw = prob.map((_, i) => Math.exp(a * (Math.abs(i - rows / 2) / (rows / 2)) ** p));
  const expected = raw.reduce((s, r, i) => s + r * prob[i], 0);
  const scale = TARGET_RTP / expected;
  return raw.map((r) => Math.round(r * scale * 100) / 100);
}

export const TABLES = {};
for (const rows of ROWS) {
  TABLES[rows] = {};
  for (const risk of RISKS) TABLES[rows][risk] = makeTable(rows, risk);
}

export function drop(userId, body) {
  const bet = parseBet(body?.bet);
  const rows = Number(body?.rows);
  const risk = body?.risk;
  if (!ROWS.includes(rows)) throw new GameError('Cantidad de filas inválida.');
  if (!RISKS.includes(risk)) throw new GameError('Riesgo inválido.');

  return tx(() => {
    debit(userId, bet, 'bet', 'plinko');
    const path = Array.from({ length: rows }, () => rng.int(0, 2)); // 0 = izquierda, 1 = derecha
    const bin = path.reduce((s, x) => s + x, 0);
    const multiplier = TABLES[rows][risk][bin];
    const payout = Math.round(bet * multiplier);
    if (payout > 0) credit(userId, payout, 'win', 'plinko');
    recordRound(userId, 'plinko', bet, payout, { rows, risk, bin, multiplier });
    return { path, bin, multiplier, bet, payout, net: payout - bet, balance: balanceOf(userId) };
  });
}
