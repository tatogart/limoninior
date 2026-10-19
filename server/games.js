// Mini-games instead of a daily bonus: play to earn lemons (with a daily cap), top-10 boards,
// and chat games (🎲 🎯 🏀 🎳) whose result is rolled by the server.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db, q, now } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS game_sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game       TEXT NOT NULL,
    started_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_results (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game       TEXT NOT NULL,
    score      INTEGER NOT NULL,
    reward     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_results_user ON game_results(user_id, created_at);
  CREATE INDEX IF NOT EXISTS game_results_game ON game_results(game, score);
`);

export const DAILY_CAP = 60; // lemons per day from games (subscriptions multiply it)
const MSK = 3 * 3600_000;
const dayStart = () => { const t = now() + MSK; return t - (t % 864e5) - MSK; };

/**
 * Every game: how long a fair round takes and how a result turns into score and lemons.
 * Scores are checked against the time the round really took, so a forged request gains little.
 */
const GAMES = {
  catch: {
    title: 'Ловец лимонов', minMs: 28_000, maxMs: 120_000,
    score: (b) => Math.max(0, Math.min(Math.trunc(Number(b.score) || 0), 160)),
    reward: (s) => Math.min(15, Math.floor(s / 6)),
  },
  memory: {
    title: 'Лимонные пары', minMs: 6_000, maxMs: 30 * 60_000,
    score: (b, ms) => {
      const moves = Math.trunc(Number(b.moves) || 0);
      if (moves < 8) return -1;
      return Math.max(5, 100 - (moves - 8) * 4 - Math.floor(ms / 3000));
    },
    reward: (s) => Math.min(12, Math.ceil(s / 9)),
  },
  reaction: {
    title: 'Реакция', minMs: 7_000, maxMs: 5 * 60_000,
    // Average reaction in ms over 5 rounds → lower is better; the score is "how fast".
    score: (b) => {
      const avg = Math.trunc(Number(b.avg) || 0);
      if (avg < 110) return -1; // faster than a human: rejected
      return Math.max(0, Math.min(1000, 1000 - avg));
    },
    reward: (s) => (s >= 750 ? 10 : s >= 650 ? 7 : s >= 500 ? 4 : 2),
  },
};

export const CHAT_GAMES = {
  '🎲': { max: 6, label: (v) => `выпало ${v}` },
  '🎯': { max: 6, label: (v) => (v === 6 ? 'точно в центр!' : v === 1 ? 'мимо' : `${v} очков`) },
  '🏀': { max: 5, label: (v) => (v >= 4 ? 'в кольцо!' : 'мимо') },
  '⚽': { max: 5, label: (v) => (v >= 3 ? 'гол!' : 'мимо') },
  '🎳': { max: 6, label: (v) => (v === 6 ? 'страйк!' : `сбито ${v === 1 ? 0 : v} кеглей`) },
};

export function registerGames(api, { bad, isMember, postError, postMessage, pushMe, activePlan, validReply, int }) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });
  const capFor = (u) => DAILY_CAP * (activePlan(u)?.bonusMult || 1);
  const earnedToday = (uid) => q('SELECT COALESCE(SUM(reward), 0) AS n FROM game_results WHERE user_id = ? AND created_at >= ?').get(uid, dayStart()).n;

  api.get('/games', (req, res) => {
    const uid = req.user.id;
    res.json({
      earnedToday: earnedToday(uid),
      cap: capFor(req.user),
      games: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => {
        const r = q('SELECT MAX(score) AS best, COUNT(*) AS plays FROM game_results WHERE user_id = ? AND game = ?').get(uid, k);
        return [k, { title: g.title, best: r.best || 0, plays: r.plays }];
      })),
    });
  });

  api.get('/games/:game/top', (req, res) => {
    if (!GAMES[req.params.game]) return bad(res, 'not_found', 404);
    const rows = q(`SELECT u.id, u.name, u.username, u.avatar, MAX(r.score) AS best FROM game_results r JOIN users u ON u.id = r.user_id
                    WHERE r.game = ? AND u.banned = 0 GROUP BY u.id ORDER BY best DESC LIMIT 10`).all(req.params.game);
    res.json({ top: rows.map((r) => ({ id: r.id, name: r.name, username: r.username, avatar: r.avatar ? `/media/${r.avatar}` : null, best: r.best })) });
  });

  api.post('/games/:game/start', limiter, (req, res) => {
    if (!GAMES[req.params.game]) return bad(res, 'not_found', 404);
    q('DELETE FROM game_sessions WHERE user_id = ? AND started_at < ?').run(req.user.id, now() - 3600_000);
    const token = crypto.randomBytes(16).toString('base64url');
    q('INSERT INTO game_sessions (token, user_id, game, started_at) VALUES (?, ?, ?, ?)').run(token, req.user.id, req.params.game, now());
    res.json({ token });
  });

  api.post('/games/finish', limiter, (req, res) => {
    const s = q('SELECT * FROM game_sessions WHERE token = ? AND user_id = ?').get(String(req.body?.token || ''), req.user.id);
    if (!s) return bad(res, 'bad_session');
    q('DELETE FROM game_sessions WHERE token = ?').run(s.token);
    const g = GAMES[s.game];
    const ms = now() - s.started_at;
    if (ms < g.minMs || ms > g.maxMs) return bad(res, 'bad_session');
    const score = g.score(req.body || {}, ms);
    if (score < 0) return bad(res, 'bad_session');
    const prevBest = q('SELECT MAX(score) AS b FROM game_results WHERE user_id = ? AND game = ?').get(req.user.id, s.game).b || 0;
    const cap = capFor(req.user);
    const left = Math.max(0, cap - earnedToday(req.user.id));
    const reward = Math.min(left, g.reward(score) * (activePlan(req.user)?.bonusMult || 1));
    q('INSERT INTO game_results (user_id, game, score, reward, created_at) VALUES (?, ?, ?, ?, ?)').run(req.user.id, s.game, score, reward, now());
    if (reward) { q('UPDATE users SET coins = coins + ? WHERE id = ?').run(reward, req.user.id); pushMe(req.user.id); }
    res.json({ score, reward, best: Math.max(prevBest, score), record: score > prevBest && prevBest > 0, earnedToday: earnedToday(req.user.id), cap });
  });

  // Chat games: the server rolls, everyone sees the same result.
  api.post('/chats/:id/dice', limiter, (req, res) => {
    const id = int(req.params.id);
    if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
    { const e = postError(id, req.user.id); if (e) return bad(res, e, 403); }
    const emoji = CHAT_GAMES[req.body?.emoji] ? req.body.emoji : '🎲';
    const value = crypto.randomInt(CHAT_GAMES[emoji].max) + 1;
    res.json({ message: postMessage(id, req.user.id, { kind: 'dice', extra: { emoji, value, max: CHAT_GAMES[emoji].max, label: CHAT_GAMES[emoji].label(value) }, replyTo: validReply(id, req.body?.replyTo) }) });
  });
}
