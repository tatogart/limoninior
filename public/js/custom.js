// Customization 2.0: per-chat wallpapers (your own photo too), message shape and colours, chat list
// density, your own quick reactions, nicknames for contacts, plus the name colour and avatar frame
// that everyone sees.
import { h, icon, toast, openModal } from './ui.js';

let S = null;
let onChange = null; // re-render after a change
export function initCustom(state, cb) { S = state; onChange = cb; applyCustomLook(); }
const save = () => onChange?.();

// ---------------------------------------------------------------- what everyone sees

export const NAME_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b'];
export const NAME_GRADIENTS = {
  rainbow: ['Радуга', 'linear-gradient(90deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7)'],
  sunset: ['Закат', 'linear-gradient(90deg, #f97316, #ec4899)'],
  ocean: ['Океан', 'linear-gradient(90deg, #06b6d4, #3b82f6)'],
  neon: ['Неон', 'linear-gradient(90deg, #22d3ee, #e879f9)'],
  gold: ['Золото', 'linear-gradient(90deg, #b45309, #facc15, #b45309)'],
  lemon: ['Лимон', 'linear-gradient(90deg, #84cc16, #facc15)'],
  candy: ['Конфета', 'linear-gradient(90deg, #f472b6, #a78bfa)'],
  forest: ['Лес', 'linear-gradient(90deg, #15803d, #84cc16)'],
};
export const FRAMES = {
  none: 'Без рамки', rainbow: 'Радуга', fire: 'Огонь', neon: 'Неон', gold: 'Золото', love: 'Любовь', ice: 'Лёд', lemon: 'Лимон', galaxy: 'Галактика',
};

/** Style for a coloured name (solid or gradient). Returns props for h(). */
export function nameStyleProps(u, fallback) {
  const c = u?.px?.nameColor;
  if (!c) return fallback ? { style: { color: fallback } } : {};
  if (NAME_GRADIENTS[c]) return { class: 'name-grad', style: { backgroundImage: NAME_GRADIENTS[c][1] } };
  return { style: { color: c } };
}

/** Picker block for the profile editor. state = { nameColor, frame }; onPick(previewPatch). */
export function lookPicker(state, onPick, me) {
  const box = h('div', { class: 'cu-look' });
  const draw = () => box.replaceChildren(
    h('div', { class: 'field-label' }, 'Цвет имени — видят все'),
    h('div', { class: 'cu-colors' },
      h('button', { type: 'button', class: `cu-dot auto ${!state.nameColor ? 'on' : ''}`, title: 'Обычный', onclick: () => { state.nameColor = null; draw(); onPick(); } }, 'Aa'),
      ...NAME_COLORS.map((c) => h('button', { type: 'button', class: `cu-dot ${state.nameColor === c ? 'on' : ''}`, style: { background: c }, title: c, onclick: () => { state.nameColor = c; draw(); onPick(); } })),
      ...Object.entries(NAME_GRADIENTS).map(([k, [l, g]]) => h('button', { type: 'button', class: `cu-dot ${state.nameColor === k ? 'on' : ''}`, style: { background: g }, title: l, onclick: () => { state.nameColor = k; draw(); onPick(); } }))),
    h('div', { class: 'cu-name-prev' }, h('b', nameStyleProps({ px: { nameColor: state.nameColor } }), me.name)),
    h('div', { class: 'field-label' }, 'Рамка аватарки — видят все'),
    h('div', { class: 'cu-frames' }, Object.entries(FRAMES).map(([k, l]) => h('button', { type: 'button', class: `cu-frame-opt ${(state.frame || 'none') === k ? 'on' : ''}`, onclick: () => { state.frame = k; draw(); onPick(); } },
      h('span', { class: `avatar-frame-demo frame-${k}` }, h('i')), h('span', {}, l)))));
  draw();
  return box;
}

// ---------------------------------------------------------------- local look (this device)

export const BUBBLE_SHAPES = [['round', 'Округлые'], ['soft', 'Мягкие'], ['square', 'Строгие'], ['pill', 'Капсулы'], ['notail', 'Без хвостиков']];
export const IN_COLORS = ['auto', '#ffffff', '#fef9c3', '#dcfce7', '#e0f2fe', '#fae8ff', '#ffe4e6', '#1f2937', '#1e1b4b', '#3f1d2e'];
export const DENSITY = [['compact', 'Плотный'], ['normal', 'Обычный'], ['large', 'Крупный']];
export const SEND_FX = [['none', 'Нет'], ['pop', 'Пружинка'], ['fly', 'Полёт'], ['confetti', 'Конфетти']];

export function applyCustomLook(root = document.documentElement) {
  const st = S?.settings || {};
  root.dataset.bubble = st.bubbleShape || 'round';
  root.dataset.density = st.listDensity || 'normal';
  if (st.bubbleIn && st.bubbleIn !== 'auto') {
    root.style.setProperty('--bubble-in', st.bubbleIn);
    // Dark incoming colour → light text on it.
    const n = parseInt(st.bubbleIn.slice(1), 16), lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    root.style.setProperty('--text-in', lum < 128 ? '#f5f7f9' : '#0f1419');
  } else {
    root.style.removeProperty('--bubble-in');
    root.style.removeProperty('--text-in');
  }
}

export const quickReactions = (fallback) => (Array.isArray(S?.settings?.reactions) && S.settings.reactions.length ? S.settings.reactions : fallback);

const REACTION_POOL = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🍋', '🤯', '👎', '😍', '🥰', '😎', '🤔', '🙏', '👏', '💯', '😡', '🤡', '💀', '🫶', '✨', '😭', '🤝', '👀', '🥳', '💔', '🙈', '⚡', '🌸', '🍕', '☕'];
export function reactionsModal(defaults) {
  let pick = [...quickReactions(defaults)];
  const grid = h('div', { class: 'cu-react-grid' });
  const sel = h('div', { class: 'cu-react-sel' });
  const draw = () => {
    sel.replaceChildren(...pick.map((e, i) => h('button', { class: 'cu-react on', title: 'Убрать', onclick: () => { pick.splice(i, 1); draw(); } }, e)),
      ...Array.from({ length: Math.max(0, 8 - pick.length) }, () => h('span', { class: 'cu-react empty' })));
    grid.replaceChildren(...REACTION_POOL.map((e) => h('button', { class: `cu-react ${pick.includes(e) ? 'used' : ''}`, onclick: () => {
      if (pick.includes(e)) pick = pick.filter((x) => x !== e);
      else if (pick.length >= 8) return toast('Не больше 8 реакций');
      else pick.push(e);
      draw();
    } }, e)));
  };
  draw();
  openModal({
    title: 'Быстрые реакции', className: 'modal-small',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Эти реакции появляются, когда вы нажимаете на сообщение. Выберите до 8 в нужном порядке.'), sel, grid),
    actions: [
      { label: 'Как было', onClick: (c) => { S.settings.reactions = null; save(); c(); toast('Реакции по умолчанию'); } },
      { label: 'Сохранить', primary: true, onClick: (c) => { S.settings.reactions = pick.length ? pick : null; save(); c(); toast('Реакции сохранены'); } },
    ],
  });
}

// ---------------------------------------------------------------- nicknames

export const nickname = (userId) => S?.settings?.nicknames?.[userId] || null;
export function nicknameModal(u) {
  const inp = h('input', { class: 'input', maxLength: 40, value: nickname(u.id) || '', placeholder: u.name });
  openModal({
    title: 'Имя контакта', className: 'modal-small',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `Как ${u.name} будет подписан(а) у вас. Видите только вы.`), inp),
    actions: [
      { label: 'Сбросить', onClick: (c) => { if (S.settings.nicknames) delete S.settings.nicknames[u.id]; save(); c(); } },
      { label: 'Сохранить', primary: true, onClick: (c) => {
        const v = inp.value.trim().slice(0, 40);
        S.settings.nicknames = { ...(S.settings.nicknames || {}) };
        if (v && v !== u.name) S.settings.nicknames[u.id] = v; else delete S.settings.nicknames[u.id];
        save(); c(); toast(v ? `Теперь это «${v}»` : 'Имя сброшено');
      } },
    ],
  });
  setTimeout(() => inp.focus(), 60);
}

// ---------------------------------------------------------------- per-chat wallpaper (this device)

const DB = 'limochat-walls';
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('walls');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('walls', mode);
      const req = fn(tx.objectStore('walls'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const photoCache = new Map();
async function photoUrl(chatId) {
  if (photoCache.has(chatId)) return photoCache.get(chatId);
  let blob = null;
  try { blob = await idb('readonly', (st) => st.get(`c${chatId}`)); } catch { /* storage unavailable */ }
  const url = blob ? URL.createObjectURL(blob) : null;
  photoCache.set(chatId, url);
  return url;
}

export const WALL_COLORS = ['#fef3c7', '#dcfce7', '#e0f2fe', '#fce7f3', '#ede9fe', '#f1f5f9', '#0f172a', '#1e1b4b', '#052e16', '#3b0764'];
export const WALL_GRADS = {
  lemonade: 'linear-gradient(160deg, #fef9c3, #bbf7d0)', peach: 'linear-gradient(160deg, #fed7aa, #fbcfe8)', sky: 'linear-gradient(160deg, #e0f2fe, #c7d2fe)',
  mint: 'linear-gradient(160deg, #ccfbf1, #d9f99d)', sunset: 'linear-gradient(160deg, #fb923c, #db2777, #6d28d9)', night: 'linear-gradient(160deg, #1e3a8a, #0f172a)',
  aurora: 'linear-gradient(160deg, #134e4a, #4c1d95)', fire: 'linear-gradient(160deg, #7c2d12, #450a0a)',
};
const wallOf = (chatId) => S?.settings?.chatWalls?.[chatId] || null;

/** Set the chat pane background for this chat (or the theme's when none). */
export async function applyChatWall(pane, chatId) {
  if (!pane) return;
  const w = chatId ? wallOf(chatId) : null;
  pane.classList.toggle('own-wall', !!w);
  pane.style.removeProperty('--wall-img');
  pane.style.removeProperty('--wall-pattern');
  pane.style.removeProperty('--wall-dim');
  pane.style.removeProperty('--wall-blur');
  if (!w) return;
  let img = null;
  if (w.type === 'color') img = w.value;
  if (w.type === 'grad') img = WALL_GRADS[w.value] || null;
  if (w.type === 'photo') { const url = await photoUrl(chatId); img = url ? `center / cover no-repeat url("${url}")` : null; }
  if (!img) return;
  pane.style.setProperty('--wall-img', img);
  pane.style.setProperty('--wall-pattern', w.pattern ? 'var(--pattern)' : 'none');
  pane.style.setProperty('--wall-dim', String((w.dim || 0) / 100));
  pane.style.setProperty('--wall-blur', w.blur ? '8px' : '0px');
}

async function resize(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
}

export function chatWallModal(chat, title, pane) {
  const cur = wallOf(chat.id);
  const st = { type: cur?.type || null, value: cur?.value || null, dim: cur?.dim || 0, blur: !!cur?.blur, pattern: !!cur?.pattern };
  let photoBlob = null;
  const prev = h('div', { class: 'cu-wall-prev' }, h('div', { class: 'cu-wall-bg' }), h('div', { class: 'cu-wall-dim' }),
    h('i', { class: 'th-b in' }, 'Привет! 👋'), h('i', { class: 'th-b out' }, 'Новые обои 😍'));
  const paint = async () => {
    const bg = prev.querySelector('.cu-wall-bg');
    let img = '';
    if (st.type === 'color') img = st.value;
    if (st.type === 'grad') img = WALL_GRADS[st.value];
    if (st.type === 'photo') {
      const url = photoBlob ? URL.createObjectURL(photoBlob) : await photoUrl(chat.id);
      img = url ? `center / cover no-repeat url("${url}")` : '';
    }
    bg.style.background = img || 'var(--wall-img)';
    bg.style.filter = st.blur ? 'blur(6px)' : '';
    prev.querySelector('.cu-wall-dim').style.opacity = String(st.dim / 100);
  };
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    try { photoBlob = await resize(f); st.type = 'photo'; draw(); } catch { toast('Не получилось открыть картинку', 'error'); }
  });
  const opts = h('div', { class: 'cu-wall-opts' });
  const dim = h('input', { type: 'range', class: 'range', min: 0, max: 70, value: st.dim });
  dim.addEventListener('input', () => { st.dim = Number(dim.value); paint(); });
  const draw = () => {
    opts.replaceChildren(
      h('button', { type: 'button', class: `cu-wall-opt theme ${!st.type ? 'on' : ''}`, onclick: () => { st.type = null; draw(); } }, 'Как в теме'),
      h('button', { type: 'button', class: `cu-wall-opt photo ${st.type === 'photo' ? 'on' : ''}`, onclick: () => fileIn.click() }, icon('image'), 'Своё фото'),
      ...Object.entries(WALL_GRADS).map(([k, g]) => h('button', { type: 'button', class: `cu-wall-opt ${st.type === 'grad' && st.value === k ? 'on' : ''}`, style: { background: g }, title: k, onclick: () => { st.type = 'grad'; st.value = k; draw(); } })),
      ...WALL_COLORS.map((c) => h('button', { type: 'button', class: `cu-wall-opt ${st.type === 'color' && st.value === c ? 'on' : ''}`, style: { background: c }, title: c, onclick: () => { st.type = 'color'; st.value = c; draw(); } })));
    paint();
  };
  draw();
  openModal({
    title: `Обои: ${title}`, className: 'modal-small',
    body: h('div', { class: 'stack' }, prev, opts, fileIn,
      h('div', { class: 'field-label' }, 'Затемнение'), dim,
      h('label', { class: 'th-check' }, h('input', { type: 'checkbox', checked: st.blur, onchange: (e) => { st.blur = e.target.checked; paint(); } }), 'Размыть фон'),
      h('label', { class: 'th-check' }, h('input', { type: 'checkbox', checked: st.pattern, onchange: (e) => { st.pattern = e.target.checked; } }), 'Лимонный узор поверх'),
      h('p', { class: 'muted small' }, 'Обои ставятся только для этого чата и только на этом устройстве.')),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Поставить', primary: true, onClick: async (c) => {
        S.settings.chatWalls = { ...(S.settings.chatWalls || {}) };
        if (!st.type) delete S.settings.chatWalls[chat.id];
        else {
          if (st.type === 'photo' && photoBlob) {
            try { await idb('readwrite', (s) => s.put(photoBlob, `c${chat.id}`)); } catch { return toast('Не хватает места для фото', 'error'); }
            const old = photoCache.get(chat.id); if (old) URL.revokeObjectURL(old);
            photoCache.delete(chat.id);
          }
          if (st.type === 'photo' && !photoBlob && !(await photoUrl(chat.id))) return toast('Выберите фото', 'error');
          S.settings.chatWalls[chat.id] = { type: st.type, value: st.value, dim: st.dim, blur: st.blur, pattern: st.pattern };
        }
        save(); c();
        applyChatWall(pane, chat.id);
        toast(st.type ? 'Обои поставлены 🖼' : 'Обои как в теме');
      } },
    ],
  });
}

// ---------------------------------------------------------------- send effect

export function sendEffect(btn) {
  const fx = S?.settings?.sendFx || 'none';
  if (fx === 'none' || S.settings.reduceMotion) return;
  if (fx === 'pop') { btn?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(0.9)' }, { transform: 'scale(1)' }], { duration: 380 }); return; }
  const r = btn?.getBoundingClientRect();
  if (!r) return;
  const n = fx === 'confetti' ? 18 : 6;
  for (let i = 0; i < n; i++) {
    const s = h('span', { class: `send-fx send-fx-${fx}` }, fx === 'confetti' ? ['🎉', '✨', '🍋', '💚', '🎊'][i % 5] : '💬');
    s.style.left = `${r.left + r.width / 2}px`; s.style.top = `${r.top}px`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * (fx === 'confetti' ? 260 : 80)}px`);
    s.style.setProperty('--dy', `${-120 - Math.random() * (fx === 'confetti' ? 260 : 160)}px`);
    s.style.animationDelay = `${i * 18}ms`;
    document.body.append(s);
    setTimeout(() => s.remove(), 1300);
  }
}

// ---------------------------------------------------------------- the settings section

export function customSection({ section, row, seg, defaultsReactions }) {
  const inColors = h('div', { class: 'cu-colors' });
  const drawIn = () => inColors.replaceChildren(...IN_COLORS.map((c) => h('button', {
    type: 'button', class: `cu-dot ${c === 'auto' ? 'auto' : ''} ${(S.settings.bubbleIn || 'auto') === c ? 'on' : ''}`, style: c === 'auto' ? null : { background: c }, title: c === 'auto' ? 'Как в теме' : c,
    onclick: () => { S.settings.bubbleIn = c; save(); drawIn(); },
  }, c === 'auto' ? 'A' : '')));
  drawIn();
  const shapes = h('div', { class: 'cu-shapes' });
  const drawShapes = () => shapes.replaceChildren(...BUBBLE_SHAPES.map(([k, l]) => h('button', { type: 'button', class: `cu-shape s-${k} ${(S.settings.bubbleShape || 'round') === k ? 'on' : ''}`, onclick: () => { S.settings.bubbleShape = k; save(); drawShapes(); } },
    h('span', { class: 'cu-shape-demo' }, h('i'), h('i')), l)));
  drawShapes();
  const reacts = h('button', { class: 'set-row clickable', onclick: () => reactionsModal(defaultsReactions) },
    h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, 'Быстрые реакции'), h('div', { class: 'row-sub cu-react-line' }, quickReactions(defaultsReactions).slice(0, 8).join(' '))), icon('smile'));
  return section('palette', 'Кастомизация',
    h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Форма сообщений'), shapes),
    h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Цвет чужих сообщений'), inColors),
    row('Список чатов', null, seg('listDensity', DENSITY)),
    row('Эффект отправки', null, seg('sendFx', SEND_FX)),
    reacts,
    h('div', { class: 'set-note' }, '💡 Обои для отдельного чата — в меню ⋮ этого чата. Своё имя для контакта — в его профиле → «Ещё». Цвет имени и рамка аватарки — в редактировании профиля.'));
}
