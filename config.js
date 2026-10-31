// Configuración del casino. Todo lo que quieras cambiar está acá.
export const CONFIG = {
  // Nombre que aparece en la página (también se puede cambiar con la variable CASINO_NAME en Cloudflare)
  name: 'Casino',

  // Código para registrarse. Se lee de la variable INVITE_CODE (la cargás en Cloudflare).
  inviteCode: null,

  // Fichas
  startingChips: 10000,
  minBet: 10,
  maxBet: 100000,

  // Bono diario: base + extra por cada día seguido (hasta maxStreak días)
  dailyBonus: { base: 1000, perStreak: 250, maxStreak: 7, cooldownHours: 20, streakWindowHours: 44 },

  // Fichas de rescate si te quedás casi sin nada
  rescue: { threshold: 100, amount: 2000, cooldownHours: 6 },

  // Sesiones
  sessionDays: 30,
};

/** Toma las variables que cargás en Cloudflare (CASINO_NAME, INVITE_CODE). */
export function applyEnv(env = {}) {
  if (env.CASINO_NAME) CONFIG.name = String(env.CASINO_NAME).slice(0, 40);
  if (env.INVITE_CODE) CONFIG.inviteCode = String(env.INVITE_CODE).trim().toUpperCase();
}
