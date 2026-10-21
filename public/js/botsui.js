// Bots: "My bots" manager (create, token, docs) + bot-side bits of chats (keyboards, commands).
import { api, errorText } from './api.js';
import { h, icon, avatar, toast, openModal, confirmDialog, isTouch } from './ui.js';
import { newBotWizard, botBuilder } from './botbuilder.js';

let deps = null; // { openChatWith(userId), prepareImage }
export function initBotsUi(d) { deps = d; }

const apiBase = () => `${location.origin}/bot<ТОКЕН>/`;

function copy(text, msg = 'Скопировано') {
  navigator.clipboard?.writeText(text).then(() => toast(msg), () => toast(text));
}

export async function myBotsModal() {
  const list = h('div', { class: 'fwd-list' }, h('span', { class: 'spinner' }));
  const m = openModal({
    title: 'Мои боты',
    className: 'modal-bots',
    body: h('div', { class: 'stack' },
      h('div', { class: 'bot-hero' }, h('div', { class: 'bot-hero-ic' }, '🤖'),
        h('div', {}, h('b', {}, 'Боты отвечают на сообщения сами'), h('span', {}, 'Выберите шаблон — бот заработает за минуту, без программирования. Программисты могут подключить свой код.'))),
      h('div', { class: 'ref-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => newBotWizard({
          onCreated: (bot) => { load(); botBuilder(bot, { openChat: (id) => deps.openChatWith(id) }); },
          onCode: () => newBotModal(() => load()),
        }) }, icon('plus'), 'Создать бота'),
        h('button', { class: 'btn btn-ghost', onclick: docsModal }, icon('file'), 'Как подключить')),
      list),
  });
  const load = async () => {
    try {
      const { bots } = await api.get('/bots');
      list.replaceChildren(...(bots.length ? bots.map((b) => h('button', { class: 'fwd-item', onclick: () => botModal(b, load) },
        avatar(b.user, 44),
        h('div', { class: 'grow' }, h('div', { class: 'row-main' }, b.user.name, b.noCode ? h('span', { class: 'pill' }, 'конструктор') : null), h('div', { class: 'row-sub' }, `@${b.user.username}`)),
        icon('back', 'chev'))) : [h('div', { class: 'list-note' }, 'У вас пока нет ботов')]));
    } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
  };
  load();
  return m;
}

function newBotModal(done) {
  const name = h('input', { class: 'input', maxLength: 64, placeholder: 'Имя бота, например: Погодный помощник' });
  const user = h('input', { class: 'input', maxLength: 32, placeholder: 'username, должен заканчиваться на bot', autocapitalize: 'off', spellcheck: false });
  const about = h('input', { class: 'input', maxLength: 160, placeholder: 'Описание (необязательно)' });
  openModal({
    title: 'Новый бот',
    className: 'modal-small',
    body: h('div', { class: 'stack' }, name, h('div', { class: 'input-prefix' }, h('span', {}, '@'), user),
      h('div', { class: 'muted small' }, 'Например weather_bot или LemonHelperBot. Латиница, цифры и _.'), about),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать', primary: true, onClick: async (close, btn) => {
        if (btn) btn.disabled = true;
        try {
          const r = await api.post('/bots', { name: name.value.trim(), username: user.value.trim(), about: about.value.trim() });
          close();
          done?.();
          tokenModal(r.bot, r.token, true);
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => name.focus(), 50);
}

function tokenModal(bot, token, fresh) {
  openModal({
    title: fresh ? 'Бот создан 🎉' : 'Новый токен',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('p', { class: 'small' }, `Токен для @${bot.user.username}. Сохраните его — показываем только сейчас. Никому не передавайте: с ним можно управлять ботом.`),
      h('button', { class: 'ref-link mono-link', onclick: () => copy(token, 'Токен скопирован') }, h('span', { class: 'ellipsis' }, token), icon('copy')),
      h('div', { class: 'ref-actions' },
        h('button', { class: 'btn btn-ghost', onclick: docsModal }, icon('file'), 'Как подключить'),
        h('button', { class: 'btn btn-primary', onclick: () => deps.openChatWith(bot.user.id) }, icon('chat'), 'Открыть чат'))),
  });
}

function botModal(b, reload) {
  const name = h('input', { class: 'input', maxLength: 64, value: b.user.name });
  const about = h('input', { class: 'input', maxLength: 160, value: b.user.bio || '', placeholder: 'Описание' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const ava = h('button', { class: 'avatar-edit bot-ava', onclick: () => fileIn.click() }, avatar(b.user, 84), h('span', { class: 'avatar-edit-overlay' }, icon('camera')));
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', await deps.prepareImage(f, 640, true), 'avatar');
      b = (await api.post(`/bots/${b.user.id}/avatar`, fd)).bot;
      ava.firstChild.replaceWith(avatar(b.user, 84));
      reload?.();
    } catch (e) { toast(errorText(e), 'error'); }
  });
  const m = openModal({
    title: `@${b.user.username}`,
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('div', { class: 'bot-head' }, ava, fileIn),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Имя'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Описание'), about),
      b.commands.length ? h('div', { class: 'muted small' }, `Команды: ${b.commands.map((c) => `/${c.command}`).join(', ')}`) : null,
      h('button', { class: 'btn btn-primary btn-block', onclick: () => botBuilder(b, { openChat: (id) => deps.openChatWith(id) }) }, '🧩 Конструктор ответов'),
      h('div', { class: 'bot-acts' },
        h('button', { class: 'btn btn-ghost', onclick: () => deps.openChatWith(b.user.id) }, icon('chat'), 'Чат с ботом'),
        h('button', { class: 'btn btn-ghost', onclick: async () => {
          if (!(await confirmDialog('Выдать новый токен? Старый перестанет работать — программу бота нужно будет перезапустить с новым.', { ok: 'Выдать' }))) return;
          try { tokenModal(b, (await api.post(`/bots/${b.user.id}/token`)).token, false); } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('key'), 'Новый токен'),
        h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog(`Удалить бота @${b.user.username}? Все чаты с ним пропадут.`, { ok: 'Удалить', danger: true }))) return;
          try { await api.del(`/bots/${b.user.id}`); m.close(); reload?.(); toast('Бот удалён'); } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('trash'), 'Удалить'))),
    actions: [
      { label: 'Закрыть', onClick: (c) => c() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try { await api.patch(`/bots/${b.user.id}`, { name: name.value.trim(), about: about.value.trim() }); reload?.(); close(); toast('Сохранено'); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

const EXAMPLE = (base) => `// bot.mjs — запуск: node bot.mjs (Node.js 18+)
const TOKEN = process.env.TOKEN;            // токен из «Мои боты»
const API = '${base}bot' + TOKEN + '/';

const call = (method, body = {}) => fetch(API + method, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((r) => r.json());

await call('setMyCommands', { commands: [
  { command: 'start', description: 'Начать' },
  { command: 'lemon', description: 'Получить лимон' },
] });

let offset = 0;
for (;;) {
  const { result = [] } = await call('getUpdates', { offset, timeout: 30 });
  for (const u of result) {
    offset = u.update_id + 1;
    if (u.message?.text === '/start') {
      await call('sendMessage', {
        chat_id: u.message.chat.id,
        text: 'Привет, ' + u.message.from.name + '! 🍋',
        reply_markup: { inline_keyboard: [[{ text: 'Хочу лимон', callback_data: 'lemon' }]] },
      });
    } else if (u.message?.text) {
      await call('sendMessage', { chat_id: u.message.chat.id, text: 'Вы написали: ' + u.message.text });
    } else if (u.callback_query) {
      await call('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'Держи 🍋' });
    }
  }
}`;

export function docsModal() {
  const base = `${location.origin}/`;
  const methods = [
    ['getMe', 'информация о боте'],
    ['getUpdates', 'новые сообщения и нажатия кнопок: offset, timeout (до 50 с)'],
    ['sendMessage', 'chat_id, text, reply_to_message_id, reply_markup.inline_keyboard'],
    ['editMessageText', 'chat_id, message_id, text, reply_markup'],
    ['deleteMessage', 'chat_id, message_id'],
    ['answerCallbackQuery', 'callback_query_id, text, show_alert'],
    ['setMyCommands', 'commands: [{command, description}] — меню «/» в чате'],
  ];
  openModal({
    title: 'Как подключить бота',
    className: 'modal-bots',
    body: h('div', { class: 'stack bot-docs' },
      h('p', { class: 'small' }, 'API похож на Telegram Bot API. Запросы — GET или POST с JSON на адрес:'),
      h('button', { class: 'ref-link mono-link', onclick: () => copy(apiBase()) }, h('span', { class: 'ellipsis' }, `${apiBase()}<метод>`), icon('copy')),
      h('div', { class: 'bot-methods' }, methods.map(([n, d]) => h('div', {}, h('code', {}, n), h('span', {}, d)))),
      h('p', { class: 'small muted' }, 'Бот видит личные чаты, где ему написали (кнопка «Начать»), и группы, куда его добавили. Писать первым незнакомым людям бот не может.'),
      h('div', { class: 'field-label' }, 'Готовый пример (Node.js):'),
      h('pre', { class: 'bot-code' }, EXAMPLE(base)),
      h('button', { class: 'btn btn-ghost', onclick: () => copy(EXAMPLE(base), 'Пример скопирован') }, icon('copy'), 'Скопировать пример')),
  });
}

// ---------------------------------------------------------------- chats with bots

/** Inline keyboard under a bot message. */
export function keyboardEl(m) {
  const kb = m.extra?.kb;
  if (!Array.isArray(kb) || typeof m.id !== 'number') return null;
  return h('div', { class: 'bot-kb' }, kb.map((row) => h('div', { class: 'bot-kb-row' }, row.map((b) => h('button', {
    class: `bot-kb-btn ${b.url ? 'link' : ''}`,
    onclick: async (e) => {
      e.stopPropagation();
      if (b.url) { deps.openUrl(b.url); return; }
      const el = e.currentTarget;
      el.classList.add('busy');
      try { await api.post(`/messages/${m.id}/callback`, { data: b.data }); } catch (err) { toast(errorText(err), 'error'); }
      setTimeout(() => el.classList.remove('busy'), 1500);
    },
  }, b.text, b.url ? icon('share', 'kb-ic') : null)))));
}

/** Bot answered a button press. */
export function onBotAnswer({ text, alert }) {
  document.querySelectorAll('.bot-kb-btn.busy').forEach((b) => b.classList.remove('busy'));
  if (!text) return;
  if (alert) openModal({ className: 'modal-small', body: h('p', { class: 'confirm-text' }, text), actions: [{ label: 'OK', primary: true, onClick: (c) => c() }] });
  else toast(text);
}

const cmdCache = new Map();
export async function botCommands(botId) {
  if (!cmdCache.has(botId)) cmdCache.set(botId, api.get(`/bots/${botId}/public`).then((r) => r.commands).catch(() => []));
  return cmdCache.get(botId);
}
