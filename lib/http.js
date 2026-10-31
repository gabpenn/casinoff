// Router de la API, hecho con las piezas estándar de la web (Request / Response),
// que son las que entiende Cloudflare.
import { GameError } from './errors.js';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

// Límite simple de pedidos por segundo por IP (protege de abusos básicos)
const hits = new Map();
function tooMany(ip, limit = 60) {
  const sec = Math.floor(Date.now() / 1000);
  const h = hits.get(ip);
  if (!h || h.sec !== sec) {
    hits.set(ip, { sec, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.sec < sec - 5) hits.delete(k);
    return false;
  }
  return ++h.n > limit;
}

// Límite de intentos de login/registro
const attempts = new Map();
export function checkAttempts(key, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    if (attempts.size > 5000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
    return;
  }
  if (++a.n > max) throw new GameError('Demasiados intentos. Esperá unos minutos y probá de nuevo.', 429, 'rate_limit');
}
export const clearAttempts = (key) => attempts.delete(key);

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(status, data, cookies = []) {
  const headers = new Headers(BASE_HEADERS);
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(data), { status, headers });
}

export function createApp({ getUser }) {
  const routes = new Map();
  const add = (method) => (route, opts, handler) => {
    if (typeof opts === 'function') [handler, opts] = [opts, {}];
    routes.set(`${method} ${route}`, { handler, auth: opts.auth !== false, admin: !!opts.admin });
  };

  async function handle(request) {
    try {
      const url = new URL(request.url);
      const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
      if (tooMany(ip)) throw new GameError('Vas muy rápido, esperá un momento.', 429, 'rate_limit');

      const route = routes.get(`${request.method} ${url.pathname}`);
      if (!route) return json(404, { error: 'No encontrado.' });

      let body = {};
      if (request.method === 'POST') {
        const origin = request.headers.get('origin');
        if (origin) {
          let host = '';
          try {
            host = new URL(origin).host;
          } catch {}
          if (host !== url.host) throw new GameError('Origen no permitido.', 403);
        }
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json'))
          throw new GameError('Formato no soportado.', 415);
        const raw = await request.text();
        if (raw.length > 32 * 1024) throw new GameError('El pedido es demasiado grande.', 413);
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            throw new GameError('JSON inválido.');
          }
        }
      }

      const secure = url.protocol === 'https:';
      const ctx = {
        body,
        query: url.searchParams,
        ip,
        token: parseCookies(request.headers.get('cookie') ?? '').sid || null,
        user: null,
        cookies: [],
        setCookie(name, value, { maxAge, clear } = {}) {
          let c = `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/`;
          if (clear) c += '; Max-Age=0';
          else if (maxAge) c += `; Max-Age=${maxAge}`;
          if (secure) c += '; Secure';
          this.cookies.push(c);
        },
      };

      if (route.auth) {
        const user = await getUser(ctx.token);
        if (!user) throw new GameError('Iniciá sesión para continuar.', 401, 'unauthenticated');
        if (user.banned) throw new GameError('Esta cuenta está suspendida.', 403, 'banned');
        if (route.admin && !user.is_admin) throw new GameError('No tenés permiso para hacer esto.', 403);
        ctx.user = user;
      }

      const result = (await route.handler(ctx)) ?? {};
      return json(200, result, ctx.cookies);
    } catch (err) {
      if (err instanceof GameError) return json(err.status, { error: err.message, code: err.code });
      console.error('[error]', err);
      return json(500, { error: 'Error interno del servidor.' });
    }
  }

  return { get: add('GET'), post: add('POST'), handle };
}
