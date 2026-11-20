// Communities (like Discord servers / Telegram communities): one invite link, shared members and roles,
// and inside — text chats, announcement channels and voice rooms. Every channel is an ordinary chat
// (group or channel) tagged with community_id, so messages, calls and pushes work as everywhere else.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { q, now, tx, audit } from './db.js';
import { upload, saveImage, deleteMediaFile } from './media.js';
import { emitToUser, emitToUsers } from './realtime.js';
import { kickFromChatCall } from './groupcalls.js';

export const KINDS = ['text', 'news', 'voice'];
const MAX_OWNED = 10;
const MAX_CHANNELS = 50;
const MAX_MEMBERS = 10_000;
const ROLE_RANK = { member: 0, admin: 1, owner: 2 };
const mediaUrl = (n) => (n ? `/media/${n}` : null);
const newToken = () => crypto.randomBytes(9).toString('base64url');
const chatType = (kind) => (kind === 'news' ? 'channel' : 'group');

export const communityRole = (cid, uid) => q('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?').get(cid, uid)?.role || null;
const isStaff = (role) => role === 'owner' || role === 'admin';
const channelRows = (cid) => q('SELECT id, title, ckind, position FROM chats WHERE community_id = ? ORDER BY position, id').all(cid);
const memberIdsOf = (cid) => q('SELECT user_id FROM community_members WHERE community_id = ?').all(cid).map((r) => r.user_id);

export function serializeCommunity(c, userId) {
  const role = communityRole(c.id, userId);
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    avatar: mediaUrl(c.avatar),
    ownerId: c.owner_id,
    role,
    membersCount: q('SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?').get(c.id).n,
    inviteToken: role ? c.invite_token : undefined, // any member may invite friends, like in Discord
    channels: channelRows(c.id).map((r) => ({ id: r.id, title: r.title, kind: r.ckind || 'text', position: r.position })),
    createdAt: c.created_at,
  };
}

function preview(c, userId) {
  return {
    id: c.id, title: c.title, description: c.description, avatar: mediaUrl(c.avatar),
    membersCount: q('SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?').get(c.id).n,
    channelsCount: channelRows(c.id).length,
    joined: !!communityRole(c.id, userId),
  };
}

export function registerCommunities(api, h) {
  const { bad, int, clean, chatForUser, pushChat, systemMessage, deleteChat, publicUser } = h;
  const limiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });
  const joinLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `u${req.user?.id}` });

  /** Tell every member (each with their own role-dependent view). */
  function pushCommunity(cid) {
    const c = q('SELECT * FROM communities WHERE id = ?').get(cid);
    if (!c) return;
    for (const uid of memberIdsOf(cid)) emitToUser(uid, 'community', serializeCommunity(c, uid));
  }

  /** Put a user into every channel of the community with the matching role. */
  function syncMember(cid, uid, role) {
    for (const ch of channelRows(cid)) {
      const last = q('SELECT last_msg_id FROM chats WHERE id = ?').get(ch.id).last_msg_id;
      q(`INSERT INTO chat_members (chat_id, user_id, role, joined_at, last_read_id) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, user_id) DO UPDATE SET role = excluded.role`).run(ch.id, uid, role, now(), last);
    }
  }

  function dropMember(cid, uid) {
    const chans = channelRows(cid);
    q('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(cid, uid);
    for (const ch of chans) {
      q('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(ch.id, uid);
      kickFromChatCall(ch.id, uid);
      emitToUser(uid, 'chat:removed', { chatId: ch.id });
    }
    emitToUser(uid, 'community:removed', { communityId: cid });
  }

  function destroy(c) {
    const members = memberIdsOf(c.id);
    for (const ch of channelRows(c.id)) deleteChat(ch.id);
    deleteMediaFile(c.avatar);
    q('DELETE FROM communities WHERE id = ?').run(c.id);
    emitToUsers(members, 'community:removed', { communityId: c.id });
  }

  function createChannel(c, kind, title, creatorId) {
    const pos = (q('SELECT MAX(position) AS m FROM chats WHERE community_id = ?').get(c.id).m || 0) + 1;
    const r = q('INSERT INTO chats (type, title, owner_id, created_at, community_id, position, ckind) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(chatType(kind), title, c.owner_id ?? creatorId, now(), c.id, pos, kind);
    const id = Number(r.lastInsertRowid);
    for (const m of q('SELECT user_id, role FROM community_members WHERE community_id = ?').all(c.id)) {
      q('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, m.user_id, m.role, now());
    }
    return id;
  }

  /** Load the community and check the caller's role ('member' | 'admin' | 'owner' minimum). */
  function load(req, res, need = 'member') {
    const c = int(req.params.id) && q('SELECT * FROM communities WHERE id = ?').get(int(req.params.id));
    const role = c && communityRole(c.id, req.user.id);
    if (!c || !role) { bad(res, 'not_found', 404); return null; }
    if (ROLE_RANK[role] < ROLE_RANK[need]) { bad(res, 'forbidden', 403); return null; }
    return { c, role };
  }

  const sendFresh = (res, cid, uid, extra = {}) =>
    res.json({ community: serializeCommunity(q('SELECT * FROM communities WHERE id = ?').get(cid), uid), ...extra });
  const chatsOf = (cid, uid) => channelRows(cid).map((ch) => chatForUser(ch.id, uid)).filter(Boolean);

  api.get('/communities', (req, res) => {
    const rows = q(`SELECT c.* FROM communities c JOIN community_members m ON m.community_id = c.id AND m.user_id = ?
                    ORDER BY m.joined_at`).all(req.user.id);
    res.json({ communities: rows.map((c) => serializeCommunity(c, req.user.id)) });
  });

  api.post('/communities', limiter, (req, res) => {
    const title = clean(req.body?.title, 64);
    if (!title) return bad(res, 'bad_title');
    if (q('SELECT COUNT(*) AS n FROM communities WHERE owner_id = ?').get(req.user.id).n >= MAX_OWNED) return bad(res, 'too_many_communities');
    const description = clean(req.body?.description, 255);
    const id = tx(() => {
      const r = q('INSERT INTO communities (owner_id, title, description, invite_token, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, title, description, newToken(), now());
      const cid = Number(r.lastInsertRowid);
      q("INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(cid, req.user.id, now());
      const c = q('SELECT * FROM communities WHERE id = ?').get(cid);
      createChannel(c, 'news', 'объявления', req.user.id);
      createChannel(c, 'text', 'общий', req.user.id);
      createChannel(c, 'voice', 'Голосовой', req.user.id);
      return cid;
    });
    const general = channelRows(id).find((ch) => ch.ckind === 'text');
    if (general) systemMessage(general.id, `${req.user.name} создаёт сообщество «${title}»`);
    audit(req.user.id, req.ip, 'community_create', { communityId: id });
    sendFresh(res, id, req.user.id, { chats: chatsOf(id, req.user.id) });
  });

  api.get('/communities/invite/:token', (req, res) => {
    const c = q('SELECT * FROM communities WHERE invite_token = ?').get(String(req.params.token || ''));
    if (!c) return bad(res, 'not_found', 404);
    res.json({ community: preview(c, req.user.id) });
  });

  api.post('/communities/invite/:token/join', joinLimiter, (req, res) => {
    const c = q('SELECT * FROM communities WHERE invite_token = ?').get(String(req.params.token || ''));
    if (!c) return bad(res, 'not_found', 404);
    if (q('SELECT 1 FROM community_bans WHERE community_id = ? AND user_id = ?').get(c.id, req.user.id)) return bad(res, 'banned_here', 403);
    if (!communityRole(c.id, req.user.id)) {
      if (q('SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?').get(c.id).n >= MAX_MEMBERS) return bad(res, 'community_full');
      tx(() => {
        q("INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(c.id, req.user.id, now());
        syncMember(c.id, req.user.id, 'member');
      });
      pushCommunity(c.id);
    }
    sendFresh(res, c.id, req.user.id, { chats: chatsOf(c.id, req.user.id) });
  });

  api.get('/communities/:id', (req, res) => {
    const r = load(req, res);
    if (r) sendFresh(res, r.c.id, req.user.id);
  });

  api.patch('/communities/:id', (req, res) => {
    const r = load(req, res, 'admin');
    if (!r) return;
    const title = req.body?.title !== undefined ? clean(req.body.title, 64) : r.c.title;
    const description = req.body?.description !== undefined ? clean(req.body.description, 255) : r.c.description;
    if (!title) return bad(res, 'bad_title');
    q('UPDATE communities SET title = ?, description = ? WHERE id = ?').run(title, description, r.c.id);
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id);
  });

  api.post('/communities/:id/avatar', upload.single('file'), (req, res) => {
    const r = load(req, res, 'admin');
    if (!r) return;
    const img = saveImage(req.file, { ownerId: req.user.id, kind: 'avatar', maxBytes: 5 * 1024 * 1024 });
    q('UPDATE communities SET avatar = ? WHERE id = ?').run(img.name, r.c.id);
    deleteMediaFile(r.c.avatar);
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id);
  });

  api.delete('/communities/:id', (req, res) => {
    const r = load(req, res, 'owner');
    if (!r) return;
    destroy(r.c);
    audit(req.user.id, req.ip, 'community_delete', { communityId: r.c.id });
    res.json({ ok: true });
  });

  api.post('/communities/:id/leave', (req, res) => {
    const r = load(req, res);
    if (!r) return;
    dropMember(r.c.id, req.user.id);
    if (r.role === 'owner') {
      // Hand the community over to the most senior admin, else the oldest member; nobody left — delete it.
      const heir = q(`SELECT user_id FROM community_members WHERE community_id = ?
                      ORDER BY role = 'admin' DESC, joined_at LIMIT 1`).get(r.c.id);
      if (!heir) { destroy(r.c); return res.json({ ok: true }); }
      q("UPDATE community_members SET role = 'owner' WHERE community_id = ? AND user_id = ?").run(r.c.id, heir.user_id);
      q('UPDATE communities SET owner_id = ? WHERE id = ?').run(heir.user_id, r.c.id);
      q('UPDATE chats SET owner_id = ? WHERE community_id = ?').run(heir.user_id, r.c.id);
      syncMember(r.c.id, heir.user_id, 'owner');
      for (const ch of channelRows(r.c.id)) pushChat(ch.id);
    }
    pushCommunity(r.c.id);
    res.json({ ok: true });
  });

  api.post('/communities/:id/invite-reset', (req, res) => {
    const r = load(req, res, 'admin');
    if (!r) return;
    q('UPDATE communities SET invite_token = ? WHERE id = ?').run(newToken(), r.c.id);
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id);
  });

  // ---------- members & roles

  api.get('/communities/:id/members', (req, res) => {
    const r = load(req, res);
    if (!r) return;
    const raw = clean(req.query.q, 64).replace(/^@/, '');
    const like = `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = q(`SELECT u.*, m.role, m.joined_at FROM community_members m JOIN users u ON u.id = m.user_id
                    WHERE m.community_id = ? AND (? = '' OR u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')
                    ORDER BY m.role = 'owner' DESC, m.role = 'admin' DESC, u.name LIMIT 300`).all(r.c.id, raw, like, like);
    res.json({
      total: q('SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?').get(r.c.id).n,
      members: rows.map((u) => ({ ...publicUser(u), role: u.role, joinedAt: u.joined_at })),
    });
  });

  api.patch('/communities/:id/members/:userId', (req, res) => {
    const r = load(req, res, 'owner');
    if (!r) return;
    const uid = int(req.params.userId);
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    const cur = uid && uid !== req.user.id && communityRole(r.c.id, uid);
    if (!cur) return bad(res, 'not_found', 404);
    tx(() => {
      q('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?').run(role, r.c.id, uid);
      syncMember(r.c.id, uid, role);
    });
    for (const ch of channelRows(r.c.id)) emitToUser(uid, 'chat', chatForUser(ch.id, uid));
    pushCommunity(r.c.id);
    res.json({ ok: true, role });
  });

  api.delete('/communities/:id/members/:userId', (req, res) => {
    const r = load(req, res, 'admin');
    if (!r) return;
    const uid = int(req.params.userId);
    const cur = uid && uid !== req.user.id && communityRole(r.c.id, uid);
    if (!cur) return bad(res, 'not_found', 404);
    if (ROLE_RANK[cur] >= ROLE_RANK[r.role]) return bad(res, 'forbidden', 403);
    dropMember(r.c.id, uid);
    if (req.query.ban === '1') q('INSERT OR IGNORE INTO community_bans (community_id, user_id, created_at) VALUES (?, ?, ?)').run(r.c.id, uid, now());
    for (const ch of channelRows(r.c.id)) pushChat(ch.id);
    pushCommunity(r.c.id);
    res.json({ ok: true });
  });

  // ---------- channels

  api.post('/communities/:id/channels', (req, res) => {
    const r = load(req, res, 'admin');
    if (!r) return;
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'text';
    const title = clean(req.body?.title, 48);
    if (!title) return bad(res, 'bad_title');
    if (channelRows(r.c.id).length >= MAX_CHANNELS) return bad(res, 'too_many_channels');
    const id = tx(() => createChannel(r.c, kind, title, req.user.id));
    for (const uid of memberIdsOf(r.c.id)) emitToUser(uid, 'chat', chatForUser(id, uid));
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id, { chat: chatForUser(id, req.user.id) });
  });

  const ownChannel = (r, req, res) => {
    const ch = int(req.params.chatId) && q('SELECT * FROM chats WHERE id = ? AND community_id = ?').get(int(req.params.chatId), r.c.id);
    if (!ch) bad(res, 'not_found', 404);
    return ch;
  };

  api.patch('/communities/:id/channels/:chatId', (req, res) => {
    const r = load(req, res, 'admin');
    const ch = r && ownChannel(r, req, res);
    if (!ch) return;
    const title = clean(req.body?.title, 48);
    if (!title) return bad(res, 'bad_title');
    q('UPDATE chats SET title = ? WHERE id = ?').run(title, ch.id);
    pushChat(ch.id);
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id);
  });

  api.delete('/communities/:id/channels/:chatId', (req, res) => {
    const r = load(req, res, 'admin');
    const ch = r && ownChannel(r, req, res);
    if (!ch) return;
    if (channelRows(r.c.id).length <= 1) return bad(res, 'last_channel');
    deleteChat(ch.id);
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id);
  });

  api.post('/communities/:id/channels/order', (req, res) => {
    const r = load(req, res, 'admin');
    if (!r) return;
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(int);
    const have = new Set(channelRows(r.c.id).map((ch) => ch.id));
    if (ids.length !== have.size || ids.some((id) => !have.has(id))) return bad(res, 'bad_order');
    tx(() => ids.forEach((id, i) => q('UPDATE chats SET position = ? WHERE id = ?').run(i + 1, id)));
    pushCommunity(r.c.id);
    sendFresh(res, r.c.id, req.user.id);
  });
}
