// Crash: un multiplicador sube cada vez más rápido y en algún momento "se cae".
// Si te retirás antes, cobrás apuesta x multiplicador. Si no, perdés. Ventaja de la casa: 1%.
//
// El punto donde se cae lo decide el servidor al momento de apostar y NUNCA se le manda al jugador
// hasta que terminó la ronda. El multiplicador depende solo del tiempo (reloj del servidor).
import { tx, db, getActive, putActive } from '../lib/db.js';
import { GameError } from '../lib/errors.js';
import { debit, credit, recordRound, balanceOf, parseBet } from '../lib/wallet.js';
import * as rng from '../lib/rng.js';

export const RATE = 0.1; // crecimiento por segundo: m(t) = e^(0.1 t)
const EDGE = 0.99;
const MAX_CRASH = 10000;
const MIN_CASHOUT = 1.01;

export const multAt = (ms) => Math.floor(100 * Math.exp((RATE * ms) / 1000)) / 100;
/** Milisegundos hasta que el multiplicador llega a `m` */
export const timeFor = (m) => (Math.log(m) / RATE) * 1000;

export function randomCrashPoint() {
  const u = rng.float();
  let cp = Math.floor((100 * EDGE) / (1 - u)) / 100;
  if (cp < 1) cp = 1; // 1% de las veces se cae enseguida
  return Math.min(cp, MAX_CRASH);
}

function endRound(userId, s, { win, cashAt, now }) {
  s.done = true;
  s.win = win;
  s.cashAt = cashAt;
  s.payout = win ? Math.round(s.bet * cashAt) : 0;
  s.endedAt = now;
  if (s.payout > 0) credit(userId, s.payout, 'win', 'crash');
  recordRound(userId, 'crash', s.bet, s.payout, { crashPoint: s.crashPoint, cashAt: win ? cashAt : null });
  putActive(userId, 'crash', s);
}

/** Resuelve la ronda si ya corresponde (retiro automático o caída). Devuelve el estado. */
function settle(userId, now = Date.now()) {
  const s = getActive(userId, 'crash');
  if (!s || s.done) return s;
  const el = now - s.startedAt;
  if (s.auto && s.auto <= s.crashPoint && el >= timeFor(s.auto)) {
    endRound(userId, s, { win: true, cashAt: s.auto, now });
  } else if (el >= timeFor(s.crashPoint + 0.01)) {
    endRound(userId, s, { win: false, cashAt: null, now });
  }
  return s;
}

/** Para llamar desde cualquier lado: liquida lo pendiente de ese usuario */
export function settleIfDue(userId) {
  const s = getActive(userId, 'crash');
  if (!s || s.done) return;
  tx(() => settle(userId));
}

function view(s, now = Date.now()) {
  if (!s) return { state: 'idle' };
  if (s.done) {
    return {
      state: 'ended',
      bet: s.bet,
      auto: s.auto,
      crashPoint: s.crashPoint, // recién ahora se revela
      win: s.win,
      cashAt: s.cashAt,
      payout: s.payout,
      net: s.payout - s.bet,
    };
  }
  const el = now - s.startedAt;
  return { state: 'running', bet: s.bet, auto: s.auto, startedAt: s.startedAt, serverNow: now, multiplier: multAt(el) };
}

export function recentCrashPoints() {
  return db
    .prepare("SELECT detail FROM rounds WHERE game = 'crash' ORDER BY id DESC LIMIT 20")
    .all()
    .map((r) => JSON.parse(r.detail).crashPoint);
}

export function state(userId) {
  const s = tx(() => settle(userId));
  return { ...view(s), balance: balanceOf(userId), recent: recentCrashPoints() };
}

export function start(userId, body) {
  const bet = parseBet(body?.bet);
  let auto = null;
  if (body?.auto != null && body.auto !== '') {
    auto = Math.floor(Number(body.auto) * 100) / 100;
    if (!Number.isFinite(auto) || auto < MIN_CASHOUT || auto > MAX_CRASH)
      throw new GameError(`El retiro automático tiene que estar entre ${MIN_CASHOUT} y ${MAX_CRASH}.`);
  }
  return tx(() => {
    const cur = settle(userId);
    if (cur && !cur.done) throw new GameError('Ya tenés una ronda de crash en juego.');
    debit(userId, bet, 'bet', 'crash');
    const s = { bet, auto, crashPoint: randomCrashPoint(), startedAt: Date.now(), done: false };
    putActive(userId, 'crash', s);
    return { ...view(s), balance: balanceOf(userId) };
  });
}

export function cashout(userId) {
  return tx(() => {
    const now = Date.now();
    const s = settle(userId, now);
    if (!s) throw new GameError('No tenés ninguna ronda de crash en juego.');
    if (s.done) return { ...view(s), balance: balanceOf(userId), recent: recentCrashPoints() }; // ya se resolvió
    const m = multAt(now - s.startedAt);
    if (m < MIN_CASHOUT) throw new GameError('Esperá un instante antes de retirarte.', 400, 'too_early');
    endRound(userId, s, { win: true, cashAt: m, now });
    return { ...view(s), balance: balanceOf(userId), recent: recentCrashPoints() };
  });
}
