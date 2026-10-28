// Games between people for lemons, inside a chat: challenge → accept → result (or a live board).
import { api, errorText } from './api.js';
import { h, toast, openModal } from './ui.js';

export const GAMES = {
  dice: { name: 'Кости', emoji: '🎲', desc: 'Каждый бросает два кубика — у кого больше, тот и забрал' },
  rps: { name: 'Камень, ножницы, бумага', emoji: '✊', desc: 'Выбор держится в секрете, пока не сходят оба' },
  coin: { name: 'Монетка', emoji: '🪙', desc: 'Вы выбираете сторону, сервер подбрасывает' },
  ttt: { name: 'Крестики-нолики', emoji: '❌', desc: 'Ходите по очереди прямо в чате' },
};
const STAKES = [0, 10, 25, 50, 100, 250, 500];
const RPS = { rock: ['✊', 'Камень'], paper: ['✋', 'Бумага'], scissors: ['✌️', 'Ножницы'] };
const SIDES = { heads: ['🦅', 'Орёл'], tails: ['🪙', 'Решка'] };
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

let deps = null; // { me(), userName(id) }
export function initDuels(d) { deps = d; }
const lemons = (n) => (n ? `🍋 ${n}` : 'на интерес');

/** "Бросить вызов": pick a game, a stake and (for some games) your move. */
export function duelModal(chat, onSent, preset = null) {
  let game = GAMES[preset?.game] ? preset.game : 'dice', stake = STAKES.includes(preset?.stake) ? preset.stake : 10, choice = null;
  const body = h('div', { class: 'duel-new' });
  const coins = deps.me().coins ?? 0;
  if (stake > coins) stake = 0;
  const render = () => {
    if (game === 'rps' && !RPS[choice]) choice = 'rock';
    if (game === 'coin' && !SIDES[choice]) choice = 'heads';
    body.replaceChildren(...[
      h('div', { class: 'duel-games' }, Object.entries(GAMES).map(([k, g]) => h('button', { class: `duel-game ${game === k ? 'on' : ''}`, onclick: () => { game = k; render(); } },
        h('span', { class: 'duel-game-emoji' }, g.emoji), h('b', {}, g.name), h('span', {}, g.desc)))),
      h('div', { class: 'field-label' }, `Ставка · у вас 🍋 ${coins}`),
      h('div', { class: 'th-chips' }, STAKES.map((s) => h('button', { type: 'button', class: `rw-chip ${stake === s ? 'on' : ''}`, disabled: s > coins, onclick: () => { stake = s; render(); } }, s ? `🍋 ${s}` : 'На интерес'))),
      game === 'rps' ? h('div', { class: 'field-label' }, 'Ваш ход (соперник не увидит, пока не сходит сам)') : null,
      game === 'rps' ? h('div', { class: 'duel-picks' }, Object.entries(RPS).map(([k, [e, l]]) => h('button', { class: `duel-pick ${choice === k ? 'on' : ''}`, onclick: () => { choice = k; render(); } }, h('span', {}, e), l))) : null,
      game === 'coin' ? h('div', { class: 'field-label' }, 'Ваша сторона') : null,
      game === 'coin' ? h('div', { class: 'duel-picks' }, Object.entries(SIDES).map(([k, [e, l]]) => h('button', { class: `duel-pick ${choice === k ? 'on' : ''}`, onclick: () => { choice = k; render(); } }, h('span', {}, e), l))) : null,
      h('p', { class: 'muted small' }, stake ? `Ставка списывается сейчас. Победитель забирает 🍋 ${stake * 2}. Ничья или отмена — лимоны вернутся.` : 'Игра без ставки — просто на интерес.'),
    ].filter(Boolean));
  };
  render();
  openModal({
    title: '⚔️ Бросить вызов', className: 'modal-duel', body,
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Бросить вызов', primary: true, onClick: async (close, btn) => {
        if (btn) btn.disabled = true;
        try { const { message } = await api.post(`/chats/${chat.id}/duel`, { game, stake, choice }); close(); onSent?.(message); } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
}

function pickModal(title, options) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, className: 'modal-small',
      body: h('div', { class: 'duel-picks big' }, Object.entries(options).map(([k, [e, l]]) => h('button', { class: 'duel-pick', onclick: () => { done = true; resolve(k); m.close(); } }, h('span', {}, e), l))),
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

const act = async (path, body) => { try { await api.post(path, body); return true; } catch (e) { toast(errorText(e), 'error'); return false; } };

/** The duel card in a message. */
export function duelEl(m) {
  const x = m.extra || {};
  const g = GAMES[x.game] || GAMES.dice;
  const me = deps.me().id;
  const name = (id) => (id === me ? 'Вы' : deps.userName(id));
  const head = h('div', { class: 'duel-head' }, h('span', { class: 'duel-head-emoji' }, g.emoji),
    h('div', {}, h('b', {}, g.name), h('span', {}, x.stake ? `Ставка ${lemons(x.stake)} · банк 🍋 ${x.stake * 2}` : 'На интерес')));
  const el = h('div', { class: `duel duel-${x.status}` }, head);
  const add = (...n) => el.append(...n.filter(Boolean));
  const btns = (...b) => h('div', { class: 'duel-acts' }, ...b.filter(Boolean));
  const vs = (a, b) => h('div', { class: 'duel-vs' }, h('span', {}, name(a)), h('i', {}, 'VS'), h('span', {}, b ? name(b) : (x.to ? name(x.to) : 'кто угодно')));

  if (x.status === 'open') {
    add(vs(x.from, x.to));
    if (x.game === 'coin') add(h('div', { class: 'duel-note' }, `${name(x.from)} за ${SIDES[x.side]?.[1] || '?'} ${SIDES[x.side]?.[0] || ''}`));
    if (x.game === 'rps') add(h('div', { class: 'duel-note' }, `${name(x.from)} уже сделал(а) ход 🤫`));
    const canAccept = x.from !== me && (!x.to || x.to === me);
    add(btns(
      canAccept ? h('button', { class: 'btn btn-primary btn-sm', onclick: async (e) => {
        e.stopPropagation();
        let choice = null;
        if (x.game === 'rps') { choice = await pickModal('Ваш ход', RPS); if (!choice) return; }
        await act(`/duels/${m.id}/accept`, { choice });
      } }, x.stake ? `Принять · ${lemons(x.stake)}` : 'Принять') : null,
      x.to === me ? h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); act(`/duels/${m.id}/cancel`); } }, 'Отказаться') : null,
      x.from === me ? h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); act(`/duels/${m.id}/cancel`); } }, 'Отменить') : null,
      x.from === me ? h('span', { class: 'duel-wait' }, 'Ждём соперника…') : null));
    return el;
  }

  if (x.game === 'ttt' && x.board) {
    const myTurn = x.status === 'playing' && x.turn === me;
    const board = h('div', { class: 'ttt' }, x.board.map((v, i) => h('button', {
      class: `ttt-cell ${v || ''} ${x.line?.includes(i) ? 'win' : ''} ${x.last === i ? 'last' : ''}`,
      disabled: !myTurn || !!v,
      onclick: (e) => { e.stopPropagation(); act(`/duels/${m.id}/move`, { cell: i }); },
    }, v === 'x' ? '✕' : v === 'o' ? '◯' : '')));
    add(h('div', { class: 'duel-vs' }, h('span', {}, `✕ ${name(x.x)}`), h('i', {}, 'VS'), h('span', {}, `◯ ${name(x.o)}`)), board);
    if (x.status === 'playing') {
      add(h('div', { class: `duel-turn ${myTurn ? 'mine' : ''}` }, myTurn ? 'Ваш ход!' : `Ходит ${name(x.turn)}…`));
      if ([x.x, x.o].includes(me)) add(btns(h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); act(`/duels/${m.id}/resign`); } }, x.turn !== me && Date.now() - (x.movedAt || 0) > 864e5 ? 'Забрать победу' : 'Сдаться')));
      return el;
    }
  }

  if (x.status === 'cancelled') {
    add(h('div', { class: 'duel-note' }, x.note || 'Вызов отменён'), x.stake ? h('div', { class: 'duel-sub' }, 'Ставка вернулась') : null);
    return el;
  }

  // done
  const A = x.from, B = x.b;
  if (x.game === 'dice' && x.rolls) {
    const row = (id) => { const r = x.rolls[id] || [1, 1]; return h('div', { class: `duel-roll ${x.winner === id ? 'win' : ''}` }, h('span', {}, name(id)), h('b', {}, r.map((v) => DICE[v - 1]).join(' ')), h('i', {}, String(r[0] + r[1]))); };
    add(h('div', { class: 'duel-rolls' }, row(A), row(B)));
  } else if (x.game === 'rps' && x.picks) {
    const row = (id) => h('div', { class: `duel-roll ${x.winner === id ? 'win' : ''}` }, h('span', {}, name(id)), h('b', {}, RPS[x.picks[id]]?.[0] || '?'), h('i', {}, RPS[x.picks[id]]?.[1] || ''));
    add(h('div', { class: 'duel-rolls' }, row(A), row(B)));
  } else if (x.game === 'coin' && x.flip) {
    add(h('div', { class: 'duel-flip' }, h('span', {}, SIDES[x.flip][0]), `Выпало: ${SIDES[x.flip][1]}`));
  }
  const res = x.draw ? `🤝 Ничья${x.stake ? ' — ставки вернулись' : ''}` : `🏆 ${x.winner === me ? 'Вы выиграли' : `${name(x.winner)} выигрывает`}${x.stake ? ` 🍋 ${x.stake * 2}` : ''}!`;
  add(h('div', { class: `duel-result ${x.winner === me ? 'me' : ''}` }, res), x.note ? h('div', { class: 'duel-sub' }, x.note) : null);
  if (x.from === me || x.b === me) add(btns(h('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); deps.rematch?.(x); } }, '🔁 Реванш')));
  return el;
}
