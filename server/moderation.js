// Moderation & platform controls: reports from users, temporary bans and mutes, stop words,
// maintenance mode, feature switches, the announcement banner and daily-activity stats.
import { anonSnapshot } from './anon.js';
import rateLimit from 'express-rate-limit';
import { db, q, now, kvGet, kvSet } from './db.js';
import { emitAll, emitToUsers } from './realtime.js';
import { isAdminUser } from './auth.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL,
    target_id   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    comment     TEXT NOT NULL DEFAULT '',
    snapshot    TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'open',
    resolution  TEXT,
    resolved_by INTEGER,
    resolved_at INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reports_status ON reports(status, id);
  CREATE TABLE IF NOT EXISTS daily_active (
    day     TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (day, user_id)
  ) WITHOUT ROWID;
`);
for (const [col, ddl] of [['banned_until', 'INTEGER NOT NULL DEFAULT 0'], ['ban_reason', 'TEXT'], ['muted_until', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!q("SELECT 1 FROM pragma_table_info('users') WHERE name = ?").get(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${ddl}`);
}

export const REASONS = { spam: 'Спам', abuse: 'Оскорбления', scam: 'Мошенничество', nsfw: 'Непристойное', violence: 'Насилие', fake: 'Выдаёт себя за другого', other: 'Другое' };
export const FEATURES = { stories: 'Истории', communities: 'Сообщества', bots: 'Боты', extras: 'Капсулы и колесо решений' };

// ---------------------------------------------------------------- platform settings

const DEFAULTS = { registration: true, maintenance: false, banner: null, stopWords: [], features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])) };
let cache = null;
export function platform() {
  if (!cache) {
    let saved = {};
    try { saved = JSON.parse(kvGet('platform') || '{}'); } catch { /* broken value: defaults */ }
    cache = { ...DEFAULTS, ...saved, features: { ...DEFAULTS.features, ...(saved.features || {}) } };
  }
  return cache;
}
/** What every client needs to know (no stop words). */
export const publicPlatform = () => { const p = platform(); return { registration: p.registration, maintenance: p.maintenance, banner: p.banner, features: p.features }; };

export function setPlatform(patch) {
  const p = { ...platform() };
  if (typeof patch.registration === 'boolean') p.registration = patch.registration;
  if (typeof patch.maintenance === 'boolean') p.maintenance = patch.maintenance;
  if (patch.banner !== undefined) {
    const text = String(patch.banner?.text || '').trim().slice(0, 300);
    p.banner = text ? { text, kind: ['info', 'warn', 'promo'].includes(patch.banner.kind) ? patch.banner.kind : 'info', id: now() } : null;
  }
  if (Array.isArray(patch.stopWords)) p.stopWords = [...new Set(patch.stopWords.map((w) => String(w).trim().toLowerCase()).filter((w) => w.length >= 2 && w.length <= 40))].slice(0, 300);
  if (patch.features && typeof patch.features === 'object') {
    p.features = { ...p.features };
    for (const k of Object.keys(FEATURES)) if (typeof patch.features[k] === 'boolean') p.features[k] = patch.features[k];
  }
  kvSet('platform', JSON.stringify(p));
  cache = p;
  emitAll('platform', publicPlatform());
  return p;
}

export const featureOn = (name) => platform().features[name] !== false;
/** Express guard: 403 when the feature is switched off in the admin panel. */
export const featureGate = (name) => (req, res, next) => (featureOn(name) ? next() : res.status(403).json({ error: 'feature_off' }));

let wordRe = null, wordKey = '';
/** Replace stop words with ***. */
export function filterText(text) {
  const words = platform().stopWords;
  if (!text || !words.length) return text;
  const key = words.join('\n');
  if (key !== wordKey) {
    wordKey = key;
    wordRe = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  }
  return text.replace(wordRe, (m) => '*'.repeat(Math.min(m.length, 8)));
}

/** Extra reasons a user may not post right now (maintenance, mute). */
export function moderationError(userId) {
  const u = q('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return 'forbidden';
  if (platform().maintenance && !isAdminUser(u)) return 'maintenance';
  if (u.muted_until > now()) return 'muted';
  return null;
}

// ---------------------------------------------------------------- activity stats

const seenToday = new Set();
let seenDay = '';
export function recordActive(userId) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== seenDay) { seenDay = day; seenToday.clear(); }
  if (seenToday.has(userId)) return;
  seenToday.add(userId);
  q('INSERT OR IGNORE INTO daily_active (day, user_id) VALUES (?, ?)').run(day, userId);
}

// ---------------------------------------------------------------- reports (user side)

export function registerReports(api, { bad, int, clean, isMember }) {
  const limiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });

  function snapshot(type, id, userId) {
    if (type === 'message') {
      const m = q('SELECT * FROM messages WHERE id = ?').get(id);
      if (!m) return null;
      const c = q('SELECT * FROM chats WHERE id = ?').get(m.chat_id);
      const publicChan = c.type === 'channel' && c.username;
      if (!isMember(m.chat_id, userId) && !publicChan) return null;
      const s = m.sender_id ? q('SELECT id, name, username FROM users WHERE id = ?').get(m.sender_id) : null;
      return { offender: s?.id || null, data: { kind: m.kind, text: m.text.slice(0, 2000), file: m.file ? `/media/${m.file}` : null, chatId: c.id, chatType: c.type, chatTitle: c.title || null, sender: s, at: m.created_at } };
    }
    if (type === 'user') {
      const u = q('SELECT id, name, username, bio, avatar FROM users WHERE id = ?').get(id);
      return u && u.id !== userId ? { offender: u.id, data: { ...u, avatar: u.avatar ? `/media/${u.avatar}` : null } } : null;
    }
    if (type === 'chat') {
      const c = q("SELECT * FROM chats WHERE id = ? AND type IN ('group', 'channel')").get(id);
      if (!c || (!isMember(c.id, userId) && !c.username)) return null;
      return { offender: c.owner_id, data: { title: c.title, username: c.username, type: c.type, description: c.description, ownerId: c.owner_id } };
    }
    if (type === 'anon') return anonSnapshot(id, userId);
    if (type === 'community') {
      const c = q('SELECT * FROM communities WHERE id = ?').get(id);
      if (!c || !q('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?').get(c.id, userId)) return null;
      return { offender: c.owner_id, data: { title: c.title, description: c.description, ownerId: c.owner_id } };
    }
    return null;
  }

  api.post('/reports', limiter, (req, res) => {
    const type = String(req.body?.type || '');
    const id = int(req.body?.id);
    const reason = REASONS[req.body?.reason] ? req.body.reason : 'other';
    const snap = id && snapshot(type, id, req.user.id);
    if (!snap) return bad(res, 'not_found', 404);
    if (q("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'").get(req.user.id, type, id)) return res.json({ ok: true, duplicate: true });
    q('INSERT INTO reports (reporter_id, target_type, target_id, reason, comment, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, type, id, reason, clean(req.body?.comment, 500), JSON.stringify({ ...snap.data, offender: snap.offender }), now());
    // Ping admins who have the panel open.
    const admins = q('SELECT * FROM users WHERE banned = 0').all().filter(isAdminUser).map((u) => u.id);
    emitToUsers(admins, 'admin:report', { type, reason });
    res.json({ ok: true });
  });
}

// Lift temporary bans and mutes when they run out.
setInterval(() => {
  try {
    q('UPDATE users SET banned = 0, banned_until = 0, ban_reason = NULL WHERE banned = 1 AND banned_until > 0 AND banned_until <= ?').run(now());
    q('UPDATE users SET muted_until = 0 WHERE muted_until > 0 AND muted_until <= ?').run(now());
  } catch (e) { console.error('moderation tick', e); }
}, 30_000).unref();
