// Cuentas, contraseñas y sesiones.
import { db, tx, getSetting, setSetting } from './db.js';
import { CONFIG } from '../config.js';
import { GameError } from './errors.js';

const qByName = db.prepare('SELECT * FROM users WHERE username = ?');
const qById = db.prepare('SELECT * FROM users WHERE id = ?');
const qCount = db.prepare('SELECT COUNT(*) AS c FROM users');
const qInsertUser = db.prepare(
  `INSERT INTO users (username, pass_salt, pass_hash, balance, is_admin, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const qInsertSession = db.prepare(
  'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const qSessionUser = db.prepare(
  `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = ? AND s.expires_at > ?`
);
const qDelSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const qDelUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const qPurge = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
const qSetPass = db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?');
const qLedger = db.prepare(
  'INSERT INTO ledger (user_id, ts, kind, delta, balance_after, note) VALUES (?, ?, ?, ?, ?, ?)'
);

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (text) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

// Contraseñas: PBKDF2-SHA256 (viene incluido en Cloudflare). La cantidad de vueltas va guardada
// junto al hash, así se puede cambiar después sin romper las cuentas que ya existen.
const PBKDF2_ITERATIONS = 40000;

async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    key,
    256
  );
  return toHex(bits);
}

async function hashPassword(password, saltHex = randomHex(16)) {
  const hash = await derive(password, saltHex, PBKDF2_ITERATIONS);
  return { salt: saltHex, hash: `p2$${PBKDF2_ITERATIONS}$${hash}` };
}

async function checkPassword(password, user) {
  const [tag, iters, expected] = String(user.pass_hash).split('$');
  if (tag !== 'p2') return false;
  const got = await derive(password, user.pass_salt, Number(iters));
  // comparación a tiempo constante
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---- Código de invitación (para que no se registre cualquiera) ----
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}
export function getInviteCode() {
  let code = getSetting('invite_code');
  // Mientras no haya ninguna cuenta, manda el código que cargaste en Cloudflare (INVITE_CODE).
  const noUsers = qCount.get().c === 0;
  if (noUsers && CONFIG.inviteCode && code !== CONFIG.inviteCode) {
    code = CONFIG.inviteCode;
    setSetting('invite_code', code);
  }
  if (!code) {
    code = newInviteCode();
    setSetting('invite_code', code);
  }
  return code;
}
export function regenerateInviteCode() {
  const code = newInviteCode();
  setSetting('invite_code', code);
  return code;
}

// ---- Registro / login ----
export async function register({ username, password, invite }) {
  username = String(username ?? '').trim();
  password = String(password ?? '');
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username))
    throw new GameError('El usuario tiene que tener entre 3 y 20 caracteres (letras, números, _ . -).');
  if (password.length < 6 || password.length > 100)
    throw new GameError('La contraseña tiene que tener al menos 6 caracteres.');
  if (String(invite ?? '').trim().toUpperCase() !== getInviteCode())
    throw new GameError('Código de invitación incorrecto.', 403, 'bad_invite');

  const { salt, hash } = await hashPassword(password);
  return tx(() => {
    if (qByName.get(username)) throw new GameError('Ese usuario ya existe, probá con otro.', 409);
    const first = qCount.get().c === 0;
    const r = qInsertUser.run(username, salt, hash, CONFIG.startingChips, first ? 1 : 0, Date.now());
    const id = Number(r.lastInsertRowid);
    qLedger.run(id, Date.now(), 'welcome', CONFIG.startingChips, CONFIG.startingChips, 'Fichas de bienvenida');
    return qById.get(id);
  });
}

export async function login({ username, password }) {
  const user = qByName.get(String(username ?? '').trim());
  // Hacemos el cálculo igual aunque el usuario no exista, para no dar pistas.
  if (!user) {
    await hashPassword(String(password ?? ''));
    throw new GameError('Usuario o contraseña incorrectos.', 401);
  }
  if (!(await checkPassword(String(password ?? ''), user))) throw new GameError('Usuario o contraseña incorrectos.', 401);
  if (user.banned) throw new GameError('Esta cuenta está suspendida.', 403);
  return user;
}

// ---- Sesiones ----
export async function createSession(userId) {
  const token = randomHex(32);
  const now = Date.now();
  qPurge.run(now);
  qInsertSession.run(await sha(token), userId, now, now + CONFIG.sessionDays * 86400000);
  return token;
}
export const userFromToken = async (token) => (token ? qSessionUser.get(await sha(token), Date.now()) ?? null : null);
export const destroySession = async (token) => token && qDelSession.run(await sha(token));
export const destroyUserSessions = (userId) => qDelUserSessions.run(userId);

export async function setPassword(userId, newPassword) {
  if (String(newPassword).length < 6) throw new GameError('La contraseña tiene que tener al menos 6 caracteres.');
  const { salt, hash } = await hashPassword(String(newPassword));
  qSetPass.run(salt, hash, userId);
  destroyUserSessions(userId);
}
