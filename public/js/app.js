import { io } from '/vendor/socket.io.esm.min.js';
import { api, errorText } from './api.js';
import {
  h, icon, avatar, timeHM, listTime, dayLabel, lastSeenText, plural, richText, emojiCount,
  toast, openModal, closeTopModal, confirmDialog, contextMenu, closeMenu, registerOverlay, handleBack, goBack, navigate, isTouch, badge, nameWithBadge, linkRisk, bytes,
} from './ui.js';
import { STICKER_PACKS, stickerInfo, GIFTS, giftById, DAILY_BONUS, REACTIONS, PLANS, planById, isDangerousFile, fileExt } from './catalog.js';
import { initCalls, startCall, inCall } from './calls.js';
import * as Sounds from './sounds.js';
import { EMOJI } from './emoji.js';
import { initStories, storiesChanged, storyViewEvent, setStripVisible, openComposer as newStory, openStoryById, storyQuote } from './stories.js';

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
const animKeys = new Map(); // message key -> { type: 'send' | 'in', t } — entry animation in progress
const ANIM_MS = 450;
/** Keep a running entry animation when the optimistic copy is swapped for the real message. */
function transferAnim(fromId, toId) {
  const a = animKeys.get(String(fromId));
  if (a) animKeys.set(String(toId), a);
}

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { /* ignore */ }
  return {
    theme: 'system', accent: 'lime', enterToSend: !isTouch(), notify: false,
    style: 'glass', wallpaper: 'auto', textSize: 15.5, reduceMotion: false,
    ringtone: 'lemon', messageSound: 'pop', volume: 0.8, vibrate: true, inAppSounds: true, ...s,
  };
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
  document.documentElement.dataset.style = S.settings.style;
  document.documentElement.dataset.wallpaper = S.settings.wallpaper;
  document.documentElement.dataset.motion = S.settings.reduceMotion ? 'reduced' : 'full';
  document.documentElement.style.setProperty('--msg-size', `${S.settings.textSize}px`);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = t === 'dark' ? '#17212b' : '#ffffff'; });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const app = document.getElementById('app');

// ============================================================ helpers

const isGroup = (c) => c?.type === 'group';
const isChannel = (c) => c?.type === 'channel';
const subsText = (n) => `${n} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`;
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
    return avatar({ id: p?.id, name: p?.name || '?', src: p?.avatar, online: p?.online, official: p?.official }, size);
  }
  return avatar({ id: c.id, name: c.title, src: c.avatar }, size);
}
function userAvatar(u, size, withOnline = false) {
  return avatar({ id: u?.id, name: u?.name || '?', src: u?.avatar, online: withOnline && u?.online, official: u?.official }, size);
}
/** Chat title with the verified badge for private chats. */
function chatTitleNodes(c) {
  return c.type === 'private' ? nameWithBadge(chatTitle(c), peerOf(c)) : nameWithBadge(chatTitle(c), c);
}
/** Is the chat/peer verified (for the badge next to the title)? */
const chatVerified = (c) => (c.type === 'private' ? !!peerOf(c)?.verified : !!c.verified);
function chatTitle(c) {
  if (c.type === 'private') return peerOf(c)?.name || c.title;
  return c.title;
}
const NAME_COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
const nameColor = (id) => NAME_COLORS[Math.abs(id) % NAME_COLORS.length];

const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function messagePreview(m) {
  if (!m) return '';
  if (m.kind === 'image') return m.text ? `🖼 ${m.text}` : '🖼 Фото';
  if (m.kind === 'sticker') return `${stickerInfo(m.text)?.emoji || '🍋'} Стикер`;
  if (m.kind === 'gift') return `🎁 Подарок: ${giftById(m.extra?.giftId)?.name || ''}`;
  if (m.kind === 'file') return `📎 ${m.extra?.name || 'Файл'}`;
  if (m.kind === 'call') return callText(m);
  if (m.kind === 'voice') return `🎤 Голосовое ${fmtDur(m.extra?.duration || 0)}`;
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
  for (const c of S.chats.values()) if (!c.muted && !c.preview) n += c.unread;
  return n;
}
function updateBadge() {
  const n = totalUnread();
  document.title = n ? `(${n}) Limoninior` : 'Limoninior';
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ============================================================ boot

// ?ref=<username> from an invite link: remember it until the new account is ready.
const REF_KEY = 'limoninior.ref';
(function captureRef() {
  try {
    const u = new URL(location.href);
    const ref = u.searchParams.get('ref');
    if (ref && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(ref)) localStorage.setItem(REF_KEY, ref);
    if (ref !== null) { u.searchParams.delete('ref'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
  } catch { /* ignore */ }
})();
const storedRef = () => { try { return localStorage.getItem(REF_KEY); } catch { return null; } };

async function claimReferral() {
  const ref = storedRef();
  if (!ref || !S.me || S.me.needsProfile) return;
  try {
    const r = await api.post('/me/referral', { ref });
    S.me = r.user;
    localStorage.removeItem(REF_KEY);
    openModal({
      className: 'modal-small',
      body: h('div', { class: 'ref-welcome' }, h('div', { class: 'ref-gift' }, '🎁'),
        h('h2', {}, 'Подарок за приглашение!'),
        h('p', {}, `Вас пригласил @${r.inviter}. Вам начислена подписка Plus на месяц — бонусы ×2 и файлы до 50 МБ.`)),
      actions: [{ label: 'Круто!', primary: true, onClick: (c) => c() }],
    });
  } catch (e) {
    if (!e.status) return; // offline: try next time
    try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ }
    if (e.code !== 'ref_used' && e.code !== 'ref_too_late') toast(errorText(e), 'error');
  }
}

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
  let mode = 'login';
  const nameIn = h('input', { class: 'input', placeholder: 'Как вас зовут', maxLength: 64, autocomplete: 'name' });
  const userIn = h('input', { class: 'input', placeholder: 'username', maxLength: 32, autocapitalize: 'off', autocomplete: 'username', spellcheck: false });
  const passIn = h('input', { class: 'input', type: 'password', placeholder: 'Пароль', maxLength: 128, autocomplete: 'current-password' });
  const eye = h('button', { type: 'button', class: 'pass-eye', 'aria-label': 'Показать пароль', onclick: () => { passIn.type = passIn.type === 'password' ? 'text' : 'password'; } }, icon('eye'));
  const userHint = h('div', { class: 'field-hint' });
  const nameField = h('label', { class: 'field hidden' }, nameIn);
  const submit = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Войти');
  const seg = h('div', { class: 'segmented login-tabs' });
  const setMode = (m) => {
    mode = m;
    seg.replaceChildren(
      h('button', { type: 'button', class: m === 'login' ? 'on' : '', onclick: () => setMode('login') }, 'Вход'),
      h('button', { type: 'button', class: m === 'register' ? 'on' : '', onclick: () => setMode('register') }, 'Регистрация'));
    nameField.classList.toggle('hidden', m === 'login');
    submit.textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
    passIn.placeholder = m === 'login' ? 'Пароль' : 'Пароль (минимум 8 символов)';
    passIn.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    userHint.textContent = m === 'register' ? 'Латиница, цифры и _, от 5 символов — по нему вас найдут' : '';
    userHint.className = 'field-hint';
  };
  let checkTimer = null;
  userIn.addEventListener('input', () => {
    userIn.value = userIn.value.replace(/[^a-zA-Z0-9_]/g, '');
    if (mode !== 'register') return;
    clearTimeout(checkTimer);
    const v = userIn.value;
    userHint.className = 'field-hint';
    if (v.length < 5 || !/^[a-zA-Z]/.test(v)) { userHint.textContent = 'Латиница, цифры и _, от 5 символов, начинается с буквы'; return; }
    checkTimer = setTimeout(async () => {
      try {
        const r = await api.get(`/username-check?u=${encodeURIComponent(v)}`);
        if (userIn.value !== v) return;
        userHint.textContent = r.ok ? `@${v} свободен` : 'Этот юзернейм занят';
        userHint.classList.add(r.ok ? 'good' : 'bad');
      } catch { /* ignore */ }
    }, 350);
  });
  const form = h('form', {
    class: 'login-form',
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const body = { username: userIn.value, password: passIn.value };
        if (mode === 'register') body.name = nameIn.value;
        S.me = (await api.post(mode === 'login' ? '/auth/login' : '/auth/register', body)).user;
        S.me.needsProfile ? renderOnboarding() : startApp();
      } catch (err) {
        toast(errorText(err), 'error');
      } finally {
        submit.disabled = false;
      }
    },
  }, seg, nameField,
  h('label', { class: 'field' }, h('div', { class: 'input-prefix' }, h('span', {}, '@'), userIn), userHint),
  h('label', { class: 'field pass-field' }, passIn, eye),
  submit);
  setMode('login');

  const card = h('div', { class: 'login-card' },
    h('img', { class: 'login-logo', src: '/icons/icon.svg', alt: '', width: 96, height: 96 }),
    h('h1', {}, 'Limoninior'),
    h('p', { class: 'login-sub' }, 'Быстрый, красивый и безопасный мессенджер'),
    form,
    S.config.googleClientId ? h('div', { class: 'or' }, h('span', {}, 'или')) : null,
    gbtn,
  );
  const ref = storedRef();
  if (ref) {
    api.get(`/ref/${encodeURIComponent(ref)}`).then(({ user }) => {
      card.insertBefore(h('div', { class: 'ref-banner' }, avatar(user, 40),
        h('div', {}, h('b', {}, `${user.name} приглашает вас`), h('span', {}, '🎁 Зарегистрируйтесь — и получите Plus на месяц в подарок')),
      ), card.querySelector('form') || card.firstChild.nextSibling);
      setMode('register');
    }).catch(() => {});
  }
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
  card.append(h('p', { class: 'login-foot' }, 'Пароли хранятся только в зашифрованном виде. ', h('a', { href: '/privacy' }, 'Конфиденциальность')));
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }), h('div', { class: 'blob b3' }), card));

  if (!S.config.googleClientId) return;
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
  navigate('/');
}

// ============================================================ main layout

function startApp() {
  mergeUser(S.me);
  setTimeout(claimReferral, 1200);
  buildLayout();
  connectSocket();
  loadChats().then(handleDeepLink);
  maybeOfferPush();
  setInterval(() => { if (S.current) renderHeaderStatus(); }, 30_000);
  setInterval(refreshChannelStats, 20_000);
  history.replaceState({ root: true }, '', /^\/(@|join\/)/.test(location.pathname) ? location.pathname : '/');
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
    initStories({ me: () => S.me, prepareImage }),
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
  contextMenu(r.left - 170, r.top - 200, [
    { icon: 'group', label: 'Новая группа', onClick: newGroupModal },
    { icon: 'megaphone', label: 'Новый канал', onClick: newChannelModal },
    { icon: 'search', label: 'Популярные каналы', onClick: popularChannelsModal },
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
  const inv = location.pathname.match(/^\/join\/([A-Za-z0-9_-]{8,32})$/);
  const m = location.pathname.match(/^\/@([A-Za-z][A-Za-z0-9_]{4,31})$/);
  history.replaceState({ root: true }, '', '/');
  if (inv) return openInvite(inv[1]);
  if (!m) return;
  try {
    if (m[1].toLowerCase() === S.me.username.toLowerCase()) return openSaved();
    const r = await api.get(`/resolve/${encodeURIComponent(m[1])}`);
    if (r.type === 'user') startPrivate(r.user.id);
    else openChannel(r.channel);
  } catch { toast('Ничего не найдено по этой ссылке'); }
}

// ============================================================ socket

function connectSocket() {
  const s = io({ transports: ['websocket', 'polling'], withCredentials: true });
  S.socket = s;
  let wasConnected = false;
  s.on('connect', () => {
    S.connected = true;
    V.conn.classList.add('hidden');
    if (wasConnected) { checkVersion(); resync(); }
    wasConnected = true;
  });
  s.on('me', (u) => {
    S.me = { ...S.me, ...u };
    mergeUser(u);
    renderChatList();
    if (S.current) renderHeader();
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
    if (message.senderId && message.senderId !== S.me.id) {
      notify(chat, message);
      const viewing = message.chatId === S.current && !document.hidden;
      if (!chat?.muted && !viewing && message.kind !== 'call') Sounds.playMessageSound();
    }
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
    if (c.id === S.current) { renderHeader(); renderComposerMode(); renderPinBar(); }
  });
  s.on('message:reactions', applyReactions);
  s.on('stories', storiesChanged);
  s.on('story:view', storyViewEvent);
  s.on('comment', onCommentEvent);
  s.on('comment:delete', onCommentEvent);
  initCalls({ socket: s, userById: (id) => S.users.get(id) });
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

/** After a server update the socket reconnects — reload to pick up the new client. */
async function checkVersion() {
  try {
    const cfg = await api.get('/config');
    if (cfg.version === S.config.version) return;
    const busy = (V.input && V.input.value.trim()) || document.querySelector('.modal-backdrop');
    if (!busy) return location.reload();
    toast('Вышло обновление — оно применится после перезагрузки страницы');
  } catch { /* offline */ }
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
  if (chat.muted) return;
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const title = isGroup(chat) || isChannel(chat) ? chat.title : userName(m.senderId);
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
  setStripVisible(true);
  const chats = [...S.chats.values()].filter((c) => !c.preview).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0) || (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0) || b.id - a.id);
  if (!chats.length) {
    V.list.replaceChildren(h('div', { class: 'list-empty' },
      h('div', { class: 'list-empty-emoji' }, '👋'),
      h('div', { class: 'list-empty-title' }, 'Пока нет чатов'),
      h('div', {}, 'Найдите друга по @юзернейму, создайте группу или подпишитесь на каналы.'),
      h('button', { class: 'btn btn-primary', onclick: () => V.search.focus() }, 'Найти людей'),
      h('button', { class: 'btn', onclick: popularChannelsModal }, icon('megaphone'), 'Популярные каналы')));
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
    const who = isChannel(c) ? null : lm.senderId === S.me.id && c.type !== 'saved' ? 'Вы' : isGroup(c) ? userName(lm.senderId).split(' ')[0] : null;
    preview = [who ? h('span', { class: 'preview-who' }, `${who}: `) : null, messagePreview(lm)];
  }
  const mine = lm && lm.senderId === S.me.id && c.type !== 'saved' && !isChannel(c);
  const read = mine && lm.id <= c.peerReadId;
  return h('button', {
    class: `chat-item ${c.id === S.current ? 'active' : ''}`,
    onclick: () => openChat(c.id),
    oncontextmenu: (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { icon: 'info', label: 'Информация', onClick: () => openInfo(c) },
        { icon: c.pinnedAt ? 'unpin' : 'pin', label: c.pinnedAt ? 'Открепить' : 'Закрепить', onClick: () => togglePinChat(c) },
        c.type !== 'saved' ? { icon: 'bell', label: c.muted ? 'Включить уведомления' : 'Выключить уведомления', onClick: () => toggleMute(c) } : null,
        isGroup(c) ? { icon: 'leave', label: 'Покинуть группу', danger: true, onClick: () => leaveGroup(c) } : null,
        isChannel(c) && c.role !== 'owner' ? { icon: 'leave', label: 'Отписаться', danger: true, onClick: () => leaveChannel(c) } : null,
      ]);
    },
  },
  chatAvatar(c, 54),
  h('div', { class: 'chat-item-body' },
    h('div', { class: 'chat-item-top' },
      h('span', { class: 'chat-item-title' }, isGroup(c) ? icon('group', 'title-ic') : isChannel(c) ? icon('megaphone', 'title-ic') : null,
        h('span', { class: 'ellipsis' }, chatTitle(c)), chatVerified(c) ? badge() : null, c.muted ? icon('mute', 'mute-ic') : null),
      h('span', { class: 'chat-item-time' }, mine ? icon(read ? 'checks' : 'check', 'tick') : null, lm ? listTime(lm.createdAt) : '')),
    h('div', { class: 'chat-item-bottom' },
      h('span', { class: 'chat-item-preview' }, preview),
      c.unread ? h('span', { class: `badge ${c.muted ? 'muted-badge' : ''}` }, c.unread > 999 ? '999+' : c.unread)
        : c.pinnedAt ? icon('pin', 'pin-ic') : null)));
}

async function togglePinChat(c) {
  try {
    const { chat } = await api.post(`/chats/${c.id}/pin-chat`, { pinned: !c.pinnedAt });
    upsertChat(chat);
    renderChatList();
    toast(chat.pinnedAt ? 'Чат закреплён 📌' : 'Чат откреплён');
  } catch (e) { toast(errorText(e), 'error'); }
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
      const { users, channels } = await api.get(`/search?q=${encodeURIComponent(q)}`);
      if (q !== S.searchQuery) return;
      users.forEach(mergeUser);
      S.searchResults = users;
      S.searchChannels = channels;
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
  setStripVisible(false);
  const q = S.searchQuery.replace(/^@/, '').toLowerCase();
  const local = [...S.chats.values()].filter((c) => !c.preview && (chatTitle(c).toLowerCase().includes(q)
    || peerOf(c)?.username?.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q)));
  const localPeerIds = new Set(local.map((c) => peerOf(c)?.id).filter(Boolean));
  const localChatIds = new Set(local.map((c) => c.id));
  const global = (S.searchResults || []).filter((u) => !localPeerIds.has(u.id));
  const channels = (S.searchChannels || []).filter((c) => !localChatIds.has(c.id));
  const nodes = [];
  if (local.length) nodes.push(h('div', { class: 'list-section' }, 'Чаты'), ...local.map(chatItem));
  if (channels.length) nodes.push(h('div', { class: 'list-section' }, 'Каналы'), ...channels.map((ch) => channelCard(ch)));
  nodes.push(h('div', { class: 'list-section' }, 'Люди'));
  if (S.searchResults === null && q.length >= 2) nodes.push(h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
  else if (q.length < 2) nodes.push(h('div', { class: 'list-note' }, 'Введите минимум 2 символа'));
  else if (!global.length) nodes.push(h('div', { class: 'list-note' }, 'Никого не нашли 🤷'));
  for (const u of global) {
    nodes.push(h('button', { class: 'chat-item', onclick: () => { clearSearch(); startPrivate(u.id); } },
      userAvatar(u, 54, true),
      h('div', { class: 'chat-item-body' },
        h('div', { class: 'chat-item-top' }, h('span', { class: 'chat-item-title' }, h('span', { class: 'ellipsis' }, u.name), u.verified ? badge() : null)),
        h('div', { class: 'chat-item-bottom' }, h('span', { class: 'chat-item-preview accent' }, `@${u.username}`)))));
  }
  V.list.replaceChildren(...nodes);
}

/** Search/catalog row for a public channel. */
function channelCard(ch, after) {
  return h('button', { class: 'chat-item', onclick: () => { clearSearch(); if (typeof after === 'function') after(); openChannel(ch); } },
    avatar({ id: ch.id, name: ch.title, src: ch.avatar }, 54),
    h('div', { class: 'chat-item-body' },
      h('div', { class: 'chat-item-top' }, h('span', { class: 'chat-item-title' }, icon('megaphone', 'title-ic'),
        h('span', { class: 'ellipsis' }, ch.title), ch.verified ? badge() : null)),
      h('div', { class: 'chat-item-bottom' }, h('span', { class: 'chat-item-preview' },
        h('span', { class: 'accent' }, `@${ch.username}`), ` · ${subsText(ch.membersCount)}`))));
}

async function popularChannelsModal() {
  const list = h('div', { class: 'channel-catalog' }, h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
  const m = openModal({ title: 'Популярные каналы', body: h('div', {}, list,
    h('button', { class: 'btn btn-primary btn-block', onclick: () => { m.close(); newChannelModal(); } }, icon('plus'), 'Создать свой канал')) });
  try {
    const { channels } = await api.get('/channels/popular');
    list.replaceChildren(...(channels.length ? channels.map((ch) => channelCard(ch, () => m.close()))
      : [h('div', { class: 'list-note' }, 'Каналов пока нет — создайте первый!')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
}

/** Open a channel: as a regular chat if subscribed, otherwise as a read-only preview. */
async function openChannel(ch) {
  const known = S.chats.get(ch.id);
  if (known && !known.preview) return openChat(ch.id);
  try {
    const r = await api.get(`/channels/${ch.id}`);
    if (r.chat) { upsertChat(r.chat); renderChatList(); return openChat(r.chat.id); }
    S.chats.set(ch.id, { ...r.channel, preview: true, canPost: false, unread: 0, lastReadId: 0, peerReadId: 0, lastMessage: null });
    S.msgs.delete(ch.id);
    openChat(ch.id);
  } catch (e) { toast(errorText(e), 'error'); }
}

async function joinChannel(c) {
  try {
    const { chat } = await api.post(`/channels/${c.id}/join`);
    S.msgs.delete(c.id);
    upsertChat(chat);
    renderChatList();
    openChat(chat.id, { fromHistory: true });
    toast(`Вы подписались на «${chat.title}» 🎉`);
    setTimeout(refreshChannelStats, 1500);
  } catch (e) { toast(errorText(e), 'error'); }
}

async function leaveChannel(c) {
  if (!(await confirmDialog(`Отписаться от канала «${c.title}»?`, { ok: 'Отписаться', danger: true }))) return;
  try {
    await api.post(`/channels/${c.id}/leave`);
    while (closeTopModal()) { /* close all */ }
  } catch (e) { toast(errorText(e), 'error'); }
}

async function toggleMute(c) {
  try {
    const { chat } = await api.post(`/chats/${c.id}/mute`, { muted: !c.muted });
    upsertChat(chat);
    renderChatList();
    updateBadge();
    if (S.current === c.id) renderComposerMode();
    toast(chat.muted ? 'Уведомления выключены 🔕' : 'Уведомления включены 🔔');
  } catch (e) { toast(errorText(e), 'error'); }
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
  cancelRecording();
  closeChatSearch();
  if (V.panel && panelRelease) togglePanel(false);
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
  if (!isTouch() && c.canPost !== false) V.input.focus();
}

/** Channels: refresh view counters and reactions of the visible page now and then. */
async function refreshChannelStats() {
  const c = curChat();
  const st = S.msgs.get(S.current);
  if (!isChannel(c) || !st?.loaded || document.hidden) return;
  try {
    const { messages } = await api.get(messagesUrl(c));
    const fresh = new Map(messages.map((m) => [m.id, m]));
    let changed = false;
    for (const m of st.items) {
      const f = fresh.get(m.id);
      if (!f) continue;
      if (f.views !== m.views || JSON.stringify(f.reactions) !== JSON.stringify(m.reactions)) {
        m.views = f.views; m.reactions = f.reactions; m.myReaction = f.myReaction;
        changed = true;
      }
    }
    if (changed && S.current === c.id) renderMessages();
  } catch { /* offline */ }
}

const messagesUrl = (c) => (c?.preview ? `/channels/${c.id}/messages` : `/chats/${c.id}/messages`);

/** Composer for writers; subscribe / mute bar for channel readers. */
function renderComposerMode() {
  const c = curChat();
  if (!c || !V.composerRow) return;
  const blocked = c.type === 'private' && c.blocked;
  const reader = (isChannel(c) && !c.canPost) || !!blocked;
  V.composerRow.classList.toggle('hidden', reader);
  V.channelBar.classList.toggle('hidden', !reader);
  V.input.placeholder = isChannel(c) ? 'Опубликовать пост…' : 'Сообщение';
  if (!reader) return;
  if (blocked) {
    V.panel.classList.add('hidden');
    V.channelBar.replaceChildren(blocked === 'me'
      ? h('button', { class: 'channel-bar-btn', onclick: () => setBlocked(peerOf(c), false) }, icon('block'), 'Разблокировать')
      : h('div', { class: 'channel-bar-note' }, icon('block'), 'Пользователь ограничил сообщения'));
    return;
  }
  V.channelBar.replaceChildren(c.preview
    ? h('button', { class: 'channel-bar-btn primary', onclick: () => joinChannel(c) }, icon('plus'), 'Подписаться')
    : h('button', { class: 'channel-bar-btn', onclick: () => toggleMute(c) }, icon(c.muted ? 'bell' : 'mute'), c.muted ? 'Включить уведомления' : 'Выключить уведомления'));
}

function closeChat({ fromHistory = false } = {}) {
  if (!S.current) return;
  cancelRecording();
  closeChatSearch();
  if (V.panel && panelRelease) togglePanel(false);
  if (V.input) S.drafts.set(S.current, V.input.value);
  S.current = null;
  V.layout.classList.remove('chat-open');
  renderChatList();
  setTimeout(() => { if (!S.current) V.pane.replaceChildren(emptyPane()); }, 260);
  if (!fromHistory && history.state?.chat) goBack();
}

window.addEventListener('popstate', (e) => {
  // Back closes the top overlay (story, window, menu, drawer) first.
  if (handleBack()) return;
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
    V.callBtns = h('div', { class: 'header-calls' }),
    h('button', { class: 'icon-btn', 'aria-label': 'Поиск по чату', title: 'Поиск по чату', onclick: openChatSearch }, icon('search')),
    h('button', { class: 'icon-btn', 'aria-label': 'Ещё', onclick: (e) => chatMoreMenu(e.currentTarget) }, icon('more')),
    V.pinBar = h('div', { class: 'pin-bar hidden' }),
    V.searchBar = h('div', { class: 'chat-search hidden' }));
  const cc = c;
  if (c.type === 'private' && !peerOf(c)?.official) {
    V.callBtns.append(
      h('button', { class: 'icon-btn', 'aria-label': 'Позвонить', title: 'Голосовой звонок', onclick: () => startCall(cc, peerOf(cc), false) }, icon('phone')),
      h('button', { class: 'icon-btn', 'aria-label': 'Видеозвонок', title: 'Видеозвонок', onclick: () => startCall(cc, peerOf(cc), true) }, icon('video')));
  }

  V.msgInner = h('div', { class: 'messages-inner' });
  V.scroller = h('div', { class: 'messages' }, V.msgInner);
  V.scroller.addEventListener('scroll', onScroll, { passive: true });
  wasAtBottom = true;
  // Keyboard / composer growth shrinks the list: stay pinned to the newest message.
  if (window.ResizeObserver) new ResizeObserver(() => { if (wasAtBottom && V.scroller) V.scroller.scrollTop = V.scroller.scrollHeight; }).observe(V.scroller);
  V.downBadge = h('span', { class: 'badge hidden' });
  V.downBtn = h('button', { class: 'scroll-down hidden', 'aria-label': 'Вниз', onclick: () => scrollToBottom(true) }, icon('down'), V.downBadge);

  V.bar = h('div', { class: 'composer-bar hidden' });
  V.input = h('textarea', { class: 'composer-input', rows: 1, placeholder: 'Сообщение', maxLength: 4096, enterkeyhint: S.settings.enterToSend ? 'send' : 'enter' });
  V.input.value = S.drafts.get(c.id) || '';
  V.input.addEventListener('input', onComposerInput);
  V.input.addEventListener('keydown', onComposerKey);
  V.input.addEventListener('paste', onPaste);
  V.file = h('input', { type: 'file', class: 'hidden', onchange: (e) => { const f = e.target.files[0]; if (f) pickFile(f); e.target.value = ''; } });
  V.sendBtn = h('button', { class: 'send-btn', 'aria-label': 'Отправить', onclick: submitComposer }, icon('send'));
  for (const ev of ['pointerdown', 'mousedown']) V.sendBtn.addEventListener(ev, (e) => { if (document.activeElement === V.input) e.preventDefault(); });
  V.input.addEventListener('focus', () => { if (isTouch() && !V.panel.classList.contains('hidden')) togglePanel(false); keepBottom(); });
  V.panel = h('div', { class: 'emoji-panel hidden' });
  V.panelBtn = h('button', { class: 'icon-btn smile-btn', 'aria-label': 'Эмодзи, стикеры и подарки', onclick: () => togglePanel() }, icon('smile'));
  const composer = h('div', { class: 'composer' },
    V.panel,
    V.bar,
    V.composerRow = h('div', { class: 'composer-row' },
      h('div', { class: 'composer-box' },
        h('button', { class: 'icon-btn attach-btn', 'aria-label': 'Прикрепить фото или файл', onclick: () => V.file.click() }, icon('attach')),
        V.input, V.panelBtn, V.file),
      V.sendBtn),
    V.channelBar = h('div', { class: 'channel-bar hidden' }));

  const view = h('div', { class: 'chat-view' }, header, h('div', { class: 'messages-wrap' }, V.scroller, V.downBtn), composer);
  view.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); view.classList.add('drag'); } });
  view.addEventListener('dragleave', (e) => { if (e.target === view || !view.contains(e.relatedTarget)) view.classList.remove('drag'); });
  view.addEventListener('drop', (e) => {
    view.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) { e.preventDefault(); pickFile(f); }
  });
  V.pane.replaceChildren(view);
  V.view = view;
  renderHeader();
  renderComposerMode();
  renderPinBar();
  autosize();
  updateSendBtn();
}

function renderHeader() {
  const c = curChat();
  if (!c || !V.headerTitle) return;
  V.headerAvatar.replaceChildren(chatAvatar(c, 42));
  V.headerTitle.replaceChildren(...[h('span', { class: 'ellipsis' }, chatTitle(c)), chatVerified(c) ? badge() : null].filter(Boolean));
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
  } else if (isChannel(c)) {
    V.headerStatus.textContent = `${c.preview ? 'канал · ' : ''}${subsText(c.membersCount)}`;
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
    const r = await api.get(messagesUrl(S.chats.get(id)));
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
    const r = await api.get(`${messagesUrl(S.chats.get(id))}?before=${first.id}`);
    const known = new Set(st.items.map((m) => m.id));
    st.items = [...r.messages.filter((m) => !known.has(m.id)), ...st.items];
    st.hasMore = r.hasMore;
    if (S.current === id) renderMessages({ keepOffset: true });
  } catch { /* ignore */ } finally {
    st.loading = false;
  }
}

function addMessage(m, anim = true) {
  const st = S.msgs.get(m.chatId);
  if (!st?.loaded) return;
  if (st.items.some((x) => x.id === m.id)) return;
  if (m.senderId === S.me.id) {
    // Replace our own optimistic copy if the socket beat the HTTP response (it already animated).
    const i = st.items.findIndex((x) => x.pending && x.kind === m.kind && x.text === m.text);
    if (i >= 0) { transferAnim(st.items[i].id, m.id); st.items.splice(i, 1); anim = false; }
  }
  if (anim && m.chatId === S.current && m.kind !== 'system') animKeys.set(String(m.id), { type: m.senderId === S.me.id ? 'send' : 'in', t: performance.now() });
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
  const used = new Set();
  // Static nodes (separators, system lines) are cached too, so a re-render only touches what changed.
  const staticNode = (key, sig, make) => {
    used.add(key);
    let e = nodeCache.get(key);
    if (!e || e.sig !== sig) nodeCache.set(key, (e = { sig, el: make() }));
    nodes.push(e.el);
  };
  if (!st.hasMore && st.items.length) staticNode('start', '', () => h('div', { class: 'chat-start' }));
  if (!st.items.length) staticNode('empty', c.id, () => emptyChatHint(c));
  let animated = false;
  st.items.forEach((m, i) => {
    const prev = st.items[i - 1];
    const next = st.items[i + 1];
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    if (newDay) { const lbl = dayLabel(m.createdAt); staticNode(`d:${dayKey(m.createdAt)}`, lbl, () => h('div', { class: 'date-sep' }, h('span', {}, lbl))); }
    if (m.kind === 'system') {
      staticNode(`s:${m.id}`, m.text, () => h('div', { class: 'system-msg' }, h('span', {}, m.text)));
      return;
    }
    const first = newDay || prev.kind === 'system' || prev.senderId !== m.senderId || m.createdAt - prev.createdAt > GAP;
    const last = !next || next.kind === 'system' || next.senderId !== m.senderId || next.createdAt - m.createdAt > GAP
      || dayKey(next.createdAt) !== dayKey(m.createdAt);
    const key = String(m.id);
    used.add(key);
    const sender = S.users.get(m.senderId);
    const read = m.senderId === S.me.id && typeof m.id === 'number' && m.id <= c.peerReadId;
    const sig = [m.editedAt, m.text, first, last, read, m.pending, m.views, m.comments, m.myReaction, JSON.stringify(m.reactions || []), sender?.name, sender?.avatar,
      m.replyTo?.id, m.replyTo && userName(m.replyTo.senderId)].join('|');
    let cached = nodeCache.get(key);
    if (!cached || cached.sig !== sig) {
      if (!cached && m.pending && !animKeys.has(key)) animKeys.set(key, { type: 'send', t: performance.now() });
      cached = { sig, el: messageEl(c, m, first, last, read) };
      nodeCache.set(key, cached);
      const anim = animKeys.get(key);
      const elapsed = anim ? performance.now() - anim.t : Infinity;
      if (elapsed < ANIM_MS) {
        // Rebuilt mid-animation (e.g. sent ✓ arrived): continue from where it was.
        cached.el.classList.add(anim.type === 'send' ? 'anim-send' : 'anim-in');
        cached.el.style.setProperty('--anim-delay', `${-Math.round(elapsed)}ms`);
        if (elapsed < 30) animated = true;
      }
    }
    nodes.push(cached.el);
  });
  for (const k of nodeCache.keys()) if (!used.has(k)) nodeCache.delete(k);
  const tNow = performance.now();
  for (const [k, a] of animKeys) if (tNow - a.t > ANIM_MS) animKeys.delete(k);
  if (!document.hidden) reportViews(c, st.items);
  const prevH = animated && atBottom ? V.msgInner.offsetHeight : 0;
  syncChildren(V.msgInner, nodes);

  if (atBottom) scrollToBottom();
  if (prevH) slideList(V.msgInner.offsetHeight - prevH);
  else if (keepOffset) V.scroller.scrollTop = V.scroller.scrollHeight - fromBottom;
  updateDownBtn();
}

/** Put `nodes` into `parent` in order, moving only what differs (no full re-insert). */
function syncChildren(parent, nodes) {
  let cur = parent.firstChild;
  for (const n of nodes) {
    if (cur === n) { cur = cur.nextSibling; continue; }
    parent.insertBefore(n, cur);
  }
  while (cur) { const nx = cur.nextSibling; cur.remove(); cur = nx; }
}

/** Telegram-style: the list glides up by the height of the new message instead of jumping. */
function slideList(dy) {
  const el = V.msgInner;
  if (!el || dy <= 0 || dy > 600 || document.documentElement.dataset.motion === 'reduced') return;
  el.getAnimations?.().forEach((a) => a.cancel());
  el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)' });
}

const reportedViews = new Set();
const pendingViews = new Map(); // chatId -> Set(messageId)
let viewsTimer = null;
/** Report channel posts on screen as viewed (each once per session; the server dedupes per user). */
function reportViews(c, items) {
  if (!isChannel(c)) return;
  const ids = items.filter((m) => typeof m.id === 'number' && m.kind !== 'system' && !reportedViews.has(m.id)).map((m) => m.id);
  if (!ids.length) return;
  let set = pendingViews.get(c.id);
  if (!set) pendingViews.set(c.id, (set = new Set()));
  ids.forEach((id) => { reportedViews.add(id); set.add(id); });
  clearTimeout(viewsTimer);
  viewsTimer = setTimeout(() => {
    for (const [chatId, pending] of pendingViews) {
      const all = [...pending];
      for (let i = 0; i < all.length; i += 100) api.post(`/channels/${chatId}/views`, { ids: all.slice(i, i + 100) }).catch(() => {});
    }
    pendingViews.clear();
    setTimeout(refreshChannelStats, 800);
  }, 600);
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

const fmtCount = (n) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`);

function messageEl(c, m, first, last, read) {
  const channel = isChannel(c);
  const mine = m.senderId === S.me.id && !channel;
  const group = isGroup(c);
  const emoji = m.kind === 'text' && !m.replyTo && !m.extra?.story && !m.extra?.fwd ? emojiCount(m.text) : 0;
  const bigEmoji = emoji > 0 && emoji <= 3;
  const imageOnly = m.kind === 'image' && !m.text;

  const meta = h('span', { class: 'meta' },
    channel && typeof m.id === 'number' ? h('span', { class: 'views' }, icon('eyeSmall'), fmtCount(m.views || 0)) : null,
    m.editedAt ? h('span', { class: 'edited' }, 'изм.') : null,
    timeHM(m.createdAt),
    mine && m.pending ? h('span', { class: 'clock' }) : null,
    mine && !m.pending && c.type !== 'saved' ? icon(read ? 'checks' : 'check', `tick ${read ? 'read' : ''}`) : null);

  const special = m.kind === 'sticker' ? 'sticker' : m.kind === 'gift' ? 'gift-bubble' : '';
  const bubble = h('div', { class: `bubble ${bigEmoji ? 'big-emoji' : ''} ${imageOnly ? 'image-only' : ''} ${m.kind === 'image' ? 'has-image' : ''} ${special}` });
  if (group && !mine && first && !bigEmoji && m.kind !== 'sticker') {
    bubble.append(h('div', { class: 'sender-name', style: { color: nameColor(m.senderId) } }, userName(m.senderId), S.users.get(m.senderId)?.verified ? badge() : null));
    ensureUser(m.senderId);
  }
  if (m.extra?.fwd) {
    const f = m.extra.fwd;
    bubble.append(h('button', { class: 'fwd-from', onclick: (e) => { e.stopPropagation(); if (f.userId) openUserProfile(f.userId); else if (f.chatId) openChannel({ id: f.chatId }); } },
      icon('forward'), h('span', {}, 'Переслано от '), h('b', {}, f.channel ? f.title : f.name)));
  }
  if (m.extra?.story) {
    const x = m.extra.story;
    bubble.append(storyQuote(x, () => openStoryById(x.userId, x.id)));
  }
  if (m.replyTo) {
    const r = m.replyTo;
    bubble.append(h('button', { class: 'reply-quote', onclick: (e) => { e.stopPropagation(); jumpTo(r.id); } },
      h('b', {}, r.deleted ? 'Удалённое сообщение' : userName(r.senderId)),
      h('span', {}, r.deleted ? '' : r.kind === 'image' ? `🖼 ${r.text || 'Фото'}` : r.kind === 'sticker' ? 'Стикер' : r.kind === 'gift' ? '🎁 Подарок' : r.text)));
  }
  if (m.kind === 'sticker') {
    bubble.append(stickerNode(m.text, 'msg-sticker'), meta);
    return finishRow(c, m, bubble, { mine, group, first, last });
  }
  if (m.kind === 'file') {
    const x = m.extra || {};
    const danger = x.danger || isDangerousFile(x.name || '');
    bubble.classList.add('file-bubble');
    bubble.append(h('button', { class: `file-card ${danger ? 'danger' : ''}`, onclick: () => downloadFile(m) },
      h('div', { class: 'file-ic' }, icon(danger ? 'warning' : 'file'), h('span', {}, (x.ext || '?').slice(0, 4).toUpperCase())),
      h('div', { class: 'file-info' },
        h('div', { class: 'file-name' }, x.name || 'Файл'),
        h('div', { class: 'file-size' }, `${bytes(x.size || 0)} · ${m.pending ? 'загрузка…' : 'скачать'}`))),
    ...(danger ? [h('div', { class: 'file-warn' }, icon('warning'), 'Потенциально опасный файл — может содержать вирус')] : []));
    if (m.text) bubble.append(h('div', { class: 'text' }, richText(m.text), h('span', { class: 'meta-spacer' })));
    bubble.append(meta);
    return finishRow(c, m, bubble, { mine, group, first, last });
  }
  if (m.kind === 'voice') {
    bubble.classList.add('voice-bubble');
    bubble.append(voiceEl(m), meta);
    return finishRow(c, m, bubble, { mine, group, first, last });
  }
  if (m.kind === 'call') {
    const x = m.extra || {};
    const missed = ['missed', 'declined', 'cancelled', 'busy'].includes(x.status);
    bubble.classList.add('call-bubble');
    bubble.append(h('button', { class: 'call-card', onclick: () => { const ch = curChat(); if (ch?.type === 'private') startCall(ch, peerOf(ch), !!x.video); } },
      h('div', { class: `call-ic ${missed ? 'missed' : ''}` }, icon(x.video ? 'video' : 'phone')),
      h('div', {}, h('div', { class: 'call-title' }, callText(m)),
        h('div', { class: 'call-sub' }, x.duration ? `${Math.floor(x.duration / 60)}:${String(x.duration % 60).padStart(2, '0')}` : 'Нажмите, чтобы перезвонить'))), meta);
    return finishRow(c, m, bubble, { mine, group, first, last });
  }
  if (m.kind === 'gift') {
    const g = giftById(m.extra?.giftId) || GIFTS[0];
    const toMe = m.extra?.toId === S.me.id;
    bubble.append(h('button', {
      class: 'gift-card',
      style: { background: `linear-gradient(150deg, ${g.colors[0]}, ${g.colors[1]})` },
      onclick: () => openUserProfile(m.extra?.toId, { tab: 'gifts' }),
    },
    h('div', { class: 'gift-shine' }),
    h('div', { class: 'gift-emoji' }, g.emoji),
    h('div', { class: 'gift-title' }, mine ? 'Вы отправили подарок' : toMe ? 'Вам подарок!' : 'Подарок'),
    h('div', { class: 'gift-name' }, g.name),
    h('div', { class: 'gift-price' }, `🍋 ${g.price}`),
    m.text ? h('div', { class: 'gift-note' }, `«${m.text}»`) : null), meta);
    return finishRow(c, m, bubble, { mine, group, first, last });
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

  return finishRow(c, m, bubble, { mine, group, first, last });
}

/** A sticker as a DOM node (SVG image or animated emoji). */
function stickerNode(id, cls = '') {
  const info = stickerInfo(id);
  if (!info) return h('div', { class: `${cls} sticker-missing` }, '🍋');
  if (info.type === 'svg') return h('img', { class: cls, src: info.src, alt: 'Стикер', draggable: false, loading: 'lazy' });
  return h('div', { class: `${cls} anim-emoji anim-${info.anim}` }, info.emoji);
}

function reactionsEl(c, m) {
  if (!m.reactions?.length) return null;
  return h('div', { class: 'reactions' }, m.reactions.map((r) => h('button', {
    class: `reaction ${m.myReaction === r.emoji ? 'mine' : ''}`,
    onclick: (e) => { e.stopPropagation(); react(m, m.myReaction === r.emoji ? null : r.emoji); },
  }, h('span', { class: 'r-emoji' }, r.emoji), h('span', { class: 'r-count' }, fmtCount(r.count)))));
}

async function react(m, emoji) {
  const c = S.chats.get(m.chatId);
  if (c?.preview) return toast('Подпишитесь на канал, чтобы ставить реакции');
  // Optimistic update.
  const prev = { reactions: m.reactions, myReaction: m.myReaction };
  const map = new Map((m.reactions || []).map((r) => [r.emoji, r.count]));
  if (m.myReaction) map.set(m.myReaction, (map.get(m.myReaction) || 1) - 1);
  if (emoji) map.set(emoji, (map.get(emoji) || 0) + 1);
  m.reactions = [...map].filter(([, n]) => n > 0).map(([e, n]) => ({ emoji: e, count: n }));
  m.myReaction = emoji;
  if (S.current === m.chatId) renderMessages();
  try {
    applyReactions(await api.post(`/messages/${m.id}/react`, { emoji }));
  } catch (e) {
    Object.assign(m, prev);
    if (S.current === m.chatId) renderMessages();
    toast(errorText(e), 'error');
  }
}

function applyReactions({ chatId, messageId, reactions, userId, emoji }) {
  const m = S.msgs.get(chatId)?.items.find((x) => x.id === messageId);
  if (!m) return;
  m.reactions = reactions;
  if (userId === S.me.id) m.myReaction = emoji;
  if (S.current === chatId) renderMessages();
}

function finishRow(c, m, bubble, { mine, group, first, last }) {
  const rx = reactionsEl(c, m);
  if (rx) {
    bubble.classList.add('has-reactions');
    const meta = bubble.querySelector(':scope > .meta');
    meta ? bubble.insertBefore(rx, meta) : bubble.append(rx);
  }
  if (isChannel(c)) {
    bubble.classList.add('post');
    if (typeof m.id === 'number' && m.kind !== 'system') {
      bubble.append(h('button', { class: 'post-comments', onclick: (e) => { e.stopPropagation(); commentsModal(c, m); } },
        icon('comment'),
        h('span', {}, m.comments ? `${m.comments} ${plural(m.comments, 'комментарий', 'комментария', 'комментариев')}` : 'Прокомментировать'),
        icon('back', 'chev')));
    }
  }
  const row = h('div', {
    class: `msg-row ${mine ? 'mine' : 'theirs'} ${first ? 'first' : ''} ${last ? 'last' : ''} ${group && !mine ? 'with-avatar' : ''}`,
    dataset: { id: String(m.id) },
  });
  if (group && !mine) {
    const u = S.users.get(m.senderId);
    row.append(last
      ? h('button', { class: 'msg-avatar', onclick: () => openUserProfile(m.senderId) }, userAvatar(u || { id: m.senderId }, 34))
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

let wasAtBottom = true;
function keepBottom() {
  if (wasAtBottom) requestAnimationFrame(() => scrollToBottom());
}

function onScroll() {
  wasAtBottom = isViewingBottom();
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

async function jumpTo(id) {
  let el = V.msgInner.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (!el && typeof id === 'number' && S.current) {
    const chatId = S.current;
    try {
      const r = await api.get(`/chats/${chatId}/messages/around/${id}`);
      const st = S.msgs.get(chatId);
      if (!st || S.current !== chatId) return;
      st.items = r.messages;
      st.hasMore = r.hasMore;
      renderMessages();
      el = V.msgInner.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
    } catch (e) { return toast(errorText(e), 'error'); }
  }
  if (!el) return toast('Сообщение не найдено');
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
    if (!c || c.preview || !st?.loaded || document.hidden || !isViewingBottom()) return;
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
  let dx = 0, swiping = false, lastTap = 0;
  const replyHint = h('div', { class: 'swipe-reply' }, icon('reply'));
  const canSwipe = () => typeof m.id === 'number' && !curChat()?.preview && curChat()?.canPost !== false && !curChat()?.blocked;
  const resetSwipe = () => {
    row.style.transform = '';
    row.classList.remove('swiping');
    replyHint.remove();
    swiping = false; dx = 0;
  };
  bubble.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; dx = 0; swiping = false;
    timer = setTimeout(() => { navigator.vibrate?.(10); open(sx, sy); }, 450);
  }, { passive: true });
  bubble.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const mx = t.clientX - sx, my = t.clientY - sy;
    if (Math.abs(mx) > 10 || Math.abs(my) > 10) clearTimeout(timer);
    // Swipe left to reply (like Telegram).
    if (!swiping && mx < -12 && Math.abs(mx) > Math.abs(my) * 1.5 && canSwipe()) {
      swiping = true;
      row.classList.add('swiping');
      row.append(replyHint);
    }
    if (swiping) {
      dx = Math.max(-90, Math.min(0, mx));
      row.style.transform = `translateX(${dx}px)`;
      const ready = dx <= -60;
      if (ready && !replyHint.classList.contains('ready')) navigator.vibrate?.(8);
      replyHint.classList.toggle('ready', ready);
      replyHint.style.opacity = String(Math.min(1, -dx / 60));
    }
  }, { passive: true });
  bubble.addEventListener('touchend', (e) => {
    clearTimeout(timer);
    if (swiping) {
      const ok = dx <= -60;
      row.classList.add('swipe-back');
      resetSwipe();
      setTimeout(() => row.classList.remove('swipe-back'), 220);
      if (ok) startReply(m);
      return;
    }
    // Double tap = ❤️ (like Telegram).
    const now2 = Date.now();
    if (now2 - lastTap < 300 && typeof m.id === 'number' && !e.target.closest('a, button, .bubble-image, .voice')) {
      lastTap = 0;
      react(m, m.myReaction === '❤️' ? null : '❤️');
      bubble.classList.remove('heart-pop'); void bubble.offsetWidth; bubble.classList.add('heart-pop');
    } else lastTap = now2;
  });
  bubble.addEventListener('touchcancel', () => { clearTimeout(timer); if (swiping) resetSwipe(); });
  bubble.addEventListener('dblclick', (e) => {
    if (isTouch() || e.target.closest('a, .bubble-image')) return;
    window.getSelection()?.removeAllRanges();
    if (typeof m.id === 'number') startReply(m);
  });
}

function showMessageMenu(m, x, y) {
  const c = curChat();
  const mine = m.senderId === S.me.id;
  const canDelete = mine || ((isGroup(c) || isChannel(c)) && c.ownerId === S.me.id);
  const reactRow = c.preview ? null : {
    node: h('div', { class: 'ctx-reactions' }, REACTIONS.map((e) => h('button', {
      class: `ctx-react ${m.myReaction === e ? 'on' : ''}`,
      onclick: () => { closeMenu(); react(m, m.myReaction === e ? null : e); },
    }, e))),
  };
  contextMenu(x, y, [
    reactRow,
    c.canPost !== false && !c.blocked ? { icon: 'reply', label: 'Ответить', onClick: () => startReply(m) } : null,
    FORWARDABLE.has(m.kind) && !c.preview ? { icon: 'forward', label: 'Переслать', onClick: () => forwardModal(m) } : null,
    canPinIn(c) && !['system', 'call'].includes(m.kind) ? (c.pinnedMessage?.id === m.id
      ? { icon: 'unpin', label: 'Открепить', onClick: () => pinMessage(c, null) }
      : { icon: 'pin', label: 'Закрепить', onClick: () => pinMessage(c, m) }) : null,
    isChannel(c) && channelLink(c) ? { icon: 'share', label: 'Ссылка на канал', onClick: () => copyText(channelLink(c)) } : null,
    m.text && m.kind !== 'sticker' ? { icon: 'copy', label: 'Копировать', onClick: () => copyText(m.text) } : null,
    m.kind === 'image' ? { icon: 'download', label: 'Открыть фото', onClick: () => openViewer(m) } : null,
    mine && (m.kind === 'text' || m.kind === 'image') ? { icon: 'edit', label: 'Изменить', onClick: () => startEdit(m) } : null,
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
    const mine = st?.items.filter((m) => m.senderId === S.me.id && typeof m.id === 'number' && m.kind === 'text').at(-1);
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

const nativeAutosize = CSS.supports?.('field-sizing', 'content');
function autosize() {
  if (nativeAutosize) return;
  V.input.style.height = 'auto';
  V.input.style.height = `${Math.min(V.input.scrollHeight, 180)}px`;
}
function updateSendBtn() {
  const hasText = !!V.input.value.trim() || !!S.editing;
  const voice = !hasText && !rec && !!window.MediaRecorder;
  V.sendBtn.classList.toggle('active', hasText || !!rec);
  V.sendBtn.classList.toggle('mic', voice);
  if (V.sendBtn.dataset.mode !== (voice ? 'mic' : 'send')) {
    V.sendBtn.dataset.mode = voice ? 'mic' : 'send';
    V.sendBtn.replaceChildren(icon(voice ? 'mic' : 'send'));
    V.sendBtn.setAttribute('aria-label', voice ? 'Записать голосовое' : 'Отправить');
  }
}

async function submitComposer() {
  if (rec) return finishRecording();
  const text = V.input.value.trim();
  if (!text && !S.editing && window.MediaRecorder) return startRecording();
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
  flySendBtn();
  sendText(text);
}

function flySendBtn() {
  const b = V.sendBtn;
  if (!b) return;
  b.classList.remove('fly');
  void b.offsetWidth; // restart the animation
  b.classList.add('fly');
  clearTimeout(flySendBtn.t);
  flySendBtn.t = setTimeout(() => b.classList.remove('fly'), 500);
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
      transferAnim(tmp.id, message.id);
      addMessage(message, false);
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
      if (st) { st.items = st.items.filter((x) => x !== tmp); transferAnim(tmp.id, message.id); addMessage(message, false); }
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

// ============================================================ emoji / stickers / gifts panel

const RECENT_KEY = 'limoninior.recentEmoji';
let panelTab = 'emoji';

function recentEmoji() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(e) {
  const r = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 32);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

function canGift(c) {
  return c?.type === 'private' && !peerOf(c)?.official;
}

let panelRelease = null;
function togglePanel(force, fromBack = false) {
  const open = force ?? V.panel.classList.contains('hidden');
  const stick = isViewingBottom();
  // Phone Back closes the panel first (like Telegram).
  if (open && !panelRelease && isTouch()) panelRelease = registerOverlay(() => togglePanel(false, true));
  if (!open && panelRelease) { const r = panelRelease; panelRelease = null; if (fromBack !== true) r(); }
  // On phones the panel replaces the keyboard instead of stacking on top of it.
  if (open && isTouch() && document.activeElement === V.input) V.input.blur();
  V.panel.classList.toggle('hidden', !open);
  V.panelBtn.classList.toggle('on', open);
  if (open) renderPanel();
  if (stick) scrollToBottom();
}

function renderPanel() {
  const c = curChat();
  if (!c) return;
  if (panelTab === 'gifts' && !canGift(c)) panelTab = 'emoji';
  const tabs = [['emoji', '😀', 'Эмодзи'], ['stickers', '🍋', 'Стикеры'], canGift(c) ? ['gifts', '🎁', 'Подарки'] : null].filter(Boolean);
  const body = h('div', { class: 'panel-body' });
  if (panelTab === 'emoji') {
    const recent = recentEmoji();
    const groups = recent.length ? [['🕘', 'Недавние', recent.join(' ')], ...EMOJI] : EMOJI;
    for (const [, title, list] of groups) {
      body.append(h('div', { class: 'panel-title' }, title),
        h('div', { class: 'emoji-grid' }, list.split(' ').map((e) => h('button', { class: 'emoji-btn', onclick: () => insertEmoji(e) }, e))));
    }
  } else if (panelTab === 'stickers') {
    for (const pack of STICKER_PACKS) {
      body.append(h('div', { class: 'panel-title' }, pack.title),
        h('div', { class: 'sticker-grid' }, pack.stickers.map((st) => {
          const id = `${pack.id}/${Array.isArray(st) ? st[0] : st}`;
          return h('button', { class: 'sticker-btn', onclick: () => sendSticker(id) }, stickerNode(id, 'panel-sticker'));
        })));
    }
  } else {
    body.append(giftShop(c));
  }
  V.panel.replaceChildren(
    h('div', { class: 'panel-tabs' }, tabs.map(([id, e, label]) => h('button', {
      class: panelTab === id ? 'on' : '', title: label,
      onclick: () => { panelTab = id; renderPanel(); },
    }, h('span', { class: 'tab-emoji' }, e), label))),
    body);
}

function insertEmoji(e) {
  const inp = V.input;
  const start = inp.selectionStart ?? inp.value.length;
  const end = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, start) + e + inp.value.slice(end);
  const pos = start + e.length;
  if (!isTouch()) inp.focus();
  inp.setSelectionRange(pos, pos);
  pushRecent(e);
  autosize();
  updateSendBtn();
}

async function sendSticker(id) {
  const chatId = S.current;
  const reply = S.reply;
  S.reply = null;
  renderBar();
  if (isTouch()) togglePanel(false);
  try {
    const { message } = await api.post(`/chats/${chatId}/stickers`, { sticker: id, replyTo: reply?.id });
    addMessage(message);
    if (S.current === chatId) renderMessages({ stick: true });
  } catch (e) { toast(errorText(e), 'error'); }
}

function coinsLine() {
  const ready = Date.now() >= (S.me.nextBonusAt || 0);
  return h('div', { class: 'coins-line' },
    h('span', { class: 'coins' }, `🍋 ${S.me.coins ?? 0}`),
    h('span', { class: 'muted' }, 'лимонов'),
    ready ? h('button', { class: 'btn btn-sm btn-primary', onclick: claimBonus }, `+${DAILY_BONUS} бонус`) : null);
}

async function claimBonus() {
  try {
    const r = await api.post('/me/bonus');
    S.me = { ...S.me, ...r.user };
    toast(`+${r.bonus} 🍋 Ежедневный бонус получен!`);
    if (!V.panel?.classList.contains('hidden')) renderPanel();
    document.querySelectorAll('[data-coins]').forEach((el) => el.replaceWith(coinsLine()));
  } catch (e) { toast(errorText(e), 'error'); }
}

function giftShop(c) {
  const peer = peerOf(c);
  return h('div', { class: 'gift-shop' },
    coinsLine(),
    h('div', { class: 'panel-title' }, `Подарок для ${peer?.name || 'собеседника'}`),
    h('div', { class: 'gift-grid' }, GIFTS.map((g) => h('button', {
      class: 'gift-item', onclick: () => giftConfirm(c, g),
    },
    h('div', { class: 'gift-item-art', style: { background: `linear-gradient(150deg, ${g.colors[0]}, ${g.colors[1]})` } }, g.emoji),
    h('div', { class: 'gift-item-name' }, g.name),
    h('div', { class: 'gift-item-price' }, `🍋 ${g.price}`)))));
}

function giftConfirm(c, g) {
  const peer = peerOf(c);
  const note = h('input', { class: 'input', placeholder: 'Подпись к подарку (необязательно)', maxLength: 140 });
  const enough = (S.me.coins ?? 0) >= g.price;
  openModal({
    className: 'modal-small',
    body: h('div', { class: 'gift-confirm' },
      h('div', { class: 'gift-confirm-art', style: { background: `linear-gradient(150deg, ${g.colors[0]}, ${g.colors[1]})` } }, g.emoji),
      h('div', { class: 'profile-name' }, g.name),
      h('div', { class: 'muted' }, `Подарок для ${peer?.name || ''} — появится в профиле получателя`),
      note,
      h('div', { class: `gift-balance ${enough ? '' : 'bad'}` }, `Ваш баланс: 🍋 ${S.me.coins ?? 0}`)),
    actions: [
      { label: 'Отмена', onClick: (close) => close() },
      { label: `Подарить за 🍋 ${g.price}`, primary: true, onClick: async (close) => {
        if (!enough) return toast(errorText({ code: 'not_enough_coins' }), 'error');
        try {
          const r = await api.post(`/chats/${c.id}/gift`, { giftId: g.id, note: note.value });
          S.me = { ...S.me, ...r.user };
          addMessage(r.message);
          close();
          togglePanel(false);
          if (S.current === c.id) renderMessages({ stick: true });
          toast(`${g.emoji} Подарок отправлен!`);
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

async function giftsGrid(userId) {
  const grid = h('div', { class: 'profile-gifts' }, h('div', { class: 'list-note' }, h('span', { class: 'spinner' })));
  try {
    const { gifts } = await api.get(`/users/${userId}/gifts`);
    grid.replaceChildren(...(gifts.length ? gifts.map((x) => {
      const g = giftById(x.giftId);
      if (!g) return null;
      return h('div', { class: 'pg-item', title: `${g.name} от ${x.fromName || 'пользователя'}${x.note ? ` — «${x.note}»` : ''}` },
        h('div', { class: 'pg-art', style: { background: `linear-gradient(150deg, ${g.colors[0]}, ${g.colors[1]})` } }, g.emoji),
        h('div', { class: 'pg-from' }, x.fromName || '—'));
    }).filter(Boolean) : [h('div', { class: 'list-note' }, 'Подарков пока нет')]));
  } catch { grid.replaceChildren(h('div', { class: 'list-note' }, 'Не удалось загрузить')); }
  return grid;
}

async function myGiftsModal() {
  const m = openModal({ title: 'Мои подарки', body: h('div', {}, coinsLine(), h('div', { class: 'list-note' }, h('span', { class: 'spinner' }))) });
  const grid = await giftsGrid(S.me.id);
  m.dialog.querySelector('.modal-body > div').replaceChildren(
    h('div', { 'data-coins': '' }, coinsLine()),
    h('p', { class: 'muted small' }, 'Лимоны можно получать ежедневным бонусом и дарить на них подарки друзьям в личных чатах (кнопка 😊 → 🎁).'),
    grid);
}

function passwordModal() {
  const has = S.me.hasPassword;
  const cur = h('input', { class: 'input', type: 'password', placeholder: 'Текущий пароль', autocomplete: 'current-password', maxLength: 128 });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Новый пароль (минимум 8 символов)', autocomplete: 'new-password', maxLength: 128 });
  const pw2 = h('input', { class: 'input', type: 'password', placeholder: 'Повторите пароль', autocomplete: 'new-password', maxLength: 128 });
  openModal({
    title: has ? 'Сменить пароль' : 'Пароль для входа',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, has
        ? 'После смены пароля все другие устройства выйдут из аккаунта.'
        : `Задайте пароль, чтобы входить по @${S.me.username} без Google.`),
      has ? cur : null, pw, pw2),
    actions: [
      { label: 'Отмена', onClick: (close) => close() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        if (pw.value !== pw2.value) return toast('Пароли не совпадают', 'error');
        try {
          S.me = { ...S.me, ...(await api.post('/me/password', { current: cur.value, password: pw.value })).user };
          close();
          toast('Пароль сохранён 🔐');
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

document.addEventListener('mousedown', (e) => {
  if (!V.panel || V.panel.classList.contains('hidden')) return;
  if (V.panel.contains(e.target) || V.panelBtn.contains(e.target) || e.target.closest('.modal-backdrop')) return;
  togglePanel(false);
});

// ============================================================ referrals

async function referralModal() {
  const link = `${location.origin}/?ref=${S.me.username}`;
  const list = h('div', { class: 'ref-list' }, h('span', { class: 'spinner' }));
  const stats = h('div', { class: 'ref-stats' });
  openModal({
    title: 'Пригласить друзей',
    className: 'modal-ref',
    body: h('div', { class: 'stack' },
      h('div', { class: 'ref-hero' },
        h('div', { class: 'ref-gift' }, '🎁'),
        h('div', { class: 'ref-hero-title' }, 'Месяц подписки — вам и другу'),
        h('div', { class: 'ref-hero-sub' }, 'Друг регистрируется по вашей ссылке и получает Plus на месяц. А вам продлеваем подписку на месяц — или дарим Plus, если подписки нет.')),
      h('button', { class: 'ref-link', onclick: () => copyText(link) }, h('span', { class: 'ellipsis' }, link.replace(/^https?:\/\//, '')), icon('copy')),
      h('div', { class: 'ref-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => shareLink(link, 'Залетай в Limoninior — по моей ссылке Plus на месяц в подарок 🍋') }, icon('share'), 'Поделиться'),
        h('button', { class: 'btn btn-ghost', onclick: () => copyText(link) }, icon('copy'), 'Копировать')),
      stats,
      list),
  });
  try {
    const r = await api.get('/referrals');
    stats.replaceChildren(
      h('div', { class: 'ref-stat' }, h('b', {}, String(r.invited.length)), h('span', {}, plural(r.invited.length, 'приглашён', 'приглашено', 'приглашено'))),
      h('div', { class: 'ref-stat' }, h('b', {}, `+${r.rewarded}`), h('span', {}, `${plural(r.rewarded, 'месяц', 'месяца', 'месяцев')} подписки`)));
    list.replaceChildren(...(r.invited.length ? r.invited.map((u) => h('div', { class: 'ref-row' }, avatar(u, 40),
      h('div', { class: 'grow' }, h('div', { class: 'row-main' }, nameWithBadge(u.name, u)), h('div', { class: 'row-sub' }, `@${u.username} · ${dayLabel(u.joinedAt)}`)),
      h('span', { class: `pill ${u.rewarded ? '' : 'muted'}` }, u.rewarded ? '+1 месяц' : 'без бонуса')))
      : [h('div', { class: 'list-note' }, 'Пока никого — отправьте ссылку друзьям!')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
}

// ============================================================ Telegram-style extras

const FORWARDABLE = new Set(['text', 'image', 'sticker', 'file', 'voice']);
const canPinIn = (c) => !!c && !c.preview && (c.type === 'private' || c.type === 'saved' || c.role === 'owner' || c.role === 'admin');

function chatMoreMenu(anchor) {
  const c = curChat();
  if (!c) return;
  const r = anchor.getBoundingClientRect();
  const peer = c.type === 'private' ? peerOf(c) : null;
  contextMenu(r.right - 8, r.bottom + 4, [
    { icon: 'info', label: 'Информация', onClick: () => openInfo(c) },
    { icon: 'search', label: 'Поиск по чату', onClick: openChatSearch },
    !c.preview ? { icon: c.pinnedAt ? 'unpin' : 'pin', label: c.pinnedAt ? 'Открепить чат' : 'Закрепить чат', onClick: () => togglePinChat(c) } : null,
    c.type !== 'saved' && !c.preview ? { icon: c.muted ? 'bell' : 'mute', label: c.muted ? 'Включить уведомления' : 'Выключить уведомления', onClick: () => toggleMute(c) } : null,
    peer && !peer.official ? { icon: 'block', label: c.blocked === 'me' ? 'Разблокировать' : 'Заблокировать', danger: c.blocked !== 'me', onClick: () => setBlocked(peer, c.blocked !== 'me') } : null,
  ]);
}

// ---------- pinned message

function renderPinBar() {
  const c = curChat();
  if (!V.pinBar || !c) return;
  const pm = c.pinnedMessage;
  V.pinBar.classList.toggle('hidden', !pm);
  V.view?.classList.toggle('has-pin', !!pm);
  if (!pm) return V.pinBar.replaceChildren();
  V.pinBar.replaceChildren(
    h('button', { class: 'pin-main', onclick: () => jumpTo(pm.id) },
      h('span', { class: 'pin-line' }),
      h('div', { class: 'pin-text' }, h('b', {}, 'Закреплённое сообщение'), h('span', { class: 'ellipsis' }, messagePreview(pm)))),
    canPinIn(c) ? h('button', { class: 'icon-btn pin-close', 'aria-label': 'Открепить', onclick: () => pinMessage(c, null) }, icon('close')) : null);
}

async function pinMessage(c, m) {
  if (!m && !(await confirmDialog('Открепить сообщение?', { ok: 'Открепить' }))) return;
  try {
    const { chat } = await api.post(`/chats/${c.id}/pin-message`, { messageId: m ? m.id : null });
    upsertChat(chat);
    if (S.current === c.id) renderPinBar();
    toast(m ? 'Сообщение закреплено 📌' : 'Сообщение откреплено');
  } catch (e) { toast(errorText(e), 'error'); }
}

// ---------- forwarding

function forwardModal(m) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Кому переслать?' });
  const list = h('div', { class: 'fwd-list' });
  const targets = () => [...S.chats.values()]
    .filter((c) => !c.preview && c.canPost !== false && !c.blocked)
    .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0) || (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0));
  let modal;
  const render = () => {
    const qv = input.value.trim().toLowerCase();
    const items = targets().filter((c) => !qv || chatTitle(c).toLowerCase().includes(qv) || peerOf(c)?.username?.toLowerCase().includes(qv));
    list.replaceChildren(...(items.length ? items.map((c) => h('button', { class: 'fwd-item', onclick: async () => {
      try {
        await api.post(`/messages/${m.id}/forward`, { chatIds: [c.id] });
        modal.close();
        toast(`Переслано: ${chatTitle(c)}`);
        if (c.id !== S.current) openChat(c.id);
      } catch (e) { toast(errorText(e), 'error'); }
    } }, chatAvatar(c, 42), h('div', { class: 'fwd-name' }, h('span', { class: 'ellipsis' }, chatTitle(c)), chatVerified(c) ? badge() : null))) : [h('div', { class: 'list-note' }, 'Ничего не найдено')]));
  };
  input.addEventListener('input', render);
  render();
  modal = openModal({ title: 'Переслать', className: 'modal-forward', body: h('div', { class: 'stack' }, input, list) });
  if (!isTouch()) setTimeout(() => input.focus(), 50);
}

// ---------- blocking

async function setBlocked(u, block) {
  if (!u) return;
  if (block && !(await confirmDialog(`Заблокировать ${u.name}? Он не сможет писать вам и звонить.`, { ok: 'Заблокировать', danger: true }))) return;
  try {
    const r = await (block ? api.post(`/users/${u.id}/block`) : api.del(`/users/${u.id}/block`));
    if (r.chat) { upsertChat(r.chat); renderChatList(); if (S.current === r.chat.id) renderComposerMode(); }
    toast(block ? `${u.name} заблокирован(а)` : `${u.name} разблокирован(а)`);
  } catch (e) { toast(errorText(e), 'error'); }
}

async function blockedModal() {
  const list = h('div', { class: 'fwd-list' }, h('span', { class: 'spinner' }));
  const load = async () => {
    try {
      const { users } = await api.get('/me/blocks');
      list.replaceChildren(...(users.length ? users.map((u) => h('div', { class: 'fwd-item static' },
        avatar(u, 42), h('div', { class: 'fwd-name' }, h('span', { class: 'ellipsis' }, u.name), h('span', { class: 'muted small' }, ` @${u.username}`)),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await setBlocked(u, false); load(); } }, 'Разблокировать')))
        : [h('div', { class: 'list-note' }, 'Вы никого не блокировали')]));
    } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
  };
  openModal({ title: 'Заблокированные', body: list });
  load();
}

// ---------- search inside the chat

let chatSearchTimer = null;
function openChatSearch() {
  const c = curChat();
  if (!c || !V.searchBar) return;
  if (c.preview) return toast('Подпишитесь на канал, чтобы искать по нему');
  const input = h('input', { class: 'input chat-search-input', type: 'search', placeholder: 'Поиск по сообщениям', enterkeyhint: 'search' });
  const results = h('div', { class: 'chat-search-results hidden' });
  V.searchBar.replaceChildren(h('div', { class: 'chat-search-row' }, icon('search', 'cs-ic'), input,
    h('button', { class: 'icon-btn', 'aria-label': 'Закрыть поиск', onclick: closeChatSearch }, icon('close'))), results);
  V.searchBar.classList.remove('hidden');
  if (!searchRelease) searchRelease = registerOverlay(() => closeChatSearch(true));
  V.view?.classList.add('searching');
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeChatSearch(); } });
  input.addEventListener('input', () => {
    clearTimeout(chatSearchTimer);
    const qv = input.value.trim();
    if (qv.length < 2) { results.classList.add('hidden'); return; }
    chatSearchTimer = setTimeout(async () => {
      try {
        const { messages } = await api.get(`/chats/${c.id}/search?q=${encodeURIComponent(qv)}`);
        if (S.current !== c.id) return;
        results.classList.remove('hidden');
        results.replaceChildren(...(messages.length ? messages.map((m) => h('button', { class: 'cs-item', onclick: () => { closeChatSearch(); jumpTo(m.id); } },
          h('div', { class: 'cs-top' }, h('b', {}, isChannel(c) ? c.title : userName(m.senderId)), h('span', { class: 'muted' }, `${dayLabel(m.createdAt)} ${timeHM(m.createdAt)}`)),
          h('div', { class: 'cs-text ellipsis' }, highlight(messagePreview(m), qv))))
          : [h('div', { class: 'list-note' }, 'Ничего не найдено')]));
      } catch (e) { toast(errorText(e), 'error'); }
    }, 250);
  });
  setTimeout(() => input.focus(), 30);
}

let searchRelease = null;
function closeChatSearch(fromBack = false) {
  if (!V.searchBar || V.searchBar.classList.contains('hidden')) return;
  const r = searchRelease;
  searchRelease = null;
  if (r && fromBack !== true) r();
  V.searchBar.classList.add('hidden');
  V.searchBar.replaceChildren();
  V.view?.classList.remove('searching');
}

function highlight(text, qv) {
  const i = text.toLowerCase().indexOf(qv.toLowerCase());
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', {}, text.slice(i, i + qv.length)), text.slice(i + qv.length)];
}

// ---------- voice messages

let rec = null; // { recorder, stream, chunks, start, levels, timer, ctx, analyser, ui }

function pickAudioMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

async function startRecording() {
  const c = curChat();
  if (!c || rec) return;
  if (inCall()) return toast('Сейчас идёт звонок', 'error');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    return toast('Нет доступа к микрофону. Разрешите его в настройках браузера.', 'error');
  }
  if (S.current !== c.id) { stream.getTracks().forEach((t) => t.stop()); return; }
  const mime = pickAudioMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const r = { chatId: c.id, recorder, stream, chunks: [], start: Date.now(), levels: [], mime: recorder.mimeType || mime };
  recorder.ondataavailable = (e) => { if (e.data?.size) r.chunks.push(e.data); };
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    r.ctx = new AC();
    r.analyser = r.ctx.createAnalyser();
    r.analyser.fftSize = 512;
    r.ctx.createMediaStreamSource(stream).connect(r.analyser);
  } catch { /* waveform is optional */ }
  const buf = new Uint8Array(512);
  const timeEl = h('span', { class: 'rec-time' }, '0:00');
  const meter = h('span', { class: 'rec-dot' });
  r.timer = setInterval(() => {
    const sec = (Date.now() - r.start) / 1000;
    timeEl.textContent = fmtDur(sec);
    if (r.analyser) {
      r.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      r.levels.push(lvl);
      meter.style.transform = `scale(${1 + lvl * 0.8})`;
    }
    if (sec >= 600) finishRecording(); // 10 minutes max
  }, 100);
  r.ui = h('div', { class: 'rec-bar' }, meter, timeEl,
    h('span', { class: 'rec-hint' }, 'Запись…'),
    h('button', { class: 'rec-cancel', onclick: cancelRecording }, 'Отмена'));
  V.composerRow.querySelector('.composer-box').append(r.ui);
  V.composerRow.classList.add('recording');
  recorder.start(250);
  rec = r;
  navigator.vibrate?.(15);
  updateSendBtn();
}

function stopRecorder(r) {
  clearInterval(r.timer);
  r.stream.getTracks().forEach((t) => t.stop());
  r.ctx?.close?.().catch(() => {});
  r.ui?.remove();
  V.composerRow?.classList.remove('recording');
}

function cancelRecording() {
  const r = rec;
  if (!r) return;
  rec = null;
  r.recorder.onstop = null;
  try { r.recorder.stop(); } catch { /* already stopped */ }
  stopRecorder(r);
  if (V.sendBtn) updateSendBtn();
}

function finishRecording() {
  const r = rec;
  if (!r) return;
  rec = null;
  const duration = (Date.now() - r.start) / 1000;
  r.recorder.onstop = () => {
    stopRecorder(r);
    if (V.sendBtn) updateSendBtn();
    if (duration < 0.7) return toast('Слишком короткое голосовое');
    const blob = new Blob(r.chunks, { type: r.mime || 'audio/webm' });
    // 40 bars, 0..31
    const bars = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const slice = r.levels.slice(Math.floor((i * r.levels.length) / n), Math.floor(((i + 1) * r.levels.length) / n));
      const v = slice.length ? Math.max(...slice) : 0;
      bars.push(Math.round(Math.min(1, v) * 31));
    }
    sendVoice(r.chatId, blob, duration, bars);
  };
  try { r.recorder.stop(); } catch { stopRecorder(r); }
}

async function sendVoice(chatId, blob, duration, wave) {
  const reply = S.current === chatId ? S.reply : null;
  if (reply) { S.reply = null; renderBar(); }
  const st = S.msgs.get(chatId);
  const url = URL.createObjectURL(blob);
  const tmp = { id: `tmp${++tmpSeq}`, chatId, senderId: S.me.id, kind: 'voice', text: '', localUrl: url, pending: true, createdAt: Date.now(), extra: { duration, wave } };
  st?.items.push(tmp);
  if (S.current === chatId) renderMessages({ stick: true });
  try {
    const fd = new FormData();
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    fd.append('file', blob, `voice.${ext}`);
    fd.append('duration', String(duration));
    fd.append('wave', JSON.stringify(wave));
    if (reply) fd.append('replyTo', String(reply.id));
    const { message } = await api.post(`/chats/${chatId}/voice`, fd);
    if (st) { st.items = st.items.filter((x) => x !== tmp); transferAnim(tmp.id, message.id); addMessage(message, false); }
  } catch (e) {
    if (st) st.items = st.items.filter((x) => x !== tmp);
    toast(errorText(e), 'error');
  }
  if (S.current === chatId) renderMessages({ stick: true });
}

// One shared player for all voice messages.
const voicePlayer = { audio: null, id: null, ui: null };

function voiceEl(m) {
  const x = m.extra || {};
  const wave = x.wave?.length ? x.wave : Array.from({ length: 40 }, (_, i) => 6 + ((i * 7) % 11));
  const bars = h('div', { class: 'voice-wave' }, wave.map((v) => h('i', { style: { height: `${Math.max(12, (v / 31) * 100)}%` } })));
  const btn = h('button', { class: 'voice-play', 'aria-label': 'Воспроизвести' }, icon('play'));
  const time = h('span', { class: 'voice-time' }, fmtDur(x.duration || 0));
  const el = h('div', { class: 'voice', dataset: { vid: String(m.id) } }, btn, h('div', { class: 'voice-body' }, bars, time));
  const ui = {
    set(playing, frac, cur) {
      btn.replaceChildren(icon(playing ? 'pause' : 'play'));
      const lit = Math.round(frac * bars.children.length);
      [...bars.children].forEach((b, i) => b.classList.toggle('on', i < lit));
      el.classList.toggle('playing', playing || frac > 0);
      time.textContent = playing || frac > 0 ? fmtDur(cur) : fmtDur(x.duration || 0);
    },
  };
  if (voicePlayer.id === m.id && voicePlayer.audio) {
    voicePlayer.ui = ui;
    const a = voicePlayer.audio;
    ui.set(!a.paused, a.duration ? a.currentTime / a.duration : 0, a.currentTime);
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleVoice(m, ui); });
  bars.addEventListener('click', (e) => {
    e.stopPropagation();
    const frac = (e.clientX - bars.getBoundingClientRect().left) / bars.offsetWidth;
    if (voicePlayer.id === m.id && voicePlayer.audio?.duration) voicePlayer.audio.currentTime = frac * voicePlayer.audio.duration;
    else toggleVoice(m, ui, frac);
  });
  return el;
}

function toggleVoice(m, ui, seekFrac = 0) {
  const vp = voicePlayer;
  if (vp.id === m.id && vp.audio) {
    if (vp.audio.paused) vp.audio.play().catch(() => {}); else vp.audio.pause();
    return;
  }
  if (vp.audio) { vp.audio.pause(); vp.ui?.set(false, 0, 0); }
  const a = new Audio(m.localUrl || m.file);
  const dur = () => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : m.extra?.duration || 1);
  vp.audio = a; vp.id = m.id; vp.ui = ui;
  const upd = () => vp.id === m.id && vp.ui?.set(!a.paused, Math.min(1, a.currentTime / dur()), a.currentTime);
  a.addEventListener('timeupdate', upd);
  a.addEventListener('play', upd);
  a.addEventListener('pause', upd);
  a.addEventListener('loadedmetadata', () => { if (seekFrac) a.currentTime = seekFrac * dur(); });
  a.addEventListener('ended', () => {
    vp.ui?.set(false, 0, 0);
    vp.audio = null; vp.id = null;
    // Auto-play the next voice message in this chat (like Telegram).
    const st = S.msgs.get(m.chatId);
    const i = st?.items.findIndex((x) => x.id === m.id) ?? -1;
    const next = i >= 0 ? st.items.slice(i + 1).find((x) => x.kind === 'voice') : null;
    if (next && S.current === m.chatId) {
      const el = V.msgInner?.querySelector(`[data-vid="${CSS.escape(String(next.id))}"] .voice-play`);
      el?.click();
    }
  });
  a.play().catch(() => toast('Не удалось воспроизвести', 'error'));
}

// ============================================================ channels

function channelUsernameField(initial = '', chatId = 0) {
  const f = usernameField(initial);
  const hint = f.wrap.querySelector('.field-hint');
  f.wrap.querySelector('.field-label').textContent = 'Публичная ссылка';
  hint.textContent = initial ? `${location.host}/@${initial}` : 'Латиница, цифры и _, от 5 символов';
  if (chatId) {
    // Re-check excluding this channel's own name.
    f.input.addEventListener('input', () => setTimeout(async () => {
      const v = f.input.value;
      if (v.toLowerCase() !== initial.toLowerCase()) return;
      hint.textContent = `${location.host}/@${v}`;
      hint.className = 'field-hint good';
    }, 400));
  }
  return f;
}

/** Public / private switch; hides the @link field for private channels. */
function channelTypeField(isPrivate, uname) {
  let priv = isPrivate;
  const hint = h('div', { class: 'field-hint' });
  const el = h('div', { class: 'segmented' });
  const render = () => {
    el.replaceChildren(
      h('button', { type: 'button', class: priv ? '' : 'on', onclick: () => { priv = false; render(); } }, icon('at'), 'Публичный'),
      h('button', { type: 'button', class: priv ? 'on' : '', onclick: () => { priv = true; render(); } }, icon('lock'), 'Приватный'));
    hint.textContent = priv
      ? 'Канал не виден в поиске. Вступить можно только по ссылке-приглашению.'
      : 'Канал можно найти в поиске, у него есть ссылка вида /@имя.';
    uname.wrap.classList.toggle('hidden', priv);
  };
  render();
  return { wrap: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Тип канала'), el, hint), isPrivate: () => priv };
}

const inviteLink = (c) => (c.inviteToken ? `${location.origin}/join/${c.inviteToken}` : null);
const channelLink = (c) => (c.username ? `${location.origin}/@${c.username}` : inviteLink(c));

/** /join/<token>: open the channel if already subscribed, else show an invite card. */
async function openInvite(token) {
  let r;
  try { r = await api.get(`/channels/invite/${encodeURIComponent(token)}`); } catch { return toast('Ссылка-приглашение недействительна или устарела', 'error'); }
  if (r.chat) { upsertChat(r.chat); renderChatList(); return openChat(r.chat.id); }
  const ch = r.channel;
  openModal({
    title: 'Приглашение',
    className: 'modal-profile',
    body: h('div', { class: 'profile' },
      h('div', { class: 'profile-hero' }, avatar({ id: ch.id, name: ch.title, src: ch.avatar }, 110),
        h('div', { class: 'profile-name' }, nameWithBadge(ch.title, ch)),
        h('div', { class: 'profile-status' }, ch.isPrivate ? `🔒 Приватный канал · ${subsText(ch.membersCount)}` : subsText(ch.membersCount))),
      ch.description ? h('div', { class: 'profile-rows' }, h('div', { class: 'profile-row' }, icon('info'),
        h('div', {}, h('div', { class: 'row-main pre' }, richText(ch.description)), h('div', { class: 'row-sub' }, 'Описание')))) : null,
      h('button', { class: 'btn btn-primary btn-block', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const { chat } = await api.post(`/channels/invite/${encodeURIComponent(token)}/join`);
          S.msgs.delete(chat.id);
          upsertChat(chat);
          renderChatList();
          closeTopModal();
          openChat(chat.id);
          toast(`Вы подписались на «${chat.title}» 🎉`);
        } catch (err) { e.currentTarget.disabled = false; toast(errorText(err), 'error'); }
      } }, icon('plus'), 'Подписаться')),
  });
}

function newChannelModal() {
  const title = h('input', { class: 'input', placeholder: 'Название канала', maxLength: 64 });
  const uname = channelUsernameField('');
  const kind = channelTypeField(false, uname);
  const desc = h('textarea', { class: 'input', rows: 3, maxLength: 255, placeholder: 'Описание (необязательно)' });
  openModal({
    title: 'Новый канал',
    body: h('div', { class: 'group-form' },
      h('div', { class: 'channel-intro' }, h('div', { class: 'group-ic' }, icon('megaphone')),
        h('div', { class: 'muted small' }, 'Каналы — для публикаций на широкую аудиторию. Писать может только автор, остальные подписываются, читают и ставят реакции.')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Название'), title),
      kind.wrap,
      uname.wrap,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Описание'), desc)),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать канал', primary: true, onClick: async (close) => {
        if (!title.value.trim()) { title.focus(); return toast('Укажите название', 'error'); }
        try {
          const { chat } = await api.post('/channels', { title: title.value, username: uname.input.value, description: desc.value, isPrivate: kind.isPrivate() });
          upsertChat(chat);
          close();
          renderChatList();
          openChat(chat.id);
          toast(chat.isPrivate ? 'Приватный канал создан! Ссылка-приглашение — в информации о канале 🔒' : 'Канал создан! Поделитесь ссылкой 🚀');
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
  setTimeout(() => title.focus(), 50);
}

async function channelInfoModal(c) {
  let ch = c;
  if (!c.preview) {
    try { ch = { ...c, ...(await api.get(`/channels/${c.id}`)).channel }; } catch { /* use cached */ }
  }
  const owner = c.role === 'owner';
  const link = channelLink({ ...c, ...ch });
  const invite = inviteLink(c);
  const avWrap = h('div', { class: owner ? 'avatar-edit' : '' }, avatar({ id: ch.id, name: ch.title, src: ch.avatar }, 110),
    owner ? h('span', { class: 'avatar-edit-overlay' }, icon('camera')) : null);
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
        avWrap.firstChild.replaceWith(avatar({ id: chat.id, name: chat.title, src: chat.avatar }, 110));
        renderChatList(); renderHeader();
      } catch (e) { toast(errorText(e), 'error'); }
    });
  }
  let verifyBlock = null;
  if (owner) {
    verifyBlock = ch.verified
      ? h('div', { class: 'verify-box ok' }, badge(), h('div', {}, h('b', {}, 'Канал верифицирован'), h('div', { class: 'small' }, 'Галочка видна всем подписчикам и в поиске')))
      : c.verifyRequested
        ? h('div', { class: 'verify-box wait' }, icon('shield'), h('div', {}, h('b', {}, 'Заявка на верификацию отправлена'), h('div', { class: 'small' }, 'Администрация рассмотрит её и пришлёт ответ в чат Limoninior')))
        : h('button', { class: 'verify-box', onclick: () => requestVerification(c) }, icon('shield'),
          h('div', {}, h('b', {}, 'Получить галочку'), h('div', { class: 'small' }, 'Подать заявку на верификацию канала')));
  }
  openModal({
    title: 'Канал',
    className: 'modal-profile',
    body: h('div', { class: 'profile' },
      h('div', { class: 'profile-hero' }, avWrap, fileIn,
        h('div', { class: 'profile-name' }, nameWithBadge(ch.title, ch)),
        h('div', { class: 'profile-status' }, subsText(ch.membersCount))),
      h('div', { class: 'profile-rows' },
        ch.description ? h('div', { class: 'profile-row' }, icon('info'), h('div', {}, h('div', { class: 'row-main pre' }, richText(ch.description)), h('div', { class: 'row-sub' }, 'Описание'))) : null,
        ch.username ? h('button', { class: 'profile-row', onclick: () => copyText(`${location.origin}/@${ch.username}`) }, icon('at'),
          h('div', {}, h('div', { class: 'row-main accent' }, `${location.host}/@${ch.username}`), h('div', { class: 'row-sub' }, 'Ссылка · нажмите, чтобы скопировать')))
          : h('div', { class: 'profile-row' }, icon('lock'), h('div', {}, h('div', { class: 'row-main' }, 'Приватный канал'), h('div', { class: 'row-sub' }, 'Не виден в поиске, вход только по приглашению'))),
        invite ? h('button', { class: 'profile-row', onclick: () => copyText(invite) }, icon('share'),
          h('div', { class: 'grow' }, h('div', { class: 'row-main accent ellipsis' }, invite.replace(/^https?:\/\//, '')), h('div', { class: 'row-sub' }, 'Ссылка-приглашение · нажмите, чтобы скопировать'))) : null,
        invite && owner ? h('button', { class: 'profile-row', onclick: () => resetInvite(c) }, icon('refresh'),
          h('div', {}, h('div', { class: 'row-main' }, 'Сбросить ссылку-приглашение'), h('div', { class: 'row-sub' }, 'Старая ссылка перестанет работать'))) : null),
      c.preview
        ? h('button', { class: 'btn btn-primary btn-block', onclick: () => { closeTopModal(); joinChannel(c); } }, icon('plus'), 'Подписаться')
        : h('div', { class: 'profile-actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => { closeTopModal(); toggleMute(c); } }, icon(c.muted ? 'bell' : 'mute'), c.muted ? 'Включить звук' : 'Без звука'),
          link ? h('button', { class: 'btn btn-ghost', onclick: () => shareLink(link, ch.title) }, icon('share'), 'Поделиться') : null),
      verifyBlock,
      owner ? h('div', { class: 'profile-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => editChannelModal(c, ch) }, icon('edit'), 'Изменить'),
        h('button', { class: 'btn btn-danger-ghost', onclick: () => deleteChannel(c) }, icon('trash'), 'Удалить')) : null,
      !owner && !c.preview ? h('button', { class: 'btn btn-danger-ghost btn-block', onclick: () => leaveChannel(c) }, icon('leave'), 'Отписаться') : null),
  });
}

async function shareLink(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
  }
  copyText(url);
}

async function resetInvite(c) {
  if (!(await confirmDialog('Сбросить ссылку-приглашение? Старая ссылка перестанет работать, подписчики останутся.', { ok: 'Сбросить', danger: true }))) return;
  try {
    const { chat } = await api.post(`/channels/${c.id}/invite-reset`);
    upsertChat(chat);
    copyText(inviteLink(chat));
    while (closeTopModal()) { /* close all */ }
    channelInfoModal(chat);
  } catch (e) { toast(errorText(e), 'error'); }
}

async function requestVerification(c) {
  if (!(await confirmDialog('Отправить заявку на верификацию? Администрация проверит канал и выдаст галочку, если он подлинный и активный.', { ok: 'Отправить' }))) return;
  try {
    const { chat } = await api.post(`/channels/${c.id}/verify-request`);
    upsertChat(chat);
    closeTopModal();
    toast('Заявка отправлена ✅');
  } catch (e) { toast(errorText(e), 'error'); }
}

function editChannelModal(c, ch) {
  const title = h('input', { class: 'input', value: ch.title, maxLength: 64 });
  const uname = channelUsernameField(ch.username || '', c.id);
  const kind = channelTypeField(!ch.username, uname);
  const desc = h('textarea', { class: 'input', rows: 3, maxLength: 255 });
  desc.value = ch.description || '';
  openModal({
    title: 'Настройки канала',
    body: h('div', { class: 'group-form' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Название'), title),
      kind.wrap,
      uname.wrap,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Описание'), desc)),
    actions: [
      { label: 'Отмена', onClick: (close) => close() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try {
          const { chat } = await api.patch(`/channels/${c.id}`, kind.isPrivate()
            ? { title: title.value, isPrivate: true, description: desc.value }
            : { title: title.value, username: uname.input.value, description: desc.value });
          upsertChat(chat);
          renderChatList(); renderHeader();
          while (closeTopModal()) { /* close all */ }
          toast('Сохранено');
        } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

async function deleteChannel(c) {
  if (!(await confirmDialog(`Удалить канал «${c.title}» навсегда? Все посты будут удалены у всех подписчиков.`, { ok: 'Удалить', danger: true }))) return;
  try {
    await api.del(`/channels/${c.id}`);
    while (closeTopModal()) { /* close all */ }
    toast('Канал удалён');
  } catch (e) { toast(errorText(e), 'error'); }
}

// ============================================================ drawer & modals

function openDrawer() {
  const me = S.me;
  let backdrop;
  let release = null;
  const close = (fromBack = false) => {
    if (!backdrop.classList.contains('show')) return;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
    if (fromBack !== true) release?.();
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
        userAvatar(me, 64),
        h('div', { class: 'drawer-name' }, nameWithBadge(me.name, me)),
        h('div', { class: 'drawer-username' }, `@${me.username}`)),
      h('button', { class: 'drawer-coins', onclick: () => { close(); myGiftsModal(); } },
        h('span', {}, `🍋 ${me.coins ?? 0}`), h('span', { class: 'dc-label' }, 'лимонов'),
        Date.now() >= (me.nextBonusAt || 0) ? h('span', { class: 'dc-bonus' }, `+${DAILY_BONUS} бонус`) : null)),
    h('div', { class: 'drawer-items' },
      item('user', 'Мой профиль', editProfileModal),
      item('gift', 'Подарки и лимоны', myGiftsModal),
      item('crown', S.me.subUntil ? `${planById(S.me.sub)?.name || 'Подписка'} ✓` : 'Limoninior Premium', subscriptionsModal, 'premium-item'),
      item('group', 'Создать группу', newGroupModal),
      item('gift', 'Пригласить друзей', referralModal, 'ref-item'),
      item('sparkles', 'Новая история', newStory),
      item('megaphone', 'Создать канал', newChannelModal),
      item('search', 'Каталог каналов', popularChannelsModal),
      item('bookmark', 'Избранное', openSaved),
      item('settings', 'Настройки', settingsModal),
      item('devices', 'Активные сеансы', sessionsModal),
      themeToggle,
      !isStandalone() ? item('download', 'Установить приложение', installApp) : null,
      me.isAdmin ? item('shield', 'Админ-панель', () => navigate('/admin'), 'admin') : null,
      h('div', { class: 'drawer-sep' }),
      item('logout', 'Выйти', async () => { if (await confirmDialog('Выйти из аккаунта на этом устройстве?', { ok: 'Выйти', danger: true })) logout(); }, 'danger')),
    h('div', { class: 'drawer-foot' }, `Limoninior · ${S.config.version || 'dev'}`));
  backdrop = h('div', { class: 'drawer-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  release = registerOverlay(() => close(true));
}

function openInfo(c) {
  if (!c) return;
  if (c.type === 'private') return openUserProfile(peerOf(c)?.id);
  if (c.type === 'group') return groupInfoModal(c);
  if (c.type === 'channel') return channelInfoModal(c);
  return openUserProfile(S.me.id);
}

const PROFILE_COLORS = [
  ['lime', 'Лайм'], ['ocean', 'Океан'], ['sunset', 'Закат'], ['berry', 'Ягода'], ['violet', 'Фиалка'], ['mint', 'Мята'], ['gold', 'Золото'], ['night', 'Ночь'],
];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const joinedText = (t) => { const d = new Date(t); return `В Limoninior с ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; };

/** Shared profile hero: colored cover + big avatar + name + status. */
function profileHero(u, { avatarNode, status, onClose, extra } = {}) {
  const color = u.profileColor || (u.official ? 'lime' : PROFILE_COLORS[Math.abs(u.id || 0) % PROFILE_COLORS.length][0]);
  return h('div', { class: `pf-hero pc-${color}` },
    h('div', { class: 'pf-cover' },
      h('div', { class: 'pf-cover-shine' }),
      h('div', { class: 'pf-cover-btns' },
        extra || null,
        h('button', { class: 'pf-glass-btn', 'aria-label': 'Закрыть', onclick: onClose || (() => closeTopModal()) }, icon('close')))),
    h('div', { class: 'pf-avatar' }, avatarNode || userAvatar(u, 116)),
    h('div', { class: 'pf-name' }, nameWithBadge(u.name, u)),
    status ? h('div', { class: `pf-status ${u.online ? 'online' : ''}` }, status) : null);
}

async function openUserProfile(id) {
  if (!id) return;
  if (id === S.me.id) return editProfileModal();
  let u = S.users.get(id);
  try { u = (await api.get(`/users/${id}`)).user; mergeUser(u); } catch { /* use cache */ }
  if (!u) return toast('Пользователь не найден');
  const link = `${location.origin}/@${u.username}`;
  const chat = [...S.chats.values()].find((c) => c.type === 'private' && peerOf(c)?.id === u.id);
  const gifts = h('div', { class: 'pf-gifts' }, h('span', { class: 'spinner' }));
  giftsGrid(u.id).then((g) => gifts.replaceWith(g));
  const media = h('div', { class: 'pf-media' });
  if (chat) {
    api.get(`/chats/${chat.id}/media`).then((r) => {
      if (!r.media.length) { media.replaceChildren(h('div', { class: 'list-note' }, r.files ? `Фото нет · файлов: ${r.files}` : 'Пока нет общих фото')); return; }
      media.replaceChildren(...r.media.map((m) => h('button', { class: 'pf-media-item', onclick: () => openViewer(m) },
        h('img', { src: m.file, alt: '', loading: 'lazy', decoding: 'async' }))));
    }).catch(() => media.replaceChildren());
  }
  const action = (ic, label, fn, cls = '') => h('button', { class: `pf-action ${cls}`, onclick: fn }, h('span', { class: 'pf-action-ic' }, icon(ic)), label);
  const plan = u.sub ? planById(u.sub) : null;
  const m = openModal({
    className: 'modal-profile2',
    body: h('div', { class: 'pf' },
      profileHero(u, {
        status: u.official ? 'официальный аккаунт' : lastSeenText(u),
        extra: h('button', { class: 'pf-glass-btn', 'aria-label': 'Поделиться', onclick: () => shareLink(link, u.name) }, icon('share')),
      }),
      h('div', { class: 'pf-actions' },
        action('chat', 'Написать', () => { closeTopModal(); startPrivate(u.id); }, 'primary'),
        !u.official && chat ? action('phone', 'Звонок', () => { closeTopModal(); startCall(chat, u, false); }) : null,
        !u.official && chat ? action('video', 'Видео', () => { closeTopModal(); startCall(chat, u, true); }) : null,
        !u.official ? action('gift', 'Подарить', () => giftFromProfile(u)) : null,
        chat ? action(chat.muted ? 'bell' : 'mute', chat.muted ? 'Звук' : 'Без звука', () => { toggleMute(chat); closeTopModal(); }) : null,
        !u.official ? action('block', chat?.blocked === 'me' ? 'Разблок.' : 'Блок', () => { closeTopModal(); setBlocked(u, chat?.blocked !== 'me'); }, chat?.blocked === 'me' ? '' : 'danger') : null),
      h('div', { class: 'pf-card' },
        h('button', { class: 'pf-row', onclick: () => copyText(link) }, icon('at'),
          h('div', {}, h('div', { class: 'row-main accent' }, `@${u.username}`), h('div', { class: 'row-sub' }, 'Юзернейм · нажмите, чтобы скопировать ссылку'))),
        u.bio ? h('div', { class: 'pf-row' }, icon('info'), h('div', {}, h('div', { class: 'row-main pre' }, richText(u.bio)), h('div', { class: 'row-sub' }, 'О себе'))) : null,
        plan ? h('div', { class: 'pf-row' }, h('span', { class: 'pf-row-emoji' }, plan.emoji), h('div', {}, h('div', { class: 'row-main' }, plan.name), h('div', { class: 'row-sub' }, 'Подписка'))) : null,
        u.createdAt ? h('div', { class: 'pf-row' }, icon('calendar'), h('div', {}, h('div', { class: 'row-main' }, joinedText(u.createdAt)))) : null),
      h('div', { class: 'pf-section-title' }, `Подарки${u.giftsCount ? ` · ${u.giftsCount}` : ''}`),
      gifts,
      chat ? h('div', { class: 'pf-section-title' }, 'Общие фото') : null,
      chat ? media : null),
  });
  return m;
}

async function giftFromProfile(u) {
  try {
    const { chat } = await api.post('/chats/private', { userId: u.id });
    upsertChat(chat);
    closeTopModal();
    openChat(chat.id);
    panelTab = 'gifts';
    togglePanel(true);
  } catch (e) { toast(errorText(e), 'error'); }
}

function editProfileModal() {
  const me = S.me;
  const name = h('input', { class: 'input', value: me.name, maxLength: 64 });
  const uname = usernameField(me.username);
  const bio = h('textarea', { class: 'input', rows: 2, maxLength: 160, placeholder: 'Пара слов о себе' });
  bio.value = me.bio || '';
  const counter = h('span', { class: 'field-counter' }, `${bio.value.length}/160`);
  bio.addEventListener('input', () => { counter.textContent = `${bio.value.length}/160`; });
  let color = me.profileColor || PROFILE_COLORS[Math.abs(me.id) % PROFILE_COLORS.length][0];
  const avatarWrap = h('div', { class: 'avatar-edit' });
  const renderAv = () => avatarWrap.replaceChildren(userAvatar(S.me, 116), h('span', { class: 'avatar-edit-overlay' }, icon('camera')));
  renderAv();
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', await prepareImage(f, 640, true), 'avatar');
      S.me = { ...S.me, ...(await api.post('/me/avatar', fd)).user };
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
        try { S.me = { ...S.me, ...(await api.del('/me/avatar')).user }; mergeUser(S.me); renderAv(); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ]);
  });
  const hero = profileHero({ ...me, profileColor: color }, {
    avatarNode: h('div', {}, avatarWrap, fileIn),
    status: me.email || `@${me.username}`,
    extra: h('button', { class: 'pf-glass-btn', 'aria-label': 'Поделиться', onclick: () => shareLink(`${location.origin}/@${S.me.username}`, S.me.name) }, icon('share')),
  });
  const colors = h('div', { class: 'pf-colors' });
  const renderColors = () => colors.replaceChildren(...PROFILE_COLORS.map(([v, l]) => h('button', {
    class: `pf-color pc-${v} ${color === v ? 'on' : ''}`, title: l, 'aria-label': l,
    onclick: () => { color = v; hero.className = `pf-hero pc-${v}`; renderColors(); },
  })));
  renderColors();
  const plan = me.sub ? planById(me.sub) : null;
  openModal({
    className: 'modal-profile2',
    body: h('div', { class: 'pf' },
      hero,
      h('div', { class: 'pf-stats' },
        h('button', { class: 'pf-stat', onclick: myGiftsModal }, h('b', {}, `🍋 ${me.coins ?? 0}`), h('span', {}, 'лимонов')),
        h('button', { class: 'pf-stat', onclick: myGiftsModal }, h('b', {}, `🎁 ${me.giftsCount || 0}`), h('span', {}, 'подарков')),
        h('button', { class: 'pf-stat', onclick: subscriptionsModal }, h('b', {}, plan ? plan.emoji : '👑'), h('span', {}, plan ? plan.short : 'Подписка'))),
      h('div', { class: 'pf-card pf-form' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Имя'), name),
        uname.wrap,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'О себе'), bio, counter),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Цвет профиля'), colors)),
      me.createdAt ? h('div', { class: 'pf-joined' }, icon('calendar'), joinedText(me.createdAt)) : null),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try {
          S.me = { ...S.me, ...(await api.patch('/me', { name: name.value, username: uname.input.value, bio: bio.value, profileColor: color })).user };
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

const WALLPAPERS = [
  ['auto', 'Авто'], ['pattern', 'Узор'], ['mesh', 'Сияние'], ['aurora', 'Аврора'], ['sunset', 'Закат'], ['ocean', 'Океан'], ['plain', 'Без узора'],
];

function settingsModal() {
  const body = h('div', { class: 'settings' });
  const section = (ic, title, ...rows) => h('section', { class: 'set-section' },
    h('div', { class: 'set-title' }, h('span', { class: 'set-ic' }, icon(ic)), title),
    h('div', { class: 'set-card' }, rows.flat().filter(Boolean)));
  const save = () => { saveSettings(); };
  // Segmented control bound to a local setting.
  const seg = (key, options, onChange) => {
    const el = h('div', { class: 'segmented' });
    const render = () => el.replaceChildren(...options.map(([v, l]) => h('button', {
      class: S.settings[key] === v ? 'on' : '',
      onclick: () => { S.settings[key] = v; save(); render(); onChange?.(v); },
    }, l)));
    render();
    return el;
  };
  const row = (title, sub, control) => h('div', { class: 'set-row' },
    h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, title), sub ? h('div', { class: 'row-sub' }, sub) : null), control);
  const toggleLocal = (title, sub, key, onChange) => {
    const sw = h('span', { class: `switch ${S.settings[key] ? 'on' : ''}` });
    return h('button', {
      class: 'set-row clickable',
      onclick: async () => {
        let v = !S.settings[key];
        if (onChange) v = await onChange(v);
        S.settings[key] = v;
        save();
        sw.classList.toggle('on', v);
      },
    }, h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, title), sub ? h('div', { class: 'row-sub' }, sub) : null), sw);
  };
  // Server-side preference (sync between devices).
  const prefs = { ...(S.me.prefs || {}) };
  const savePrefs = async (patch) => {
    Object.assign(prefs, patch);
    try { S.me = { ...S.me, ...(await api.patch('/me/prefs', patch)).user }; } catch (e) { toast(errorText(e), 'error'); }
  };
  const togglePref = (title, sub, key) => {
    const sw = h('span', { class: `switch ${prefs[key] ? 'on' : ''}` });
    return h('button', {
      class: 'set-row clickable',
      onclick: () => { const v = !prefs[key]; sw.classList.toggle('on', v); savePrefs({ [key]: v }); },
    }, h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, title), sub ? h('div', { class: 'row-sub' }, sub) : null), sw);
  };
  const segPref = (key, options) => {
    const el = h('div', { class: 'segmented' });
    const render = () => el.replaceChildren(...options.map(([v, l]) => h('button', {
      class: prefs[key] === v ? 'on' : '', onclick: () => { savePrefs({ [key]: v }); render(); },
    }, l)));
    render();
    return el;
  };

  // Sound pickers: built-in list + "own file".
  const soundPicker = (kind) => {
    const key = kind === 'ring' ? 'ringtone' : 'messageSound';
    const store = kind === 'ring' ? 'ringtone' : 'message';
    const list = kind === 'ring' ? Sounds.RINGTONES : Sounds.MESSAGE_SOUNDS;
    const wrap = h('div', { class: 'sound-list' });
    const fileIn = h('input', { type: 'file', accept: 'audio/*', class: 'hidden' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        await Sounds.setCustomSound(store, f);
        S.settings[key] = 'custom';
        save();
        render();
        Sounds.preview(kind, 'custom');
        toast('Свой звук сохранён на этом устройстве 🎵');
      } catch (e) { toast(e.message === 'too_big' ? 'Файл больше 3 МБ' : 'Нужен аудиофайл (mp3, ogg, wav, m4a)', 'error'); }
    });
    const render = async () => {
      const customName = await Sounds.customSoundName(store);
      wrap.replaceChildren(
        ...Object.entries(list).map(([id, d]) => h('button', {
          class: `sound-opt ${S.settings[key] === id ? 'on' : ''}`,
          onclick: () => { S.settings[key] = id; save(); render(); Sounds.preview(kind, id); },
        }, h('span', { class: 'radio' }), d.name)),
        h('button', {
          class: `sound-opt ${S.settings[key] === 'custom' ? 'on' : ''}`,
          onclick: () => { if (customName) { S.settings[key] = 'custom'; save(); render(); Sounds.preview(kind, 'custom'); } else fileIn.click(); },
        }, h('span', { class: 'radio' }), customName ? `Свой: ${customName}` : 'Свой звук…'),
        h('button', { class: 'link-btn sm', onclick: () => fileIn.click() }, icon('music'), customName ? 'Выбрать другой файл' : 'Загрузить свой файл'),
        fileIn);
    };
    render();
    return wrap;
  };

  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.settings.volume, class: 'range' });
  volume.addEventListener('change', () => { S.settings.volume = Number(volume.value); save(); Sounds.preview('msg', S.settings.messageSound); });
  const textSize = h('input', { type: 'range', min: 13, max: 21, step: 0.5, value: S.settings.textSize, class: 'range' });
  const sizeLabel = h('span', { class: 'range-val' }, `${S.settings.textSize}px`);
  textSize.addEventListener('input', () => { S.settings.textSize = Number(textSize.value); sizeLabel.textContent = `${textSize.value}px`; applyTheme(); });
  textSize.addEventListener('change', save);

  const swatches = h('div', { class: 'swatches' });
  const renderSw = () => swatches.replaceChildren(...ACCENTS.map(([v, l]) =>
    h('button', { class: `swatch sw-${v} ${S.settings.accent === v ? 'on' : ''}`, title: l, 'aria-label': l, onclick: () => { S.settings.accent = v; save(); renderSw(); } })));
  renderSw();
  const walls = h('div', { class: 'walls' });
  const renderWalls = () => walls.replaceChildren(...WALLPAPERS.map(([v, l]) =>
    h('button', { class: `wall wall-${v} ${S.settings.wallpaper === v ? 'on' : ''}`, onclick: () => { S.settings.wallpaper = v; save(); renderWalls(); } }, h('span', {}, l))));
  renderWalls();

  body.append(
    section('sparkles', 'Оформление',
      row('Стиль', 'Liquid Glass — полупрозрачное «жидкое стекло»', seg('style', [['glass', 'Liquid Glass'], ['classic', 'Классический']])),
      row('Тема', null, seg('theme', [['system', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']])),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Цвет акцента'), swatches),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Обои чата'), walls),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Размер текста ', sizeLabel), textSize,
        h('div', { class: 'size-preview', style: { fontSize: 'var(--msg-size)' } }, 'Так будут выглядеть сообщения 🍋')),
      toggleLocal('Меньше анимаций', 'Для слабых устройств и экономии батареи', 'reduceMotion')),
    section('bell', 'Уведомления и звуки',
      toggleLocal('Push-уведомления', 'Сообщения и звонки, даже когда приложение закрыто', 'notify', async (v) => {
        if (!v) { await disablePush(); return false; }
        return enablePush();
      }),
      togglePref('Личные чаты', null, 'notifyPrivate'),
      togglePref('Группы', null, 'notifyGroups'),
      togglePref('Каналы', null, 'notifyChannels'),
      togglePref('Звонки', 'Уведомление о входящем звонке', 'notifyCalls'),
      togglePref('Показывать текст', 'Если выключить — в уведомлении будет просто «Новое сообщение»', 'pushPreview'),
      toggleLocal('Звуки в приложении', 'Звук при новом сообщении', 'inAppSounds'),
      toggleLocal('Вибрация', null, 'vibrate'),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Громкость'), volume),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Звук сообщений'), soundPicker('msg')),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Рингтон звонков'), soundPicker('ring'))),
    section('lock', 'Конфиденциальность',
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Кто видит время последнего входа'),
        segPref('lastSeen', [['all', 'Все'], ['nobody', 'Никто']])),
      h('div', { class: 'set-row col' }, h('div', { class: 'row-main' }, 'Кто может мне звонить'),
        segPref('calls', [['all', 'Все'], ['contacts', 'Кому я писал'], ['nobody', 'Никто']])),
      h('button', { class: 'set-row clickable', onclick: blockedModal },
        h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, 'Заблокированные'), h('div', { class: 'row-sub' }, 'Не могут писать и звонить вам')), icon('block'))),
    section('chat', 'Чаты',
      toggleLocal('Отправка по Enter', 'Shift+Enter — новая строка', 'enterToSend')),
    section('shield', 'Безопасность',
      h('button', { class: 'set-row clickable', onclick: passwordModal },
        h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, S.me.hasPassword ? 'Сменить пароль' : 'Задать пароль'),
          h('div', { class: 'row-sub' }, S.me.hasPassword ? `Вход по @${S.me.username} и паролю` : 'Чтобы входить без Google')), icon('key')),
      h('button', { class: 'set-row clickable', onclick: sessionsModal },
        h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, 'Активные сеансы'), h('div', { class: 'row-sub' }, 'Где выполнен вход')), icon('devices'))),
    h('div', { class: 'set-foot' }, `Limoninior · ${S.config.version || 'dev'}`));
  openModal({ title: 'Настройки', className: 'modal-settings', body });
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
  h('div', { class: 'picker-text' }, h('div', { class: 'row-main' }, nameWithBadge(u.name, u)), h('div', { class: 'row-sub' }, `@${u.username}`)),
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
      userAvatar(u, 42, true),
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

// ============================================================ files

function callText(m) {
  const x = m.extra || {};
  const out = m.senderId === S.me.id;
  const kind = x.video ? 'видеозвонок' : 'звонок';
  if (x.status === 'missed') return out ? `Исходящий ${kind} · нет ответа` : `Пропущенный ${kind}`;
  if (x.status === 'declined') return out ? `Исходящий ${kind} · отклонён` : `Отклонённый ${kind}`;
  if (x.status === 'cancelled') return out ? `Отменённый ${kind}` : `Пропущенный ${kind}`;
  if (x.status === 'busy') return out ? `Исходящий ${kind} · занято` : `Пропущенный ${kind}`;
  return out ? `Исходящий ${kind}` : `Входящий ${kind}`;
}

function pickFile(f) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(f.type)) return imageSendModal(f);
  fileSendModal(f);
}

function fileSendModal(file) {
  const limit = (S.me.fileLimitMB || 25) * 1024 * 1024;
  const danger = isDangerousFile(file.name);
  const caption = h('input', { class: 'input', placeholder: 'Подпись…', maxLength: 1024 });
  const chatId = S.current;
  const tooBig = file.size > limit;
  openModal({
    title: 'Отправить файл',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('div', { class: `file-card static ${danger ? 'danger' : ''}` },
        h('div', { class: 'file-ic' }, icon(danger ? 'warning' : 'file'), h('span', {}, (fileExt(file.name) || '?').slice(0, 4).toUpperCase())),
        h('div', { class: 'file-info' }, h('div', { class: 'file-name' }, file.name), h('div', { class: 'file-size' }, bytes(file.size)))),
      danger ? h('div', { class: 'danger-box' }, icon('warning'),
        h('div', {}, h('b', {}, 'Этот тип файла может навредить устройству'), h('div', { class: 'small' }, 'Получатель увидит предупреждение о потенциально опасном файле.'))) : null,
      tooBig ? h('div', { class: 'danger-box' }, icon('warning'), h('div', {}, h('b', {}, `Файл больше ${S.me.fileLimitMB} МБ`),
        h('div', { class: 'small' }, 'С подпиской Limoninior можно отправлять файлы до 200 МБ.'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => { closeTopModal(); subscriptionsModal(); } }, 'Подписки'))) : null,
      tooBig ? null : caption),
    actions: tooBig ? [{ label: 'Закрыть', onClick: (c) => c() }] : [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Отправить', primary: true, onClick: (close) => { close(); uploadFileTo(chatId, file, caption.value.trim()); } },
    ],
  });
}

async function uploadFileTo(chatId, file, text) {
  const reply = S.reply;
  S.reply = null;
  renderBar();
  const st = S.msgs.get(chatId);
  const tmp = {
    id: `tmp${++tmpSeq}`, chatId, senderId: S.me.id, kind: 'file', text, pending: true, createdAt: Date.now(),
    extra: { name: file.name, size: file.size, ext: fileExt(file.name), danger: isDangerousFile(file.name) },
  };
  st?.items.push(tmp);
  if (S.current === chatId) renderMessages({ stick: true });
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('text', text);
    if (reply) fd.append('replyTo', reply.id);
    const { message } = await api.post(`/chats/${chatId}/files`, fd);
    if (st) { st.items = st.items.filter((x) => x !== tmp); transferAnim(tmp.id, message.id); addMessage(message, false); }
  } catch (e) {
    if (st) st.items = st.items.filter((x) => x !== tmp);
    toast(e.code === 'file_too_large' ? `Файл больше ${S.me.fileLimitMB} МБ` : errorText(e), 'error');
  }
  if (S.current === chatId) renderMessages({ stick: true });
}

function downloadFile(m) {
  if (m.pending || !m.file) return;
  const x = m.extra || {};
  const go = () => {
    const a = h('a', { href: m.file, download: x.name || 'file' });
    document.body.append(a);
    a.click();
    a.remove();
  };
  if (!(x.danger || isDangerousFile(x.name || ''))) return go();
  openModal({
    className: 'modal-small',
    body: h('div', { class: 'warn-modal' },
      h('div', { class: 'warn-ic' }, icon('warning')),
      h('h3', {}, 'Потенциально опасная загрузка'),
      h('p', {}, h('b', {}, x.name), ` (${bytes(x.size || 0)}) — это программа или файл, который может запускать код. В таких файлах часто прячут вирусы и стилеры паролей.`),
      h('p', { class: 'muted small' }, 'Скачивайте, только если доверяете отправителю и ждали этот файл. Никогда не запускайте «читы», «генераторы» и «бесплатные подписки».')),
    actions: [
      { label: 'Отмена', primary: true, onClick: (c) => c() },
      { label: 'Всё равно скачать', danger: true, onClick: (c) => { c(); go(); } },
    ],
  });
}

// ============================================================ links

const TRUST_KEY = 'limoninior.trustedHosts';
const trustedHosts = () => { try { return new Set(JSON.parse(localStorage.getItem(TRUST_KEY) || '[]')); } catch { return new Set(); } };

function openExternal(href) {
  let host = '';
  try { host = new URL(href).hostname; } catch { return; }
  const risk = linkRisk(href);
  if (!risk.level && trustedHosts().has(host)) return window.open(href, '_blank', 'noopener,noreferrer');
  const trust = h('input', { type: 'checkbox' });
  const danger = risk.level === 'danger';
  openModal({
    className: 'modal-small',
    body: h('div', { class: `warn-modal ${danger ? '' : 'calm'}` },
      h('div', { class: 'warn-ic' }, icon(danger ? 'warning' : 'share')),
      h('h3', {}, danger ? 'Осторожно, возможно опасно!' : 'Переход по внешней ссылке'),
      h('p', {}, danger ? 'Ссылка выглядит подозрительно. Мошенники так крадут аккаунты, пароли и деньги.' : 'Вы покидаете Limoninior. Убедитесь, что доверяете этому сайту.'),
      h('div', { class: `link-box ${risk.level || ''}` }, h('b', {}, host), h('div', { class: 'small' }, href)),
      risk.reasons.length ? h('ul', { class: 'risk-list' }, risk.reasons.map((r) => h('li', {}, r))) : null,
      !risk.level ? h('label', { class: 'trust-row' }, trust, `Больше не спрашивать для ${host}`) : null),
    actions: danger ? [
      { label: 'Не переходить', primary: true, onClick: (c) => c() },
      { label: 'Всё равно перейти', danger: true, onClick: (c) => { c(); window.open(href, '_blank', 'noopener,noreferrer'); } },
    ] : [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Перейти', primary: true, onClick: (c) => {
        if (trust.checked) {
          const t = trustedHosts(); t.add(host);
          try { localStorage.setItem(TRUST_KEY, JSON.stringify([...t])); } catch { /* ignore */ }
        }
        c();
        window.open(href, '_blank', 'noopener,noreferrer');
      } },
    ],
  });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a.ext-link');
  if (!a) return;
  e.preventDefault();
  openExternal(a.href);
});

// ============================================================ comments

let openComments = null; // { postId, list, render }

function onCommentEvent(ev) {
  const st = S.msgs.get(ev.chatId);
  const m = st?.items.find((x) => x.id === ev.postId);
  if (m) {
    m.comments = ev.count;
    if (S.current === ev.chatId) renderMessages();
  }
  if (openComments?.postId === ev.postId) {
    if (ev.comment && !openComments.list.some((c) => c.id === ev.comment.id)) openComments.list.push(ev.comment);
    if (ev.commentId) openComments.list = openComments.list.filter((c) => c.id !== ev.commentId);
    openComments.render(true);
  }
}

async function commentsModal(c, post) {
  const listEl = h('div', { class: 'comments-list' }, h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
  const input = h('textarea', { class: 'input comment-input', rows: 1, maxLength: 2000, placeholder: 'Написать комментарий…' });
  const sendBtn = h('button', { class: 'send-btn active', 'aria-label': 'Отправить' }, icon('send'));
  const composer = h('div', { class: 'comment-composer' }, input, sendBtn);
  const state = { postId: post.id, list: [], canComment: false, isOwner: false };
  const postPreview = h('div', { class: 'comment-post' },
    avatar({ id: c.id, name: c.title, src: c.avatar }, 36),
    h('div', {}, h('b', {}, nameWithBadge(c.title, c)), h('div', { class: 'small clip2' }, messagePreview(post) || 'Пост')));
  state.render = (scroll) => {
    listEl.replaceChildren(...(state.list.length ? state.list.map((cm) => h('div', { class: 'comment' },
      h('button', { class: 'comment-av', onclick: () => cm.user && (closeTopModal(), openUserProfile(cm.user.id)) }, avatar({ id: cm.user?.id || 0, name: cm.user?.name || '?', src: cm.user?.avatar, official: cm.user?.official }, 36)),
      h('div', { class: 'comment-body' },
        h('div', { class: 'comment-head' }, h('b', { style: { color: nameColor(cm.user?.id || 0) } }, nameWithBadge(cm.user?.name || 'Удалённый аккаунт', cm.user)),
          h('span', { class: 'muted small' }, `${dayLabel(cm.createdAt)}, ${timeHM(cm.createdAt)}`)),
        h('div', { class: 'comment-text' }, richText(cm.text))),
      cm.user?.id === S.me.id || state.isOwner ? h('button', { class: 'icon-btn sm', 'aria-label': 'Удалить', onclick: async () => {
        if (!(await confirmDialog('Удалить комментарий?', { ok: 'Удалить', danger: true }))) return;
        try { await api.del(`/comments/${cm.id}`); } catch (e) { toast(errorText(e), 'error'); }
      } }, icon('trash')) : null))
      : [h('div', { class: 'list-note' }, 'Комментариев пока нет — будьте первым 💬')]));
    if (scroll) listEl.scrollTop = listEl.scrollHeight;
  };
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const r = await api.post(`/posts/${post.id}/comments`, { text });
      if (!state.list.some((x) => x.id === r.comment.id)) state.list.push(r.comment);
      state.render(true);
    } catch (e) { input.value = text; toast(errorText(e), 'error'); }
  };
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); send(); } });
  openComments = state;
  openModal({
    title: 'Комментарии',
    className: 'modal-comments',
    body: h('div', { class: 'comments' }, postPreview, listEl, composer),
    onClose: () => { if (openComments === state) openComments = null; },
  });
  try {
    const r = await api.get(`/posts/${post.id}/comments`);
    state.list = r.comments;
    state.canComment = r.canComment;
    state.isOwner = r.isOwner;
    if (!r.canComment) composer.replaceChildren(h('button', { class: 'btn btn-primary btn-block', onclick: () => { closeTopModal(); joinChannel(c); } }, 'Подпишитесь, чтобы комментировать'));
    state.render(true);
    if (r.canComment && !isTouch()) input.focus();
  } catch (e) { listEl.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
}

// ============================================================ subscriptions

async function subscriptionsModal() {
  let data;
  try { data = await api.get('/subscriptions'); } catch (e) { return toast(errorText(e), 'error'); }
  const cur = data.current;
  const buy = async (plan) => {
    if (!data.seller) return toast('Продавец не настроен — напишите администратору', 'error');
    if (data.seller.id === S.me.id) return toast('Это вы продаёте подписки 🙂');
    try {
      const { chat } = await api.post('/chats/private', { userId: data.seller.id });
      upsertChat(chat);
      S.drafts.set(chat.id, `Привет! Хочу купить ${plan.name} (${plan.price} ₽/мес). Мой юзернейм: @${S.me.username}`);
      while (closeTopModal()) { /* close all */ }
      renderChatList();
      openChat(chat.id);
      toast('Напишите продавцу — сообщение уже подготовлено ✍️');
    } catch (e) { toast(errorText(e), 'error'); }
  };
  openModal({
    title: 'Подписки Limoninior',
    className: 'modal-plans',
    body: h('div', { class: 'plans' },
      h('p', { class: 'muted small center' }, cur
        ? `У вас ${planById(cur)?.name} до ${new Date(data.until).toLocaleDateString('ru-RU')} 💛`
        : 'Поддержите Limoninior и получите плюшки. Оплата — напрямую у владельца мессенджера.'),
      ...data.plans.map((p) => h('div', { class: `plan ${p.popular ? 'popular' : ''} ${cur === p.id ? 'current' : ''}`, style: { '--p1': p.colors[0], '--p2': p.colors[1] } },
        p.popular ? h('div', { class: 'plan-tag' }, 'Популярный') : null,
        h('div', { class: 'plan-head' },
          h('div', { class: 'plan-emoji' }, p.emoji),
          h('div', {}, h('div', { class: 'plan-name' }, p.name), h('div', { class: 'plan-price' }, h('b', {}, `${p.price} ₽`), ' / месяц'))),
        h('ul', { class: 'plan-perks' }, p.perks.map((x) => h('li', {}, icon('check'), x))),
        h('button', { class: 'btn btn-block plan-buy', onclick: () => buy(p) }, cur === p.id ? 'Продлить' : 'Купить'))),
      data.seller ? h('p', { class: 'muted small center' }, 'Кнопка «Купить» откроет чат с ', h('b', {}, `@${data.seller.username}`), '. После оплаты подписка включится вручную.') : null),
  });
}

// ============================================================ push notifications

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

async function enablePush({ silent = false } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (!silent) toast(isIOS() ? 'На iPhone уведомления работают, если установить приложение на экран Домой' : 'Браузер не поддерживает push-уведомления', 'error');
    return false;
  }
  const perm = Notification.permission === 'granted' ? 'granted' : silent ? Notification.permission : await Notification.requestPermission();
  if (perm !== 'granted') {
    if (!silent) toast('Разрешите уведомления в настройках браузера', 'error');
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await api.get('/push/key');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
    }
    await api.post('/push/subscribe', { subscription: sub.toJSON() });
    if (!silent) toast('Уведомления включены 🔔');
    return true;
  } catch (e) {
    if (!silent) toast('Не удалось включить уведомления', 'error');
    return false;
  }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
}

/** Ask once (softly) to turn on notifications after login. */
function maybeOfferPush() {
  if (!('Notification' in window) || !('PushManager' in window)) return;
  if (Notification.permission === 'granted') { if (S.settings.notify !== false) enablePush({ silent: true }); return; }
  if (Notification.permission === 'denied' || localStorage.getItem('limoninior.pushAsked')) return;
  setTimeout(() => {
    try { localStorage.setItem('limoninior.pushAsked', '1'); } catch { /* ignore */ }
    openModal({
      className: 'modal-small',
      body: h('div', { class: 'warn-modal calm' },
        h('div', { class: 'warn-ic' }, icon('bell')),
        h('h3', {}, 'Включить уведомления?'),
        h('p', {}, 'Будем сообщать о новых сообщениях и звонках, даже когда Limoninior закрыт.')),
      actions: [
        { label: 'Позже', onClick: (c) => c() },
        { label: 'Включить', primary: true, onClick: async (c) => { c(); S.settings.notify = await enablePush(); saveSettings(); } },
      ],
    });
  }, 4000);
}

// ============================================================ keyboard

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.ctx-menu')) return closeMenu();
  if (V.panel && !V.panel.classList.contains('hidden')) return togglePanel(false);
  if (closeTopModal()) return;
  const drawer = document.querySelector('.drawer-backdrop.show');
  if (drawer) return drawer.click();
  if (S.current && !isTouch()) closeChat();
});

boot();
