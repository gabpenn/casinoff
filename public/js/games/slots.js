// Tragamonedas de 3 rodillos y 5 líneas, con giros gratis.
import { el, fmt, sleep } from '../util.js';
import { betControl, seg, toast } from '../ui.js';

const FACE = { cherry: '🍒', lemon: '🍋', grape: '🍇', bell: '🔔', bar: '<b>BAR</b>', seven: '7', diamond: '💎', star: '⭐' };
const NAMES = { cherry: 'Cerezas', lemon: 'Limones', grape: 'Uvas', bell: 'Campanas', bar: 'BAR', seven: 'Sietes', diamond: 'Diamantes' };
const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];

const sym = (name) => el('div', { class: `sym s-${name}`, 'data-sym': name, html: FACE[name] });
const colsOf = (grid) => [0, 1, 2].map((reel) => [grid[0][reel], grid[1][reel], grid[2][reel]]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function mount(root, ctx) {
  const { api, wallet, sfx, fx } = ctx;
  const cfg = ctx.config.slots;
  const symbols = Object.keys(FACE);
  const randSym = () => symbols[(Math.random() * symbols.length) | 0];

  let busy = false;
  let autoLeft = 0;
  let turbo = false;
  let alive = true;
  let current = [0, 1, 2].map(() => [randSym(), randSym(), randSym()]);

  // ----- Máquina
  const reels = [0, 1, 2].map((i) => {
    const strip = el('div', { class: 'strip' }, current[i].map(sym));
    return { el: el('div', { class: 'reel', 'aria-hidden': 'true' }, strip), strip };
  });
  const linesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  linesSvg.setAttribute('class', 'lines');
  linesSvg.setAttribute('viewBox', '0 0 3 3');
  linesSvg.setAttribute('preserveAspectRatio', 'none');
  linesSvg.setAttribute('aria-hidden', 'true');
  const reelsEl = el('div', { class: 'reels' }, reels.map((r) => r.el), linesSvg);
  const winEl = el('div', { class: 'slot-win', 'aria-live': 'polite' });
  const machine = el('div', { class: 'machine' },
    el('div', { class: 'marquee', html: '<i>✦</i> TRAGAMONEDAS <i>✦</i>' }),
    reelsEl, winEl);

  function cellH() { return reels[0].strip.firstChild?.offsetHeight || 104; }

  async function spinReels(cols) {
    const H = cellH();
    const base = turbo ? 420 : 950;
    const gap = turbo ? 160 : 360;
    sfx.spin();
    await Promise.all(reels.map(async (r, i) => {
      const dur = base + i * gap;
      const filler = Math.round((dur / 1000) * 16) + 6;
      const names = [...cols[i], ...Array.from({ length: filler }, randSym), ...current[i]];
      r.strip.replaceChildren(...names.map(sym));
      r.strip.style.transition = 'none';
      r.strip.style.transform = `translateY(${-(names.length - 3) * H}px)`;
      void r.strip.offsetHeight;
      r.el.classList.add('spinning');
      r.strip.style.transition = `transform ${dur}ms cubic-bezier(.15,.75,.25,1.03)`;
      r.strip.style.transform = 'translateY(0)';
      await wait(dur + 30);
      r.el.classList.remove('spinning');
      r.strip.style.transition = 'none';
      r.strip.replaceChildren(...cols[i].map(sym));
      r.strip.style.transform = 'translateY(0)';
      sfx.reelStop();
    }));
    current = cols;
  }

  function clearWins() {
    reelsEl.querySelectorAll('.sym.win').forEach((n) => n.classList.remove('win'));
    linesSvg.replaceChildren();
  }

  function showWins(wins) {
    clearWins();
    for (const w of wins) {
      w.rows.forEach((row, reel) => {
        if (w.kind === 'two' && reel === 2) return;
        reels[reel].strip.children[row]?.classList.add('win');
      });
      const pts = w.rows.map((row, reel) => `${reel + 0.5},${row + 0.5}`).join(' ');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', pts);
      linesSvg.append(poly);
    }
  }

  async function countUp(amount, bet) {
    const t0 = performance.now();
    const dur = Math.min(900, 300 + amount / bet * 15);
    await new Promise((res) => {
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        winEl.firstChild && (winEl.firstChild.textContent = '+' + fmt(amount * k));
        if (k < 1 && alive) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
  }

  function say(main, sub) {
    winEl.replaceChildren(el('span', {}, main), sub ? el('small', {}, sub) : '');
  }

  // ----- Controles
  const bet = betControl({ game: 'slots', min: Math.max(ctx.config.minBet, cfg.step), max: ctx.config.maxBet, step: cfg.step, start: 100 });
  const spinBtn = el('button', { class: 'btn primary big', onclick: () => spin(), 'aria-keyshortcuts': 'Space' }, 'Girar');
  const autoBtn = el('button', { class: 'btn', onclick: cycleAuto }, 'Auto: no');
  const turboSeg = seg([{ value: 'off', label: 'Normal' }, { value: 'on', label: 'Turbo' }], 'off', (v) => { turbo = v === 'on'; });
  const info = el('div', { class: 'result-line' });

  function cycleAuto() {
    sfx.click();
    if (autoLeft > 0 || busy && autoLeft === 0 && autoBtn.dataset.on) {
      autoLeft = 0; autoBtn.dataset.on = ''; autoBtn.textContent = 'Auto: no';
      return;
    }
    const opts = [10, 25, 50, 100];
    const next = opts[(opts.indexOf(Number(autoBtn.dataset.n)) + 1) % opts.length] ?? 10;
    autoBtn.dataset.n = next;
    autoLeft = next; autoBtn.dataset.on = '1'; autoBtn.textContent = `Auto: ${autoLeft}`;
    if (!busy) spin();
  }

  function lock(b) {
    busy = b;
    spinBtn.disabled = b;
    bet.disable(b);
  }

  async function spin() {
    if (busy || !alive) return;
    const amount = bet.value;
    if (wallet.display < amount) {
      autoLeft = 0; autoBtn.textContent = 'Auto: no'; autoBtn.dataset.on = '';
      return toast('No te alcanzan las fichas. Bajá la apuesta o cobrá el bono diario.', 'error');
    }
    lock(true);
    clearWins();
    say('', '');
    let res;
    try {
      res = await api.post('/slots/spin', { bet: amount });
    } catch (e) {
      toast(e.message, 'error');
      autoLeft = 0; autoBtn.textContent = 'Auto: no'; autoBtn.dataset.on = '';
      lock(false);
      return;
    }
    const pay = wallet.settle(res.balance, res.payout);
    await spinReels(colsOf(res.grid));
    if (!alive) return;

    if (res.basePayout > 0) {
      showWins(res.wins);
      say('+0', `${res.wins.length} ${res.wins.length === 1 ? 'línea ganadora' : 'líneas ganadoras'}`);
      sfx.win(Math.min(4, Math.ceil(res.basePayout / amount)));
      pay.reveal(res.basePayout);
      await countUp(res.basePayout, amount);
      await sleep(turbo ? 250 : 600);
    } else if (!res.free) {
      say('', 'Sin premio. ¡Otra vuelta!');
    }

    if (res.free) await playFree(res, pay, amount);
    if (!alive) return;

    if (res.payout > 0) {
      winEl.replaceChildren(el('span', {}, '+' + fmt(res.payout)), el('small', {}, res.free ? 'Total con giros gratis' : ''));
      if (res.payout >= amount * 2 || res.free) fx.win(res.payout, amount);
    } else sfx.lose();

    lock(false);
    if (autoLeft > 0) {
      autoLeft--;
      autoBtn.textContent = autoLeft ? `Auto: ${autoLeft}` : 'Auto: no';
      if (!autoLeft) autoBtn.dataset.on = '';
      if (autoLeft > 0 && res.payout < amount * 20) { await sleep(turbo ? 250 : 650); if (alive && autoLeft > 0) spin(); }
      else { autoLeft = 0; autoBtn.textContent = 'Auto: no'; autoBtn.dataset.on = ''; }
    }
  }

  async function playFree(res, pay, amount) {
    const f = res.free;
    sfx.bigWin();
    const banner = el('div', { class: 'free-banner' }, el('div', {}, el('h2', {}, `¡${f.count} GIROS GRATIS!`), el('p', {}, `Todos los premios valen x${f.multiplier}`)));
    machine.append(banner);
    fx.burst(innerWidth / 2, innerHeight / 2, 60, { power: 12 });
    await sleep(2300);
    banner.remove();
    let acc = res.basePayout;
    for (let i = 0; i < f.spins.length; i++) {
      if (!alive) return;
      const s = f.spins[i];
      clearWins();
      say(`Giro gratis ${i + 1} de ${f.count}`, `Ganado hasta ahora: ${fmt(acc)}`);
      const saveTurbo = turbo;
      turbo = true;
      await spinReels(colsOf(s.grid));
      turbo = saveTurbo;
      if (s.payout > 0) {
        showWins(s.wins);
        acc += s.payout;
        sfx.win(2);
        pay.reveal(s.payout);
        say(`Giro gratis ${i + 1} de ${f.count}`, `Ganado hasta ahora: ${fmt(acc)}`);
        await sleep(900);
      } else await sleep(380);
    }
    pay.reveal(); // por las dudas, muestra lo que falte
  }

  const onKey = (e) => {
    if (e.code !== 'Space' || /INPUT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    spin();
  };
  document.addEventListener('keydown', onKey);

  // Tabla de premios
  const per = (m) => (m / 5).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const pay = el('div', { class: 'paytable' },
    Object.entries(cfg.pay3).reverse().map(([k, m]) => el('div', {}, el('span', { html: `${FACE[k].replace(/<\/?b>/g, '')} ×3` }), el('b', {}, `${per(m)}x`))),
    el('div', {}, el('span', {}, '🍒🍒 (desde la izq.)'), el('b', {}, `${per(cfg.pay2Cherry)}x`)),
    el('div', {}, el('span', {}, '⭐⭐⭐ en cualquier lugar'), el('b', { class: 'gold' }, `${cfg.freeSpins} giros x${cfg.freeMult}`)),
  );

  root.append(
    el('a', { class: 'back', href: '#/' }, '← Lobby'),
    el('div', { class: 'page-title' }, el('h1', {}, 'Tragamonedas'), el('p', {}, 'Tu apuesta se reparte en 5 líneas: tres horizontales y dos diagonales. Con la barra espaciadora también girás.')),
    el('div', { class: 'layout' },
      machine,
      el('div', { class: 'side' },
        el('div', { class: 'panel' }, bet.el, el('div', { style: { height: '10px' } }), spinBtn, el('div', { style: { height: '8px' } }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, autoBtn, turboSeg.el), info),
        el('div', { class: 'panel' }, el('h3', {}, 'Premios por línea'), el('p', { class: 'fineprint', style: { marginTop: 0 } }, 'Se multiplica por tu apuesta total cuando es la única línea ganadora.'), pay)),
    ),
  );
  void NAMES; void LINES;

  return () => {
    alive = false;
    autoLeft = 0;
    document.removeEventListener('keydown', onKey);
  };
}
