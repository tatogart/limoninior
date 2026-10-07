import { Server } from 'socket.io';
import { config } from './config.js';
import { q, now } from './db.js';
import { sessionFromCookie } from './auth.js';

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
  emitToUsers(contactsOf(userId), 'presence', { userId, online: isOn, lastSeen });
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
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
      if (!q('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId)) return;
      emitToChat(chatId, 'typing', { chatId, userId }, userId);
    });

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
