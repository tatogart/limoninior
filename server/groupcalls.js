// Group calls: a mesh of WebRTC connections (every participant ↔ every participant),
// signaling relayed over Socket.IO. Rooms belong to a group chat or to an invite link.
import crypto from 'node:crypto';
import { db, q, now } from './db.js';
import { emitToChat } from './realtime.js';

export const MAX_PEERS = 8;

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

export function roomSummary(room) {
  if (!room) return null;
  const users = [...new Set([...room.peers.values()].map((p) => p.userId))];
  return { roomId: room.id, count: users.length, users: users.slice(0, 8), video: room.video, startedAt: room.startedAt, startedBy: room.createdBy };
}
export const activeRoomForChat = (chatId) => roomSummary(rooms.get(roomByChat.get(chatId)));
export const userInGroupCall = (userId) => [...rooms.values()].some((r) => [...r.peers.values()].some((p) => p.userId === userId));

function chatUpdate(room, extra = {}) {
  if (room.chatId) emitToChat(room.chatId, 'gc:chat', { chatId: room.chatId, call: rooms.has(room.id) ? roomSummary(room) : null, ...extra });
}

function createRoom({ chatId = null, token = null, title = '', video = false, userId }) {
  const room = { id: crypto.randomUUID(), chatId, token, title, video, createdBy: userId, startedAt: Date.now(), peers: new Map(), peak: 0, msgId: null };
  rooms.set(room.id, room);
  if (chatId) roomByChat.set(chatId, room.id);
  if (token) roomByToken.set(token, room.id);
  return room;
}

function endRoom(room) {
  if (!rooms.has(room.id)) return;
  rooms.delete(room.id);
  if (room.chatId && roomByChat.get(room.chatId) === room.id) roomByChat.delete(room.chatId);
  if (room.token && roomByToken.get(room.token) === room.id) roomByToken.delete(room.token);
  if (room.chatId) {
    chatUpdate(room);
    try { hooks.onEnd(room, Math.round((Date.now() - room.startedAt) / 1000)); } catch (e) { console.error(e); }
  }
}

function isChatMember(chatId, userId) {
  return !!q("SELECT 1 FROM chat_members cm JOIN chats c ON c.id = cm.chat_id WHERE cm.chat_id = ? AND cm.user_id = ? AND c.type = 'group'").get(chatId, userId);
}

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

export function registerGroupCallHandlers(io, socket, userId, { inOneToOne }) {
  const reply = (ack, data) => typeof ack === 'function' && ack(data);
  const peersOf = (room) => [...room.peers.entries()].map(([sid, p]) => ({ sid, userId: p.userId, mic: p.mic, cam: p.cam }));

  function leave() {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    socketRoom.delete(socket.id);
    socket.leave(`gc:${roomId}`);
    const room = rooms.get(roomId);
    if (!room) return;
    room.peers.delete(socket.id);
    io.to(`gc:${roomId}`).emit('gc:peer-left', { roomId, sid: socket.id });
    if (!room.peers.size) endRoom(room);
    else chatUpdate(room);
  }

  socket.on('gc:start', (p, ack) => {
    const chatId = Number(p?.chatId);
    if (!Number.isInteger(chatId) || !isChatMember(chatId, userId)) return reply(ack, { error: 'not_found' });
    const existing = rooms.get(roomByChat.get(chatId));
    if (existing) return reply(ack, { roomId: existing.id });
    const chat = q('SELECT title FROM chats WHERE id = ?').get(chatId);
    const room = createRoom({ chatId, title: chat?.title || '', video: !!p?.video, userId });
    try { room.msgId = hooks.onStart(room, userId); } catch (e) { console.error(e); }
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
    if (socketRoom.get(socket.id) === room.id) return reply(ack, { roomId: room.id, title: room.title, chatId: room.chatId, token: room.token, peers: peersOf(room).filter((x) => x.sid !== socket.id), sid: socket.id });
    if (room.peers.size >= MAX_PEERS) return reply(ack, { error: 'room_full' });
    leave();
    room.peers.set(socket.id, { userId, mic: !!p?.mic, cam: !!p?.cam, joinedAt: Date.now() });
    room.peak = Math.max(room.peak, room.peers.size);
    socketRoom.set(socket.id, room.id);
    socket.join(`gc:${room.id}`);
    socket.to(`gc:${room.id}`).emit('gc:peer-joined', { roomId: room.id, sid: socket.id, userId, mic: !!p?.mic, cam: !!p?.cam });
    chatUpdate(room);
    reply(ack, { roomId: room.id, title: room.title, chatId: room.chatId, token: room.token, peers: peersOf(room).filter((x) => x.sid !== socket.id), sid: socket.id });
  });

  socket.on('gc:signal', (p) => {
    const roomId = socketRoom.get(socket.id);
    const to = String(p?.to || '');
    if (!roomId || socketRoom.get(to) !== roomId) return;
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
    socket.to(`gc:${room.id}`).emit('gc:peer-state', { sid: socket.id, mic: me.mic, cam: me.cam });
  });

  socket.on('gc:leave', leave);
  socket.on('disconnect', leave);
}
