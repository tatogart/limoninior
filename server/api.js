import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { q, tx, now, audit } from './db.js';
import {
  verifyGoogleCredential, upsertUser, createSession, destroySession,
  requireAuth, requireProfile, isAdminUser, hashPassword, verifyPassword, createLocalUser, sessionFromCookie,
} from './auth.js';
import { isValidSticker, giftById, DAILY_BONUS } from '../public/js/catalog.js';
import { upload, saveImage, deleteMediaFile } from './media.js';
import { isOnline, emitToUser, emitToUsers, emitToChat, memberIds, disconnectSession } from './realtime.js';

export const api = express.Router();

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
const RESERVED = new Set(['admin', 'administrator', 'support', 'limoninior', 'system', 'root', 'moderator', 'official', 'settings']);
const MAX_TEXT = 4096;
const PAGE = 50;
export const OFFICIAL_SUB = 'system:limoninior';

/** Users and channels share one @username namespace (like Telegram). */
function usernameOwner(name) {
  const u = q('SELECT id FROM users WHERE username = ?').get(name);
  if (u) return { kind: 'user', id: u.id };
  const c = q('SELECT id FROM chats WHERE username = ?').get(name);
  return c ? { kind: 'chat', id: c.id } : null;
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const int = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const bad = (res, error, status = 400) => res.status(status).json({ error });
const mediaUrl = (name) => (name ? `/media/${name}` : null);

// ---------- serializers ----------

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    bio: u.bio,
    avatar: mediaUrl(u.avatar),
    online: isOnline(u.id),
    lastSeen: u.last_seen,
    verified: !!u.verified,
    official: u.google_sub === OFFICIAL_SUB,
    giftsCount: q('SELECT COUNT(*) AS n FROM user_gifts WHERE to_id = ?').get(u.id).n,
  };
}

export function meUser(u) {
  return {
    ...publicUser(u),
    email: u.email,
    isAdmin: isAdminUser(u),
    needsProfile: !u.username,
    coins: u.coins,
    nextBonusAt: u.last_bonus + 864e5,
    hasPassword: !!u.password_hash,
    hasGoogle: !String(u.google_sub).startsWith('local:'),
  };
}

export function reactionSummary(messageId) {
  const rows = q('SELECT emoji, COUNT(*) AS n FROM reactions WHERE message_id = ? GROUP BY emoji ORDER BY n DESC, MIN(created_at)').all(messageId);
  return rows.map((r) => ({ emoji: r.emoji, count: r.n }));
}

function serializeMessage(m, viewerId = null) {
  if (!m) return null;
  let reply = null;
  if (m.reply_to) {
    const r = q('SELECT id, sender_id, kind, text FROM messages WHERE id = ? AND chat_id = ?').get(m.reply_to, m.chat_id);
    reply = r ? { id: r.id, senderId: r.sender_id, kind: r.kind, text: r.text.slice(0, 200) } : { id: m.reply_to, deleted: true };
  }
  return {
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    kind: m.kind,
    text: m.text,
    file: mediaUrl(m.file),
    width: m.width,
    height: m.height,
    replyTo: reply,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    extra: m.extra ? JSON.parse(m.extra) : null,
    views: m.views,
    reactions: reactionSummary(m.id),
    myReaction: viewerId ? q('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?').get(m.id, viewerId)?.emoji || null : null,
  };
}

/** Public card of a channel (also shown to non-subscribers). */
export function channelPublic(c) {
  return {
    id: c.id,
    type: 'channel',
    title: c.title,
    avatar: mediaUrl(c.avatar),
    username: c.username,
    description: c.description,
    verified: !!c.verified,
    membersCount: q('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?').get(c.id).n,
  };
}

function chatForUser(chatId, userId) {
  const c = q(`SELECT c.*, cm.last_read_id, cm.role, cm.muted FROM chats c
               JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
               WHERE c.id = ?`).get(userId, chatId);
  if (!c) return null;
  const last = c.last_msg_id ? q('SELECT * FROM messages WHERE id = ?').get(c.last_msg_id) : null;
  const unread = q('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id > ? AND (sender_id IS NULL OR sender_id != ?)')
    .get(chatId, c.last_read_id, userId).n;
  if (c.type === 'channel') {
    return {
      ...channelPublic(c),
      role: c.role,
      ownerId: c.owner_id,
      canPost: c.role === 'owner' || c.role === 'admin',
      verifyRequested: c.role === 'owner' ? !!c.verify_requested : undefined,
      muted: !!c.muted,
      lastMessage: serializeMessage(last),
      unread,
      lastReadId: c.last_read_id,
      peerReadId: 0,
      createdAt: c.created_at,
    };
  }
  const others = q(`SELECT u.*, cm.last_read_id AS read_id FROM chat_members cm JOIN users u ON u.id = cm.user_id
                    WHERE cm.chat_id = ? AND cm.user_id != ?`).all(chatId, userId);
  const peer = c.type === 'private' ? others[0] : null;
  return {
    id: c.id,
    type: c.type,
    title: c.type === 'group' ? c.title : c.type === 'saved' ? 'Избранное' : peer?.name || 'Удалённый аккаунт',
    avatar: c.type === 'group' ? mediaUrl(c.avatar) : peer ? mediaUrl(peer.avatar) : null,
    peer: peer ? publicUser(peer) : null,
    membersCount: others.length + 1,
    role: c.role,
    ownerId: c.owner_id,
    canPost: true,
    muted: !!c.muted,
    lastMessage: serializeMessage(last),
    unread,
    lastReadId: c.last_read_id,
    peerReadId: c.type === 'saved' ? c.last_msg_id : others.reduce((mx, o) => Math.max(mx, o.read_id), 0),
    createdAt: c.created_at,
  };
}

function isMember(chatId, userId) {
  return !!q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
}

/** Push fresh chat state to every member (each gets their own view). */
export function pushChat(chatId) {
  for (const uid of memberIds(chatId)) emitToUser(uid, 'chat', chatForUser(chatId, uid));
}

function insertMessage(chatId, senderId, fields) {
  const t = now();
  const r = q(`INSERT INTO messages (chat_id, sender_id, kind, text, file, width, height, reply_to, created_at, extra)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(chatId, senderId, fields.kind || 'text', fields.text || '', fields.file || null,
      fields.width || null, fields.height || null, fields.replyTo || null, t, fields.extra ? JSON.stringify(fields.extra) : null);
  const id = Number(r.lastInsertRowid);
  q('UPDATE chats SET last_msg_id = ? WHERE id = ?').run(id, chatId);
  if (senderId) q('UPDATE chat_members SET last_read_id = ? WHERE chat_id = ? AND user_id = ?').run(id, chatId, senderId);
  return q('SELECT * FROM messages WHERE id = ?').get(id);
}

function broadcastNewMessage(chatId, msg) {
  const payload = serializeMessage(msg);
  for (const uid of memberIds(chatId)) {
    emitToUser(uid, 'message', { message: payload, chat: chatForUser(chatId, uid) });
  }
  return payload;
}

const systemMessage = (chatId, text) => broadcastNewMessage(chatId, insertMessage(chatId, null, { kind: 'system', text }));

/** Get or create the private chat between two users (or "saved" when a === b). */
export function ensurePrivateChat(a, b) {
  const saved = a === b;
  const key = saved ? `saved:${a}` : `${Math.min(a, b)}:${Math.max(a, b)}`;
  const c = q('SELECT id FROM chats WHERE pair_key = ?').get(key);
  if (c) return c.id;
  return tx(() => {
    const r = q('INSERT INTO chats (type, pair_key, created_at) VALUES (?, ?, ?)').run(saved ? 'saved' : 'private', key, now());
    const id = Number(r.lastInsertRowid);
    q("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, a, now());
    if (!saved) q('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, b, now());
    return id;
  });
}

/** Insert a message from `senderId` into `chatId` and push it to every member. */
export function postMessage(chatId, senderId, fields) {
  return broadcastNewMessage(chatId, insertMessage(chatId, senderId, fields));
}

export function pushMe(userId) {
  const u = q('SELECT * FROM users WHERE id = ?').get(userId);
  if (u) emitToUser(userId, 'me', meUser(u));
}

// ---------- rate limits ----------

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const sendLimiter = rateLimit({
  windowMs: 10_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id}`,
});
const uploadLimiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id}`,
});
const searchLimiter = rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id}`,
});

// ---------- auth ----------

api.get('/config', (req, res) => {
  res.json({ googleClientId: config.googleClientId, devLogin: config.devLogin, passwordLogin: true, version: config.version });
});

// ---------- username + password accounts ----------

const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const failedLogins = new Map(); // username -> { n, until }

function checkUsername(username) {
  if (!USERNAME_RE.test(username)) return 'bad_username';
  if (RESERVED.has(username.toLowerCase())) return 'username_taken';
  if (usernameOwner(username)) return 'username_taken';
  return null;
}
const passwordError = (pw) => (typeof pw !== 'string' || pw.length < 8 ? 'weak_password' : pw.length > 128 ? 'bad_password' : null);

api.post('/auth/register', registerLimiter, async (req, res) => {
  const username = String(req.body?.username || '').replace(/^@/, '');
  const name = clean(req.body?.name, 64);
  const password = req.body?.password;
  const err = checkUsername(username) || (!name && 'bad_name') || passwordError(password);
  if (err) return bad(res, err);
  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = createLocalUser({ username, name, passwordHash });
  } catch {
    return bad(res, 'username_taken');
  }
  createSession(res, req, user.id);
  audit(user.id, req.ip, 'register');
  res.json({ user: meUser(user) });
});

api.post('/auth/login', authLimiter, async (req, res) => {
  const username = String(req.body?.username || '').replace(/^@/, '').slice(0, 32);
  const password = String(req.body?.password || '').slice(0, 128);
  const key = username.toLowerCase();
  const f = failedLogins.get(key);
  if (f && f.until > now()) return bad(res, 'too_many_attempts', 429);
  const user = username ? q('SELECT * FROM users WHERE username = ?').get(username) : null;
  const ok = await verifyPassword(password, user?.password_hash);
  if (!ok || !user) {
    const n = (f?.until > now() ? 0 : f?.n || 0) + 1;
    failedLogins.set(key, { n, until: n >= 8 ? now() + 15 * 60_000 : 0 });
    audit(user?.id, req.ip, 'login_failed', `password @${username}`);
    return bad(res, 'bad_login', 401);
  }
  failedLogins.delete(key);
  if (user.banned) return bad(res, 'banned', 403);
  createSession(res, req, user.id);
  audit(user.id, req.ip, 'login', 'password');
  res.json({ user: meUser(user) });
});

api.post('/auth/google', authLimiter, async (req, res) => {
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || credential.length > 4096) return bad(res, 'bad_credential');
  let identity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch {
    audit(null, req.ip, 'login_failed', 'google token rejected');
    return bad(res, 'bad_credential', 401);
  }
  const user = upsertUser(identity);
  if (user.banned) {
    audit(user.id, req.ip, 'login_banned');
    return bad(res, 'banned', 403);
  }
  createSession(res, req, user.id);
  audit(user.id, req.ip, 'login');
  res.json({ user: meUser(user) });
});

if (config.devLogin) {
  // Local development only: sign in with any name. Disabled when NODE_ENV=production.
  api.post('/auth/dev', authLimiter, (req, res) => {
    const name = clean(req.body?.name, 32).toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!name) return bad(res, 'bad_name');
    const user = upsertUser({ sub: `dev:${name}`, email: `${name}@dev.local`, name, picture: null });
    if (user.banned) return bad(res, 'banned', 403);
    createSession(res, req, user.id);
    res.json({ user: meUser(user) });
  });
}

api.post('/auth/logout', requireAuth, (req, res) => {
  disconnectSession(req.session.id);
  destroySession(res, req.session.id);
  res.json({ ok: true });
});

// ---------- profile ----------

api.get('/me', requireAuth, (req, res) => res.json({ user: meUser(req.user) }));

const checkLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
// Works signed-out too (registration form).
api.get('/username-check', checkLimiter, (req, res) => {
  const me = sessionFromCookie(req.headers.cookie)?.user;
  const u = String(req.query.u || '');
  if (!USERNAME_RE.test(u)) return res.json({ ok: false, reason: 'format' });
  if (RESERVED.has(u.toLowerCase())) return res.json({ ok: false, reason: 'taken' });
  const owner = usernameOwner(u);
  const exceptChat = Number(req.query.chat) || 0;
  const taken = owner && !(owner.kind === 'user' && owner.id === me?.id) && !(owner.kind === 'chat' && owner.id === exceptChat);
  res.json({ ok: !taken, reason: taken ? 'taken' : null });
});

api.patch('/me', requireAuth, (req, res) => {
  const b = req.body || {};
  const name = b.name !== undefined ? clean(b.name, 64) : req.user.name;
  const bio = b.bio !== undefined ? clean(b.bio, 160) : req.user.bio;
  let username = req.user.username;
  if (b.username !== undefined) {
    username = String(b.username).replace(/^@/, '');
    if (!USERNAME_RE.test(username)) return bad(res, 'bad_username');
    if (RESERVED.has(username.toLowerCase())) return bad(res, 'username_taken');
    const owner = usernameOwner(username);
    if (owner && !(owner.kind === 'user' && owner.id === req.user.id)) return bad(res, 'username_taken');
  }
  if (!name) return bad(res, 'bad_name');
  if (!username) return bad(res, 'bad_username');
  try {
    q('UPDATE users SET name = ?, bio = ?, username = ? WHERE id = ?').run(name, bio, username, req.user.id);
  } catch {
    return bad(res, 'username_taken');
  }
  const user = q('SELECT * FROM users WHERE id = ?').get(req.user.id);
  broadcastProfile(user);
  res.json({ user: meUser(user) });
});

api.post('/me/password', requireAuth, authLimiter, async (req, res) => {
  const { current, password } = req.body || {};
  if (req.user.password_hash && !(await verifyPassword(String(current || ''), req.user.password_hash))) return bad(res, 'bad_current_password');
  const err = passwordError(password);
  if (err) return bad(res, err);
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), req.user.id);
  // Sign out every other device after a password change.
  const others = q('SELECT id FROM sessions WHERE user_id = ? AND id != ?').all(req.user.id, req.session.id);
  q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.session.id);
  others.forEach((s) => disconnectSession(s.id));
  audit(req.user.id, req.ip, 'password_set');
  res.json({ user: meUser(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

api.post('/me/bonus', requireAuth, (req, res) => {
  const r = q('UPDATE users SET coins = coins + ?, last_bonus = ? WHERE id = ? AND last_bonus <= ?')
    .run(DAILY_BONUS, now(), req.user.id, now() - 864e5);
  if (!r.changes) return bad(res, 'bonus_not_ready');
  res.json({ user: meUser(q('SELECT * FROM users WHERE id = ?').get(req.user.id)), bonus: DAILY_BONUS });
});

function broadcastProfile(user) {
  const ids = q(`SELECT DISTINCT m2.user_id AS id FROM chat_members m1 JOIN chat_members m2 ON m2.chat_id = m1.chat_id
                 WHERE m1.user_id = ?`).all(user.id).map((r) => r.id);
  emitToUsers(ids, 'user', publicUser(user));
}

api.post('/me/avatar', requireAuth, uploadLimiter, upload.single('file'), (req, res) => {
  const img = saveImage(req.file, { ownerId: req.user.id, kind: 'avatar', maxBytes: 5 * 1024 * 1024 });
  const old = req.user.avatar;
  q('UPDATE users SET avatar = ? WHERE id = ?').run(img.name, req.user.id);
  deleteMediaFile(old);
  const user = q('SELECT * FROM users WHERE id = ?').get(req.user.id);
  broadcastProfile(user);
  res.json({ user: meUser(user) });
});

api.delete('/me/avatar', requireAuth, (req, res) => {
  deleteMediaFile(req.user.avatar);
  q('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  const user = q('SELECT * FROM users WHERE id = ?').get(req.user.id);
  broadcastProfile(user);
  res.json({ user: meUser(user) });
});

api.get('/sessions', requireAuth, (req, res) => {
  const rows = q('SELECT id, created_at, last_used, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_used DESC').all(req.user.id);
  res.json({
    sessions: rows.map((s) => ({
      id: s.id, createdAt: s.created_at, lastUsed: s.last_used, userAgent: s.user_agent, ip: s.ip, current: s.id === req.session.id,
    })),
  });
});

api.delete('/sessions/:id', requireAuth, (req, res) => {
  const id = int(req.params.id);
  if (!id || id === req.session.id) return bad(res, 'bad_session');
  q('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, req.user.id);
  disconnectSession(id);
  res.json({ ok: true });
});

api.delete('/sessions', requireAuth, (req, res) => {
  const others = q('SELECT id FROM sessions WHERE user_id = ? AND id != ?').all(req.user.id, req.session.id);
  q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.session.id);
  others.forEach((s) => disconnectSession(s.id));
  res.json({ ok: true });
});

// Everything below needs a completed profile (username chosen).
api.use(requireAuth, requireProfile);

// ---------- users ----------

api.get('/users/search', searchLimiter, (req, res) => {
  const raw = clean(req.query.q, 64).replace(/^@/, '');
  if (raw.length < 2) return res.json({ users: [] });
  const like = raw.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = q(`SELECT * FROM users
                  WHERE banned = 0 AND username IS NOT NULL AND id != ?
                    AND (username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')
                  ORDER BY (username = ?) DESC, (username LIKE ? ESCAPE '\\') DESC, username
                  LIMIT 20`).all(req.user.id, `${like}%`, `%${like}%`, raw, `${like}%`);
  res.json({ users: rows.map(publicUser) });
});

api.get('/users/:id', (req, res) => {
  const id = int(req.params.id);
  const u = id && q('SELECT * FROM users WHERE id = ? AND username IS NOT NULL').get(id);
  if (!u || u.banned) return bad(res, 'not_found', 404);
  res.json({ user: publicUser(u) });
});

// ---------- chats ----------

api.get('/chats', (req, res) => {
  const ids = q(`SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?
                 ORDER BY c.last_msg_id DESC, c.id DESC`).all(req.user.id);
  res.json({ chats: ids.map((r) => chatForUser(r.id, req.user.id)) });
});

api.get('/chats/:id', (req, res) => {
  const c = int(req.params.id) && chatForUser(int(req.params.id), req.user.id);
  if (!c) return bad(res, 'not_found', 404);
  const members = c.type === 'group'
    ? q(`SELECT u.*, cm.role FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?
         ORDER BY cm.role = 'owner' DESC, u.name`).all(c.id).map((u) => ({ ...publicUser(u), role: u.role }))
    : undefined;
  res.json({ chat: c, members });
});

api.post('/chats/private', (req, res) => {
  const peerId = int(req.body?.userId);
  const me = req.user.id;
  if (!peerId) return bad(res, 'bad_user');
  if (peerId === me) {
    // "Saved messages" — chat with yourself.
    const key = `saved:${me}`;
    let c = q('SELECT id FROM chats WHERE pair_key = ?').get(key);
    if (!c) {
      c = tx(() => {
        const r = q("INSERT INTO chats (type, pair_key, created_at) VALUES ('saved', ?, ?)").run(key, now());
        q("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(r.lastInsertRowid, me, now());
        return { id: Number(r.lastInsertRowid) };
      });
    }
    return res.json({ chat: chatForUser(c.id, me) });
  }
  const peer = q('SELECT * FROM users WHERE id = ? AND banned = 0 AND username IS NOT NULL').get(peerId);
  if (!peer) return bad(res, 'not_found', 404);
  const key = `${Math.min(me, peerId)}:${Math.max(me, peerId)}`;
  let c = q('SELECT id FROM chats WHERE pair_key = ?').get(key);
  if (!c) {
    c = tx(() => {
      const r = q("INSERT INTO chats (type, pair_key, created_at) VALUES ('private', ?, ?)").run(key, now());
      const id = Number(r.lastInsertRowid);
      q('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)').run(id, me, now(), id, peerId, now());
      return { id };
    });
  }
  res.json({ chat: chatForUser(c.id, me) });
});

api.post('/chats/group', (req, res) => {
  const title = clean(req.body?.title, 64);
  if (!title) return bad(res, 'bad_title');
  const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(int).filter(Boolean))]
    .filter((id) => id !== req.user.id).slice(0, 199);
  const valid = ids.filter((id) => q('SELECT 1 FROM users WHERE id = ? AND banned = 0 AND username IS NOT NULL').get(id));
  const chatId = tx(() => {
    const r = q("INSERT INTO chats (type, title, owner_id, created_at) VALUES ('group', ?, ?, ?)").run(title, req.user.id, now());
    const id = Number(r.lastInsertRowid);
    q("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, req.user.id, now());
    for (const uid of valid) q('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, uid, now());
    return id;
  });
  systemMessage(chatId, `${req.user.name} создаёт группу «${title}»`);
  res.json({ chat: chatForUser(chatId, req.user.id) });
});

function canPost(chatId, userId) {
  const r = q('SELECT c.type, cm.role FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ? WHERE c.id = ?').get(userId, chatId);
  return !!r && (r.type !== 'channel' || r.role === 'owner' || r.role === 'admin');
}

function groupAsAdmin(req, res, types = ['group']) {
  const id = int(req.params.id);
  const c = id && q("SELECT c.*, cm.role FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ? WHERE c.id = ?")
    .get(req.user.id, id);
  if (c && !types.includes(c.type)) { bad(res, 'not_found', 404); return null; }
  if (!c) { bad(res, 'not_found', 404); return null; }
  if (c.role !== 'owner') { bad(res, 'forbidden', 403); return null; }
  return c;
}

api.patch('/chats/:id', (req, res) => {
  const c = groupAsAdmin(req, res);
  if (!c) return;
  const title = clean(req.body?.title, 64);
  if (!title) return bad(res, 'bad_title');
  q('UPDATE chats SET title = ? WHERE id = ?').run(title, c.id);
  systemMessage(c.id, `${req.user.name} меняет название на «${title}»`);
  res.json({ chat: chatForUser(c.id, req.user.id) });
});

api.post('/chats/:id/avatar', uploadLimiter, upload.single('file'), (req, res) => {
  const c = groupAsAdmin(req, res, ['group', 'channel']);
  if (!c) return;
  const img = saveImage(req.file, { ownerId: req.user.id, kind: 'avatar', maxBytes: 5 * 1024 * 1024 });
  q('UPDATE chats SET avatar = ? WHERE id = ?').run(img.name, c.id);
  deleteMediaFile(c.avatar);
  pushChat(c.id);
  res.json({ chat: chatForUser(c.id, req.user.id) });
});

api.post('/chats/:id/members', (req, res) => {
  const c = groupAsAdmin(req, res);
  if (!c) return;
  const count = q('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?').get(c.id).n;
  const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(int).filter(Boolean))].slice(0, 200 - count);
  const added = [];
  for (const uid of ids) {
    const u = q('SELECT * FROM users WHERE id = ? AND banned = 0 AND username IS NOT NULL').get(uid);
    if (!u || isMember(c.id, uid)) continue;
    q('INSERT INTO chat_members (chat_id, user_id, joined_at, last_read_id) VALUES (?, ?, ?, ?)').run(c.id, uid, now(), c.last_msg_id);
    added.push(u);
  }
  if (added.length) systemMessage(c.id, `${req.user.name} добавляет: ${added.map((u) => u.name).join(', ')}`);
  res.json({ chat: chatForUser(c.id, req.user.id) });
});

api.delete('/chats/:id/members/:userId', (req, res) => {
  const c = groupAsAdmin(req, res);
  if (!c) return;
  const uid = int(req.params.userId);
  const u = uid && uid !== req.user.id && q('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u || !isMember(c.id, uid)) return bad(res, 'not_found', 404);
  q('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(c.id, uid);
  emitToUser(uid, 'chat:removed', { chatId: c.id });
  systemMessage(c.id, `${req.user.name} удаляет ${u.name}`);
  res.json({ ok: true });
});

api.post('/chats/:id/leave', (req, res) => {
  const id = int(req.params.id);
  const c = id && q("SELECT c.*, cm.role FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ? WHERE c.id = ? AND c.type = 'group'")
    .get(req.user.id, id);
  if (!c) return bad(res, 'not_found', 404);
  q('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(id, req.user.id);
  emitToUser(req.user.id, 'chat:removed', { chatId: id });
  const rest = q('SELECT user_id FROM chat_members WHERE chat_id = ? ORDER BY joined_at LIMIT 1').get(id);
  if (!rest) {
    deleteMediaFile(c.avatar);
    for (const m of q('SELECT name FROM media WHERE chat_id = ?').all(id)) deleteMediaFile(m.name);
    q('DELETE FROM chats WHERE id = ?').run(id);
  } else {
    if (c.role === 'owner') {
      q("UPDATE chat_members SET role = 'owner' WHERE chat_id = ? AND user_id = ?").run(id, rest.user_id);
      q('UPDATE chats SET owner_id = ? WHERE id = ?').run(rest.user_id, id);
    }
    systemMessage(id, `${req.user.name} покидает группу`);
  }
  res.json({ ok: true });
});

// ---------- messages ----------

api.get('/chats/:id/messages', (req, res) => {
  const id = int(req.params.id);
  if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  const before = int(req.query.before);
  const after = int(req.query.after);
  let rows;
  if (after) {
    rows = q('SELECT * FROM messages WHERE chat_id = ? AND id > ? ORDER BY id ASC LIMIT 200').all(id, after);
  } else if (before) {
    rows = q('SELECT * FROM messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(id, before, PAGE).reverse();
  } else {
    rows = q('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(id, PAGE).reverse();
  }
  res.json({ messages: rows.map((m) => serializeMessage(m, req.user.id)), hasMore: !after && rows.length === PAGE });
});

function validReply(chatId, replyTo) {
  const id = int(replyTo);
  return id && q('SELECT 1 FROM messages WHERE id = ? AND chat_id = ?').get(id, chatId) ? id : null;
}

api.post('/chats/:id/messages', sendLimiter, (req, res) => {
  const id = int(req.params.id);
  if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  if (!canPost(id, req.user.id)) return bad(res, 'forbidden', 403);
  const text = clean(req.body?.text, MAX_TEXT + 1);
  if (!text) return bad(res, 'empty');
  if (text.length > MAX_TEXT) return bad(res, 'too_long');
  const msg = insertMessage(id, req.user.id, { text, replyTo: validReply(id, req.body?.replyTo) });
  res.json({ message: broadcastNewMessage(id, msg) });
});

api.post('/chats/:id/images', uploadLimiter, upload.single('file'), (req, res) => {
  const id = int(req.params.id);
  if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  if (!canPost(id, req.user.id)) return bad(res, 'forbidden', 403);
  const img = saveImage(req.file, { ownerId: req.user.id, kind: 'message', chatId: id });
  const msg = insertMessage(id, req.user.id, {
    kind: 'image', text: clean(req.body?.text, MAX_TEXT), file: img.name, width: img.w, height: img.h,
    replyTo: validReply(id, req.body?.replyTo),
  });
  res.json({ message: broadcastNewMessage(id, msg) });
});

api.post('/chats/:id/stickers', sendLimiter, (req, res) => {
  const id = int(req.params.id);
  if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  if (!canPost(id, req.user.id)) return bad(res, 'forbidden', 403);
  const sticker = String(req.body?.sticker || '');
  if (!isValidSticker(sticker)) return bad(res, 'bad_sticker');
  res.json({ message: postMessage(id, req.user.id, { kind: 'sticker', text: sticker, replyTo: validReply(id, req.body?.replyTo) }) });
});

// ---------- gifts ----------

api.post('/chats/:id/gift', sendLimiter, (req, res) => {
  const id = int(req.params.id);
  const chat = id && q("SELECT * FROM chats WHERE id = ? AND type = 'private'").get(id);
  if (!chat || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  const gift = giftById(req.body?.giftId);
  if (!gift) return bad(res, 'bad_gift');
  const toId = q('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ?').get(id, req.user.id)?.user_id;
  if (!toId) return bad(res, 'not_found', 404);
  const note = clean(req.body?.note, 140);
  const ok = tx(() => {
    const r = q('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(gift.price, req.user.id, gift.price);
    if (!r.changes) return false;
    q('INSERT INTO user_gifts (gift_id, from_id, to_id, note, price, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(gift.id, req.user.id, toId, note, gift.price, now());
    return true;
  });
  if (!ok) return bad(res, 'not_enough_coins');
  const message = postMessage(id, req.user.id, { kind: 'gift', text: note, extra: { giftId: gift.id, toId, price: gift.price } });
  pushMe(req.user.id);
  audit(req.user.id, req.ip, 'gift', { giftId: gift.id, toId });
  res.json({ message, user: meUser(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

api.get('/users/:id/gifts', (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, 'not_found', 404);
  const rows = q(`SELECT g.*, u.name AS from_name FROM user_gifts g LEFT JOIN users u ON u.id = g.from_id
                  WHERE g.to_id = ? ORDER BY g.id DESC LIMIT 200`).all(id);
  res.json({ gifts: rows.map((g) => ({ id: g.id, giftId: g.gift_id, fromId: g.from_id, fromName: g.from_name, note: g.note, price: g.price, createdAt: g.created_at })) });
});

api.patch('/messages/:id', sendLimiter, (req, res) => {
  const id = int(req.params.id);
  const m = id && q('SELECT * FROM messages WHERE id = ?').get(id);
  if (!m || m.sender_id !== req.user.id || !['text', 'image'].includes(m.kind)) return bad(res, 'not_found', 404);
  const text = clean(req.body?.text, MAX_TEXT + 1);
  if (text.length > MAX_TEXT) return bad(res, 'too_long');
  if (!text && m.kind === 'text') return bad(res, 'empty');
  q('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?').run(text, now(), id);
  const payload = serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id));
  emitToChat(m.chat_id, 'message:edit', payload);
  res.json({ message: payload });
});

api.delete('/messages/:id', (req, res) => {
  const id = int(req.params.id);
  const m = id && q('SELECT * FROM messages WHERE id = ?').get(id);
  if (!m || !isMember(m.chat_id, req.user.id)) return bad(res, 'not_found', 404);
  const chat = q('SELECT * FROM chats WHERE id = ?').get(m.chat_id);
  const canDelete = m.sender_id === req.user.id || ((chat.type === 'group' || chat.type === 'channel') && chat.owner_id === req.user.id);
  if (!canDelete) return bad(res, 'forbidden', 403);
  q('DELETE FROM messages WHERE id = ?').run(id);
  if (m.file) deleteMediaFile(m.file);
  if (chat.last_msg_id === id) {
    const prev = q('SELECT MAX(id) AS id FROM messages WHERE chat_id = ?').get(m.chat_id);
    q('UPDATE chats SET last_msg_id = ? WHERE id = ?').run(prev.id || 0, m.chat_id);
  }
  for (const uid of memberIds(m.chat_id)) {
    emitToUser(uid, 'message:delete', { chatId: m.chat_id, messageId: id, chat: chatForUser(m.chat_id, uid) });
  }
  res.json({ ok: true });
});

api.post('/chats/:id/read', (req, res) => {
  const id = int(req.params.id);
  const upTo = int(req.body?.messageId);
  if (!id || !upTo || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  const max = q('SELECT MAX(id) AS id FROM messages WHERE chat_id = ?').get(id).id || 0;
  const target = Math.min(upTo, max);
  const r = q('UPDATE chat_members SET last_read_id = ? WHERE chat_id = ? AND user_id = ? AND last_read_id < ?')
    .run(target, id, req.user.id, target);
  if (r.changes) {
    const type = q('SELECT type FROM chats WHERE id = ?').get(id).type;
    emitToUser(req.user.id, 'chat', chatForUser(id, req.user.id));
    if (type !== 'channel') {
      emitToChat(id, 'read', { chatId: id, userId: req.user.id, messageId: target }, req.user.id);
    }
  }
  res.json({ ok: true });
});

// ---------- reactions & mute ----------

export const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🍋', '🤯', '👎'];

api.post('/messages/:id/react', sendLimiter, (req, res) => {
  const id = int(req.params.id);
  const m = id && q('SELECT * FROM messages WHERE id = ?').get(id);
  if (!m || m.kind === 'system' || !isMember(m.chat_id, req.user.id)) return bad(res, 'not_found', 404);
  const emoji = req.body?.emoji ?? null;
  if (emoji !== null && !REACTIONS.includes(emoji)) return bad(res, 'bad_reaction');
  if (emoji) {
    q(`INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`).run(id, req.user.id, emoji, now());
  } else {
    q('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(id, req.user.id);
  }
  const payload = { chatId: m.chat_id, messageId: id, reactions: reactionSummary(id), userId: req.user.id, emoji };
  emitToChat(m.chat_id, 'message:reactions', payload);
  res.json(payload);
});

api.post('/chats/:id/mute', (req, res) => {
  const id = int(req.params.id);
  if (!id || !isMember(id, req.user.id)) return bad(res, 'not_found', 404);
  q('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?').run(req.body?.muted ? 1 : 0, id, req.user.id);
  const chat = chatForUser(id, req.user.id);
  emitToUser(req.user.id, 'chat', chat);
  res.json({ chat });
});

// ---------- search & resolve ----------

api.get('/search', searchLimiter, (req, res) => {
  const raw = clean(req.query.q, 64).replace(/^@/, '');
  if (raw.length < 2) return res.json({ users: [], channels: [] });
  const like = raw.replace(/[\\%_]/g, (c) => `\\${c}`);
  const users = q(`SELECT * FROM users
                   WHERE banned = 0 AND username IS NOT NULL AND id != ?
                     AND (username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')
                   ORDER BY (username = ?) DESC, verified DESC, (username LIKE ? ESCAPE '\\') DESC, username
                   LIMIT 15`).all(req.user.id, `${like}%`, `%${like}%`, raw, `${like}%`);
  const channels = q(`SELECT c.*, (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) AS subs FROM chats c
                      WHERE c.type = 'channel' AND c.username IS NOT NULL
                        AND (c.username LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')
                      ORDER BY (c.username = ?) DESC, c.verified DESC, subs DESC LIMIT 15`).all(`${like}%`, `%${like}%`, raw);
  res.json({ users: users.map(publicUser), channels: channels.map(channelPublic) });
});

api.get('/resolve/:username', (req, res) => {
  const name = String(req.params.username).replace(/^@/, '');
  if (!USERNAME_RE.test(name)) return bad(res, 'not_found', 404);
  const u = q('SELECT * FROM users WHERE username = ? AND banned = 0').get(name);
  if (u) return res.json({ type: 'user', user: publicUser(u) });
  const c = q("SELECT * FROM chats WHERE username = ? AND type = 'channel'").get(name);
  if (c) return res.json({ type: 'channel', channel: channelPublic(c), chat: chatForUser(c.id, req.user.id) });
  bad(res, 'not_found', 404);
});

// ---------- channels ----------

const channelLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id}`,
});

function publicChannel(id) {
  return id ? q("SELECT * FROM chats WHERE id = ? AND type = 'channel' AND username IS NOT NULL").get(id) : null;
}

api.get('/channels/popular', (req, res) => {
  const rows = q(`SELECT c.*, (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) AS subs FROM chats c
                  WHERE c.type = 'channel' AND c.username IS NOT NULL
                  ORDER BY c.verified DESC, subs DESC, c.last_msg_id DESC LIMIT 20`).all();
  res.json({ channels: rows.map(channelPublic) });
});

api.post('/channels', channelLimiter, (req, res) => {
  const title = clean(req.body?.title, 64);
  const description = clean(req.body?.description, 255);
  const username = String(req.body?.username || '').replace(/^@/, '');
  if (!title) return bad(res, 'bad_title');
  const err = checkUsername(username);
  if (err) return bad(res, err);
  const id = tx(() => {
    const r = q("INSERT INTO chats (type, title, description, username, owner_id, created_at) VALUES ('channel', ?, ?, ?, ?, ?)")
      .run(title, description, username, req.user.id, now());
    const cid = Number(r.lastInsertRowid);
    q("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(cid, req.user.id, now());
    return cid;
  });
  systemMessage(id, `Канал «${title}» создан`);
  audit(req.user.id, req.ip, 'channel_create', { chatId: id, username });
  res.json({ chat: chatForUser(id, req.user.id) });
});

api.get('/channels/:id', (req, res) => {
  const c = publicChannel(int(req.params.id));
  if (!c) return bad(res, 'not_found', 404);
  res.json({ channel: channelPublic(c), chat: chatForUser(c.id, req.user.id) });
});

// Read-only preview for people who haven't subscribed yet.
api.get('/channels/:id/messages', (req, res) => {
  const c = publicChannel(int(req.params.id));
  if (!c) return bad(res, 'not_found', 404);
  const before = int(req.query.before);
  const rows = (before
    ? q('SELECT * FROM messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(c.id, before, PAGE)
    : q('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(c.id, PAGE)).reverse();
  res.json({ messages: rows.map((m) => serializeMessage(m, req.user.id)), hasMore: rows.length === PAGE });
});

// Unique views: every person who actually saw a post counts once (subscribers and preview readers).
api.post('/channels/:id/views', (req, res) => {
  const c = publicChannel(int(req.params.id)) || (isMember(int(req.params.id), req.user.id) && q("SELECT * FROM chats WHERE id = ? AND type = 'channel'").get(int(req.params.id)));
  if (!c) return bad(res, 'not_found', 404);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(int).filter(Boolean).slice(0, 100);
  const ins = q('INSERT OR IGNORE INTO post_views (message_id, user_id) SELECT id, ? FROM messages WHERE id = ? AND chat_id = ? AND kind != \'system\'');
  const inc = q('UPDATE messages SET views = views + 1 WHERE id = ?');
  tx(() => { for (const mid of ids) if (ins.run(req.user.id, mid, c.id).changes) inc.run(mid); });
  res.json({ ok: true });
});

api.post('/channels/:id/join', channelLimiter, (req, res) => {
  const c = publicChannel(int(req.params.id));
  if (!c) return bad(res, 'not_found', 404);
  q('INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at, last_read_id) VALUES (?, ?, ?, ?)').run(c.id, req.user.id, now(), c.last_msg_id);
  res.json({ chat: chatForUser(c.id, req.user.id) });
});

api.post('/channels/:id/leave', (req, res) => {
  const id = int(req.params.id);
  const m = id && q("SELECT cm.role FROM chat_members cm JOIN chats c ON c.id = cm.chat_id WHERE cm.chat_id = ? AND cm.user_id = ? AND c.type = 'channel'").get(id, req.user.id);
  if (!m) return bad(res, 'not_found', 404);
  if (m.role === 'owner') return bad(res, 'owner_cannot_leave');
  q('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(id, req.user.id);
  emitToUser(req.user.id, 'chat:removed', { chatId: id });
  res.json({ ok: true });
});

api.patch('/channels/:id', (req, res) => {
  const c = groupAsAdmin(req, res, ['channel']);
  if (!c) return;
  const title = req.body?.title !== undefined ? clean(req.body.title, 64) : c.title;
  const description = req.body?.description !== undefined ? clean(req.body.description, 255) : c.description;
  let username = c.username;
  if (req.body?.username !== undefined) {
    username = String(req.body.username).replace(/^@/, '');
    if (username.toLowerCase() !== String(c.username).toLowerCase()) {
      const err = checkUsername(username);
      if (err) return bad(res, err);
    }
  }
  if (!title) return bad(res, 'bad_title');
  q('UPDATE chats SET title = ?, description = ?, username = ? WHERE id = ?').run(title, description, username, c.id);
  pushChat(c.id);
  res.json({ chat: chatForUser(c.id, req.user.id) });
});

api.post('/channels/:id/verify-request', (req, res) => {
  const c = groupAsAdmin(req, res, ['channel']);
  if (!c) return;
  if (c.verified) return bad(res, 'already_verified');
  q('UPDATE chats SET verify_requested = ? WHERE id = ?').run(now(), c.id);
  audit(req.user.id, req.ip, 'channel_verify_request', { chatId: c.id, username: c.username });
  res.json({ chat: chatForUser(c.id, req.user.id) });
});

export function deleteChat(chatId) {
  const c = q('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!c) return;
  const members = memberIds(chatId);
  deleteMediaFile(c.avatar);
  for (const m of q('SELECT name FROM media WHERE chat_id = ?').all(chatId)) deleteMediaFile(m.name);
  q('DELETE FROM chats WHERE id = ?').run(chatId);
  emitToUsers(members, 'chat:removed', { chatId });
}

api.delete('/channels/:id', (req, res) => {
  const c = groupAsAdmin(req, res, ['channel']);
  if (!c) return;
  deleteChat(c.id);
  audit(req.user.id, req.ip, 'channel_delete', { chatId: c.id, username: c.username });
  res.json({ ok: true });
});

api.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return bad(res, 'file_too_large', 413);
  if (err?.status === 400) return bad(res, err.message);
  next(err);
});
