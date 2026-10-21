// Custom sticker packs: anyone can make a pack from their own pictures and share it by link.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db, q, now, tx } from './db.js';
import { upload, saveImage, deleteMediaFile } from './media.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS sticker_packs (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    slug       TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stickers (
    id         INTEGER PRIMARY KEY,
    pack_id    INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    file       TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '🙂',
    pos        INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stickers_pack ON stickers(pack_id, pos);
  CREATE TABLE IF NOT EXISTS user_sticker_packs (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id  INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, pack_id)
  ) WITHOUT ROWID;
`);

export const MAX_STICKERS = 120;
const MAX_PACKS = 20;
const mediaUrl = (n) => (n ? `/media/${n}` : null);
const EMOJI_RE = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]{0,6}$/u;

/** Custom sticker id used in messages: "u:<id>". Returns the row or null. */
export function customSticker(id) {
  const m = /^u:(\d{1,12})$/.exec(String(id || ''));
  return m ? q('SELECT s.*, p.slug FROM stickers s JOIN sticker_packs p ON p.id = s.pack_id WHERE s.id = ?').get(Number(m[1])) || null : null;
}

export const stickerExtra = (s) => ({ src: mediaUrl(s.file), emoji: s.emoji, pack: s.slug });

function serializePack(p, userId) {
  const stickers = q('SELECT * FROM stickers WHERE pack_id = ? ORDER BY pos, id').all(p.id);
  return {
    id: p.id, title: p.title, slug: p.slug, mine: p.owner_id === userId,
    added: !!q('SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?').get(userId, p.id),
    installs: q('SELECT COUNT(*) AS n FROM user_sticker_packs WHERE pack_id = ?').get(p.id).n,
    stickers: stickers.map((s) => ({ id: `u:${s.id}`, src: mediaUrl(s.file), emoji: s.emoji })),
  };
}

export function registerStickers(api, { bad, int, clean }) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });
  const ownPack = (req, res) => {
    const p = int(req.params.id) && q('SELECT * FROM sticker_packs WHERE id = ?').get(int(req.params.id));
    if (!p) { bad(res, 'not_found', 404); return null; }
    if (p.owner_id !== req.user.id) { bad(res, 'forbidden', 403); return null; }
    return p;
  };

  // My packs: created by me or added from a link.
  api.get('/stickers/packs', (req, res) => {
    const rows = q(`SELECT p.* FROM sticker_packs p JOIN user_sticker_packs u ON u.pack_id = p.id AND u.user_id = ?
                    ORDER BY u.added_at`).all(req.user.id);
    res.json({ packs: rows.map((p) => serializePack(p, req.user.id)) });
  });

  api.get('/stickers/by/:slug', (req, res) => {
    const p = q('SELECT * FROM sticker_packs WHERE slug = ?').get(String(req.params.slug || ''));
    if (!p) return bad(res, 'not_found', 404);
    const owner = q('SELECT name, username FROM users WHERE id = ?').get(p.owner_id);
    res.json({ pack: { ...serializePack(p, req.user.id), owner } });
  });

  api.post('/stickers/packs', limiter, (req, res) => {
    const title = clean(req.body?.title, 48);
    if (!title) return bad(res, 'bad_title');
    if (q('SELECT COUNT(*) AS n FROM sticker_packs WHERE owner_id = ?').get(req.user.id).n >= MAX_PACKS) return bad(res, 'too_many_packs');
    const slug = crypto.randomBytes(6).toString('base64url');
    const id = tx(() => {
      const r = q('INSERT INTO sticker_packs (owner_id, title, slug, created_at) VALUES (?, ?, ?, ?)').run(req.user.id, title, slug, now());
      const pid = Number(r.lastInsertRowid);
      q('INSERT INTO user_sticker_packs (user_id, pack_id, added_at) VALUES (?, ?, ?)').run(req.user.id, pid, now());
      return pid;
    });
    res.json({ pack: serializePack(q('SELECT * FROM sticker_packs WHERE id = ?').get(id), req.user.id) });
  });

  api.patch('/stickers/packs/:id', (req, res) => {
    const p = ownPack(req, res);
    if (!p) return;
    const title = clean(req.body?.title, 48);
    if (!title) return bad(res, 'bad_title');
    q('UPDATE sticker_packs SET title = ? WHERE id = ?').run(title, p.id);
    res.json({ pack: serializePack({ ...p, title }, req.user.id) });
  });

  api.delete('/stickers/packs/:id', (req, res) => {
    const p = ownPack(req, res);
    if (!p) return;
    const files = q('SELECT file FROM stickers WHERE pack_id = ?').all(p.id);
    q('DELETE FROM sticker_packs WHERE id = ?').run(p.id);
    for (const f of files) deleteMediaFile(f.file);
    res.json({ ok: true });
  });

  api.post('/stickers/packs/:id/stickers', limiter, upload.single('file'), (req, res) => {
    const p = ownPack(req, res);
    if (!p) return;
    if (q('SELECT COUNT(*) AS n FROM stickers WHERE pack_id = ?').get(p.id).n >= MAX_STICKERS) return bad(res, 'pack_full');
    const emoji = EMOJI_RE.test(String(req.body?.emoji || '')) ? String(req.body.emoji) : '🙂';
    // Public-by-link like avatars: packs are meant to be shared.
    const img = saveImage(req.file, { ownerId: req.user.id, kind: 'avatar', maxBytes: 1024 * 1024 });
    const pos = (q('SELECT MAX(pos) AS m FROM stickers WHERE pack_id = ?').get(p.id).m || 0) + 1;
    q('INSERT INTO stickers (pack_id, file, emoji, pos, created_at) VALUES (?, ?, ?, ?, ?)').run(p.id, img.name, emoji, pos, now());
    res.json({ pack: serializePack(p, req.user.id) });
  });

  api.delete('/stickers/:id', (req, res) => {
    const s = customSticker(req.params.id);
    const p = s && q('SELECT * FROM sticker_packs WHERE id = ?').get(s.pack_id);
    if (!p || p.owner_id !== req.user.id) return bad(res, 'not_found', 404);
    q('DELETE FROM stickers WHERE id = ?').run(s.id);
    // Already sent messages keep showing it only while the file exists — keep the file for them.
    res.json({ pack: serializePack(p, req.user.id) });
  });

  api.post('/stickers/packs/:id/add', (req, res) => {
    const p = int(req.params.id) && q('SELECT * FROM sticker_packs WHERE id = ?').get(int(req.params.id));
    if (!p) return bad(res, 'not_found', 404);
    if (q('SELECT COUNT(*) AS n FROM user_sticker_packs WHERE user_id = ?').get(req.user.id).n >= 60) return bad(res, 'too_many_packs');
    q('INSERT OR IGNORE INTO user_sticker_packs (user_id, pack_id, added_at) VALUES (?, ?, ?)').run(req.user.id, p.id, now());
    res.json({ pack: serializePack(p, req.user.id) });
  });

  api.post('/stickers/packs/:id/remove', (req, res) => {
    const id = int(req.params.id);
    if (!id) return bad(res, 'not_found', 404);
    q('DELETE FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?').run(req.user.id, id);
    res.json({ ok: true });
  });
}
