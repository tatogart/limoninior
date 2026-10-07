import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { db, q, now, audit, kvGet, kvSet } from './db.js';
import { requireAuth, isAdminUser } from './auth.js';
import { verifyTotp } from './totp.js';
import { isOnline, disconnectUser } from './realtime.js';
import { ensurePrivateChat, postMessage, pushMe, pushChat, deleteChat, OFFICIAL_SUB } from './api.js';

/**
 * Admin panel API. Layers of protection:
 *  1. Signed in via Google with an email listed in ADMIN_EMAILS (Google-verified).
 *  2. Optional IP allow-list (ADMIN_IPS).
 *  3. A TOTP code (ADMIN_TOTP_SECRET) elevates only the current session for
 *     ADMIN_SESSION_MINUTES; codes can't be replayed; attempts are rate-limited.
 *  4. Everyone else gets a plain 404 — the panel doesn't reveal it exists.
 *  5. Every admin action is written to the audit log.
 * If ADMIN_TOTP_SECRET or ADMIN_EMAILS is missing the panel is fully disabled.
 */
export const admin = express.Router();

const enabled = () => config.adminEmails.length > 0 && config.adminTotpSecret.length >= 16;
const notFound = (res) => res.status(404).json({ error: 'not_found' });

function gate(req, res, next) {
  if (!enabled()) return notFound(res);
  if (config.adminIps.length && !config.adminIps.includes(String(req.ip).toLowerCase())) return notFound(res);
  if (!isAdminUser(req.user)) {
    audit(req.user.id, req.ip, 'admin_denied', req.path);
    return notFound(res);
  }
  res.set('Cache-Control', 'no-store');
  next();
}

function elevated(req, res, next) {
  if (req.session.admin_until < now()) return res.status(403).json({ error: 'totp_required' });
  next();
}

const totpLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: () => 'admin-totp', // global: brute force is capped no matter how many IPs
  handler: (req, res) => {
    audit(req.user?.id, req.ip, 'admin_totp_ratelimited');
    res.status(429).json({ error: 'too_many_attempts' });
  },
});

admin.use(requireAuth, gate);

admin.get('/status', (req, res) => {
  res.json({ elevated: req.session.admin_until > now(), until: req.session.admin_until });
});

admin.post('/unlock', totpLimiter, (req, res) => {
  const step = verifyTotp(config.adminTotpSecret, String(req.body?.code || ''));
  const lastStep = Number(kvGet('admin_totp_last_step') || 0);
  if (step < 0 || step <= lastStep) {
    audit(req.user.id, req.ip, 'admin_unlock_failed');
    return res.status(401).json({ error: 'bad_code' });
  }
  kvSet('admin_totp_last_step', step);
  const until = now() + config.adminSessionMinutes * 60_000;
  q('UPDATE sessions SET admin_until = ? WHERE id = ?').run(until, req.session.id);
  audit(req.user.id, req.ip, 'admin_unlock');
  res.json({ elevated: true, until });
});

admin.post('/lock', (req, res) => {
  q('UPDATE sessions SET admin_until = 0 WHERE id = ?').run(req.session.id);
  res.json({ elevated: false });
});

admin.use(elevated);

admin.get('/stats', (req, res) => {
  const day = now() - 864e5;
  const one = (sql, ...a) => q(sql).get(...a).n;
  res.json({
    users: one('SELECT COUNT(*) AS n FROM users'),
    usersToday: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', day),
    activeToday: one('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', day),
    banned: one('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
    chats: one('SELECT COUNT(*) AS n FROM chats'),
    groups: one("SELECT COUNT(*) AS n FROM chats WHERE type = 'group'"),
    channels: one("SELECT COUNT(*) AS n FROM chats WHERE type = 'channel'"),
    verifyRequests: one("SELECT COUNT(*) AS n FROM chats WHERE type = 'channel' AND verify_requested > 0 AND verified = 0"),
    messages: one('SELECT COUNT(*) AS n FROM messages'),
    messagesToday: one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', day),
    mediaBytes: q('SELECT COALESCE(SUM(size), 0) AS n FROM media').get().n,
    sessions: one('SELECT COUNT(*) AS n FROM sessions'),
    perDay: q(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n
               FROM messages WHERE created_at > ? GROUP BY d ORDER BY d`).all(now() - 14 * 864e5),
  });
});

admin.get('/users', (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 64);
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = q(`SELECT u.*, (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) AS msg_count
                  FROM users u
                  WHERE ? = '' OR u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'
                  ORDER BY u.id DESC LIMIT 100`).all(search, like, like, like);
  res.json({
    users: rows.map((u) => ({
      id: u.id, username: u.username, name: u.name, email: u.email, banned: !!u.banned,
      createdAt: u.created_at, lastSeen: u.last_seen, online: isOnline(u.id), messages: u.msg_count,
      avatar: u.avatar ? `/media/${u.avatar}` : null, isAdmin: isAdminUser(u),
      verified: !!u.verified, coins: u.coins, hasGoogle: !String(u.google_sub).startsWith('local:'),
      official: u.google_sub === OFFICIAL_SUB,
    })),
  });
});

function targetUser(req, res) {
  const id = Number(req.params.id);
  const u = Number.isSafeInteger(id) && q('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) { res.status(404).json({ error: 'not_found' }); return null; }
  if (isAdminUser(u)) { res.status(400).json({ error: 'cannot_target_admin' }); return null; }
  return u;
}

admin.post('/users/:id/ban', (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  q('UPDATE users SET banned = 1 WHERE id = ?').run(u.id);
  q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  disconnectUser(u.id);
  audit(req.user.id, req.ip, 'admin_ban', { userId: u.id, username: u.username });
  res.json({ ok: true });
});

admin.post('/users/:id/unban', (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  q('UPDATE users SET banned = 0 WHERE id = ?').run(u.id);
  audit(req.user.id, req.ip, 'admin_unban', { userId: u.id, username: u.username });
  res.json({ ok: true });
});

admin.post('/users/:id/logout', (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  disconnectUser(u.id);
  audit(req.user.id, req.ip, 'admin_logout_user', { userId: u.id, username: u.username });
  res.json({ ok: true });
});

admin.post('/users/:id/reset-username', (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  q('UPDATE users SET username = NULL WHERE id = ?').run(u.id);
  disconnectUser(u.id);
  audit(req.user.id, req.ip, 'admin_reset_username', { userId: u.id, username: u.username });
  res.json({ ok: true });
});

function anyUser(req, res) {
  const id = Number(req.params.id);
  const u = Number.isSafeInteger(id) && q('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) res.status(404).json({ error: 'not_found' });
  return u || null;
}

admin.post('/users/:id/verify', (req, res) => {
  const u = anyUser(req, res);
  if (!u) return;
  const v = req.body?.verified ? 1 : 0;
  q('UPDATE users SET verified = ? WHERE id = ?').run(v, u.id);
  audit(req.user.id, req.ip, v ? 'admin_verify' : 'admin_unverify', { userId: u.id, username: u.username });
  pushMe(u.id);
  res.json({ ok: true });
});

admin.post('/users/:id/coins', (req, res) => {
  const u = anyUser(req, res);
  if (!u) return;
  const amount = Math.trunc(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) return res.status(400).json({ error: 'bad_amount' });
  q('UPDATE users SET coins = MAX(0, coins + ?) WHERE id = ?').run(amount, u.id);
  audit(req.user.id, req.ip, 'admin_coins', { userId: u.id, username: u.username, amount });
  pushMe(u.id);
  res.json({ ok: true });
});

/** The official "Limoninior" account used for announcements. */
function officialUser() {
  let u = q('SELECT * FROM users WHERE google_sub = ?').get(OFFICIAL_SUB);
  if (!u) {
    const t = now();
    const taken = q("SELECT 1 FROM users WHERE username = 'limoninior'").get();
    q(`INSERT INTO users (google_sub, email, username, name, bio, verified, created_at, last_seen)
       VALUES (?, '', ?, 'Limoninior', 'Официальный аккаунт мессенджера', 1, ?, ?)`)
      .run(OFFICIAL_SUB, taken ? null : 'limoninior', t, t);
    u = q('SELECT * FROM users WHERE google_sub = ?').get(OFFICIAL_SUB);
  }
  return u;
}

admin.post('/broadcast', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 4096);
  if (!text) return res.status(400).json({ error: 'empty' });
  const off = officialUser();
  const users = q("SELECT id FROM users WHERE banned = 0 AND username IS NOT NULL AND id != ?").all(off.id);
  for (const u of users) postMessage(ensurePrivateChat(off.id, u.id), off.id, { kind: 'text', text });
  audit(req.user.id, req.ip, 'admin_broadcast', { recipients: users.length, text: text.slice(0, 120) });
  res.json({ ok: true, recipients: users.length });
});

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

admin.get('/server', (req, res) => {
  let disk = null;
  try {
    const st = fs.statfsSync(config.dataDir);
    disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
  } catch { /* unsupported */ }
  res.json({
    version: config.version,
    node: process.version,
    uptime: Math.round(process.uptime()),
    load: os.loadavg()[0],
    memory: { total: os.totalmem(), free: os.freemem(), rss: process.memoryUsage().rss },
    disk,
    update: readJson(`${config.dataDir}/update-status.json`),
    updateRequested: fs.existsSync(config.updateFlag),
  });
});

admin.post('/update', (req, res) => {
  fs.writeFileSync(config.updateFlag, String(now()));
  audit(req.user.id, req.ip, 'admin_update_request');
  res.json({ ok: true });
});

admin.get('/channels', (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 64);
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = q(`SELECT c.*, u.username AS owner_username, u.name AS owner_name,
                    (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) AS subs,
                    (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND kind != 'system') AS posts
                  FROM chats c LEFT JOIN users u ON u.id = c.owner_id
                  WHERE c.type = 'channel' AND (? = '' OR c.username LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')
                  ORDER BY (c.verify_requested > 0 AND c.verified = 0) DESC, c.verify_requested DESC, subs DESC LIMIT 100`).all(search, like, like);
  res.json({
    channels: rows.map((c) => ({
      id: c.id, title: c.title, username: c.username, description: c.description, verified: !!c.verified,
      verifyRequested: c.verify_requested && !c.verified ? c.verify_requested : 0, subscribers: c.subs, posts: c.posts,
      owner: c.owner_username ? `@${c.owner_username}` : c.owner_name || '—', createdAt: c.created_at,
      avatar: c.avatar ? `/media/${c.avatar}` : null,
    })),
  });
});

function anyChannel(req, res) {
  const id = Number(req.params.id);
  const c = Number.isSafeInteger(id) && q("SELECT * FROM chats WHERE id = ? AND type = 'channel'").get(id);
  if (!c) res.status(404).json({ error: 'not_found' });
  return c || null;
}

admin.post('/channels/:id/verify', (req, res) => {
  const c = anyChannel(req, res);
  if (!c) return;
  const v = req.body?.verified ? 1 : 0;
  q('UPDATE chats SET verified = ?, verify_requested = 0 WHERE id = ?').run(v, c.id);
  audit(req.user.id, req.ip, v ? 'admin_channel_verify' : 'admin_channel_unverify', { chatId: c.id, username: c.username });
  pushChat(c.id);
  if (v && c.owner_id) notifyOwner(c.owner_id, `✅ Ваш канал «${c.title}» прошёл верификацию и получил галочку!`);
  res.json({ ok: true });
});

admin.post('/channels/:id/reject', (req, res) => {
  const c = anyChannel(req, res);
  if (!c) return;
  q('UPDATE chats SET verify_requested = 0 WHERE id = ?').run(c.id);
  audit(req.user.id, req.ip, 'admin_channel_reject', { chatId: c.id, username: c.username });
  pushChat(c.id);
  if (c.owner_id) notifyOwner(c.owner_id, `Заявка на верификацию канала «${c.title}» отклонена. Вы можете подать её позже.`);
  res.json({ ok: true });
});

admin.delete('/channels/:id', (req, res) => {
  const c = anyChannel(req, res);
  if (!c) return;
  deleteChat(c.id);
  audit(req.user.id, req.ip, 'admin_channel_delete', { chatId: c.id, username: c.username });
  res.json({ ok: true });
});

/** Personal note from the official account. */
function notifyOwner(userId, text) {
  const off = officialUser();
  postMessage(ensurePrivateChat(off.id, userId), off.id, { kind: 'text', text });
}

admin.get('/audit', (req, res) => {
  const rows = q(`SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                  ORDER BY a.id DESC LIMIT 200`).all();
  res.json({ entries: rows.map((r) => ({ id: r.id, at: r.at, username: r.username, ip: r.ip, action: r.action, details: r.details })) });
});

admin.post('/vacuum', (req, res) => {
  q('DELETE FROM sessions WHERE expires_at < ?').run(now());
  q('DELETE FROM audit_log WHERE at < ?').run(now() - 180 * 864e5);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  audit(req.user.id, req.ip, 'admin_vacuum');
  res.json({ ok: true });
});
