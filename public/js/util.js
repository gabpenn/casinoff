// Utilidades chicas que usa toda la página.

/** Crea un elemento: el('div', {class:'x', onclick: fn}, 'texto', otroElemento) */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in e && k !== 'list' && k !== 'form') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const fmt = (n) => Math.round(n).toLocaleString('es-AR');
export const fmtMult = (m) => (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1).replace(/\.0$/, '') : m.toFixed(2)) + 'x';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fichas en versión corta: 1.500 -> 1,5K */
export function short(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'K';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function timeLeft(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

export function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export const GAME_NAMES = {
  roulette: 'Ruleta', slots: 'Tragamonedas', blackjack: 'Blackjack', crash: 'Crash', plinko: 'Plinko', mines: 'Minas', dice: 'Dados',
};

/** Guarda/lee preferencias chicas en el navegador */
export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('cp.' + k);
      return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('cp.' + k, JSON.stringify(v)); } catch {}
  },
};
