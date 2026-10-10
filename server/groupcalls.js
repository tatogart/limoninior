// Group calls: a mesh of WebRTC connections (every participant ↔ every participant),
// signaling relayed over Socket.IO. Rooms belong to a group chat or to an invite link.
import crypto from 'node:crypto';
import { db, q, now } from './db.js';
import { emitToChat } from './realtime.js';

export const MAX_PEERS = 8;
export const MAX_VIEWERS = 50; // live streams: the host uploads to each viewer
const LIVE_REACTIONS = new Set(['❤️', '🔥', '👍', '😂', '😮', '👏', '🎉', '🍋']);

db.exec(`
  CREATE TABLE IF NOT EXISTS call_links (
    token      TEXT PRIMARY KEY,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`);

const rooms = new Map(); // roomId -> room
const roomByChat = new Map(); // chatId -> roomId
const roomByToken = new Map(); // token -> roomId
const socketRoom = new Map(); // socketId -> roomId

let hooks = { onStart() { return null; }, onEnd() {} };
export function setGroupCallHooks(h) { hooks = { ...hooks, ...h }; }

const TOKEN_RE = /^[A-Za-z0-9_-]{10,40}$/;

let ioRef = null;

export function roomSummary(room) {
  if (!room) return null;
  // Live streams: viewers stay anonymous, only hosts are listed.
  const users = [...new Set([...room.peers.values()].filter((p) => !room.live || p.host).map((p) => p.userId))];
  if (room.live) return { roomId: room.id, count: room.peers.size, users: users.slice(0, 8), video: room.video, live: true, startedAt: room.startedAt, startedBy: room.createdBy };
  return { roomId: room.id, count: users.length, users: users.slice(0, 8), video: room.video, live: !!room.live, startedAt: room.startedAt, startedBy: room.createdBy };
}
export const activeRoomForChat = (chatId) => roomSummary(rooms.get(roomByChat.get(chatId)));
export const userInGroupCall = (userId) => [...rooms.values()].some((r) => [...r.peers.values()].some((p) => p.userId === userId));

function chatUpdate(room, extra = {}) {
  if (room.chatId) emitToChat(room.chatId, 'gc:chat', { chatId: room.chatId, call: rooms.has(room.id) ? roomSummary(room) : null, ...extra });
}

function createRoom({ chatId = null, token = null, title = '', video = false, live = false, userId }) {
  const room = { id: crypto.randomUUID(), chatId, token, title, video, live, createdBy: userId, startedAt: Date.now(), peers: new Map(), peak: 0, msgId: null };
  rooms.set(room.id, room);
  if (chatId) roomByChat.set(chatId, room.id);
  if (token) roomByToken.set(token, room.id);
  return room;
}

function endRoom(room) {
  if (!rooms.has(room.id)) return;
  clearTimeout(room.emptyTimer);
  rooms.delete(room.id);
  if (room.chatId && roomByChat.get(room.chatId) === room.id) roomByChat.delete(room.chatId);
  if (room.token && roomByToken.get(room.token) === room.id) roomByToken.delete(room.token);
  if (room.chatId) {
    chatUpdate(room);
    try { hooks.onEnd(room, Math.round((Date.now() - room.startedAt) / 1000)); } catch (e) { console.error(e); }
  }
}

/** Membership row for a group or channel: { type, role } or null. */
function membership(chatId, userId) {
  return q("SELECT c.type, cm.role FROM chat_members cm JOIN chats c ON c.id = cm.chat_id WHERE cm.chat_id = ? AND cm.user_id = ? AND c.type IN ('group', 'channel')").get(chatId, userId) || null;
}
const isChatMember = (chatId, userId) => !!membership(chatId, userId);
const isChannelStaff = (chatId, userId) => { const m = membership(chatId, userId); return m?.type === 'channel' && (m.role === 'owner' || m.role === 'admin'); };

/** Resolve a room the user may enter (by room id or link token). */
function accessibleRoom({ roomId, token }, userId) {
  if (token) {
    const t = String(token);
    if (!TOKEN_RE.test(t)) return { error: 'not_found' };
    const link = q('SELECT * FROM call_links WHERE token = ?').get(t);
    if (!link) return { error: 'not_found' };
    return { room: rooms.get(roomByToken.get(t)) || null, link };
  }
  const room = rooms.get(String(roomId || ''));
  if (!room) return { error: 'call_ended' };
  if (room.chatId && !isChatMember(room.chatId, userId)) return { error: 'not_found' };
  if (room.token) return { room, link: q('SELECT * FROM call_links WHERE token = ?').get(room.token) };
  return { room };
}

/** Remove a socket from its room without the socket's own handler (kicks, chat deletion). */
function forceLeave(sid) {
  const roomId = socketRoom.get(sid);
  if (!roomId) return;
  socketRoom.delete(sid);
  const sock = ioRef?.sockets.sockets.get(sid);
  sock?.leave(`gc:${roomId}`);
  sock?.emit('gc:ended', { roomId });
  const room = rooms.get(roomId);
  if (!room) return;
  const was = room.peers.get(sid);
  room.peers.delete(sid);
  if (room.live && was?.host && ![...room.peers.values()].some((x) => x.host)) return stopLive(ioRef, room);
  ioRef?.to(`gc:${roomId}`).emit('gc:peer-left', { roomId, sid });
  if (!room.peers.size) endRoom(room);
  else chatUpdate(room);
}

/** A user left / was removed from a chat (userId null = chat deleted): drop them from its call. */
export function kickFromChatCall(chatId, userId) {
  const room = rooms.get(roomByChat.get(chatId));
  if (!room) return;
  for (const [sid, p] of [...room.peers]) if (userId == null || p.userId === userId) forceLeave(sid);
  if (userId == null && rooms.has(room.id)) endRoom(room);
}

/** Live stream over: tell every viewer, then close the room. */
function stopLive(io, room) {
  io.to(`gc:${room.id}`).emit('gc:ended', { roomId: room.id });
  for (const sid of room.peers.keys()) {
    socketRoom.delete(sid);
    io.sockets.sockets.get(sid)?.leave(`gc:${room.id}`);
  }
  room.peers.clear();
  endRoom(room);
}

export function registerGroupCallHandlers(io, socket, userId, { inOneToOne }) {
  ioRef = io;
  const reply = (ack, data) => typeof ack === 'function' && ack(data);
  const view = (sid, p) => ({ sid, userId: p.userId, mic: p.mic, cam: p.cam, screen: !!p.screen, host: !!p.host });
  // In a live stream viewers only connect to hosts (not to each other).
  const peersOf = (room, me) => [...room.peers.entries()]
    .filter(([sid, p]) => sid !== socket.id && (!room.live || me?.host || p.host))
    .map(([sid, p]) => view(sid, p));

  function leave() {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    socketRoom.delete(socket.id);
    socket.leave(`gc:${roomId}`);
    const room = rooms.get(roomId);
    if (!room) return;
    const was = room.peers.get(socket.id);
    room.peers.delete(socket.id);
    if (room.live && was?.host && ![...room.peers.values()].some((x) => x.host)) return stopLive(io, room);
    io.to(`gc:${roomId}`).emit('gc:peer-left', { roomId, sid: socket.id });
    if (!room.peers.size) endRoom(room);
    else {
      chatUpdate(room);
      if (room.live) io.to(`gc:${roomId}`).emit('gc:viewers', { roomId, count: room.peers.size });
    }
  }

  socket.on('gc:start', (p, ack) => {
    const chatId = Number(p?.chatId);
    const m = Number.isInteger(chatId) ? membership(chatId, userId) : null;
    if (!m) return reply(ack, { error: 'not_found' });
    if (inOneToOne(userId)) return reply(ack, { error: 'busy_self' });
    // Channels: only the owner / admins can go live.
    if (m.type === 'channel' && !isChannelStaff(chatId, userId)) return reply(ack, { error: 'forbidden' });
    const existing = rooms.get(roomByChat.get(chatId));
    if (existing) return reply(ack, { roomId: existing.id });
    const chat = q('SELECT title FROM chats WHERE id = ?').get(chatId);
    const room = createRoom({ chatId, title: chat?.title || '', video: !!p?.video, live: m.type === 'channel', userId });
    try { room.msgId = hooks.onStart(room, userId); } catch (e) { console.error(e); }
    // Nobody joined (permission prompt cancelled, tab closed…): don't leave a phantom call.
    room.emptyTimer = setTimeout(() => { if (rooms.has(room.id) && !room.peers.size) endRoom(room); }, 45_000);
    chatUpdate(room, { started: true, starterName: q('SELECT name FROM users WHERE id = ?').get(userId)?.name || '' });
    reply(ack, { roomId: room.id });
  });

  socket.on('gc:link', (p, ack) => {
    if (q('SELECT COUNT(*) AS n FROM call_links WHERE creator_id = ? AND created_at > ?').get(userId, now() - 3600_000).n >= 20) return reply(ack, { error: 'too_many' });
    const token = crypto.randomBytes(12).toString('base64url');
    const title = String(p?.title || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64);
    q('INSERT INTO call_links (token, creator_id, title, created_at) VALUES (?, ?, ?, ?)').run(token, userId, title, now());
    reply(ack, { token, title });
  });

  socket.on('gc:info', (p, ack) => {
    const r = accessibleRoom(p || {}, userId);
    if (r.error) return reply(ack, { error: r.error });
    const creator = r.link ? q('SELECT name FROM users WHERE id = ?').get(r.link.creator_id) : null;
    reply(ack, {
      live: !!r.room?.live,
      title: r.room?.title || r.link?.title || '',
      chatId: r.room?.chatId || null,
      creator: creator?.name || null,
      call: roomSummary(r.room),
    });
  });

  socket.on('gc:join', (p, ack) => {
    if (inOneToOne(userId)) return reply(ack, { error: 'busy_self' });
    const r = accessibleRoom(p || {}, userId);
    if (r.error) return reply(ack, { error: r.error });
    let room = r.room;
    if (!room && r.link) room = createRoom({ token: r.link.token, title: r.link.title, video: !!p?.cam, userId });
    const host = room.live ? isChannelStaff(room.chatId, userId) : true;
    const answer = (me) => reply(ack, { roomId: room.id, title: room.title, chatId: room.chatId, token: room.token, live: !!room.live, host, peers: peersOf(room, me), sid: socket.id });
    if (socketRoom.get(socket.id) === room.id) return answer(room.peers.get(socket.id));
    if (room.live ? room.peers.size >= MAX_VIEWERS : room.peers.size >= MAX_PEERS) return reply(ack, { error: 'room_full' });
    leave();
    const me = { userId, host, mic: host && !!p?.mic, cam: host && !!p?.cam, joinedAt: Date.now() };
    room.peers.set(socket.id, me);
    clearTimeout(room.emptyTimer);
    room.peak = Math.max(room.peak, room.peers.size);
    socketRoom.set(socket.id, room.id);
    socket.join(`gc:${room.id}`);
    const joined = { roomId: room.id, ...view(socket.id, me) };
    if (room.live && !host) {
      // Only hosts need to connect to a new viewer; everyone else just sees the counter.
      for (const [sid, x] of room.peers) if (x.host && sid !== socket.id) io.to(sid).emit('gc:peer-joined', joined);
    } else socket.to(`gc:${room.id}`).emit('gc:peer-joined', joined);
    chatUpdate(room);
    if (room.live) io.to(`gc:${room.id}`).emit('gc:viewers', { roomId: room.id, count: room.peers.size });
    answer(me);
  });

  socket.on('gc:signal', (p) => {
    const roomId = socketRoom.get(socket.id);
    const to = String(p?.to || '');
    if (!roomId || socketRoom.get(to) !== roomId) return;
    const room = rooms.get(roomId);
    if (room?.live && !room.peers.get(socket.id)?.host && !room.peers.get(to)?.host) return;
    let size = 0;
    try { size = JSON.stringify(p.data).length; } catch { return; }
    if (size > 20_000) return;
    io.to(to).emit('gc:signal', { from: socket.id, userId, data: p.data });
  });

  socket.on('gc:state', (p) => {
    const room = rooms.get(socketRoom.get(socket.id));
    const me = room?.peers.get(socket.id);
    if (!me) return;
    me.mic = !!p?.mic;
    me.cam = !!p?.cam;
    me.screen = !!p?.screen;
    socket.to(`gc:${room.id}`).emit('gc:peer-state', { sid: socket.id, mic: me.mic, cam: me.cam, screen: me.screen });
  });

  // Host ends the live stream for everybody.
  socket.on('gc:end', () => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (room?.live && room.peers.get(socket.id)?.host) stopLive(io, room);
  });

  // Flying reactions during a live stream (rate-limited per socket).
  let lastReact = 0;
  socket.on('gc:react', (p) => {
    const room = rooms.get(socketRoom.get(socket.id));
    const emoji = String(p?.emoji || '');
    const t = Date.now();
    if (!room?.live || !LIVE_REACTIONS.has(emoji) || t - lastReact < 300) return;
    lastReact = t;
    io.to(`gc:${room.id}`).emit('gc:react', { roomId: room.id, emoji });
  });

  socket.on('gc:leave', leave);
  socket.on('disconnect', leave);
}
