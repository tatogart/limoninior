import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadDrafts, persistDrafts } from '../public/js/drafts.js';

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
}

test('drafts survive reload, preserve whitespace and stay separate by account', () => {
  const storage = memoryStorage();
  const text = '  Привет 🍋\nПродолжу позже  ';
  persistDrafts(1, new Map([[10, text], [11, 'Другой чат']]), storage);
  persistDrafts(2, new Map([[10, 'Другой аккаунт']]), storage);
  assert.equal(loadDrafts(1, storage).get(10), text);
  assert.equal(loadDrafts(1, storage).get(11), 'Другой чат');
  assert.equal(loadDrafts(2, storage).get(10), 'Другой аккаунт');
  assert.equal(loadDrafts(3, storage).size, 0);
});

test('cleared and sent drafts disappear after reload; edit buffers never persist', () => {
  const storage = memoryStorage();
  const drafts = new Map([[10, 'Текст'], [-1, 'Временный буфер']]);
  persistDrafts(1, drafts, storage);
  assert.deepEqual([...loadDrafts(1, storage)], [[10, 'Текст']]);
  drafts.delete(10);
  persistDrafts(1, drafts, storage);
  assert.equal(loadDrafts(1, storage).size, 0);
  assert.equal(storage.getItem('limoninior.drafts.1'), null);
});

test('invalid stored data is ignored without breaking app startup', () => {
  const storage = memoryStorage();
  for (const content of ['{', 'null', '{}', '42']) {
    storage.setItem('limoninior.drafts.1', content);
    assert.equal(loadDrafts(1, storage).size, 0);
  }
  storage.setItem('limoninior.drafts.1', JSON.stringify([
    null, [1], [-1, 'edit'], ['2', 'wrong ID'], [3, null], [4, ''],
    [5, 'x'.repeat(4097)], [6, 'x'.repeat(4096)], [7, 'ok'],
  ]));
  assert.deepEqual([...loadDrafts(1, storage).keys()], [6, 7]);
  assert.equal(loadDrafts(null, storage).size, 0);
});

test('storage errors do not interrupt composing or sending', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(loadDrafts(1, storage).size, 0);
  assert.doesNotThrow(() => persistDrafts(1, new Map([[1, 'hello']]), storage));
  assert.doesNotThrow(() => persistDrafts(1, new Map(), storage));
});

// Exercise the actual composer handlers without loading the network/DOM app boot.
function composer() {
  const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const storage = memoryStorage();
  const state = { current: 10, drafts: new Map(), me: { id: 1 }, editing: null };
  const input = { value: 'Мой черновик', focus() {}, setSelectionRange() {} };
  const ctx = vm.createContext({
    S: state, V: { input }, renderBar() {}, autosize() {}, updateSendBtn() {},
    persistDrafts: (id, drafts) => persistDrafts(id, drafts, storage),
  });
  vm.runInContext(source.slice(source.indexOf('function saveDraft()'), source.indexOf('function renderBar()')), ctx);
  return { ctx, state, input, storage };
}

test('repeated autosaves while editing keep the original draft and edit buffer', () => {
  const { ctx, state, input, storage } = composer();
  ctx.saveDraft();
  ctx.startEdit({ text: 'Старое сообщение' });
  input.value = 'Исправленное сообщение';
  ctx.saveDraft();
  ctx.saveDraft();
  assert.equal(state.drafts.get(-1), 'Мой черновик');
  assert.equal(loadDrafts(1, storage).get(10), 'Мой черновик');
  ctx.cancelBar();
  assert.equal(input.value, 'Мой черновик');
  assert.equal(state.editing, null);
});

test('replying during an edit restores the draft instead of sending the edit text', () => {
  const { ctx, state, input } = composer();
  ctx.startEdit({ text: 'Старое сообщение' });
  ctx.startReply({ id: 55 });
  assert.equal(input.value, 'Мой черновик');
  assert.equal(state.reply.id, 55);
  assert.equal(state.drafts.has(-1), false);
});

test('switching chats during an edit persists the original draft for the old chat', () => {
  const { ctx, state, input, storage } = composer();
  ctx.startEdit({ text: 'Старое сообщение' });
  ctx.saveDraft();
  state.drafts.delete(-1);
  state.editing = null;
  state.current = 20;
  input.value = 'Второй черновик';
  ctx.saveDraft();
  assert.deepEqual([...loadDrafts(1, storage)], [[10, 'Мой черновик'], [20, 'Второй черновик']]);
  input.value = '';
  ctx.saveDraft();
  assert.equal(loadDrafts(1, storage).has(20), false);
  assert.equal(loadDrafts(1, storage).get(10), 'Мой черновик');
});

test('submitting a message clears its persisted draft', async () => {
  const { ctx, state, storage } = composer();
  const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  ctx.saveDraft();
  Object.assign(ctx, {
    rec: null, window: {}, renderChatList() {}, flySendBtn() {}, sendEffect() {},
    sendText(text) { assert.equal(text, 'Мой черновик'); },
  });
  vm.runInContext(source.slice(source.indexOf('async function submitComposer()'), source.indexOf('function flySendBtn()')), ctx);
  await ctx.submitComposer();
  assert.equal(state.drafts.has(10), false);
  assert.equal(loadDrafts(1, storage).has(10), false);
});

test('failed sends restore a draft even after switching to another chat', async () => {
  const { ctx, state, input, storage } = composer();
  const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  state.msgs = new Map();
  state.chats = new Map([[10, {}], [20, {}]]);
  Object.assign(ctx, {
    tmpSeq: 0, renderMessages() {}, renderChatList() {}, toast() {}, errorText() {},
    api: { async post() {
      state.current = 20;
      input.value = 'Новый текст в другом чате';
      throw new Error('offline');
    } },
  });
  vm.runInContext(source.slice(source.indexOf('async function sendText(text)'), source.indexOf('// ---------- images')), ctx);
  await ctx.sendText('Не отправилось');
  assert.equal(loadDrafts(1, storage).get(10), 'Не отправилось');
  assert.equal(input.value, 'Новый текст в другом чате');
});
