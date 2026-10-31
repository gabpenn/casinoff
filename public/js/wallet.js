// Saldo que se ve en pantalla.
// El servidor ya resolvió la jugada, pero el premio se "esconde" hasta que termina la animación
// (así el saldo no se adelanta al suspenso). display = saldo real - premios todavía no revelados.
import { fmt } from './util.js';

let server = 0;
let hidden = 0;
let shown = 0;
let anim = 0;
const subs = new Set();

function paint() {
  subs.forEach((fn) => fn(shown));
}

function animateTo(target) {
  cancelAnimationFrame(anim);
  const from = shown;
  if (from === target) return paint();
  const t0 = performance.now();
  const dur = Math.min(900, 250 + Math.abs(target - from) / 40);
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    shown = from + (target - from) * (1 - (1 - k) ** 3);
    paint();
    if (k < 1) anim = requestAnimationFrame(tick);
    else {
      shown = target;
      paint();
    }
  };
  anim = requestAnimationFrame(tick);
}

export const wallet = {
  get display() { return server - hidden; },
  get server() { return server; },
  subscribe(fn) { subs.add(fn); fn(shown); return () => subs.delete(fn); },
  /** Fija el saldo real (viene del servidor) */
  setServer(b, { instant = false } = {}) {
    server = b;
    if (instant) { shown = server - hidden; cancelAnimationFrame(anim); paint(); }
    else animateTo(server - hidden);
  },
  /**
   * Registra el resultado de una jugada: el saldo baja por la apuesta ya mismo
   * y el premio se muestra cuando se llame a reveal().
   */
  settle(balanceAfter, payout) {
    server = balanceAfter;
    hidden += payout;
    let left = payout;
    animateTo(server - hidden);
    return {
      /** Revela una parte (o todo lo que quede si no se indica monto) del premio */
      reveal(amount = left) {
        const a = Math.min(amount, left);
        left -= a;
        hidden -= a;
        animateTo(server - hidden);
      },
    };
  },
  fmt,
};
