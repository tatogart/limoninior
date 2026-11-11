import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerSurprises } from '../server/surprises.js';
import { registerMelodies } from '../server/melodies.js';
import { melodyNotes } from '../public/js/melody-shared.js';
import { ScratchProgress } from '../public/js/surprise-shared.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER, sender_id INTEGER, kind TEXT, text TEXT, extra TEXT);
    CREATE TABLE members (chat_id INTEGER, user_id INTEGER);
    INSERT INTO members VALUES (10, 1), (10, 2), (20, 3);`);
  const routes = new Map(), broadcasts = [];
  const state = { denied: null, enabled: true, failInsert: false };
  const q = (sql) => {
    if (state.failInsert && sql.startsWith('INSERT INTO surprises')) throw new Error('disk failure');
    return db.prepare(sql);
  };
  const hooks = {
    db, q,
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    clean: (text, n) => String(text ?? '').trim().slice(0, n),
    int: (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null,
    bad: (res, error, status = 400) => res.status(status).json({ error }),
    isMember: (chatId, uid) => !!q('SELECT 1 FROM members WHERE chat_id = ? AND user_id = ?').get(chatId, uid),
    postError: () => state.denied,
    filterText: (text) => text.replace(/badword/g, '*******'),
    insertMessage(chatId, sender, fields) {
      const { lastInsertRowid } = q('INSERT INTO messages (chat_id, sender_id, kind, text, extra) VALUES (?, ?, ?, ?, ?)')
        .run(chatId, sender, fields.kind, fields.text, fields.extra ? JSON.stringify(fields.extra) : null);
      return q('SELECT * FROM messages WHERE id = ?').get(Number(lastInsertRowid));
    },
    broadcastNewMessage(chatId, message) { broadcasts.push(message); return message; },
    validReply: () => null,
    sendLimiter: (req, res, next) => next(),
    featureGate: () => (req, res, next) => state.enabled ? next() : res.status(403).json({ error: 'feature_off' }),
  };
  const router = { post: (route, ...handlers) => routes.set(route, handlers) };
  registerSurprises(router, hooks);
  registerMelodies(router, hooks);
  const call = (route, { id = 10, user = 1, body = {} } = {}) => {
    const response = { statusCode: 200, data: null, headers: {}, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; return this; }, set(k, v) { this.headers[k] = v; return this; } };
    const handlers = [...routes.get(route)];
    const req = { params: { id }, user: { id: user }, body };
    const next = () => handlers.shift()?.(req, response, next);
    next(); return response;
  };
  return { db, state, broadcasts, call };
}
const create = '/chats/:id/surprise', open = '/messages/:id/surprise-open';

test('secret text stays out of the ordinary message and realtime payload', () => {
  const { db, call, broadcasts } = fixture();
  const created = call(create, { body: { text: 'Секрет 🍋', title: 'Сотри меня', skin: 'space' } });
  assert.equal(created.statusCode, 200);
  assert.equal(created.data.message.kind, 'surprise');
  assert.equal(created.data.message.text, 'Сотри меня');
  assert.equal(JSON.stringify(broadcasts).includes('Секрет'), false);
  const opened = call(open, { id: created.data.message.id, user: 2 });
  assert.deepEqual(opened.data, { text: 'Секрет 🍋' });
  assert.equal(opened.headers['Cache-Control'], 'no-store');
  // Opening is local to the viewer: no global message edit or secret broadcast.
  assert.equal(broadcasts.length, 1);
  assert.equal(db.prepare('SELECT text FROM messages').get().text, 'Сотри меня');
  db.close();
});

test('outsiders and people removed from the chat cannot retrieve a surprise', () => {
  const { db, call } = fixture();
  assert.equal(call(create, { user: 3, body: { text: 'no' } }).statusCode, 404);
  const id = call(create, { body: { text: 'hello' } }).data.message.id;
  assert.equal(call(open, { id, user: 3 }).statusCode, 404);
  assert.equal(call(open, { id: 'invalid', user: 2 }).statusCode, 404);
  db.prepare('DELETE FROM members WHERE user_id = 2').run();
  assert.equal(call(open, { id, user: 2 }).statusCode, 404);
  assert.equal(call(open, { id, user: 1 }).statusCode, 200);
  db.close();
});

test('posting respects block, channel-role, mute and maintenance errors', () => {
  const { db, state, call, broadcasts } = fixture();
  for (const error of ['blocked', 'you_blocked', 'forbidden', 'muted', 'maintenance']) {
    state.denied = error;
    const response = call(create, { body: { text: 'hi' } });
    assert.equal(response.statusCode, 403);
    assert.equal(response.data.error, error);
  }
  assert.equal(broadcasts.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
  db.close();
});

test('creation respects the existing extras feature switch', () => {
  const { db, state, call } = fixture();
  state.enabled = false;
  assert.equal(call(create, { body: { text: 'hi' } }).data.error, 'feature_off');
  db.close();
});

test('input validation, skin allowlist, length limits and moderation apply', () => {
  const { db, call } = fixture();
  for (const text of ['', '  ', null, {}, 7]) assert.equal(call(create, { body: { text } }).statusCode, 400);
  assert.equal(call(create, { body: { text: 'x'.repeat(1001) } }).data.error, 'too_long');
  for (const skin of ['__proto__', 'constructor', 'oops']) assert.equal(call(create, { body: { text: 'ok', skin } }).data.error, 'bad_surprise_skin');
  const id = call(create, { body: { text: ' badword ', title: 'x'.repeat(100) } }).data.message.id;
  assert.equal(call(open, { id }).data.text, '*******');
  assert.equal(db.prepare('SELECT text FROM messages WHERE id = ?').get(id).text.length, 60);
  assert.equal(call(create, { body: { text: 'x'.repeat(1000) } }).statusCode, 200);
  db.close();
});

test('hidden text insertion failure rolls back the message before any broadcast', () => {
  const { db, state, call, broadcasts } = fixture();
  state.failInsert = true;
  assert.throws(() => call(create, { body: { text: 'hi' } }), /disk failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
  assert.equal(broadcasts.length, 0);
  db.close();
});

test('deleting the message deletes its hidden text and makes opening fail', () => {
  const { db, call } = fixture();
  const id = call(create, { body: { text: 'hi' } }).data.message.id;
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM surprises').get().n, 0);
  assert.equal(call(open, { id }).statusCode, 404);
  db.close();
});

test('scratch coverage counts distinct area and resets the stroke between gestures', () => {
  const progress = new ScratchProgress();
  const initial = progress.begin(150, 90);
  for (let n = 0; n < 500; n++) progress.move(150, 90);
  assert.equal(progress.ratio, initial);
  assert.ok(initial < 0.1);
  progress.end();
  progress.begin(5, 5);
  assert.ok(progress.ratio < 0.15); // no fake line connecting two separate touches
  for (let y = 10; y < 180; y += 30) { progress.begin(0, y); progress.move(300, y); progress.end(); }
  assert.ok(progress.ratio >= 0.9);
  assert.ok(progress.ratio <= 1);
  const before = progress.ratio;
  assert.equal(progress.move(NaN, 0), before);
});

test('melodies validate text, require membership and use normal posting permissions', () => {
  const { db, state, call, broadcasts } = fixture();
  const route = '/chats/:id/melody';
  for (const text of ['', ' ', {}, 5]) assert.equal(call(route, { body: { text } }).statusCode, 400);
  assert.equal(call(route, { body: { text: 'x'.repeat(241) } }).data.error, 'too_long');
  assert.equal(call(route, { user: 3, body: { text: 'hi' } }).statusCode, 404);
  state.denied = 'blocked';
  assert.equal(call(route, { body: { text: 'hi' } }).statusCode, 403);
  state.denied = null; state.enabled = false;
  assert.equal(call(route, { body: { text: 'hi' } }).data.error, 'feature_off');
  state.enabled = true;
  const response = call(route, { body: { text: '  На одной волне 🍋  ' } });
  assert.equal(response.data.message.text, 'На одной волне 🍋');
  assert.equal(response.data.message.kind, 'melody');
  assert.equal(broadcasts.length, 1);
  assert.equal(call(route, { body: { text: 'x'.repeat(240) } }).statusCode, 200);
  db.close();
});

test('the same normalized phrase produces the same short, finite twelve-note melody', () => {
  assert.deepEqual(melodyNotes(' e\u0301 '), melodyNotes('é'));
  assert.deepEqual(melodyNotes('🍋 Limochat'), melodyNotes('🍋 Limochat'));
  assert.notDeepEqual(melodyNotes('Привет'), melodyNotes('Пока'));
  for (const input of ['', '🍋', 'Привет\nмир', 'x'.repeat(240)]) {
    const notes = melodyNotes(input);
    assert.equal(notes.length, 12);
    assert.ok(notes.every(n => Number.isFinite(n.frequency) && n.frequency >= 261 && n.frequency <= 785));
    assert.ok(notes.every(n => n.duration === 0.2 || n.duration === 0.3));
    assert.ok(notes.reduce((s, n) => s + n.duration, 0) <= 3.61);
  }
});
