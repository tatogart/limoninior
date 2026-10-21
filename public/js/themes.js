// Personalization themes: lots of ready-made themes + your own theme editor.
// A theme overrides colors, chat wallpaper, bubble shape, font and an optional animated effect.
// Themes can be sent to a chat as a card — the other person applies it in one tap.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, isTouch } from './ui.js';

const FONTS = {
  system: { name: 'Обычный', css: '' },
  rounded: { name: 'Круглый', css: '"Nunito", "SF Pro Rounded", ui-rounded, "Varela Round", "Segoe UI", Roboto, sans-serif' },
  serif: { name: 'С засечками', css: 'Georgia, "Times New Roman", "PT Serif", serif' },
  mono: { name: 'Моно', css: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace' },
  hand: { name: 'Рукописный', css: '"Comic Sans MS", "Comic Neue", "Marker Felt", "Segoe Print", cursive' },
  narrow: { name: 'Узкий', css: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif-condensed, sans-serif' },
};
export const EFFECTS = {
  none: { name: 'Нет', chars: [] },
  snow: { name: 'Снег', chars: ['❄', '❅', '❆', '•'] },
  hearts: { name: 'Сердечки', chars: ['❤️', '💕', '💖', '💗'] },
  stars: { name: 'Звёзды', chars: ['✦', '✧', '⋆', '✨'] },
  lemons: { name: 'Лимоны', chars: ['🍋', '🍋', '✨'] },
  leaves: { name: 'Листья', chars: ['🍂', '🍁', '🍃'] },
  bubbles: { name: 'Пузыри', chars: ['○', '◯', '∘'] },
  sakura: { name: 'Сакура', chars: ['🌸', '💮', '🌸'] },
  fire: { name: 'Искры', chars: ['🔥', '✨', '•'] },
};

// base: light | dark; wall: 3-4 mesh colors + backdrop; bubble: outgoing bubble color (optional).
const T = (id, name, emoji, base, accent, accent2, wall, more = {}) => ({ id, name, emoji, base, accent, accent2, wall, radius: 18, font: 'system', effect: 'none', pattern: false, ...more });
export const PRESETS = [
  T('lemonade', 'Лимонад', '🍋', 'light', '#5cb85c', '#c3e15a', ['#d9f99d', '#bbf7d0', '#fef08a', '#fbfde8'], { pattern: true }),
  T('sky', 'Небо', '☁️', 'light', '#3390ec', '#6fc3ff', ['#bae6fd', '#c7d2fe', '#e0f2fe', '#f8fbff']),
  T('sakura', 'Сакура', '🌸', 'light', '#e5568d', '#ffb3cf', ['#fbcfe8', '#fde2e4', '#f5d0fe', '#fff5f8'], { effect: 'sakura', font: 'rounded', radius: 22 }),
  T('peach', 'Персик', '🍑', 'light', '#f08c2e', '#ffc58f', ['#fed7aa', '#fecaca', '#fde68a', '#fff8f1'], { font: 'rounded' }),
  T('mint', 'Мята', '🌿', 'light', '#16a99c', '#70e2cd', ['#a7f3d0', '#99f6e4', '#d9f99d', '#f3fffb']),
  T('lavender', 'Лаванда', '💜', 'light', '#8774e1', '#c0a6ff', ['#ddd6fe', '#e9d5ff', '#c7d2fe', '#faf8ff'], { radius: 22 }),
  T('latte', 'Латте', '☕', 'light', '#a16207', '#d6a76c', ['#f5e6d3', '#ead7c0', '#fdf3e7', '#fbf7f2'], { font: 'serif', bubble: '#f1dfc6', pattern: true }),
  T('watermelon', 'Арбуз', '🍉', 'light', '#e11d48', '#4ade80', ['#fecdd3', '#bbf7d0', '#fda4af', '#fff7f8'], { radius: 24 }),
  T('rainbow', 'Радуга', '🌈', 'light', '#8b5cf6', '#f472b6', ['#fca5a5', '#fde68a', '#86efac', '#93c5fd'], { radius: 22, effect: 'stars' }),
  T('paper', 'Бумага', '📜', 'light', '#334155', '#94a3b8', ['#f1f5f9', '#e2e8f0', '#f8fafc', '#ffffff'], { font: 'serif', radius: 8, bubble: '#e2e8f0', pattern: true }),
  T('icecream', 'Пломбир', '🍦', 'light', '#ec4899', '#38bdf8', ['#fbcfe8', '#bae6fd', '#fef9c3', '#fffdf5'], { font: 'rounded', radius: 26, effect: 'bubbles' }),
  T('autumn', 'Осень', '🍁', 'light', '#c2410c', '#f59e0b', ['#fed7aa', '#fde68a', '#fecaca', '#fffaf3'], { effect: 'leaves', font: 'serif' }),
  T('midnight', 'Полночь', '🌙', 'dark', '#6ea8fe', '#a5b4fc', ['#1e3a8a', '#312e81', '#0f172a', '#0b1020'], { bg: '#0f1626', bg2: '#1a2336' }),
  T('space', 'Космос', '🪐', 'dark', '#a78bfa', '#f0abfc', ['#4c1d95', '#1e1b4b', '#701a75', '#05030f'], { bg: '#0d0b1a', bg2: '#1a1530', effect: 'stars' }),
  T('neon', 'Неон', '💡', 'dark', '#22d3ee', '#f472b6', ['#0e7490', '#86198f', '#1e1b4b', '#06060c'], { bg: '#0a0a12', bg2: '#16162a', font: 'mono', radius: 10, bubble: '#3b0764' }),
  T('matrix', 'Матрица', '🟩', 'dark', '#22c55e', '#86efac', ['#052e16', '#14532d', '#022c22', '#000000'], { bg: '#020a05', bg2: '#0b1a10', font: 'mono', radius: 4, bubble: '#14532d' }),
  T('forest', 'Лес', '🌲', 'dark', '#4ade80', '#bef264', ['#14532d', '#365314', '#064e3b', '#07130c'], { bg: '#0d1a12', bg2: '#16261b', effect: 'leaves' }),
  T('volcano', 'Вулкан', '🌋', 'dark', '#f97316', '#facc15', ['#7c2d12', '#991b1b', '#451a03', '#0c0503'], { bg: '#160b07', bg2: '#25140d', effect: 'fire' }),
  T('ocean-deep', 'Глубина', '🐋', 'dark', '#38bdf8', '#2dd4bf', ['#0c4a6e', '#134e4a', '#1e3a8a', '#020617'], { bg: '#071422', bg2: '#0f2234', effect: 'bubbles' }),
  T('amethyst', 'Аметист', '🔮', 'dark', '#c084fc', '#e879f9', ['#581c87', '#4a044e', '#312e81', '#0a0612'], { bg: '#120b1c', bg2: '#1f1530', radius: 22 }),
  T('chocolate', 'Шоколад', '🍫', 'dark', '#d6a76c', '#f5d0a9', ['#422006', '#3f1d0b', '#292524', '#0f0a07'], { bg: '#17110c', bg2: '#251c15', font: 'serif', bubble: '#5b3a1e' }),
  T('aurora-night', 'Сияние', '🌌', 'dark', '#2dd4bf', '#a78bfa', ['#115e59', '#4c1d95', '#166534', '#030712'], { bg: '#08111a', bg2: '#122030', effect: 'stars' }),
  T('newyear', 'Новый год', '🎄', 'dark', '#ef4444', '#22c55e', ['#7f1d1d', '#14532d', '#1e3a8a', '#050a14'], { bg: '#0b1220', bg2: '#162033', effect: 'snow', font: 'rounded' }),
  T('amoled', 'Чёрная', '⚫', 'dark', '#e5e7eb', '#9ca3af', ['#111111', '#000000', '#0a0a0a', '#000000'], { bg: '#000000', bg2: '#121212', bubble: '#262626' }),
  T('valentine', 'Валентинка', '💘', 'dark', '#fb7185', '#f9a8d4', ['#881337', '#831843', '#4c0519', '#0f0408'], { bg: '#1a0a10', bg2: '#2a1219', effect: 'hearts', font: 'hand', radius: 24 }),
  T('lemon-night', 'Ночной лимон', '🍋', 'dark', '#facc15', '#a3e635', ['#3f6212', '#713f12', '#14532d', '#0b0d05'], { bg: '#11140a', bg2: '#1c2112', effect: 'lemons' }),
];

let S = null; // app state
let onApplied = null;
export function initThemes(state, cb) { S = state; onApplied = cb; }

const HEX = /^#[0-9a-f]{6}$/i;
/** Make any incoming theme object safe to use (it may come from another person). */
export function cleanTheme(t) {
  if (!t || typeof t !== 'object') return null;
  const col = (v, d) => (HEX.test(v) ? v.toLowerCase() : d);
  const wall = (Array.isArray(t.wall) ? t.wall : []).slice(0, 4).map((c) => col(c, null)).filter(Boolean);
  if (wall.length < 2) return null;
  while (wall.length < 4) wall.push(wall[wall.length - 1]);
  return {
    id: /^[a-z0-9-]{1,40}$/.test(t.id) ? t.id : `my-${Date.now().toString(36)}`,
    name: String(t.name || 'Моя тема').slice(0, 30),
    emoji: [...String(t.emoji || '🎨')].slice(0, 2).join(''),
    base: t.base === 'dark' ? 'dark' : 'light',
    accent: col(t.accent, '#5cb85c'),
    accent2: col(t.accent2, '#c3e15a'),
    wall,
    bubble: col(t.bubble, null),
    bg: col(t.bg, null),
    bg2: col(t.bg2, null),
    radius: Math.min(28, Math.max(2, Math.round(Number(t.radius) || 18))),
    font: FONTS[t.font] ? t.font : 'system',
    effect: EFFECTS[t.effect] ? t.effect : 'none',
    pattern: !!t.pattern,
    custom: !!t.custom,
  };
}

export const myThemes = () => (Array.isArray(S.settings.myThemes) ? S.settings.myThemes.map(cleanTheme).filter(Boolean) : []);
export function currentTheme() {
  const id = S.settings.themeId;
  if (!id) return null;
  return myThemes().find((t) => t.id === id) || PRESETS.find((t) => t.id === id) || null;
}

const meshOf = (t) => {
  const [a, b, c, d] = t.wall;
  const k = t.base === 'dark' ? 55 : 75;
  return `radial-gradient(60% 55% at 12% 18%, color-mix(in srgb, ${a} ${k}%, transparent), transparent 70%),
    radial-gradient(55% 50% at 88% 12%, color-mix(in srgb, ${b} ${k}%, transparent), transparent 70%),
    radial-gradient(60% 60% at 80% 85%, color-mix(in srgb, ${c} ${k}%, transparent), transparent 70%),
    linear-gradient(160deg, ${d}, color-mix(in srgb, ${d} 85%, ${a}))`;
};

const VARS = ['--accent', '--accent-2', '--wall-img', '--wall-pattern', '--bubble-out', '--bg', '--bg-2', '--hover', '--font-ui', '--radius', '--glass', '--glass-strong', '--glass-solid'];

/** Apply the chosen theme on top of the base settings (called from applyTheme in app.js). */
export function applyCustomTheme(root = document.documentElement) {
  for (const v of VARS) root.style.removeProperty(v);
  const t = currentTheme();
  root.dataset.custom = t ? t.id : '';
  S.settings.themeBase = t ? t.base : null;
  renderEffect(t);
  if (!t) return null;
  const set = (k, v) => v && root.style.setProperty(k, v);
  root.dataset.theme = t.base;
  set('--accent', t.accent);
  set('--accent-2', t.accent2);
  set('--wall-img', meshOf(t));
  set('--wall-pattern', t.pattern ? 'var(--pattern)' : 'none');
  set('--bubble-out', t.bubble || (t.base === 'dark' ? `color-mix(in srgb, ${t.accent} 42%, ${t.bg || '#182533'})` : `color-mix(in srgb, ${t.accent} 24%, #ffffff)`));
  if (t.bg) {
    set('--bg', t.bg);
    set('--bg-2', t.bg2 || t.bg);
    set('--hover', `color-mix(in srgb, ${t.bg2 || t.bg} 70%, ${t.bg})`);
    set('--glass', `color-mix(in srgb, ${t.bg} 55%, transparent)`);
    set('--glass-strong', `color-mix(in srgb, ${t.bg} 75%, transparent)`);
    set('--glass-solid', `color-mix(in srgb, ${t.bg} 85%, transparent)`);
  }
  if (FONTS[t.font].css) set('--font-ui', FONTS[t.font].css);
  set('--radius', `${t.radius}px`);
  return t;
}

// ---------------------------------------------------------------- animated effect over the chat wallpaper

function renderEffect(t) {
  document.querySelectorAll('.fx-layer').forEach((x) => x.remove());
  const fx = t && EFFECTS[t.effect];
  if (!fx?.chars.length || S.settings.reduceMotion || S.settings.themeFx === false) return;
  const pane = document.querySelector('.chat-pane');
  if (!pane) return;
  pane.prepend(effectLayer(t.effect));
}
export function effectLayer(effect, n = 16) {
  const fx = EFFECTS[effect];
  const layer = h('div', { class: `fx-layer fx-${effect}`, 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    const s = h('span', {}, fx.chars[i % fx.chars.length]);
    s.style.left = `${(i * 61) % 100}%`;
    s.style.animationDelay = `${-((i * 1.7) % 14)}s`;
    s.style.animationDuration = `${10 + ((i * 3) % 9)}s`;
    s.style.fontSize = `${12 + ((i * 7) % 14)}px`;
    layer.append(s);
  }
  return layer;
}
/** The chat pane is re-created on navigation: keep the effect layer in it. */
export function ensureEffect() {
  const pane = document.querySelector('.chat-pane');
  if (pane && !pane.querySelector('.fx-layer')) renderEffect(currentTheme());
}

// ---------------------------------------------------------------- UI

function preview(t, { big = false } = {}) {
  const dark = t.base === 'dark';
  const out = t.bubble || `color-mix(in srgb, ${t.accent} ${dark ? 42 : 24}%, ${dark ? (t.bg || '#182533') : '#ffffff'})`;
  return h('div', { class: `th-prev ${big ? 'big' : ''}`, style: { background: meshOf(t), '--r': `${Math.min(t.radius, 18)}px`, fontFamily: FONTS[t.font].css || 'inherit' } },
    t.effect !== 'none' && big ? effectLayer(t.effect, 10) : null,
    h('i', { class: 'th-b in', style: { background: dark ? (t.bg2 || '#182533') : '#fff', color: dark ? '#fff' : '#111' } }, big ? 'Привет! Как тебе тема?' : ''),
    h('i', { class: 'th-b out', style: { background: out, color: dark ? '#fff' : '#111' } }, big ? 'Огонь 🔥' : ''),
    h('b', { class: 'th-dot', style: { background: t.accent } }));
}

function card(t, onPick, extra) {
  const on = S.settings.themeId === t.id;
  return h('div', { class: `th-card ${on ? 'on' : ''}` },
    h('button', { class: 'th-pick', onclick: () => onPick(t), title: t.name }, preview(t),
      h('span', { class: 'th-name' }, h('span', {}, t.emoji), t.name)),
    extra || null);
}

function setTheme(id) {
  S.settings.themeId = id || null;
  onApplied?.();
}

/** The big themes gallery. */
export function themesModal() {
  const body = h('div', { class: 'th-gallery' });
  const render = () => {
    const mine = myThemes();
    const pick = (t) => { setTheme(S.settings.themeId === t.id ? null : t.id); render(); };
    const share = (t) => shareThemeModal(t);
    body.replaceChildren(...[
      h('div', { class: 'th-top' },
        h('button', { class: `th-std ${S.settings.themeId ? '' : 'on'}`, onclick: () => { setTheme(null); render(); } }, icon('sparkles'), 'Стандартная'),
        h('div', { class: 'th-top-acts' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => codeModal(render) }, 'Ввести код'),
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => themeEditor(null, render) }, icon('plus'), 'Создать свою'))),
      mine.length ? h('div', { class: 'th-sec' }, `Мои темы · ${mine.length}`) : null,
      mine.length ? h('div', { class: 'th-grid' }, mine.map((t) => card(t, pick, h('div', { class: 'th-acts' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Изменить', onclick: () => themeEditor(t, render) }, icon('edit')),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Поделиться', onclick: () => share(t) }, icon('share')))))) : null,
      h('div', { class: 'th-sec' }, 'Светлые'),
      h('div', { class: 'th-grid' }, PRESETS.filter((t) => t.base === 'light').map((t) => card(t, pick, h('div', { class: 'th-acts' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Поделиться', onclick: () => share(t) }, icon('share')))))),
      h('div', { class: 'th-sec' }, 'Тёмные'),
      h('div', { class: 'th-grid' }, PRESETS.filter((t) => t.base === 'dark').map((t) => card(t, pick, h('div', { class: 'th-acts' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Поделиться', onclick: () => share(t) }, icon('share')))))),
      h('label', { class: 'th-fx-toggle' }, h('input', { type: 'checkbox', checked: S.settings.themeFx !== false, onchange: (e) => { S.settings.themeFx = e.target.checked; onApplied?.(); } }),
        'Анимированные эффекты тем (снег, сердечки…)')].filter(Boolean));
  };
  render();
  openModal({ title: 'Темы', className: 'modal-themes', body });
}

/** Create or edit your own theme with a live preview. */
export function themeEditor(existing, done, draft = false) {
  if (draft) { const d = existing; existing = d.editingId ? myThemes().find((x) => x.id === d.editingId) : null; return themeEditorWith(d, existing, done); }
  return themeEditorWith(null, existing, done);
}
function themeEditorWith(draftTheme, existing, done) {
  let t = cleanTheme(draftTheme || existing || { ...(currentTheme() || PRESETS[0]), id: undefined, name: 'Моя тема', emoji: '🎨' });
  t.custom = true;
  const prevBox = h('div', { class: 'th-editor-prev' });
  const redraw = () => prevBox.replaceChildren(preview(t, { big: true }));
  const color = (label, key, i) => {
    const val = i === undefined ? t[key] : t[key][i];
    const inp = h('input', { type: 'color', value: val || '#888888' });
    inp.addEventListener('input', () => { if (i === undefined) t[key] = inp.value; else t[key][i] = inp.value; redraw(); });
    return h('label', { class: 'th-color' }, inp, h('span', {}, label));
  };
  const chips = (obj, key) => {
    const el = h('div', { class: 'th-chips' });
    const draw = () => el.replaceChildren(...Object.entries(obj).map(([k, v]) => h('button', { type: 'button', class: `rw-chip ${t[key] === k ? 'on' : ''}`, style: key === 'font' ? { fontFamily: v.css || 'inherit' } : null, onclick: () => { t[key] = k; draw(); redraw(); } }, v.name)));
    draw();
    return el;
  };
  const seg = h('div', { class: 'segmented' });
  const drawSeg = () => seg.replaceChildren(...[['light', '☀️ Светлая'], ['dark', '🌙 Тёмная']].map(([v, l]) => h('button', { class: t.base === v ? 'on' : '', onclick: () => {
    t.base = v;
    if (v === 'dark' && !t.bg) { t.bg = '#111827'; t.bg2 = '#1f2937'; }
    if (v === 'light') { t.bg = null; t.bg2 = null; }
    drawSeg(); redraw();
  } }, l)));
  drawSeg();
  const name = h('input', { class: 'input', maxLength: 30, value: t.name, placeholder: 'Название' });
  const emoji = h('input', { class: 'input th-emoji-in', maxLength: 4, value: t.emoji });
  const radius = h('input', { type: 'range', class: 'range', min: 2, max: 28, value: t.radius });
  radius.addEventListener('input', () => { t.radius = Number(radius.value); redraw(); });
  const pattern = h('input', { type: 'checkbox', checked: t.pattern, onchange: (e) => { t.pattern = e.target.checked; redraw(); } });
  const bubbleAuto = h('input', { type: 'checkbox', checked: !t.bubble, onchange: (e) => { t.bubble = e.target.checked ? null : t.accent; redraw(); } });
  const random = () => {
    const hue = Math.floor(Math.random() * 360);
    const hsl = (hh, s, l) => { const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + hh / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`; };
    const dark = t.base === 'dark';
    t.accent = hsl(hue, 0.75, dark ? 0.62 : 0.5);
    t.accent2 = hsl((hue + 40) % 360, 0.8, 0.7);
    t.wall = [hsl((hue + 330) % 360, 0.8, dark ? 0.25 : 0.82), hsl((hue + 60) % 360, 0.8, dark ? 0.22 : 0.85), hsl((hue + 180) % 360, 0.6, dark ? 0.2 : 0.86), dark ? hsl(hue, 0.4, 0.06) : hsl(hue, 0.6, 0.97)];
    if (dark) { t.bg = hsl(hue, 0.3, 0.09); t.bg2 = hsl(hue, 0.25, 0.15); }
    m.close();
    themeEditor({ ...t, name: name.value, emoji: emoji.value, editingId: existing?.id }, done, true);
  };
  redraw();
  const m = openModal({
    title: existing ? 'Изменить тему' : 'Своя тема',
    className: 'modal-theme-editor',
    body: h('div', { class: 'th-editor' },
      prevBox,
      h('div', { class: 'th-editor-form' },
        h('div', { class: 'th-row' }, emoji, name),
        seg,
        h('button', { class: 'btn btn-ghost btn-sm', onclick: random }, '🎲 Случайные цвета'),
        h('div', { class: 'field-label' }, 'Цвета'),
        h('div', { class: 'th-colors' }, color('Акцент', 'accent'), color('Второй', 'accent2'),
          t.bubble ? color('Мои сообщения', 'bubble') : null,
          t.base === 'dark' ? color('Фон', 'bg') : null, t.base === 'dark' ? color('Панели', 'bg2') : null),
        h('label', { class: 'th-check' }, bubbleAuto, 'Цвет моих сообщений — от акцента'),
        h('div', { class: 'field-label' }, 'Обои чата'),
        h('div', { class: 'th-colors' }, color('1', 'wall', 0), color('2', 'wall', 1), color('3', 'wall', 2), color('Основа', 'wall', 3)),
        h('label', { class: 'th-check' }, pattern, 'Лимонный узор поверх обоев'),
        h('div', { class: 'field-label' }, 'Скругление сообщений'), radius,
        h('div', { class: 'field-label' }, 'Шрифт'), chips(FONTS, 'font'),
        h('div', { class: 'field-label' }, 'Эффект'), chips(EFFECTS, 'effect'))),
    actions: [
      existing ? { label: 'Удалить', danger: true, onClick: (close) => {
        S.settings.myThemes = myThemes().filter((x) => x.id !== existing.id);
        if (S.settings.themeId === existing.id) S.settings.themeId = null;
        onApplied?.(); close(); done?.();
      } } : { label: 'Отмена', onClick: (c) => c() },
      { label: 'Сохранить и включить', primary: true, onClick: (close) => {
        t = cleanTheme({ ...t, name: name.value.trim() || 'Моя тема', emoji: emoji.value.trim() || '🎨', id: existing?.id || `my-${Date.now().toString(36)}`, custom: true });
        const list = myThemes().filter((x) => x.id !== t.id);
        S.settings.myThemes = [t, ...list].slice(0, 30);
        S.settings.themeId = t.id;
        onApplied?.(); close(); done?.();
        toast('Тема сохранена 🎨');
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => name.focus(), 50);
}

// ---------------------------------------------------------------- sharing

let pickChat = null; // (title) => Promise<chatId|null>, from app.js
export function setChatPicker(fn) { pickChat = fn; }

function shareThemeModal(t) {
  const code = `LT1.${btoa(unescape(encodeURIComponent(JSON.stringify({ ...t, custom: undefined })))).replace(/=+$/, '')}`;
  openModal({
    title: `${t.emoji} ${t.name}`,
    className: 'modal-small',
    body: h('div', { class: 'stack' }, preview(t, { big: true }),
      h('p', { class: 'muted small' }, 'Отправьте тему в чат — собеседник включит её одним нажатием. Или скопируйте код темы.')),
    actions: [
      { label: 'Скопировать код', onClick: () => navigator.clipboard?.writeText(code).then(() => toast('Код темы скопирован'), () => toast(code)) },
      { label: 'Отправить в чат', primary: true, onClick: async (close) => {
        const chatId = await pickChat?.('Отправить тему');
        if (!chatId) return;
        try { await api.post(`/chats/${chatId}/theme`, { theme: t }); close(); toast('Тема отправлена'); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

function codeModal(done) {
  const inp = h('textarea', { class: 'input', rows: 3, placeholder: 'LT1.…' });
  openModal({
    title: 'Код темы', className: 'modal-small',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Вставьте код, которым с вами поделились.'), inp),
    actions: [{ label: 'Отмена', onClick: (c) => c() }, { label: 'Включить', primary: true, onClick: (c) => { if (importThemeCode(inp.value)) { c(); done?.(); } } }],
  });
}

/** Paste a theme code (LT1.…). */
export function importThemeCode(code) {
  try {
    const raw = String(code).trim().replace(/^LT1\./, '');
    const t = cleanTheme(JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))))));
    if (!t) throw new Error();
    installTheme(t);
    return true;
  } catch { toast('Не похоже на код темы', 'error'); return false; }
}

export function installTheme(theme) {
  const t = cleanTheme({ ...theme, custom: true });
  if (!t) return;
  const preset = PRESETS.find((p) => p.id === t.id);
  if (!preset) {
    t.id = myThemes().some((x) => x.id === t.id) ? t.id : `my-${Date.now().toString(36)}`;
    S.settings.myThemes = [t, ...myThemes().filter((x) => x.id !== t.id)].slice(0, 30);
  }
  S.settings.themeId = preset ? preset.id : t.id;
  onApplied?.();
  toast(`Тема «${t.name}» включена ${t.emoji}`);
}

/** A theme card inside a chat message. */
export function themeMsgEl(m) {
  const t = cleanTheme(m.extra?.theme);
  if (!t) return h('div', { class: 'muted' }, 'Тема');
  const on = S.settings.themeId === t.id || (currentTheme()?.name === t.name && currentTheme()?.accent === t.accent);
  return h('div', { class: 'th-msg' },
    preview(t, { big: true }),
    h('div', { class: 'th-msg-title' }, h('span', {}, t.emoji), h('b', {}, t.name), h('span', { class: 'muted small' }, t.base === 'dark' ? 'тёмная тема' : 'светлая тема')),
    h('button', { class: `btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'} btn-block`, onclick: (e) => { e.stopPropagation(); if (!on) installTheme(t); } }, on ? '✓ Тема включена' : 'Применить тему'));
}
