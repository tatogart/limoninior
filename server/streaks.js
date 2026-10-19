// Streaks ("огоньки", like TikTok): two people who message each other every day keep a 🔥 with
// the number of days in a row. Days are counted in Moscow time. Miss a day and it goes out;
// it can be relit once a month for lemons if you're quick.
import { db, q, now } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS streaks (
    chat_id     INTEGER PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    count       INTEGER NOT NULL DEFAULT 0,
    best        INTEGER NOT NULL DEFAULT 0,
    last_day    TEXT,
    days        TEXT NOT NULL DEFAULT '{}',
    restored_at INTEGER NOT NULL DEFAULT 0
  );
`);

export const VISIBLE_FROM = 3; // like TikTok: the flame shows up after 3 days in a row
export const RESTORE_PRICE = 50;
const MILESTONES = new Set([3, 7, 10, 30, 50, 100, 150, 200, 365, 500, 1000]);
const MSK = 3 * 3600_000;
const dayOf = (t) => new Date(t + MSK).toISOString().slice(0, 10);
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const row = (chatId) => q('SELECT * FROM streaks WHERE chat_id = ?').get(chatId);

/** A message was sent in a private chat. Returns the milestone reached (or 0). */
export function trackStreak(chatId, senderId) {
  const today = dayOf(now());
  let s = row(chatId);
  if (!s) { q('INSERT INTO streaks (chat_id) VALUES (?)').run(chatId); s = row(chatId); }
  const days = JSON.parse(s.days || '{}');
  if (days[senderId] === today) return 0;
  days[senderId] = today;
  const members = q('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId).map((r) => r.user_id);
  let { count } = s;
  const both = members.length === 2 && members.every((id) => days[id] === today);
  if (both && s.last_day !== today) {
    count = s.last_day === shift(today, -1) ? count + 1 : 1;
    q('UPDATE streaks SET count = ?, best = MAX(best, ?), last_day = ?, days = ? WHERE chat_id = ?').run(count, count, today, JSON.stringify(days), chatId);
    return MILESTONES.has(count) ? count : 0;
  }
  q('UPDATE streaks SET days = ? WHERE chat_id = ?').run(JSON.stringify(days), chatId);
  return 0;
}

/** What a member of the chat sees. */
export function streakFor(chatId, userId, peerId) {
  const s = row(chatId);
  if (!s || !s.last_day) return null;
  const t = now();
  const today = dayOf(t);
  const yesterday = shift(today, -1);
  const days = JSON.parse(s.days || '{}');
  const alive = s.last_day === today || s.last_day === yesterday;
  const mskHour = new Date(t + MSK).getUTCHours();
  // Gone out the day before yesterday: can still be relit (once a month).
  const restorable = !alive && s.last_day === shift(today, -2) && s.count >= VISIBLE_FROM && t - s.restored_at > 30 * 864e5;
  return {
    count: alive ? s.count : 0,
    lost: alive ? 0 : s.count,
    best: s.best,
    visible: alive && s.count >= VISIBLE_FROM,
    done: s.last_day === today,
    mine: days[userId] === today,
    theirs: days[peerId] === today,
    // Not kept up today yet and the day is running out.
    danger: alive && s.last_day === yesterday && mskHour >= 18,
    restorable,
    restorePrice: RESTORE_PRICE,
    endsAt: alive ? Date.parse(`${shift(s.last_day, 2)}T00:00:00Z`) - MSK : 0,
  };
}

/** Relight a streak that went out yesterday. Returns an error code or null. */
export function restoreStreak(chatId, userId) {
  const s = row(chatId);
  const st = s && streakFor(chatId, userId, 0);
  if (!st?.restorable) return 'not_restorable';
  const u = q('SELECT coins FROM users WHERE id = ?').get(userId);
  if (!u || u.coins < RESTORE_PRICE) return 'not_enough_coins';
  q('UPDATE users SET coins = coins - ? WHERE id = ?').run(RESTORE_PRICE, userId);
  q('UPDATE streaks SET last_day = ?, restored_at = ? WHERE chat_id = ?').run(shift(dayOf(now()), -1), now(), chatId);
  return null;
}
