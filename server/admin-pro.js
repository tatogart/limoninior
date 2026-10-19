// Admin panel, second floor: live dashboard, user dossiers, reports queue, communities,
// platform switches, targeted broadcasts, audit search/export, database backups.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from './config.js';
import { db, q, now, audit } from './db.js';
import { isAdminUser } from './auth.js';
import { isOnline, onlineCount, socketCount, disconnectUser, emitToUsers } from './realtime.js';
import { userIps } from './ipban.js';
import { ensurePrivateChat, postMessage, deleteChat, officialUser, activePlan, removeMessage, OFFICIAL_SUB } from './api.js';
import { platform, setPlatform, REASONS, FEATURES } from './moderation.js';
import { roomsStats } from './groupcalls.js';

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let cpuPrev = { usage: process.cpuUsage(), t: process.hrtime.bigint() };

const DAY = 864e5;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const media = (n) => (n ? `/media/${n}` : null);
const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function series(rows, days) {
  const map = new Map(rows.map((r) => [r.d, r.n]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const d = dayKey(now() - i * DAY); out.push({ d, n: map.get(d) || 0 }); }
  return out;
}

const userBrief = (u) => (u ? { id: u.id, name: u.name, username: u.username, avatar: media(u.avatar), verified: !!u.verified, online: isOnline(u.id) } : null);

export function registerAdminPro(admin, { targetUser, anyUser, deviceInfo, notifyOwner }) {
  const one = (sql, ...a) => q(sql).get(...a).n;
  const log = (req, action, details) => audit(req.user.id, req.ip, action, details);

  // ---------------------------------------------------------------- dashboard

  admin.get('/overview', (req, res) => {
    const since = now() - 30 * DAY;
    const t = now();
    res.json({
      totals: {
        users: one('SELECT COUNT(*) AS n FROM users WHERE google_sub NOT LIKE ? AND google_sub NOT LIKE ?', 'bot:%', 'system:%'),
        bots: one("SELECT COUNT(*) AS n FROM users WHERE google_sub LIKE 'bot:%'"),
        online: onlineCount(),
        messages: one('SELECT COUNT(*) AS n FROM messages'),
        messages24: one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', t - DAY),
        regs24: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', t - DAY),
        dau: one('SELECT COUNT(*) AS n FROM daily_active WHERE day = ?', dayKey(t)),
        wau: one('SELECT COUNT(DISTINCT user_id) AS n FROM daily_active WHERE day > ?', dayKey(t - 7 * DAY)),
        mau: one('SELECT COUNT(DISTINCT user_id) AS n FROM daily_active WHERE day > ?', dayKey(t - 30 * DAY)),
        groups: one("SELECT COUNT(*) AS n FROM chats WHERE type = 'group' AND community_id IS NULL"),
        channels: one("SELECT COUNT(*) AS n FROM chats WHERE type = 'channel' AND community_id IS NULL"),
        communities: one('SELECT COUNT(*) AS n FROM communities'),
        subscribers: one('SELECT COUNT(*) AS n FROM users WHERE sub_tier IS NOT NULL AND sub_until > ?', t),
        banned: one('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
        muted: one('SELECT COUNT(*) AS n FROM users WHERE muted_until > ?', t),
        reports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
        verifyRequests: one("SELECT COUNT(*) AS n FROM chats WHERE type = 'channel' AND verify_requested > 0 AND verified = 0"),
        mediaBytes: q('SELECT COALESCE(SUM(size), 0) AS n FROM media').get().n,
        coins: q("SELECT COALESCE(SUM(coins), 0) AS n FROM users WHERE google_sub NOT LIKE 'system:%'").get().n,
      },
      regs: series(q(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM users WHERE created_at > ? GROUP BY d`).all(since), 30),
      msgs: series(q(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM messages WHERE created_at > ? GROUP BY d`).all(since), 30),
      dauSeries: series(q('SELECT day AS d, COUNT(*) AS n FROM daily_active WHERE day > ? GROUP BY day').all(dayKey(since)), 30),
      // Moscow time: rows = day of week (0 = Sunday), columns = hour.
      heat: q(`SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch', '+3 hours') AS INTEGER) AS dow,
                      CAST(strftime('%H', created_at / 1000, 'unixepoch', '+3 hours') AS INTEGER) AS hr, COUNT(*) AS n
               FROM messages WHERE created_at > ? GROUP BY dow, hr`).all(t - 28 * DAY),
      kinds: q("SELECT kind, COUNT(*) AS n FROM messages WHERE created_at > ? AND kind != 'system' GROUP BY kind ORDER BY n DESC").all(t - 7 * DAY),
      topChats: q(`SELECT c.id, c.type, c.title, c.username, c.community_id AS communityId, cm.title AS community, COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id
                   LEFT JOIN communities cm ON cm.id = c.community_id WHERE m.created_at > ? AND c.type IN ('group', 'channel') GROUP BY c.id ORDER BY n DESC LIMIT 8`).all(t - DAY),
      topSenders: q(`SELECT u.id, u.name, u.username, u.avatar, COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.sender_id
                     WHERE m.created_at > ? AND u.google_sub NOT LIKE 'bot:%' GROUP BY u.id ORDER BY n DESC LIMIT 8`).all(t - DAY)
        .map((u) => ({ ...userBrief(u), n: u.n })),
    });
  });

  admin.get('/live', (req, res) => {
    const t = now();
    const cpuNow = { usage: process.cpuUsage(), t: process.hrtime.bigint() };
    const el = Number(cpuNow.t - cpuPrev.t) / 1e3; // µs
    const cpu = el > 0 ? ((cpuNow.usage.user - cpuPrev.usage.user + cpuNow.usage.system - cpuPrev.usage.system) / el) * 100 : 0;
    cpuPrev = cpuNow;
    const lag = Math.round(loop.mean / 1e6);
    loop.reset();
    res.json({
      at: t,
      online: onlineCount(),
      sockets: socketCount(),
      perMinute: one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', t - 60_000),
      perHour: one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', t - 3600_000),
      calls: roomsStats(),
      cpu: Math.min(100 * os.cpus().length, Math.round(cpu)),
      lag,
      rss: process.memoryUsage().rss,
      reports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      feed: q(`SELECT a.id, a.at, a.action, a.details, u.username, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
               ORDER BY a.id DESC LIMIT 12`).all(),
    });
  });

  // ---------------------------------------------------------------- command palette search

  admin.get('/search', (req, res) => {
    const s = String(req.query.q || '').trim().replace(/^@/, '').slice(0, 64);
    if (!s) return res.json({ users: [], chats: [], communities: [] });
    const l = like(s);
    const idMatch = /^\d+$/.test(s) ? Number(s) : -1;
    res.json({
      users: q(`SELECT * FROM users WHERE id = ? OR username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY (username = ?) DESC LIMIT 8`)
        .all(idMatch, l, l, l, s).map((u) => ({ ...userBrief(u), banned: !!u.banned })),
      chats: q(`SELECT id, type, title, username FROM chats WHERE type IN ('group', 'channel') AND (title LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\') LIMIT 6`).all(l, l),
      communities: q("SELECT id, title FROM communities WHERE title LIKE ? ESCAPE '\\' LIMIT 5").all(l),
    });
  });

  // ---------------------------------------------------------------- user dossier

  admin.get('/users/:id', (req, res) => {
    const u = anyUser(req, res);
    if (!u) return;
    const t = now();
    const sessions = q('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_used DESC LIMIT 30').all(u.id)
      .map((s) => ({ id: s.id, ip: s.ip, createdAt: s.created_at, lastUsed: s.last_used, ...deviceInfo(s.user_agent) }));
    const plan = activePlan(u);
    res.json({
      user: {
        ...userBrief(u), email: u.email, bio: u.bio, createdAt: u.created_at, lastSeen: u.last_seen, coins: u.coins,
        banned: !!u.banned, bannedUntil: u.banned_until, banReason: u.ban_reason, mutedUntil: u.muted_until > t ? u.muted_until : 0,
        isAdmin: isAdminUser(u), official: u.google_sub === OFFICIAL_SUB, bot: String(u.google_sub).startsWith('bot:'),
        hasPassword: !!u.password_hash, sub: plan?.id || null, subUntil: plan ? u.sub_until : 0,
        referredBy: u.referred_by ? userBrief(q('SELECT * FROM users WHERE id = ?').get(u.referred_by)) : null,
      },
      stats: {
        messages: one('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ?', u.id),
        messages7: one('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at > ?', u.id, t - 7 * DAY),
        chats: one('SELECT COUNT(*) AS n FROM chat_members WHERE user_id = ?', u.id),
        groups: one("SELECT COUNT(*) AS n FROM chats WHERE owner_id = ? AND type = 'group' AND community_id IS NULL", u.id),
        channels: one("SELECT COUNT(*) AS n FROM chats WHERE owner_id = ? AND type = 'channel' AND community_id IS NULL", u.id),
        communities: one('SELECT COUNT(*) AS n FROM communities WHERE owner_id = ?', u.id),
        referrals: one('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?', u.id),
        reportsAgainst: one("SELECT COUNT(*) AS n FROM reports WHERE json_extract(snapshot, '$.offender') = ?", u.id),
        reportsFiled: one('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?', u.id),
        activeDays30: one('SELECT COUNT(*) AS n FROM daily_active WHERE user_id = ? AND day > ?', u.id, dayKey(t - 30 * DAY)),
      },
      activity: series(q(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at > ? GROUP BY d`).all(u.id, t - 14 * DAY), 14),
      sessions,
      ips: userIps(u.id).slice(0, 30),
      audit: q('SELECT id, at, action, ip, details FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 40').all(u.id),
    });
  });

  admin.post('/users/:id/mute', (req, res) => {
    const u = targetUser(req, res);
    if (!u) return;
    const hours = Math.min(Math.max(Number(req.body?.hours) || 0, 0), 24 * 365);
    q('UPDATE users SET muted_until = ? WHERE id = ?').run(hours ? now() + hours * 3600_000 : 0, u.id);
    log(req, hours ? 'admin_mute' : 'admin_unmute', { userId: u.id, username: u.username, hours });
    if (hours) notifyOwner(u.id, `🔇 Администрация ограничила вам отправку сообщений до ${new Date(now() + hours * 3600_000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК).`);
    res.json({ ok: true });
  });

  admin.post('/users/:id/message', (req, res) => {
    const u = anyUser(req, res);
    if (!u) return;
    const text = String(req.body?.text || '').trim().slice(0, 4096);
    if (!text) return res.status(400).json({ error: 'empty' });
    notifyOwner(u.id, text);
    log(req, 'admin_dm', { userId: u.id, username: u.username, text: text.slice(0, 120) });
    res.json({ ok: true });
  });

  // Anti-spam: wipe a user's messages (all, or only the recent ones).
  admin.post('/users/:id/purge', (req, res) => {
    const u = targetUser(req, res);
    if (!u) return;
    const hours = Math.max(Number(req.body?.hours) || 0, 0);
    const rows = q(`SELECT * FROM messages WHERE sender_id = ? ${hours ? 'AND created_at > ?' : ''} ORDER BY id DESC LIMIT 5000`).all(...(hours ? [u.id, now() - hours * 3600_000] : [u.id]));
    for (const m of rows) { try { removeMessage(m); } catch (e) { console.error('purge', e); } }
    log(req, 'admin_purge', { userId: u.id, username: u.username, removed: rows.length, hours });
    res.json({ ok: true, removed: rows.length });
  });

  // ---------------------------------------------------------------- reports

  admin.get('/reports', (req, res) => {
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : null;
    const rows = q(`SELECT r.*, u.name AS reporter_name, u.username AS reporter_username FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
                    ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`).all(...(status ? [status] : []));
    // How many people reported the same thing (shown as weight).
    const weight = new Map(q("SELECT target_type || ':' || target_id AS k, COUNT(*) AS n FROM reports WHERE status = 'open' GROUP BY k").all().map((r) => [r.k, r.n]));
    res.json({
      reasons: REASONS,
      reports: rows.map((r) => {
        const snap = JSON.parse(r.snapshot || '{}');
        const off = snap.offender ? q('SELECT * FROM users WHERE id = ?').get(snap.offender) : null;
        const alive = r.target_type === 'message' ? !!q('SELECT 1 FROM messages WHERE id = ?').get(r.target_id) : true;
        return {
          id: r.id, type: r.target_type, targetId: r.target_id, reason: r.reason, comment: r.comment, status: r.status, resolution: r.resolution,
          createdAt: r.created_at, resolvedAt: r.resolved_at, snapshot: snap, alive, weight: weight.get(`${r.target_type}:${r.target_id}`) || 1,
          reporter: r.reporter_id ? { id: r.reporter_id, name: r.reporter_name, username: r.reporter_username } : null,
          offender: off ? { ...userBrief(off), banned: !!off.banned, mutedUntil: off.muted_until > now() ? off.muted_until : 0, isAdmin: isAdminUser(off) } : null,
        };
      }),
    });
  });

  admin.post('/reports/:id', (req, res) => {
    const r = q('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id) || 0);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const action = String(req.body?.action || 'dismiss');
    const snap = JSON.parse(r.snapshot || '{}');
    const off = snap.offender ? q('SELECT * FROM users WHERE id = ?').get(snap.offender) : null;
    const hours = Math.min(Math.max(Number(req.body?.hours) || 0, 0), 24 * 3650);
    const done = [];
    const canPunish = off && !isAdminUser(off) && off.google_sub !== OFFICIAL_SUB;
    if (action === 'delete' || action === 'delete_ban' || action === 'delete_mute') {
      const m = r.target_type === 'message' && q('SELECT * FROM messages WHERE id = ?').get(r.target_id);
      if (m) { removeMessage(m); done.push('сообщение удалено'); }
      if (r.target_type === 'chat') { deleteChat(r.target_id); done.push('чат удалён'); }
      if (r.target_type === 'community') { destroyCommunity(r.target_id); done.push('сообщество удалено'); }
    }
    if ((action === 'ban' || action === 'delete_ban') && canPunish) {
      q('UPDATE users SET banned = 1, banned_until = ?, ban_reason = ? WHERE id = ?').run(hours ? now() + hours * 3600_000 : 0, `Жалоба: ${REASONS[r.reason] || r.reason}`, off.id);
      q('DELETE FROM sessions WHERE user_id = ?').run(off.id);
      disconnectUser(off.id);
      done.push(hours ? `бан на ${hours} ч` : 'бан навсегда');
    }
    if ((action === 'mute' || action === 'delete_mute') && canPunish) {
      const h = hours || 24;
      q('UPDATE users SET muted_until = ? WHERE id = ?').run(now() + h * 3600_000, off.id);
      done.push(`без права писать ${h} ч`);
    }
    if (action === 'warn' && off) {
      notifyOwner(off.id, `⚠️ На вас поступила жалоба (${REASONS[r.reason] || 'нарушение'}). Пожалуйста, соблюдайте правила Limochat — при повторных нарушениях аккаунт будет заблокирован.`);
      done.push('предупреждение отправлено');
    }
    const status = action === 'dismiss' ? 'dismissed' : 'resolved';
    const resolution = action === 'dismiss' ? 'отклонена' : done.join(', ') || 'рассмотрена';
    // The same target reported by several people is settled at once.
    q("UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE target_type = ? AND target_id = ? AND status = 'open'")
      .run(status, resolution, req.user.id, now(), r.target_type, r.target_id);
    log(req, 'admin_report', { reportId: r.id, action, resolution });
    if (r.reporter_id && action !== 'dismiss') notifyOwner(r.reporter_id, `Спасибо за жалобу! Мы её рассмотрели и приняли меры: ${resolution}.`);
    res.json({ ok: true, resolution });
  });

  // ---------------------------------------------------------------- communities

  function destroyCommunity(id) {
    const c = q('SELECT * FROM communities WHERE id = ?').get(id);
    if (!c) return false;
    const members = q('SELECT user_id FROM community_members WHERE community_id = ?').all(id).map((r) => r.user_id);
    for (const ch of q('SELECT id FROM chats WHERE community_id = ?').all(id)) deleteChat(ch.id);
    q('DELETE FROM communities WHERE id = ?').run(id);
    emitToUsers(members, 'community:removed', { communityId: id });
    return true;
  }

  admin.get('/communities', (req, res) => {
    const s = String(req.query.q || '').trim().slice(0, 64);
    const rows = q(`SELECT c.*, u.name AS owner_name, u.username AS owner_username,
                      (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) AS members,
                      (SELECT COUNT(*) FROM chats WHERE community_id = c.id) AS channels,
                      (SELECT COUNT(*) FROM messages m JOIN chats ch ON ch.id = m.chat_id WHERE ch.community_id = c.id AND m.created_at > ?) AS msgs7
                    FROM communities c LEFT JOIN users u ON u.id = c.owner_id
                    WHERE ? = '' OR c.title LIKE ? ESCAPE '\\' ORDER BY members DESC LIMIT 100`).all(now() - 7 * DAY, s, like(s));
    res.json({
      communities: rows.map((c) => ({
        id: c.id, title: c.title, description: c.description, avatar: media(c.avatar), createdAt: c.created_at,
        members: c.members, channels: c.channels, msgs7: c.msgs7, owner: c.owner_username ? `@${c.owner_username}` : c.owner_name || '—', ownerId: c.owner_id,
      })),
    });
  });

  admin.delete('/communities/:id', (req, res) => {
    const id = Number(req.params.id) || 0;
    const c = q('SELECT title FROM communities WHERE id = ?').get(id);
    if (!c || !destroyCommunity(id)) return res.status(404).json({ error: 'not_found' });
    log(req, 'admin_community_delete', { communityId: id, title: c.title });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- platform switches

  admin.get('/platform', (req, res) => res.json({ platform: platform(), features: FEATURES }));
  admin.post('/platform', (req, res) => {
    const p = setPlatform(req.body || {});
    log(req, 'admin_platform', { registration: p.registration, maintenance: p.maintenance, banner: p.banner?.text?.slice(0, 80) || null, stopWords: p.stopWords.length, features: p.features });
    res.json({ platform: p, features: FEATURES });
  });

  // ---------------------------------------------------------------- targeted broadcast

  const AUDIENCES = {
    all: ['Все', 'SELECT id FROM users WHERE banned = 0 AND username IS NOT NULL AND google_sub NOT LIKE \'bot:%\' AND google_sub NOT LIKE \'system:%\''],
    subs: ['Подписчики', 'SELECT id FROM users WHERE banned = 0 AND username IS NOT NULL AND sub_tier IS NOT NULL AND sub_until > :now'],
    active: ['Активные за 7 дней', 'SELECT DISTINCT user_id AS id FROM daily_active WHERE day > :week'],
    sleeping: ['Не заходили 30+ дней', 'SELECT id FROM users WHERE banned = 0 AND username IS NOT NULL AND last_seen < :month AND google_sub NOT LIKE \'bot:%\' AND google_sub NOT LIKE \'system:%\''],
    fresh: ['Новички (за 7 дней)', 'SELECT id FROM users WHERE banned = 0 AND username IS NOT NULL AND created_at > :weekMs AND google_sub NOT LIKE \'bot:%\''],
  };
  const audienceIds = (key) => {
    const [, sql] = AUDIENCES[key] || AUDIENCES.all;
    const t = now();
    const all = { now: t, week: dayKey(t - 7 * DAY), month: t - 30 * DAY, weekMs: t - 7 * DAY };
    const params = Object.fromEntries((sql.match(/:\w+/g) || []).map((k) => [k.slice(1), all[k.slice(1)]]));
    return db.prepare(sql).all(params).map((r) => r.id);
  };

  admin.get('/audiences', (req, res) => res.json({ audiences: Object.entries(AUDIENCES).map(([k, [label]]) => ({ key: k, label, count: audienceIds(k).length })) }));

  admin.post('/broadcast2', (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 4096);
    if (!text) return res.status(400).json({ error: 'empty' });
    const off = officialUser();
    const ids = audienceIds(req.body?.audience).filter((id) => id !== off.id);
    for (const id of ids) postMessage(ensurePrivateChat(off.id, id), off.id, { kind: 'text', text });
    log(req, 'admin_broadcast', { audience: req.body?.audience || 'all', recipients: ids.length, text: text.slice(0, 120) });
    res.json({ ok: true, recipients: ids.length });
  });

  // ---------------------------------------------------------------- audit search & export

  const auditRows = (req, limit) => {
    const s = String(req.query.q || '').trim().slice(0, 64);
    const action = String(req.query.action || '').trim().slice(0, 40);
    const alarm = req.query.alarm === '1';
    const where = [];
    const args = [];
    if (s) { where.push("(u.username LIKE ? ESCAPE '\\' OR a.ip LIKE ? ESCAPE '\\' OR a.details LIKE ? ESCAPE '\\')"); args.push(like(s), like(s), like(s)); }
    if (action) { where.push('a.action = ?'); args.push(action); }
    if (alarm) where.push("a.action IN ('login_failed', 'admin_unlock_failed', 'admin_denied', 'admin_totp_ratelimited', 'csrf_block', 'login_banned')");
    return q(`SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
              ORDER BY a.id DESC LIMIT ${limit}`).all(...args);
  };
  admin.get('/audit2', (req, res) => {
    res.json({
      entries: auditRows(req, 300).map((r) => ({ id: r.id, at: r.at, username: r.username, userId: r.user_id, ip: r.ip, action: r.action, details: r.details })),
      actions: q('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC').all(),
    });
  });
  admin.get('/audit.csv', (req, res) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['id,time,user,ip,action,details', ...auditRows(req, 20000).map((r) => [r.id, new Date(r.at).toISOString(), r.username, r.ip, r.action, r.details].map(esc).join(','))];
    log(req, 'admin_audit_export');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="limochat-audit-${dayKey(now())}.csv"`);
    res.send(`﻿${lines.join('\n')}`);
  });

  // ---------------------------------------------------------------- backup & server

  admin.get('/backup', (req, res) => {
    const file = path.join(config.dataDir, `backup-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    } catch (e) {
      console.error('backup', e);
      return res.status(500).json({ error: 'backup_failed' });
    }
    log(req, 'admin_backup', { bytes: fs.statSync(file).size });
    res.download(file, `limochat-${dayKey(now())}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  admin.get('/server2', (req, res) => {
    const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
    const dbFile = path.join(config.dataDir, 'limoninior.db');
    let mediaFiles = 0;
    try { mediaFiles = fs.readdirSync(path.join(config.dataDir, 'media')).length; } catch { /* no dir */ }
    res.json({ db: size(dbFile) + size(`${dbFile}-wal`), mediaFiles, cpus: os.cpus().length, platform: `${os.type()} ${os.release()}`, hostname: os.hostname() });
  });
}
