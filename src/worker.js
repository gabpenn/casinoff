// Casino en Cloudflare. Las páginas (carpeta public) las sirve Cloudflare solo; todo lo que empieza
// con /api pasa por acá y va a UN solo "Durable Object", que guarda la base de datos y decide
// el azar. Al ser uno solo, nunca se pisan dos jugadas al mismo tiempo.
import { DurableObject } from 'cloudflare:workers';
import { applyEnv } from '../config.js';
import { bindAdapter, initSchema } from '../lib/db.js';
import { createApp } from '../lib/http.js';
import { userFromToken, getInviteCode } from '../lib/auth.js';
import { registerRoutes } from '../routes.js';
import { durableObjectAdapter } from './adapters.js';

export class Casino extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    applyEnv(env);
    bindAdapter(durableObjectAdapter(ctx.storage));
    ctx.blockConcurrencyWhile(async () => {
      initSchema();
      getInviteCode();
    });
    this.app = createApp({ getUser: userFromToken });
    registerRoutes(this.app);
  }

  fetch(request) {
    return this.app.handle(request);
  }
}

export default {
  fetch(request, env) {
    const stub = env.CASINO.get(env.CASINO.idFromName('principal'));
    return stub.fetch(request);
  },
};
