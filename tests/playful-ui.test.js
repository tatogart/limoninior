import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ScratchProgress, SURPRISE_SKINS } from '../public/js/surprise-shared.js';

// Minimal event/element adapter. Runs production card handlers without app boot or
// a browser process; visual layout still needs a real browser/device check.
class Element {
  constructor(tag, props = {}, ...children) {
    this.tag = tag; this.props = props; this.children = []; this.handlers = {}; this.disabled = false;
    this.className = props.class || ''; this.value = ''; this.style = { setProperty() {} };
    this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: (name) => { this.className = this.className.split(' ').filter(x => x !== name).join(' '); } };
    for (const [k, v] of Object.entries(props)) if (k.startsWith('on')) this.addEventListener(k.slice(2), v);
    this.replaceChildren(...children);
  }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  async fire(type, event = {}) { for (const fn of this.handlers[type] || []) await fn({ preventDefault() {}, stopPropagation() {}, ...event }); }
  replaceChildren(...children) { this.children = children.flat(Infinity).filter(x => x !== null && x !== undefined); for (const c of this.children) if (c instanceof Element) c.parent = this; }
  append(...children) { this.replaceChildren(...this.children, ...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  set textContent(text) { this.replaceChildren(text); }
  get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : c).join(''); }
  setAttribute(k, v) { this.props[k] = v; }
  focus() {}
  getContext() { return null; }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 180 }; }
  find(cls) { return this.className.split(' ').includes(cls) ? this : this.children.find(c => c instanceof Element && c.find(cls))?.find(cls); }
}
function harness(name, api) {
  const storage = new Map(), documentHandlers = {}, timers = [];
  const ctx = vm.createContext({
    api, errorText: () => 'error', toast() {}, isTouch: () => true,
    h: (...args) => new Element(...args), icon: () => new Element('svg'), richText: text => [text],
    ScratchProgress, SURPRISE_SKINS,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    window: { addEventListener() {} },
    document: { hidden: false, addEventListener: (type, fn) => { documentHandlers[type] = fn; } },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  const source = readFileSync(new URL(`../public/js/${name}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
  vm.runInContext(source, ctx);
  return { ctx, storage, timers, documentHandlers };
}

test('surprise button opens once, handles retries and remembers only an account-scoped flag', async () => {
  let calls = 0, fail = true;
  const { ctx, storage } = harness('surprises', { async post() { calls++; if (fail) throw Error('offline'); return { text: 'Твоя улыбка 🍋' }; } });
  const card = ctx.surpriseEl({ id: 101, extra: {}, text: 'Обложка' }, 1);
  assert.equal(card.textContent.includes('Твоя улыбка'), false);
  const button = card.find('surprise-open');
  await button.fire('click');
  assert.equal(button.disabled, false);
  assert.equal(storage.size, 0);
  fail = false;
  await button.fire('click');
  assert.equal(card.find('surprise-text').textContent, 'Твоя улыбка 🍋');
  assert.equal(card.find('surprise-coating'), undefined);
  assert.equal(storage.get('limo.surprise.1.101'), '1');
  assert.equal([...storage.values()].includes('Твоя улыбка 🍋'), false);
  await button.fire('click');
  assert.equal(calls, 2);
});

test('scratch strokes open the actual card only after distinct coverage crosses the threshold', async () => {
  let calls = 0;
  const { ctx } = harness('surprises', { async post() { calls++; return { text: 'Открыто' }; } });
  const card = ctx.surpriseEl({ id: 102, extra: {} }, 1), canvas = card.find('surprise-coating');
  const point = { pointerId: 1, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 };
  for (let i = 0; i < 15; i++) { await canvas.fire('pointerdown', point); await canvas.fire('pointerup'); }
  assert.equal(calls, 0);
  for (let y = 20; y <= 140 && !calls; y += 35) {
    await canvas.fire('pointerdown', { ...point, clientY: y });
    await canvas.fire('pointermove', { ...point, clientX: 290, clientY: y });
    await canvas.fire('pointerup');
  }
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(card.find('surprise-text').textContent, 'Открыто');
});


test('catching five moving lemons opens the note once without fetching it early', async () => {
  let calls = 0;
  const { ctx } = harness('catch', { async post() { calls++; return { text: 'Поймал!' }; } });
  const card = ctx.catchEl({ id: 103, extra: { mode: 'catch' } }, 1);
  const target = card.find('catch-target');
  const positions = new Set();
  for (let i = 0; i < 4; i++) {
    positions.add(`${target.style.left},${target.style.top}`);
    await target.fire('click');
    assert.equal(calls, 0);
  }
  assert.equal(positions.size, 4);
  await target.fire('click');
  assert.equal(calls, 1);
  assert.equal(card.find('surprise-text').textContent, 'Поймал!');
  assert.equal(card.find('catch-target'), undefined);
  await target.fire('click');
  assert.equal(calls, 1);
});

test('a failed final catch can retry opening and the accessible skip works', async () => {
  let fail = true, calls = 0;
  const { ctx } = harness('catch', { async post() { calls++; if (fail) throw Error('offline'); return { text: 'Открыто' }; } });
  const card = ctx.catchEl({ id: 104, extra: {} }, 1), target = card.find('catch-target');
  for (let i = 0; i < 5; i++) await target.fire('click');
  assert.equal(calls, 1);
  const retry = card.find('catch-skip');
  assert.equal(retry.disabled, false);
  fail = false;
  await retry.fire('click');
  assert.equal(calls, 2);
  assert.equal(card.find('surprise-text').textContent, 'Открыто');
  const another = ctx.catchEl({ id: 105, extra: {} }, 2);
  await another.find('catch-skip').fire('click');
  assert.equal(another.find('surprise-text').textContent, 'Открыто');
});
