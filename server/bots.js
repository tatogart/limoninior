// Bots (like Telegram): a bot is a user account driven by a program through a small HTTP API.
// Token = "<botId>:<secret>"; the program polls /bot<token>/getUpdates and answers with sendMessage.
import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db, q, now, tx, audit } from './db.js';
import { upload, saveImage, deleteMediaFile } from './media.js';
import { emitToUser, emitToChat } from './realtime.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS bots (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    commands   TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bot_updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bot_updates_bot ON bot_updates(bot_id, id);
`);

if (!q("SELECT 1 FROM pragma_table_info('bots') WHERE name = 'script'").get()) db.exec('ALTER TABLE bots ADD COLUMN script TEXT');

const BOT_SUB = 'bot:';
const MAX_BOTS = 20;
const BOT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,28}bot$/i;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const isBotUser = (u) => String(u?.google_sub || '').startsWith(BOT_SUB);

let api = null; // helpers from api.js (set in registerBots)

// ---------- updates queue (long polling) ----------

const waiters = new Map(); // botId -> Set(resolve)

function enqueue(botId, update) {
  q('INSERT INTO bot_updates (bot_id, payload, created_at) VALUES (?, ?, ?)').run(botId, JSON.stringify(update), now());
  const set = waiters.get(botId);
  if (set) { waiters.delete(botId); for (const r of set) r(); }
}

setInterval(() => q('DELETE FROM bot_updates WHERE created_at < ?').run(now() - 24 * 3600_000), 3600_000).unref();

const userView = (u) => (u ? { id: u.id, is_bot: isBotUser(u), username: u.username, name: u.name } : null);
function chatView(chatId) {
  const c = q('SELECT id, type, title FROM chats WHERE id = ?').get(chatId);
  return c ? { id: c.id, type: c.type, title: c.type === 'group' ? c.title : undefined } : null;
}
function messageView(m) {
  const extra = m.extra ? JSON.parse(m.extra) : {};
  return {
    message_id: m.id,
    chat: chatView(m.chat_id),
    from: userView(m.sender_id ? q('SELECT * FROM users WHERE id = ?').get(m.sender_id) : null),
    date: Math.floor(m.created_at / 1000),
    text: m.kind === 'text' ? m.text : undefined,
    caption: m.kind !== 'text' && m.text ? m.text : undefined,
    kind: m.kind,
    sticker: m.kind === 'sticker' ? { id: m.text, emoji: extra.emoji } : undefined,
    reply_to_message_id: m.reply_to || undefined,
  };
}

/** Called for every new message: bots in that chat get an update (never their own messages). */
export function onNewMessage(chatId, msg) {
  if (msg.kind === 'system' || msg.kind === 'call' || msg.kind === 'gcall') return;
  const bots = q(`SELECT u.id FROM chat_members cm JOIN users u ON u.id = cm.user_id
                  WHERE cm.chat_id = ? AND u.google_sub LIKE 'bot:%' AND u.id != ?`).all(chatId, msg.sender_id || 0);
  if (!bots.length) return;
  const view = messageView(msg);
  for (const b of bots) {
    enqueue(b.id, { message: view });
    try { runScript(b.id, chatId, msg); } catch (e) { console.error('bot script', e); }
  }
}

// ---------- no-code bots: the "constructor" answers by itself ----------

const MAX_RULES = 40;
const cleanText = (v, n = 2000) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
function cleanButtons(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map((b) => {
    const text = cleanText(b?.text, 40);
    if (!text) return null;
    if (b.url) { const url = String(b.url).trim(); return /^https?:\/\/[^\s]{1,500}$/i.test(url) ? { text, url } : null; }
    const reply = cleanText(b.reply, 2000);
    return reply ? { text, reply } : null;
  }).filter(Boolean);
}
const cleanReply = (r) => ({ text: cleanText(r?.text), buttons: cleanButtons(r?.buttons) });
export function cleanScript(sc) {
  if (!sc || typeof sc !== 'object') return null;
  return {
    enabled: sc.enabled !== false,
    welcome: cleanReply(sc.welcome),
    commands: (Array.isArray(sc.commands) ? sc.commands : []).slice(0, MAX_RULES).map((c) => ({
      command: String(c?.command || '').replace(/^\//, '').toLowerCase().slice(0, 32),
      description: cleanText(c?.description, 120),
      ...cleanReply(c),
    })).filter((c) => /^[a-z0-9_]{1,32}$/.test(c.command) && c.command !== 'start' && c.text),
    keywords: (Array.isArray(sc.keywords) ? sc.keywords : []).slice(0, MAX_RULES).map((k) => ({
      words: (Array.isArray(k?.words) ? k.words : String(k?.words || '').split(',')).map((w) => cleanText(w, 60).toLowerCase()).filter(Boolean).slice(0, 20),
      exact: !!k?.exact,
      ...cleanReply(k),
    })).filter((k) => k.words.length && k.text),
    fallback: cleanReply(sc.fallback),
    groups: sc.groups !== false,
  };
}
const scriptOf = (botId) => { try { return cleanScript(JSON.parse(q('SELECT script FROM bots WHERE user_id = ?').get(botId)?.script || 'null')); } catch { return null; } };

const MSK = 3 * 3600_000;
function fill(text, user) {
  const d = new Date(Date.now() + MSK);
  return text
    .replace(/\{name\}/g, user?.name || 'друг')
    .replace(/\{first\}/g, (user?.name || 'друг').split(' ')[0])
    .replace(/\{username\}/g, user?.username ? `@${user.username}` : '')
    .replace(/\{date\}/g, d.toISOString().slice(0, 10).split('-').reverse().join('.'))
    .replace(/\{time\}/g, d.toISOString().slice(11, 16))
    .replace(/\{random:([^}]{1,500})\}/g, (_, opts) => { const a = opts.split('|'); return a[Math.floor(Math.random() * a.length)]; })
    .slice(0, 4096);
}
/** A reply's buttons → inline keyboard: url buttons open links, others answer from the script. */
function keyboardOf(key, buttons) {
  if (!buttons?.length) return null;
  const rows = [];
  buttons.forEach((b, i) => {
    const btn = b.url ? { text: b.text, url: b.url } : { text: b.text, data: `nc:${key}:${i}` };
    if (!rows.length || rows[rows.length - 1].length >= 2 || b.text.length > 18) rows.push([btn]); else rows[rows.length - 1].push(btn);
  });
  return rows;
}
function findRule(sc, key) {
  if (key === 'w') return sc.welcome;
  if (key === 'f') return sc.fallback;
  const m = /^([ckb])(\d+)(?:\.(\d+))?$/.exec(key);
  if (!m) return null;
  const list = m[1] === 'c' ? sc.commands : sc.keywords;
  return list?.[Number(m[2])] || null;
}

const lastReply = new Map(); // chatId:botId -> time (anti-flood)
function sendScripted(botId, chatId, key, rule, user, replyTo) {
  if (!rule?.text) return;
  const k = `${chatId}:${botId}`;
  if (Date.now() - (lastReply.get(k) || 0) < 700) return;
  lastReply.set(k, Date.now());
  setTimeout(() => {
    if (api.postError(chatId, botId)) return;
    const kb = keyboardOf(key, rule.buttons);
    api.postMessage(chatId, botId, { kind: 'text', text: fill(rule.text, user), extra: kb ? { kb } : null, replyTo });
  }, 350);
}

function runScript(botId, chatId, msg) {
  if (!msg.sender_id || msg.kind !== 'text') return;
  const sender = q('SELECT * FROM users WHERE id = ?').get(msg.sender_id);
  if (!sender || isBotUser(sender)) return; // bots never talk to bots (no loops)
  const sc = scriptOf(botId);
  if (!sc?.enabled) return;
  const chat = q('SELECT type FROM chats WHERE id = ?').get(chatId);
  const isPrivate = chat?.type === 'private';
  if (!isPrivate && !sc.groups) return;
  const text = String(msg.text || '').trim();
  const lower = text.toLowerCase();
  const cmd = /^\/([a-z0-9_]{1,32})(?:@\w+)?(?:\s|$)/i.exec(text);
  const replyTo = isPrivate ? null : msg.id;
  if (cmd) {
    const name = cmd[1].toLowerCase();
    if (name === 'start') return sendScripted(botId, chatId, 'w', sc.welcome.text ? sc.welcome : { text: 'Привет, {first}! 👋' }, sender, replyTo);
    const i = sc.commands.findIndex((c) => c.command === name);
    if (i >= 0) return sendScripted(botId, chatId, `c${i}`, sc.commands[i], sender, replyTo);
    if (isPrivate && sc.fallback.text) return sendScripted(botId, chatId, 'f', sc.fallback, sender, replyTo);
    return;
  }
  const words = lower.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const i = sc.keywords.findIndex((k) => k.words.some((w) => (k.exact ? lower === w : (w.includes(' ') ? lower.includes(w) : words.includes(w) || lower === w))));
  if (i >= 0) return sendScripted(botId, chatId, `k${i}`, sc.keywords[i], sender, replyTo);
  if (isPrivate && sc.fallback.text) sendScripted(botId, chatId, 'f', sc.fallback, sender, replyTo);
}

/** A button under a scripted message was pressed. Returns true when handled. */
function runButton(botId, chatId, data, user) {
  const m = /^nc:([a-z0-9.]+):(\d+)$/.exec(data);
  if (!m) return false;
  const sc = scriptOf(botId);
  const rule = sc && findRule(sc, m[1]);
  const btn = rule?.buttons?.[Number(m[2])];
  if (!btn?.reply) return false;
  sendScripted(botId, chatId, `${m[1]}.${m[2]}`, { text: btn.reply, buttons: [] }, user, null);
  return true;
}

// ---------- inline keyboards ----------

/** Validate reply_markup.inline_keyboard → stored in message.extra.kb */
function cleanKeyboard(markup) {
  const rows = markup?.inline_keyboard;
  if (!Array.isArray(rows)) return null;
  const out = rows.slice(0, 8).map((row) => (Array.isArray(row) ? row.slice(0, 8) : []).map((b) => {
    const text = String(b?.text || '').trim().slice(0, 64);
    if (!text) return null;
    if (b.url) {
      const url = String(b.url);
      return /^https?:\/\/[^\s]{1,500}$/i.test(url) ? { text, url } : null;
    }
    const data = String(b.callback_data ?? '').slice(0, 64);
    return data ? { text, data } : null;
  }).filter(Boolean)).filter((r) => r.length);
  return out.length ? out : null;
}

const callbacks = new Map(); // queryId -> { userId, socketUser, at }
setInterval(() => { const t = Date.now(); for (const [k, v] of callbacks) if (t - v.at > 5 * 60_000) callbacks.delete(k); }, 60_000).unref();

// ---------- the Bot HTTP API ----------

export const botApi = express.Router();
const botLimiter = rateLimit({ windowMs: 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `b${String(req.params.token).split(':')[0]}`,
  handler: (req, res) => res.status(429).json({ ok: false, error_code: 429, description: 'Too Many Requests' }) });

const fail = (res, code, description) => res.status(code).json({ ok: false, error_code: code, description });
const ok = (res, result) => res.json({ ok: true, result });

function botFromToken(token) {
  const m = /^(\d{1,12}):([A-Za-z0-9_-]{20,64})$/.exec(String(token || ''));
  if (!m) return null;
  const b = q('SELECT b.*, u.* FROM bots b JOIN users u ON u.id = b.user_id WHERE b.user_id = ?').get(Number(m[1]));
  if (!b || b.banned) return null;
  const a = Buffer.from(sha256(m[2])), c = Buffer.from(b.token_hash);
  return a.length === c.length && crypto.timingSafeEqual(a, c) ? b : null;
}

botApi.use(express.json({ limit: '64kb' }));
const ipLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ ok: false, error_code: 429, description: 'Too Many Requests' }) });
botApi.all('/bot:token/:method', ipLimiter, botLimiter, async (req, res) => {
  const bot = botFromToken(req.params.token);
  if (!bot) return fail(res, 401, 'Unauthorized');
  const p = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  const chatOf = (id) => {
    const chatId = Number(id);
    if (!Number.isInteger(chatId) || !q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, bot.user_id)) return null;
    return chatId;
  };
  try {
    switch (req.params.method) {
      case 'getMe':
        return ok(res, { id: bot.user_id, is_bot: true, username: bot.username, name: bot.name });
      case 'getUpdates': {
        const offset = Number(p.offset) || 0;
        if (offset) q('DELETE FROM bot_updates WHERE bot_id = ? AND id < ?').run(bot.user_id, offset);
        const timeout = Math.min(Math.max(Number(p.timeout) || 0, 0), 50);
        const read = () => q('SELECT id, payload FROM bot_updates WHERE bot_id = ? AND id >= ? ORDER BY id LIMIT 100').all(bot.user_id, offset);
        let rows = read();
        if (!rows.length && timeout) {
          await new Promise((resolve) => {
            const set = waiters.get(bot.user_id) || new Set();
            set.add(resolve);
            waiters.set(bot.user_id, set);
            const t = setTimeout(resolve, timeout * 1000);
            req.on('close', () => { clearTimeout(t); resolve(); });
          });
          if (res.writableEnded || req.socket.destroyed) return;
          rows = read();
        }
        return ok(res, rows.map((r) => ({ update_id: r.id, ...JSON.parse(r.payload) })));
      }
      case 'sendMessage': {
        const chatId = chatOf(p.chat_id);
        if (!chatId) return fail(res, 400, 'Bad Request: chat not found (the user must start the bot / add it to the group first)');
        const text = String(p.text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 4096);
        if (!text) return fail(res, 400, 'Bad Request: message text is empty');
        const err = api.postError(chatId, bot.user_id);
        if (err) return fail(res, 403, `Forbidden: ${err === 'blocked' ? 'bot was blocked by the user' : err}`);
        const kb = cleanKeyboard(p.reply_markup);
        const replyTo = Number(p.reply_to_message_id) || null;
        const message = api.postMessage(chatId, bot.user_id, {
          kind: 'text', text, extra: kb ? { kb } : null,
          replyTo: replyTo && q('SELECT 1 FROM messages WHERE id = ? AND chat_id = ?').get(replyTo, chatId) ? replyTo : null,
        });
        return ok(res, messageView(q('SELECT * FROM messages WHERE id = ?').get(message.id)));
      }
      case 'editMessageText': {
        const chatId = chatOf(p.chat_id);
        const m = chatId && q('SELECT * FROM messages WHERE id = ? AND chat_id = ? AND sender_id = ?').get(Number(p.message_id), chatId, bot.user_id);
        if (!m) return fail(res, 400, 'Bad Request: message not found');
        const text = String(p.text ?? '').trim().slice(0, 4096);
        if (!text) return fail(res, 400, 'Bad Request: message text is empty');
        const kb = cleanKeyboard(p.reply_markup);
        const extra = { ...(m.extra ? JSON.parse(m.extra) : {}) };
        if (p.reply_markup !== undefined) { if (kb) extra.kb = kb; else delete extra.kb; }
        q('UPDATE messages SET text = ?, extra = ?, edited_at = ? WHERE id = ?').run(text, JSON.stringify(extra), now(), m.id);
        const fresh = q('SELECT * FROM messages WHERE id = ?').get(m.id);
        emitToChat(chatId, 'message:edit', api.serializeMessage(fresh));
        return ok(res, messageView(fresh));
      }
      case 'deleteMessage': {
        const chatId = chatOf(p.chat_id);
        const m = chatId && q('SELECT * FROM messages WHERE id = ? AND chat_id = ? AND sender_id = ?').get(Number(p.message_id), chatId, bot.user_id);
        if (!m) return fail(res, 400, 'Bad Request: message not found');
        api.removeMessage(m);
        return ok(res, true);
      }
      case 'answerCallbackQuery': {
        const cb = callbacks.get(String(p.callback_query_id || ''));
        if (!cb || cb.botId !== bot.user_id) return fail(res, 400, 'Bad Request: query is too old or invalid');
        callbacks.delete(String(p.callback_query_id));
        const text = String(p.text || '').slice(0, 200);
        emitToUser(cb.userId, 'bot:answer', { queryId: p.callback_query_id, text, alert: !!p.show_alert });
        return ok(res, true);
      }
      case 'setMyCommands': {
        const cmds = (Array.isArray(p.commands) ? p.commands : []).slice(0, 30)
          .map((c) => ({ command: String(c?.command || '').replace(/^\//, '').toLowerCase().slice(0, 32), description: String(c?.description || '').slice(0, 120) }))
          .filter((c) => /^[a-z0-9_]{1,32}$/.test(c.command));
        q('UPDATE bots SET commands = ? WHERE user_id = ?').run(JSON.stringify(cmds), bot.user_id);
        return ok(res, true);
      }
      case 'getMyCommands':
        return ok(res, JSON.parse(bot.commands || '[]'));
      default:
        return fail(res, 404, 'Not Found: method not found');
    }
  } catch (e) {
    console.error('bot api', e);
    return fail(res, 500, 'Internal Server Error');
  }
});

// ---------- management (signed-in users) ----------

const newToken = (id) => `${id}:${crypto.randomBytes(24).toString('base64url')}`;

function botInfo(userId) {
  const b = q('SELECT b.*, u.* FROM bots b JOIN users u ON u.id = b.user_id WHERE b.user_id = ?').get(userId);
  return b ? { user: api.publicUser(b), commands: JSON.parse(b.commands || '[]'), createdAt: b.created_at, noCode: !!scriptOf(userId)?.enabled } : null;
}

export function registerBots(router, helpers) {
  api = helpers;
  const { bad, int, clean } = helpers;
  const limiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });
  const myBot = (req, res) => {
    const id = int(req.params.id);
    const b = id && q('SELECT * FROM bots WHERE user_id = ?').get(id);
    if (!b || b.owner_id !== req.user.id) { bad(res, 'not_found', 404); return null; }
    return b;
  };

  router.get('/bots', (req, res) => {
    const rows = q('SELECT user_id FROM bots WHERE owner_id = ? ORDER BY created_at').all(req.user.id);
    res.json({ bots: rows.map((r) => botInfo(r.user_id)) });
  });

  // Public info for a bot's chat (commands menu, "start" button).
  router.get('/bots/:id/public', (req, res) => {
    const id = int(req.params.id);
    const b = id && q('SELECT b.commands, u.bio FROM bots b JOIN users u ON u.id = b.user_id WHERE b.user_id = ?').get(id);
    if (!b) return bad(res, 'not_found', 404);
    res.json({ commands: JSON.parse(b.commands || '[]'), about: b.bio });
  });

  router.post('/bots', limiter, (req, res) => {
    const name = clean(req.body?.name, 64);
    const username = String(req.body?.username || '').replace(/^@/, '');
    if (!name) return bad(res, 'bad_name');
    if (!BOT_NAME_RE.test(username)) return bad(res, 'bad_bot_username');
    const err = helpers.checkUsername(username);
    if (err) return bad(res, err);
    if (q('SELECT COUNT(*) AS n FROM bots WHERE owner_id = ?').get(req.user.id).n >= MAX_BOTS) return bad(res, 'too_many_bots');
    let token;
    const id = tx(() => {
      const t = now();
      const r = q(`INSERT INTO users (google_sub, email, username, name, bio, created_at, last_seen) VALUES (?, '', ?, ?, ?, ?, ?)`)
        .run(`${BOT_SUB}${crypto.randomBytes(8).toString('hex')}`, username, name, clean(req.body?.about, 160), t, t);
      const uid = Number(r.lastInsertRowid);
      token = newToken(uid);
      q('INSERT INTO bots (user_id, owner_id, token_hash, created_at) VALUES (?, ?, ?, ?)').run(uid, req.user.id, sha256(token.split(':')[1]), t);
      return uid;
    });
    const sc = req.body?.script ? cleanScript(req.body.script) : null;
    if (sc) saveScript(id, sc);
    audit(req.user.id, req.ip, 'bot_create', { botId: id, username, noCode: !!sc });
    res.json({ bot: botInfo(id), token });
  });

  const saveScript = (botId, sc) => {
    q('UPDATE bots SET script = ? WHERE user_id = ?').run(sc ? JSON.stringify(sc) : null, botId);
    // The "/" menu follows the constructor's commands.
    if (sc) q('UPDATE bots SET commands = ? WHERE user_id = ?').run(JSON.stringify([
      { command: 'start', description: 'Начать' },
      ...sc.commands.map((c) => ({ command: c.command, description: c.description || c.text.slice(0, 60) })),
    ].slice(0, 30)), botId);
  };
  router.get('/bots/:id/script', (req, res) => {
    const b = myBot(req, res);
    if (!b) return;
    res.json({ script: scriptOf(b.user_id) });
  });
  router.put('/bots/:id/script', (req, res) => {
    const b = myBot(req, res);
    if (!b) return;
    const sc = cleanScript(req.body?.script);
    if (!sc) return bad(res, 'bad_script');
    saveScript(b.user_id, sc);
    res.json({ script: sc, bot: botInfo(b.user_id) });
  });

  router.post('/bots/:id/token', (req, res) => {
    const b = myBot(req, res);
    if (!b) return;
    const token = newToken(b.user_id);
    q('UPDATE bots SET token_hash = ? WHERE user_id = ?').run(sha256(token.split(':')[1]), b.user_id);
    audit(req.user.id, req.ip, 'bot_token_reset', { botId: b.user_id });
    res.json({ token });
  });

  router.patch('/bots/:id', (req, res) => {
    const b = myBot(req, res);
    if (!b) return;
    const u = q('SELECT * FROM users WHERE id = ?').get(b.user_id);
    const name = req.body?.name !== undefined ? clean(req.body.name, 64) : u.name;
    const bio = req.body?.about !== undefined ? clean(req.body.about, 160) : u.bio;
    if (!name) return bad(res, 'bad_name');
    q('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(name, bio, b.user_id);
    res.json({ bot: botInfo(b.user_id) });
  });

  router.post('/bots/:id/avatar', upload.single('file'), (req, res) => {
    const b = myBot(req, res);
    if (!b) return;
    const img = saveImage(req.file, { ownerId: req.user.id, kind: 'avatar', maxBytes: 5 * 1024 * 1024 });
    const old = q('SELECT avatar FROM users WHERE id = ?').get(b.user_id)?.avatar;
    q('UPDATE users SET avatar = ? WHERE id = ?').run(img.name, b.user_id);
    deleteMediaFile(old);
    res.json({ bot: botInfo(b.user_id) });
  });

  router.delete('/bots/:id', (req, res) => {
    const b = myBot(req, res);
    if (!b) return;
    const chats = q('SELECT chat_id FROM chat_members WHERE user_id = ?').all(b.user_id).map((r) => r.chat_id);
    const avatar = q('SELECT avatar FROM users WHERE id = ?').get(b.user_id)?.avatar;
    q('DELETE FROM users WHERE id = ?').run(b.user_id);
    deleteMediaFile(avatar);
    // Private chats with the bot are gone for the other side too.
    for (const cid of chats) {
      const c = q('SELECT type FROM chats WHERE id = ?').get(cid);
      if (c?.type === 'private') helpers.deleteChat(cid);
      else if (c) helpers.pushChat(cid);
    }
    audit(req.user.id, req.ip, 'bot_delete', { botId: b.user_id });
    res.json({ ok: true });
  });

  // A user pressed an inline button under a bot message.
  router.post('/messages/:id/callback', (req, res) => {
    const id = int(req.params.id);
    const m = id && q('SELECT * FROM messages WHERE id = ?').get(id);
    if (!m || !q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, req.user.id)) return bad(res, 'not_found', 404);
    const kb = m.extra ? JSON.parse(m.extra).kb : null;
    const data = String(req.body?.data || '');
    if (!kb || !kb.flat().some((b) => b.data === data) || !q('SELECT 1 FROM bots WHERE user_id = ?').get(m.sender_id)) return bad(res, 'not_found', 404);
    if (runButton(m.sender_id, m.chat_id, data, req.user)) return res.json({ queryId: null, handled: true });
    const queryId = crypto.randomBytes(9).toString('base64url');
    callbacks.set(queryId, { botId: m.sender_id, userId: req.user.id, at: Date.now() });
    enqueue(m.sender_id, { callback_query: { id: queryId, from: userView(req.user), message: messageView(m), data } });
    res.json({ queryId });
  });
}

