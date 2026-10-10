import crypto from 'node:crypto';
import { Server } from 'socket.io';
import { config } from './config.js';
import { q, now } from './db.js';
import { sessionFromCookie } from './auth.js';
import proxyaddr from 'proxy-addr';
import { getPrefs } from './prefs.js';
import { normIp, isIpBanned, trackIp } from './ipban.js';
import { blockedBetween } from './db.js';
import { registerGroupCallHandlers, userInGroupCall } from './groupcalls.js';

let io = null;
const online = new Map(); // userId -> number of open sockets

export const isOnline = (userId) => online.has(userId);

export function emitToUser(userId, event, data) {
  io?.to(`u:${userId}`).emit(event, data);
}

export function emitToUsers(userIds, event, data) {
  if (!io || !userIds.length) return;
  io.to(userIds.map((id) => `u:${id}`)).emit(event, data);
}

export function memberIds(chatId) {
  return q('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId).map((r) => r.user_id);
}

export function emitToChat(chatId, event, data, exceptUserId = null) {
  emitToUsers(memberIds(chatId).filter((id) => id !== exceptUserId), event, data);
}

export function disconnectUser(userId) {
  io?.in(`u:${userId}`).disconnectSockets(true);
}

export async function disconnectIp(ip) {
  if (!io) return;
  for (const s of await io.fetchSockets()) if (s.data.ip === ip) s.disconnect(true);
}

export function disconnectSession(sessionId) {
  io?.in(`s:${sessionId}`).disconnectSockets(true);
}

function contactsOf(userId) {
  return q(`SELECT DISTINCT m2.user_id AS id FROM chat_members m1
            JOIN chat_members m2 ON m2.chat_id = m1.chat_id
            WHERE m1.user_id = ? AND m2.user_id != ?`).all(userId, userId).map((r) => r.id);
}

function broadcastPresence(userId, isOn) {
  const lastSeen = now();
  q('UPDATE users SET last_seen = ? WHERE id = ?').run(lastSeen, userId);
  if (getPrefs(q('SELECT prefs FROM users WHERE id = ?').get(userId)).lastSeen === 'nobody') return;
  emitToUsers(contactsOf(userId), 'presence', { userId, online: isOn, lastSeen });
}

// ---------- 1:1 calls (WebRTC signaling) ----------

const calls = new Map(); // callId -> call
const userCall = new Map(); // userId -> callId
let callHooks = { onInvite() {}, onEnd() {} };
export function setCallHooks(h) { callHooks = { ...callHooks, ...h }; }

function endCall(call, status) {
  if (!calls.has(call.id)) return;
  clearTimeout(call.timer);
  calls.delete(call.id);
  if (userCall.get(call.from) === call.id) userCall.delete(call.from);
  if (userCall.get(call.to) === call.id) userCall.delete(call.to);
  emitToUsers([call.from, call.to], 'call:ended', { callId: call.id, status });
  const duration = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
  try { callHooks.onEnd({ ...call, status, duration }); } catch (e) { console.error(e); }
}

function registerCallHandlers(socket, userId) {
  const reply = (ack, data) => typeof ack === 'function' && ack(data);
  const own = (callId) => {
    const c = calls.get(String(callId || ''));
    return c && (c.from === userId || c.to === userId) ? c : null;
  };

  socket.on('call:invite', (p, ack) => {
    const chatId = Number(p?.chatId);
    const chat = Number.isInteger(chatId) && q("SELECT * FROM chats WHERE id = ? AND type = 'private'").get(chatId);
    const peer = chat && q('SELECT u.* FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND cm.user_id != ?').get(chatId, userId);
    if (!chat || !peer || !q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId)) return reply(ack, { error: 'not_found' });
    if (peer.banned || String(peer.google_sub).startsWith('system:')) return reply(ack, { error: 'unavailable' });
    // Callee's privacy: who may call them.
    const who = getPrefs(peer).calls;
    const isContact = !!q('SELECT 1 FROM messages WHERE chat_id = ? AND sender_id = ? LIMIT 1').get(chatId, peer.id);
    if (who === 'nobody' || (who === 'contacts' && !isContact)) return reply(ack, { error: 'calls_disabled' });
    if (blockedBetween(userId, peer.id)) return reply(ack, { error: 'calls_disabled' });
    if (userCall.has(userId) || userInGroupCall(userId)) return reply(ack, { error: 'busy_self' });
    const call = {
      id: crypto.randomUUID(), chatId, from: userId, to: peer.id, video: !!p?.video,
      callerSocket: socket.id, calleeSocket: null, startedAt: 0, createdAt: Date.now(),
    };
    if (userCall.has(peer.id) || userInGroupCall(peer.id)) {
      try { callHooks.onEnd({ ...call, status: 'busy', duration: 0 }); } catch { /* ignore */ }
      return reply(ack, { error: 'busy' });
    }
    calls.set(call.id, call);
    userCall.set(userId, call.id);
    userCall.set(peer.id, call.id);
    call.timer = setTimeout(() => endCall(call, 'missed'), 45_000);
    emitToUser(peer.id, 'call:incoming', { callId: call.id, chatId, from: userId, video: call.video });
    try { callHooks.onInvite(call); } catch (e) { console.error(e); }
    reply(ack, { callId: call.id });
  });

  socket.on('call:accept', (p) => {
    const c = own(p?.callId);
    if (!c || c.to !== userId || c.startedAt) return;
    clearTimeout(c.timer);
    c.calleeSocket = socket.id;
    c.startedAt = Date.now();
    io.to(c.callerSocket).emit('call:accepted', { callId: c.id });
    // Stop ringing on the callee's other devices.
    io.to(`u:${userId}`).except(socket.id).emit('call:ended', { callId: c.id, status: 'elsewhere' });
  });

  socket.on('call:reject', (p) => {
    const c = own(p?.callId);
    if (c && c.to === userId && !c.startedAt) endCall(c, 'declined');
  });

  socket.on('call:end', (p) => {
    const c = own(p?.callId);
    if (c) endCall(c, c.startedAt ? 'ended' : c.from === userId ? 'cancelled' : 'declined');
  });

  socket.on('call:signal', (p) => {
    const c = own(p?.callId);
    if (!c || !c.calleeSocket) return;
    let data;
    try { data = JSON.stringify(p.data); } catch { return; }
    if (!data || data.length > 20_000) return;
    const target = socket.id === c.callerSocket ? c.calleeSocket : socket.id === c.calleeSocket ? c.callerSocket : null;
    if (target) io.to(target).emit('call:signal', { callId: c.id, data: p.data });
  });

  socket.on('call:state', (p) => {
    // Mic / camera toggles shown on the other side.
    const c = own(p?.callId);
    if (!c) return;
    const target = socket.id === c.callerSocket ? c.calleeSocket : c.callerSocket;
    if (target) io.to(target).emit('call:state', { callId: c.id, mic: !!p.mic, cam: !!p.cam });
  });

  socket.on('disconnect', () => {
    for (const c of calls.values()) {
      if (c.callerSocket === socket.id) endCall(c, c.startedAt ? 'ended' : 'cancelled');
      else if (c.calleeSocket === socket.id) endCall(c, 'ended');
    }
  });
}

/** Whether a given session currently has an open socket. */
export function sessionOnline(sessionId) {
  return !!io?.sockets.adapter.rooms.get(`s:${sessionId}`)?.size;
}

export function initRealtime(httpServer, trustFn) {
  io = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: { origin: config.appOrigin, credentials: true },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || origin === config.appOrigin);
    },
  });

  io.use((socket, next) => {
    const r = sessionFromCookie(socket.request.headers.cookie);
    if (!r || !r.user.username) return next(new Error('unauthorized'));
    const ip = normIp(trustFn ? proxyaddr(socket.request, trustFn) : socket.handshake.address);
    if (isIpBanned(ip)) return next(new Error('ip_banned'));
    trackIp(r.user.id, ip);
    socket.data.ip = ip;
    socket.data.userId = r.user.id;
    socket.data.sessionId = r.session.id;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join([`u:${userId}`, `s:${socket.data.sessionId}`]);
    const n = (online.get(userId) || 0) + 1;
    online.set(userId, n);
    if (n === 1) broadcastPresence(userId, true);

    // Simple per-socket flood guard for typing events.
    let lastTyping = 0;
    socket.on('typing', (payload) => {
      const chatId = Number(payload?.chatId);
      const t = Date.now();
      if (!Number.isInteger(chatId) || t - lastTyping < 1500) return;
      lastTyping = t;
      const ok = q(`SELECT 1 FROM chat_members cm JOIN chats c ON c.id = cm.chat_id
                    WHERE cm.chat_id = ? AND cm.user_id = ? AND c.type != 'channel'`).get(chatId, userId);
      if (!ok) return;
      emitToChat(chatId, 'typing', { chatId, userId }, userId);
    });

    registerCallHandlers(socket, userId);
    registerGroupCallHandlers(io, socket, userId, { inOneToOne: (id) => userCall.has(id) });
    // App opened from a call push: deliver the still-ringing call.
    for (const c of calls.values()) {
      if (c.to === userId && !c.startedAt) socket.emit('call:incoming', { callId: c.id, chatId: c.chatId, from: c.from, video: c.video });
    }

    socket.on('disconnect', () => {
      const left = (online.get(userId) || 1) - 1;
      if (left <= 0) {
        online.delete(userId);
        broadcastPresence(userId, false);
      } else {
        online.set(userId, left);
      }
    });
  });

  return io;
}
