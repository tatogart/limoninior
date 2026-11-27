// Games between people for lemons, right in a chat: dice duel, rock-paper-scissors, coin flip and
// tic-tac-toe. Stakes are held by the server (taken when you create or accept) and the winner takes
// the pot; a draw, a cancel or an expired challenge returns them. All randomness is server-side,
// and a secret choice (rock-paper-scissors) stays on the server until both have chosen.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db, q, now, tx } from './db.js';
import { emitToChat } from './realtime.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS duels (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    chat_id    INTEGER NOT NULL,
    game       TEXT NOT NULL,
    stake      INTEGER NOT NULL,
    a_id       INTEGER NOT NULL,
    b_id       INTEGER,
    to_id      INTEGER,
    status     TEXT NOT NULL,
    secret     TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS duels_open ON duels(status, created_at);
`);

export const DUEL_GAMES = {
  dice: { name: 'Кости', emoji: '🎲' },
  rps: { name: 'Камень, ножницы, бумага', emoji: '✊' },
  coin: { name: 'Монетка', emoji: '🪙' },
  ttt: { name: 'Крестики-нолики', emoji: '❌' },
};
const STAKES = [0, 10, 25, 50, 100, 250, 500];
const RPS = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const OPEN_MS = 24 * 3600_000; // an unanswered challenge expires
const MOVE_MS = 24 * 3600_000; // a stuck tic-tac-toe game can be claimed after this
const rnd = (n) => crypto.randomInt(n);
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const tttWinner = (b) => { for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.every(Boolean) ? 'draw' : null; };

/** The card is being deleted: give back whatever is still at stake. */
export function refundDuel(messageId) {
  const d = q('SELECT * FROM duels WHERE message_id = ?').get(messageId);
  if (!d || !['open', 'playing'].includes(d.status) || !d.stake) return;
  q('UPDATE users SET coins = coins + ? WHERE id = ?').run(d.stake, d.a_id);
  if (d.status === 'playing' && d.b_id) q('UPDATE users SET coins = coins + ? WHERE id = ?').run(d.stake, d.b_id);
  q("UPDATE duels SET status = 'cancelled' WHERE message_id = ?").run(messageId);
}

export function registerDuels(api, { bad, int, isMember, postError, postMessage, serializeMessage, pushMe }) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });
  const coins = (id) => q('SELECT coins FROM users WHERE id = ?').get(id)?.coins ?? 0;
  const pay = (id, n) => { if (n) q('UPDATE users SET coins = coins + ? WHERE id = ?').run(n, id); };

  const update = (d, extra) => {
    q('UPDATE messages SET extra = ? WHERE id = ?').run(JSON.stringify(extra), d.message_id);
    q('UPDATE duels SET updated_at = ? WHERE message_id = ?').run(now(), d.message_id);
    const m = q('SELECT * FROM messages WHERE id = ?').get(d.message_id);
    if (m) emitToChat(d.chat_id, 'message:edit', serializeMessage(m));
  };
  const extraOf = (d) => JSON.parse(q('SELECT extra FROM messages WHERE id = ?').get(d.message_id)?.extra || '{}');
  /** Finish: winner (user id), 'draw' or 'cancel'. Pays out and freezes the card. */
  const finish = (d, extra, outcome, note = '') => {
    tx(() => {
      const pot = d.stake * (d.b_id ? 2 : 1);
      if (outcome === 'draw') { pay(d.a_id, d.stake); if (d.b_id) pay(d.b_id, d.stake); } else if (outcome === 'cancel') pay(d.a_id, d.stake);
      else pay(outcome, pot);
      q('UPDATE duels SET status = ? WHERE message_id = ?').run(outcome === 'cancel' ? 'cancelled' : 'done', d.message_id);
    });
    update(d, { ...extra, status: outcome === 'cancel' ? 'cancelled' : 'done', winner: typeof outcome === 'number' ? outcome : null, draw: outcome === 'draw', note, pot: d.stake * 2 });
    pushMe(d.a_id);
    if (d.b_id) pushMe(d.b_id);
  };

  // Expire old open challenges (refund) and stuck games (the player who waited wins).
  const sweep = () => {
    for (const d of q("SELECT * FROM duels WHERE status = 'open' AND created_at < ?").all(now() - OPEN_MS)) {
      try { finish(d, extraOf(d), 'cancel', 'Время вышло — ставка возвращена'); } catch (e) { console.error('duel sweep', e); }
    }
  };
  setInterval(sweep, 10 * 60_000).unref();

  const load = (req, res) => {
    const id = int(req.params.id);
    const d = id && q('SELECT * FROM duels WHERE message_id = ?').get(id);
    if (!d || !isMember(d.chat_id, req.user.id)) { bad(res, 'not_found', 404); return null; }
    return d;
  };

  api.post('/chats/:id/duel', limiter, (req, res) => {
    const chatId = int(req.params.id);
    if (!chatId || !isMember(chatId, req.user.id)) return bad(res, 'not_found', 404);
    const e = postError(chatId, req.user.id);
    if (e) return bad(res, e, 403);
    const chat = q('SELECT type FROM chats WHERE id = ?').get(chatId);
    if (!['private', 'group'].includes(chat?.type)) return bad(res, 'duel_not_here');
    const game = String(req.body?.game || '');
    if (!DUEL_GAMES[game]) return bad(res, 'bad_game');
    const stake = Number(req.body?.stake) || 0;
    if (!STAKES.includes(stake)) return bad(res, 'bad_stake');
    let secret = null;
    const extra = { game, stake, from: req.user.id, status: 'open' };
    if (game === 'rps') {
      if (!RPS.includes(req.body?.choice)) return bad(res, 'bad_choice');
      secret = req.body.choice;
    }
    if (game === 'coin') {
      if (!['heads', 'tails'].includes(req.body?.choice)) return bad(res, 'bad_choice');
      extra.side = req.body.choice; // public: the opponent gets the other side
    }
    let toId = null;
    if (chat.type === 'private') {
      const peer = q('SELECT u.* FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND cm.user_id != ?').get(chatId, req.user.id);
      if (!peer || String(peer.google_sub).startsWith('bot:') || String(peer.google_sub).startsWith('system:')) return bad(res, 'duel_not_here');
      toId = peer.id;
      extra.to = toId;
    }
    if (stake && coins(req.user.id) < stake) return bad(res, 'not_enough_coins');
    // Synchronous from here on: nothing else runs between taking the stake and saving the duel.
    pay(req.user.id, -stake);
    let msg;
    try {
      msg = postMessage(chatId, req.user.id, { kind: 'duel', text: DUEL_GAMES[game].name, extra });
      q('INSERT INTO duels (message_id, chat_id, game, stake, a_id, to_id, status, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(msg.id, chatId, game, stake, req.user.id, toId, 'open', secret, now(), now());
    } catch (err) { pay(req.user.id, stake); throw err; }
    pushMe(req.user.id);
    res.json({ message: msg });
  });

  api.post('/duels/:id/accept', limiter, (req, res) => {
    const d = load(req, res);
    if (!d) return;
    if (d.status !== 'open') return bad(res, 'duel_over');
    if (d.a_id === req.user.id) return bad(res, 'own_duel');
    if (d.to_id && d.to_id !== req.user.id) return bad(res, 'not_for_you', 403);
    if (d.stake && coins(req.user.id) < d.stake) return bad(res, 'not_enough_coins');
    if (d.game === 'rps' && !RPS.includes(req.body?.choice)) return bad(res, 'bad_choice');
    // Take the seat atomically: two people pressing "accept" in a group can't both get in.
    const took = tx(() => {
      const r = q("UPDATE duels SET status = 'playing', b_id = ? WHERE message_id = ? AND status = 'open'").run(req.user.id, d.message_id);
      if (!r.changes) return false;
      pay(req.user.id, -d.stake);
      return true;
    });
    if (!took) return bad(res, 'duel_over');
    const cur = { ...d, b_id: req.user.id, status: 'playing' };
    const extra = { ...extraOf(d), b: req.user.id };
    const A = d.a_id, B = req.user.id;
    if (d.game === 'dice') {
      const ra = [rnd(6) + 1, rnd(6) + 1], rb = [rnd(6) + 1, rnd(6) + 1];
      const sa = ra[0] + ra[1], sb = rb[0] + rb[1];
      finish(cur, { ...extra, rolls: { [A]: ra, [B]: rb } }, sa === sb ? 'draw' : sa > sb ? A : B);
    } else if (d.game === 'rps') {
      const ca = d.secret, cb = req.body.choice;
      finish(cur, { ...extra, picks: { [A]: ca, [B]: cb } }, ca === cb ? 'draw' : BEATS[ca] === cb ? A : B);
    } else if (d.game === 'coin') {
      const flip = rnd(2) ? 'heads' : 'tails';
      finish(cur, { ...extra, flip }, flip === extra.side ? A : B);
    } else if (d.game === 'ttt') {
      // The challenger plays ❌ and moves first.
      update(cur, { ...extra, status: 'playing', board: Array(9).fill(null), x: A, o: B, turn: A, movedAt: now() });
    }
    res.json({ ok: true });
  });

  api.post('/duels/:id/move', limiter, (req, res) => {
    const d = load(req, res);
    if (!d) return;
    if (d.game !== 'ttt' || d.status !== 'playing') return bad(res, 'duel_over');
    const x = extraOf(d);
    if (x.turn !== req.user.id) return bad(res, 'not_your_turn');
    const cell = Number(req.body?.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || x.board[cell]) return bad(res, 'bad_move');
    const mark = req.user.id === x.x ? 'x' : 'o';
    x.board[cell] = mark;
    x.last = cell;
    const w = tttWinner(x.board);
    if (w) {
      const line = LINES.find(([a, b, c]) => x.board[a] && x.board[a] === x.board[b] && x.board[a] === x.board[c]);
      return res.json({ ok: true, done: finish(d, { ...x, line: line || null }, w === 'draw' ? 'draw' : w === 'x' ? x.x : x.o) });
    }
    x.turn = req.user.id === x.x ? x.o : x.x;
    x.movedAt = now();
    update(d, x);
    res.json({ ok: true });
  });

  api.post('/duels/:id/resign', limiter, (req, res) => {
    const d = load(req, res);
    if (!d) return;
    if (d.status !== 'playing' || ![d.a_id, d.b_id].includes(req.user.id)) return bad(res, 'duel_over');
    const x = extraOf(d);
    // Claim a win when the other player hasn't moved for a day; otherwise this is giving up.
    const claim = d.game === 'ttt' && x.turn !== req.user.id && now() - (x.movedAt || 0) > MOVE_MS;
    const winner = claim ? req.user.id : (req.user.id === d.a_id ? d.b_id : d.a_id);
    finish(d, x, winner, claim ? 'Соперник не ходил больше суток' : 'Соперник сдался');
    res.json({ ok: true });
  });

  api.post('/duels/:id/cancel', limiter, (req, res) => {
    const d = load(req, res);
    if (!d) return;
    if (d.status !== 'open') return bad(res, 'duel_over');
    const declining = d.to_id === req.user.id;
    if (d.a_id !== req.user.id && !declining) return bad(res, 'not_found', 404);
    finish(d, extraOf(d), 'cancel', declining ? 'Вызов отклонён' : 'Вызов отменён');
    res.json({ ok: true });
  });
}
