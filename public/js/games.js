// Mini-games: play to earn lemons (instead of a daily bonus) + chat games rolled by the server.
import { api, errorText } from './api.js';
import { h, icon, avatar, toast, openModal, registerOverlay, closeMenu } from './ui.js';

let d = null; // { me(), onCoins() }
export function initGames(deps) { d = deps; }

const GAMES = [
  { id: 'catch', emoji: '🧺', title: 'Ловец лимонов', desc: '30 секунд: ловите лимоны корзинкой, звёзды дают +5, от бомб уворачивайтесь.', unit: 'очков' },
  { id: 'memory', emoji: '🧠', title: 'Лимонные пары', desc: 'Найдите все пары фруктов за как можно меньше ходов и быстрее.', unit: 'очков' },
  { id: 'reaction', emoji: '⚡', title: 'Реакция', desc: 'Жмите, как только экран станет зелёным. 5 попыток — чем быстрее, тем больше лимонов.', unit: 'очков' },
];
export const CHAT_GAMES = [['🎲', 'Кубик'], ['🎯', 'Дартс'], ['🏀', 'Баскетбол'], ['⚽', 'Футбол'], ['🎳', 'Боулинг']];

// ================================================================ hub

export async function gamesHub() {
  let info;
  try { info = await api.get('/games'); } catch (e) { return toast(errorText(e), 'error'); }
  const pct = Math.min(100, Math.round((info.earnedToday / info.cap) * 100));
  const m = openModal({
    title: 'Мини-игры',
    className: 'modal-games',
    body: h('div', { class: 'games' },
      h('div', { class: 'games-hero' },
        h('div', { class: 'games-coins' }, `🍋 ${d.me().coins ?? 0}`),
        h('div', { class: 'games-cap' },
          h('span', {}, info.earnedToday >= info.cap ? 'На сегодня лимоны собраны — играть можно ради рекордов' : `Сегодня заработано ${info.earnedToday} из ${info.cap} 🍋`),
          h('div', { class: 'games-bar' }, h('i', { style: { width: `${pct}%` } })))),
      ...GAMES.map((g) => h('div', { class: 'game-card' },
        h('div', { class: 'game-emoji' }, g.emoji),
        h('div', { class: 'grow' },
          h('b', {}, g.title), h('span', {}, g.desc),
          h('span', { class: 'game-best' }, info.games[g.id]?.best ? `рекорд: ${info.games[g.id].best} · сыграно ${info.games[g.id].plays}` : 'ещё не играли')),
        h('div', { class: 'game-acts' },
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => { m.close(); play(g); } }, 'Играть'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => topModal(g) }, '🏆')))),
      h('div', { class: 'games-chat' }, h('b', {}, 'Игры в чате'),
        h('span', {}, 'Кубик, дартс, баскетбол, футбол и боулинг — нажмите 📎 в любом чате → «Игры». Результат выбирает сервер, честно для всех.'))),
  });
}

async function topModal(g) {
  const list = h('div', { class: 'fwd-list' }, h('span', { class: 'spinner' }));
  openModal({ title: `🏆 ${g.title}`, className: 'modal-small', body: list });
  try {
    const { top } = await api.get(`/games/${g.id}/top`);
    list.replaceChildren(...(top.length ? top.map((u, i) => h('div', { class: `fwd-item static top-row ${u.id === d.me().id ? 'me' : ''}` },
      h('span', { class: 'top-place' }, ['🥇', '🥈', '🥉'][i] || `${i + 1}`), avatar(u, 36),
      h('div', { class: 'grow' }, h('div', { class: 'row-main' }, u.name), u.username ? h('div', { class: 'row-sub' }, `@${u.username}`) : null),
      h('b', {}, u.best))) : [h('div', { class: 'list-note' }, 'Пока никто не играл — будьте первым!')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
}

// ================================================================ game shell

function play(g) {
  let release = null;
  let cleanup = () => {};
  const scoreEl = h('b', { class: 'gm-score' }, '0');
  const sub = h('span', { class: 'gm-sub' });
  const stage = h('div', { class: 'gm-stage' });
  const close = (fromBack = false) => {
    cleanup();
    ov.classList.remove('show');
    setTimeout(() => ov.remove(), 200);
    if (fromBack !== true) release?.();
  };
  const ov = h('div', { class: 'gm-ov' },
    h('header', { class: 'gm-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Выйти из игры', onclick: () => close() }, icon('close')),
      h('div', { class: 'gm-title' }, `${g.emoji} ${g.title}`),
      h('div', { class: 'gm-right' }, sub, scoreEl)),
    stage);
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  release = registerOverlay(() => close(true));

  const start = async () => {
    let token = null;
    try { token = (await api.post(`/games/${g.id}/start`)).token; } catch { /* offline: play without reward */ }
    // 3-2-1
    for (const n of ['3', '2', '1']) {
      stage.replaceChildren(h('div', { class: 'gm-count' }, n));
      await new Promise((r) => setTimeout(r, 650));
      if (!ov.isConnected) return;
    }
    const finish = async (result, shown) => {
      cleanup();
      let r = null;
      if (token) { try { r = await api.post('/games/finish', { token, ...result }); d.onCoins?.(); } catch (e) { toast(errorText(e), 'error'); } }
      if (!ov.isConnected) return;
      stage.replaceChildren(h('div', { class: 'gm-result' },
        h('div', { class: 'gm-result-emoji' }, r?.record ? '🏆' : g.emoji),
        h('div', { class: 'gm-result-title' }, r?.record ? 'Новый рекорд!' : 'Игра окончена'),
        h('div', { class: 'gm-result-score' }, shown ?? `${r?.score ?? result.score ?? 0}`),
        r ? h('div', { class: `gm-reward ${r.reward ? '' : 'none'}` }, r.reward ? `+${r.reward} 🍋` : r.earnedToday >= r.cap ? 'Лимоны на сегодня собраны' : 'Без лимонов в этот раз') : null,
        r ? h('div', { class: 'muted small' }, `рекорд: ${r.best} · сегодня ${r.earnedToday}/${r.cap} 🍋`) : null,
        h('div', { class: 'gm-result-acts' },
          h('button', { class: 'btn btn-primary', onclick: start }, 'Ещё раз'),
          h('button', { class: 'btn btn-ghost', onclick: () => { close(); gamesHub(); } }, 'К играм'))));
    };
    cleanup = { catch: catchGame, memory: memoryGame, reaction: reactionGame }[g.id](stage, scoreEl, sub, finish) || (() => {});
  };
  start();
}

// ================================================================ 1. lemon catcher

function catchGame(stage, scoreEl, sub, finish) {
  const canvas = h('canvas', { class: 'gm-canvas' });
  stage.replaceChildren(canvas, h('div', { class: 'gm-hint' }, 'Водите пальцем или мышью, стрелки ← →'));
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  const resize = () => { W = stage.clientWidth; H = stage.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize();
  const DURATION = 30_000;
  let x = W / 2, keys = 0, score = 0, items = [], last = performance.now(), spawnIn = 0, shake = 0, raf = 0, over = false;
  const t0 = performance.now();
  const move = (e) => { const r = canvas.getBoundingClientRect(); x = Math.max(30, Math.min(W - 30, (e.touches?.[0]?.clientX ?? e.clientX) - r.left)); };
  const key = (e) => { if (e.key === 'ArrowLeft') keys = -1; else if (e.key === 'ArrowRight') keys = 1; };
  const keyUp = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') keys = 0; };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false });
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('resize', resize);
  const pops = [];
  const loop = (t) => {
    const dt = Math.min(48, t - last);
    last = t;
    const elapsed = t - t0;
    const speedUp = 1 + elapsed / DURATION * 1.3;
    x = Math.max(30, Math.min(W - 30, x + keys * dt * 0.6));
    spawnIn -= dt;
    if (spawnIn <= 0) {
      const r = Math.random();
      items.push({ x: 24 + Math.random() * (W - 48), y: -30, vy: (0.16 + Math.random() * 0.12) * speedUp, kind: r < 0.07 ? 'star' : r < 0.3 ? 'bomb' : 'lemon', rot: Math.random() * 6 });
      spawnIn = (520 - Math.min(300, elapsed / 100)) * (0.6 + Math.random() * 0.8);
    }
    const by = H - 54;
    for (const it of items) {
      it.y += it.vy * dt;
      it.rot += dt * 0.003;
      if (!it.done && it.y > by - 22 && it.y < by + 22 && Math.abs(it.x - x) < 46) {
        it.done = true;
        const delta = it.kind === 'star' ? 5 : it.kind === 'bomb' ? -3 : 1;
        score = Math.max(0, score + delta);
        pops.push({ x: it.x, y: by - 30, text: delta > 0 ? `+${delta}` : `${delta}`, t, bad: delta < 0 });
        if (delta < 0) { shake = 300; navigator.vibrate?.(80); }
      }
    }
    items = items.filter((it) => !it.done && it.y < H + 40);
    // draw
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (shake > 0) { shake -= dt; ctx.translate((Math.random() - 0.5) * 10, 0); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(Math.sin(it.rot) * 0.4);
      ctx.font = `${it.kind === 'star' ? 34 : 38}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.fillText(it.kind === 'star' ? '🌟' : it.kind === 'bomb' ? '💣' : '🍋', 0, 0);
      ctx.restore();
    }
    ctx.font = '54px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.fillText('🧺', x, by);
    for (const p of pops) {
      const a = 1 - (t - p.t) / 700;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillStyle = p.bad ? '#ef4444' : '#16a34a';
      ctx.fillText(p.text, p.x, p.y - (1 - a) * 30);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    scoreEl.textContent = score;
    const left = Math.max(0, DURATION - elapsed);
    sub.textContent = `⏱ ${Math.ceil(left / 1000)}`;
    if (left <= 0 && !over) { over = true; finish({ score }); return; }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('resize', resize);
  };
}

// ================================================================ 2. memory pairs

function memoryGame(stage, scoreEl, sub, finish) {
  const FRUITS = ['🍋', '🍊', '🍉', '🍓', '🥝', '🍍', '🍒', '🥑'];
  const deck = [...FRUITS, ...FRUITS].map((f, i) => ({ f, i, k: Math.random() })).sort((a, b) => a.k - b.k);
  let open = [], moves = 0, found = 0, lock = false;
  const t0 = Date.now();
  const timer = setInterval(() => { sub.textContent = `⏱ ${Math.floor((Date.now() - t0) / 1000)} c`; }, 500);
  scoreEl.textContent = '0 ходов';
  const grid = h('div', { class: 'mem-grid' }, deck.map((c) => {
    const el = h('button', { class: 'mem-card', 'aria-label': 'Карточка' }, h('span', { class: 'mem-back' }, '🍋'), h('span', { class: 'mem-face' }, c.f));
    el.addEventListener('click', () => {
      if (lock || el.classList.contains('open') || el.classList.contains('found')) return;
      el.classList.add('open');
      open.push({ el, c });
      if (open.length < 2) return;
      moves++;
      scoreEl.textContent = `${moves} ${moves % 10 === 1 && moves % 100 !== 11 ? 'ход' : [2, 3, 4].includes(moves % 10) && ![12, 13, 14].includes(moves % 100) ? 'хода' : 'ходов'}`;
      const [a, b] = open;
      open = [];
      if (a.c.f === b.c.f) {
        a.el.classList.add('found'); b.el.classList.add('found');
        if (++found === FRUITS.length) {
          clearInterval(timer);
          const secs = Math.round((Date.now() - t0) / 1000);
          setTimeout(() => finish({ moves }, `${moves} ходов · ${secs} c`), 500);
        }
      } else {
        lock = true;
        setTimeout(() => { a.el.classList.remove('open'); b.el.classList.remove('open'); lock = false; }, 750);
      }
    });
    return el;
  }));
  stage.replaceChildren(h('div', { class: 'mem-wrap' }, grid));
  return () => clearInterval(timer);
}

// ================================================================ 3. reaction

function reactionGame(stage, scoreEl, sub, finish) {
  const ROUNDS = 5;
  const times = [];
  let state = 'wait', greenAt = 0, timer = null;
  const pad = h('button', { class: 'react-pad wait' });
  const label = h('div', { class: 'react-label' });
  const hist = h('div', { class: 'react-hist' });
  pad.append(label);
  stage.replaceChildren(h('div', { class: 'react-wrap' }, pad, hist));
  const next = () => {
    state = 'wait';
    pad.className = 'react-pad wait';
    label.textContent = 'Ждите зелёного…';
    sub.textContent = `попытка ${times.length + 1}/${ROUNDS}`;
    timer = setTimeout(() => { state = 'go'; greenAt = performance.now(); pad.className = 'react-pad go'; label.textContent = 'ЖМИ!'; }, 1500 + Math.random() * 2500);
  };
  pad.addEventListener('pointerdown', () => {
    if (state === 'wait') {
      clearTimeout(timer);
      state = 'early';
      pad.className = 'react-pad early';
      label.textContent = 'Рано! +300 мс штрафа';
      times.push(999);
      hist.append(h('span', { class: 'bad' }, 'рано'));
      setTimeout(() => (times.length >= ROUNDS ? done() : next()), 900);
    } else if (state === 'go') {
      const ms = Math.round(performance.now() - greenAt);
      state = 'shown';
      times.push(ms);
      pad.className = 'react-pad shown';
      label.textContent = `${ms} мс`;
      hist.append(h('span', { class: ms < 300 ? 'good' : '' }, `${ms}`));
      setTimeout(() => (times.length >= ROUNDS ? done() : next()), 900);
    }
  });
  const done = () => {
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    scoreEl.textContent = `${avg} мс`;
    finish({ avg }, `${avg} мс в среднем`);
  };
  next();
  return () => clearTimeout(timer);
}

// ================================================================ chat games

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
/** A chat game message: rolls for a moment when it's fresh, then shows the result. */
export function diceEl(m) {
  const x = m.extra || {};
  const fresh = Date.now() - (m.createdAt || 0) < 4000;
  const face = x.emoji === '🎲' ? DICE_FACES[(x.value || 1) - 1] : x.emoji;
  const big = h('div', { class: `dice-big ${fresh ? 'rolling' : ''}` }, fresh ? x.emoji : face);
  const res = h('div', { class: `dice-res ${fresh ? 'pending' : ''}` }, x.label || '');
  if (fresh) setTimeout(() => { big.textContent = face; big.classList.remove('rolling'); big.classList.add('landed'); res.classList.remove('pending'); }, 1300);
  return h('div', { class: `dice dice-${x.value === x.max ? 'max' : 'n'}` }, big, res);
}

export function chatGamesMenu(send) {
  return CHAT_GAMES.map(([emoji, label]) => ({ node: h('button', { class: 'ctx-item', role: 'menuitem', onclick: () => { closeMenu(); send(emoji); } }, h('span', { class: 'ctx-emoji' }, emoji), label) }));
}
