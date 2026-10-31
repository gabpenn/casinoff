// Azar de verdad: generador criptográfico del sistema (el mismo que usan los bancos).
// Todo el azar del casino pasa por acá y se decide SOLO en el servidor.
const TWO32 = 2 ** 32;
const TWO53 = 2 ** 53;
const buf = new Uint32Array(2);

/** Entero uniforme en [min, max), sin sesgo (descarta los valores que lo causarían). */
export function int(min, max) {
  const range = max - min;
  if (!(range > 0) || range > TWO53) throw new RangeError('rango inválido');
  if (range <= TWO32) {
    const limit = TWO32 - (TWO32 % range);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return min + (buf[0] % range);
    }
  }
  const limit = TWO53 - (TWO53 % range);
  for (;;) {
    crypto.getRandomValues(buf);
    const x = (buf[0] & 0x1fffff) * TWO32 + buf[1]; // 53 bits
    if (x < limit) return min + (x % range);
  }
}

const SPAN = 2 ** 46;

/** Decimal en [0, 1) */
export const float = () => int(0, SPAN) / SPAN;

/** Mezcla un array (Fisher-Yates) */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = int(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
