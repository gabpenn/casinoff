// Base de datos: SQLite, que en Cloudflare vive dentro del "Durable Object" del casino.
// Este archivo no depende de dónde corra: quien lo use le pasa un "adaptador" con bindAdapter().

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_salt     TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_admin      INTEGER NOT NULL DEFAULT 0,
  banned        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_bonus_at INTEGER NOT NULL DEFAULT 0,
  last_rescue_at INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won     INTEGER NOT NULL DEFAULT 0,
  rounds_played INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Libro contable: cada movimiento de fichas queda registrado
CREATE TABLE IF NOT EXISTS ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  ts            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id DESC);

-- Una fila por ronda jugada
CREATE TABLE IF NOT EXISTS rounds (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game    TEXT NOT NULL,
  bet     INTEGER NOT NULL,
  payout  INTEGER NOT NULL,
  detail  TEXT,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds(game, id DESC);

-- Partidas a medio jugar (blackjack, minas, crash)
CREATE TABLE IF NOT EXISTS active (
  user_id    INTEGER NOT NULL,
  game       TEXT NOT NULL,
  state      TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let A = null;
export const bindAdapter = (adapter) => { A = adapter; };
export const initSchema = () => A.exec(SCHEMA);

/** Misma forma que usaba antes el código: db.prepare(sql).get / all / run */
export const db = {
  prepare: (sql) => ({
    get: (...p) => A.all(sql, p)[0],
    all: (...p) => A.all(sql, p),
    run: (...p) => A.run(sql, p),
  }),
};

/** Ejecuta fn dentro de una transacción: o se guarda todo o no se guarda nada. */
export const tx = (fn) => A.tx(fn);

const qGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const qSetSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
export const getSetting = (key) => qGetSetting.get(key)?.value ?? null;
export const setSetting = (key, value) => qSetSetting.run(key, String(value));

// Partidas activas
const qGetActive = db.prepare('SELECT state, started_at FROM active WHERE user_id = ? AND game = ?');
const qPutActive = db.prepare(
  `INSERT INTO active (user_id, game, state, started_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id, game) DO UPDATE SET state = excluded.state, started_at = excluded.started_at`
);
const qDelActive = db.prepare('DELETE FROM active WHERE user_id = ? AND game = ?');

export function getActive(userId, game) {
  const row = qGetActive.get(userId, game);
  return row ? JSON.parse(row.state) : null;
}
export function putActive(userId, game, state) {
  qPutActive.run(userId, game, JSON.stringify(state), Date.now());
}
export function delActive(userId, game) {
  qDelActive.run(userId, game);
}
