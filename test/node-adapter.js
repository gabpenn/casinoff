// Para las pruebas: SQLite de Node en memoria, con la misma forma que el de Cloudflare.
import { DatabaseSync } from 'node:sqlite';

export function nodeAdapter() {
  const d = new DatabaseSync(':memory:');
  return {
    exec: (q) => d.exec(q),
    all: (q, p) => d.prepare(q).all(...p),
    run: (q, p) => {
      const r = d.prepare(q).run(...p);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    tx(fn) {
      d.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        d.exec('COMMIT');
        return out;
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
