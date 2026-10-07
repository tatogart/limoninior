import { api, errorText } from './api.js';
import { h, icon, avatar, timeHM, dayLabel, lastSeenText, bytes, toast, confirmDialog, openModal, nameWithBadge } from './ui.js';

const app = document.getElementById('app');
let lockTimer = null;
let serverTimer = null;
let until = 0;

async function boot() {
  try {
    const s = await api.get('/admin/status');
    until = s.until;
    s.elevated ? dashboard() : lockScreen();
  } catch {
    location.replace('/');
  }
}

function handle(e) {
  if (e.code === 'totp_required') return lockScreen();
  if (e.status === 404 || e.status === 401) return location.replace('/');
  toast(errorText(e), 'error');
}

// ---------------------------------------------------------------- lock screen

function lockScreen() {
  clearInterval(lockTimer);
  const cells = Array.from({ length: 6 }, () => h('input', {
    class: 'otp-cell', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': 'Цифра кода',
  }));
  const submit = async () => {
    const code = cells.map((c) => c.value).join('');
    if (code.length !== 6) return;
    cells.forEach((c) => { c.disabled = true; });
    try {
      const r = await api.post('/admin/unlock', { code });
      until = r.until;
      dashboard();
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
      if (digits.length > 1) { // pasted full code
        digits.slice(0, 6).split('').forEach((d, j) => { if (cells[j]) cells[j].value = d; });
        cells[Math.min(digits.length, 5)].focus();
      } else {
        c.value = digits;
        if (digits && cells[i + 1]) cells[i + 1].focus();
      }
      if (cells.every((x) => x.value)) submit();
    });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !c.value && cells[i - 1]) cells[i - 1].focus();
    });
    c.addEventListener('paste', (e) => {
      const t = (e.clipboardData?.getData('text') || '').replace(/\D/g, '');
      if (t.length === 6) { e.preventDefault(); t.split('').forEach((d, j) => { cells[j].value = d; }); submit(); }
    });
  });
  const box = h('div', { class: 'otp' }, cells);
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }),
    h('div', { class: 'login-card' },
      h('div', { class: 'lock-ic' }, icon('shield')),
      h('h1', {}, 'Админ-панель'),
      h('p', { class: 'login-sub' }, 'Введите 6-значный код из приложения-аутентификатора.'),
      box,
      h('p', { class: 'login-foot' }, 'Доступ ограничен. Все попытки записываются в журнал.'),
      h('a', { class: 'link-btn', href: '/' }, icon('back'), 'Вернуться в мессенджер'))));
  cells[0].focus();
}

// ---------------------------------------------------------------- dashboard

function dashboard() {
  const timerEl = h('span', { class: 'admin-timer' });
  const tick = () => {
    const left = Math.max(0, until - Date.now());
    timerEl.textContent = `сессия ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (!left) lockScreen();
  };
  clearInterval(lockTimer);
  lockTimer = setInterval(tick, 1000);
  tick();

  const stats = h('section', { class: 'stats-grid' }, h('div', { class: 'spinner' }));
  const chart = h('section', { class: 'admin-card' });
  const serverBody = h('div', { class: 'server-grid' }, h('div', { class: 'spinner' }));
  const updateBtn = h('button', { class: 'btn btn-sm btn-primary', onclick: requestUpdate }, icon('refresh'), 'Обновить сейчас');
  const bcText = h('textarea', { class: 'input', rows: 3, maxLength: 4096, placeholder: 'Текст объявления — придёт всем пользователям от официального аккаунта Limoninior ✓' });
  const usersBody = h('div', { class: 'users-list' });
  const channelsBody = h('div', { class: 'users-list' });
  const chSearch = h('input', { class: 'input', type: 'search', placeholder: 'Поиск каналов' });
  let ct = null;
  chSearch.addEventListener('input', () => { clearTimeout(ct); ct = setTimeout(() => loadChannels(chSearch.value), 250); });
  const auditBody = h('div', { class: 'audit-list' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск: имя, @юзернейм, email' });
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadUsers(search.value), 250); });

  app.replaceChildren(h('div', { class: 'admin' },
    h('header', { class: 'admin-top' },
      h('a', { class: 'icon-btn', href: '/', 'aria-label': 'В мессенджер' }, icon('back')),
      h('div', { class: 'admin-title' }, icon('shield'), 'Админ-панель'),
      timerEl,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api.post('/admin/lock').catch(() => {}); lockScreen(); } }, 'Заблокировать')),
    h('main', { class: 'admin-main' },
      stats,
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Сервер и обновления'), updateBtn),
        serverBody),
      chart,
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Рассылка всем')),
        bcText,
        h('div', { class: 'card-foot' }, h('button', { class: 'btn btn-primary', onclick: broadcast }, icon('megaphone'), 'Отправить всем'))),
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Каналы и верификация'), chSearch),
        channelsBody),
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Пользователи'), search),
        usersBody),
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Журнал безопасности'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: vacuum }, 'Очистка БД')),
        auditBody))));

  async function loadStats() {
    try {
      const s = await api.get('/admin/stats');
      const card = (label, value, sub, ic) => h('div', { class: 'stat' },
        h('div', { class: 'stat-ic' }, icon(ic)),
        h('div', {}, h('div', { class: 'stat-value' }, typeof value === 'number' ? value.toLocaleString('ru-RU') : value), h('div', { class: 'stat-label' }, label),
          sub ? h('div', { class: 'stat-sub' }, sub) : null));
      stats.replaceChildren(
        card('Пользователи', s.users, `+${s.usersToday} за сутки`, 'user'),
        card('Активны за сутки', s.activeToday, `${s.banned} заблокировано`, 'bell'),
        card('Сообщения', s.messages, `+${s.messagesToday} за сутки`, 'chat'),
        card('Чаты', s.chats, `${s.groups} групп`, 'group'),
        card('Каналы', s.channels, s.verifyRequests ? `${s.verifyRequests} заявок на галочку` : 'заявок нет', 'megaphone'),
        card('Медиа', bytes(s.mediaBytes), 'на диске', 'camera'),
        card('Сеансы', s.sessions, null, 'devices'));
      const max = Math.max(1, ...s.perDay.map((d) => d.n));
      chart.replaceChildren(h('div', { class: 'card-head' }, h('h2', {}, 'Сообщения за 14 дней')),
        s.perDay.length
          ? h('div', { class: 'bars' }, s.perDay.map((d) => h('div', { class: 'bar', title: `${d.d}: ${d.n}` },
            h('span', { class: 'bar-n' }, d.n),
            h('i', { style: { height: `${Math.max(3, (d.n / max) * 100)}%` } }),
            h('span', { class: 'bar-d' }, d.d.slice(8)))))
          : h('div', { class: 'list-note' }, 'Пока нет данных'));
    } catch (e) { handle(e); }
  }

  async function loadUsers(q = '') {
    try {
      const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}`);
      usersBody.replaceChildren(...(users.length ? users.map(userRow) : [h('div', { class: 'list-note' }, 'Никого не найдено')]));
    } catch (e) { handle(e); }
  }

  function userRow(u) {
    const act = (label, path, confirmText, danger) => h('button', {
      class: `btn btn-sm ${danger ? 'btn-danger-ghost' : 'btn-ghost'}`,
      onclick: async () => {
        if (confirmText && !(await confirmDialog(confirmText, { ok: label, danger }))) return;
        try { await api.post(`/admin/users/${u.id}/${path}`); toast('Готово'); loadUsers(search.value); loadAudit(); } catch (e) { handle(e); }
      },
    }, label);
    const post = async (path, body) => {
      try { await api.post(`/admin/users/${u.id}/${path}`, body); toast('Готово'); loadUsers(search.value); loadAudit(); } catch (e) { handle(e); }
    };
    const always = [
      h('button', { class: `btn btn-sm ${u.verified ? 'btn-ghost' : 'btn-primary'}`, onclick: () => post('verify', { verified: !u.verified }) },
        u.verified ? 'Снять галочку' : '✓ Галочка'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => coinsDialog(u, post) }, '🍋 Лимоны'),
    ];
    return h('div', { class: `user-row ${u.banned ? 'banned' : ''}` },
      avatar({ id: u.id, name: u.name, src: u.avatar, online: u.online, official: u.official }, 44),
      h('div', { class: 'user-info' },
        h('div', { class: 'row-main' }, nameWithBadge(u.name, u), u.isAdmin ? h('span', { class: 'pill' }, 'админ') : null,
          u.official ? h('span', { class: 'pill' }, 'официальный') : null, u.banned ? h('span', { class: 'pill danger' }, 'бан') : null),
        h('div', { class: 'row-sub' }, `${u.username ? `@${u.username}` : 'без юзернейма'} · ${u.email || (u.hasGoogle ? '' : 'вход по паролю')}`),
        h('div', { class: 'row-sub' }, `🍋 ${u.coins} · ${u.messages} сообщ. · рег. ${dayLabel(u.createdAt)} · ${lastSeenText(u)}`)),
      u.official ? null : u.isAdmin ? h('div', { class: 'user-actions' }, always) : h('div', { class: 'user-actions' }, always,
        u.banned ? act('Разбанить', 'unban') : act('Забанить', 'ban', `Заблокировать ${u.name}? Все его сеансы будут завершены.`, true),
        act('Выкинуть', 'logout', `Завершить все сеансы ${u.name}?`),
        u.username ? act('Сбросить @', 'reset-username', `Сбросить юзернейм @${u.username}? Пользователю придётся выбрать новый.`) : null));
  }

  async function loadAudit() {
    try {
      const { entries } = await api.get('/admin/audit');
      const LABELS = {
        login: 'Вход', login_failed: 'Неудачный вход', login_banned: 'Вход заблокированного', admin_unlock: 'Вход в админку',
        admin_unlock_failed: 'Неверный код админки', admin_denied: 'Попытка доступа к админке', admin_totp_ratelimited: 'Лимит попыток кода',
        admin_ban: 'Бан', admin_unban: 'Разбан', admin_logout_user: 'Завершены сеансы', admin_reset_username: 'Сброс юзернейма',
        admin_vacuum: 'Очистка БД', csrf_block: 'Заблокирован CSRF',
        register: 'Регистрация', password_set: 'Смена пароля', gift: 'Подарок', admin_verify: 'Выдана галочка',
        admin_unverify: 'Снята галочка', channel_create: 'Создан канал', channel_delete: 'Удалён канал',
        channel_verify_request: 'Заявка на галочку', admin_channel_verify: 'Канал верифицирован',
        admin_channel_unverify: 'Снята галочка канала', admin_channel_reject: 'Заявка отклонена', admin_channel_delete: 'Админ удалил канал', admin_coins: 'Начислены лимоны', admin_broadcast: 'Рассылка', admin_update_request: 'Запрос обновления',
      };
      const alarm = new Set(['login_failed', 'admin_unlock_failed', 'admin_denied', 'admin_totp_ratelimited', 'csrf_block', 'login_banned']);
      auditBody.replaceChildren(...(entries.length ? entries.map((a) => h('div', { class: `audit-row ${alarm.has(a.action) ? 'alarm' : ''}` },
        h('span', { class: 'audit-time' }, `${dayLabel(a.at)} ${timeHM(a.at)}`),
        h('span', { class: 'audit-action' }, LABELS[a.action] || a.action),
        h('span', { class: 'audit-who' }, a.username ? `@${a.username}` : '—'),
        h('span', { class: 'audit-ip' }, a.ip || ''),
        a.details ? h('span', { class: 'audit-details' }, a.details) : null)) : [h('div', { class: 'list-note' }, 'Пусто')]));
    } catch (e) { handle(e); }
  }

  function coinsDialog(u, post) {
    const inp = h('input', { class: 'input', type: 'number', placeholder: 'Например 500 или -100', step: 1 });
    openModal({
      title: `Лимоны для ${u.name}`,
      className: 'modal-small',
      body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `Сейчас: 🍋 ${u.coins}. Положительное число — начислить, отрицательное — списать.`), inp,
        h('div', { class: 'quick' }, [100, 500, 1000, 5000].map((n) => h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { inp.value = n; } }, `+${n}`)))),
      actions: [
        { label: 'Отмена', onClick: (c) => c() },
        { label: 'Применить', primary: true, onClick: async (close) => { await post('coins', { amount: Number(inp.value) }); close(); } },
      ],
    });
    setTimeout(() => inp.focus(), 50);
  }

  async function broadcast() {
    const text = bcText.value.trim();
    if (!text) return toast('Введите текст', 'error');
    if (!(await confirmDialog('Отправить это сообщение всем пользователям?', { ok: 'Отправить' }))) return;
    try {
      const r = await api.post('/admin/broadcast', { text });
      bcText.value = '';
      toast(`Отправлено: ${r.recipients}`);
      loadAudit();
    } catch (e) { handle(e); }
  }

  const fmtUptime = (sec) => {
    const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60);
    return d ? `${d} д ${hh} ч` : hh ? `${hh} ч ${mm} мин` : `${mm} мин`;
  };

  async function loadServer() {
    try {
      const sv = await api.get('/admin/server');
      const cell = (label, value, sub) => h('div', { class: 'srv' }, h('div', { class: 'srv-label' }, label), h('div', { class: 'srv-value' }, value), sub ? h('div', { class: 'srv-sub' }, sub) : null);
      const up = sv.update;
      serverBody.replaceChildren(...[
        cell('Версия', sv.version || 'dev', sv.node),
        cell('Работает', fmtUptime(sv.uptime), `нагрузка ${sv.load.toFixed(2)}`),
        cell('Память', `${bytes(sv.memory.total - sv.memory.free)} / ${bytes(sv.memory.total)}`, `приложение ${bytes(sv.memory.rss)}`),
        sv.disk ? cell('Диск', `${bytes(sv.disk.free)} свободно`, `из ${bytes(sv.disk.total)}`) : null,
        cell('Автообновление', up ? (up.ok ? 'включено ✓' : 'ошибка ✗') : 'не настроено',
          sv.updateRequested ? 'обновление запрошено, начнётся в течение 2 минут…'
            : up ? `${up.ok ? 'последняя проверка' : up.message} · ${dayLabel(up.at)} ${timeHM(up.at)}` : 'запустите install.sh ещё раз'),
      ].filter(Boolean));
      updateBtn.disabled = sv.updateRequested;
    } catch (e) { handle(e); }
  }

  async function requestUpdate() {
    if (!(await confirmDialog('Скачать последнюю версию с GitHub и перезапустить сервер? Пользователи переподключатся автоматически.', { ok: 'Обновить' }))) return;
    try { await api.post('/admin/update'); toast('Обновление запрошено — займёт 1–3 минуты'); loadServer(); } catch (e) { handle(e); }
  }

  async function loadChannels(qs = '') {
    try {
      const { channels } = await api.get(`/admin/channels?q=${encodeURIComponent(qs)}`);
      channelsBody.replaceChildren(...(channels.length ? channels.map(channelRow) : [h('div', { class: 'list-note' }, 'Каналов нет')]));
    } catch (e) { handle(e); }
  }

  function channelRow(c) {
    const act = (label, fn, cls = 'btn-ghost') => h('button', { class: `btn btn-sm ${cls}`, onclick: fn }, label);
    const call = async (method, path, body, confirmText, danger) => {
      if (confirmText && !(await confirmDialog(confirmText, { ok: 'Да', danger }))) return;
      try {
        await (method === 'del' ? api.del(path) : api.post(path, body));
        toast('Готово');
        loadChannels(chSearch.value); loadAudit(); loadStats();
      } catch (e) { handle(e); }
    };
    return h('div', { class: `user-row ${c.verifyRequested ? 'requested' : ''}` },
      avatar({ id: c.id, name: c.title, src: c.avatar }, 44),
      h('div', { class: 'user-info' },
        h('div', { class: 'row-main' }, nameWithBadge(c.title, c), c.verifyRequested ? h('span', { class: 'pill warn' }, 'заявка на галочку') : null),
        h('div', { class: 'row-sub' }, `@${c.username} · владелец ${c.owner}`),
        h('div', { class: 'row-sub' }, `${c.subscribers} подписчиков · ${c.posts} постов · создан ${dayLabel(c.createdAt)}`),
        c.description ? h('div', { class: 'row-sub clip' }, c.description) : null),
      h('div', { class: 'user-actions' },
        c.verified
          ? act('Снять галочку', () => call('post', `/admin/channels/${c.id}/verify`, { verified: false }, `Снять галочку с «${c.title}»?`))
          : act('✓ Верифицировать', () => call('post', `/admin/channels/${c.id}/verify`, { verified: true }), 'btn-primary'),
        c.verifyRequested ? act('Отклонить', () => call('post', `/admin/channels/${c.id}/reject`, {})) : null,
        act('Удалить', () => call('del', `/admin/channels/${c.id}`, null, `Удалить канал «${c.title}» со всеми постами?`, true), 'btn-danger-ghost')));
  }

  async function vacuum() {
    if (!(await confirmDialog('Удалить истёкшие сеансы и записи журнала старше 180 дней?', { ok: 'Очистить' }))) return;
    try { await api.post('/admin/vacuum'); toast('Готово'); loadStats(); loadAudit(); } catch (e) { handle(e); }
  }

  loadStats();
  loadServer();
  clearInterval(serverTimer);
  serverTimer = setInterval(loadServer, 15_000);
  loadUsers();
  loadChannels();
  loadAudit();
}

boot();
