// Profile 2.0: cover photo or gradient, emoji status, mood, links, birthday, city, interests,
// an animated profile effect, a profile track (music) and a profile views counter.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { db, q, now } from './db.js';
import { upload, saveImage, deleteMediaFile } from './media.js';

if (!q("SELECT 1 FROM pragma_table_info('users') WHERE name = 'profile_x'").get()) db.exec("ALTER TABLE users ADD COLUMN profile_x TEXT NOT NULL DEFAULT '{}'");
db.exec(`
  CREATE TABLE IF NOT EXISTS profile_views (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day       TEXT NOT NULL,
    PRIMARY KEY (user_id, viewer_id, day)
  ) WITHOUT ROWID;
`);

const HEX = /^#[0-9a-f]{6}$/i;
const EFFECTS = new Set(['none', 'snow', 'hearts', 'stars', 'lemons', 'leaves', 'bubbles', 'sakura', 'fire']);
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const mediaDir = path.join(config.dataDir, 'media');

export const profileOf = (u) => { try { return JSON.parse(u?.profile_x || '{}') || {}; } catch { return {}; } };

/** What other people see (null fields dropped). */
export function profileView(u) {
  const p = profileOf(u);
  const out = {};
  if (p.cover) out.cover = `/media/${p.cover}`;
  if (p.coverColors) out.coverColors = p.coverColors;
  if (p.emoji) out.emoji = p.emoji;
  if (p.mood) out.mood = p.mood;
  if (p.links?.length) out.links = p.links;
  if (p.bday) out.bday = p.bday.showYear ? p.bday : { d: p.bday.d, m: p.bday.m };
  if (p.city) out.city = p.city;
  if (p.tags?.length) out.tags = p.tags;
  if (p.effect && p.effect !== 'none') out.effect = p.effect;
  if (p.track) out.track = { url: `/media/${p.track.file}`, name: p.track.name, dur: p.track.dur };
  if (!p.anonOff && !/^(bot|system):/.test(String(u?.google_sub))) out.anon = true;
  return out;
}

function cleanPatch(b, cur) {
  const p = { ...cur };
  if (b.emoji !== undefined) p.emoji = b.emoji ? [...String(b.emoji)].slice(0, 3).join('').trim().slice(0, 16) || null : null;
  if (b.mood !== undefined) p.mood = clean(b.mood, 60) || null;
  if (b.city !== undefined) p.city = clean(b.city, 40) || null;
  if (b.effect !== undefined) p.effect = EFFECTS.has(b.effect) ? b.effect : 'none';
  if (b.coverColors !== undefined) {
    const c = Array.isArray(b.coverColors) ? b.coverColors.filter((x) => HEX.test(x)).slice(0, 2) : [];
    p.coverColors = c.length === 2 ? c.map((x) => x.toLowerCase()) : null;
  }
  if (b.tags !== undefined) {
    const tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(','))
      .map((t) => clean(t, 24).replace(/^#/, '')).filter(Boolean);
    p.tags = [...new Set(tags)].slice(0, 8);
  }
  if (b.links !== undefined) {
    p.links = (Array.isArray(b.links) ? b.links : []).slice(0, 4).map((l) => {
      let url = clean(l?.url, 300);
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      try { const x = new URL(url); if (!['http:', 'https:'].includes(x.protocol)) return null; url = x.href; } catch { return null; }
      return { title: clean(l?.title, 30) || new URL(url).hostname.replace(/^www\./, ''), url };
    }).filter(Boolean);
  }
  if (b.bday !== undefined) {
    const d = Number(b.bday?.d), m = Number(b.bday?.m), y = Number(b.bday?.y) || null;
    const okDate = Number.isInteger(d) && Number.isInteger(m) && m >= 1 && m <= 12 && d >= 1 && d <= new Date(2024, m, 0).getDate();
    const okYear = !y || (y >= 1900 && y <= new Date().getFullYear());
    p.bday = b.bday && okDate && okYear ? { d, m, y, showYear: !!b.bday.showYear && !!y } : null;
  }
  return p;
}

/** mp3 / m4a / ogg / webm / wav — the profile track. */
function sniffMusic(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  return null;
}

const MSK = 3 * 3600_000;
const dayOf = (t) => new Date(t + MSK).toISOString().slice(0, 10);

export function registerProfiles(api, { bad, int, pushMe, broadcastProfile }) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });
  const save = (userId, p) => {
    q('UPDATE users SET profile_x = ? WHERE id = ?').run(JSON.stringify(p), userId);
    const u = q('SELECT * FROM users WHERE id = ?').get(userId);
    broadcastProfile(u);
    pushMe(userId);
    return u;
  };

  api.patch('/me/profile', limiter, (req, res) => {
    const p = cleanPatch(req.body || {}, profileOf(req.user));
    save(req.user.id, p);
    res.json({ ok: true, px: profileView(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  api.post('/me/cover', limiter, upload.single('file'), (req, res) => {
    const img = saveImage(req.file, { ownerId: req.user.id, kind: 'avatar', maxBytes: 8 * 1024 * 1024 });
    const p = profileOf(req.user);
    deleteMediaFile(p.cover);
    p.cover = img.name;
    save(req.user.id, p);
    res.json({ ok: true, px: profileView(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });
  api.delete('/me/cover', (req, res) => {
    const p = profileOf(req.user);
    deleteMediaFile(p.cover);
    delete p.cover;
    save(req.user.id, p);
    res.json({ ok: true, px: profileView(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  // Profile track: up to 10 MB of music, public like the avatar.
  api.post('/me/track', limiter, upload.single('file'), (req, res) => {
    const buf = req.file?.buffer;
    if (!buf) return bad(res, 'no_file');
    const t = sniffMusic(buf);
    if (!t) return bad(res, 'unsupported_audio');
    const name = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
    fs.writeFileSync(path.join(mediaDir, name), buf, { flag: 'wx' });
    q('INSERT INTO media (name, owner_id, kind, chat_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, req.user.id, 'avatar', null, t.mime, buf.length, now());
    const p = profileOf(req.user);
    if (p.track) deleteMediaFile(p.track.file);
    const orig = Buffer.from(String(req.file.originalname || ''), 'latin1').toString('utf8').replace(/\.[a-z0-9]{2,4}$/i, '');
    p.track = { file: name, name: clean(req.body?.name || orig, 60) || 'Трек', dur: Math.min(Math.max(Number(req.body?.duration) || 0, 0), 3600) };
    save(req.user.id, p);
    res.json({ ok: true, px: profileView(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });
  api.delete('/me/track', (req, res) => {
    const p = profileOf(req.user);
    if (p.track) deleteMediaFile(p.track.file);
    delete p.track;
    save(req.user.id, p);
    res.json({ ok: true, px: profileView(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  // Someone opened a profile: one view per viewer per day.
  api.post('/users/:id/view', (req, res) => {
    const id = int(req.params.id);
    if (id && id !== req.user.id && q('SELECT 1 FROM users WHERE id = ?').get(id)) {
      q('INSERT OR IGNORE INTO profile_views (user_id, viewer_id, day) VALUES (?, ?, ?)').run(id, req.user.id, dayOf(now()));
    }
    res.json({ ok: true });
  });
  api.get('/me/profile-stats', (req, res) => {
    const since = dayOf(now() - 6 * 864e5);
    res.json({
      week: q('SELECT COUNT(*) AS n FROM profile_views WHERE user_id = ? AND day >= ?').get(req.user.id, since).n,
      total: q('SELECT COUNT(*) AS n FROM profile_views WHERE user_id = ?').get(req.user.id).n,
    });
  });

  setInterval(() => q('DELETE FROM profile_views WHERE day < ?').run(dayOf(now() - 365 * 864e5)), 24 * 3600_000).unref();
}
