// Piezas de interfaz compartidas: avisos, ventanas, control de apuesta, ilustraciones.
import { el, fmt, clamp, store } from './util.js';
import { sfx } from './sfx.js';
import { wallet } from './wallet.js';

export function toast(msg, type = '') {
  const t = el('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 5000 : 3200);
}

export function modal(title, content) {
  const root = document.getElementById('modal-root');
  const prev = document.activeElement;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const box = el('div', { class: 'panel modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('header', {}, el('h2', {}, title), el('button', { class: 'btn small ghost', onclick: close, 'aria-label': 'Cerrar' }, '✕')),
    content);
  const back = el('div', { class: 'modal-back', onclick: (e) => e.target === back && close() }, box);
  root.append(back);
  document.addEventListener('keydown', onKey);
  box.querySelector('button')?.focus();
  return close;
}

/** Control de apuesta: campo numérico + ½ / 2× / Máx. */
export function betControl({ game, min, max, step = 1, label = 'Apuesta', start = 100 }) {
  const saved = store.get('bet.' + game, start);
  const input = el('input', { type: 'number', inputMode: 'numeric', min, max, step, value: saved, 'aria-label': label });
  const norm = (v) => clamp(Math.round((Number(v) || min) / step) * step, min, max);
  const set = (v) => {
    input.value = norm(v);
    store.set('bet.' + game, Number(input.value));
  };
  input.addEventListener('change', () => { set(input.value); sfx.click(); });
  const btn = (txt, fn, title) => el('button', { class: 'btn small', type: 'button', title, onclick: () => { sfx.click(); fn(); } }, txt);
  const root = el('div', { class: 'bet' },
    el('label', { class: 'field' }, el('span', {}, label), el('div', { class: 'bet-row' },
      input,
      btn('½', () => set(Number(input.value) / 2), 'Mitad'),
      btn('2×', () => set(Number(input.value) * 2), 'Doble'),
      btn('Máx', () => set(Math.min(max, Math.floor(wallet.display / step) * step || min)), 'Todo lo que tengas (hasta el máximo)'),
    )),
    el('div', { class: 'bet-presets' }, [10, 100, 500, 1000, 5000].filter((v) => v >= min && v <= max).map((v) => btn(fmt(v), () => set(v)))),
  );
  const buttons = () => root.querySelectorAll('button');
  return {
    el: root,
    get value() { return norm(input.value); },
    set,
    disable(b) { input.disabled = b; buttons().forEach((x) => (x.disabled = b)); },
  };
}

/** Control segmentado: seg([{value,label}], valorInicial, onChange) */
export function seg(options, value, onChange) {
  const root = el('div', { class: 'seg', role: 'group' });
  let current = value;
  const paint = () => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(current))));
  for (const o of options) {
    root.append(el('button', {
      type: 'button', 'data-v': o.value,
      onclick: () => { current = o.value; paint(); sfx.click(); onChange?.(o.value); },
    }, o.label));
  }
  paint();
  return {
    el: root,
    get value() { return current; },
    set(v) { current = v; paint(); },
    disable(b) { root.querySelectorAll('button').forEach((x) => (x.disabled = b)); },
  };
}

// ---------- Ilustraciones de las tarjetas del lobby ----------
const dice = (x, y, rot, pips) => {
  const dots = pips.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="3.4" fill="#2a1030"/>`).join('');
  return `<g transform="translate(${x} ${y}) rotate(${rot} 20 20)"><rect width="40" height="40" rx="8" fill="#fff"/>${dots}</g>`;
};

export const ART = {
  roulette: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#3d2a12" stroke="#cfae5a" stroke-width="3"/><circle cx="50" cy="50" r="34" fill="none" stroke="#b3202a" stroke-width="16" stroke-dasharray="5.77 5.77"/><circle cx="50" cy="50" r="34" fill="none" stroke="#14181c" stroke-width="16" stroke-dasharray="5.77 5.77" stroke-dashoffset="-5.77"/><circle cx="50" cy="50" r="22" fill="#0f5a49" stroke="#cfae5a" stroke-width="2"/><circle cx="50" cy="50" r="5" fill="#e8b94a"/><circle cx="77" cy="27" r="3.4" fill="#fff"/></svg>`,
  slots: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true"><rect x="6" y="22" width="88" height="56" rx="10" fill="#140d3a" stroke="#e8b94a" stroke-width="3"/><rect x="12" y="28" width="24" height="44" rx="4" fill="#fffdf6"/><rect x="38" y="28" width="24" height="44" rx="4" fill="#fffdf6"/><rect x="64" y="28" width="24" height="44" rx="4" fill="#fffdf6"/><text x="24" y="58" text-anchor="middle" font-size="26" font-weight="900" font-style="italic" fill="#d4271f" stroke="#7a0d09" stroke-width="1" font-family="Georgia,serif">7</text><text x="50" y="58" text-anchor="middle" font-size="26" font-weight="900" font-style="italic" fill="#d4271f" stroke="#7a0d09" stroke-width="1" font-family="Georgia,serif">7</text><text x="76" y="58" text-anchor="middle" font-size="26" font-weight="900" font-style="italic" fill="#d4271f" stroke="#7a0d09" stroke-width="1" font-family="Georgia,serif">7</text></svg>`,
  blackjack: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true"><g transform="rotate(-14 40 56)"><rect x="14" y="20" width="46" height="66" rx="6" fill="#fffdf8"/><text x="22" y="40" font-size="17" font-weight="700" fill="#14181c" font-family="Georgia,serif">A</text><text x="37" y="68" font-size="26" fill="#14181c">♠</text></g><g transform="rotate(10 64 56)"><rect x="40" y="16" width="46" height="66" rx="6" fill="#fffdf8"/><text x="48" y="36" font-size="17" font-weight="700" fill="#c11f2b" font-family="Georgia,serif">K</text><text x="62" y="64" font-size="26" fill="#c11f2b">♥</text></g></svg>`,
  crash: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true"><path d="M8 88 C 40 86, 62 70, 90 14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M8 88 C 40 86, 62 70, 90 14 L90 88 Z" fill="rgba(255,255,255,.18)"/><circle cx="90" cy="14" r="7" fill="#f7dc92"/></svg>`,
  plinko: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true">${[0, 1, 2, 3, 4].map((r) => Array.from({ length: r + 1 }, (_, i) => `<circle cx="${50 + (i - r / 2) * 16}" cy="${18 + r * 15}" r="3.2" fill="#fff"/>`).join('')).join('')}<circle cx="58" cy="42" r="6" fill="#e8b94a" stroke="#8a5d0c" stroke-width="1.5"/></svg>`,
  mines: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true"><path d="M30 20 52 20 64 36 41 62 18 36Z" fill="#3fe0a0" stroke="#0c5a4a" stroke-width="2"/><path d="M18 36 64 36M30 20 41 36 52 20" stroke="#0c5a4a" stroke-width="1.5" fill="none"/><circle cx="70" cy="68" r="17" fill="#1a1f2b" stroke="#6b7388" stroke-width="2"/><path d="M70 51v-9" stroke="#c9a24a" stroke-width="4" stroke-linecap="round"/><circle cx="70" cy="40" r="4" fill="#ff6f6f"/></svg>`,
  dice: `<svg viewBox="0 0 100 100" class="art" aria-hidden="true">${dice(10, 40, -12, [[12, 12], [28, 28], [12, 28], [28, 12], [20, 20]])}${dice(52, 14, 14, [[12, 12], [20, 20], [28, 28]])}</svg>`,
};

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0c2230" stroke="#24516b"/><path d="M6 50 22 24l9 14 7-9 20 21z" fill="#e8b94a"/><path d="M22 24l-6 11 6-4 5 5z" fill="#fff6d6" opacity=".8"/><circle cx="46" cy="16" r="6" fill="#c9402f"/></svg>`;
