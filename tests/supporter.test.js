import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limo-supporter-'));
process.env.DATA_DIR = dir;
const { db, q } = await import('../server/db.js');
const { SUPPORTER_OFFER, PLANS } = await import('../public/js/catalog.js');
const { BUILTIN_REWARDS, grantReward, hasSupporter, registerRewardsAdmin, registerRewards } = await import('../server/rewards.js');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
q("INSERT INTO users (id, google_sub, email, username, name, created_at, last_seen) VALUES (1, 'test:1', 'one@test.invalid', 'tester', 'Tester', 0, 0)").run();
q("INSERT INTO users (id, google_sub, email, username, name, created_at, last_seen) VALUES (2, 'test:2', 'two@test.invalid', 'owner', 'Owner', 0, 0)").run();

function fixture() {
  q('DELETE FROM user_rewards').run();
  q("UPDATE users SET shown_role = 'tireless', sub_tier = 'max', sub_until = 9999999999999, coins = 123 WHERE id = 1").run();
  grantReward(1, 'tireless', 'game');
  const routes = new Map(), notices = [], updates = [], profiles = [];
  const router = Object.fromEntries(['get', 'post', 'delete'].map((method) => [method, (url, fn) => routes.set(method + ' ' + url, fn)]));
  registerRewardsAdmin(router, { pushMe: (id) => updates.push(id), notify: (...args) => notices.push(args), broadcastUser: (u) => profiles.push(u.id) });
  const request = (method, url, body = {}, id = '1') => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
    routes.get(method + ' ' + url)({ params: { id }, body, user: { id: 2 }, ip: '127.0.0.1' }, res);
    return res;
  };
  return { request, notices, updates, profiles, router, routes };
}

test('supporter is a separate 549-ruble cosmetic offer', () => {
  assert.equal(SUPPORTER_OFFER.price, 549);
  assert.ok(!PLANS.some((p) => p.id === 'supporter'));
  assert.equal(BUILTIN_REWARDS.find((r) => r.id === 'supporter').kind, 'badge');
});
test('one admin grant adds the mark, updates peers and preserves role, subscription and coins', () => {
  const f = fixture();
  const before = q('SELECT shown_role, sub_tier, sub_until, coins FROM users WHERE id = 1').get();
  assert.equal(f.request('post', '/users/:id/rewards', { reward: 'supporter' }).statusCode, 200);
  assert.equal(hasSupporter(1), true);
  assert.deepEqual(q('SELECT shown_role, sub_tier, sub_until, coins FROM users WHERE id = 1').get(), before);
  assert.equal(f.notices.length, 1);
  assert.deepEqual(f.updates, [1]);
  assert.deepEqual(f.profiles, [1]);
});
test('repeat grants are idempotent and do not repeat the notification', () => {
  const f = fixture();
  f.request('post', '/users/:id/rewards', { reward: 'supporter' });
  const first = q("SELECT granted_at FROM user_rewards WHERE user_id = 1 AND reward = 'supporter'").get();
  f.request('post', '/users/:id/rewards', { reward: 'supporter' });
  assert.equal(q("SELECT COUNT(*) AS n FROM user_rewards WHERE user_id = 1 AND reward = 'supporter'").get().n, 1);
  assert.equal(f.notices.length, 1);
  assert.deepEqual(q("SELECT granted_at FROM user_rewards WHERE user_id = 1 AND reward = 'supporter'").get(), first);
});
test('revoking the mark preserves the selected game role', () => {
  const f = fixture();
  f.request('post', '/users/:id/rewards', { reward: 'supporter' });
  f.request('post', '/users/:id/rewards', { reward: 'supporter', grant: false });
  assert.equal(hasSupporter(1), false);
  assert.equal(q('SELECT shown_role FROM users WHERE id = 1').get().shown_role, 'tireless');
});
test('a missing user cannot receive a mark and built-in rewards cannot be deleted', () => {
  const f = fixture();
  assert.equal(f.request('post', '/users/:id/rewards', { reward: 'supporter' }, '999').statusCode, 404);
  assert.equal(f.request('delete', '/rewards/:id', {}, 'supporter').statusCode, 400);
});
test('supporter cannot replace a selected role through the self-service role endpoint', () => {
  const f = fixture();
  registerRewards(f.router, { pushMe() {}, bad: (res, error, status) => res.status(status).json({ error }) });
  grantReward(1, 'supporter', 'admin');
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  f.routes.get('post /me/role')({ body: { role: 'supporter' }, user: { id: 1 } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(q('SELECT shown_role FROM users WHERE id = 1').get().shown_role, 'tireless');
});
