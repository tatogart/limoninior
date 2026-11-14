// Limochat-only features:
//  • Time capsules — a message everybody sees as a sealed envelope with a countdown; the text is kept
//    apart from the message and revealed for everyone (the author included) at the chosen moment.
//  • Reminders — "remind me" on any message, not only in Saved messages: at the chosen time the
//    message comes back to you in Saved messages with a jump link, plus a push.
//  • Decision wheel — a fortune wheel with options; the server picks the result fairly and every
//    member watches the same spin land on it.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db, q, now } from './db.js';
import { emitToChat, emitToUser } from './realtime.js';
import { sendPush } from './push.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS capsules (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    open_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS capsules_open ON capsules(open_at);
  CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    at         INTEGER NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS reminders_at ON reminders(at);
`);

const MIN_CAPSULE = 60_000;
const MAX_CAPSULE = 10 * 365 * 864e5;
const MAX_REMINDERS = 200;
const fmtDate = (t) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function registerFeatures(api, h) {
  const { bad, int, clean, isMember, postError, postMessage, serializeMessage, ensurePrivateChat, chatTitleFor, validReply } = h;
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });

  const canPost = (req, res) => {
    const id = int(req.params.id);
    if (!id || !isMember(id, req.user.id)) { bad(res, 'not_found', 404); return null; }
    const e = postError(id, req.user.id);
    if (e) { bad(res, e, 403); return null; }
    return id;
  };
  const editAndEmit = (m, extra, text = m.text) => {
    q('UPDATE messages SET extra = ?, text = ? WHERE id = ?').run(JSON.stringify(extra), text, m.id);
    const payload = serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(m.id));
    emitToChat(m.chat_id, 'message:edit', payload);
    return payload;
  };

  // ---------------------------------------------------------------- time capsules

  api.post('/chats/:id/capsule', limiter, (req, res) => {
    const id = canPost(req, res);
    if (!id) return;
    const text = clean(req.body?.text, 4096);
    const openAt = Math.trunc(Number(req.body?.openAt));
    if (!text) return bad(res, 'empty');
    if (!Number.isFinite(openAt) || openAt < now() + MIN_CAPSULE - 5000 || openAt > now() + MAX_CAPSULE) return bad(res, 'bad_open_at');
    const msg = postMessage(id, req.user.id, { kind: 'capsule', text: '', extra: { openAt, opened: false }, replyTo: validReply(id, req.body?.replyTo) });
    q('INSERT INTO capsules (message_id, text, open_at) VALUES (?, ?, ?)').run(msg.id, text, openAt);
    res.json({ message: msg });
  });

  function openCapsules() {
    const due = q('SELECT c.*, m.chat_id, m.extra, m.sender_id FROM capsules c JOIN messages m ON m.id = c.message_id WHERE c.open_at <= ? LIMIT 50').all(now());
    for (const c of due) {
      q('DELETE FROM capsules WHERE message_id = ?').run(c.message_id);
      const m = q('SELECT * FROM messages WHERE id = ?').get(c.message_id);
      if (!m) continue;
      editAndEmit(m, { ...(JSON.parse(m.extra || '{}')), opened: true, openedAt: now() }, c.text);
      emitToChat(m.chat_id, 'capsule:open', { chatId: m.chat_id, messageId: m.id });
      const created = new Date(m.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
      const members = q('SELECT user_id FROM chat_members WHERE chat_id = ? AND muted = 0').all(m.chat_id).map((r) => r.user_id);
      sendPush(members, { type: 'message', chatId: m.chat_id, title: '🔓 Капсула времени открылась', body: `Её запечатали ${created}. Посмотрите, что внутри!`, tag: `capsule${m.id}` });
    }
  }

  // ---------------------------------------------------------------- reminders

  api.get('/reminders', (req, res) => {
    const rows = q('SELECT r.*, m.chat_id FROM reminders r JOIN messages m ON m.id = r.message_id WHERE r.user_id = ? ORDER BY r.at').all(req.user.id);
    res.json({ reminders: rows.map((r) => ({ id: r.id, messageId: r.message_id, chatId: r.chat_id, at: r.at, note: r.note })) });
  });

  api.post('/messages/:id/remind', limiter, (req, res) => {
    const m = int(req.params.id) && q('SELECT * FROM messages WHERE id = ?').get(int(req.params.id));
    if (!m || !isMember(m.chat_id, req.user.id)) return bad(res, 'not_found', 404);
    const at = Math.trunc(Number(req.body?.at));
    if (!Number.isFinite(at) || at < now() + 30_000 || at > now() + 2 * 365 * 864e5) return bad(res, 'bad_time');
    if (q('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?').get(req.user.id).n >= MAX_REMINDERS) return bad(res, 'too_many_reminders');
    q(`INSERT INTO reminders (user_id, message_id, at, note, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, message_id) DO UPDATE SET at = excluded.at, note = excluded.note`)
      .run(req.user.id, m.id, at, clean(req.body?.note, 200), now());
    const r = q('SELECT * FROM reminders WHERE user_id = ? AND message_id = ?').get(req.user.id, m.id);
    res.json({ reminder: { id: r.id, messageId: m.id, chatId: m.chat_id, at: r.at, note: r.note } });
  });

  api.delete('/reminders/:id', (req, res) => {
    q('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(int(req.params.id) || 0, req.user.id);
    res.json({ ok: true });
  });

  function fireReminders() {
    const due = q('SELECT r.*, m.chat_id, m.kind, m.text, m.sender_id FROM reminders r JOIN messages m ON m.id = r.message_id WHERE r.at <= ? LIMIT 100').all(now());
    for (const r of due) {
      q('DELETE FROM reminders WHERE id = ?').run(r.id);
      if (!isMember(r.chat_id, r.user_id)) continue;
      const preview = r.kind === 'text' ? r.text.slice(0, 300) : { image: '🖼 Фото', file: '📎 Файл', voice: '🎤 Голосовое', sticker: 'Стикер', capsule: '🔒 Капсула времени', wheel: '🎡 Колесо решений' }[r.kind] || 'Сообщение';
      const from = chatTitleFor(r.chat_id, r.user_id);
      const saved = ensurePrivateChat(r.user_id, r.user_id);
      postMessage(saved, null, {
        kind: 'system',
        text: `⏰ Напоминание${r.note ? `: ${r.note}` : ''}`,
        extra: { reminder: { chatId: r.chat_id, messageId: r.message_id, from, preview } },
      });
      emitToUser(r.user_id, 'reminder', { chatId: r.chat_id, messageId: r.message_id, from, preview, note: r.note });
      sendPush([r.user_id], { type: 'message', chatId: r.chat_id, title: `⏰ ${r.note || 'Напоминание'}`, body: `${from}: ${preview}`.slice(0, 200), tag: `rem${r.id}` });
    }
  }

  // ---------------------------------------------------------------- decision wheel

  api.post('/chats/:id/wheel', limiter, (req, res) => {
    const id = canPost(req, res);
    if (!id) return;
    const question = clean(req.body?.question, 200);
    const options = [...new Set((Array.isArray(req.body?.options) ? req.body.options : []).map((o) => clean(o, 60)).filter(Boolean))].slice(0, 12);
    if (!question) return bad(res, 'bad_title');
    if (options.length < 2) return bad(res, 'few_options');
    res.json({ message: postMessage(id, req.user.id, { kind: 'wheel', text: question, extra: { options, result: null, spins: 0 } }) });
  });

  api.post('/messages/:id/spin', limiter, (req, res) => {
    const m = int(req.params.id) && q("SELECT * FROM messages WHERE id = ? AND kind = 'wheel'").get(int(req.params.id));
    if (!m || !isMember(m.chat_id, req.user.id)) return bad(res, 'not_found', 404);
    const x = JSON.parse(m.extra || '{}');
    // Anyone may spin once; spinning again is the author's call.
    if (x.result != null && m.sender_id !== req.user.id) return bad(res, 'already_spun', 409);
    if (x.spunAt && now() - x.spunAt < 6000) return bad(res, 'spinning', 409);
    const result = crypto.randomInt(x.options.length);
    const payload = editAndEmit(m, { ...x, result, spins: (x.spins || 0) + 1, spunAt: now(), spunBy: req.user.id });
    res.json({ message: payload });
  });

  // One ticker for everything time-based.
  const tick = () => { try { openCapsules(); fireReminders(); } catch (e) { console.error('features tick', e); } };
  setInterval(tick, 10_000).unref();
  setTimeout(tick, 2000).unref();
}
