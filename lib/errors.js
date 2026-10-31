// Error "esperable" (apuesta inválida, sin fichas, etc.). El mensaje se le muestra al jugador.
export class GameError extends Error {
  constructor(message, status = 400, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
