// Pruebas del casino: simula miles de partidas con los juegos reales y verifica que la ventaja
// de la casa sea la esperada (RTP = "retorno al jugador": 96% significa que de cada 100 apostados
// se devuelven 96 a la larga). Uso: npm test   (o  QUICK=1 npm test  para una versión rápida)
const { db, bindAdapter, initSchema } = await import('../lib/db.js');
const { nodeAdapter } = await import('./node-adapter.js');
bindAdapter(nodeAdapter());
initSchema();
(await import('../config.js')).applyEnv({ INVITE_CODE: 'TESTCODE' });
const auth = await import('../lib/auth.js');
const { balanceOf } = await import('../lib/wallet.js');
const roulette = await import('../games/roulette.js');
const slots = await import('../games/slots.js');
const dice = await import('../games/dice.js');
const plinko = await import('../games/plinko.js');
const mines = await import('../games/mines.js');
const crash = await import('../games/crash.js');
const blackjack = await import('../games/blackjack.js');
const { GameError } = await import('../lib/errors.js');

const QUICK = process.env.QUICK === '1';
const N = (full, quick) => (QUICK ? quick : full);

let failures = 0;
const pct = (x) => (x * 100).toFixed(2) + '%';
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✔' : '  ✘ FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
function section(t) {
  console.log(`\n${t}`);
}

const user = await auth.register({ username: 'tester', password: 'secreto1', invite: 'TESTCODE' });
const uid = user.id;
const topUp = () => db.prepare('UPDATE users SET balance = 1000000000 WHERE id = ?').run(uid);
topUp();

/** Corre `n` rondas y devuelve { rtp } usando lo apostado y cobrado reportado por el juego */
function simulate(n, play) {
  let wagered = 0;
  let paid = 0;
  for (let i = 0; i < n; i++) {
    const r = play(i);
    wagered += r.bet;
    paid += r.payout;
    if (i % 5000 === 0) topUp();
  }
  return { rtp: paid / wagered, wagered, paid };
}

// ------------------------------------------------------------------ Ruleta
section('RULETA (esperado: 97,30% = 36/37)');
{
  // Cada tipo de apuesta cubre n números y paga 36/n: el retorno es siempre 36/37.
  const samples = [
    { type: 'straight', n: 17 }, { type: 'split', a: 17, b: 20 }, { type: 'split', a: 17, b: 18 },
    { type: 'split', a: 0, b: 2 }, { type: 'street', n: 7 }, { type: 'corner', n: 8 },
    { type: 'line', n: 13 }, { type: 'dozen', n: 2 }, { type: 'column', n: 3 }, { type: 'red' },
    { type: 'black' }, { type: 'even' }, { type: 'odd' }, { type: 'low' }, { type: 'high' },
  ];
  const sizes = { straight: 1, split: 2, street: 3, corner: 4, line: 6, dozen: 12, column: 12, red: 18, black: 18, even: 18, odd: 18, low: 18, high: 18 };
  let ok = true;
  for (const b of samples) {
    const set = roulette.betNumbers(b);
    if (set.length !== sizes[b.type] || new Set(set).size !== set.length) ok = false;
    const rtp = (set.length * (36 / set.length)) / 37;
    if (Math.abs(rtp - 36 / 37) > 1e-12) ok = false;
  }
  check('cada tipo de apuesta cubre la cantidad correcta de números', ok);

  const invalid = [
    { type: 'split', a: 3, b: 4 }, { type: 'split', a: 1, b: 5 }, { type: 'street', n: 2 },
    { type: 'corner', n: 3 }, { type: 'corner', n: 34 }, { type: 'line', n: 34 }, { type: 'straight', n: 37 },
    { type: 'dozen', n: 4 }, { type: 'nada' },
  ];
  let allRejected = true;
  for (const b of invalid) {
    try { roulette.betNumbers(b); allRejected = false; } catch (e) { if (!(e instanceof GameError)) allRejected = false; }
  }
  check('rechaza apuestas imposibles (splits/esquinas inválidos)', allRejected);

  const types = ['red', 'black', 'even', 'odd', 'low', 'high'];
  const r = simulate(N(60000, 8000), (i) => {
    const bets = [{ type: types[i % 6], amount: 100 }, { type: 'straight', n: i % 37, amount: 10 }, { type: 'dozen', n: (i % 3) + 1, amount: 50 }];
    return roulette.spin(uid, bets);
  });
  check('simulación real de tiradas', Math.abs(r.rtp - 36 / 37) < (QUICK ? 0.04 : 0.015), `RTP medido ${pct(r.rtp)}`);

  // Distribución uniforme de los 37 números
  const counts = new Array(37).fill(0);
  const spins = N(185000, 37000);
  for (let i = 0; i < spins; i++) counts[roulette.spin(uid, [{ type: 'red', amount: 10 }]).number]++;
  topUp();
  const exp = spins / 37;
  const chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  check('los 37 números salen parejo (chi² < 65, 36 g.l.)', chi < 65, `chi² = ${chi.toFixed(1)}`);
}

// ------------------------------------------------------------------ Tragamonedas
section('TRAGAMONEDAS');
{
  const t = slots.theoreticalRtp();
  check('RTP teórico exacto entre 94% y 97%', t.rtp > 0.94 && t.rtp < 0.97, `${pct(t.rtp)} (líneas ${pct(t.lineRtp)}, giros gratis cada ${(1 / t.pTrigger).toFixed(0)} tiros, aciertos ${pct(t.hitRate)})`);
  const r = simulate(N(300000, 30000), () => slots.spin(uid, { bet: 100 }));
  check('simulación real coincide con el teórico', Math.abs(r.rtp - t.rtp) < (QUICK ? 0.12 : 0.05), `medido ${pct(r.rtp)}`);
  let freeOk = true;
  for (let i = 0; i < 4000 && freeOk; i++) {
    const s = slots.spin(uid, { bet: 100 });
    if (s.free && (s.free.spins.length !== 8 || s.payout !== s.basePayout + s.free.payout)) freeOk = false;
    if (!s.free && s.stars >= 3) freeOk = false;
  }
  topUp();
  check('los giros gratis se arman y se suman bien', freeOk);
  let rejected = false;
  try { slots.spin(uid, { bet: 12 }); } catch { rejected = true; }
  check('rechaza apuestas que no son múltiplo de 5', rejected);
}

// ------------------------------------------------------------------ Dados
section('DADOS (esperado: ~99%)');
{
  let worst = 1;
  for (const dir of ['under', 'over']) {
    for (const target of [3, 10, 25, 50, 75, 90, 97]) {
      let count; try { count = dice.winningCount(target, dir); } catch { continue; }
      const chance = count / 10000;
      if (chance < 0.02 || chance > 0.98) continue;
      const rtp = chance * dice.multiplierFor(target, dir);
      worst = Math.min(worst, rtp);
      if (rtp > 0.99 + 1e-9) check(`${dir} ${target}`, false, `RTP ${pct(rtp)} supera 99%`);
    }
  }
  check('RTP exacto nunca supera 99% en ningún objetivo', true, `el peor caso es ${pct(worst)} por el redondeo`);
  const r = simulate(N(100000, 15000), (i) => dice.roll(uid, { bet: 100, direction: i % 2 ? 'under' : 'over', target: i % 2 ? 49.5 : 49.5 }));
  check('simulación real', Math.abs(r.rtp - 0.99) < (QUICK ? 0.06 : 0.03), `RTP medido ${pct(r.rtp)}`);
}

// ------------------------------------------------------------------ Plinko
section('PLINKO (esperado: ~97%)');
{
  let allOk = true;
  for (const rows of plinko.ROWS)
    for (const risk of plinko.RISKS) {
      const p = plinko.probabilities(rows);
      const rtp = plinko.TABLES[rows][risk].reduce((s, m, i) => s + m * p[i], 0);
      if (rtp < 0.96 || rtp > 0.98) allOk = false;
    }
  check('las 9 tablas (filas x riesgo) devuelven entre 96% y 98%', allOk);
  for (const risk of plinko.RISKS) {
    const r = simulate(N(60000, 10000), () => plinko.drop(uid, { bet: 100, rows: 12, risk }));
    check(`simulación real, riesgo ${risk}`, Math.abs(r.rtp - 0.97) < (risk === 'high' ? 0.35 : 0.06) * (QUICK ? 2 : 1), `RTP medido ${pct(r.rtp)}`);
  }
}

// ------------------------------------------------------------------ Minas
section('MINAS (esperado: ~99%)');
{
  let ok = true;
  for (const m of [1, 3, 5, 10, 20]) {
    // probabilidad de sobrevivir k casilleros = C(25-m,k)/C(25,k); EV = mult * prob
    let prob = 1;
    for (let k = 1; k <= 25 - m; k++) {
      prob *= (25 - m - (k - 1)) / (25 - (k - 1));
      const ev = prob * mines.multiplier(m, k);
      if (ev > 0.99 + 1e-9 || ev < 0.97) ok = false;
    }
  }
  check('retorno exacto entre 97% y 99% en todas las combinaciones', ok);
  const r = simulate(N(40000, 8000), (i) => {
    const m = [1, 3, 5][i % 3];
    mines.start(uid, { bet: 100, mines: m });
    const picks = Array.from({ length: 25 }, (_, k) => k).sort(() => Math.random() - 0.5);
    const target = [5, 3, 2][i % 3];
    let res;
    for (let k = 0; k < target; k++) {
      res = mines.reveal(uid, { cell: picks[k] });
      if (res.boom) return { bet: 100, payout: 0 };
    }
    res = mines.cashout(uid);
    return { bet: 100, payout: res.payout };
  });
  check('simulación real', Math.abs(r.rtp - 0.99) < (QUICK ? 0.08 : 0.04), `RTP medido ${pct(r.rtp)}`);
  let hidden = true;
  mines.start(uid, { bet: 100, mines: 5 });
  const st = JSON.stringify(mines.state(uid));
  if (st.includes('mineCells')) hidden = false;
  mines.reveal(uid, { cell: 0 });
  mines.state(uid);
  try { mines.cashout(uid); } catch {}
  db.prepare("DELETE FROM active WHERE game = 'mines'").run();
  check('la posición de las minas no se filtra al cliente mientras se juega', hidden);
}

// ------------------------------------------------------------------ Crash
section('CRASH (esperado: P(llegar a x) = 99% / x)');
{
  const n = N(2000000, 300000);
  const targets = [1.01, 1.5, 2, 5, 10, 50];
  const hits = targets.map(() => 0);
  let instant = 0;
  for (let i = 0; i < n; i++) {
    const cp = crash.randomCrashPoint();
    if (cp === 1) instant++;
    targets.forEach((x, j) => { if (cp >= x) hits[j]++; });
  }
  targets.forEach((x, j) => {
    const p = hits[j] / n;
    const ev = p * x;
    check(`retiro en ${x}x`, Math.abs(ev - 0.99) < (x >= 10 ? 0.12 : 0.02) * (QUICK ? 2 : 1), `RTP ${pct(ev)}`);
  });
  // Cae en 1.00x cuando 0.99/(1-u) < 1.01, o sea con probabilidad 1 - 0.99/1.01 = 1.98%
  check('se cae enseguida (en 1.00x) ~2% de las veces', Math.abs(instant / n - (1 - 0.99 / 1.01)) < 0.003, pct(instant / n));

  // Flujo real: retiro automático y caída
  topUp();
  crash.start(uid, { bet: 100, auto: 1.2 });
  const row = JSON.parse(db.prepare("SELECT state FROM active WHERE game='crash'").get().state);
  check('el punto de caída está guardado en el servidor pero no sale en la respuesta de estado', !JSON.stringify(crash.state(uid)).includes('crashPoint') || crash.state(uid).state === 'ended');
  // adelantamos el reloj: movemos el inicio al pasado
  row.startedAt -= 60000;
  db.prepare("UPDATE active SET state = ? WHERE game = 'crash'").run(JSON.stringify(row));
  const fin = crash.state(uid);
  const expectWin = row.crashPoint >= 1.2;
  check('liquida sola cuando pasó el tiempo (retiro automático o caída)', fin.state === 'ended' && fin.win === expectWin, `crashPoint ${row.crashPoint}`);
  let early = false;
  crash.start(uid, { bet: 100 });
  try { crash.cashout(uid); } catch (e) { early = e.code === 'too_early'; }
  db.prepare("DELETE FROM active WHERE game = 'crash'").run();
  check('no deja retirar apenas arranca (en 1.00x se recuperaría la apuesta siempre)', early);
}

// ------------------------------------------------------------------ Blackjack
section('BLACKJACK (esperado: ~99,3% con estrategia básica)');
{
  // Valor de la carta
  check('conteo de cartas con ases', blackjack.handTotal(['AS', 'AH', '9D']).total === 21 && blackjack.handTotal(['AS', 'KH']).total === 21 && blackjack.handTotal(['AS', '6H', 'KD']).total === 17 && blackjack.handTotal(['AS', '6H']).soft === true);

  const up = (cards) => blackjack.cardValue(cards[0]);
  function decide(view) {
    const h = view.hands[view.current];
    const d = blackjack.cardValue(view.dealer.cards[0]);
    const a = view.actions;
    const rank = (c) => c.slice(0, -1);
    if (a.split) {
      const v = blackjack.cardValue(h.cards[0]);
      if (v === 11 || v === 8) return 'split';
      if (v === 9 && ![7, 10, 11].includes(d)) return 'split';
      if (v === 7 && d <= 7) return 'split';
      if (v === 6 && d <= 6) return 'split';
      if ((v === 3 || v === 2) && d <= 7) return 'split';
      if (v === 4 && (d === 5 || d === 6)) return 'split';
    }
    const t = h.total;
    if (h.soft) {
      if (t >= 19) return 'stand';
      if (t === 18) return d >= 3 && d <= 6 && a.double ? 'double' : d === 2 || d === 7 || d === 8 ? 'stand' : d >= 3 && d <= 6 ? 'stand' : 'hit';
      if (t === 17) return a.double && d >= 3 && d <= 6 ? 'double' : 'hit';
      if (t >= 15) return a.double && d >= 4 && d <= 6 ? 'double' : 'hit';
      return a.double && d >= 5 && d <= 6 ? 'double' : 'hit';
    }
    if (t >= 17) return 'stand';
    if (t >= 13) return d <= 6 ? 'stand' : 'hit';
    if (t === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
    if (t === 11) return a.double && d <= 10 ? 'double' : 'hit';
    if (t === 10) return a.double && d <= 9 ? 'double' : 'hit';
    if (t === 9) return a.double && d >= 3 && d <= 6 ? 'double' : 'hit';
    return 'hit';
  }

  let wagered = 0, paid = 0, bjs = 0, hands = 0;
  const total = N(250000, 40000);
  for (let i = 0; i < total; i++) {
    if (i % 4000 === 0) topUp();
    let v = blackjack.deal(uid, { bet: 100 });
    let guard = 0;
    while (!v.finished) {
      if (++guard > 60) throw new Error('mano infinita');
      const act = decide(v);
      v = blackjack[act](uid);
    }
    wagered += v.bet; paid += v.payout; hands++;
    if (v.hands.length === 1 && v.hands[0].result === 'blackjack') bjs++;
  }
  const rtp = paid / wagered;
  check('simulación real con estrategia básica', rtp > 0.975 && rtp < 1.012, `RTP medido ${pct(rtp)} en ${hands.toLocaleString('es-AR')} manos (margen de error ~±0,5%)`);
  check('frecuencia de blackjack natural ~4,7%', Math.abs(bjs / hands - 0.047) < 0.006, pct(bjs / hands));

  // La carta oculta no se filtra
  topUp();
  let hiddenOk = true;
  for (let i = 0; i < 50; i++) {
    const v = blackjack.deal(uid, { bet: 10 });
    if (!v.finished) {
      if (v.dealer.cards.length !== 1) hiddenOk = false;
      if (JSON.stringify(v).includes('shoe')) hiddenOk = false;
      blackjack.stand(uid);
    }
  }
  check('la carta oculta de la banca y el mazo no se mandan al jugador', hiddenOk);
}

// ------------------------------------------------------------------ Contabilidad
section('CONTABILIDAD');
{
  const ledgerSum = db.prepare('SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE user_id = ?').get(uid).s;
  // El saldo que pusimos con topUp no pasa por el libro, así que verificamos con un usuario limpio.
  const u2 = await auth.register({ username: 'limpio', password: 'secreto1', invite: 'TESTCODE' });
  for (let i = 0; i < 300; i++) {
    try { slots.spin(u2.id, { bet: 50 }); dice.roll(u2.id, { bet: 20, direction: 'under', target: 50 }); } catch {}
  }
  const sum = db.prepare('SELECT SUM(delta) AS s FROM ledger WHERE user_id = ?').get(u2.id).s;
  check('el saldo siempre coincide con la suma del libro contable', balanceOf(u2.id) === sum, `saldo ${balanceOf(u2.id)} = libro ${sum}`);
  let neg = false;
  try { dice.roll(u2.id, { bet: 99999999, direction: 'under', target: 50 }); } catch (e) { neg = e instanceof GameError; }
  check('no deja apostar más de lo que tenés ni más del máximo', neg);
  void ledgerSum;
}

console.log(failures === 0 ? '\n✅ TODO OK\n' : `\n❌ ${failures} prueba(s) fallaron\n`);
process.exit(failures === 0 ? 0 : 1);
