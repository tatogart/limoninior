// Anonymous messages ("анонимные послания"): write to anyone who accepts them without showing who
// you are. The recipient can answer (the sender sees the answer), hide it, block that anonymous
// sender (still without learning who it is) or report it — moderators do see the sender.
import rateLimit from 'express-rate-limit';
import { db, q, now } from './db.js';
import { emitToUser } from './realtime.js';
import { sendPush } from './push.js';
import { profileOf } from './profiles.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS anon_msgs (
    id          INTEGER PRIMARY KEY,
    to_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    style       TEXT NOT NULL DEFAULT 'lemon',
    reply       TEXT,
    reply_at    INTEGER,
    read        INTEGER NOT NULL DEFAULT 0,
    hidden_to   INTEGER NOT NULL DEFAULT 0,
    hidden_from INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS anon_to ON anon_msgs(to_id, id);
  CREATE INDEX IF NOT EXISTS anon_from ON anon_msgs(from_id, id);
  CREATE TABLE IF NOT EXISTS anon_blocks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, blocked_id)
  ) WITHOUT ROWID;
`);

export const ANON_STYLES = ['lemon', 'love', 'night', 'fire', 'mint', 'sky'];
const human = (u) => u && !/^(bot|system):/.test(String(u.google_sub)) && !u.banned;
export const anonOpen = (u) => human(u) && !profileOf(u).anonOff;
const unread = (id) => q('SELECT COUNT(*) AS n FROM anon_msgs WHERE to_id = ? AND read = 0 AND hidden_to = 0').get(id).n;

export function registerAnon(api, { bad, int, clean, publicUser, isBlocked, pushMe }) {
  const perHour = rateLimit({ windowMs: 60 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}`,
    handler: (req, res) => bad(res, 'anon_limit', 429) });
  const inbox = (r) => ({ id: r.id, text: r.text, style: r.style, reply: r.reply, replyAt: r.reply_at, read: !!r.read, at: r.created_at });

  api.post('/users/:id/anon', perHour, (req, res) => {
    const to = q('SELECT * FROM users WHERE id = ?').get(int(req.params.id));
    if (!to || to.id === req.user.id) return bad(res, 'not_found', 404);
    if (!anonOpen(to)) return bad(res, 'anon_off', 403);
    if (isBlocked(to.id, req.user.id) || q('SELECT 1 FROM anon_blocks WHERE user_id = ? AND blocked_id = ?').get(to.id, req.user.id)) return bad(res, 'anon_off', 403);
    // At most 5 a day to the same person.
    if (q('SELECT COUNT(*) AS n FROM anon_msgs WHERE from_id = ? AND to_id = ? AND created_at > ?').get(req.user.id, to.id, now() - 864e5).n >= 5) return bad(res, 'anon_limit', 429);
    const text = clean(req.body?.text, 1000);
    if (!text) return bad(res, 'empty');
    const style = ANON_STYLES.includes(req.body?.style) ? req.body.style : 'lemon';
    q('INSERT INTO anon_msgs (to_id, from_id, text, style, created_at) VALUES (?, ?, ?, ?, ?)').run(to.id, req.user.id, text, style, now());
    emitToUser(to.id, 'anon:new', { unread: unread(to.id) });
    sendPush([to.id], { type: 'anon', title: '🎭 Анонимное послание', body: 'Кто-то написал вам анонимно. Откройте, чтобы прочитать', tag: 'anon' });
    res.json({ ok: true });
  });

  api.get('/anon/inbox', (req, res) => {
    const rows = q('SELECT * FROM anon_msgs WHERE to_id = ? AND hidden_to = 0 ORDER BY id DESC LIMIT 200').all(req.user.id);
    res.json({ items: rows.map(inbox), open: anonOpen(req.user) });
  });
  api.post('/anon/read', (req, res) => {
    q('UPDATE anon_msgs SET read = 1 WHERE to_id = ? AND read = 0').run(req.user.id);
    emitToUser(req.user.id, 'anon:new', { unread: 0 });
    res.json({ ok: true });
  });
  api.get('/anon/unread', (req, res) => res.json({ unread: unread(req.user.id), open: anonOpen(req.user) }));

  api.get('/anon/sent', (req, res) => {
    const rows = q('SELECT * FROM anon_msgs WHERE from_id = ? AND hidden_from = 0 ORDER BY id DESC LIMIT 200').all(req.user.id);
    res.json({ items: rows.map((r) => ({ ...inbox(r), to: publicUser(q('SELECT * FROM users WHERE id = ?').get(r.to_id)) })) });
  });

  api.post('/anon/:id/reply', (req, res) => {
    const m = q('SELECT * FROM anon_msgs WHERE id = ? AND to_id = ?').get(int(req.params.id), req.user.id);
    if (!m) return bad(res, 'not_found', 404);
    const text = clean(req.body?.text, 1000);
    if (!text) return bad(res, 'empty');
    q('UPDATE anon_msgs SET reply = ?, reply_at = ?, read = 1 WHERE id = ?').run(text, now(), m.id);
    if (!m.hidden_from) {
      emitToUser(m.from_id, 'anon:reply', { id: m.id, name: req.user.name });
      sendPush([m.from_id], { type: 'anon', title: `🎭 ${req.user.name} ответил(а) на ваше послание`, body: text.slice(0, 120), tag: `anon-r${m.id}` });
    }
    res.json({ ok: true });
  });

  api.delete('/anon/:id', (req, res) => {
    const id = int(req.params.id);
    q('UPDATE anon_msgs SET hidden_to = 1 WHERE id = ? AND to_id = ?').run(id, req.user.id);
    q('UPDATE anon_msgs SET hidden_from = 1 WHERE id = ? AND from_id = ?').run(id, req.user.id);
    res.json({ ok: true });
  });

  api.post('/anon/:id/block', (req, res) => {
    const m = q('SELECT * FROM anon_msgs WHERE id = ? AND to_id = ?').get(int(req.params.id), req.user.id);
    if (!m) return bad(res, 'not_found', 404);
    q('INSERT OR IGNORE INTO anon_blocks (user_id, blocked_id) VALUES (?, ?)').run(req.user.id, m.from_id);
    q('UPDATE anon_msgs SET hidden_to = 1 WHERE to_id = ? AND from_id = ?').run(req.user.id, m.from_id);
    res.json({ ok: true });
  });

  api.patch('/me/anon', (req, res) => {
    const p = profileOf(req.user);
    p.anonOff = req.body?.open === false;
    q('UPDATE users SET profile_x = ? WHERE id = ?').run(JSON.stringify(p), req.user.id);
    pushMe(req.user.id);
    res.json({ ok: true, open: !p.anonOff });
  });
}

/** For reports: an anonymous message the reporter received. */
export function anonSnapshot(id, userId) {
  const m = q('SELECT * FROM anon_msgs WHERE id = ? AND to_id = ?').get(id, userId);
  if (!m) return null;
  const s = q('SELECT id, name, username FROM users WHERE id = ?').get(m.from_id);
  return { offender: m.from_id, data: { kind: 'anon', text: m.text, sender: s, at: m.created_at } };
}
