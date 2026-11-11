import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { melodyNotes } from '../public/js/melody-shared.js';
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
  const storage = new Map(), documentHandlers = {}, audio = [], timers = [];
  class Audio {
    constructor() { this.currentTime = 0; this.nodes = []; audio.push(this); }
    async resume() {}
    async close() { this.closed = true; }
    createOscillator() { const node = { frequency: {}, connect() {}, start(at) { this.at = at; }, stop(at) { this.stopAt = at; } }; this.nodes.push(node); return node; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  const ctx = vm.createContext({
    api, errorText: () => 'error', toast() {}, isTouch: () => true,
    h: (...args) => new Element(...args), icon: () => new Element('svg'), richText: text => [text],
    melodyNotes, ScratchProgress, SURPRISE_SKINS,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    window: { AudioContext: Audio, addEventListener() {} },
    document: { hidden: false, addEventListener: (type, fn) => { documentHandlers[type] = fn; } },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  const source = readFileSync(new URL(`../public/js/${name}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
  vm.runInContext(source, ctx);
  return { ctx, storage, audio, timers, documentHandlers };
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

test('melodies do not autoplay and switching cards closes the previous audio context', async () => {
  const { ctx, audio } = harness('melodies', {});
  const first = ctx.melodyEl({ text: 'Привет' }), second = ctx.melodyEl({ text: 'Пока' });
  assert.equal(audio.length, 0);
  await first.find('melody-play').fire('click');
  assert.equal(audio[0].nodes.length, 12);
  assert.ok(audio[0].nodes.every(n => n.at < n.stopAt && n.stopAt <= 4));
  await second.find('melody-play').fire('click');
  assert.equal(audio[0].closed, true);
  assert.equal(audio[1].closed, undefined);
  assert.equal(first.find('melody-play').props['aria-label'], 'Послушать мелодию');
  ctx.stopMelody();
  assert.equal(audio[1].closed, true);
});

test('hiding the app or pressing stop ends playback and resets its button', async () => {
  const { ctx, audio, documentHandlers } = harness('melodies', {});
  const card = ctx.melodyEl({ text: 'Лимонный мотив' });
  const button = card.find('melody-play');
  await button.fire('click'); await button.fire('click');
  assert.equal(audio[0].closed, true);
  await button.fire('click');
  ctx.document.hidden = true; documentHandlers.visibilitychange();
  assert.equal(audio[1].closed, true);
  assert.equal(button.props['aria-label'], 'Послушать мелодию');
});
