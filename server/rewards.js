// Roles and badges ("Лимон чат" rewards). They come from the owner's game launcher: a person links
// the launcher to their account with a personal key, and the launcher grants rewards for playing.
// Admins can also grant them by hand and add new ones without touching the code.
import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db, q, now, kvGet, kvSet, audit } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS user_rewards (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward     TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'launcher',
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, reward)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS launcher_tokens (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used  INTEGER NOT NULL DEFAULT 0
  );
`);
if (!q("SELECT 1 FROM pragma_table_info('users') WHERE name = 'shown_role'").get()) db.exec('ALTER TABLE users ADD COLUMN shown_role TEXT');

/** Built-in rewards (from the launcher's "Лимон чат" list). Admins can add more in the panel. */
export const BUILTIN_REWARDS = [
  { id: 'tireless', kind: 'role', name: 'Неутомимый', emoji: '⏱️', color: '#f59e0b', desc: '40 часов в играх' },
  { id: 'collector', kind: 'badge', name: 'Коллекционер', emoji: '🏅', color: '#eab308', desc: '10 достижений' },
  { id: 'legend', kind: 'role', name: 'Легенда', emoji: '👑', color: '#a855f7', desc: '51 достижение' },
  { id: 'explorer', kind: 'badge', name: 'Исследователь', emoji: '🧭', color: '#0ea5e9', desc: 'Сыграть в 17 разных игр' },
  { id: 'veteran', kind: 'role', name: 'Ветеран', emoji: '🎖️', color: '#ef4444', desc: 'Уровень профиля 15' },
];
const ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;

export function rewardCatalog() {
  let custom = [];
  try { custom = JSON.parse(kvGet('rewards_custom') || '[]'); } catch { /* broken value */ }
  return [...BUILTIN_REWARDS, ...custom.map((r) => ({ ...r, custom: true }))];
}
const rewardById = (id) => rewardCatalog().find((r) => r.id === id) || null;

export const userRewards = (userId) => q('SELECT reward, source, granted_at FROM user_rewards WHERE user_id = ? ORDER BY granted_at').all(userId)
  .map((r) => ({ id: r.reward, source: r.source, at: r.granted_at })).filter((r) => rewardById(r.id));

/** Give a reward. Returns true when it is new. */
export function grantReward(userId, rewardId, source) {
  const r = rewardById(rewardId);
  if (!r) return false;
  const res = q('INSERT OR IGNORE INTO user_rewards (user_id, reward, source, granted_at) VALUES (?, ?, ?, ?)').run(userId, r.id, source, now());
  // The first role you get is shown right away.
  if (res.changes && r.kind === 'role') q('UPDATE users SET shown_role = COALESCE(shown_role, ?) WHERE id = ?').run(r.id, userId);
  return res.changes > 0;
}
export function revokeReward(userId, rewardId) {
  q('DELETE FROM user_rewards WHERE user_id = ? AND reward = ?').run(userId, rewardId);
  q('UPDATE users SET shown_role = NULL WHERE id = ? AND shown_role = ?').run(userId, rewardId);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** In-app routes (signed-in user). */
export function registerRewards(api, { bad, pushMe, notify }) {
  api.get('/rewards/catalog', (req, res) => res.json({ rewards: rewardCatalog() }));

  api.get('/users/:id/rewards', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return bad(res, 'not_found', 404);
    res.json({ rewards: userRewards(id) });
  });

  api.post('/me/role', (req, res) => {
    const id = req.body?.role ? String(req.body.role) : null;
    if (id && (!rewardById(id) || rewardById(id).kind !== 'role' || !q('SELECT 1 FROM user_rewards WHERE user_id = ? AND reward = ?').get(req.user.id, id))) return bad(res, 'not_found', 404);
    q('UPDATE users SET shown_role = ? WHERE id = ?').run(id, req.user.id);
    pushMe(req.user.id);
    res.json({ ok: true, role: id });
  });

  api.get('/me/launcher', (req, res) => {
    const t = q('SELECT created_at, last_used FROM launcher_tokens WHERE user_id = ?').get(req.user.id);
    res.json({ connected: !!t, createdAt: t?.created_at || 0, lastUsed: t?.last_used || 0 });
  });
  api.post('/me/launcher', (req, res) => {
    const token = `lc_${crypto.randomBytes(24).toString('base64url')}`;
    q(`INSERT INTO launcher_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, last_used = 0`).run(req.user.id, sha(token), now());
    audit(req.user.id, req.ip, 'launcher_key');
    res.json({ token });
  });
  api.delete('/me/launcher', (req, res) => {
    q('DELETE FROM launcher_tokens WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  // ---------- the launcher's API (no cookies: a personal key in the Authorization header) ----------
  const ext = express.Router();
  ext.use((req, res, next) => {
    // The launcher may be a desktop app or a local web page: allow any origin, there are no cookies here.
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  ext.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
  ext.use(express.json({ limit: '8kb' }));
  ext.use((req, res, next) => {
    const m = /^Bearer\s+(lc_[A-Za-z0-9_-]{20,80})$/.exec(req.get('authorization') || '');
    const t = m && q('SELECT * FROM launcher_tokens WHERE token_hash = ?').get(sha(m[1]));
    const u = t && q('SELECT * FROM users WHERE id = ? AND banned = 0').get(t.user_id);
    if (!u) return res.status(401).json({ ok: false, error: 'bad_key' });
    if (now() - t.last_used > 60_000) q('UPDATE launcher_tokens SET last_used = ? WHERE user_id = ?').run(now(), u.id);
    req.user = u;
    next();
  });
  const view = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.shown_role, rewards: userRewards(u.id).map((r) => r.id) });

  ext.get('/me', (req, res) => res.json({ ok: true, user: view(req.user) }));
  ext.get('/rewards', (req, res) => res.json({ ok: true, rewards: rewardCatalog().map(({ id, kind, name, emoji, desc }) => ({ id, kind, name, emoji, desc })) }));
  ext.post('/rewards', (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.rewards) ? req.body.rewards : [req.body?.reward]).map(String))].slice(0, 20);
    const unknown = ids.filter((id) => !rewardById(id));
    if (unknown.length) return res.status(400).json({ ok: false, error: 'unknown_reward', unknown });
    const granted = ids.filter((id) => grantReward(req.user.id, id, 'launcher'));
    for (const id of granted) {
      const r = rewardById(id);
      notify(req.user.id, `🎉 ${r.kind === 'role' ? 'Новая роль' : 'Новый значок'} ${r.emoji} «${r.name}» — за игру в лаунчере${r.desc ? ` (${r.desc})` : ''}!`);
    }
    if (granted.length) pushMe(req.user.id);
    res.json({ ok: true, granted, user: view(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });
  return ext;
}

/** Admin panel: manage the catalog and grant by hand. */
export function registerRewardsAdmin(admin, { pushMe, notify }) {
  const log = (req, action, details) => audit(req.user.id, req.ip, action, details);
  admin.get('/rewards', (req, res) => {
    const counts = new Map(q('SELECT reward, COUNT(*) AS n FROM user_rewards GROUP BY reward').all().map((r) => [r.reward, r.n]));
    res.json({ rewards: rewardCatalog().map((r) => ({ ...r, owners: counts.get(r.id) || 0 })), linked: q('SELECT COUNT(*) AS n FROM launcher_tokens').get().n });
  });
  admin.post('/rewards', (req, res) => {
    const b = req.body || {};
    const r = {
      id: String(b.id || '').trim().toLowerCase(), kind: b.kind === 'badge' ? 'badge' : 'role',
      name: String(b.name || '').trim().slice(0, 40), emoji: String(b.emoji || '').trim().slice(0, 8) || '⭐',
      color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#22c55e', desc: String(b.desc || '').trim().slice(0, 120),
    };
    if (!ID_RE.test(r.id) || !r.name) return res.status(400).json({ error: 'bad_reward' });
    let custom = [];
    try { custom = JSON.parse(kvGet('rewards_custom') || '[]'); } catch { /* reset */ }
    if (BUILTIN_REWARDS.some((x) => x.id === r.id)) return res.status(400).json({ error: 'reward_exists' });
    custom = [...custom.filter((x) => x.id !== r.id), r].slice(0, 200);
    kvSet('rewards_custom', JSON.stringify(custom));
    log(req, 'admin_reward_save', { id: r.id, name: r.name });
    res.json({ ok: true });
  });
  admin.delete('/rewards/:id', (req, res) => {
    let custom = [];
    try { custom = JSON.parse(kvGet('rewards_custom') || '[]'); } catch { /* reset */ }
    kvSet('rewards_custom', JSON.stringify(custom.filter((x) => x.id !== req.params.id)));
    q('DELETE FROM user_rewards WHERE reward = ?').run(req.params.id);
    q('UPDATE users SET shown_role = NULL WHERE shown_role = ?').run(req.params.id);
    log(req, 'admin_reward_delete', { id: req.params.id });
    res.json({ ok: true });
  });
  admin.get('/users/:id/rewards', (req, res) => res.json({ rewards: userRewards(Number(req.params.id) || 0) }));
  admin.post('/users/:id/rewards', (req, res) => {
    const uid = Number(req.params.id) || 0;
    const u = q('SELECT * FROM users WHERE id = ?').get(uid);
    const r = rewardById(String(req.body?.reward || ''));
    if (!u || !r) return res.status(404).json({ error: 'not_found' });
    if (req.body?.grant === false) revokeReward(uid, r.id);
    else if (grantReward(uid, r.id, 'admin')) notify(uid, `🎉 ${r.kind === 'role' ? 'Вам выдана роль' : 'Вам выдан значок'} ${r.emoji} «${r.name}»!`);
    pushMe(uid);
    log(req, req.body?.grant === false ? 'admin_reward_revoke' : 'admin_reward_grant', { userId: uid, username: u.username, reward: r.id });
    res.json({ ok: true, rewards: userRewards(uid) });
  });
}
