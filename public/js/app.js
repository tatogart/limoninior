import { io } from '/vendor/socket.io.esm.min.js';
import { api, errorText } from './api.js';
import {
  h, icon, avatar, timeHM, listTime, dayLabel, lastSeenText, plural, richText, emojiCount,
  toast, openModal, closeTopModal, confirmDialog, contextMenu, closeMenu, isTouch,
} from './ui.js';

// ============================================================ state

const SETTINGS_KEY = 'limoninior.settings';
const S = {
  config: null,
  me: null,
  socket: null,
  connected: false,
  chats: new Map(),
  users: new Map(),
  msgs: new Map(), // chatId -> { items, hasMore, loaded, loading }
  typing: new Map(), // chatId -> Map(userId -> timeoutId)
  drafts: new Map(),
  current: null,
  reply: null,
  editing: null,
  searchQuery: '',
  searchResults: null,
  installPrompt: null,
  settings: loadSettings(),
};
const V = {}; // view refs
const nodeCache = new Map(); // message key -> { sig, el }
let tmpSeq = 0;

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* ignore */ }
  return { theme: 'system', accent: 'lime', enterToSend: !isTouch(), notify: false, ...s };
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch { /* ignore */ }
  applyTheme();
}
function applyTheme() {
  let t = S.settings.theme;
  if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.accent = S.settings.accent;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = t === 'dark' ? '#17212b' : '#ffffff'; });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const app = document.getElementById('app');

// ============================================================ helpers

const isGroup = (c) => c?.type === 'group';
const curChat = () => S.chats.get(S.current);

function mergeUser(u) {
  if (!u) return;
  const prev = S.users.get(u.id);
  S.users.set(u.id, { ...prev, ...u });
  if (S.me && u.id === S.me.id) S.me = { ...S.me, ...u };
}
function peerOf(c) {
  return c?.peer ? S.users.get(c.peer.id) || c.peer : null;
}
function userName(id) {
  if (id === S.me.id) return S.me.name;
  return S.users.get(id)?.name || 'Пользователь';
}
const pendingUsers = new Set();
async function ensureUser(id) {
  if (!id || S.users.has(id) || pendingUsers.has(id)) return;
  pendingUsers.add(id);
  try {
    mergeUser((await api.get(`/users/${id}`)).user);
    if (S.current) renderMessages();
  } catch { /* deleted user */ }
}
function chatAvatar(c, size) {
  if (c.type === 'saved') return avatar({ saved: true }, size);
  if (c.type === 'private') {
    const p = peerOf(c);
    return avatar({ id: p?.id, name: p?.name || '?', src: p?.avatar, online: p?.online }, size);
  }
  return avatar({ id: c.id, name: c.title, src: c.avatar }, size);
}
function chatTitle(c) {
  if (c.type === 'private') return peerOf(c)?.name || c.title;
  return c.title;
}
const NAME_COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
const nameColor = (id) => NAME_COLORS[Math.abs(id) % NAME_COLORS.length];

function messagePreview(m) {
  if (!m) return '';
  if (m.kind === 'image') return m.text ? `🖼 ${m.text}` : '🖼 Фото';
  return m.text.replace(/\s+/g, ' ');
}

function typingUsers(chatId) {
  const t = S.typing.get(chatId);
  return t ? [...t.keys()] : [];
}
function typingText(c) {
  const ids = typingUsers(c.id);
  if (!ids.length) return '';
  if (!isGroup(c)) return 'печатает';
  if (ids.length === 1) return `${userName(ids[0]).split(' ')[0]} печатает`;
  return `${ids.length} ${plural(ids.length, 'человек', 'человека', 'человек')} печатают`;
}
const typingDots = () => h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i'));

function totalUnread() {
  let n = 0;
  for (const c of S.chats.values()) n += c.unread;
  return n;
}
function updateBadge() {
  const n = totalUnread();
  document.title = n ? `(${n}) Limoninior` : 'Limoninior';
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ============================================================ boot

async function boot() {
  registerServiceWorker();
  applyTheme();
  try {
    S.config = await api.get('/config');
  } catch {
    app.replaceChildren(h('div', { class: 'fatal' }, icon('info'), h('p', {}, 'Сервер недоступен. Проверьте соединение.'),
      h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Повторить')));
    return;
  }
  try {
    S.me = (await api.get('/me')).user;
  } catch (e) {
    if (e.status === 401) return renderLogin();
    return toast(errorText(e), 'error');
  }
  if (S.me.needsProfile) renderOnboarding();
  else startApp();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-chat' && S.chats.has(e.data.chatId)) openChat(e.data.chatId);
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installPrompt = e;
  document.querySelectorAll('[data-install]').forEach((el) => el.classList.remove('hidden'));
});
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function installApp() {
  if (S.installPrompt) {
    S.installPrompt.prompt();
    const r = await S.installPrompt.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') toast('Приложение установлено 🎉');
    S.installPrompt = null;
    return;
  }
  const steps = isIOS()
    ? ['Откройте сайт в Safari', 'Нажмите «Поделиться» внизу экрана', 'Выберите «На экран Домой»', 'Нажмите «Добавить»']
    : ['Откройте меню браузера (⋮ или ⋯)', 'Выберите «Установить приложение» или «Добавить на главный экран»', 'Подтвердите установку'];
  openModal({
    title: 'Установка приложения',
    className: 'modal-small',
    body: h('div', { class: 'install-help' },
      h('img', { src: '/icons/icon.svg', width: 72, height: 72, alt: '' }),
      h('p', {}, 'Limoninior работает как обычное приложение: своя иконка, отдельное окно, без адресной строки.'),
      h('ol', {}, steps.map((s) => h('li', {}, s)))),
    actions: [{ label: 'Понятно', primary: true, onClick: (c) => c() }],
  });
}

// ============================================================ login

function renderLogin() {
  const gbtn = h('div', { class: 'gbtn' });
  const card = h('div', { class: 'login-card' },
    h('img', { class: 'login-logo', src: '/icons/icon.svg', alt: '', width: 112, height: 112 }),
    h('h1', {}, 'Limoninior'),
    h('p', { class: 'login-sub' }, 'Быстрый, красивый и безопасный мессенджер.', h('br'), 'Войдите, чтобы начать общение.'),
    gbtn,
  );
  if (S.config.devLogin) {
    const inp = h('input', { class: 'input', placeholder: 'Имя для dev-входа (латиница)', maxLength: 32 });
    const go = async () => {
      try {
        S.me = (await api.post('/auth/dev', { name: inp.value })).user;
        S.me.needsProfile ? renderOnboarding() : startApp();
      } catch (e) { toast(errorText(e), 'error'); }
    };
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    card.append(h('div', { class: 'dev-login' }, h('div', { class: 'dev-label' }, 'Режим разработки'), inp,
      h('button', { class: 'btn btn-primary btn-block', onclick: go }, 'Войти без Google')));
  }
  if (!isStandalone()) {
    card.append(h('button', { class: 'link-btn', 'data-install': '', onclick: installApp }, icon('download'), 'Установить приложение'));
  }
  card.append(h('p', { class: 'login-foot' }, 'Вход защищён через Google. Мы не видим ваш пароль. ', h('a', { href: '/privacy' }, 'Конфиденциальность')));
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }), h('div', { class: 'blob b3' }), card));

  if (!S.config.googleClientId) {
    gbtn.append(h('div', { class: 'hint-box' }, 'Вход через Google не настроен: укажите GOOGLE_CLIENT_ID на сервере.'));
    return;
  }
  const mountButton = () => {
    window.google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      callback: onGoogleCredential,
      ux_mode: 'popup',
      auto_select: false,
      itp_support: true,
      use_fedcm_for_prompt: true,
    });
    window.google.accounts.id.renderButton(gbtn, {
      type: 'standard', theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
      size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', locale: 'ru', width: 300,
    });
  };
  if (window.google?.accounts?.id) return mountButton();
  const s = h('script', { src: 'https://accounts.google.com/gsi/client', async: true });
  s.onload = mountButton;
  s.onerror = () => gbtn.replaceChildren(h('div', { class: 'hint-box' }, 'Не удалось загрузить вход Google. Проверьте соединение или VPN/блокировщик.'));
  document.head.append(s);
}

async function onGoogleCredential(resp) {
  try {
    S.me = (await api.post('/auth/google', { credential: resp.credential })).user;
    S.me.needsProfile ? renderOnboarding() : startApp();
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

// ============================================================ onboarding / profile form

function usernameField(initial = '') {
  const status = h('div', { class: 'field-hint' }, 'Латиница, цифры и _, от 5 символов');
  const input = h('input', { class: 'input', value: initial, maxLength: 32, autocapitalize: 'off', autocomplete: 'off', spellcheck: false, placeholder: 'username' });
  const wrap = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Юзернейм'),
    h('div', { class: 'input-prefix' }, h('span', {}, '@'), input), status);
  let timer = null;
  let ok = !!initial;
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^a-zA-Z0-9_]/g, '');
    clearTimeout(timer);
    const v = input.value;
    ok = false;
    status.className = 'field-hint';
    if (!v) { status.textContent = 'Латиница, цифры и _, от 5 символов'; return; }
    if (!/^[a-zA-Z]/.test(v)) { status.textContent = 'Должен начинаться с буквы'; status.classList.add('bad'); return; }
    if (v.length < 5) { status.textContent = 'Минимум 5 символов'; status.classList.add('bad'); return; }
    status.textContent = 'Проверяем…';
    timer = setTimeout(async () => {
      try {
        const r = await api.get(`/username-check?u=${encodeURIComponent(v)}`);
        if (input.value !== v) return;
        ok = r.ok;
        status.textContent = r.ok ? `@${v} свободен` : r.reason === 'taken' ? 'Этот юзернейм занят' : 'Неверный формат';
        status.classList.add(r.ok ? 'good' : 'bad');
      } catch { /* ignore */ }
    }, 350);
  });
  return { wrap, input, isOk: () => ok };
}

function renderOnboarding() {
  const name = h('input', { class: 'input', value: S.me.name || '', maxLength: 64, placeholder: 'Имя' });
  const uname = usernameField('');
  const submit = async () => {
    try {
      S.me = (await api.patch('/me', { name: name.value, username: uname.input.value })).user;
      startApp();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const form = h('form', { class: 'login-card onboarding', onsubmit: (e) => { e.preventDefault(); submit(); } },
    h('div', { class: 'onb-avatar' }, avatar({ id: S.me.id, name: S.me.name }, 96)),
    h('h1', {}, 'Ваш профиль'),
    h('p', { class: 'login-sub' }, 'Выберите имя и уникальный юзернейм —\nпо нему вас смогут найти.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Имя'), name),
    uname.wrap,
    h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Продолжить'),
    h('button', { class: 'link-btn', type: 'button', onclick: logout }, 'Выйти'));
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }), h('div', { class: 'blob b3' }), form));
  (name.value ? uname.input : name).focus();
}

async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  S.socket?.disconnect();
  location.href = '/';
}

// ============================================================ main layout

function startApp() {
  mergeUser(S.me);
  buildLayout();
  connectSocket();
  loadChats().then(handleDeepLink);
  setInterval(() => { if (S.current) renderHeaderStatus(); }, 30_000);
  history.replaceState({ root: true }, '', location.pathname.startsWith('/@') ? location.pathname : '/');
}

function buildLayout() {
  V.search = h('input', { class: 'search-input', type: 'search', placeholder: 'Поиск', autocomplete: 'off', spellcheck: false });
  V.search.addEventListener('input', onSearchInput);
  V.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSearch(); });
  V.list = h('div', { class: 'chat-list' });
  V.conn = h('div', { class: 'conn-status hidden' }, h('span', { class: 'spinner' }), 'Соединение…');
  V.sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'sidebar-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Меню', onclick: openDrawer }, icon('menu')),
      h('div', { class: 'search-wrap' }, icon('search', 'search-ic'), V.search,
        h('button', { class: 'search-clear', 'aria-label': 'Очистить', onclick: clearSearch }, icon('close')))),
    V.conn,
    V.list,
    h('button', { class: 'fab', 'aria-label': 'Новый чат', onclick: onFab }, icon('pencil')));
  V.pane = h('main', { class: 'chat-pane' }, emptyPane());
  V.layout = h('div', { class: 'layout' }, V.sidebar, V.pane);
  app.replaceChildren(V.layout);
  renderChatList();
}

function emptyPane() {
  return h('div', { class: 'empty-pane' },
    h('div', { class: 'empty-card' },
      h('img', { src: '/icons/icon.svg', alt: '', width: 72, height: 72 }),
      h('div', { class: 'empty-title' }, 'Выберите чат'),
      h('div', { class: 'empty-sub' }, 'или найдите человека по @юзернейму в поиске слева')));
}

function onFab(e) {
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(r.left - 150, r.top - 110, [
    { icon: 'group', label: 'Новая группа', onClick: newGroupModal },
    { icon: 'at', label: 'Найти по юзернейму', onClick: () => { V.search.focus(); toast('Введите @юзернейм в поиске'); } },
    { icon: 'bookmark', label: 'Избранное', onClick: openSaved },
  ]);
}

// ============================================================ data loading

async function loadChats() {
  try {
    const { chats } = await api.get('/chats');
    S.chats.clear();
    chats.forEach(upsertChat);
    renderChatList();
    updateBadge();
  } catch (e) {
    if (e.status === 401 || e.status === 403) return location.reload();
    toast(errorText(e), 'error');
  }
}

function upsertChat(c) {
  if (!c) return;
  if (c.peer) mergeUser(c.peer);
  const prev = S.chats.get(c.id);
  // Keep "read" state optimistic for the chat on screen.
  if (prev && c.id === S.current && isViewingBottom()) c.unread = 0;
  S.chats.set(c.id, c);
}

async function handleDeepLink() {
  const m = location.pathname.match(/^\/@([A-Za-z][A-Za-z0-9_]{4,31})$/);
  history.replaceState({ root: true }, '', '/');
  if (!m) return;
  try {
    const { users } = await api.get(`/users/search?q=${encodeURIComponent(m[1])}`);
    const u = users.find((x) => x.username.toLowerCase() === m[1].toLowerCase());
    if (u) startPrivate(u.id);
    else if (m[1].toLowerCase() === S.me.username.toLowerCase()) openSaved();
    else toast('Пользователь не найден');
  } catch { /* ignore */ }
}

// ============================================================ socket

function connectSocket() {
  const s = io({ transports: ['websocket', 'polling'], withCredentials: true });
  S.socket = s;
  let wasConnected = false;
  s.on('connect', () => {
    S.connected = true;
    V.conn.classList.add('hidden');
    if (wasConnected) resync();
    wasConnected = true;
  });
  s.on('disconnect', () => {
    S.connected = false;
    V.conn.classList.remove('hidden');
  });
  s.on('connect_error', async (err) => {
    V.conn.classList.remove('hidden');
    if (err?.message === 'unauthorized') {
      try { await api.get('/me'); } catch (e) { if (e.status === 401) location.reload(); }
    }
  });

  s.on('message', ({ message, chat }) => {
    upsertChat(chat);
    clearTyping(message.chatId, message.senderId);
    addMessage(message);
    renderChatList();
    if (message.chatId === S.current) {
      renderMessages({ stick: message.senderId === S.me.id });
      markRead();
    }
    updateBadge();
    if (message.senderId && message.senderId !== S.me.id) notify(chat, message);
  });
  s.on('message:edit', (m) => {
    const st = S.msgs.get(m.chatId);
    const i = st?.items.findIndex((x) => x.id === m.id) ?? -1;
    if (i >= 0) st.items[i] = m;
    const c = S.chats.get(m.chatId);
    if (c?.lastMessage?.id === m.id) c.lastMessage = m;
    renderChatList();
    if (m.chatId === S.current) renderMessages();
  });
  s.on('message:delete', ({ chatId, messageId, chat }) => {
    const st = S.msgs.get(chatId);
    if (st) st.items = st.items.filter((x) => x.id !== messageId);
    upsertChat(chat);
    renderChatList();
    updateBadge();
    if (chatId === S.current) renderMessages();
  });
  s.on('chat', (c) => {
    upsertChat(c);
    renderChatList();
    updateBadge();
    if (c.id === S.current) renderHeader();
  });
  s.on('chat:removed', ({ chatId }) => {
    S.chats.delete(chatId);
    S.msgs.delete(chatId);
    if (S.current === chatId) closeChat();
    renderChatList();
    updateBadge();
  });
  s.on('read', ({ chatId, messageId }) => {
    const c = S.chats.get(chatId);
    if (!c) return;
    c.peerReadId = Math.max(c.peerReadId, messageId);
    renderChatList();
    if (chatId === S.current) renderMessages();
  });
  s.on('typing', ({ chatId, userId }) => {
    let t = S.typing.get(chatId);
    if (!t) S.typing.set(chatId, (t = new Map()));
    clearTimeout(t.get(userId));
    t.set(userId, setTimeout(() => clearTyping(chatId, userId), 5000));
    renderChatList();
    if (chatId === S.current) renderHeaderStatus();
  });
  s.on('presence', ({ userId, online, lastSeen }) => {
    mergeUser({ id: userId, online, lastSeen });
    renderChatList();
    if (S.current) renderHeaderStatus();
  });
  s.on('user', (u) => {
    mergeUser(u);
    renderChatList();
    if (S.current) { renderHeader(); renderMessages(); }
  });
}

function clearTyping(chatId, userId) {
  const t = S.typing.get(chatId);
  if (!t?.has(userId)) return;
  clearTimeout(t.get(userId));
  t.delete(userId);
  renderChatList();
  if (chatId === S.current) renderHeaderStatus();
}

async function resync() {
  await loadChats();
  for (const [id, st] of S.msgs) if (id !== S.current) st.loaded = false;
  const st = S.msgs.get(S.current);
  if (!st) return;
  const lastId = st.items.filter((m) => typeof m.id === 'number').at(-1)?.id;
  try {
    if (lastId) {
      const { messages } = await api.get(`/chats/${S.current}/messages?after=${lastId}`);
      messages.forEach(addMessage);
      renderMessages();
      markRead();
    } else {
      loadMessages(S.current);
    }
  } catch { /* ignore */ }
}

async function notify(chat, m) {
  if (m.chatId === S.current && !document.hidden) return;
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const title = isGroup(chat) ? chat.title : userName(m.senderId);
  const body = `${isGroup(chat) ? `${userName(m.senderId)}: ` : ''}${messagePreview(m)}`.slice(0, 140);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag: `chat${chat.id}`, renotify: true, icon: '/icons/icon-192.png', badge: '/icons/badge.png', data: { chatId: chat.id } };
    if (reg) reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch { /* ignore */ }
}

// ============================================================ chat list

function renderChatList() {
  if (!V.list) return;
  if (S.searchQuery) return renderSearch();
  const chats = [...S.chats.values()].sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0) || b.id - a.id);
  if (!chats.length) {
    V.list.replaceChildren(h('div', { class: 'list-empty' },
      h('div', { class: 'list-empty-emoji' }, '👋'),
      h('div', { class: 'list-empty-title' }, 'Пока нет чатов'),
      h('div', {}, 'Найдите друга по @юзернейму в поиске или создайте группу.'),
      h('button', { class: 'btn btn-primary', onclick: () => V.search.focus() }, 'Найти людей')));
    return;
  }
  V.list.replaceChildren(...chats.map(chatItem));
}

function chatItem(c) {
  const lm = c.lastMessage;
  const typing = typingText(c);
  let preview;
  if (typing) {
    preview = h('span', { class: 'typing-text' }, typing, typingDots());
  } else if (!lm) {
    preview = h('span', { class: 'muted' }, c.type === 'saved' ? 'Сохраняйте сюда заметки и файлы' : 'Нет сообщений');
  } else if (lm.kind === 'system') {
    preview = h('span', { class: 'muted' }, lm.text);
  } else {
    const who = lm.senderId === S.me.id && c.type !== 'saved' ? 'Вы' : isGroup(c) ? userName(lm.senderId).split(' ')[0] : null;
    preview = [who ? h('span', { class: 'preview-who' }, `${who}: `) : null, messagePreview(lm)];
  }
  const mine = lm && lm.senderId === S.me.id && c.type !== 'saved';
  const read = mine && lm.id <= c.peerReadId;
  return h('button', {
    class: `chat-item ${c.id === S.current ? 'active' : ''}`,
    onclick: () => openChat(c.id),
    oncontextmenu: (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { icon: 'info', label: 'Информация', onClick: () => openInfo(c) },
        isGroup(c) ? { icon: 'leave', label: 'Покинуть группу', danger: true, onClick: () => leaveGroup(c) } : null,
      ]);
    },
  },
  chatAvatar(c, 54),
  h('div', { class: 'chat-item-body' },
    h('div', { class: 'chat-item-top' },
      h('span', { class: 'chat-item-title' }, isGroup(c) ? icon('group', 'title-ic') : null, chatTitle(c)),
      h('span', { class: 'chat-item-time' }, mine ? icon(read ? 'checks' : 'check', 'tick') : null, lm ? listTime(lm.createdAt) : '')),
    h('div', { class: 'chat-item-bottom' },
      h('span', { class: 'chat-item-preview' }, preview),
      c.unread ? h('span', { class: 'badge' }, c.unread > 999 ? '999+' : c.unread) : null)));
}

let searchTimer = null;
function onSearchInput() {
  S.searchQuery = V.search.value.trim();
  V.sidebar.classList.toggle('searching', !!S.searchQuery);
  clearTimeout(searchTimer);
  S.searchResults = null;
  renderChatList();
  if (S.searchQuery.replace(/^@/, '').length < 2) return;
  const q = S.searchQuery;
  searchTimer = setTimeout(async () => {
    try {
      const { users } = await api.get(`/users/search?q=${encodeURIComponent(q)}`);
      if (q !== S.searchQuery) return;
      users.forEach(mergeUser);
      S.searchResults = users;
      renderChatList();
    } catch { /* ignore */ }
  }, 250);
}

function clearSearch() {
  V.search.value = '';
  S.searchQuery = '';
  S.searchResults = null;
  V.sidebar.classList.remove('searching');
  renderChatList();
}

function renderSearch() {
  const q = S.searchQuery.replace(/^@/, '').toLowerCase();
  const local = [...S.chats.values()].filter((c) => chatTitle(c).toLowerCase().includes(q)
    || peerOf(c)?.username?.toLowerCase().includes(q));
  const localPeerIds = new Set(local.map((c) => peerOf(c)?.id).filter(Boolean));
  const global = (S.searchResults || []).filter((u) => !localPeerIds.has(u.id));
  const nodes = [];
  if (local.length) nodes.push(h('div', { class: 'list-section' }, 'Чаты'), ...local.map(chatItem));
  nodes.push(h('div', { class: 'list-section' }, 'Глобальный поиск'));
  if (S.searchResults === null && q.length >= 2) nodes.push(h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
  else if (q.length < 2) nodes.push(h('div', { class: 'list-note' }, 'Введите минимум 2 символа'));
  else if (!global.length) nodes.push(h('div', { class: 'list-note' }, 'Никого не нашли 🤷'));
  for (const u of global) {
    nodes.push(h('button', { class: 'chat-item', onclick: () => { clearSearch(); startPrivate(u.id); } },
      avatar({ id: u.id, name: u.name, src: u.avatar, online: u.online }, 54),
      h('div', { class: 'chat-item-body' },
        h('div', { class: 'chat-item-top' }, h('span', { class: 'chat-item-title' }, u.name)),
        h('div', { class: 'chat-item-bottom' }, h('span', { class: 'chat-item-preview accent' }, `@${u.username}`)))));
  }
  V.list.replaceChildren(...nodes);
}

async function startPrivate(userId) {
  try {
    const { chat } = await api.post('/chats/private', { userId });
    upsertChat(chat);
    renderChatList();
    openChat(chat.id);
  } catch (e) { toast(errorText(e), 'error'); }
}
const openSaved = () => startPrivate(S.me.id);

// ============================================================ chat view

function openChat(id, { fromHistory = false } = {}) {
  const c = S.chats.get(id);
  if (!c) return;
  closeMenu();
  if (S.current && V.input) S.drafts.set(S.current, V.input.value);
  const wasOpen = !!S.current;
  S.current = id;
  S.reply = null;
  S.editing = null;
  if (S.searchQuery) clearSearch();
  buildChatView(c);
  renderChatList();
  V.layout.classList.add('chat-open');
  if (!fromHistory && !wasOpen) history.pushState({ chat: id }, '', '/');
  else if (!fromHistory) history.replaceState({ chat: id }, '', '/');
  const st = S.msgs.get(id);
  if (st?.loaded) {
    renderMessages({ stick: true });
    markRead();
  } else {
    loadMessages(id);
  }
  if (isGroup(c)) loadGroupMembers(id);
  if (!isTouch()) V.input.focus();
}

function closeChat({ fromHistory = false } = {}) {
  if (!S.current) return;
  if (V.input) S.drafts.set(S.current, V.input.value);
  S.current = null;
  V.layout.classList.remove('chat-open');
  renderChatList();
  setTimeout(() => { if (!S.current) V.pane.replaceChildren(emptyPane()); }, 260);
  if (!fromHistory && history.state?.chat) history.back();
}

window.addEventListener('popstate', (e) => {
  closeMenu();
  if (closeTopModal()) {
    if (S.current) history.pushState({ chat: S.current }, '', '/');
    return;
  }
  if (e.state?.chat && S.chats.has(e.state.chat)) openChat(e.state.chat, { fromHistory: true });
  else closeChat({ fromHistory: true });
});

async function loadGroupMembers(id) {
  try {
    const { members } = await api.get(`/chats/${id}`);
    members?.forEach(mergeUser);
    if (S.current === id) renderMessages();
  } catch { /* ignore */ }
}

function buildChatView(c) {
  nodeCache.clear();
  V.headerAvatar = h('div', { class: 'header-avatar' });
  V.headerTitle = h('div', { class: 'header-title' });
  V.headerStatus = h('div', { class: 'header-status' });
  const header = h('header', { class: 'chat-header' },
    h('button', { class: 'icon-btn back-btn', 'aria-label': 'Назад', onclick: () => closeChat() }, icon('back')),
    h('button', { class: 'header-info', onclick: () => openInfo(curChat()) }, V.headerAvatar,
      h('div', { class: 'header-text' }, V.headerTitle, V.headerStatus)),
    h('button', { class: 'icon-btn', 'aria-label': 'Информация', onclick: () => openInfo(curChat()) }, icon('info')));

  V.msgInner = h('div', { class: 'messages-inner' });
  V.scroller = h('div', { class: 'messages' }, V.msgInner);
  V.scroller.addEventListener('scroll', onScroll, { passive: true });
  V.downBadge = h('span', { class: 'badge hidden' });
  V.downBtn = h('button', { class: 'scroll-down hidden', 'aria-label': 'Вниз', onclick: () => scrollToBottom(true) }, icon('down'), V.downBadge);

  V.bar = h('div', { class: 'composer-bar hidden' });
  V.input = h('textarea', { class: 'composer-input', rows: 1, placeholder: 'Сообщение', maxLength: 4096, enterkeyhint: S.settings.enterToSend ? 'send' : 'enter' });
  V.input.value = S.drafts.get(c.id) || '';
  V.input.addEventListener('input', onComposerInput);
  V.input.addEventListener('keydown', onComposerKey);
  V.input.addEventListener('paste', onPaste);
  V.file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', class: 'hidden', onchange: (e) => { if (e.target.files[0]) imageSendModal(e.target.files[0]); e.target.value = ''; } });
  V.sendBtn = h('button', { class: 'send-btn', 'aria-label': 'Отправить', onclick: submitComposer }, icon('send'));
  const composer = h('div', { class: 'composer' },
    V.bar,
    h('div', { class: 'composer-row' },
      h('div', { class: 'composer-box' },
        h('button', { class: 'icon-btn attach-btn', 'aria-label': 'Прикрепить фото', onclick: () => V.file.click() }, icon('attach')),
        V.input, V.file),
      V.sendBtn));

  const view = h('div', { class: 'chat-view' }, header, h('div', { class: 'messages-wrap' }, V.scroller, V.downBtn), composer);
  view.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); view.classList.add('drag'); } });
  view.addEventListener('dragleave', (e) => { if (e.target === view || !view.contains(e.relatedTarget)) view.classList.remove('drag'); });
  view.addEventListener('drop', (e) => {
    view.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) { e.preventDefault(); imageSendModal(f); }
  });
  V.pane.replaceChildren(view);
  renderHeader();
  autosize();
  updateSendBtn();
}

function renderHeader() {
  const c = curChat();
  if (!c || !V.headerTitle) return;
  V.headerAvatar.replaceChildren(chatAvatar(c, 42));
  V.headerTitle.textContent = chatTitle(c);
  renderHeaderStatus();
}

function renderHeaderStatus() {
  const c = curChat();
  if (!c || !V.headerStatus) return;
  const typing = typingText(c);
  V.headerStatus.className = 'header-status';
  if (typing) {
    V.headerStatus.replaceChildren(typing, typingDots());
    V.headerStatus.classList.add('accent');
  } else if (c.type === 'private') {
    const p = peerOf(c);
    V.headerStatus.textContent = lastSeenText(p);
    if (p?.online) V.headerStatus.classList.add('accent');
  } else if (c.type === 'group') {
    V.headerStatus.textContent = `${c.membersCount} ${plural(c.membersCount, 'участник', 'участника', 'участников')}`;
  } else {
    V.headerStatus.textContent = 'заметки для себя';
  }
}

async function loadMessages(id) {
  let st = S.msgs.get(id);
  if (!st) S.msgs.set(id, (st = { items: [], hasMore: true, loaded: false, loading: false }));
  if (st.loading) return;
  st.loading = true;
  V.msgInner.replaceChildren(h('div', { class: 'msgs-loading' }, h('span', { class: 'spinner' })));
  try {
    const r = await api.get(`/chats/${id}/messages`);
    st.items = r.messages;
    st.hasMore = r.hasMore;
    st.loaded = true;
    if (S.current === id) {
      renderMessages({ stick: true });
      markRead();
    }
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    st.loading = false;
  }
}

async function loadOlder() {
  const id = S.current;
  const st = S.msgs.get(id);
  if (!st?.loaded || st.loading || !st.hasMore) return;
  const first = st.items.find((m) => typeof m.id === 'number');
  if (!first) return;
  st.loading = true;
  try {
    const r = await api.get(`/chats/${id}/messages?before=${first.id}`);
    const known = new Set(st.items.map((m) => m.id));
    st.items = [...r.messages.filter((m) => !known.has(m.id)), ...st.items];
    st.hasMore = r.hasMore;
    if (S.current === id) renderMessages({ keepOffset: true });
  } catch { /* ignore */ } finally {
    st.loading = false;
  }
}

function addMessage(m) {
  const st = S.msgs.get(m.chatId);
  if (!st?.loaded) return;
  if (st.items.some((x) => x.id === m.id)) return;
  if (m.senderId === S.me.id) {
    // Replace our own optimistic copy if the socket beat the HTTP response.
    const i = st.items.findIndex((x) => x.pending && x.kind === m.kind && x.text === m.text);
    if (i >= 0) st.items.splice(i, 1);
  }
  const tmpStart = st.items.findIndex((x) => typeof x.id !== 'number');
  if (tmpStart >= 0) st.items.splice(tmpStart, 0, m);
  else st.items.push(m);
}

// ---------- message rendering

const dayKey = (t) => new Date(t).toDateString();
const GAP = 5 * 60_000;

function isViewingBottom() {
  if (!V.scroller || document.hidden) return false;
  return V.scroller.scrollHeight - V.scroller.scrollTop - V.scroller.clientHeight < 120;
}

function renderMessages({ stick = false, keepOffset = false } = {}) {
  const c = curChat();
  const st = S.msgs.get(S.current);
  if (!c || !st?.loaded || !V.msgInner) return;
  const atBottom = stick || isViewingBottom();
  const fromBottom = V.scroller.scrollHeight - V.scroller.scrollTop;

  const nodes = [];
  if (!st.hasMore && st.items.length) nodes.push(h('div', { class: 'chat-start' }));
  if (!st.items.length) nodes.push(emptyChatHint(c));
  const used = new Set();
  st.items.forEach((m, i) => {
    const prev = st.items[i - 1];
    const next = st.items[i + 1];
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    if (newDay) nodes.push(h('div', { class: 'date-sep' }, h('span', {}, dayLabel(m.createdAt))));
    if (m.kind === 'system') {
      nodes.push(h('div', { class: 'system-msg' }, h('span', {}, m.text)));
      return;
    }
    const first = newDay || prev.kind === 'system' || prev.senderId !== m.senderId || m.createdAt - prev.createdAt > GAP;
    const last = !next || next.kind === 'system' || next.senderId !== m.senderId || next.createdAt - m.createdAt > GAP
      || dayKey(next.createdAt) !== dayKey(m.createdAt);
    const key = String(m.id);
    used.add(key);
    const sender = S.users.get(m.senderId);
    const read = m.senderId === S.me.id && typeof m.id === 'number' && m.id <= c.peerReadId;
    const sig = [m.editedAt, m.text, first, last, read, m.pending, sender?.name, sender?.avatar,
      m.replyTo?.id, m.replyTo && userName(m.replyTo.senderId)].join('|');
    let cached = nodeCache.get(key);
    if (!cached || cached.sig !== sig) {
      cached = { sig, el: messageEl(c, m, first, last, read) };
      nodeCache.set(key, cached);
    }
    nodes.push(cached.el);
  });
  for (const k of nodeCache.keys()) if (!used.has(k)) nodeCache.delete(k);
  V.msgInner.replaceChildren(...nodes);

  if (atBottom) scrollToBottom();
  else if (keepOffset) V.scroller.scrollTop = V.scroller.scrollHeight - fromBottom;
  updateDownBtn();
}

function emptyChatHint(c) {
  if (c.type === 'saved') {
    return h('div', { class: 'chat-hint' }, h('div', { class: 'chat-hint-emoji' }, '📌'),
      h('b', {}, 'Избранное'), h('span', {}, 'Пересылайте сюда сообщения, сохраняйте заметки и фото — они будут на всех ваших устройствах.'));
  }
  const greet = ['👋', '🍋', '✨', '😊'][c.id % 4];
  return h('div', { class: 'chat-hint' }, h('button', { class: 'chat-hint-emoji', onclick: () => sendText(greet) }, greet),
    h('b', {}, 'Здесь пока пусто'), h('span', {}, 'Напишите что-нибудь или нажмите на эмодзи, чтобы поздороваться.'));
}

function messageEl(c, m, first, last, read) {
  const mine = m.senderId === S.me.id;
  const group = isGroup(c);
  const emoji = m.kind === 'text' && !m.replyTo ? emojiCount(m.text) : 0;
  const bigEmoji = emoji > 0 && emoji <= 3;
  const imageOnly = m.kind === 'image' && !m.text;

  const meta = h('span', { class: 'meta' },
    m.editedAt ? h('span', { class: 'edited' }, 'изм.') : null,
    timeHM(m.createdAt),
    mine && m.pending ? h('span', { class: 'clock' }) : null,
    mine && !m.pending && c.type !== 'saved' ? icon(read ? 'checks' : 'check', `tick ${read ? 'read' : ''}`) : null);

  const bubble = h('div', { class: `bubble ${bigEmoji ? 'big-emoji' : ''} ${imageOnly ? 'image-only' : ''} ${m.kind === 'image' ? 'has-image' : ''}` });
  if (group && !mine && first && !bigEmoji) {
    bubble.append(h('div', { class: 'sender-name', style: { color: nameColor(m.senderId) } }, userName(m.senderId)));
    ensureUser(m.senderId);
  }
  if (m.replyTo) {
    const r = m.replyTo;
    bubble.append(h('button', { class: 'reply-quote', onclick: (e) => { e.stopPropagation(); jumpTo(r.id); } },
      h('b', {}, r.deleted ? 'Удалённое сообщение' : userName(r.senderId)),
      h('span', {}, r.deleted ? '' : r.kind === 'image' ? `🖼 ${r.text || 'Фото'}` : r.text)));
  }
  if (m.kind === 'image') {
    const ratio = m.width && m.height ? m.width / m.height : 4 / 3;
    const img = h('img', { src: m.localUrl || m.file, alt: '', decoding: 'async', draggable: false });
    img.addEventListener('load', () => { if (stickAfterLoad) scrollToBottom(); }, { once: true });
    bubble.append(h('div', {
      class: 'bubble-image',
      style: { aspectRatio: String(Math.min(Math.max(ratio, 0.5), 2.2)) },
      onclick: () => !m.pending && openViewer(m),
    }, img, imageOnly ? meta : null));
  }
  if (bigEmoji) {
    bubble.append(h('div', { class: `emoji-text e${emoji}` }, m.text), meta);
  } else if (m.text) {
    bubble.append(h('div', { class: 'text' }, richText(m.text), h('span', { class: 'meta-spacer' })), meta);
  }

  const row = h('div', {
    class: `msg-row ${mine ? 'mine' : 'theirs'} ${first ? 'first' : ''} ${last ? 'last' : ''} ${group && !mine ? 'with-avatar' : ''}`,
    dataset: { id: String(m.id) },
  });
  if (group && !mine) {
    const u = S.users.get(m.senderId);
    row.append(last
      ? h('button', { class: 'msg-avatar', onclick: () => openUserProfile(m.senderId) }, avatar({ id: m.senderId, name: u?.name || '?', src: u?.avatar }, 34))
      : h('div', { class: 'msg-avatar' }));
  }
  row.append(bubble);
  attachMessageMenu(row, bubble, m);
  return row;
}

let stickAfterLoad = false;
function scrollToBottom(smooth = false) {
  if (!V.scroller) return;
  V.scroller.scrollTo({ top: V.scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  stickAfterLoad = true;
  clearTimeout(scrollToBottom.t);
  scrollToBottom.t = setTimeout(() => { stickAfterLoad = false; }, 1500);
}

function onScroll() {
  if (V.scroller.scrollTop < 300) loadOlder();
  if (!isViewingBottom()) stickAfterLoad = false;
  updateDownBtn();
  if (isViewingBottom()) markRead();
}

function updateDownBtn() {
  const c = curChat();
  const show = !isViewingBottom() && V.scroller.scrollHeight - V.scroller.scrollTop - V.scroller.clientHeight > 300;
  V.downBtn.classList.toggle('hidden', !show);
  V.downBadge.textContent = c?.unread || '';
  V.downBadge.classList.toggle('hidden', !c?.unread);
}

function jumpTo(id) {
  const el = V.msgInner.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (!el) return toast('Сообщение выше — прокрутите историю');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

let readTimer = null;
function markRead() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    const c = curChat();
    const st = S.msgs.get(S.current);
    if (!c || !st?.loaded || document.hidden || !isViewingBottom()) return;
    const lastId = st.items.filter((m) => typeof m.id === 'number').at(-1)?.id || 0;
    if (lastId > c.lastReadId || c.unread) {
      c.lastReadId = Math.max(c.lastReadId, lastId);
      c.unread = 0;
      renderChatList();
      updateBadge();
      updateDownBtn();
      if (lastId) api.post(`/chats/${c.id}/read`, { messageId: lastId }).catch(() => {});
    }
  }, 150);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });

// ---------- message context menu

function attachMessageMenu(row, bubble, m) {
  let timer = null;
  let sx = 0, sy = 0, opened = 0;
  const open = (x, y) => {
    if (typeof m.id !== 'number') return;
    opened = Date.now();
    bubble.classList.add('pressed');
    setTimeout(() => bubble.classList.remove('pressed'), 200);
    showMessageMenu(m, x, y);
  };
  row.addEventListener('contextmenu', (e) => {
    if (e.target.closest('a')) return;
    e.preventDefault();
    if (Date.now() - opened > 700) open(e.clientX, e.clientY);
  });
  bubble.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
    timer = setTimeout(() => { navigator.vibrate?.(10); open(sx, sy); }, 450);
  }, { passive: true });
  bubble.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) clearTimeout(timer);
  }, { passive: true });
  bubble.addEventListener('touchend', () => clearTimeout(timer));
  bubble.addEventListener('touchcancel', () => clearTimeout(timer));
  bubble.addEventListener('dblclick', (e) => {
    if (isTouch() || e.target.closest('a, .bubble-image')) return;
    window.getSelection()?.removeAllRanges();
    if (typeof m.id === 'number') startReply(m);
  });
}

function showMessageMenu(m, x, y) {
  const c = curChat();
  const mine = m.senderId === S.me.id;
  const canDelete = mine || (isGroup(c) && c.ownerId === S.me.id);
  contextMenu(x, y, [
    { icon: 'reply', label: 'Ответить', onClick: () => startReply(m) },
    m.text ? { icon: 'copy', label: 'Копировать', onClick: () => copyText(m.text) } : null,
    m.kind === 'image' ? { icon: 'download', label: 'Открыть фото', onClick: () => openViewer(m) } : null,
    mine ? { icon: 'edit', label: 'Изменить', onClick: () => startEdit(m) } : null,
    canDelete ? { icon: 'trash', label: 'Удалить', danger: true, onClick: () => deleteMessage(m) } : null,
  ]);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  } catch { toast('Не удалось скопировать', 'error'); }
}

async function deleteMessage(m) {
  if (!(await confirmDialog('Удалить сообщение у всех?', { ok: 'Удалить', danger: true }))) return;
  try { await api.del(`/messages/${m.id}`); } catch (e) { toast(errorText(e), 'error'); }
}

// ---------- composer

function startReply(m) {
  S.editing = null;
  S.reply = m;
  renderBar();
  V.input.focus();
}

function startEdit(m) {
  S.reply = null;
  S.editing = m;
  if (!S.drafts.has(-1)) S.drafts.set(-1, V.input.value);
  V.input.value = m.text;
  renderBar();
  autosize();
  updateSendBtn();
  V.input.focus();
  V.input.setSelectionRange(V.input.value.length, V.input.value.length);
}

function cancelBar() {
  if (S.editing) {
    V.input.value = S.drafts.get(-1) || '';
    S.drafts.delete(-1);
    autosize();
    updateSendBtn();
  }
  S.reply = null;
  S.editing = null;
  renderBar();
}

function renderBar() {
  const m = S.reply || S.editing;
  if (!m) {
    V.bar.classList.add('hidden');
    V.bar.replaceChildren();
    return;
  }
  V.bar.classList.remove('hidden');
  V.bar.replaceChildren(
    icon(S.editing ? 'edit' : 'reply', 'bar-ic'),
    h('div', { class: 'bar-body', onclick: () => jumpTo(m.id) },
      h('b', {}, S.editing ? 'Редактирование' : `Ответ ${userName(m.senderId)}`),
      h('span', {}, m.kind === 'image' ? `🖼 ${m.text || 'Фото'}` : m.text)),
    h('button', { class: 'icon-btn', 'aria-label': 'Отмена', onclick: cancelBar }, icon('close')));
}

let lastTypingSent = 0;
function onComposerInput() {
  autosize();
  updateSendBtn();
  const t = Date.now();
  if (V.input.value && t - lastTypingSent > 3000 && S.current && S.chats.get(S.current)?.type !== 'saved') {
    lastTypingSent = t;
    S.socket?.emit('typing', { chatId: S.current });
  }
}

function onComposerKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && S.settings.enterToSend) {
    e.preventDefault();
    submitComposer();
  } else if (e.key === 'Escape' && (S.reply || S.editing)) {
    e.preventDefault();
    e.stopPropagation();
    cancelBar();
  } else if (e.key === 'ArrowUp' && !V.input.value && !S.editing) {
    const st = S.msgs.get(S.current);
    const mine = st?.items.filter((m) => m.senderId === S.me.id && typeof m.id === 'number' && m.kind !== 'system').at(-1);
    if (mine) { e.preventDefault(); startEdit(mine); }
  }
}

function onPaste(e) {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) {
    e.preventDefault();
    imageSendModal(f);
  }
}

function autosize() {
  V.input.style.height = 'auto';
  V.input.style.height = `${Math.min(V.input.scrollHeight, 180)}px`;
}
function updateSendBtn() {
  V.sendBtn.classList.toggle('active', !!V.input.value.trim() || !!S.editing);
}

async function submitComposer() {
  const text = V.input.value.trim();
  if (S.editing) {
    const m = S.editing;
    if (!text && m.kind === 'text') return deleteMessage(m);
    S.editing = null;
    V.input.value = S.drafts.get(-1) || '';
    S.drafts.delete(-1);
    renderBar(); autosize(); updateSendBtn();
    if (text !== m.text) {
      try { await api.patch(`/messages/${m.id}`, { text }); } catch (e) { toast(errorText(e), 'error'); }
    }
    return;
  }
  if (!text) return;
  V.input.value = '';
  S.drafts.delete(S.current);
  autosize();
  updateSendBtn();
  if (isTouch()) V.input.focus();
  sendText(text);
}

async function sendText(text) {
  const chatId = S.current;
  const reply = S.reply;
  S.reply = null;
  renderBar();
  const st = S.msgs.get(chatId);
  const tmp = {
    id: `tmp${++tmpSeq}`, chatId, senderId: S.me.id, kind: 'text', text, pending: true, createdAt: Date.now(),
    replyTo: reply ? { id: reply.id, senderId: reply.senderId, kind: reply.kind, text: reply.text } : null,
  };
  st?.items.push(tmp);
  renderMessages({ stick: true });
  try {
    const { message } = await api.post(`/chats/${chatId}/messages`, { text, replyTo: reply?.id });
    if (st) {
      st.items = st.items.filter((x) => x !== tmp);
      addMessage(message);
    }
  } catch (e) {
    if (st) st.items = st.items.filter((x) => x !== tmp);
    toast(errorText(e), 'error');
    if (S.current === chatId && !V.input.value) { V.input.value = text; autosize(); updateSendBtn(); }
  }
  if (S.current === chatId) renderMessages({ stick: true });
}

// ---------- images

/** Re-encode on the client: shrinks big photos and strips EXIF (incl. GPS). */
async function prepareImage(file, maxSide = 2560, square = false) {
  if (file.type === 'image/gif' && !square) return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale), hgt = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
  bmp.close?.();
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise((r) => canvas.toBlob(r, type, 0.88));
  return blob || file;
}

function imageSendModal(file) {
  if (!file.type.startsWith('image/')) return toast('Можно отправлять только изображения', 'error');
  const url = URL.createObjectURL(file);
  const caption = h('input', { class: 'input', placeholder: 'Подпись…', maxLength: 1024 });
  const chatId = S.current;
  const reply = S.reply;
  let busy = false;
  const send = async (close) => {
    if (busy) return;
    busy = true;
    close();
    S.reply = null;
    renderBar();
    const st = S.msgs.get(chatId);
    const tmp = { id: `tmp${++tmpSeq}`, chatId, senderId: S.me.id, kind: 'image', text: caption.value.trim(), localUrl: url, pending: true, createdAt: Date.now() };
    st?.items.push(tmp);
    if (S.current === chatId) renderMessages({ stick: true });
    try {
      const blob = await prepareImage(file);
      const fd = new FormData();
      fd.append('file', blob, 'image');
      fd.append('text', tmp.text);
      if (reply) fd.append('replyTo', reply.id);
      const { message } = await api.post(`/chats/${chatId}/images`, fd);
      if (st) { st.items = st.items.filter((x) => x !== tmp); addMessage(message); }
    } catch (e) {
      if (st) st.items = st.items.filter((x) => x !== tmp);
      toast(errorText(e), 'error');
    }
    if (S.current === chatId) renderMessages({ stick: true });
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(m.close); } });
  const m = openModal({
    title: 'Отправить фото',
    className: 'modal-image',
    body: h('div', { class: 'image-preview' }, h('img', { src: url, alt: '' }), caption),
    actions: [
      { label: 'Отмена', onClick: (close) => { URL.revokeObjectURL(url); close(); } },
      { label: 'Отправить', primary: true, onClick: send },
    ],
  });
  setTimeout(() => caption.focus(), 50);
}

function openViewer(m) {
  const src = m.localUrl || m.file;
  const sender = m.senderId === S.me.id ? S.me : S.users.get(m.senderId);
  let closeFn;
  const v = h('div', { class: 'viewer', onclick: (e) => { if (!e.target.closest('.viewer-bar a, .viewer-bar button')) closeFn(); } },
    h('div', { class: 'viewer-bar' },
      h('div', { class: 'viewer-who' }, avatar({ id: m.senderId, name: sender?.name || '?', src: sender?.avatar }, 36),
        h('div', {}, h('b', {}, sender?.name || 'Пользователь'), h('span', {}, `${dayLabel(m.createdAt)}, ${timeHM(m.createdAt)}`))),
      h('a', { class: 'icon-btn', href: src, download: '', 'aria-label': 'Скачать' }, icon('download')),
      h('button', { class: 'icon-btn', 'aria-label': 'Закрыть' }, icon('close'))),
    h('img', { src, alt: '' }),
    m.text ? h('div', { class: 'viewer-caption' }, m.text) : null);
  const { close } = openModal({ className: 'modal-viewer', body: v });
  closeFn = close;
}

// ============================================================ drawer & modals

function openDrawer() {
  const me = S.me;
  let backdrop;
  const close = () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
  };
  const item = (ic, label, onClick, cls = '') => h('button', { class: `drawer-item ${cls}`, onclick: () => { close(); onClick(); } }, icon(ic), label);
  const themeToggle = h('button', {
    class: 'drawer-item',
    onclick: () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      S.settings.theme = dark ? 'light' : 'dark';
      saveSettings();
      sw.classList.toggle('on', !dark);
    },
  }, icon('moon'), 'Ночной режим');
  const sw = h('span', { class: `switch ${document.documentElement.dataset.theme === 'dark' ? 'on' : ''}` });
  themeToggle.append(sw);
  const panel = h('nav', { class: 'drawer' },
    h('div', { class: 'drawer-head' },
      h('button', { class: 'drawer-me', onclick: () => { close(); editProfileModal(); } },
        avatar({ id: me.id, name: me.name, src: me.avatar }, 64),
        h('div', { class: 'drawer-name' }, me.name),
        h('div', { class: 'drawer-username' }, `@${me.username}`))),
    h('div', { class: 'drawer-items' },
      item('user', 'Мой профиль', editProfileModal),
      item('group', 'Создать группу', newGroupModal),
      item('bookmark', 'Избранное', openSaved),
      item('settings', 'Настройки', settingsModal),
      item('devices', 'Активные сеансы', sessionsModal),
      themeToggle,
      !isStandalone() ? item('download', 'Установить приложение', installApp) : null,
      me.isAdmin ? item('shield', 'Админ-панель', () => { location.href = '/admin'; }, 'admin') : null,
      h('div', { class: 'drawer-sep' }),
      item('logout', 'Выйти', async () => { if (await confirmDialog('Выйти из аккаунта на этом устройстве?', { ok: 'Выйти', danger: true })) logout(); }, 'danger')),
    h('div', { class: 'drawer-foot' }, 'Limoninior · v1.0'));
  backdrop = h('div', { class: 'drawer-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
}

function openInfo(c) {
  if (!c) return;
  if (c.type === 'private') return openUserProfile(peerOf(c)?.id);
  if (c.type === 'group') return groupInfoModal(c);
  return openUserProfile(S.me.id);
}

async function openUserProfile(id) {
  if (!id) return;
  if (id === S.me.id) return editProfileModal();
  let u = S.users.get(id);
  try { u = (await api.get(`/users/${id}`)).user; mergeUser(u); } catch { /* use cache */ }
  if (!u) return toast('Пользователь не найден');
  const link = `${location.origin}/@${u.username}`;
  openModal({
    className: 'modal-profile',
    title: 'Профиль',
    body: h('div', { class: 'profile' },
      h('div', { class: 'profile-hero' }, avatar({ id: u.id, name: u.name, src: u.avatar }, 110),
        h('div', { class: 'profile-name' }, u.name),
        h('div', { class: `profile-status ${u.online ? 'accent' : ''}` }, lastSeenText(u))),
      h('div', { class: 'profile-rows' },
        h('button', { class: 'profile-row', onclick: () => copyText(link) }, icon('at'),
          h('div', {}, h('div', { class: 'row-main' }, `@${u.username}`), h('div', { class: 'row-sub' }, 'Юзернейм · нажмите, чтобы скопировать ссылку'))),
        u.bio ? h('div', { class: 'profile-row' }, icon('info'), h('div', {}, h('div', { class: 'row-main' }, u.bio), h('div', { class: 'row-sub' }, 'О себе'))) : null),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => { closeTopModal(); startPrivate(u.id); } }, icon('chat'), 'Написать сообщение')),
  });
}

function editProfileModal() {
  const me = S.me;
  const name = h('input', { class: 'input', value: me.name, maxLength: 64 });
  const uname = usernameField(me.username);
  const bio = h('textarea', { class: 'input', rows: 2, maxLength: 160, placeholder: 'Пара слов о себе' });
  bio.value = me.bio || '';
  const counter = h('span', { class: 'field-counter' }, `${bio.value.length}/160`);
  bio.addEventListener('input', () => { counter.textContent = `${bio.value.length}/160`; });
  const avatarWrap = h('div', { class: 'avatar-edit' });
  const renderAv = () => avatarWrap.replaceChildren(avatar({ id: me.id, name: S.me.name, src: S.me.avatar }, 110),
    h('span', { class: 'avatar-edit-overlay' }, icon('camera')));
  renderAv();
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', await prepareImage(f, 640, true), 'avatar');
      S.me = (await api.post('/me/avatar', fd)).user;
      mergeUser(S.me);
      renderAv();
      toast('Фото обновлено');
    } catch (e) { toast(errorText(e), 'error'); }
  });
  avatarWrap.addEventListener('click', () => {
    const r = avatarWrap.getBoundingClientRect();
    if (!S.me.avatar) return fileIn.click();
    contextMenu(r.left + r.width / 2 - 80, r.bottom, [
      { icon: 'camera', label: 'Загрузить фото', onClick: () => fileIn.click() },
      { icon: 'trash', label: 'Удалить фото', danger: true, onClick: async () => {
        try { S.me = (await api.del('/me/avatar')).user; mergeUser(S.me); renderAv(); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ]);
  });
  openModal({
    title: 'Мой профиль',
    className: 'modal-profile',
    body: h('div', { class: 'profile-form' },
      h('div', { class: 'profile-hero' }, avatarWrap, fileIn, h('div', { class: 'profile-email' }, me.email)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Имя'), name),
      uname.wrap,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'О себе'), bio, counter),
      h('button', { class: 'link-btn', onclick: () => copyText(`${location.origin}/@${S.me.username}`) }, icon('at'), 'Скопировать ссылку на профиль')),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try {
          S.me = (await api.patch('/me', { name: name.value, username: uname.input.value, bio: bio.value })).user;
          mergeUser(S.me);
          close();
          toast('Профиль сохранён');
          renderChatList();
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

const ACCENTS = [
  ['lime', 'Лайм'], ['blue', 'Синий'], ['violet', 'Фиолетовый'], ['orange', 'Апельсин'], ['pink', 'Розовый'], ['teal', 'Бирюза'],
];

function settingsModal() {
  const seg = h('div', { class: 'segmented' });
  const renderSeg = () => seg.replaceChildren(...[['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, l]) =>
    h('button', { class: S.settings.theme === v ? 'on' : '', onclick: () => { S.settings.theme = v; saveSettings(); renderSeg(); } }, l)));
  renderSeg();
  const swatches = h('div', { class: 'swatches' });
  const renderSw = () => swatches.replaceChildren(...ACCENTS.map(([v, l]) =>
    h('button', { class: `swatch sw-${v} ${S.settings.accent === v ? 'on' : ''}`, title: l, 'aria-label': l, onclick: () => { S.settings.accent = v; saveSettings(); renderSw(); } })));
  renderSw();
  const toggle = (label, sub, key, onChange) => {
    const sw = h('span', { class: `switch ${S.settings[key] ? 'on' : ''}` });
    return h('button', {
      class: 'setting-row',
      onclick: async () => {
        let v = !S.settings[key];
        if (onChange) v = await onChange(v);
        S.settings[key] = v;
        saveSettings();
        sw.classList.toggle('on', v);
      },
    }, h('div', {}, h('div', { class: 'row-main' }, label), h('div', { class: 'row-sub' }, sub)), sw);
  };
  openModal({
    title: 'Настройки',
    body: h('div', { class: 'settings' },
      h('div', { class: 'settings-label' }, 'Тема'), seg,
      h('div', { class: 'settings-label' }, 'Цвет акцента'), swatches,
      h('div', { class: 'settings-label' }, 'Чаты'),
      toggle('Отправка по Enter', 'Shift+Enter — новая строка', 'enterToSend'),
      toggle('Уведомления', 'Показывать, когда вкладка свёрнута', 'notify', async (v) => {
        if (!v) return false;
        if (!('Notification' in window)) { toast('Браузер не поддерживает уведомления', 'error'); return false; }
        const p = await Notification.requestPermission();
        if (p !== 'granted') toast('Разрешите уведомления в настройках браузера', 'error');
        return p === 'granted';
      })),
  });
}

async function sessionsModal() {
  let data;
  try { data = await api.get('/sessions'); } catch (e) { return toast(errorText(e), 'error'); }
  const list = h('div', { class: 'sessions' });
  const describe = (ua) => {
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
    const br = /Edg\//.test(ua) ? 'Edge' : /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /OPR\//.test(ua) ? 'Opera' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Браузер';
    return `${br}, ${os}`;
  };
  const render = () => list.replaceChildren(...data.sessions.map((s) => h('div', { class: 'session' },
    h('div', { class: 'session-ic' }, icon('devices')),
    h('div', { class: 'session-body' },
      h('div', { class: 'row-main' }, describe(s.userAgent), s.current ? h('span', { class: 'pill' }, 'это устройство') : null),
      h('div', { class: 'row-sub' }, `${s.ip || '—'} · ${s.current ? 'сейчас' : `${dayLabel(s.lastUsed)} ${timeHM(s.lastUsed)}`}`)),
    s.current ? null : h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
      try { await api.del(`/sessions/${s.id}`); data.sessions = data.sessions.filter((x) => x !== s); render(); } catch (e) { toast(errorText(e), 'error'); }
    } }, 'Завершить'))));
  render();
  openModal({
    title: 'Активные сеансы',
    body: h('div', {}, list),
    actions: data.sessions.length > 1 ? [{ label: 'Завершить все другие', danger: true, onClick: async (close) => {
      if (!(await confirmDialog('Выйти на всех других устройствах?', { ok: 'Завершить', danger: true }))) return;
      try { await api.del('/sessions'); close(); toast('Другие сеансы завершены'); } catch (e) { toast(errorText(e), 'error'); }
    } }] : [],
  });
}

/** Reusable user picker (search + checkable list + chips). */
function userPicker(excludeIds = new Set()) {
  const selected = new Map();
  const chips = h('div', { class: 'chips' });
  const results = h('div', { class: 'picker-results' });
  const input = h('input', { class: 'input', placeholder: 'Поиск по имени или @юзернейму', autocomplete: 'off' });
  const contacts = [...S.chats.values()].filter((c) => c.type === 'private').map(peerOf).filter((u) => u && !excludeIds.has(u.id));
  let shown = contacts;
  const renderChips = () => chips.replaceChildren(...[...selected.values()].map((u) => h('button', { class: 'chip', onclick: () => { selected.delete(u.id); renderChips(); renderResults(); } },
    avatar({ id: u.id, name: u.name, src: u.avatar }, 24), u.name, icon('close'))));
  const renderResults = () => results.replaceChildren(...(shown.length ? shown.map((u) => h('button', {
    class: `picker-item ${selected.has(u.id) ? 'on' : ''}`,
    onclick: () => { selected.has(u.id) ? selected.delete(u.id) : selected.set(u.id, u); renderChips(); renderResults(); },
  }, avatar({ id: u.id, name: u.name, src: u.avatar }, 40),
  h('div', { class: 'picker-text' }, h('div', { class: 'row-main' }, u.name), h('div', { class: 'row-sub' }, `@${u.username}`)),
  h('span', { class: 'checkbox' }, icon('check')))) : [h('div', { class: 'list-note' }, input.value ? 'Никого не нашли' : 'Найдите людей по @юзернейму')]));
  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!q) { shown = contacts; return renderResults(); }
    shown = contacts.filter((u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
    renderResults();
    if (q.length < 2) return;
    t = setTimeout(async () => {
      try {
        const { users } = await api.get(`/users/search?q=${encodeURIComponent(q)}`);
        const ids = new Set(shown.map((u) => u.id));
        shown = [...shown, ...users.filter((u) => !ids.has(u.id) && !excludeIds.has(u.id))];
        renderResults();
      } catch { /* ignore */ }
    }, 250);
  });
  renderResults();
  return { el: h('div', { class: 'picker' }, input, chips, results), selected, input };
}

function newGroupModal() {
  const title = h('input', { class: 'input', placeholder: 'Название группы', maxLength: 64 });
  const picker = userPicker(new Set([S.me.id]));
  openModal({
    title: 'Новая группа',
    body: h('div', { class: 'group-form' },
      h('div', { class: 'group-title-row' }, h('div', { class: 'group-ic' }, icon('group')), title),
      h('div', { class: 'settings-label' }, 'Участники'),
      picker.el),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать', primary: true, onClick: async (close) => {
        if (!title.value.trim()) { title.focus(); return toast('Укажите название группы', 'error'); }
        try {
          const { chat } = await api.post('/chats/group', { title: title.value, userIds: [...picker.selected.keys()] });
          upsertChat(chat);
          close();
          renderChatList();
          openChat(chat.id);
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
  setTimeout(() => title.focus(), 50);
}

async function groupInfoModal(c) {
  let data;
  try { data = await api.get(`/chats/${c.id}`); } catch (e) { return toast(errorText(e), 'error'); }
  data.members.forEach(mergeUser);
  const owner = data.chat.ownerId === S.me.id;
  const avWrap = h('div', { class: owner ? 'avatar-edit' : '' }, chatAvatar(data.chat, 110), owner ? h('span', { class: 'avatar-edit-overlay' }, icon('camera')) : null);
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  if (owner) {
    avWrap.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const fd = new FormData();
        fd.append('file', await prepareImage(f, 640, true), 'avatar');
        const { chat } = await api.post(`/chats/${c.id}/avatar`, fd);
        upsertChat(chat);
        avWrap.firstChild.replaceWith(chatAvatar(chat, 110));
        renderChatList(); renderHeader();
      } catch (e) { toast(errorText(e), 'error'); }
    });
  }
  const titleEl = h('div', { class: 'profile-name' }, data.chat.title);
  const members = h('div', { class: 'members' }, data.members.map((u) => h('div', { class: 'member' },
    h('button', { class: 'member-main', onclick: () => { closeTopModal(); openUserProfile(u.id); } },
      avatar({ id: u.id, name: u.name, src: u.avatar, online: u.online }, 42),
      h('div', {}, h('div', { class: 'row-main' }, u.name, u.role === 'owner' ? h('span', { class: 'pill' }, 'создатель') : null),
        h('div', { class: `row-sub ${u.online ? 'accent' : ''}` }, lastSeenText(u)))),
    owner && u.id !== S.me.id ? h('button', { class: 'icon-btn', 'aria-label': 'Удалить из группы', onclick: async () => {
      if (!(await confirmDialog(`Удалить ${u.name} из группы?`, { ok: 'Удалить', danger: true }))) return;
      try { await api.del(`/chats/${c.id}/members/${u.id}`); closeTopModal(); groupInfoModal(c); } catch (e) { toast(errorText(e), 'error'); }
    } }, icon('close')) : null)));
  openModal({
    title: 'Группа',
    className: 'modal-profile',
    body: h('div', { class: 'profile' },
      h('div', { class: 'profile-hero' }, avWrap, fileIn, titleEl,
        h('div', { class: 'profile-status' }, `${data.members.length} ${plural(data.members.length, 'участник', 'участника', 'участников')}`)),
      owner ? h('div', { class: 'profile-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => renameGroup(data.chat, titleEl) }, icon('edit'), 'Переименовать'),
        h('button', { class: 'btn btn-ghost', onclick: () => addMembersModal(data) }, icon('plus'), 'Добавить')) : null,
      h('div', { class: 'settings-label' }, 'Участники'),
      members,
      h('button', { class: 'btn btn-danger-ghost btn-block', onclick: () => leaveGroup(c) }, icon('leave'), 'Покинуть группу')),
  });
}

function renameGroup(chat, titleEl) {
  const input = h('input', { class: 'input', value: chat.title, maxLength: 64 });
  openModal({
    title: 'Название группы',
    className: 'modal-small',
    body: input,
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try {
          const r = await api.patch(`/chats/${chat.id}`, { title: input.value });
          upsertChat(r.chat);
          titleEl.textContent = r.chat.title;
          renderChatList(); renderHeader();
          close();
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
  setTimeout(() => input.select(), 50);
}

function addMembersModal(data) {
  const picker = userPicker(new Set(data.members.map((u) => u.id)));
  openModal({
    title: 'Добавить участников',
    body: picker.el,
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Добавить', primary: true, onClick: async (close) => {
        if (!picker.selected.size) return toast('Никто не выбран');
        try {
          await api.post(`/chats/${data.chat.id}/members`, { userIds: [...picker.selected.keys()] });
          close();
          closeTopModal();
          groupInfoModal(data.chat);
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

async function leaveGroup(c) {
  if (!(await confirmDialog(`Покинуть группу «${c.title}»?`, { ok: 'Покинуть', danger: true }))) return;
  try {
    await api.post(`/chats/${c.id}/leave`);
    while (closeTopModal()) { /* close all */ }
  } catch (e) { toast(errorText(e), 'error'); }
}

// ============================================================ keyboard

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.ctx-menu')) return closeMenu();
  if (closeTopModal()) return;
  const drawer = document.querySelector('.drawer-backdrop.show');
  if (drawer) return drawer.click();
  if (S.current && !isTouch()) closeChat();
});

boot();
