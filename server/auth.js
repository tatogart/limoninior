import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { q, now, audit } from './db.js';

export const COOKIE = config.isProd ? '__Host-sid' : 'sid';
const googleClient = new OAuth2Client(config.googleClientId);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email || !p.email_verified) throw new Error('unverified google account');
  return { sub: p.sub, email: p.email.toLowerCase(), name: p.name || '', picture: p.picture || null };
}

/** Find or create a user from a verified identity. */
export function upsertUser({ sub, email, name, picture }) {
  const t = now();
  const existing = q('SELECT * FROM users WHERE google_sub = ?').get(sub);
  if (existing) {
    q('UPDATE users SET email = ?, google_pic = ?, last_seen = ? WHERE id = ?').run(email, picture, t, existing.id);
    return q('SELECT * FROM users WHERE id = ?').get(existing.id);
  }
  const r = q(`INSERT INTO users (google_sub, email, name, google_pic, created_at, last_seen)
               VALUES (?, ?, ?, ?, ?, ?)`).run(sub, email, (name || email.split('@')[0]).slice(0, 64), picture, t, t);
  return q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
}

export function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  const expires = t + config.sessionDays * 864e5;
  q(`INSERT INTO sessions (token_hash, user_id, created_at, last_used, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sha256(token), userId, t, t, expires, String(req.get('user-agent') || '').slice(0, 300), req.ip || '');
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 864e5,
  });
}

export function destroySession(res, sessionId) {
  if (sessionId) q('DELETE FROM sessions WHERE id = ?').run(sessionId);
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/' });
}

/** Resolve the session + user from a raw cookie header. Returns null if invalid. */
export function sessionFromCookie(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  if (!token || token.length > 100) return null;
  const s = q('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s) return null;
  const t = now();
  if (s.expires_at < t) {
    q('DELETE FROM sessions WHERE id = ?').run(s.id);
    return null;
  }
  const user = q('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!user || user.banned) return null;
  if (t - s.last_used > 60_000) q('UPDATE sessions SET last_used = ? WHERE id = ?').run(t, s.id);
  return { session: s, user };
}

export function isAdminUser(user) {
  return !!user && config.adminEmails.includes(String(user.email).toLowerCase());
}

/** Express middleware: require a valid session. */
export function requireAuth(req, res, next) {
  const r = sessionFromCookie(req.headers.cookie);
  if (!r) return res.status(401).json({ error: 'unauthorized' });
  req.session = r.session;
  req.user = r.user;
  next();
}

/** Express middleware: user must have picked a username before using the messenger. */
export function requireProfile(req, res, next) {
  if (!req.user.username) return res.status(403).json({ error: 'profile_incomplete' });
  next();
}

/**
 * CSRF protection: for state-changing requests the browser-sent Origin must
 * match our own origin. Combined with SameSite=Lax cookies this blocks
 * cross-site form posts and fetches.
 */
export function checkOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin !== config.appOrigin) {
    audit(null, req.ip, 'csrf_block', { origin: origin || null, path: req.path });
    return res.status(403).json({ error: 'bad_origin' });
  }
  next();
}
