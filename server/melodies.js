export function registerMelodies(api, h) {
  const { int, clean, bad, isMember, postError, insertMessage, broadcastNewMessage, sendLimiter, featureGate, validReply } = h;
  api.post('/chats/:id/melody', featureGate('extras'), sendLimiter, (req, res) => {
    const chatId = int(req.params.id);
    if (!chatId || !isMember(chatId, req.user.id)) return bad(res, 'not_found', 404);
    const denied = postError(chatId, req.user.id);
    if (denied) return bad(res, denied, 403);
    if (typeof req.body?.text !== 'string') return bad(res, 'empty');
    const text = clean(req.body.text, 241);
    if (!text) return bad(res, 'empty');
    if (text.length > 240) return bad(res, 'too_long');
    const message = insertMessage(chatId, req.user.id, { kind: 'melody', text, replyTo: validReply(chatId, req.body?.replyTo) });
    res.json({ message: broadcastNewMessage(chatId, message) });
  });
}
