// Small DOM toolkit. All user content goes through textContent — never innerHTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// ---------- icons (static, trusted markup) ----------

const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  send: '<path d="M3.4 20.4 21 12 3.4 3.6l-.1 6.6L15 12 3.3 13.8z" fill="currentColor" stroke="none"/>',
  attach: '<path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checks: '<path d="m2.5 12.5 4.5 4.5L16.5 7.5"/><path d="m11.5 16.5.5.5L21.5 7.5"/>',
  reply: '<path d="M10 8 4 13l6 5"/><path d="M4 13h10a6 6 0 0 1 6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14c2.3 0 4 1.2 4.6 3.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4.2-6 8-6s7 2 8 6"/>',
  bookmark: '<path d="M6 4h12v17l-6-4.5L6 21z"/>',
  bookmarkFill: '<path d="M6 4h12v17l-6-4.5L6 21z" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/><circle cx="12" cy="12" r="7"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  devices: '<rect x="3" y="4" width="13" height="10" rx="2"/><path d="M7 18h5"/><rect x="17" y="9" width="4.5" height="10" rx="1.5"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4.5V16a2.5 2.5 0 0 1-1-2z"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.8-1.6h2.2a3.9 3.9 0 0 0 3.9-3.9c0-4.1-3.8-7-8.5-7z"/><circle cx="7.7" cy="11" r="1.1"/><circle cx="10.5" cy="7.5" r="1.1"/><circle cx="15" cy="7.8" r="1.1"/>',
  leave: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 8 4 4-4 4M19 12H9"/>',
  at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.3a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ic ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

// ---------- avatars ----------

const GRADIENTS = [
  ['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed'],
];

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0], parts[1]] : [parts[0] || '?'];
  return chars.map((p) => Array.from(p)[0]).join('').toUpperCase();
}

export function avatar({ id = 0, name = '', src = null, saved = false, online = false }, size = 48) {
  const [a, b] = GRADIENTS[Math.abs(Number(id) || 0) % GRADIENTS.length];
  const el = h('div', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` } });
  if (saved) {
    el.style.background = 'linear-gradient(160deg, var(--accent-2), var(--accent))';
    el.append(icon('bookmarkFill', 'avatar-ic'));
  } else if (src) {
    el.append(h('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: false }));
  } else {
    el.style.background = `linear-gradient(160deg, ${a}, ${b})`;
    el.append(initials(name));
  }
  if (online) el.append(h('span', { class: 'online-dot' }));
  return el;
}

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, '0');
export const timeHM = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function listTime(t) {
  const d = new Date(t);
  const n = new Date();
  if (sameDay(d, n)) return timeHM(t);
  if (n - d < 6 * 864e5) return WEEKDAYS[d.getDay()];
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${d.getFullYear() !== n.getFullYear() ? `.${String(d.getFullYear()).slice(2)}` : ''}`;
}

export function dayLabel(t) {
  const d = new Date(t);
  const n = new Date();
  if (sameDay(d, n)) return 'Сегодня';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return 'Вчера';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

export function lastSeenText(user) {
  if (!user) return '';
  if (user.online) return 'в сети';
  const t = user.lastSeen;
  if (!t) return 'был(а) давно';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'был(а) только что';
  if (diff < 3600_000) {
    const m = Math.floor(diff / 60_000);
    return `был(а) ${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  }
  const d = new Date(t);
  if (sameDay(d, new Date())) return `был(а) сегодня в ${timeHM(t)}`;
  if (dayLabel(t) === 'Вчера') return `был(а) вчера в ${timeHM(t)}`;
  return `был(а) ${dayLabel(t)}`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function bytes(n) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

/** Text → nodes with safe http(s) links. */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}»]/gi;
export function richText(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let href = null;
    try {
      const u = new URL(m[0]);
      if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
    } catch { /* not a URL */ }
    out.push(href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, m[0]) : m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|\s)+$/u;
export function emojiCount(text) {
  if (!text || text.length > 40 || !EMOJI_ONLY.test(text)) return 0;
  return [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text.replace(/\s/g, ''))].length;
}

// ---------- toasts / modals / menus ----------

export function toast(text, kind = '') {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}` }, text);
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

let modalStack = [];
export function openModal({ title, body, actions = [], className = '', onClose } = {}) {
  const root = document.getElementById('modals');
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.classList.remove('show');
    modalStack = modalStack.filter((m) => m !== close);
    setTimeout(() => backdrop.remove(), 220);
    onClose?.();
  };
  const header = title !== undefined
    ? h('div', { class: 'modal-header' },
      h('div', { class: 'modal-title' }, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onclick: close }, icon('close')))
    : null;
  const footer = actions.length
    ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
      onclick: () => a.onClick?.(close),
    }, a.label)))
    : null;
  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true' }, header, h('div', { class: 'modal-body' }, body), footer);
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, dialog);
  root.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  modalStack.push(close);
  return { close, dialog };
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) { top(); return true; }
  return false;
}

export function confirmDialog(text, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      className: 'modal-small',
      body: h('p', { class: 'confirm-text' }, text),
      actions: [
        { label: 'Отмена', onClick: (close) => close() },
        { label: ok, primary: !danger, danger, onClick: (close) => { done = true; close(); } },
      ],
      onClose: () => resolve(done),
    });
    return m;
  });
}

let activeMenu = null;
export function closeMenu() {
  activeMenu?.remove();
  activeMenu = null;
}

/** Context menu at (x, y). items: [{ icon, label, danger, onClick }] */
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' }, items.filter(Boolean).map((it) => h('button', {
    class: `ctx-item ${it.danger ? 'danger' : ''}`,
    role: 'menuitem',
    onclick: () => { closeMenu(); it.onClick(); },
  }, icon(it.icon), it.label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - r.width - 8);
  const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  requestAnimationFrame(() => menu.classList.add('show'));
  activeMenu = menu;
}

document.addEventListener('mousedown', (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}, true);
document.addEventListener('touchstart', (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}, { capture: true, passive: true });
window.addEventListener('resize', closeMenu);

export const isTouch = () => matchMedia('(pointer: coarse)').matches;
