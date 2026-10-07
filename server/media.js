import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.js';
import { q, now } from './db.js';

const mediaDir = path.join(config.dataDir, 'media');

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
});

// Arbitrary files go straight to disk (they can be large); max is the biggest plan limit.
const tmpDir = path.join(config.dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
export const uploadFile = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 5 },
});

/** Clean a user-supplied file name for display / Content-Disposition. */
export function safeFileName(name) {
  const n = Buffer.from(String(name || 'file'), 'latin1').toString('utf8'); // multer decodes as latin1
  return n.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'file';
}

/** Persist an uploaded file (any type). Always served as a download, never rendered. */
export function saveFile(file, { ownerId, chatId, maxBytes }) {
  const fail = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!file?.path) throw fail('no_file');
  if (file.size > maxBytes) {
    fs.rm(file.path, { force: true }, () => {});
    throw fail('file_too_large');
  }
  const name = `${crypto.randomBytes(16).toString('hex')}.bin`;
  fs.renameSync(file.path, path.join(mediaDir, name));
  const orig = safeFileName(file.originalname);
  q('INSERT INTO media (name, owner_id, kind, chat_id, mime, size, created_at, orig_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, ownerId, 'message', chatId, 'application/octet-stream', file.size, now(), orig);
  return { name, size: file.size, origName: orig };
}

// Remove stale partial uploads.
setInterval(() => {
  for (const f of fs.readdirSync(tmpDir)) {
    const p = path.join(tmpDir, f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.rmSync(p, { force: true }); } catch { /* ignore */ }
  }
}, 3600_000).unref();

/** Detect image type from magic bytes — never trust the client-provided mime. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Best-effort image dimensions (used only for layout placeholders). */
function dimensions(buf, mime) {
  try {
    if (mime === 'image/png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const chunk = buf.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch { /* fall through */ }
  return { w: null, h: null };
}

/**
 * Validate and persist an uploaded image. Returns { name, w, h } or throws
 * an Error with .status = 400.
 */
export function saveImage(file, { ownerId, kind, chatId = null, maxBytes = 10 * 1024 * 1024 }) {
  const fail = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!file?.buffer) throw fail('no_file');
  if (file.buffer.length > maxBytes) throw fail('file_too_large');
  const t = sniff(file.buffer);
  if (!t) throw fail('unsupported_image');
  const name = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
  fs.writeFileSync(path.join(mediaDir, name), file.buffer, { flag: 'wx' });
  q('INSERT INTO media (name, owner_id, kind, chat_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, ownerId, kind, chatId, t.mime, file.buffer.length, now());
  const { w, h } = dimensions(file.buffer, t.mime);
  return { name, w, h };
}

export function deleteMediaFile(name) {
  if (!name) return;
  q('DELETE FROM media WHERE name = ?').run(name);
  fs.rm(path.join(mediaDir, path.basename(name)), { force: true }, () => {});
}

/** GET /media/:name — avatars visible to any signed-in user, chat media only to members. */
export function serveMedia(req, res) {
  const name = req.params.name;
  if (!/^[a-f0-9]{32}\.(jpg|png|gif|webp|bin)$/.test(name)) return res.status(404).end();
  const m = q('SELECT * FROM media WHERE name = ?').get(name);
  if (!m) return res.status(404).end();
  if (m.kind === 'message') {
    const member = q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, req.user.id);
    const isPublic = q("SELECT 1 FROM chats WHERE id = ? AND type = 'channel' AND username IS NOT NULL").get(m.chat_id);
    if (!member && !isPublic) return res.status(404).end();
  }
  if (m.mime === 'application/octet-stream') {
    res.set('Content-Disposition', `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(m.orig_name || 'file')}`);
  }
  res.set({
    'Content-Type': m.mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(path.join(mediaDir, name));
}
