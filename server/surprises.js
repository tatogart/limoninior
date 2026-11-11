import { SURPRISE_SKINS } from '../public/js/surprise-shared.js';

// Dependencies are supplied by the existing API so permission checks, rate limits,
// message insertion, moderation and realtime delivery use the normal chat pipeline.
export function registerSurprises(api, h) {
  const { db, q, tx, clean, int, bad, isMember, postError, filterText,
    insertMessage, broadcastNewMessage, validReply, sendLimiter, featureGate } = h;
  db.exec(`CREATE TABLE IF NOT EXISTS surprises (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    text TEXT NOT NULL
  )`);

  api.post('/chats/:id/surprise', featureGate('extras'), sendLimiter, (req, res) => {
    const chatId = int(req.params.id);
    if (!chatId || !isMember(chatId, req.user.id)) return bad(res, 'not_found', 404);
    const denied = postError(chatId, req.user.id);
    if (denied) return bad(res, denied, 403);
    if (typeof req.body?.text !== 'string') return bad(res, 'empty');
    const text = clean(req.body.text, 1001);
    if (!text) return bad(res, 'empty');
    if (text.length > 1000) return bad(res, 'too_long');
    const skin = req.body?.skin ?? 'lemon';
    if (typeof skin !== 'string' || !Object.hasOwn(SURPRISE_SKINS, skin)) return bad(res, 'bad_surprise_skin');
    const title = clean(req.body?.title, 60) || 'Для тебя кое-что есть';
    const message = tx(() => {
      const m = insertMessage(chatId, req.user.id, {
        kind: 'surprise', text: title, extra: { skin }, replyTo: validReply(chatId, req.body?.replyTo),
      });
      q('INSERT INTO surprises (message_id, text) VALUES (?, ?)').run(m.id, filterText(text));
      return m;
    });
    // Broadcast only after both rows have committed; the hidden text is never serialized.
    res.json({ message: broadcastNewMessage(chatId, message) });
  });

  api.post('/messages/:id/surprise-open', (req, res) => {
    const id = int(req.params.id);
    const m = id && q("SELECT id, chat_id FROM messages WHERE id = ? AND kind = 'surprise'").get(id);
    if (!m || !isMember(m.chat_id, req.user.id)) return bad(res, 'not_found', 404);
    const surprise = q('SELECT text FROM surprises WHERE message_id = ?').get(id);
    if (!surprise) return bad(res, 'not_found', 404);
    res.set('Cache-Control', 'no-store');
    res.json({ text: surprise.text });
  });
}
