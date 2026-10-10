import { db, q, now } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ip_bans (
    ip         TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT '',
    user_id    INTEGER,
    by_id      INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_ips (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip         TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    PRIMARY KEY (user_id, ip)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS user_ips_ip ON user_ips(ip);
`);

/** "::ffff:1.2.3.4" -> "1.2.3.4"; lower-case IPv6. */
export function normIp(ip) {
  return String(ip || '').trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1').toLowerCase();
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/;
export const validIp = (ip) => IPV4.test(ip) || (ip.includes(':') && IPV6.test(ip));

// In-memory copy: checked on every request, so no DB hit.
const banned = new Set(q('SELECT ip FROM ip_bans').all().map((r) => r.ip));
export const isIpBanned = (ip) => banned.size > 0 && banned.has(normIp(ip));

export function banIp(ip, { reason = '', userId = null, byId = null } = {}) {
  const n = normIp(ip);
  if (!validIp(n)) return false;
  q('INSERT OR REPLACE INTO ip_bans (ip, reason, user_id, by_id, created_at) VALUES (?, ?, ?, ?, ?)').run(n, String(reason).slice(0, 200), userId, byId, now());
  banned.add(n);
  return true;
}

export function unbanIp(ip) {
  const n = normIp(ip);
  q('DELETE FROM ip_bans WHERE ip = ?').run(n);
  banned.delete(n);
}

export function listIpBans() {
  return q(`SELECT b.*, u.username, u.name FROM ip_bans b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 500`).all()
    .map((b) => ({ ip: b.ip, reason: b.reason, userId: b.user_id, username: b.username, name: b.name, createdAt: b.created_at }));
}

// Remember which addresses each account uses (throttled: one write per user+IP per 10 min).
const lastTrack = new Map();
export function trackIp(userId, ip) {
  const n = normIp(ip);
  if (!userId || !n) return;
  const key = `${userId}|${n}`;
  const t = Date.now();
  if (t - (lastTrack.get(key) || 0) < 600_000) return;
  lastTrack.set(key, t);
  if (lastTrack.size > 50_000) lastTrack.clear();
  q(`INSERT INTO user_ips (user_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = excluded.last_seen`).run(userId, n, t, t);
}

/** All addresses seen for a user (activity + sessions), newest first. */
export function userIps(userId) {
  const map = new Map();
  for (const r of q('SELECT ip, first_seen, last_seen FROM user_ips WHERE user_id = ?').all(userId)) {
    map.set(r.ip, { ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen });
  }
  for (const s of q('SELECT ip, created_at, last_used FROM sessions WHERE user_id = ?').all(userId)) {
    const ip = normIp(s.ip);
    if (!ip) continue;
    const e = map.get(ip) || { ip, firstSeen: s.created_at, lastSeen: s.last_used };
    e.firstSeen = Math.min(e.firstSeen, s.created_at);
    e.lastSeen = Math.max(e.lastSeen, s.last_used);
    map.set(ip, e);
  }
  return [...map.values()]
    .map((e) => ({ ...e, banned: banned.has(e.ip), sharedWith: q('SELECT COUNT(DISTINCT user_id) AS n FROM user_ips WHERE ip = ? AND user_id != ?').get(e.ip, userId).n }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

const BANNED_PAGE = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Доступ ограничен</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#0f172a;color:#e2e8f0;text-align:center">
<div style="padding:24px"><div style="font-size:56px">⛔</div><h1 style="font-size:22px">Доступ ограничен</h1>
<p style="color:#94a3b8;max-width:360px">Доступ к Limoninior с вашего IP-адреса заблокирован администрацией.</p></div></body></html>`;

/** Express middleware: block everything from banned addresses. */
export function ipBanGuard(req, res, next) {
  if (!isIpBanned(req.ip)) return next();
  res.set('Cache-Control', 'no-store');
  if (req.path.startsWith('/api') || req.path.startsWith('/media')) return res.status(403).json({ error: 'ip_banned' });
  res.status(403).type('html').send(BANNED_PAGE);
}
