// Todas las rutas de la API del casino.
import { db } from './lib/db.js';
import { CONFIG } from './config.js';
import { GameError } from './lib/errors.js';
import * as auth from './lib/auth.js';
import * as users from './lib/users.js';
import { checkAttempts, clearAttempts } from './lib/http.js';
import { credit, balanceOf } from './lib/wallet.js';
import { tx } from './lib/db.js';

import * as roulette from './games/roulette.js';
import * as slots from './games/slots.js';
import * as blackjack from './games/blackjack.js';
import * as crash from './games/crash.js';
import * as plinko from './games/plinko.js';
import * as mines from './games/mines.js';
import * as dice from './games/dice.js';

const SESSION_SECONDS = CONFIG.sessionDays * 86400;

const publicConfig = () => ({
  name: CONFIG.name,
  minBet: CONFIG.minBet,
  maxBet: CONFIG.maxBet,
  slots: { step: slots.BET_STEP, strip: slots.STRIP, pay3: slots.PAY3, pay2Cherry: slots.PAY2_CHERRY, freeSpins: slots.FREE_SPINS, freeMult: slots.FREE_MULT },
  plinko: { rows: plinko.ROWS, risks: plinko.RISKS, tables: plinko.TABLES },
});

export function registerRoutes(app) {
  // ---------- Cuenta ----------
  app.get('/api/config', { auth: false }, () => ({ name: CONFIG.name }));

  app.post('/api/register', { auth: false }, async (ctx) => {
    checkAttempts(`reg:${ctx.ip}`, 8);
    const user = await auth.register(ctx.body);
    ctx.setCookie('sid', await auth.createSession(user.id), { maxAge: SESSION_SECONDS });
    return { ok: true };
  });

  app.post('/api/login', { auth: false }, async (ctx) => {
    const key = `login:${ctx.ip}:${String(ctx.body?.username ?? '').toLowerCase()}`;
    checkAttempts(key, 10);
    const user = await auth.login(ctx.body);
    clearAttempts(key);
    ctx.setCookie('sid', await auth.createSession(user.id), { maxAge: SESSION_SECONDS });
    return { ok: true };
  });

  app.post('/api/logout', async (ctx) => {
    await auth.destroySession(ctx.token);
    ctx.setCookie('sid', '', { clear: true });
    return { ok: true };
  });

  app.get('/api/me', (ctx) => {
    crash.settleIfDue(ctx.user.id); // liquida una ronda de crash que haya terminado mientras no estabas
    return { user: users.publicUser(users.getUser(ctx.user.id)), config: publicConfig() };
  });

  app.post('/api/bonus/daily', (ctx) => users.claimDaily(ctx.user.id));
  app.post('/api/bonus/rescue', (ctx) => users.claimRescue(ctx.user.id));

  // ---------- Posiciones, actividad e historial ----------
  app.get('/api/leaderboard', () => users.leaderboard());
  app.get('/api/feed', () => ({ feed: users.feed() }));
  app.get('/api/history', (ctx) => ({ rounds: users.history(ctx.user.id, 40), best: users.bestWin(ctx.user.id) }));

  // ---------- Ruleta ----------
  app.post('/api/roulette/spin', (ctx) => roulette.spin(ctx.user.id, ctx.body?.bets));

  // ---------- Tragamonedas ----------
  app.post('/api/slots/spin', (ctx) => slots.spin(ctx.user.id, ctx.body));

  // ---------- Blackjack ----------
  app.get('/api/blackjack/state', (ctx) => blackjack.state(ctx.user.id));
  app.post('/api/blackjack/deal', (ctx) => blackjack.deal(ctx.user.id, ctx.body));
  app.post('/api/blackjack/hit', (ctx) => blackjack.hit(ctx.user.id));
  app.post('/api/blackjack/stand', (ctx) => blackjack.stand(ctx.user.id));
  app.post('/api/blackjack/double', (ctx) => blackjack.double(ctx.user.id));
  app.post('/api/blackjack/split', (ctx) => blackjack.split(ctx.user.id));

  // ---------- Crash ----------
  app.get('/api/crash/state', (ctx) => crash.state(ctx.user.id));
  app.post('/api/crash/bet', (ctx) => crash.start(ctx.user.id, ctx.body));
  app.post('/api/crash/cashout', (ctx) => crash.cashout(ctx.user.id));

  // ---------- Plinko ----------
  app.post('/api/plinko/drop', (ctx) => plinko.drop(ctx.user.id, ctx.body));

  // ---------- Minas ----------
  app.get('/api/mines/state', (ctx) => mines.state(ctx.user.id));
  app.post('/api/mines/start', (ctx) => mines.start(ctx.user.id, ctx.body));
  app.post('/api/mines/reveal', (ctx) => mines.reveal(ctx.user.id, ctx.body));
  app.post('/api/mines/cashout', (ctx) => mines.cashout(ctx.user.id));

  // ---------- Dados ----------
  app.post('/api/dice/roll', (ctx) => dice.roll(ctx.user.id, ctx.body));

  // ---------- Panel del dueño ----------
  const qUsers = db.prepare(
    `SELECT id, username, balance, is_admin, banned, created_at, total_wagered, total_won, rounds_played
     FROM users ORDER BY id`
  );
  const qUserById = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?');
  const qBan = db.prepare('UPDATE users SET banned = ? WHERE id = ?');
  const qTake = db.prepare('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?');
  const qLedger = db.prepare(
    'INSERT INTO ledger (user_id, ts, kind, delta, balance_after, note) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const targetUser = (id) => {
    const u = qUserById.get(Number(id));
    if (!u) throw new GameError('Usuario no encontrado.', 404);
    return u;
  };

  app.get('/api/admin/users', { admin: true }, () => ({
    users: qUsers.all().map((u) => ({
      id: u.id,
      username: u.username,
      balance: u.balance,
      isAdmin: !!u.is_admin,
      banned: !!u.banned,
      createdAt: u.created_at,
      wagered: u.total_wagered,
      won: u.total_won,
      rounds: u.rounds_played,
    })),
    invite: auth.getInviteCode(),
    houseProfit: db.prepare('SELECT COALESCE(SUM(bet - payout), 0) AS p FROM rounds').get().p,
  }));

  app.post('/api/admin/grant', { admin: true }, (ctx) => {
    const u = targetUser(ctx.body?.userId);
    const amount = Number(ctx.body?.amount);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1e9) throw new GameError('Monto inválido.');
    return tx(() => {
      if (amount > 0) credit(u.id, amount, 'admin', `Regalo de ${ctx.user.username}`);
      else {
        qTake.run(amount, u.id);
        qLedger.run(u.id, Date.now(), 'admin', amount, balanceOf(u.id), `Ajuste de ${ctx.user.username}`);
      }
      return { balance: balanceOf(u.id) };
    });
  });

  app.post('/api/admin/ban', { admin: true }, (ctx) => {
    const u = targetUser(ctx.body?.userId);
    if (u.is_admin) throw new GameError('No podés suspender al dueño.');
    qBan.run(ctx.body?.banned ? 1 : 0, u.id);
    if (ctx.body?.banned) auth.destroyUserSessions(u.id);
    return { ok: true };
  });

  app.post('/api/admin/password', { admin: true }, async (ctx) => {
    const u = targetUser(ctx.body?.userId);
    await auth.setPassword(u.id, ctx.body?.password);
    return { ok: true };
  });

  app.post('/api/admin/invite', { admin: true }, () => ({ invite: auth.regenerateInviteCode() }));
}
