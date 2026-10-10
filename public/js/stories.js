// Stories: 24-hour photos / text cards from your contacts (like Telegram).
import { api, errorText } from './api.js';
import { h, icon, avatar, timeHM, plural, toast, openModal, confirmDialog, isTouch, nameWithBadge, registerOverlay } from './ui.js';

export const STORY_BGS = [
  ['#a8e063', '#56ab2f'], ['#f7971e', '#ffd200'], ['#ff6a88', '#ff99ac'], ['#7f7fd5', '#86a8e7'],
  ['#00c6ff', '#0072ff'], ['#f953c6', '#b91d73'], ['#11998e', '#38ef7d'], ['#232526', '#414345'],
];
const bgCss = (i) => { const [a, b] = STORY_BGS[i] || STORY_BGS[0]; return `linear-gradient(160deg, ${a}, ${b})`; };
const QUICK = ['❤️', '🔥', '😂', '😮', '😢', '👍'];
const DURATION = 6000;

let deps = null; // { me(), prepareImage(file, side), onReply(chatId) }
let feed = [];
let stripEl = null;
let reloadTimer = null;

export function initStories(d) {
  deps = d;
  stripEl = h('div', { class: 'stories-strip' });
  setInterval(loadStories, 5 * 60_000);
  loadStories();
  return stripEl;
}

export async function loadStories() {
  try {
    feed = (await api.get('/stories')).feed;
    renderStrip();
  } catch { /* offline */ }
}

/** Socket said someone's stories changed: refetch (debounced). */
export function storiesChanged() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadStories, 400);
}

export function storyViewEvent({ storyId, views }) {
  for (const g of feed) for (const s of g.stories) if (s.id === storyId) s.views = views;
  viewer?.onViews?.();
}

export const setStripVisible = (v) => stripEl?.classList.toggle('hidden', !v);

function renderStrip() {
  if (!stripEl) return;
  const me = deps.me();
  const mine = feed.find((g) => g.user.id === me.id);
  const items = [
    h('button', { class: 'story-item', onclick: () => (mine ? openViewer(feed.indexOf(mine)) : openComposer()) },
      h('div', { class: `story-ring ${mine ? (mine.allSeen ? 'seen' : '') : 'none'}` }, avatar(me, 56),
        h('span', { class: 'story-add', role: 'button', 'aria-label': 'Новая история', onclick: (e) => { e.stopPropagation(); openComposer(); } }, icon('plus'))),
      h('span', { class: 'story-name' }, mine ? 'Вы' : 'Ваша история')),
    ...feed.filter((g) => g !== mine).map((g) => h('button', { class: 'story-item', onclick: () => openViewer(feed.indexOf(g)) },
      h('div', { class: `story-ring ${g.allSeen ? 'seen' : ''}` }, avatar(g.user, 56)),
      h('span', { class: 'story-name' }, g.user.name.split(' ')[0]))),
  ];
  stripEl.replaceChildren(...items);
}

function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const hr = Math.floor(m / 60);
  return `${hr} ${plural(hr, 'час', 'часа', 'часов')} назад`;
}

// ------------------------------------------------------------------ viewer

let viewer = null;

export function openStoryById(userId, storyId) {
  const gi = feed.findIndex((g) => g.user.id === userId);
  const si = gi >= 0 ? feed[gi].stories.findIndex((s) => s.id === storyId) : -1;
  if (si < 0) return toast('История больше недоступна');
  openViewer(gi, si);
}

function openViewer(groupIndex, storyIndex = null) {
  closeViewer();
  if (!feed[groupIndex]) return;
  const me = deps.me();
  const v = { gi: groupIndex, si: 0, t0: 0, elapsed: 0, paused: false, raf: 0, loading: false };
  viewer = v;
  const g0 = feed[groupIndex];
  v.si = storyIndex ?? Math.max(0, g0.stories.findIndex((s) => !s.seen));

  const bars = h('div', { class: 'sv-bars' });
  const head = h('div', { class: 'sv-head' });
  const stage = h('div', { class: 'sv-stage' });
  const foot = h('div', { class: 'sv-foot' });
  const frame = h('div', { class: 'sv-frame' }, stage, h('div', { class: 'sv-top' }, bars, head), foot);
  const root = h('div', { class: 'story-viewer' }, h('div', { class: 'sv-backdrop' }), frame,
    h('button', { class: 'sv-nav prev', 'aria-label': 'Назад', onclick: (e) => { e.stopPropagation(); step(-1); } }, icon('back')),
    h('button', { class: 'sv-nav next', 'aria-label': 'Дальше', onclick: (e) => { e.stopPropagation(); step(1); } }, icon('back')));
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('show'));
  v.root = root;
  v.release = registerOverlay(() => closeViewer(true));

  const group = () => feed[v.gi];
  const story = () => group()?.stories[v.si];
  const mineGroup = () => group()?.user.id === me.id;

  function setPaused(p) {
    if (v.paused === p) return;
    v.paused = p;
    if (p) v.elapsed += performance.now() - v.t0;
    else v.t0 = performance.now();
    root.classList.toggle('paused', p);
  }
  v.setPaused = setPaused;

  function tick() {
    const s = story();
    if (!s) return;
    const done = v.paused || v.loading ? v.elapsed : v.elapsed + performance.now() - v.t0;
    const frac = Math.min(1, done / DURATION);
    const cur = bars.children[v.si]?.firstChild;
    if (cur) cur.style.transform = `scaleX(${frac})`;
    if (frac >= 1) return step(1);
    v.raf = requestAnimationFrame(tick);
  }

  function step(dir) {
    const g = group();
    if (!g) return closeViewer();
    if (dir > 0 && v.si < g.stories.length - 1) { v.si++; return show(); }
    if (dir < 0 && v.si > 0) { v.si--; return show(); }
    if (dir > 0 && v.gi < feed.length - 1) { v.gi++; v.si = Math.max(0, feed[v.gi].stories.findIndex((s) => !s.seen)); return show(); }
    if (dir < 0 && v.gi > 0) { v.gi--; v.si = feed[v.gi].stories.length - 1; return show(); }
    if (dir > 0) return closeViewer();
    v.elapsed = 0; v.t0 = performance.now();
  }
  v.step = step;

  function show() {
    cancelAnimationFrame(v.raf);
    const g = group();
    const s = story();
    if (!g || !s) return closeViewer();
    v.elapsed = 0; v.t0 = performance.now(); v.paused = false; root.classList.remove('paused');
    bars.replaceChildren(...g.stories.map((_, i) => h('div', { class: 'sv-bar' }, h('i', { style: { transform: `scaleX(${i < v.si ? 1 : 0})` } }))));
    head.replaceChildren(...[
      avatar(g.user, 36),
      h('div', { class: 'sv-who' }, h('div', { class: 'sv-name' }, nameWithBadge(g.user.id === me.id ? 'Моя история' : g.user.name, g.user)),
        h('div', { class: 'sv-time' }, ago(s.createdAt))),
      mineGroup() ? h('button', { class: 'sv-btn', 'aria-label': 'Удалить', onclick: (e) => { e.stopPropagation(); deleteStory(s); } }, icon('trash')) : null,
      h('button', { class: 'sv-btn', 'aria-label': 'Закрыть', onclick: (e) => { e.stopPropagation(); closeViewer(); } }, icon('close'))].filter(Boolean));
    // content
    if (s.kind === 'image') {
      v.loading = true;
      const img = h('img', { class: 'sv-img', src: s.file, alt: '', draggable: false });
      const done = () => { v.loading = false; v.t0 = performance.now(); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      stage.replaceChildren(h('div', { class: 'sv-blur', style: { backgroundImage: `url("${s.file}")` } }), img,
        ...(s.text ? [h('div', { class: 'sv-caption' }, s.text)] : []));
    } else {
      v.loading = false;
      stage.replaceChildren(h('div', { class: 'sv-text', style: { background: bgCss(s.bg) } },
        h('div', { class: `sv-text-inner ${s.text.length > 140 ? 'long' : ''}` }, s.text)));
    }
    renderFoot();
    if (!s.seen && !mineGroup()) {
      s.seen = true;
      g.allSeen = g.stories.every((x) => x.seen);
      api.post(`/stories/${s.id}/view`).catch(() => {});
      renderStrip();
    }
    v.raf = requestAnimationFrame(tick);
  }
  v.show = show;

  function renderFoot() {
    const s = story();
    if (mineGroup()) {
      foot.replaceChildren(h('button', { class: 'sv-views', onclick: (e) => { e.stopPropagation(); viewsSheet(s); } },
        icon('eye'), `${s.views || 0} ${plural(s.views || 0, 'просмотр', 'просмотра', 'просмотров')}`),
      h('button', { class: 'sv-views', onclick: (e) => { e.stopPropagation(); closeViewer(); openComposer(); } }, icon('plus'), 'Ещё'));
      return;
    }
    const input = h('input', { class: 'sv-input', placeholder: 'Ответить…', maxLength: 1000, enterkeyhint: 'send' });
    input.addEventListener('focus', () => setPaused(true));
    input.addEventListener('blur', () => { if (!input.value) setPaused(false); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); sendReply(s, input.value.trim()); input.value = ''; input.blur(); }
      if (e.key === 'Escape') input.blur();
    });
    foot.replaceChildren(
      h('div', { class: 'sv-quick' }, QUICK.map((em) => h('button', {
        class: `sv-react ${s.myReaction === em ? 'on' : ''}`,
        onclick: (e) => { e.stopPropagation(); reactStory(s, em, e.currentTarget); },
      }, em))),
      h('div', { class: 'sv-reply' }, input,
        h('button', { class: 'sv-send', 'aria-label': 'Отправить', onclick: (e) => { e.stopPropagation(); if (input.value.trim()) { sendReply(s, input.value.trim()); input.value = ''; } } }, icon('send'))));
  }
  v.onViews = () => { if (mineGroup()) renderFoot(); };

  // Tap zones, hold to pause, swipe down to close.
  let downAt = 0, sy = 0, sx = 0, held = false;
  stage.addEventListener('pointerdown', (e) => {
    downAt = performance.now(); sy = e.clientY; sx = e.clientX; held = false;
    v.holdTimer = setTimeout(() => { held = true; setPaused(true); }, 220);
  });
  const end = (e) => {
    clearTimeout(v.holdTimer);
    const dy = e.clientY - sy;
    frame.style.transform = '';
    if (dy > 90 && Math.abs(e.clientX - sx) < 80) return closeViewer();
    if (held) { setPaused(false); return; }
    if (performance.now() - downAt > 400) return;
    const r = stage.getBoundingClientRect();
    step(e.clientX - r.left < r.width / 3 ? -1 : 1);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', () => { clearTimeout(v.holdTimer); setPaused(false); frame.style.transform = ''; });
  stage.addEventListener('pointermove', (e) => {
    const dy = e.clientY - sy;
    if (e.buttons && dy > 10 && Math.abs(e.clientX - sx) < 60) { clearTimeout(v.holdTimer); frame.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 300) / 1500})`; }
  });
  root.querySelector('.sv-backdrop').addEventListener('click', closeViewer);
  v.onKey = (e) => {
    if (e.target.closest?.('input')) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeViewer(); }
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === ' ') { e.preventDefault(); setPaused(!v.paused); }
  };
  document.addEventListener('keydown', v.onKey, true);
  v.onVis = () => { if (document.hidden) setPaused(true); };
  document.addEventListener('visibilitychange', v.onVis);
  show();
}

export function closeViewer(fromBack = false) {
  const v = viewer;
  if (!v) return false;
  viewer = null;
  if (fromBack !== true) v.release?.();
  cancelAnimationFrame(v.raf);
  clearTimeout(v.holdTimer);
  document.removeEventListener('keydown', v.onKey, true);
  document.removeEventListener('visibilitychange', v.onVis);
  v.root.classList.remove('show');
  setTimeout(() => v.root.remove(), 220);
  renderStrip();
  return true;
}

async function sendReply(s, text) {
  try {
    await api.post(`/stories/${s.id}/reply`, { text });
    toast('Ответ отправлен в личные сообщения');
  } catch (e) { toast(errorText(e), 'error'); }
  viewer?.setPaused(false);
}

async function reactStory(s, emoji, btn) {
  s.myReaction = emoji;
  btn.parentElement.querySelectorAll('.sv-react').forEach((b) => b.classList.toggle('on', b === btn));
  const fly = h('div', { class: 'sv-fly' }, emoji);
  viewer?.root.append(fly);
  setTimeout(() => fly.remove(), 1000);
  try { await api.post(`/stories/${s.id}/react`, { emoji }); } catch (e) { toast(errorText(e), 'error'); }
}

async function deleteStory(s) {
  viewer?.setPaused(true);
  if (!(await confirmDialog('Удалить эту историю?', { ok: 'Удалить', danger: true }))) { viewer?.setPaused(false); return; }
  try {
    await api.del(`/stories/${s.id}`);
    const g = feed.find((x) => x.stories.includes(s));
    if (g) {
      g.stories = g.stories.filter((x) => x !== s);
      if (!g.stories.length) feed = feed.filter((x) => x !== g);
    }
    toast('История удалена');
    if (!viewer) return;
    if (!g?.stories.length) return closeViewer();
    viewer.si = Math.min(viewer.si, g.stories.length - 1);
    viewer.show();
  } catch (e) { toast(errorText(e), 'error'); viewer?.setPaused(false); }
}

async function viewsSheet(s) {
  viewer?.setPaused(true);
  const list = h('div', { class: 'sv-viewers' }, h('span', { class: 'spinner' }));
  const m = openModal({ title: 'Просмотры', body: list, onClose: () => viewer?.setPaused(false) });
  try {
    const { views } = await api.get(`/stories/${s.id}/views`);
    list.replaceChildren(...(views.length ? views.map((x) => h('div', { class: 'sv-viewer-row' }, avatar(x.user, 40),
      h('div', { class: 'grow' }, h('div', { class: 'row-main' }, x.user.name), h('div', { class: 'row-sub' }, `${timeHM(x.at)}`)),
      x.reaction ? h('span', { class: 'sv-viewer-react' }, x.reaction) : null))
      : [h('div', { class: 'list-note' }, 'Пока никто не смотрел')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
  return m;
}

// ------------------------------------------------------------------ composer

export function openComposer() {
  let mode = 'text';
  let bg = Math.floor(Math.random() * STORY_BGS.length);
  let photo = null;
  let photoUrl = null;
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const textArea = h('textarea', { class: 'sc-text', maxLength: 700, placeholder: 'Напишите что-нибудь…', rows: 4 });
  const caption = h('input', { class: 'input', maxLength: 700, placeholder: 'Подпись (необязательно)' });
  const preview = h('div', { class: 'sc-preview' });
  const tabs = h('div', { class: 'segmented' });
  const swatches = h('div', { class: 'sc-swatches' });
  const extra = h('div', {});

  const render = () => {
    tabs.replaceChildren(
      h('button', { type: 'button', class: mode === 'text' ? 'on' : '', onclick: () => { mode = 'text'; render(); } }, icon('text'), 'Текст'),
      h('button', { type: 'button', class: mode === 'photo' ? 'on' : '', onclick: () => { mode = 'photo'; if (!photo) fileIn.click(); render(); } }, icon('image'), 'Фото'));
    if (mode === 'text') {
      preview.style.background = bgCss(bg);
      preview.replaceChildren(textArea);
      swatches.replaceChildren(...STORY_BGS.map((_, i) => h('button', {
        type: 'button', class: `sc-swatch ${i === bg ? 'on' : ''}`, style: { background: bgCss(i) }, 'aria-label': `Фон ${i + 1}`,
        onclick: () => { bg = i; render(); },
      })));
      extra.replaceChildren(swatches);
      if (!isTouch()) setTimeout(() => textArea.focus(), 30);
    } else {
      preview.style.background = '#111';
      preview.replaceChildren(photoUrl
        ? h('img', { class: 'sc-photo', src: photoUrl, alt: '' })
        : h('button', { type: 'button', class: 'sc-pick', onclick: () => fileIn.click() }, icon('image'), 'Выбрать фото'));
      extra.replaceChildren(...[caption, photoUrl ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => fileIn.click() }, 'Другое фото') : null].filter(Boolean));
    }
  };
  fileIn.addEventListener('change', () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Нужна картинка', 'error');
    photo = f;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(f);
    mode = 'photo';
    render();
  });
  render();
  const m = openModal({
    title: 'Новая история',
    className: 'modal-story',
    body: h('div', { class: 'stack' }, tabs, preview, extra, fileIn,
      h('div', { class: 'muted small' }, 'Историю увидят все, с кем у вас есть личный чат. Через 24 часа она исчезнет.')),
    onClose: () => { if (photoUrl) URL.revokeObjectURL(photoUrl); },
    actions: [
      { label: 'Отмена', onClick: (close) => close() },
      { label: 'Опубликовать', primary: true, onClick: async (close, btn) => {
        const fd = new FormData();
        if (mode === 'photo') {
          if (!photo) return toast('Выберите фото', 'error');
          fd.append('file', await deps.prepareImage(photo, 1920), 'story.jpg');
          fd.append('text', caption.value.trim());
        } else {
          if (!textArea.value.trim()) { textArea.focus(); return toast('Напишите текст', 'error'); }
          fd.append('text', textArea.value.trim());
          fd.append('bg', String(bg));
        }
        if (btn) btn.disabled = true;
        try {
          await api.post('/stories', fd);
          close();
          toast('История опубликована ✨');
          loadStories();
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  return m;
}

/** Small preview of a story inside a chat message (reply / reaction). */
export function storyQuote(x, onOpen) {
  const expired = !x.expiresAt || x.expiresAt < Date.now();
  const thumb = x.kind === 'image' && !expired
    ? h('div', { class: 'sq-thumb', style: { backgroundImage: `url("${x.file}")` } })
    : h('div', { class: 'sq-thumb', style: { background: bgCss(x.bg) } }, x.kind === 'image' ? icon('image') : h('span', {}, (x.text || 'Aa').slice(0, 2)));
  return h('button', { class: `story-quote ${expired ? 'expired' : ''}`, onclick: (e) => { e.stopPropagation(); if (expired) toast('История больше недоступна'); else onOpen(); } },
    thumb, h('div', { class: 'sq-body' }, h('b', {}, 'История'), h('span', {}, expired ? 'больше недоступна' : x.text || (x.kind === 'image' ? 'Фото' : ''))));
}
