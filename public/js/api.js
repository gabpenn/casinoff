// Comunicación con el servidor.
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthenticated = () => {};
export const setUnauthenticatedHandler = (fn) => (onUnauthenticated = fn);

async function call(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError('No hay conexión con el casino. Revisá que el servidor esté prendido.', 0, 'network');
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && data.code === 'unauthenticated') onUnauthenticated();
    throw new ApiError(data.error || 'Algo salió mal.', res.status, data.code);
  }
  return data;
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body),
};
