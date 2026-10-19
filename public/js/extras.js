// Limochat-only features on the client: time capsules, reminders on any message, decision wheel.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, contextMenu, isTouch, plural } from './ui.js';

let d = null; // app hooks: { S, jumpToMessage(chatId, messageId), userName }
export function initExtras(deps) { d = deps; }

const pad = (n) => String(n).padStart(2, '0');
const fmtWhen = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });
/** Value for <input type=datetime-local> in local time. */
const localInput = (t) => { const x = new Date(t); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };

export function countdownText(ms) {
  if (ms <= 0) return 'вот-вот откроется…';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400), hrs = Math.floor((s % 86400) / 3600), min = Math.floor((s % 3600) / 60), sec = s % 60;
  if (days >= 365) { const y = Math.floor(days / 365); return `${y} ${plural(y, 'год', 'года', 'лет')} ${days % 365} дн.`; }
  if (days) return `${days} ${plural(days, 'день', 'дня', 'дней')} ${hrs} ч ${min} мин`;
  if (hrs) return `${hrs} ч ${pad(min)} мин ${pad(sec)} с`;
  return `${pad(min)}:${pad(sec)}`;
}

// Live countdowns without re-rendering the chat.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-open-at]')) el.textContent = countdownText(Number(el.dataset.openAt) - Date.now());
}, 1000);

/** Quick time choices shared by capsules and reminders. */
function presets(kind) {
  const n = new Date();
  const at = (days, hh, mm = 0) => { const x = new Date(n); x.setDate(x.getDate() + days); x.setHours(hh, mm, 0, 0); return x.getTime(); };
  const tomorrow9 = at(1, 9);
  if (kind === 'remind') {
    return [
      ['Через 20 минут', Date.now() + 20 * 60_000],
      ['Через час', Date.now() + 3600_000],
      ['Через 3 часа', Date.now() + 3 * 3600_000],
      [n.getHours() < 18 ? 'Сегодня в 19:00' : 'Завтра в 19:00', n.getHours() < 18 ? at(0, 19) : at(1, 19)],
      ['Завтра в 9:00', tomorrow9],
      ['Через неделю', at(7, 9)],
    ];
  }
  const ny = new Date(n.getFullYear() + 1, 0, 1, 0, 0).getTime();
  return [
    ['Через час', Date.now() + 3600_000],
    ['Завтра утром', tomorrow9],
    ['Через неделю', at(7, n.getHours(), n.getMinutes())],
    ['Через месяц', at(30, n.getHours(), n.getMinutes())],
    ['В Новый год 🎄', ny],
    ['Через год', at(365, n.getHours(), n.getMinutes())],
  ];
}

function timePicker(kind, initial) {
  let value = initial;
  const input = h('input', { class: 'input', type: 'datetime-local', min: localInput(Date.now() + 60_000), value: localInput(initial) });
  const chips = h('div', { class: 'time-chips' });
  const render = () => chips.replaceChildren(...presets(kind).map(([label, t]) => h('button', {
    type: 'button', class: `chip ${Math.abs(t - value) < 60_000 ? 'on' : ''}`, onclick: () => { value = t; input.value = localInput(t); render(); },
  }, label)));
  input.addEventListener('change', () => { const t = new Date(input.value).getTime(); if (Number.isFinite(t)) { value = t; render(); } });
  render();
  return { el: h('div', { class: 'stack' }, chips, input), get: () => value };
}

// ---------------------------------------------------------------- time capsule

export function capsuleModal(chat, onSent) {
  const text = h('textarea', { class: 'input', rows: 4, maxLength: 4096, placeholder: 'Что вы хотите сказать в будущее? Никто не увидит текст до момента открытия — даже вы.' });
  const picker = timePicker('capsule', presets('capsule')[2][1]);
  openModal({
    title: 'Капсула времени',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('div', { class: 'cap-hero' }, h('div', { class: 'cap-hero-ic' }, '⏳'),
        h('div', {}, h('b', {}, 'Письмо в будущее'), h('span', {}, 'В чате появится запечатанный конверт с обратным отсчётом. В назначенный момент он откроется у всех сразу.'))),
      text,
      h('div', { class: 'field-label' }, 'Когда открыть'),
      picker.el),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Запечатать', primary: true, onClick: async (close, btn) => {
        if (!text.value.trim()) { text.focus(); return; }
        if (picker.get() < Date.now() + 60_000) return toast('Выберите время хотя бы через минуту', 'error');
        if (btn) btn.disabled = true;
        try {
          const { message } = await api.post(`/chats/${chat.id}/capsule`, { text: text.value.trim(), openAt: picker.get() });
          close();
          onSent?.(message);
          toast('Капсула запечатана 🔒');
        } catch (e) { toast(e.code === 'bad_open_at' ? 'Время открытия — от минуты до 10 лет' : errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => text.focus(), 50);
}

export function capsuleEl(m) {
  const x = m.extra || {};
  if (!x.opened) {
    return h('div', { class: 'capsule sealed' },
      h('div', { class: 'cap-env' }, h('div', { class: 'cap-flap' }), h('div', { class: 'cap-seal' }, '🍋')),
      h('div', { class: 'cap-title' }, '🔒 Капсула времени'),
      h('div', { class: 'cap-count', 'data-open-at': x.openAt }, countdownText(x.openAt - Date.now())),
      h('div', { class: 'cap-sub' }, `откроется ${fmtWhen(x.openAt)}`));
  }
  const fresh = x.openedAt && Date.now() - x.openedAt < 15_000;
  return h('div', { class: `capsule opened ${fresh ? 'fresh' : ''}` },
    h('div', { class: 'cap-title' }, '🔓 Капсула открыта'),
    h('div', { class: 'cap-sub' }, `запечатана ${fmtWhen(m.createdAt)}`),
    h('div', { class: 'cap-text' }, m.text));
}

// ---------------------------------------------------------------- reminders

const reminders = new Map(); // messageId -> reminder
export async function loadReminders() {
  try {
    const { reminders: list } = await api.get('/reminders');
    reminders.clear();
    for (const r of list) reminders.set(r.messageId, r);
  } catch { /* offline */ }
}
export const reminderFor = (messageId) => reminders.get(messageId) || null;

async function setReminder(m, at, note = '') {
  try {
    const { reminder } = await api.post(`/messages/${m.id}/remind`, { at, note });
    reminders.set(m.id, reminder);
    toast(`⏰ Напомню ${fmtWhen(at)}`);
  } catch (e) { toast(e.code === 'bad_time' ? 'Выберите время в будущем' : e.code === 'too_many_reminders' ? 'Слишком много напоминаний' : errorText(e), 'error'); }
}

export function reminderItems(m) {
  if (typeof m.id !== 'number' || m.kind === 'system') return [];
  const r = reminders.get(m.id);
  if (r) {
    return [{ icon: 'bell', label: `Напоминание ${fmtWhen(r.at)} — отменить`, onClick: async () => {
      try { await api.del(`/reminders/${r.id}`); reminders.delete(m.id); toast('Напоминание отменено'); } catch (e) { toast(errorText(e), 'error'); }
    } }];
  }
  return [{ icon: 'bell', label: 'Напомнить…', onClick: () => remindModal(m) }];
}

function remindModal(m) {
  const picker = timePicker('remind', presets('remind')[1][1]);
  const note = h('input', { class: 'input', maxLength: 200, placeholder: 'Заметка (необязательно): например, «ответить Маше»' });
  openModal({
    title: 'Напомнить об этом сообщении',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'В выбранное время сообщение вернётся к вам в «Избранное» со ссылкой, и придёт уведомление.'),
      picker.el, note),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Напомнить', primary: true, onClick: async (close) => { await setReminder(m, picker.get(), note.value.trim()); close(); } },
    ],
  });
}

/** A reminder fired: a toast you can tap to jump to the message. */
export function onReminder(r) {
  reminders.delete(r.messageId);
  const el = h('div', { class: 'gc-invite rem-toast' },
    h('div', { class: 'rem-ic' }, '⏰'),
    h('div', { class: 'grow' }, h('b', {}, r.note || 'Напоминание'), h('span', {}, `${r.from}: ${r.preview}`)),
    h('button', { class: 'btn btn-sm btn-primary', onclick: () => { el.remove(); d.jumpToMessage(r.chatId, r.messageId); } }, 'Открыть'),
    h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onclick: () => el.remove() }, icon('close')));
  document.body.append(el);
  setTimeout(() => el.remove(), 60_000);
}

/** The reminder line in Saved messages. */
export function reminderSystemEl(m) {
  const r = m.extra.reminder;
  return h('div', { class: 'system-msg rem-msg' }, h('button', { class: 'rem-card', onclick: () => d.jumpToMessage(r.chatId, r.messageId) },
    h('div', { class: 'rem-ic' }, '⏰'),
    h('div', { class: 'grow' }, h('b', {}, m.text), h('span', {}, `${r.from}: ${r.preview}`)),
    h('span', { class: 'rem-go' }, 'Перейти', icon('back', 'chev'))));
}

// ---------------------------------------------------------------- decision wheel

const WHEEL_COLORS = ['#f7c948', '#7ed957', '#38bdf8', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#f87171', '#60a5fa', '#facc15', '#c084fc', '#4ade80'];

export function wheelModal(chat, onSent) {
  const question = h('input', { class: 'input', maxLength: 200, placeholder: 'Вопрос, например: куда пойдём?' });
  const list = h('div', { class: 'wheel-opts' });
  const inputs = [];
  const add = (v = '') => {
    if (inputs.length >= 12) return;
    const inp = h('input', { class: 'input', maxLength: 60, placeholder: `Вариант ${inputs.length + 1}`, value: v });
    inputs.push(inp);
    const row = h('div', { class: 'wheel-opt' }, h('span', { class: 'wheel-dot', style: { background: WHEEL_COLORS[(inputs.length - 1) % 12] } }), inp,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Убрать вариант', onclick: () => { if (inputs.length <= 2) return; inputs.splice(inputs.indexOf(inp), 1); row.remove(); } }, icon('close')));
    list.append(row);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (inp === inputs.at(-1)) add(); inputs.at(-1).focus(); } });
  };
  add(); add(); add();
  openModal({
    title: 'Колесо решений',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('div', { class: 'cap-hero' }, h('div', { class: 'cap-hero-ic' }, '🎡'),
        h('div', {}, h('b', {}, 'Пусть решит колесо'), h('span', {}, 'Результат выбирает сервер — честно и одинаково для всех. Каждый увидит, как колесо крутится.'))),
      question, list,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { add(); inputs.at(-1).focus(); } }, icon('plus'), 'Добавить вариант')),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать', primary: true, onClick: async (close, btn) => {
        const options = inputs.map((i) => i.value.trim()).filter(Boolean);
        if (!question.value.trim()) { question.focus(); return; }
        if (new Set(options).size < 2) return toast('Нужно хотя бы 2 разных варианта', 'error');
        if (btn) btn.disabled = true;
        try {
          const { message } = await api.post(`/chats/${chat.id}/wheel`, { question: question.value.trim(), options });
          close();
          onSent?.(message);
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => question.focus(), 50);
}

function wheelSvg(options) {
  const n = options.length, r = 100, seg = (2 * Math.PI) / n;
  const pt = (a) => [r + r * Math.sin(a), r - r * Math.cos(a)];
  const parts = options.map((o, i) => {
    const [x1, y1] = pt(i * seg), [x2, y2] = pt((i + 1) * seg);
    const mid = (i + 0.5) * seg;
    const [tx, ty] = [r + 62 * Math.sin(mid), r - 62 * Math.cos(mid)];
    const label = o.length > 12 ? `${o.slice(0, 11)}…` : o;
    return `<path d="M${r} ${r} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${seg > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${WHEEL_COLORS[i % 12]}"/>`
      + `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${(((mid * 180) / Math.PI) + (mid > Math.PI ? 90 : -90)).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="middle">${label.replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 200 200" class="wheel-svg"><g>${parts}</g><circle cx="100" cy="100" r="15" fill="#fff"/><circle cx="100" cy="100" r="6" fill="#1f2937"/></svg>`;
}

const spun = new Set(); // "id:spins" already animated on this device

export function wheelEl(m) {
  const x = m.extra || {};
  const n = x.options.length;
  const seg = 360 / n;
  const disc = h('div', { class: 'wheel-disc' });
  disc.innerHTML = wheelSvg(x.options);
  const has = x.result != null;
  const final = has ? 360 * 6 - (x.result + 0.5) * seg + (x.spins % 2 ? 360 : 0) : 0;
  const key = `${m.id}:${x.spins}`;
  const live = has && x.spunAt && Date.now() - x.spunAt < 5000 && !spun.has(key);
  const resultEl = h('div', { class: `wheel-result ${has ? '' : 'hidden'}` }, has ? `🎉 ${x.options[x.result]}` : '');
  if (live) {
    spun.add(key);
    resultEl.classList.add('pending');
    disc.style.transform = 'rotate(0deg)';
    requestAnimationFrame(() => requestAnimationFrame(() => { disc.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.12,1)'; disc.style.transform = `rotate(${final}deg)`; }));
    setTimeout(() => resultEl.classList.remove('pending'), 4300);
  } else {
    disc.style.transform = `rotate(${final}deg)`;
  }
  const mine = m.senderId === d.S.me.id;
  const canSpin = typeof m.id === 'number' && (!has || mine);
  return h('div', { class: 'wheel' },
    h('div', { class: 'wheel-q' }, '🎡 ', m.text),
    h('div', { class: 'wheel-stage' }, h('div', { class: 'wheel-pointer' }), disc),
    resultEl,
    has ? h('div', { class: 'wheel-by' }, `${x.spunBy === d.S.me.id ? 'крутили вы' : `крутит ${d.userName(x.spunBy)}`}${x.spins > 1 ? ` · попытка ${x.spins}` : ''} · честный выбор сервера`) : null,
    canSpin ? h('button', { class: 'btn btn-sm btn-primary wheel-btn', onclick: async (e) => {
      e.stopPropagation();
      e.currentTarget.disabled = true;
      try { await api.post(`/messages/${m.id}/spin`); } catch (err) { toast(err.code === 'already_spun' ? 'Колесо уже прокрутили' : err.code === 'spinning' ? 'Колесо ещё крутится' : errorText(err), 'error'); }
    } }, has ? 'Крутить ещё раз' : 'Крутить колесо') : null);
}
