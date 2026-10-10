import { api, errorText } from './api.js';
import { h, icon, avatar, timeHM, dayLabel, lastSeenText, bytes, toast, confirmDialog, openModal, nameWithBadge } from './ui.js';
import { PLANS, planById } from './catalog.js';

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
  // Background refreshes would hit "code required" and rebuild this screen, wiping typed digits.
  clearInterval(serverTimer);
  serverTimer = null;
  if (document.querySelector('.otp')) return;
  const cells = Array.from({ length: 6 }, () => h('input', {
    class: 'otp-cell', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': 'Цифра кода',
  }));
  const submit = async () => {
    const code = cells.map((c) => c.value).join('');
    if (code.length !== 6) return;
    cells.forEach((c) => { c.disabled = true; });
    try {
      const r = await api.post('/admin/unlock', { code, remember: remember.checked });
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
  const remember = h('input', { type: 'checkbox', checked: true });
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }),
    h('div', { class: 'login-card' },
      h('div', { class: 'lock-ic' }, icon('shield')),
      h('h1', {}, 'Админ-панель'),
      h('p', { class: 'login-sub' }, 'Введите 6-значный код из приложения-аутентификатора.'),
      box,
      h('label', { class: 'remember-row' }, remember, 'Запомнить это устройство на 30 дней'),
      h('p', { class: 'login-foot' }, 'Доступ ограничен. Все попытки записываются в журнал.'),
      h('a', { class: 'link-btn', href: '/' }, icon('back'), 'Вернуться в мессенджер'))));
  cells[0].focus();
}

// ---------------------------------------------------------------- dashboard

function dashboard() {
  const timerEl = h('span', { class: 'admin-timer' });
  const tick = () => {
    const left = Math.max(0, until - Date.now());
    timerEl.textContent = left > 3600_000
      ? `доступ до ${new Date(until).toLocaleDateString('ru-RU')}`
      : `сессия ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    if (!left) lockScreen();
  };
  clearInterval(lockTimer);
  lockTimer = setInterval(tick, 1000);
  tick();

  const stats = h('section', { class: 'stats-grid' }, h('div', { class: 'spinner' }));
  const chart = h('section', { class: 'admin-card' });
  const devicesBody = h('div', { class: 'devices' });
  const devSummary = h('div', { class: 'dev-summary' });
  let devMode = 'online';
  const devFilter = h('div', { class: 'segmented small-seg' });
  const renderDevFilter = () => devFilter.replaceChildren(...[['online', 'Онлайн'], ['desktop', 'ПК'], ['mobile', 'Телефоны'], ['all', 'Все']].map(([k, l]) =>
    h('button', { class: devMode === k ? 'on' : '', onclick: () => { devMode = k; renderDevFilter(); loadDevices(); } }, l)));
  renderDevFilter();
  const sellerBody = h('div', {});
  const serverBody = h('div', { class: 'server-grid' }, h('div', { class: 'spinner' }));
  const updateBtn = h('button', { class: 'btn btn-sm btn-primary', onclick: requestUpdate }, icon('refresh'), 'Обновить сейчас');
  const bcText = h('textarea', { class: 'input', rows: 3, maxLength: 4096, placeholder: 'Текст объявления — придёт всем пользователям от официального аккаунта Limoninior ✓' });
  const usersBody = h('div', { class: 'users-list' });
  const channelsBody = h('div', { class: 'users-list' });
  const chSearch = h('input', { class: 'input', type: 'search', placeholder: 'Поиск каналов' });
  let ct = null;
  chSearch.addEventListener('input', () => { clearTimeout(ct); ct = setTimeout(() => loadChannels(chSearch.value), 250); });
  const auditBody = h('div', { class: 'audit-list' });
  const bansBody = h('div', { class: 'users-list' });
  const banIpInput = h('input', { class: 'input', placeholder: 'IP-адрес, например 203.0.113.7', autocomplete: 'off', spellcheck: false });
  const banReason = h('input', { class: 'input', placeholder: 'Причина (необязательно)', maxLength: 200 });
  const myIpNote = h('div', { class: 'row-sub' });
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
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Устройства онлайн'), devFilter),
        devSummary, devicesBody),
      chart,
      h('section', { class: 'admin-card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Подписки')),
        sellerBody),
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
        h('div', { class: 'card-head' }, h('h2', {}, 'Баны по IP')),
        h('p', { class: 'muted small' }, 'С забаненного адреса нельзя открыть сайт, войти или зарегистрироваться. Осторожно: у мобильного интернета один IP бывает у многих людей. Ваши собственные адреса забанить нельзя.'),
        h('div', { class: 'ban-form' }, banIpInput, banReason,
          h('button', { class: 'btn btn-danger-ghost', onclick: addIpBan }, icon('shield'), 'Забанить IP')),
        myIpNote,
        bansBody),
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
        card('Подписчики', s.subscribers, 'Plus · Premium · Max', 'crown'),
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
      try { await api.post(`/admin/users/${u.id}/${path}`, body); toast('Готово'); loadUsers(search.value); loadAudit(); return true; } catch (e) { handle(e); return false; }
    };
    const always = [
      h('button', { class: `btn btn-sm ${u.verified ? 'btn-ghost' : 'btn-primary'}`, onclick: () => post('verify', { verified: !u.verified }) },
        u.verified ? 'Снять галочку' : '✓ Галочка'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => coinsDialog(u, post) }, '🍋 Лимоны'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ipsDialog(u) }, '🌐 IP'),
      h('button', { class: `btn btn-sm ${u.sub ? 'btn-primary' : 'btn-ghost'}`, onclick: () => subDialog(u, post) }, u.sub ? `${planById(u.sub)?.emoji} ${planById(u.sub)?.short}` : '👑 Подписка'),
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

  async function loadBans() {
    try {
      const { bans, myIp } = await api.get('/admin/ip-bans');
      myIpNote.textContent = myIp ? `Ваш текущий IP: ${myIp}` : '';
      bansBody.replaceChildren(...(bans.length ? bans.map((b) => h('div', { class: 'user-row' },
        h('div', { class: 'ban-ic' }, '⛔'),
        h('div', { class: 'user-info' },
          h('div', { class: 'row-main mono' }, b.ip),
          h('div', { class: 'row-sub' }, [b.username ? `@${b.username}` : null, b.reason || null, `${dayLabel(b.createdAt)} ${timeHM(b.createdAt)}`].filter(Boolean).join(' · '))),
        h('div', { class: 'user-actions' }, h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
          try { await api.del(`/admin/ip-bans/${encodeURIComponent(b.ip)}`); toast('IP разбанен'); loadBans(); loadAudit(); } catch (e) { handle(e); }
        } }, 'Разбанить')))) : [h('div', { class: 'list-note' }, 'Забаненных адресов нет')]));
    } catch (e) { handle(e); }
  }

  async function addIpBan(ipArg, reasonArg) {
    const ip = typeof ipArg === 'string' ? ipArg : banIpInput.value.trim();
    if (!ip) { banIpInput.focus(); return; }
    if (!(await confirmDialog(`Забанить IP ${ip}? Все, кто заходит с этого адреса, потеряют доступ.`, { ok: 'Забанить', danger: true }))) return;
    try {
      await api.post('/admin/ip-bans', { ip, reason: typeof reasonArg === 'string' ? reasonArg : banReason.value });
      if (typeof ipArg !== 'string') { banIpInput.value = ''; banReason.value = ''; }
      toast(`IP ${ip} забанен`);
      loadBans(); loadAudit();
    } catch (e) { handle(e); }
  }

  async function ipsDialog(u) {
    const body = h('div', { class: 'stack' }, h('div', { class: 'spinner' }));
    const m = openModal({ title: `IP-адреса ${u.name}`, body, actions: [
      { label: 'Закрыть', onClick: (c) => c() },
      u.isAdmin || u.official ? null : { label: 'Бан аккаунта + все IP', danger: true, onClick: async (close) => {
        if (!(await confirmDialog(`Забанить ${u.name} и все его IP-адреса? Он не сможет зайти даже с нового аккаунта с этих адресов.`, { ok: 'Забанить', danger: true }))) return;
        try {
          const r = await api.post(`/admin/users/${u.id}/ban-ip`);
          toast(`Забанен аккаунт и ${r.ips.length} IP`);
          close(); loadUsers(search.value); loadBans(); loadAudit();
        } catch (e) { handle(e); }
      } },
    ].filter(Boolean) });
    try {
      const { ips } = await api.get(`/admin/users/${u.id}/ips`);
      body.replaceChildren(...(ips.length ? ips.map((x) => h('div', { class: 'ip-row' },
        h('div', { class: 'user-info' },
          h('div', { class: 'row-main mono' }, x.ip, x.banned ? h('span', { class: 'pill danger' }, 'забанен') : null, x.protected ? h('span', { class: 'pill' }, 'ваш') : null),
          h('div', { class: 'row-sub' }, `последний раз ${dayLabel(x.lastSeen)} ${timeHM(x.lastSeen)}${x.sharedWith ? ` · ещё ${x.sharedWith} акк. с этого IP` : ''}`)),
        x.banned || x.protected ? null : h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => { await addIpBan(x.ip, `аккаунт @${u.username || u.id}`); m?.close?.(); ipsDialog(u); } }, 'Бан IP')))
        : [h('div', { class: 'list-note' }, 'Адресов пока нет')]));
    } catch (e) { handle(e); }
  }

  async function loadAudit() {
    try {
      const { entries } = await api.get('/admin/audit');
      const LABELS = {
        login: 'Вход', login_failed: 'Неудачный вход', login_banned: 'Вход заблокированного', admin_unlock: 'Вход в админку',
        admin_unlock_failed: 'Неверный код админки', admin_denied: 'Попытка доступа к админке', admin_totp_ratelimited: 'Лимит попыток кода',
        admin_ban: 'Бан', admin_unban: 'Разбан', admin_ip_ban: 'Бан IP', admin_ip_unban: 'Разбан IP', admin_ban_ip: 'Бан аккаунта и IP', admin_logout_user: 'Завершены сеансы', admin_reset_username: 'Сброс юзернейма',
        admin_vacuum: 'Очистка БД', csrf_block: 'Заблокирован CSRF',
        register: 'Регистрация', admin_kill_session: 'Завершён сеанс', admin_sub_grant: 'Выдана подписка', admin_sub_remove: 'Отключена подписка', admin_settings: 'Настройки', password_set: 'Смена пароля', gift: 'Подарок', admin_verify: 'Выдана галочка',
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
        { label: 'Применить', primary: true, onClick: async (close) => {
          const n = Number(inp.value);
          if (!Number.isInteger(n) || n === 0) { inp.focus(); return toast('Введите целое число, например 500 или -100', 'error'); }
          if (await post('coins', { amount: n })) close();
        } },
      ],
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
      title: `Подписка для ${u.name}`,
      className: 'modal-small',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, u.sub ? `Сейчас: ${planById(u.sub)?.name} до ${new Date(u.subUntil).toLocaleDateString('ru-RU')}` : 'Сейчас подписки нет. Выдайте её после оплаты.'),
        h('div', { class: 'small' }, 'Тариф'), plansEl, h('div', { class: 'small' }, 'Срок'), monthsEl,
        h('p', { class: 'muted small' }, 'Пользователь получит сообщение от официального аккаунта Limoninior.')),
      actions: [
        u.sub ? { label: 'Отключить', danger: true, onClick: async (close) => { if (await post('subscription', { plan: null })) close(); } } : null,
        { label: 'Выдать', primary: true, onClick: async (close) => { if (await post('subscription', { plan, months })) close(); } },
      ].filter(Boolean),
    });
  }

  async function loadSeller() {
    try {
      const st = await api.get('/admin/settings');
      const inp = h('input', { class: 'input', placeholder: 'юзернейм продавца, например seek', value: st.sellerUsername });
      sellerBody.replaceChildren(
        h('p', { class: 'muted small' }, 'Кнопка «Купить» у пользователей открывает личный чат с продавцом с готовым сообщением. Оплату принимаете вы, а потом выдаёте подписку в списке пользователей (кнопка «👑 Подписка»).'),
        h('div', { class: 'seller-row' },
          h('div', { class: 'input-prefix' }, h('span', {}, '@'), inp),
          h('button', { class: 'btn btn-primary', onclick: async () => {
            try { await api.post('/admin/settings', { sellerUsername: inp.value }); toast('Сохранено'); loadSeller(); } catch (e) { toast(e.code === 'user_not_found' ? 'Такого пользователя нет' : 'Ошибка', 'error'); }
          } }, 'Сохранить')),
        h('p', { class: 'small' }, 'Сейчас покупатели пишут: ', st.seller ? h('b', {}, `@${st.seller.username} (${st.seller.name})`) : h('b', { class: 'bad' }, 'не настроено')),
        h('div', { class: 'plans-mini' }, PLANS.map((p) => h('div', { class: 'plan-mini' }, h('b', {}, `${p.emoji} ${p.name}`), h('span', {}, `${p.price} ₽/мес`)))));
    } catch (e) { handle(e); }
  }

  async function loadDevices() {
    try {
      const { sessions, summary } = await api.get('/admin/sessions');
      devSummary.replaceChildren(...[
        h('div', { class: 'dev-chip' }, '💻 ', h('b', {}, summary.desktop), ' с ПК'),
        h('div', { class: 'dev-chip' }, '📱 ', h('b', {}, summary.mobile), ' с телефонов'),
        summary.tablet ? h('div', { class: 'dev-chip' }, '📲 ', h('b', {}, summary.tablet), ' с планшетов') : null,
        h('div', { class: 'dev-chip muted' }, `всего сеансов: ${sessions.length}`)].filter(Boolean));
      const list = sessions.filter((x) => devMode === 'all' || (devMode === 'online' ? x.online : x.kind === devMode));
      devicesBody.replaceChildren(...(list.length ? list.slice(0, 200).map((x) => h('div', { class: 'dev-row' },
        h('div', { class: 'dev-ic' }, x.kind === 'desktop' ? '💻' : x.kind === 'tablet' ? '📲' : '📱'),
        h('div', { class: 'dev-info' },
          h('div', { class: 'row-main' }, x.name, x.username ? h('span', { class: 'muted' }, ` @${x.username}`) : null, x.online ? h('span', { class: 'pill' }, 'онлайн') : null),
          h('div', { class: 'row-sub' }, `${x.browser}, ${x.os} · ${x.ip || '—'} · ${x.online ? 'сейчас' : `${dayLabel(x.lastUsed)} ${timeHM(x.lastUsed)}`}`)),
        h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog(`Завершить сеанс ${x.name} (${x.browser}, ${x.os})?`, { ok: 'Завершить', danger: true }))) return;
          try { await api.del(`/admin/sessions/${x.id}`); toast('Сеанс завершён'); loadDevices(); } catch (e) { handle(e); }
        } }, 'Выкинуть'))) : [h('div', { class: 'list-note' }, devMode === 'online' ? 'Сейчас никого нет онлайн' : 'Пусто')]));
    } catch (e) { handle(e); }
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
        h('div', { class: 'row-sub' }, `${c.username ? '@' + c.username : '🔒 приватный'} · владелец ${c.owner}`),
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
  serverTimer = setInterval(() => { loadServer(); loadDevices(); }, 15_000);
  loadUsers();
  loadChannels();
  loadDevices();
  loadSeller();
  loadAudit();
  loadBans();
}

boot();
