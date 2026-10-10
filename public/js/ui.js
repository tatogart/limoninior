// Small DOM toolkit. All user content goes through textContent — never innerHTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
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
  live: '<circle cx="12" cy="12" r="2.6"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  screen: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20M12 13V8M9.5 10.5 12 8l2.5 2.5"/>',
  more: '<circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>',
  pin: '<path d="M9.5 3.5h5l-.8 5.2 3.3 3.3v2H7v-2l3.3-3.3z"/><path d="M12 14v6.5"/>',
  unpin: '<path d="M9.5 3.5h5l-.8 5.2 3.3 3.3v2H7v-2l3.3-3.3z"/><path d="M12 14v6.5M4 4l16 16"/>',
  forward: '<path d="M13.5 5.5 20 12l-6.5 6.5"/><path d="M20 12H10a6 6 0 0 0-6 6v.5"/>',
  block: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
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
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1.8 2.2 5.2 2.2 7 0"/><path d="M9 9.5v.5M15 9.5v.5" stroke-width="2.4"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8c-1.5-3.5-5.5-4-5.5-1.5S10 8 12 8zM12 8c1.5-3.5 5.5-4 5.5-1.5S14 8 12 8z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  eyeSmall: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  share: '<path d="M14 5l7 7-7 7M21 12H9a6 6 0 0 0-6 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  phoneDown: '<path d="M3.5 14.5c4.7-4.2 12.3-4.2 17 0l-1.6 2.6-3.7-1.2v-2.6a10 10 0 0 0-6.4 0v2.6l-3.7 1.2z" fill="currentColor"/>',
  video: '<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3z"/>',
  videoOff: '<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3zM3 3l18 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M3 3l18 18"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  comment: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4.5V16a2.5 2.5 0 0 1-1-2z"/><path d="M8 8.5h8M8 12h5"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  volumeOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3M14 9l2 2"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4"/>',
  megaphone: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.3a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Verified "галочка" badge. */
export function badge() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'verified');
  svg.setAttribute('aria-label', 'Подтверждённый аккаунт');
  svg.innerHTML = '<path d="M12 1.8l2.4 1.9 3-.3 1.1 2.8 2.8 1.1-.3 3 1.9 2.4-1.9 2.4.3 3-2.8 1.1-1.1 2.8-3-.3L12 22.2l-2.4-1.9-3 .3-1.1-2.8-2.8-1.1.3-3L1.1 12l1.9-2.4-.3-3 2.8-1.1L6.6 2.7l3 .3z" fill="currentColor"/><path d="m7.8 12.3 2.8 2.8 5.6-5.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

/** Name followed by the verified badge when applicable. */
const SUB_EMOJI = { plus: '⭐', premium: '💎', max: '👑' };
export function nameWithBadge(name, user) {
  const out = [name];
  if (user?.verified) out.push(badge());
  if (user?.sub && SUB_EMOJI[user.sub]) out.push(h('span', { class: `sub-badge sub-${user.sub}`, title: `Limoninior ${user.sub[0].toUpperCase()}${user.sub.slice(1)}` }, SUB_EMOJI[user.sub]));
  return out;
}
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

export function avatar({ id = 0, name = '', src = null, saved = false, online = false, official = false }, size = 48) {
  const [a, b] = GRADIENTS[Math.abs(Number(id) || 0) % GRADIENTS.length];
  const el = h('div', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` } });
  if (official) {
    el.classList.add('official');
    el.append(h('img', { src: '/icons/icon-192.png', alt: '', draggable: false }));
  } else if (saved) {
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

// ---------- links: detection + safety check ----------

const TLDS = 'com|ru|net|org|io|xyz|top|info|biz|me|app|dev|su|рф|online|site|store|shop|club|pro|gg|tv|co|uk|de|ua|by|kz|click|link|live|zip|mov|icu|tk|ml|ga|cf|gq|ly|cc|ws|in|fun|space|website|tech|cam|rest|work|loan';
const URL_RE = new RegExp(
  `(?:\\bhttps?:\\/\\/[^\\s<>"']+[^\\s<>"'.,;:!?)\\]}»])|(?<![@\\w.\\-/а-яё])(?:[a-z0-9а-яё-]+\\.)+(?:${TLDS})(?![\\w-])(?:\\/[^\\s<>"']*[^\\s<>"'.,;:!?)\\]}»])?`,
  'giu');

const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'clck.ru', 'goo.su', 'is.gd', 't.ly', 'rebrand.ly', 'shorturl.at', 'vk.cc', 'ow.ly', 'u.to', 'qps.ru'];
const ODD_TLDS = ['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'click', 'icu', 'work', 'loan', 'rest', 'cam'];
const BAD_WORDS = /scam|phish|fraud|hack|free-?nitro|nitro-?gift|giveaway|airdrop|claim|free-?robux|steam-?gift|verify|wallet|prize|lottery|darknet|crack|keygen|stealer|grabber|bonus-|-bonus|login-|-login|secure-|-secure/;
const BRANDS = {
  steamcommunity: ['steamcommunity.com'], steampowered: ['steampowered.com'], discord: ['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'discordapp.net'],
  telegram: ['telegram.org', 't.me', 'telegram.me'], gosuslugi: ['gosuslugi.ru'], sberbank: ['sberbank.ru', 'sber.ru', 'sberbank.com'],
  tinkoff: ['tinkoff.ru', 'tbank.ru'], wildberries: ['wildberries.ru', 'wb.ru'], ozon: ['ozon.ru'], avito: ['avito.ru'],
  yandex: ['yandex.ru', 'ya.ru', 'yandex.com', 'yandex.net', 'yandex.kz'], paypal: ['paypal.com'], instagram: ['instagram.com'],
  whatsapp: ['whatsapp.com', 'wa.me'], vkontakte: ['vk.com'], youtube: ['youtube.com', 'youtu.be'], roblox: ['roblox.com'],
};
const EXEC_RE = /\.(exe|msi|apk|bat|cmd|scr|jar|vbs|ps1|dmg|pkg|iso|lnk)(\?|$)/i;

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const isOfficial = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** Heuristic safety check: { level: 'danger' | 'warn' | null, reasons: [] }. */
export function linkRisk(href) {
  let u;
  try { u = new URL(href); } catch { return { level: 'danger', reasons: ['Некорректный адрес'] }; }
  if (u.origin === location.origin) return { level: null, reasons: [] };
  const host = u.hostname.toLowerCase();
  const danger = [], warn = [];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) danger.push('Вместо домена указан IP-адрес');
  if (host.includes('xn--')) danger.push('В домене подменены буквы (похожие символы)');
  if (u.username || u.password) danger.push('Ссылка маскирует настоящий адрес');
  if (BAD_WORDS.test(host)) danger.push('В адресе есть слова, типичные для мошенников');
  for (const [brand, official] of Object.entries(BRANDS)) {
    if (isOfficial(host, official)) continue;
    const labels = host.split('.');
    const looksLike = brand.length >= 6 ? host.includes(brand) : labels.some((l) => l.startsWith(`${brand}-`) || l.endsWith(`-${brand}`));
    if (looksLike) { danger.push(`Похоже на подделку сайта ${official[0]}`); break; }
    if (brand.length >= 6 && labels.some((l) => l.length >= 5 && lev(l, brand) <= (brand.length >= 8 ? 2 : 1))) { danger.push(`Адрес очень похож на ${official[0]}, но это другой сайт`); break; }
  }
  if (EXEC_RE.test(u.pathname)) danger.push('Ссылка ведёт на программу или установщик');
  if (SHORTENERS.some((d) => host === d)) warn.push('Сокращённая ссылка — не видно, куда она ведёт');
  if (ODD_TLDS.includes(host.split('.').pop())) warn.push('Необычная доменная зона, часто используется для спама');
  if (u.protocol === 'http:') warn.push('Соединение без шифрования (http)');
  return { level: danger.length ? 'danger' : warn.length ? 'warn' : null, reasons: [...danger, ...warn] };
}

/** Text → nodes with safe, risk-annotated links. */
export function richText(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let href = null;
    try {
      const u = new URL(/^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`);
      if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
    } catch { /* not a URL */ }
    if (href) {
      const risk = linkRisk(href);
      out.push(h('a', {
        href, target: '_blank', rel: 'noopener noreferrer nofollow', class: `ext-link ${risk.level ? `link-${risk.level}` : ''}`,
        title: risk.reasons.join('\n') || href,
      }, m[0]));
      if (risk.level === 'danger') out.push(h('span', { class: 'link-alert' }, '⚠️ Осторожно, возможно опасно'));
      else if (risk.level === 'warn') out.push(h('span', { class: 'link-alert warn', title: risk.reasons.join('\n') }, '⚠️'));
    } else {
      out.push(m[0]);
    }
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

// ---------- system "Back" button (Android) ----------
// Every overlay (modal, story, drawer, menu) adds a history entry, so Back closes the
// top overlay instead of leaving the chat or the app. Closing an overlay any other way
// removes its entry again (history.go is batched, and the popstate it causes is ignored).
const overlays = []; // close functions to call when Back is pressed
let pendingBack = 0;
let ignorePops = 0;

/** Register an overlay; returns `release()` to call when it closes by itself. */
export function registerOverlay(closeOnBack) {
  overlays.push(closeOnBack);
  try { history.pushState({ ...(history.state || {}), overlay: (history.state?.overlay || 0) + 1 }, ''); } catch { /* ignore */ }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = overlays.lastIndexOf(closeOnBack);
    if (i < 0) return; // already closed by Back
    overlays.splice(i, 1);
    goBack();
  };
}

let leaving = false;
/** Go to another page. Use instead of `location.href = …` so a pending overlay "back" can't cancel it. */
export function navigate(url) {
  leaving = true;
  location.href = url;
}

/** history.back() that the popstate handler ignores, batched with overlay closes. */
export function goBack() {
  if (pendingBack++ === 0) {
    queueMicrotask(() => {
      const n = pendingBack;
      pendingBack = 0;
      if (leaving) return; // a page navigation is in progress: going back would cancel it
      ignorePops++;
      history.go(-n);
      // Safety net: if no popstate arrives (nothing to go back to), don't stay stuck.
      setTimeout(() => { if (ignorePops) { ignorePops = 0; flushSettled(); } }, 800);
    });
  }
}

// Callbacks waiting for our own pending history.go() to finish.
const settled = [];
function flushSettled() { settled.splice(0).forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
/** Run `cb` once pending overlay "back" steps have landed (immediately if none). */
export function afterHistory(cb) {
  if (pendingBack || ignorePops) settled.push(cb);
  else cb();
}

/** Call first in the popstate handler: true when the event was about an overlay. */
export function handleBack() {
  if (ignorePops) { if (!--ignorePops) flushSettled(); return true; }
  const top = overlays.pop();
  if (!top) return false;
  top();
  return true;
}

let modalStack = [];
export function openModal({ title, body, actions = [], className = '', onClose } = {}) {
  const root = document.getElementById('modals');
  let release = null;
  const close = (fromBack = false) => {
    if (!backdrop.isConnected) return;
    backdrop.classList.remove('show');
    modalStack = modalStack.filter((m) => m !== close);
    setTimeout(() => backdrop.remove(), 220);
    if (fromBack !== true) release?.();
    onClose?.();
  };
  const header = title !== undefined
    ? h('div', { class: 'modal-header' },
      h('div', { class: 'modal-title' }, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onclick: () => close() }, icon('close')))
    : null;
  const footer = actions.length
    ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
      onclick: (e) => a.onClick?.(() => close(), e.currentTarget),
    }, a.label)))
    : null;
  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true' }, header, h('div', { class: 'modal-body' }, body), footer);
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, dialog);
  root.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  modalStack.push(close);
  release = registerOverlay(() => close(true));
  return { close: () => close(), dialog };
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
let menuRelease = null;
export function closeMenu(fromBack = false) {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  const r = menuRelease;
  menuRelease = null;
  if (fromBack !== true) r?.();
}

/** Context menu at (x, y). items: [{ icon, label, danger, onClick }] */
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' }, items.filter(Boolean).map((it) => it.node || h('button', {
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
  menuRelease = registerOverlay(() => closeMenu(true));
}

document.addEventListener('mousedown', (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}, true);
document.addEventListener('touchstart', (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}, { capture: true, passive: true });
window.addEventListener('resize', () => closeMenu());

export const isTouch = () => matchMedia('(pointer: coarse)').matches;
