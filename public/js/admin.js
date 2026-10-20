// Limochat admin panel: a dashboard app of its own (sidebar sections, live pulse, moderation).
import { api, errorText } from './api.js';
import { h, icon, avatar, timeHM, dayLabel, lastSeenText, bytes, toast, confirmDialog, openModal, closeTopModal, nameWithBadge, contextMenu, plural } from './ui.js';
import { PLANS, planById } from './catalog.js';

const app = document.getElementById('app');
let until = 0;
const timers = new Set();
const every = (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; };
const stopTimers = () => { for (const t of timers) clearInterval(t); timers.clear(); };
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ru-RU') : n);
const when = (t) => `${dayLabel(t)} ${timeHM(t)}`;
const DETAIL_KEYS = { username: '@', text: '', title: '', ip: 'IP ', ips: 'IP: ', reason: '', hours: 'ч: ', plan: '', months: 'мес.: ', amount: '🍋 ', recipients: 'получателей: ', audience: '', removed: 'удалено: ', resolution: '', action: '', bytes: '' };
/** Audit details are stored as JSON — show them as a readable line. */
function details(raw) {
  if (!raw || raw[0] !== '{') return raw || '';
  try {
    const o = JSON.parse(raw);
    return Object.entries(o).filter(([k, v]) => v != null && v !== '' && !/Id$/.test(k) && k !== 'userId').map(([k, v]) => {
      if (k === 'bytes') return bytes(v);
      if (Array.isArray(v)) return `${DETAIL_KEYS[k] ?? ''}${v.join(', ')}`;
      if (typeof v === 'object') return Object.entries(v).filter(([, x]) => x === false).map(([x]) => `${x} выкл.`).join(', ');
      return `${DETAIL_KEYS[k] ?? ''}${v}`;
    }).filter(Boolean).join(' · ');
  } catch { return raw; }
}

async function boot() {
  try {
    const s = await api.get('/admin/status');
    until = s.until;
    s.elevated ? shell() : lockScreen();
  } catch {
    location.replace('/');
  }
}

function handle(e) {
  if (e.code === 'totp_required') return lockScreen();
  if (e.status === 404 || e.status === 401) return location.replace('/');
  toast(errorText(e), 'error');
}
const call = async (fn, okText) => { try { const r = await fn(); if (okText) toast(okText); return r || true; } catch (e) { handle(e); return null; } };

// ================================================================ lock screen

function lockScreen() {
  stopTimers();
  V = {};
  if (document.querySelector('.otp')) return;
  const cells = Array.from({ length: 6 }, () => h('input', { class: 'otp-cell', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': 'Цифра кода' }));
  const remember = h('input', { type: 'checkbox', checked: true });
  const box = h('div', { class: 'otp' }, cells);
  const submit = async () => {
    const code = cells.map((c) => c.value).join('');
    if (code.length !== 6) return;
    cells.forEach((c) => { c.disabled = true; });
    try {
      const r = await api.post('/admin/unlock', { code, remember: remember.checked });
      until = r.until;
      shell();
    } catch (e) {
      cells.forEach((c) => { c.disabled = false; c.value = ''; });
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      cells[0].focus();
      toast(errorText(e), 'error');
    }
  };
  cells.forEach((c, i) => {
    c.addEventListener('input', () => {
      const digits = c.value.replace(/\D/g, '');
      if (digits.length > 1) {
        digits.slice(0, 6).split('').forEach((dg, j) => { if (cells[j]) cells[j].value = dg; });
        cells[Math.min(digits.length, 5)].focus();
      } else {
        c.value = digits;
        if (digits && cells[i + 1]) cells[i + 1].focus();
      }
      if (cells.every((x) => x.value)) submit();
    });
    c.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !c.value && cells[i - 1]) cells[i - 1].focus(); });
  });
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }),
    h('div', { class: 'login-card' },
      h('img', { class: 'lock-logo', src: '/icons/icon.svg', alt: '' }),
      h('h1', {}, 'Limochat · Админ'),
      h('p', { class: 'login-sub' }, 'Введите 6-значный код из приложения-аутентификатора.'),
      box,
      h('label', { class: 'remember-row' }, remember, 'Запомнить это устройство на 30 дней'),
      h('p', { class: 'login-foot' }, 'Доступ ограничен. Все попытки записываются в журнал.'),
      h('a', { class: 'link-btn', href: '/' }, icon('back'), 'Вернуться в мессенджер'))));
  cells[0].focus();
}

// ================================================================ charts (inline SVG)

function areaChart(series, { color = 'var(--accent)', height = 160, label = '' } = {}) {
  const w = 600, hgt = height, pad = 22;
  const max = Math.max(1, ...series.map((p) => p.n));
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, series.length - 1);
  const y = (n) => hgt - 20 - (n / max) * (hgt - 40);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.n).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)} ${hgt - 20} L${x(0)} ${hgt - 20} Z`;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  const ticks = series.map((p, i) => (i % Math.ceil(series.length / 6) === 0 || i === series.length - 1
    ? `<text x="${x(i).toFixed(1)}" y="${hgt - 4}" text-anchor="middle">${p.d.slice(8)}.${p.d.slice(5, 7)}</text>` : '')).join('');
  const dots = series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.n).toFixed(1)}" r="9" class="hit"><title>${p.d}: ${p.n}</title></circle>`).join('');
  const el = h('div', { class: 'chart' });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" aria-label="${label}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pad}" x2="${w - pad}" y1="${y(max)}" y2="${y(max)}" class="grid"/><line x1="${pad}" x2="${w - pad}" y1="${y(max / 2)}" y2="${y(max / 2)}" class="grid"/>
    <path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${dots}<g class="ticks">${ticks}</g><text x="${pad}" y="${y(max) - 5}" class="maxlbl">${max}</text></svg>`;
  return el;
}

function sparkline(values, color = 'var(--accent)') {
  const w = 160, hgt = 40;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i * w) / Math.max(1, values.length - 1)).toFixed(1)},${(hgt - 3 - (v / max) * (hgt - 6)).toFixed(1)}`).join(' ');
  const el = h('div', { class: 'spark' });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  return el;
}

function heatmap(cells) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of cells) grid[c.dow][c.hr] = c.n;
  const max = Math.max(1, ...cells.map((c) => c.n));
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return h('div', { class: 'heat' },
    ...order.map((dow, r) => h('div', { class: 'heat-row' }, h('span', { class: 'heat-day' }, days[r]),
      ...grid[dow].map((n, hr) => h('i', { title: `${days[r]} ${hr}:00 — ${n} сообщ.`, style: { opacity: n ? String(0.15 + (n / max) * 0.85) : '0.06' } })))),
    h('div', { class: 'heat-row heat-hours' }, h('span', { class: 'heat-day' }), ...Array.from({ length: 24 }, (_, i) => h('b', {}, i % 3 === 0 ? String(i) : ''))));
}

function hbars(items) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return h('div', { class: 'hbars' }, items.map((i) => h('div', { class: `hbar ${i.onClick ? 'link' : ''}`, onclick: i.onClick || null },
    h('div', { class: 'hbar-label' }, i.label), h('div', { class: 'hbar-track' }, h('i', { style: { width: `${Math.max(3, (i.n / max) * 100)}%` } })), h('b', {}, fmt(i.n)))));
}

const tile = (label, value, { sub, ic, tone, onClick } = {}) => h(onClick ? 'button' : 'div', { class: `tile ${tone || ''}`, onclick: onClick || null },
  h('div', { class: 'tile-ic' }, icon(ic || 'chat')),
  h('div', { class: 'tile-body' }, h('div', { class: 'tile-value' }, fmt(value)), h('div', { class: 'tile-label' }, label), sub ? h('div', { class: 'tile-sub' }, sub) : null));

const card = (title, body, extra) => h('section', { class: 'admin-card' }, h('div', { class: 'card-head' }, h('h2', {}, title), extra || null), body);
const empty = (t) => h('div', { class: 'list-note' }, t);
const spinner = () => h('div', { class: 'center-spin' }, h('span', { class: 'spinner' }));

// ================================================================ shell

const SECTIONS = [
  ['overview', 'Обзор', 'chart'],
  ['live', 'Пульс', 'live'],
  ['reports', 'Жалобы', 'warning'],
  ['users', 'Пользователи', 'user'],
  ['channels', 'Каналы', 'megaphone'],
  ['communities', 'Сообщества', 'community'],
  ['rewards', 'Роли и значки', 'crown'],
  ['broadcast', 'Рассылка', 'send'],
  ['platform', 'Платформа', 'settings'],
  ['security', 'Безопасность', 'shield'],
  ['server', 'Сервер', 'devices'],
  ['audit', 'Журнал', 'file'],
];
let V = {};
let lastReports = -1;

function shell() {
  stopTimers();
  V = {};
  V.main = h('main', { class: 'adm-main' });
  V.nav = h('nav', { class: 'adm-nav' }, SECTIONS.map(([k, label, ic]) => h('a', { class: 'adm-link', href: `#/${k}`, 'data-k': k },
    icon(ic), h('span', {}, label), k === 'reports' ? (V.repBadge = h('b', { class: 'adm-badge hidden' })) : null)));
  V.timer = h('span', { class: 'adm-timer' });
  V.pulse = h('span', { class: 'adm-online' }, h('i'), h('span', {}, '…'));
  app.replaceChildren(h('div', { class: 'adm' },
    h('aside', { class: 'adm-side' },
      h('a', { class: 'adm-brand', href: '#/overview' }, h('img', { src: '/icons/icon.svg', alt: '' }), h('div', {}, h('b', {}, 'Limochat'), h('span', {}, 'Админ-панель'))),
      V.nav,
      h('div', { class: 'adm-side-foot' }, V.timer,
        h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api.post('/admin/lock').catch(() => {}); lockScreen(); } }, icon('lock'), 'Заблокировать'),
        h('a', { class: 'btn btn-sm btn-ghost', href: '/' }, icon('back'), 'В мессенджер'))),
    h('div', { class: 'adm-content' },
      h('header', { class: 'adm-top' },
        h('a', { class: 'icon-btn adm-home', href: '/', 'aria-label': 'В мессенджер' }, icon('back')),
        V.title = h('h1', {}),
        V.pulse,
        h('button', { class: 'adm-search', onclick: palette }, icon('search'), h('span', {}, 'Поиск'), h('kbd', {}, 'Ctrl K'))),
      V.main)));
  const tick = () => {
    const left = Math.max(0, until - Date.now());
    V.timer.textContent = left > 3600_000 ? `доступ до ${new Date(until).toLocaleDateString('ru-RU')}` : `сессия ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (!left) lockScreen();
  };
  every(tick, 1000);
  tick();
  every(heartbeat, 5000);
  heartbeat();
  route();
}

async function heartbeat() {
  if (!V.pulse) return;
  try {
    const l = await api.get('/admin/live');
    if (!V.pulse) return;
    V.pulse.lastChild.textContent = `${l.online} онлайн`;
    V.repBadge.textContent = l.reports;
    V.repBadge.classList.toggle('hidden', !l.reports);
    if (lastReports >= 0 && l.reports > lastReports) toast(`🚩 Новая жалоба (${l.reports} в очереди)`);
    lastReports = l.reports;
    V.onLive?.(l);
  } catch (e) { handle(e); }
}

let current = '';
function route() {
  const [k, arg] = location.hash.replace(/^#\//, '').split('/');
  const sec = SECTIONS.find((s) => s[0] === k) ? k : 'overview';
  current = sec;
  V.onLive = null;
  for (const a of V.nav.children) a.classList.toggle('on', a.dataset.k === sec);
  V.nav.querySelector('.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  V.title.textContent = SECTIONS.find((s) => s[0] === sec)[1];
  V.main.replaceChildren(spinner());
  window.scrollTo(0, 0);
  const render = { overview, live, reports, users, channels, communities, rewards: rewardsPage, broadcast, platform: platformPage, security, server, audit }[sec];
  Promise.resolve(render(arg)).catch(handle);
}
window.addEventListener('hashchange', () => { if (V.main) { closeTopModal(); route(); } });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && V.main) { e.preventDefault(); palette(); }
  if (e.key === 'Escape' && document.querySelector('.modal-backdrop.show')) { e.preventDefault(); closeTopModal(); }
});
const go = (k) => { location.hash = `#/${k}`; };
const set = (...nodes) => { if (V.main) V.main.replaceChildren(...nodes.filter(Boolean)); };

// ================================================================ command palette

function palette() {
  const input = h('input', { class: 'input pal-input', placeholder: 'Пользователь, канал, сообщество или раздел…', autocomplete: 'off' });
  const list = h('div', { class: 'pal-list' });
  let items = [];
  let sel = 0;
  let m = null;
  const draw = () => list.replaceChildren(...(items.length ? items.map((it, i) => h('button', {
    class: `pal-item ${i === sel ? 'on' : ''}`, onmouseenter: () => { sel = i; draw(); }, onclick: () => { m.close(); it.go(); },
  }, it.ava || h('span', { class: 'pal-ic' }, icon(it.ic)), h('div', { class: 'grow' }, h('div', { class: 'row-main' }, it.title), it.sub ? h('div', { class: 'row-sub' }, it.sub) : null))) : [empty('Ничего не найдено')]));
  let t = null;
  const search = async () => {
    const qv = input.value.trim().toLowerCase();
    const secs = SECTIONS.filter(([, l]) => !qv || l.toLowerCase().includes(qv)).map(([k, l, ic]) => ({ title: l, sub: 'Раздел', ic, go: () => go(k) }));
    items = secs;
    sel = 0;
    draw();
    if (qv.length < 2) return;
    try {
      const r = await api.get(`/admin/search?q=${encodeURIComponent(qv)}`);
      if (input.value.trim().toLowerCase() !== qv) return;
      items = [
        ...r.users.map((u) => ({ ava: avatar(u, 34), title: `${u.name}${u.banned ? ' · бан' : ''}`, sub: u.username ? `@${u.username} · id ${u.id}` : `id ${u.id}`, go: () => dossier(u.id) })),
        ...r.chats.map((c) => ({ ic: c.type === 'channel' ? 'megaphone' : 'group', title: c.title, sub: c.type === 'channel' ? `канал${c.username ? ` @${c.username}` : ''}` : 'группа', go: () => go('channels') })),
        ...r.communities.map((c) => ({ ic: 'community', title: c.title, sub: 'сообщество', go: () => go('communities') })),
        ...secs,
      ];
      draw();
    } catch (e) { handle(e); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 180); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    if (e.key === 'Enter' && items[sel]) { m.close(); items[sel].go(); }
  });
  m = openModal({ className: 'modal-palette', body: h('div', { class: 'stack' }, input, list) });
  search();
  setTimeout(() => input.focus(), 30);
}

// ================================================================ overview

async function overview() {
  const o = await api.get('/admin/overview');
  const t = o.totals;
  const KIND = { text: 'Текст', image: 'Фото', sticker: 'Стикеры', voice: 'Голосовые', file: 'Файлы', gift: 'Подарки', call: 'Звонки', gcall: 'Групповые звонки', capsule: 'Капсулы', wheel: 'Колёса' };
  set(
    h('div', { class: 'tiles' },
      tile('Пользователи', t.users, { sub: `+${t.regs24} за сутки · ботов ${t.bots}`, ic: 'user' }),
      tile('Сейчас онлайн', t.online, { sub: `DAU ${t.dau} · WAU ${t.wau} · MAU ${t.mau}`, ic: 'live', tone: 'green', onClick: () => go('live') }),
      tile('Сообщения', t.messages, { sub: `+${fmt(t.messages24)} за сутки`, ic: 'chat' }),
      tile('Жалобы', t.reports, { sub: t.reports ? 'ждут решения' : 'очередь пуста', ic: 'warning', tone: t.reports ? 'red' : '', onClick: () => go('reports') }),
      tile('Сообщества', t.communities, { sub: `${t.groups} групп · ${t.channels} каналов`, ic: 'community', onClick: () => go('communities') }),
      tile('Подписчики', t.subscribers, { sub: 'Plus · Premium · Max', ic: 'crown', tone: 'gold' }),
      tile('Ограничения', t.banned + t.muted, { sub: `${t.banned} в бане · ${t.muted} без права писать`, ic: 'block' }),
      tile('Медиа на диске', bytes(t.mediaBytes), { sub: `🍋 ${fmt(t.coins)} лимонов у людей`, ic: 'image' })),
    t.verifyRequests ? h('button', { class: 'adm-alert', onclick: () => go('channels') }, icon('shield'), `Заявок на галочку: ${t.verifyRequests} — рассмотреть`) : null,
    h('div', { class: 'grid-2' },
      card('Сообщения за 30 дней', areaChart(o.msgs, { color: '#22c55e', label: 'сообщения' })),
      card('Активные пользователи (DAU)', areaChart(o.dauSeries, { color: '#3b82f6', label: 'DAU' }))),
    h('div', { class: 'grid-2' },
      card('Регистрации за 30 дней', areaChart(o.regs, { color: '#f59e0b', label: 'регистрации' })),
      card('Когда пишут (МСК, 4 недели)', heatmap(o.heat))),
    h('div', { class: 'grid-3' },
      card('Что отправляют (7 дней)', o.kinds.length ? hbars(o.kinds.map((k) => ({ label: KIND[k.kind] || k.kind, n: k.n }))) : empty('Пока пусто')),
      card('Самые активные чаты (24 ч)', o.topChats.length ? hbars(o.topChats.map((c) => ({ label: `${c.type === 'channel' ? '📢' : c.communityId ? '#' : '👥'} ${c.title || '—'}${c.community ? ` · ${c.community}` : ''}`, n: c.n }))) : empty('Тишина')),
      card('Самые активные люди (24 ч)', o.topSenders.length ? hbars(o.topSenders.map((u) => ({ label: u.name, n: u.n, onClick: () => dossier(u.id) }))) : empty('Тишина'))));
}

// ================================================================ live pulse

const liveHist = { online: [], perMinute: [], cpu: [] };
async function live() {
  const big = h('div', { class: 'pulse-big' }, h('i'), h('b', {}, '…'), h('span', {}, 'онлайн'));
  const stats = h('div', { class: 'tiles' });
  const feed = h('div', { class: 'feed' });
  set(h('div', { class: 'pulse-hero' }, big, h('p', { class: 'muted small' }, 'Обновляется каждые 5 секунд. Графики копятся, пока страница открыта.')), stats, card('Лента событий', feed));
  V.onLive = (l) => {
    for (const k of Object.keys(liveHist)) { liveHist[k].push(l[k]); if (liveHist[k].length > 120) liveHist[k].shift(); }
    big.children[1].textContent = fmt(l.online);
    const lt = (value, label, spark) => h('div', { class: 'tile' }, h('div', { class: 'tile-body' }, h('div', { class: 'tile-value' }, value), h('div', { class: 'tile-label' }, label)), spark || null);
    stats.replaceChildren(
      lt(fmt(l.online), `онлайн · ${l.sockets} подключений`, sparkline(liveHist.online, '#22c55e')),
      lt(fmt(l.perMinute), `сообщ./мин · ${fmt(l.perHour)} за час`, sparkline(liveHist.perMinute, '#3b82f6')),
      lt(`${l.cpu}%`, `CPU · задержка ${l.lag} мс · RAM ${bytes(l.rss)}`, sparkline(liveHist.cpu, '#f59e0b')),
      lt(fmt(l.calls.rooms), `звонков · ${l.calls.people} человек${l.calls.live ? ` · ${l.calls.live} эфир` : ''}`));
    feed.replaceChildren(...l.feed.map((a) => h('div', { class: `feed-row ${ALARM.has(a.action) ? 'alarm' : ''}` },
      h('span', { class: 'feed-time' }, timeHM(a.at)), h('b', {}, ACTIONS[a.action] || a.action), h('span', {}, a.username ? `@${a.username}` : ''), a.details ? h('span', { class: 'muted clip' }, details(a.details)) : null)));
  };
  heartbeat();
}

// ================================================================ reports

let repFilter = 'open';
async function reports() {
  const r = await api.get(`/admin/reports?status=${repFilter}`);
  const tabs = h('div', { class: 'segmented' }, [['open', 'Новые'], ['resolved', 'Решённые'], ['dismissed', 'Отклонённые']].map(([k, l]) =>
    h('button', { class: repFilter === k ? 'on' : '', onclick: () => { repFilter = k; reports(); } }, l)));
  set(h('div', { class: 'toolbar' }, tabs), h('div', { class: 'rep-list' }, ...(r.reports.length ? r.reports.map((x) => reportCard(x, r.reasons)) : [empty(repFilter === 'open' ? 'Жалоб нет — всё спокойно 🌿' : 'Пусто')])));
}

function reportCard(x, reasons) {
  const s = x.snapshot || {};
  const act = (label, action, opts = {}) => h('button', { class: `btn btn-sm ${opts.cls || 'btn-ghost'}`, onclick: async () => {
    if (opts.confirm && !(await confirmDialog(opts.confirm, { ok: 'Да', danger: true }))) return;
    const res = await call(() => api.post(`/admin/reports/${x.id}`, { action, hours: opts.hours || 0 }));
    if (res) { toast(`Готово: ${res.resolution}`); reports(); heartbeat(); }
  } }, label);
  const what = x.type === 'message'
    ? h('div', { class: 'rep-snap' },
      h('div', { class: 'rep-meta' }, `${s.sender?.name || 'Удалённый'}${s.sender?.username ? ` @${s.sender.username}` : ''} · ${s.chatTitle ? `«${s.chatTitle}»` : s.chatType === 'private' ? 'личный чат' : 'чат'}${s.at ? ` · ${when(s.at)}` : ''}`),
      s.file && /\.(jpe?g|png|webp|gif)$/i.test(s.file) ? h('img', { src: s.file, alt: '', class: 'rep-img', loading: 'lazy' }) : null,
      s.text ? h('div', { class: 'rep-text' }, s.text) : h('div', { class: 'muted small' }, `[${s.kind}]`),
      x.alive ? null : h('div', { class: 'pill danger' }, 'сообщение уже удалено'))
    : x.type === 'user'
      ? h('div', { class: 'rep-snap' }, h('div', { class: 'rep-meta' }, 'Профиль'), h('div', { class: 'rep-text' }, `${s.name} @${s.username || '—'}${s.bio ? `\n${s.bio}` : ''}`))
      : h('div', { class: 'rep-snap' }, h('div', { class: 'rep-meta' }, x.type === 'community' ? 'Сообщество' : s.type === 'channel' ? 'Канал' : 'Группа'),
        h('div', { class: 'rep-text' }, `${s.title}${s.username ? ` @${s.username}` : ''}${s.description ? `\n${s.description}` : ''}`));
  const open = x.status === 'open';
  const canPunish = x.offender && !x.offender.isAdmin;
  return h('article', { class: `rep-card ${open ? '' : 'done'}` },
    h('div', { class: 'rep-head' },
      h('span', { class: 'rep-reason' }, reasons[x.reason] || x.reason),
      x.weight > 1 ? h('span', { class: 'pill danger' }, `×${x.weight} жалоб`) : null,
      h('span', { class: 'muted small grow' }, `${{ message: 'сообщение', user: 'пользователь', chat: 'чат', community: 'сообщество' }[x.type]} · ${when(x.createdAt)}`),
      x.offender ? h('button', { class: 'rep-off', onclick: () => dossier(x.offender.id) }, avatar(x.offender, 26), h('span', {}, x.offender.name), x.offender.banned ? h('span', { class: 'pill danger' }, 'бан') : null) : null),
    what,
    x.comment ? h('div', { class: 'rep-comment' }, `💬 «${x.comment}»`) : null,
    h('div', { class: 'rep-by muted small' }, `пожаловался: ${x.reporter ? `${x.reporter.name}${x.reporter.username ? ` @${x.reporter.username}` : ''}` : '—'}${x.resolution ? ` · решение: ${x.resolution}` : ''}`),
    open ? h('div', { class: 'rep-actions' },
      x.type === 'message' && x.alive ? act('🗑 Удалить', 'delete', { cls: 'btn-primary' }) : null,
      x.type === 'message' && x.alive && canPunish ? act('🗑 + 🔇 24 ч', 'delete_mute', { hours: 24 }) : null,
      x.type === 'message' && x.alive && canPunish ? act('🗑 + бан 7 дн', 'delete_ban', { hours: 168, cls: 'btn-danger-ghost', confirm: 'Удалить сообщение и забанить автора на 7 дней?' }) : null,
      x.type === 'chat' || x.type === 'community' ? act('🗑 Удалить целиком', 'delete', { cls: 'btn-danger-ghost', confirm: 'Удалить это навсегда вместе с перепиской?' }) : null,
      canPunish ? act('🔇 24 ч', 'mute', { hours: 24 }) : null,
      canPunish ? act('⛔ Бан навсегда', 'ban', { cls: 'btn-danger-ghost', confirm: `Забанить ${x.offender.name} навсегда?` }) : null,
      x.offender ? act('⚠️ Предупредить', 'warn') : null,
      act('Отклонить', 'dismiss')) : null);
}

// ================================================================ users

let userFilter = 'all';
let userQuery = '';
async function users() {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Имя, @юзернейм, email', value: userQuery });
  const list = h('div', { class: 'users-list' }, spinner());
  const filters = h('div', { class: 'segmented small-seg' });
  const FILTERS = [['all', 'Все'], ['online', 'Онлайн'], ['subs', 'Подписка'], ['banned', 'Бан'], ['verified', 'С галочкой']];
  let rows = [];
  const draw = () => {
    filters.replaceChildren(...FILTERS.map(([k, l]) => h('button', { class: userFilter === k ? 'on' : '', onclick: () => { userFilter = k; draw(); } }, l)));
    const f = rows.filter((u) => userFilter === 'all' || (userFilter === 'online' && u.online) || (userFilter === 'subs' && u.sub) || (userFilter === 'banned' && u.banned) || (userFilter === 'verified' && u.verified));
    list.replaceChildren(...(f.length ? f.map((u) => h('button', { class: `user-row ${u.banned ? 'banned' : ''}`, onclick: () => dossier(u.id) },
      avatar({ id: u.id, name: u.name, src: u.avatar, online: u.online, official: u.official }, 44),
      h('div', { class: 'user-info' },
        h('div', { class: 'row-main' }, nameWithBadge(u.name, u), u.isAdmin ? h('span', { class: 'pill' }, 'админ') : null, u.official ? h('span', { class: 'pill' }, 'официальный') : null,
          u.banned ? h('span', { class: 'pill danger' }, 'бан') : null),
        h('div', { class: 'row-sub' }, `${u.username ? `@${u.username}` : 'без юзернейма'} · id ${u.id}${u.email ? ` · ${u.email}` : ''}`),
        h('div', { class: 'row-sub' }, `🍋 ${fmt(u.coins)} · ${fmt(u.messages)} сообщ. · рег. ${dayLabel(u.createdAt)} · ${lastSeenText(u)}`)),
      icon('back', 'chev'))) : [empty('Никого не найдено')]));
  };
  const load = async () => {
    try { rows = (await api.get(`/admin/users?q=${encodeURIComponent(userQuery)}`)).users; draw(); } catch (e) { handle(e); }
  };
  let t = null;
  search.addEventListener('input', () => { userQuery = search.value; clearTimeout(t); t = setTimeout(load, 250); });
  set(h('div', { class: 'toolbar' }, search, filters), card('Пользователи', list));
  draw();
  load();
}

// ---------------------------------------------------------------- dossier

async function dossier(id) {
  let d;
  try { d = await api.get(`/admin/users/${id}`); } catch (e) { return handle(e); }
  const u = d.user;
  const protectedUser = u.isAdmin || u.official;
  const refresh = () => { closeTopModal(); setTimeout(() => dossier(id), 240); if (current === 'users') users(); };
  const post = (path, body, ok) => call(() => api.post(`/admin/users/${id}/${path}`, body), ok).then((r) => { if (r) refresh(); return r; });
  const choose = (anchor, items) => { const r = anchor.getBoundingClientRect(); contextMenu(r.left, r.bottom + 4, items); };
  const status = [
    u.banned ? h('span', { class: 'pill danger' }, u.bannedUntil ? `бан до ${when(u.bannedUntil)}` : 'бан навсегда') : null,
    u.mutedUntil ? h('span', { class: 'pill warn' }, `без права писать до ${when(u.mutedUntil)}`) : null,
    u.online ? h('span', { class: 'pill' }, 'онлайн') : null,
    u.sub ? h('span', { class: 'pill gold' }, `${planById(u.sub)?.emoji} ${planById(u.sub)?.short} до ${new Date(u.subUntil).toLocaleDateString('ru-RU')}`) : null,
    u.isAdmin ? h('span', { class: 'pill' }, 'админ') : null, u.bot ? h('span', { class: 'pill' }, 'бот') : null,
  ].filter(Boolean);
  const btn = (label, fn, cls = 'btn-ghost') => h('button', { class: `btn btn-sm ${cls}`, onclick: fn }, label);
  const purge = async (hours) => {
    if (!(await confirmDialog(hours ? `Удалить сообщения ${u.name} за ${hours === 1 ? 'час' : 'сутки'}?` : `Удалить ВСЕ сообщения ${u.name}? Это нельзя отменить.`, { ok: 'Удалить', danger: true }))) return;
    const r = await call(() => api.post(`/admin/users/${id}/purge`, { hours }));
    if (r) { toast(`Удалено сообщений: ${r.removed}`); refresh(); }
  };
  const actions = h('div', { class: 'dos-actions' },
    btn('✉️ Написать от Limochat', () => dmDialog(u)),
    btn('🍋 Лимоны', () => coinsDialog(u, (body) => post('coins', body, 'Готово'))),
    btn(u.sub ? '👑 Подписка' : '👑 Выдать подписку', () => subDialog(u, (body) => post('subscription', body, 'Готово'))),
    btn(u.verified ? 'Снять галочку' : '✓ Галочка', () => post('verify', { verified: !u.verified }, 'Готово')),
    btn('🏆 Роли и значки', () => rewardsDialog(u)),
    protectedUser ? null : btn(u.mutedUntil ? '🔊 Вернуть право писать' : '🔇 Запретить писать…', (e) => (u.mutedUntil ? post('mute', { hours: 0 }, 'Ограничение снято')
      : choose(e.currentTarget, [1, 24, 168, 720].map((hh) => ({ icon: 'mute', label: hh < 24 ? '1 час' : `${hh / 24} ${plural(hh / 24, 'день', 'дня', 'дней')}`, onClick: () => post('mute', { hours: hh }, 'Ограничение включено') }))))),
    protectedUser ? null : u.banned ? btn('Разбанить', () => post('unban', {}, 'Разбанен'), 'btn-primary') : btn('⛔ Забанить…', () => banDialog(u, (body) => post('ban', body, 'Забанен')), 'btn-danger-ghost'),
    protectedUser ? null : btn('⛔ Бан + все IP', async () => { if (await confirmDialog(`Забанить ${u.name} и все его IP-адреса?`, { ok: 'Забанить', danger: true })) post('ban-ip', {}, 'Забанен вместе с IP'); }, 'btn-danger-ghost'),
    protectedUser ? null : btn('🧹 Удалить сообщения…', (e) => choose(e.currentTarget, [
      { icon: 'trash', label: 'За последний час', onClick: () => purge(1) },
      { icon: 'trash', label: 'За сутки', onClick: () => purge(24) },
      { icon: 'trash', label: 'Все сообщения', danger: true, onClick: () => purge(0) }]), 'btn-danger-ghost'),
    protectedUser ? null : btn('Выкинуть со всех устройств', async () => { if (await confirmDialog(`Завершить все сеансы ${u.name}?`, { ok: 'Завершить' })) post('logout', {}, 'Сеансы завершены'); }),
    protectedUser || !u.username ? null : btn('Сбросить @', async () => { if (await confirmDialog(`Сбросить юзернейм @${u.username}?`, { ok: 'Сбросить' })) post('reset-username', {}, 'Сброшен'); }));
  const st = d.stats;
  openModal({
    className: 'modal-dossier',
    title: 'Досье',
    body: h('div', { class: 'dos' },
      h('div', { class: 'dos-head' }, avatar({ ...u, src: u.avatar }, 72),
        h('div', { class: 'grow' }, h('div', { class: 'dos-name' }, nameWithBadge(u.name, u)),
          h('div', { class: 'muted small' }, `${u.username ? `@${u.username}` : 'без юзернейма'} · id ${u.id}${u.email ? ` · ${u.email}` : ''}`),
          h('div', { class: 'muted small' }, `регистрация ${when(u.createdAt)} · ${lastSeenText(u)}${u.referredBy ? ` · пришёл по ссылке ${u.referredBy.name}` : ''}`),
          h('div', { class: 'dos-pills' }, ...status))),
      u.banReason ? h('div', { class: 'adm-alert red' }, `Причина бана: ${u.banReason}`) : null,
      u.bio ? h('div', { class: 'dos-bio' }, u.bio) : null,
      h('div', { class: 'dos-stats' }, ...[
        ['сообщений', st.messages, `${st.messages7} за неделю`], ['чатов', st.chats], ['активных дней', st.activeDays30, 'из 30'], ['лимонов 🍋', u.coins],
        ['групп', st.groups], ['каналов', st.channels], ['сообществ', st.communities], ['пригласил', st.referrals],
        ['жалоб на него', st.reportsAgainst], ['его жалоб', st.reportsFiled]].map(([l, v, s]) => h('div', { class: `dos-stat ${l === 'жалоб на него' && v ? 'bad' : ''}` }, h('b', {}, fmt(v)), h('span', {}, l), s ? h('i', {}, s) : null))),
      h('div', { class: 'dos-sec' }, 'Активность за 14 дней'), areaChart(d.activity, { height: 110, color: '#8b5cf6' }),
      h('div', { class: 'dos-sec' }, 'Действия'), actions,
      h('div', { class: 'dos-sec' }, `Устройства (${d.sessions.length})`),
      h('div', { class: 'dos-list' }, ...(d.sessions.length ? d.sessions.map((s) => h('div', { class: 'dos-row' }, h('span', {}, s.kind === 'desktop' ? '💻' : s.kind === 'tablet' ? '📲' : '📱'),
        h('div', { class: 'grow' }, h('div', {}, `${s.browser}, ${s.os}`), h('div', { class: 'muted small' }, `${s.ip || '—'} · вход ${when(s.createdAt)} · был ${when(s.lastUsed)}`)),
        protectedUser ? null : btn('Выкинуть', async () => { if (await call(() => api.del(`/admin/sessions/${s.id}`), 'Сеанс завершён')) refresh(); }, 'btn-danger-ghost'))) : [empty('Нет активных сеансов')])),
      h('div', { class: 'dos-sec' }, `IP-адреса (${d.ips.length})`),
      h('div', { class: 'dos-list' }, ...(d.ips.length ? d.ips.map((x) => h('div', { class: 'dos-row' }, h('span', { class: 'mono' }, x.ip),
        h('div', { class: 'grow muted small' }, `${when(x.lastSeen)}${x.sharedWith ? ` · ещё ${x.sharedWith} акк. с этого IP` : ''}`),
        x.banned ? h('span', { class: 'pill danger' }, 'забанен') : null)) : [empty('Нет данных')])),
      h('div', { class: 'dos-sec' }, 'Журнал'),
      h('div', { class: 'dos-list' }, ...(d.audit.length ? d.audit.map((a) => h('div', { class: `dos-row small ${ALARM.has(a.action) ? 'alarm' : ''}` }, h('span', { class: 'muted' }, when(a.at)), h('b', {}, ACTIONS[a.action] || a.action), h('span', { class: 'muted clip grow' }, details(a.details)))) : [empty('Пусто')]))),
  });
}

function dmDialog(u) {
  const text = h('textarea', { class: 'input', rows: 4, maxLength: 4096, placeholder: 'Сообщение придёт от официального аккаунта Limochat ✓' });
  openModal({
    title: `Написать ${u.name}`, className: 'modal-small', body: text,
    actions: [{ label: 'Отмена', onClick: (c) => c() }, { label: 'Отправить', primary: true, onClick: async (close) => {
      if (!text.value.trim()) return text.focus();
      if (await call(() => api.post(`/admin/users/${u.id}/message`, { text: text.value }), 'Отправлено')) close();
    } }],
  });
  setTimeout(() => text.focus(), 50);
}

function banDialog(u, post) {
  let hours = 24 * 7;
  const reason = h('input', { class: 'input', maxLength: 300, placeholder: 'Причина — человек увидит её при входе' });
  const pick = h('div', { class: 'plan-pick' });
  const OPTS = [[24, 'Сутки'], [72, '3 дня'], [168, 'Неделя'], [720, 'Месяц'], [0, 'Навсегда']];
  const render = () => pick.replaceChildren(...OPTS.map(([v, l]) => h('button', { class: `btn btn-sm ${hours === v ? 'btn-primary' : 'btn-ghost'}`, onclick: () => { hours = v; render(); } }, l)));
  render();
  openModal({
    title: `Бан: ${u.name}`, className: 'modal-small',
    body: h('div', { class: 'stack' }, h('div', { class: 'small' }, 'Срок'), pick, reason, h('p', { class: 'muted small' }, 'Временный бан снимется сам. Все сеансы будут завершены сразу.')),
    actions: [{ label: 'Отмена', onClick: (c) => c() }, { label: 'Забанить', danger: true, onClick: async (close) => { if (await post({ hours, reason: reason.value })) close(); } }],
  });
}

function coinsDialog(u, post) {
  const inp = h('input', { class: 'input', type: 'number', placeholder: 'Например 500 или -100', step: 1 });
  openModal({
    title: `Лимоны для ${u.name}`, className: 'modal-small',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `Сейчас: 🍋 ${u.coins}. Положительное число — начислить, отрицательное — списать.`), inp,
      h('div', { class: 'quick' }, [100, 500, 1000, 5000].map((n) => h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { inp.value = n; } }, `+${n}`)))),
    actions: [{ label: 'Отмена', onClick: (c) => c() }, { label: 'Применить', primary: true, onClick: async (close) => {
      const n = Number(inp.value);
      if (!Number.isInteger(n) || n === 0) { inp.focus(); return toast('Введите целое число', 'error'); }
      if (await post({ amount: n })) close();
    } }],
  });
  setTimeout(() => inp.focus(), 50);
}

function subDialog(u, post) {
  let plan = u.sub || 'premium';
  let months = 1;
  const plansEl = h('div', { class: 'plan-pick' });
  const renderPlans = () => plansEl.replaceChildren(...PLANS.map((p) => h('button', { class: `btn btn-sm ${plan === p.id ? 'btn-primary' : 'btn-ghost'}`, onclick: () => { plan = p.id; renderPlans(); } }, `${p.emoji} ${p.short}`)));
  renderPlans();
  const monthsEl = h('div', { class: 'plan-pick' });
  const renderMonths = () => monthsEl.replaceChildren(...[1, 3, 6, 12].map((m) => h('button', { class: `btn btn-sm ${months === m ? 'btn-primary' : 'btn-ghost'}`, onclick: () => { months = m; renderMonths(); } }, `${m} мес.`)));
  renderMonths();
  openModal({
    title: `Подписка для ${u.name}`, className: 'modal-small',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, u.sub ? `Сейчас: ${planById(u.sub)?.name} до ${new Date(u.subUntil).toLocaleDateString('ru-RU')}` : 'Сейчас подписки нет.'),
      h('div', { class: 'small' }, 'Тариф'), plansEl, h('div', { class: 'small' }, 'Срок'), monthsEl),
    actions: [
      u.sub ? { label: 'Отключить', danger: true, onClick: async (close) => { if (await post({ plan: null })) close(); } } : null,
      { label: 'Выдать', primary: true, onClick: async (close) => { if (await post({ plan, months })) close(); } },
    ].filter(Boolean),
  });
}

// ================================================================ channels

async function channels() {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск каналов' });
  const list = h('div', { class: 'users-list' }, spinner());
  const load = async () => {
    try {
      const { channels: rows } = await api.get(`/admin/channels?q=${encodeURIComponent(search.value)}`);
      list.replaceChildren(...(rows.length ? rows.map((c) => {
        const act = (label, fn, cls = 'btn-ghost') => h('button', { class: `btn btn-sm ${cls}`, onclick: fn }, label);
        const doIt = async (method, path, body, confirmText, danger) => {
          if (confirmText && !(await confirmDialog(confirmText, { ok: 'Да', danger }))) return;
          if (await call(() => (method === 'del' ? api.del(path) : api.post(path, body)), 'Готово')) load();
        };
        return h('div', { class: `user-row ${c.verifyRequested ? 'requested' : ''}` },
          avatar({ id: c.id, name: c.title, src: c.avatar }, 44),
          h('div', { class: 'user-info' },
            h('div', { class: 'row-main' }, nameWithBadge(c.title, c), c.verifyRequested ? h('span', { class: 'pill warn' }, 'заявка на галочку') : null),
            h('div', { class: 'row-sub' }, `${c.username ? `@${c.username}` : '🔒 приватный'} · владелец ${c.owner}`),
            h('div', { class: 'row-sub' }, `${fmt(c.subscribers)} подписчиков · ${fmt(c.posts)} постов · создан ${dayLabel(c.createdAt)}`)),
          h('div', { class: 'user-actions' },
            c.verified ? act('Снять галочку', () => doIt('post', `/admin/channels/${c.id}/verify`, { verified: false }, `Снять галочку с «${c.title}»?`))
              : act('✓ Верифицировать', () => doIt('post', `/admin/channels/${c.id}/verify`, { verified: true }), 'btn-primary'),
            c.verifyRequested ? act('Отклонить', () => doIt('post', `/admin/channels/${c.id}/reject`, {})) : null,
            act('Удалить', () => doIt('del', `/admin/channels/${c.id}`, null, `Удалить канал «${c.title}» со всеми постами?`, true), 'btn-danger-ghost')));
      }) : [empty('Каналов нет')]));
    } catch (e) { handle(e); }
  };
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  set(h('div', { class: 'toolbar' }, search), card('Каналы и верификация', list));
  load();
}

// ================================================================ communities

async function communities() {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск сообществ' });
  const list = h('div', { class: 'users-list' }, spinner());
  const load = async () => {
    try {
      const { communities: rows } = await api.get(`/admin/communities?q=${encodeURIComponent(search.value)}`);
      list.replaceChildren(...(rows.length ? rows.map((c) => h('div', { class: 'user-row' },
        avatar({ id: c.id + 7, name: c.title, src: c.avatar }, 44),
        h('div', { class: 'user-info' },
          h('div', { class: 'row-main' }, c.title),
          h('div', { class: 'row-sub' }, `владелец ${c.owner} · создано ${dayLabel(c.createdAt)}`),
          h('div', { class: 'row-sub' }, `${fmt(c.members)} участников · ${c.channels} каналов · ${fmt(c.msgs7)} сообщ. за неделю`)),
        h('div', { class: 'user-actions' },
          c.ownerId ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => dossier(c.ownerId) }, 'Владелец') : null,
          h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmDialog(`Удалить сообщество «${c.title}» со всеми каналами и перепиской?`, { ok: 'Удалить', danger: true }))) return;
            if (await call(() => api.del(`/admin/communities/${c.id}`), 'Сообщество удалено')) load();
          } }, 'Удалить')))) : [empty('Сообществ пока нет')]));
    } catch (e) { handle(e); }
  };
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  set(h('div', { class: 'toolbar' }, search), card('Сообщества', list));
  load();
}

// ================================================================ roles & badges (rewards for the owner's offline game launcher, granted by hand)

let rwQuery = '';
async function rewardsPage() {
  const r = await api.get('/admin/rewards');
  // Grant: find a person, then tick their rewards.
  const who = h('input', { class: 'input', type: 'search', placeholder: 'Кому выдать: имя, @юзернейм или почта', autocomplete: 'off' });
  const found = h('div', { class: 'rw-found' });
  const find = async () => {
    const qs = who.value.trim();
    if (!qs) return found.replaceChildren();
    try {
      const { users } = await api.get(`/admin/users?q=${encodeURIComponent(qs.replace(/^@/, ''))}`);
      found.replaceChildren(...(users.length ? users.slice(0, 8).map((u) => h('button', { class: 'user-row', onclick: () => rewardsDialog(u, rewardsPage) },
        avatar({ id: u.id, name: u.name, src: u.avatar, online: u.online }, 40),
        h('div', { class: 'user-info' }, h('div', { class: 'row-main' }, u.name), h('div', { class: 'row-sub' }, u.username ? `@${u.username}` : `id ${u.id}`)),
        h('span', { class: 'btn btn-sm btn-primary' }, '🏆 Выдать'))) : [empty('Никого не найдено')]));
    } catch (e) { handle(e); }
  };
  let t = null;
  who.value = rwQuery;
  who.addEventListener('input', () => { rwQuery = who.value; clearTimeout(t); t = setTimeout(find, 250); });
  if (rwQuery) find();

  const id = h('input', { class: 'input', placeholder: 'id латиницей, например champion', maxLength: 32, autocomplete: 'off' });
  const name = h('input', { class: 'input', placeholder: 'Название, например «Чемпион»', maxLength: 40 });
  const emoji = h('input', { class: 'input', placeholder: 'Эмодзи', maxLength: 8, value: '🏆' });
  const color = h('input', { class: 'input', type: 'color', value: '#22c55e', title: 'Цвет' });
  const desc = h('input', { class: 'input', placeholder: 'За что, например «1000 побед»', maxLength: 120 });
  let kind = 'role';
  const kindEl = h('div', { class: 'segmented small-seg' });
  const drawKind = () => kindEl.replaceChildren(...[['role', 'Роль'], ['badge', 'Значок']].map(([k, l]) => h('button', { class: kind === k ? 'on' : '', onclick: () => { kind = k; drawKind(); } }, l)));
  drawKind();
  set(
    h('div', { class: 'tiles' },
      tile('Ролей и значков', r.rewards.length, { sub: `${r.rewards.filter((x) => x.custom).length} добавлено вами`, ic: 'crown', tone: 'gold' }),
      tile('Выдано наград', r.rewards.reduce((n, x) => n + x.owners, 0), { sub: 'всего у пользователей', ic: 'sparkles' })),
    card('Выдать роль или значок', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Найдите человека и отметьте, что он заработал в лаунчере. Ему придёт сообщение, роль появится рядом с именем, значок — в профиле.'),
      who, found)),
    card('Каталог', h('div', { class: 'rw-admin' }, r.rewards.map((x) => h('div', { class: 'rw-admin-row clickable', style: { '--rc': x.color }, title: 'У кого есть', onclick: () => ownersDialog(x) },
      h('span', { class: 'rw-admin-emoji' }, x.emoji),
      h('div', { class: 'grow' }, h('b', {}, x.name, ' ', h('span', { class: 'pill' }, x.kind === 'role' ? 'роль' : 'значок'), x.custom ? h('span', { class: 'pill gold' }, 'своя') : null),
        h('div', { class: 'row-sub' }, `${x.desc ? `${x.desc} · ` : ''}есть у ${fmt(x.owners)}`)),
      x.custom ? h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog(`Удалить «${x.name}»? Она пропадёт у всех, у кого есть.`, { ok: 'Удалить', danger: true }))) return;
        if (await call(() => api.del(`/admin/rewards/${encodeURIComponent(x.id)}`), 'Удалено')) rewardsPage();
      } }, 'Удалить') : icon('back', 'chev'))))),
    card('Добавить роль или значок', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Например, за новую игру в лаунчере. Потом её можно выдавать как остальные.'),
      kindEl, h('div', { class: 'rw-form' }, id, name, emoji, color), desc,
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (await call(() => api.post('/admin/rewards', { id: id.value, kind, name: name.value, emoji: emoji.value, color: color.value, desc: desc.value }), 'Сохранено')) rewardsPage();
      } }, icon('plus'), 'Добавить'))));
}

async function ownersDialog(x) {
  let users;
  try { ({ users } = await api.get(`/admin/rewards/${encodeURIComponent(x.id)}/owners`)); } catch (e) { return handle(e); }
  const list = h('div', { class: 'rw-admin' });
  const draw = () => list.replaceChildren(...(users.length ? users.map((u) => h('div', { class: 'user-row' },
    avatar({ id: u.id, name: u.name, src: u.avatar }, 40),
    h('div', { class: 'user-info' }, h('div', { class: 'row-main' }, u.name), h('div', { class: 'row-sub' }, `${u.username ? `@${u.username} · ` : ''}выдано ${dayLabel(u.at)}`)),
    h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
      if (!(await confirmDialog(`Забрать «${x.name}» у ${u.name}?`, { ok: 'Забрать', danger: true }))) return;
      if (await call(() => api.post(`/admin/users/${u.id}/rewards`, { reward: x.id, grant: false }), 'Забрано')) { users = users.filter((y) => y.id !== u.id); draw(); }
    } }, 'Забрать'))) : [empty('Пока ни у кого нет')]));
  draw();
  openModal({ title: `${x.emoji} ${x.name}`, className: 'modal-small', body: list, onClose: () => rewardsPage() });
}

async function rewardsDialog(u, onDone) {
  let cat, mine;
  try { [cat, mine] = await Promise.all([api.get('/admin/rewards'), api.get(`/admin/users/${u.id}/rewards`)]); } catch (e) { return handle(e); }
  const have = new Set(mine.rewards.map((x) => x.id));
  const list = h('div', { class: 'rw-admin' });
  const draw = () => list.replaceChildren(...cat.rewards.map((x) => h('label', { class: 'rw-admin-row', style: { '--rc': x.color } },
    h('span', { class: 'rw-admin-emoji' }, x.emoji),
    h('div', { class: 'grow' }, h('b', {}, x.name), h('div', { class: 'row-sub' }, `${x.kind === 'role' ? 'роль' : 'значок'}${x.desc ? ` · ${x.desc}` : ''}`)),
    h('input', { type: 'checkbox', class: 'tg', checked: have.has(x.id), onchange: async (e) => {
      const grant = e.target.checked;
      const r = await call(() => api.post(`/admin/users/${u.id}/rewards`, { reward: x.id, grant }), grant ? 'Выдано' : 'Забрано');
      if (r) { grant ? have.add(x.id) : have.delete(x.id); } else { e.target.checked = !grant; }
    } }))));
  draw();
  openModal({ title: `Роли и значки: ${u.name}`, className: 'modal-small', body: list, onClose: onDone });
}

// ================================================================ broadcast + banner

async function broadcast() {
  const [{ audiences }, { platform }] = await Promise.all([api.get('/admin/audiences'), api.get('/admin/platform')]);
  let aud = 'all';
  const audEl = h('div', { class: 'aud-pick' });
  const drawAud = () => audEl.replaceChildren(...audiences.map((a) => h('button', { class: `aud ${aud === a.key ? 'on' : ''}`, onclick: () => { aud = a.key; drawAud(); } }, h('b', {}, fmt(a.count)), h('span', {}, a.label))));
  drawAud();
  const text = h('textarea', { class: 'input', rows: 5, maxLength: 4096, placeholder: 'Текст объявления…' });
  const preview = h('div', { class: 'bc-preview' });
  const drawPrev = () => preview.replaceChildren(h('div', { class: 'bc-from' }, h('img', { src: '/icons/icon.svg', alt: '' }), h('b', {}, 'Limochat ✓')), h('div', { class: 'bc-bubble' }, text.value || 'Так увидят сообщение пользователи'));
  text.addEventListener('input', drawPrev);
  drawPrev();
  const bannerText = h('textarea', { class: 'input', rows: 2, maxLength: 300, placeholder: 'Короткий текст над списком чатов, например: «Завтра в 3:00 — обновление, минута простоя»' });
  bannerText.value = platform.banner?.text || '';
  let kind = platform.banner?.kind || 'info';
  const kindEl = h('div', { class: 'segmented small-seg' });
  const drawKind = () => kindEl.replaceChildren(...[['info', '📣 Инфо'], ['warn', '⚠️ Важно'], ['promo', '🎉 Акция']].map(([k, l]) => h('button', { class: kind === k ? 'on' : '', onclick: () => { kind = k; drawKind(); } }, l)));
  drawKind();
  set(
    h('div', { class: 'grid-2' },
      card('Сообщение в личку', h('div', { class: 'stack' },
        h('div', { class: 'small' }, 'Кому'), audEl, text,
        h('button', { class: 'btn btn-primary', onclick: async () => {
          if (!text.value.trim()) return text.focus();
          const a = audiences.find((x) => x.key === aud);
          if (!(await confirmDialog(`Отправить сообщение: ${a.label} — ${a.count} чел.?`, { ok: 'Отправить' }))) return;
          const r = await call(() => api.post('/admin/broadcast2', { text: text.value, audience: aud }));
          if (r) { toast(`Отправлено: ${r.recipients}`); text.value = ''; drawPrev(); }
        } }, icon('send'), 'Отправить'))),
      card('Предпросмотр', preview)),
    card('Баннер для всех', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Показывается вверху списка чатов у всех сразу, без перезагрузки. Пользователь может скрыть его крестиком.'),
      kindEl, bannerText,
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn btn-primary', onclick: async () => { if (await call(() => api.post('/admin/platform', { banner: { text: bannerText.value, kind } }), bannerText.value.trim() ? 'Баннер опубликован' : 'Баннер убран')) broadcast(); } }, 'Опубликовать'),
        platform.banner ? h('button', { class: 'btn btn-ghost', onclick: async () => { if (await call(() => api.post('/admin/platform', { banner: null }), 'Баннер убран')) broadcast(); } }, 'Убрать баннер') : null))));
}

// ================================================================ platform

async function platformPage() {
  const [{ platform: p, features }, seller] = await Promise.all([api.get('/admin/platform'), api.get('/admin/settings')]);
  const save = async (patch, ok) => { if (await call(() => api.post('/admin/platform', patch), ok)) platformPage(); };
  const toggle = (label, sub, on, onChange, danger) => h('label', { class: `tg-row ${danger && on ? 'danger' : ''}` },
    h('div', { class: 'grow' }, h('b', {}, label), h('span', {}, sub)),
    h('input', { type: 'checkbox', class: 'tg', checked: on, onchange: (e) => onChange(e.target.checked) }));
  const words = [...p.stopWords];
  const wordsEl = h('div', { class: 'chips' });
  const wordIn = h('input', { class: 'input', placeholder: 'Добавить слово и нажать Enter' });
  const drawWords = () => wordsEl.replaceChildren(...(words.length ? words.map((w) => h('span', { class: 'chip-x' }, w, h('button', { 'aria-label': 'Убрать', onclick: () => { words.splice(words.indexOf(w), 1); drawWords(); } }, icon('close')))) : [h('span', { class: 'muted small' }, 'Список пуст')]));
  drawWords();
  wordIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    for (const w of wordIn.value.split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2)) if (!words.includes(w)) words.push(w);
    wordIn.value = '';
    drawWords();
  });
  const sellerIn = h('input', { class: 'input', placeholder: 'юзернейм продавца', value: seller.sellerUsername });
  set(
    card('Режимы', h('div', { class: 'tg-list' },
      toggle('Регистрация открыта', 'Новые люди могут создавать аккаунты. Выключите при атаке ботов.', p.registration, (v) => save({ registration: v }, v ? 'Регистрация открыта' : 'Регистрация закрыта')),
      toggle('Технические работы', 'Писать могут только админы, у всех вверху висит плашка «Технические работы».', p.maintenance, (v) => save({ maintenance: v }, v ? 'Режим техработ включён' : 'Режим техработ выключен'), true))),
    card('Функции', h('div', { class: 'tg-list' }, ...Object.entries(features).map(([k, label]) =>
      toggle(label, p.features[k] ? 'Включено' : 'Выключено у всех', p.features[k], (v) => save({ features: { [k]: v } }, `${label}: ${v ? 'включено' : 'выключено'}`))))),
    card('Стоп-слова', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Эти слова в новых сообщениях автоматически заменяются звёздочками. Можно вводить через запятую.'),
      wordIn, wordsEl,
      h('button', { class: 'btn btn-primary', onclick: () => save({ stopWords: words }, 'Стоп-слова сохранены') }, 'Сохранить список'))),
    card('Подписки и продавец', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Кнопка «Купить» у пользователей открывает чат с продавцом. Подписку выдаёте в досье пользователя.'),
      h('div', { class: 'row-gap' }, h('div', { class: 'input-prefix grow' }, h('span', {}, '@'), sellerIn),
        h('button', { class: 'btn btn-primary', onclick: () => call(() => api.post('/admin/settings', { sellerUsername: sellerIn.value }), 'Сохранено') }, 'Сохранить')),
      h('div', { class: 'small' }, 'Сейчас: ', seller.seller ? h('b', {}, `@${seller.seller.username} (${seller.seller.name})`) : h('b', { class: 'bad' }, 'не настроено')),
      h('div', { class: 'plans-mini' }, PLANS.map((pl) => h('div', { class: 'plan-mini' }, h('b', {}, `${pl.emoji} ${pl.name}`), h('span', {}, `${pl.price} ₽/мес`)))))));
}

// ================================================================ security: devices + IP bans

let devMode = 'online';
async function security() {
  const devSummary = h('div', { class: 'dev-summary' });
  const devList = h('div', { class: 'devices' }, spinner());
  const seg = h('div', { class: 'segmented small-seg' });
  const banIp = h('input', { class: 'input', placeholder: 'IP-адрес, например 203.0.113.7', autocomplete: 'off', spellcheck: false });
  const banReason = h('input', { class: 'input', placeholder: 'Причина (необязательно)', maxLength: 200 });
  const bans = h('div', { class: 'users-list' });
  const myIp = h('div', { class: 'row-sub' });
  const loadDevices = async () => {
    seg.replaceChildren(...[['online', 'Онлайн'], ['desktop', 'ПК'], ['mobile', 'Телефоны'], ['all', 'Все']].map(([k, l]) => h('button', { class: devMode === k ? 'on' : '', onclick: () => { devMode = k; loadDevices(); } }, l)));
    try {
      const { sessions, summary } = await api.get('/admin/sessions');
      devSummary.replaceChildren(...[h('div', { class: 'dev-chip' }, '💻 ', h('b', {}, summary.desktop), ' с ПК'), h('div', { class: 'dev-chip' }, '📱 ', h('b', {}, summary.mobile), ' с телефонов'),
        summary.tablet ? h('div', { class: 'dev-chip' }, '📲 ', h('b', {}, summary.tablet), ' с планшетов') : null, h('div', { class: 'dev-chip muted' }, `всего сеансов: ${sessions.length}`)].filter(Boolean));
      const list = sessions.filter((x) => devMode === 'all' || (devMode === 'online' ? x.online : x.kind === devMode));
      devList.replaceChildren(...(list.length ? list.slice(0, 200).map((x) => h('div', { class: 'dev-row' },
        h('div', { class: 'dev-ic' }, x.kind === 'desktop' ? '💻' : x.kind === 'tablet' ? '📲' : '📱'),
        h('button', { class: 'dev-info', onclick: () => dossier(x.userId) },
          h('div', { class: 'row-main' }, x.name, x.username ? h('span', { class: 'muted' }, ` @${x.username}`) : null, x.online ? h('span', { class: 'pill' }, 'онлайн') : null),
          h('div', { class: 'row-sub' }, `${x.browser}, ${x.os} · ${x.ip || '—'} · ${x.online ? 'сейчас' : when(x.lastUsed)}`)),
        h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog(`Завершить сеанс ${x.name} (${x.browser}, ${x.os})?`, { ok: 'Завершить', danger: true }))) return;
          if (await call(() => api.del(`/admin/sessions/${x.id}`), 'Сеанс завершён')) loadDevices();
        } }, 'Выкинуть'))) : [empty(devMode === 'online' ? 'Сейчас никого нет онлайн' : 'Пусто')]));
    } catch (e) { handle(e); }
  };
  const loadBans = async () => {
    try {
      const r = await api.get('/admin/ip-bans');
      myIp.textContent = r.myIp ? `Ваш текущий IP: ${r.myIp} (его забанить нельзя)` : '';
      bans.replaceChildren(...(r.bans.length ? r.bans.map((b) => h('div', { class: 'user-row' }, h('div', { class: 'ban-ic' }, '⛔'),
        h('div', { class: 'user-info' }, h('div', { class: 'row-main mono' }, b.ip),
          h('div', { class: 'row-sub' }, [b.username ? `@${b.username}` : null, b.reason || null, when(b.createdAt)].filter(Boolean).join(' · '))),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await call(() => api.del(`/admin/ip-bans/${encodeURIComponent(b.ip)}`), 'IP разбанен')) loadBans(); } }, 'Разбанить')))
        : [empty('Забаненных адресов нет')]));
    } catch (e) { handle(e); }
  };
  set(
    card('Устройства', h('div', { class: 'stack' }, devSummary, devList), seg),
    card('Баны по IP', h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'С забаненного адреса нельзя открыть сайт, войти или зарегистрироваться. У мобильного интернета один IP бывает у многих людей — будьте осторожны.'),
      h('div', { class: 'ban-form' }, banIp, banReason, h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
        const ip = banIp.value.trim();
        if (!ip) return banIp.focus();
        if (!(await confirmDialog(`Забанить IP ${ip}?`, { ok: 'Забанить', danger: true }))) return;
        if (await call(() => api.post('/admin/ip-bans', { ip, reason: banReason.value }), `IP ${ip} забанен`)) { banIp.value = ''; banReason.value = ''; loadBans(); }
      } }, icon('shield'), 'Забанить IP')),
      myIp, bans)));
  loadDevices();
  loadBans();
}

// ================================================================ server

const fmtUptime = (sec) => {
  const dd = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60);
  return dd ? `${dd} д ${hh} ч` : hh ? `${hh} ч ${mm} мин` : `${mm} мин`;
};
async function server() {
  const [sv, s2] = await Promise.all([api.get('/admin/server'), api.get('/admin/server2')]);
  const cell = (label, value, sub, extra) => h('div', { class: 'srv' }, h('div', { class: 'srv-label' }, label), h('div', { class: 'srv-value' }, value), extra || null, sub ? h('div', { class: 'srv-sub' }, sub) : null);
  const up = sv.update;
  const memUsed = sv.memory.total - sv.memory.free;
  const meter = (frac) => h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round(frac * 100)}%` }, class: frac > 0.85 ? 'bad' : '' }));
  set(
    card('Сервер', h('div', { class: 'server-grid' },
      cell('Версия', sv.version || 'dev', `${sv.node} · ${s2.platform}`),
      cell('Работает', fmtUptime(sv.uptime), `нагрузка ${sv.load.toFixed(2)} · ядер ${s2.cpus}`),
      cell('Память', `${bytes(memUsed)} / ${bytes(sv.memory.total)}`, `приложение ${bytes(sv.memory.rss)}`, meter(memUsed / sv.memory.total)),
      sv.disk ? cell('Диск', `${bytes(sv.disk.free)} свободно`, `из ${bytes(sv.disk.total)}`, meter(1 - sv.disk.free / sv.disk.total)) : null,
      cell('База данных', bytes(s2.db), `${fmt(s2.mediaFiles)} медиафайлов`),
      cell('Автообновление', up ? (up.ok ? 'включено ✓' : 'ошибка ✗') : 'не настроено',
        sv.updateRequested ? 'обновление запрошено, начнётся в течение 2 минут…' : up ? `${up.ok ? 'последняя проверка' : up.message} · ${when(up.at)}` : 'запустите install.sh ещё раз'))),
    card('Обслуживание', h('div', { class: 'maint' },
      h('button', { class: 'maint-btn', disabled: sv.updateRequested, onclick: async () => {
        if (!(await confirmDialog('Скачать последнюю версию и перезапустить сервер? Пользователи переподключатся сами.', { ok: 'Обновить' }))) return;
        if (await call(() => api.post('/admin/update'), 'Обновление запрошено — 1–3 минуты')) server();
      } }, icon('refresh'), h('b', {}, 'Обновить сейчас'), h('span', {}, 'git pull + перезапуск')),
      h('a', { class: 'maint-btn', href: '/api/admin/backup', download: '' }, icon('download'), h('b', {}, 'Скачать резервную копию'), h('span', {}, 'вся база одним файлом .db')),
      h('button', { class: 'maint-btn', onclick: async () => {
        if (!(await confirmDialog('Удалить истёкшие сеансы и записи журнала старше 180 дней?', { ok: 'Очистить' }))) return;
        call(() => api.post('/admin/vacuum'), 'Готово');
      } }, icon('trash'), h('b', {}, 'Очистить базу'), h('span', {}, 'старые сеансы и журнал')))));
}

// ================================================================ audit

const ACTIONS = {
  login: 'Вход', login_failed: 'Неудачный вход', login_banned: 'Вход заблокированного', admin_unlock: 'Вход в админку',
  admin_unlock_failed: 'Неверный код админки', admin_denied: 'Попытка доступа к админке', admin_totp_ratelimited: 'Лимит попыток кода',
  admin_ban: 'Бан', admin_unban: 'Разбан', admin_ip_ban: 'Бан IP', admin_ip_unban: 'Разбан IP', admin_ban_ip: 'Бан аккаунта и IP', admin_logout_user: 'Завершены сеансы',
  admin_reset_username: 'Сброс юзернейма', admin_vacuum: 'Очистка БД', csrf_block: 'Заблокирован CSRF', register: 'Регистрация', admin_kill_session: 'Завершён сеанс',
  admin_sub_grant: 'Выдана подписка', admin_sub_remove: 'Отключена подписка', admin_settings: 'Настройки', password_set: 'Смена пароля', gift: 'Подарок',
  admin_verify: 'Выдана галочка', admin_unverify: 'Снята галочка', channel_create: 'Создан канал', channel_delete: 'Удалён канал', channel_verify_request: 'Заявка на галочку',
  admin_channel_verify: 'Канал верифицирован', admin_channel_unverify: 'Снята галочка канала', admin_channel_reject: 'Заявка отклонена', admin_channel_delete: 'Админ удалил канал',
  admin_coins: 'Начислены лимоны', admin_broadcast: 'Рассылка', admin_update_request: 'Запрос обновления', admin_mute: 'Запрет писать', admin_unmute: 'Снят запрет писать',
  admin_dm: 'Личное сообщение от админа', admin_purge: 'Удалены сообщения пользователя', admin_report: 'Решена жалоба', admin_community_delete: 'Удалено сообщество',
  admin_platform: 'Настройки платформы', admin_backup: 'Скачана резервная копия', admin_audit_export: 'Выгрузка журнала', community_create: 'Создано сообщество', community_delete: 'Удалено сообщество',
};
const ALARM = new Set(['login_failed', 'admin_unlock_failed', 'admin_denied', 'admin_totp_ratelimited', 'csrf_block', 'login_banned']);

async function audit() {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Юзернейм, IP или текст' });
  const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Все события'));
  const alarm = h('input', { type: 'checkbox' });
  const list = h('div', { class: 'audit-list' }, spinner());
  const qs = () => `q=${encodeURIComponent(search.value)}&action=${encodeURIComponent(sel.value)}&alarm=${alarm.checked ? 1 : 0}`;
  let filled = false;
  const load = async () => {
    try {
      const r = await api.get(`/admin/audit2?${qs()}`);
      if (!filled) { filled = true; sel.append(...r.actions.map((a) => h('option', { value: a.action }, `${ACTIONS[a.action] || a.action} (${a.n})`))); }
      list.replaceChildren(...(r.entries.length ? r.entries.map((a) => h('div', { class: `audit-row ${ALARM.has(a.action) ? 'alarm' : ''}` },
        h('span', { class: 'audit-time' }, when(a.at)),
        h('span', { class: 'audit-action' }, ACTIONS[a.action] || a.action),
        a.userId ? h('button', { class: 'audit-who link', onclick: () => dossier(a.userId) }, a.username ? `@${a.username}` : `id ${a.userId}`) : h('span', { class: 'audit-who' }, '—'),
        h('span', { class: 'audit-ip' }, a.ip || ''),
        a.details ? h('span', { class: 'audit-details' }, details(a.details)) : null)) : [empty('Ничего не найдено')]));
    } catch (e) { handle(e); }
  };
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  sel.addEventListener('change', load);
  alarm.addEventListener('change', load);
  set(h('div', { class: 'toolbar' }, search, sel, h('label', { class: 'remember-row' }, alarm, 'Только тревожные'),
    h('a', { class: 'btn btn-ghost', href: '#', onclick: (e) => { e.preventDefault(); location.href = `/api/admin/audit.csv?${qs()}`; } }, icon('download'), 'CSV')), card('Журнал безопасности', list));
  load();
}

boot();
