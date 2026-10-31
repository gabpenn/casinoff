// Adaptadores: conectan lib/db.js con el SQLite de cada lugar.

/** Cloudflare: el SQLite que vive dentro del Durable Object. */
export function durableObjectAdapter(storage) {
  const sql = storage.sql;
  return {
    exec: (q) => void sql.exec(q).toArray(),
    all: (q, p) => sql.exec(q, ...p).toArray(),
    run(q, p) {
      sql.exec(q, ...p).toArray();
      const r = sql.exec('SELECT changes() AS c, last_insert_rowid() AS id').one();
      return { changes: r.c, lastInsertRowid: r.id };
    },
    tx: (fn) => storage.transactionSync(fn),
  };
}
