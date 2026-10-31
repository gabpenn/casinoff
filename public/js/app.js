// Armado de la página: pantalla de ingreso, barra superior, lobby, rutas.
import { api, setUnauthenticatedHandler } from './api.js';
import { wallet } from './wallet.js';
import { sfx } from './sfx.js';
import { fx } from './fx.js';
import { el, $, fmt, ago, timeLeft, GAME_NAMES, sleep } from './util.js';
import { toast, modal, ART, LOGO } from './ui.js';

const app = document.getElementById('app');

const ctx = { api, wallet, sfx, fx, toast, user: null, config: null, refreshUser };

const VIEWS = {
  roulette: () => import('./games/roulette.js'),
  slots: () => import('./games/slots.js'),
  blackjack: () => import('./games/blackjack.js'),
  crash: () => import('./games/crash.js'),
  plinko: () => import('./games/plinko.js'),
  mines: () => import('./games/mines.js'),
  dice: () => import('./games/dice.js'),
};

const TILES = [
  ['roulette', 'Ruleta', 'Europea, con un solo cero. Apostá a números, colores y más.', 'Clásico'],
  ['slots', 'Tragamonedas', '5 líneas y giros gratis con premios x2.', 'Giros gratis'],
  ['blackjack', 'Blackjack', 'Ganale a la banca. Paga 3 a 2.'],
  ['crash', 'Crash', 'Retirate antes de que se caiga.'],
  ['plinko', 'Plinko', 'Soltá la bolita y mirá dónde cae.'],
  ['mines', 'Minas', 'Destapá gemas y evitá las bombas.'],
  ['dice', 'Dados', 'Elegí tu probabilidad. Vos mandás.'],
];

let cleanup = null;
let feedTimer = 0;

// ------------------------------------------------------------------ Arranque
async function boot() {
  setUnauthenticatedHandler(() => {
    if (ctx.user) {
      ctx.user = null;
      showAuth();
    }
  });
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  window.addEventListener('hashchange', route);
  try {
    const me = await api.get('/me');
    applyMe(me);
    buildShell();
    route();
  } catch (err) {
    if (err.code === 'network') {
      app.replaceChildren(el('main', {}, el('div', { class: 'panel' }, el('h2', {}, 'Sin conexión'), el('p', {}, err.message))));
    } else showAuth();
  }
}

function applyMe(me) {
  ctx.user = me.user;
  ctx.config = me.config;
  document.title = me.config.name;
  wallet.setServer(me.user.balance, { instant: true });
}

async function refreshUser() {
  const me = await api.get('/me');
  ctx.user = me.user;
  ctx.config = me.config;
  wallet.setServer(me.user.balance);
  paintBonus();
  return me.user;
}

// ------------------------------------------------------------------ Ingreso
async function showAuth() {
  cleanup?.();
  cleanup = null;
  clearInterval(feedTimer);
  let name = 'Casino';
  try { name = (await api.get('/config')).name; } catch {}
  document.title = name;
  let mode = 'login';
  const err = el('div', { class: 'err', role: 'alert' });
  const user = el('input', { type: 'text', autocomplete: 'username', required: true, maxLength: 20 });
  const pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const invite = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters' });
  const inviteField = el('label', { class: 'field hidden' }, el('span', {}, 'Código de invitación'), invite);
  const submit = el('button', { class: 'btn primary big', type: 'submit' }, 'Entrar');
  const tabLogin = el('button', { class: 'btn', type: 'button', 'aria-pressed': 'true' }, 'Entrar');
  const tabReg = el('button', { class: 'btn ghost', type: 'button', 'aria-pressed': 'false' }, 'Crear cuenta');
  const setMode = (m) => {
    mode = m;
    inviteField.classList.toggle('hidden', m === 'login');
    submit.textContent = m === 'login' ? 'Entrar' : 'Crear cuenta';
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    tabLogin.className = 'btn' + (m === 'login' ? '' : ' ghost');
    tabReg.className = 'btn' + (m === 'register' ? '' : ' ghost');
    err.textContent = '';
  };
  tabLogin.onclick = () => setMode('login');
  tabReg.onclick = () => setMode('register');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.textContent = '';
      try {
        await api.post(mode === 'login' ? '/login' : '/register', { username: user.value, password: pass.value, invite: invite.value });
        applyMe(await api.get('/me'));
        buildShell();
        location.hash = '#/';
        route();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        submit.disabled = false;
      }
    },
  },
    el('div', { class: 'tabs' }, tabLogin, tabReg),
    el('label', { class: 'field' }, el('span', {}, 'Usuario'), user),
    el('label', { class: 'field' }, el('span', {}, 'Contraseña'), pass),
    inviteField,
    err,
    submit,
    el('p', { class: 'fineprint' }, 'Las fichas son virtuales: no valen plata y no se pueden cambiar por nada. Es solo para divertirse.'),
  );

  const mountains = `<svg class="mountains" viewBox="0 0 800 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8b94a" stop-opacity=".0"/><stop offset="1" stop-color="#e8b94a" stop-opacity=".25"/></linearGradient></defs>
    <circle cx="470" cy="130" r="46" fill="#f7dc92" opacity=".9"/>
    <path d="M0 400V250l90-90 60 50 110-130 120 150 70-60 130 120 100-80 120 120v120z" fill="#1d4d66"/>
    <path d="M0 400V300l110-70 80 60 120-100 110 110 90-50 130 90 160-90v250z" fill="#10354a"/>
    <path d="M0 400V340l140-50 120 40 140-70 120 60 110-30 170 50v160z" fill="#0a2536"/>
    <g fill="#071a26">${Array.from({ length: 26 }, (_, i) => `<path d="M${i * 32 + 6} 400l9-44 9 44z"/><path d="M${i * 32 + 8} 372l7-34 7 34z"/>`).join('')}</g>
  </svg>`;

  app.replaceChildren(el('div', { class: 'auth' },
    el('section', { class: 'hero', html: mountains + `<h1>${name.replace(/</g, '&lt;')}</h1><p>Ruleta, tragamonedas, blackjack y más. Con fichas de mentira y amigos de verdad.</p>` }),
    el('section', { class: 'form-side' }, form),
  ));
  user.focus();
}

// ------------------------------------------------------------------ Estructura
let balanceEl, bonusBtn, rescueBtn, soundBtn, viewEl;

function buildShell() {
  const name = ctx.config.name;
  balanceEl = el('span', {}, '0');
  const balance = el('div', { class: 'balance', title: 'Tus fichas' }, el('span', { class: 'dot' }), balanceEl);
  let last = wallet.display;
  wallet.subscribe((v) => {
    balanceEl.textContent = fmt(v);
    if (v > last + 0.5) { balance.classList.remove('down'); balance.classList.add('up'); }
    else if (v < last - 0.5) { balance.classList.remove('up'); balance.classList.add('down'); }
    last = v;
    clearTimeout(balance._t);
    balance._t = setTimeout(() => balance.classList.remove('up', 'down'), 700);
  });

  bonusBtn = el('button', { class: 'btn small bonus-btn', onclick: claimDaily }, 'Bono diario');
  rescueBtn = el('button', { class: 'btn small primary hidden', onclick: claimRescue }, 'Fichas de rescate');
  soundBtn = el('button', { class: 'iconbtn', 'aria-label': 'Sonido', onclick: () => { soundBtn.textContent = sfx.toggle() ? '🔊' : '🔇'; } }, sfx.enabled ? '🔊' : '🔇');
  const me = el('button', { class: 'btn small', onclick: openProfile, 'aria-label': 'Mi cuenta' }, ctx.user.username);

  viewEl = el('main', { id: 'view' });
  app.replaceChildren(
    el('header', { class: 'topbar' },
      el('a', { class: 'brand', href: '#/', html: LOGO + `<span>${name.replace(/</g, '&lt;')}</span>` }),
      el('span', { class: 'spacer' }),
      rescueBtn, bonusBtn, balance, soundBtn, me,
    ),
    viewEl,
  );
  paintBonus();
  clearInterval(buildShell._t);
  buildShell._t = setInterval(paintBonus, 30000);
}

function paintBonus() {
  if (!bonusBtn || !ctx.user) return;
  const d = ctx.user.daily;
  const ready = d.ready || Date.now() >= d.availableAt;
  bonusBtn.classList.toggle('ready', ready);
  bonusBtn.textContent = ready ? `Bono diario +${fmt(d.amount)}` : `Bono en ${timeLeft(d.availableAt - Date.now())}`;
  bonusBtn.disabled = !ready;
  const r = ctx.user.rescue;
  rescueBtn.classList.toggle('hidden', !(r.ready && Date.now() >= r.availableAt - 1));
  rescueBtn.textContent = `Fichas de rescate +${fmt(r.amount)}`;
}

async function claimDaily() {
  try {
    const r = await api.post('/bonus/daily');
    sfx.bonus();
    fx.burst(innerWidth / 2, 80, 50);
    toast(`Bono diario cobrado: +${fmt(r.amount)} fichas (racha de ${r.streak} ${r.streak === 1 ? 'día' : 'días'})`, 'ok');
    await refreshUser();
  } catch (e) { toast(e.message, 'error'); }
}

async function claimRescue() {
  try {
    const r = await api.post('/bonus/rescue');
    sfx.bonus();
    toast(`Te dimos ${fmt(r.amount)} fichas para seguir jugando.`, 'ok');
    await refreshUser();
  } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ Rutas
async function route() {
  if (!ctx.user) return;
  cleanup?.();
  cleanup = null;
  clearInterval(feedTimer);
  const name = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  viewEl.replaceChildren();
  window.scrollTo(0, 0);
  try {
    if (name === 'admin' && ctx.user.isAdmin) cleanup = await mountAdmin(viewEl);
    else if (VIEWS[name]) {
      const mod = await VIEWS[name]();
      cleanup = (await mod.mount(viewEl, ctx)) ?? null;
    } else cleanup = await mountLobby(viewEl);
  } catch (e) {
    console.error(e);
    viewEl.replaceChildren(el('div', { class: 'panel' }, el('h2', {}, 'No se pudo abrir esta sección'), el('p', {}, e.message), el('a', { class: 'btn', href: '#/' }, 'Volver al lobby')));
  }
}

// ------------------------------------------------------------------ Lobby
async function mountLobby(root) {
  const items = el('div', { class: 'items' });
  const ticker = el('div', { class: 'ticker' }, el('span', { class: 'live' }, 'EN VIVO'), items);
  const grid = el('div', { class: 'lobby-grid' }, TILES.map(([id, title, text, tag]) =>
    el('a', { class: `tile t-${id}`, href: `#/${id}`, html: `${ART[id]}${tag ? `<span class="tag">${tag}</span>` : ''}<h2>${title}</h2><p>${text}</p>` })));
  const boards = el('div', { class: 'lobby-cols' });
  root.append(
    el('div', { class: 'page-title' }, el('h1', {}, `Hola, ${ctx.user.username}`), el('p', {}, 'Elegí una mesa. Todas las jugadas las decide el servidor del casino.')),
    ticker, grid, boards,
  );

  let alive = true;
  const loadFeed = async () => {
    try {
      const { feed } = await api.get('/feed');
      if (!alive) return;
      items.replaceChildren(...(feed.length
        ? feed.map((f) => el('span', {}, el('b', {}, f.username), ` ganó ${fmt(f.payout)} en ${GAME_NAMES[f.game] ?? f.game} `, el('em', { class: 'muted' }, `(x${(f.payout / f.bet).toFixed(1)})`)))
        : [el('span', { class: 'muted' }, 'Todavía no hay premios grandes. El primero puede ser tuyo.')]));
      if (feed.length < 3) items.style.animation = 'none', items.style.paddingLeft = '0';
      else items.style.animation = '', items.style.paddingLeft = '';
    } catch {}
  };
  const loadBoards = async () => {
    try {
      const lb = await api.get('/leaderboard');
      if (!alive) return;
      const table = (head, rows) => el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i ? 'num' : '' }, h)))), el('tbody', {}, rows));
      boards.replaceChildren(
        el('section', { class: 'panel' }, el('h3', {}, 'Más fichas'),
          table(['Jugador', 'Fichas'], lb.balance.map((u, i) => el('tr', {}, el('td', {}, `${i + 1}. ${u.username}`), el('td', { class: 'num gold' }, fmt(u.balance)))))),
        el('section', { class: 'panel' }, el('h3', {}, 'Mayores premios'),
          lb.wins.length ? table(['Jugador', 'Premio'], lb.wins.map((u) => el('tr', {}, el('td', {}, `${u.username} · ${GAME_NAMES[u.game] ?? u.game}`), el('td', { class: 'num gold' }, '+' + fmt(u.payout - u.bet)))))
            : el('p', { class: 'muted' }, 'Todavía no hay premios registrados.')),
      );
    } catch {}
  };
  loadFeed();
  loadBoards();
  feedTimer = setInterval(() => { loadFeed(); loadBoards(); }, 12000);
  if (ctx.user.isAdmin) root.append(el('p', {}, el('a', { class: 'btn small', href: '#/admin' }, 'Panel del dueño')));
  return () => { alive = false; };
}

// ------------------------------------------------------------------ Mi cuenta
async function openProfile() {
  const body = el('div', {}, el('p', { class: 'muted' }, 'Cargando...'));
  const close = modal('Mi cuenta', body);
  try {
    await refreshUser();
    const h = await api.get('/history');
    const s = ctx.user.stats;
    const net = s.won - s.wagered;
    body.replaceChildren(
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat' }, el('small', {}, 'Rondas jugadas'), el('b', {}, fmt(s.rounds))),
        el('div', { class: 'stat' }, el('small', {}, 'Total apostado'), el('b', {}, fmt(s.wagered))),
        el('div', { class: 'stat' }, el('small', {}, 'Balance de ganancias'), el('b', { class: net >= 0 ? 'win' : 'lose' }, (net >= 0 ? '+' : '') + fmt(net))),
        el('div', { class: 'stat' }, el('small', {}, 'Mejor premio'), el('b', { class: 'gold' }, h.best ? '+' + fmt(h.best.payout - h.best.bet) : '—')),
      ),
      el('h3', { style: { margin: '16px 0 6px' } }, 'Últimas jugadas'),
      h.rounds.length
        ? el('table', { class: 'tbl' }, el('tbody', {}, h.rounds.slice(0, 15).map((r) => el('tr', {},
          el('td', {}, GAME_NAMES[r.game] ?? r.game), el('td', { class: 'muted' }, ago(r.ts)),
          el('td', { class: `num ${r.payout >= r.bet ? 'win' : 'lose'}` }, (r.payout - r.bet >= 0 ? '+' : '') + fmt(r.payout - r.bet))))))
        : el('p', { class: 'muted' }, 'Todavía no jugaste ninguna ronda.'),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '16px' } },
        ctx.user.isAdmin ? el('a', { class: 'btn', href: '#/admin', onclick: () => close() }, 'Panel del dueño') : null,
        el('button', { class: 'btn danger', onclick: async () => { await api.post('/logout').catch(() => {}); close(); ctx.user = null; showAuth(); } }, 'Cerrar sesión')),
    );
  } catch (e) { body.textContent = e.message; }
}

// ------------------------------------------------------------------ Panel del dueño
async function mountAdmin(root) {
  const wrap = el('div');
  root.append(el('a', { class: 'back', href: '#/' }, '← Lobby'), el('div', { class: 'page-title' }, el('h1', {}, 'Panel del dueño'), el('p', {}, 'Regalá fichas, suspendé cuentas y manejá el código de invitación.')), wrap);
  let alive = true;
  const load = async () => {
    const d = await api.get('/admin/users');
    if (!alive) return;
    const inviteBox = el('div', { class: 'panel' },
      el('h3', {}, 'Código de invitación'),
      el('p', {}, 'Pasale este código a tus amigos para que se puedan registrar: ', el('b', { class: 'gold', style: { fontSize: '1.3rem', letterSpacing: '.12em' } }, d.invite)),
      el('button', { class: 'btn small', onclick: async () => { await api.post('/admin/invite'); toast('Código nuevo generado. El anterior ya no sirve.', 'ok'); load(); } }, 'Generar código nuevo'),
      el('p', { class: 'fineprint' }, `Ganancia acumulada de la casa: ${fmt(d.houseProfit)} fichas.`));
    const rows = d.users.map((u) => {
      const amount = el('input', { type: 'number', placeholder: 'fichas', 'aria-label': `Fichas para ${u.username}` });
      const act = async (fn, ok) => { try { await fn(); toast(ok, 'ok'); load(); } catch (e) { toast(e.message, 'error'); } };
      return el('tr', {},
        el('td', {}, u.username + (u.isAdmin ? ' (dueño)' : ''), u.banned ? el('span', { class: 'lose' }, ' · suspendido') : null),
        el('td', { class: 'num gold' }, fmt(u.balance)),
        el('td', { class: 'num' }, fmt(u.rounds)),
        el('td', {}, el('div', { class: 'admin-actions' },
          amount,
          el('button', { class: 'btn small', onclick: () => act(() => api.post('/admin/grant', { userId: u.id, amount: Number(amount.value) }), 'Listo, fichas actualizadas.') }, 'Dar / quitar'),
          u.isAdmin ? null : el('button', { class: 'btn small', onclick: () => act(() => api.post('/admin/ban', { userId: u.id, banned: !u.banned }), u.banned ? 'Cuenta reactivada.' : 'Cuenta suspendida.') }, u.banned ? 'Reactivar' : 'Suspender'),
          el('button', { class: 'btn small', onclick: () => { const p = prompt(`Nueva contraseña para ${u.username} (mínimo 6 caracteres):`); if (p) act(() => api.post('/admin/password', { userId: u.id, password: p }), 'Contraseña cambiada.'); } }, 'Cambiar clave'))));
    });
    wrap.replaceChildren(inviteBox, el('div', { style: { height: '14px' } }), el('div', { class: 'panel', style: { overflowX: 'auto' } },
      el('h3', {}, `Jugadores (${d.users.length})`),
      el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'Usuario'), el('th', { class: 'num' }, 'Fichas'), el('th', { class: 'num' }, 'Rondas'), el('th', {}, 'Acciones'))), el('tbody', {}, rows))));
  };
  await load();
  return () => { alive = false; };
}

boot();
void $;
void sleep;
