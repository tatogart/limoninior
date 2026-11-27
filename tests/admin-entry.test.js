import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminTapHandler } from '../public/js/admin-entry.js';

function setup(admin = true) {
  const state = { admin, time: 1000, opens: 0 };
  const options = { isAdmin: () => state.admin, now: () => state.time, open: () => state.opens++ };
  return { state, options, tap: createAdminTapHandler(options) };
}
test('admin entry requires exactly five clicks and resets after opening', () => {
  const { state, tap } = setup();
  for (let i = 0; i < 4; i++) { tap(); state.time += 100; }
  assert.equal(state.opens, 0);
  tap(); assert.equal(state.opens, 1);
  tap(); assert.equal(state.opens, 1);
});
test('long gaps reset the hidden admin tap sequence', () => {
  const { state, tap } = setup();
  for (let i = 0; i < 4; i++) tap();
  state.time += 1801; tap();
  assert.equal(state.opens, 0);
  for (let i = 0; i < 4; i++) tap();
  assert.equal(state.opens, 1);
});
test('normal accounts and revoked admins cannot open the admin panel', () => {
  const { state, tap } = setup(false);
  for (let i = 0; i < 10; i++) tap();
  assert.equal(state.opens, 0);
  state.admin = true;
  for (let i = 0; i < 4; i++) tap();
  state.admin = false; tap();
  assert.equal(state.opens, 0);
  state.admin = true; tap();
  assert.equal(state.opens, 0);
});
test('reopening the drawer starts a new sequence', () => {
  const { state, options, tap } = setup();
  for (let i = 0; i < 4; i++) tap();
  const newTap = createAdminTapHandler(options);
  newTap(); assert.equal(state.opens, 0);
  for (let i = 0; i < 4; i++) newTap();
  assert.equal(state.opens, 1);
});
