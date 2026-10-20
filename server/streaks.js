// Streaks ("огоньки", like TikTok): two people who message each other every day keep a 🔥 with
// the number of days in a row. Days are counted in Moscow time. Miss a day and it goes out;
// it can be relit twice a calendar month for lemons if you're quick.
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
// A streak only runs once both people agreed: one offers, the other accepts.
if (!q("SELECT 1 FROM pragma_table_info('streaks') WHERE name = 'state'").get()) {
  db.exec("ALTER TABLE streaks ADD COLUMN state TEXT NOT NULL DEFAULT 'none'");
  db.exec('ALTER TABLE streaks ADD COLUMN offered_by INTEGER');
  db.exec('ALTER TABLE streaks ADD COLUMN offer_msg INTEGER');
  db.exec("UPDATE streaks SET state = 'active' WHERE count > 0");
}

// Relights per calendar month (Moscow time), counted per chat.
if (!q("SELECT 1 FROM pragma_table_info('streaks') WHERE name = 'restore_month'").get()) {
  db.exec('ALTER TABLE streaks ADD COLUMN restore_month TEXT');
  db.exec('ALTER TABLE streaks ADD COLUMN restore_count INTEGER NOT NULL DEFAULT 0');
}

export const RESTORES_PER_MONTH = 2;
export const VISIBLE_FROM = 1; // both agreed to grow it, so it shows from the first day
export const RESTORE_PRICE = 50;
const MILESTONES = new Set([3, 7, 10, 30, 50, 100, 150, 200, 365, 500, 1000]);
const MSK = 3 * 3600_000;
const dayOf = (t) => new Date(t + MSK).toISOString().slice(0, 10);
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const row = (chatId) => q('SELECT * FROM streaks WHERE chat_id = ?').get(chatId);

/** A message was sent in a private chat. Returns the milestone reached (or 0). */
export function trackStreak(chatId, senderId) {
  const today = dayOf(now());
  const s = row(chatId);
  if (s?.state !== 'active') return 0;
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
  const state = s?.state || 'none';
  if (state !== 'active') return { state, offeredByMe: state === 'offered' && s.offered_by === userId, count: 0, visible: false };
  if (!s.last_day) return { state, count: 0, visible: false, best: s.best, mine: false, theirs: false, ...todayOf(s, userId, peerId) };
  const t = now();
  const today = dayOf(t);
  const yesterday = shift(today, -1);
  const days = JSON.parse(s.days || '{}');
  const alive = s.last_day === today || s.last_day === yesterday;
  const mskHour = new Date(t + MSK).getUTCHours();
  // Gone out the day before yesterday: can still be relit (twice a month).
  const missed = !alive && s.last_day === shift(today, -2) && s.count >= VISIBLE_FROM;
  const restoresLeft = Math.max(0, RESTORES_PER_MONTH - (s.restore_month === today.slice(0, 7) ? s.restore_count : 0));
  const restorable = missed && restoresLeft > 0;
  return {
    state,
    count: alive ? s.count : 0,
    lost: alive ? 0 : s.count,
    best: s.best,
    visible: alive && s.count >= VISIBLE_FROM,
    done: s.last_day === today,
    mine: days[userId] === today,
    theirs: days[peerId] === today,
    // Not kept up today yet and the day is running out.
    danger: alive && s.last_day === yesterday && mskHour >= 18,
    missed,
    restorable,
    restoresLeft,
    restoresPerMonth: RESTORES_PER_MONTH,
    restorePrice: RESTORE_PRICE,
    endsAt: alive ? Date.parse(`${shift(s.last_day, 2)}T00:00:00Z`) - MSK : 0,
  };
}

/** Relight a streak that went out yesterday. Returns an error code or null. */
export function restoreStreak(chatId, userId) {
  const s = row(chatId);
  const st = s && streakFor(chatId, userId, 0);
  if (st?.missed && !st.restoresLeft) return 'no_restores_left';
  if (!st?.restorable) return 'not_restorable';
  const u = q('SELECT coins FROM users WHERE id = ?').get(userId);
  if (!u || u.coins < RESTORE_PRICE) return 'not_enough_coins';
  q('UPDATE users SET coins = coins - ? WHERE id = ?').run(RESTORE_PRICE, userId);
  const today = dayOf(now()), month = today.slice(0, 7);
  q(`UPDATE streaks SET last_day = ?, restored_at = ?,
       restore_count = CASE WHEN restore_month = ? THEN restore_count + 1 ELSE 1 END, restore_month = ? WHERE chat_id = ?`).run(shift(today, -1), now(), month, month, chatId);
  return null;
}

function todayOf(s, userId, peerId) {
  const today = dayOf(now());
  const days = JSON.parse(s.days || '{}');
  return { mine: days[userId] === today, theirs: days[peerId] === today };
}

const ensure = (chatId) => { if (!row(chatId)) q('INSERT INTO streaks (chat_id) VALUES (?)').run(chatId); return row(chatId); };

export function offerStreak(chatId, userId) {
  const s = ensure(chatId);
  if (s.state === 'active') return 'already_active';
  if (s.state === 'offered') return s.offered_by === userId ? 'already_offered' : 'offer_pending';
  q("UPDATE streaks SET state = 'offered', offered_by = ? WHERE chat_id = ?").run(userId, chatId);
  return null;
}
export const setOfferMessage = (chatId, msgId) => q('UPDATE streaks SET offer_msg = ? WHERE chat_id = ?').run(msgId, chatId);
export const offerOf = (chatId) => row(chatId);

/** The other person answers the offer. Returns { error } or { offerMsg }. */
export function answerStreak(chatId, userId, accept) {
  const s = row(chatId);
  if (s?.state !== 'offered') return { error: 'no_offer' };
  if (s.offered_by === userId && accept) return { error: 'own_offer' };
  if (accept) q("UPDATE streaks SET state = 'active', count = 0, last_day = NULL, days = '{}' WHERE chat_id = ?").run(chatId);
  else q("UPDATE streaks SET state = 'none', offered_by = NULL WHERE chat_id = ?").run(chatId);
  return { offerMsg: s.offer_msg };
}

export function stopStreak(chatId) {
  const s = row(chatId);
  if (s?.state !== 'active') return 'not_active';
  q("UPDATE streaks SET state = 'none', count = 0, last_day = NULL, days = '{}', offered_by = NULL WHERE chat_id = ?").run(chatId);
  return null;
}
