// Datos del usuario, bonos y tablas de posiciones.
import { db, tx } from './db.js';
import { CONFIG } from '../config.js';
import { GameError } from './errors.js';
import { credit, balanceOf } from './wallet.js';

const HOUR = 3600000;

const qById = db.prepare('SELECT * FROM users WHERE id = ?');
const qMarkBonus = db.prepare('UPDATE users SET last_bonus_at = ?, streak = ? WHERE id = ?');
const qMarkRescue = db.prepare('UPDATE users SET last_rescue_at = ? WHERE id = ?');

export const getUser = (id) => qById.get(id);

function dailyInfo(u, now = Date.now()) {
  const { base, perStreak, maxStreak, cooldownHours, streakWindowHours } = CONFIG.dailyBonus;
  const ready = u.last_bonus_at === 0 || now - u.last_bonus_at >= cooldownHours * HOUR;
  const continues = u.last_bonus_at > 0 && now - u.last_bonus_at < streakWindowHours * HOUR;
  const nextStreak = Math.min(maxStreak, continues ? u.streak + 1 : 1);
  return {
    ready,
    amount: base + perStreak * (nextStreak - 1),
    streak: u.streak,
    nextStreak,
    availableAt: ready ? now : u.last_bonus_at + cooldownHours * HOUR,
  };
}

function rescueInfo(u, now = Date.now()) {
  const { threshold, amount, cooldownHours } = CONFIG.rescue;
  const cooled = u.last_rescue_at === 0 || now - u.last_rescue_at >= cooldownHours * HOUR;
  return {
    ready: u.balance < threshold && cooled,
    amount,
    threshold,
    availableAt: cooled ? now : u.last_rescue_at + cooldownHours * HOUR,
  };
}

/** Lo que el cliente puede ver de un usuario */
export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    balance: u.balance,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at,
    stats: { wagered: u.total_wagered, won: u.total_won, rounds: u.rounds_played },
    daily: dailyInfo(u),
    rescue: rescueInfo(u),
  };
}

export function claimDaily(userId) {
  return tx(() => {
    const u = qById.get(userId);
    const info = dailyInfo(u);
    if (!info.ready) throw new GameError('Todavía no podés cobrar el bono diario.', 429, 'cooldown');
    credit(userId, info.amount, 'bonus', `Bono diario (día ${info.nextStreak})`);
    qMarkBonus.run(Date.now(), info.nextStreak, userId);
    return { amount: info.amount, streak: info.nextStreak, balance: balanceOf(userId) };
  });
}

export function claimRescue(userId) {
  return tx(() => {
    const u = qById.get(userId);
    const info = rescueInfo(u);
    if (!info.ready) throw new GameError('Las fichas de rescate no están disponibles ahora.', 429, 'cooldown');
    credit(userId, info.amount, 'rescue', 'Fichas de rescate');
    qMarkRescue.run(Date.now(), userId);
    return { amount: info.amount, balance: balanceOf(userId) };
  });
}

// ---- Tablas ----
const qTopBalance = db.prepare(
  'SELECT username, balance FROM users WHERE banned = 0 ORDER BY balance DESC, id ASC LIMIT 10'
);
const qTopWins = db.prepare(
  `SELECT u.username, r.game, r.bet, r.payout, r.ts
   FROM rounds r JOIN users u ON u.id = r.user_id
   WHERE u.banned = 0 AND r.payout > r.bet
   ORDER BY (r.payout - r.bet) DESC, r.id DESC LIMIT 10`
);
const qFeed = db.prepare(
  `SELECT u.username, r.game, r.bet, r.payout, r.ts
   FROM rounds r JOIN users u ON u.id = r.user_id
   WHERE u.banned = 0 AND r.payout >= r.bet * 5 AND r.payout - r.bet >= 500
   ORDER BY r.id DESC LIMIT 15`
);
const qHistory = db.prepare(
  'SELECT game, bet, payout, ts FROM rounds WHERE user_id = ? ORDER BY id DESC LIMIT ?'
);
const qBest = db.prepare(
  'SELECT game, bet, payout FROM rounds WHERE user_id = ? ORDER BY (payout - bet) DESC LIMIT 1'
);

export const leaderboard = () => ({ balance: qTopBalance.all(), wins: qTopWins.all() });
export const feed = () => qFeed.all();
export const history = (userId, limit = 40) => qHistory.all(userId, limit);
export const bestWin = (userId) => {
  const r = qBest.get(userId);
  return r && r.payout > r.bet ? r : null;
};
