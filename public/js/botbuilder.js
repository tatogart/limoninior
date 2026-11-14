// No-code bots: pick a template, give it a name — the bot works right away. Then edit what it
// answers in a visual constructor: greeting, commands, replies to words, buttons, "didn't get it".
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, isTouch } from './ui.js';

const VARS_HINT = 'В ответах можно писать: {first} — имя собеседника, {username}, {date}, {time}, {random:да|нет|может быть} — случайный вариант.';

export const TEMPLATES = [
  { id: 'hello', emoji: '👋', name: 'Приветствие', desc: 'Здоровается, рассказывает о вас и отвечает на «привет»', script: {
    welcome: { text: 'Привет, {first}! 👋\nЯ бот-помощник. Нажми кнопку ниже или напиши /help.', buttons: [{ text: 'Кто ты?', reply: 'Я бот, сделанный в конструкторе Limochat 🍋' }, { text: 'Что умеешь?', reply: 'Отвечаю на команды /help и /about, а ещё на слова «привет» и «спасибо».' }] },
    commands: [{ command: 'help', description: 'Помощь', text: 'Команды:\n/help — помощь\n/about — обо мне' }, { command: 'about', description: 'Обо мне', text: 'Меня создали в Limochat без единой строчки кода 😎' }],
    keywords: [{ words: ['привет', 'здравствуй', 'хай', 'ку'], text: 'Привет-привет, {first}! 🙌' }, { words: ['спасибо', 'спс', 'благодарю'], text: 'Всегда пожалуйста! 💚' }],
    fallback: { text: 'Я пока не понимаю 🤔 Напиши /help.' } } },
  { id: 'faq', emoji: '❓', name: 'Вопрос-ответ', desc: 'Частые вопросы кнопками: цены, доставка, контакты', script: {
    welcome: { text: 'Здравствуйте, {first}! Выберите вопрос 👇', buttons: [{ text: '💰 Сколько стоит?', reply: 'Цены начинаются от 500 ₽. Напишите, что вас интересует.' }, { text: '🚚 Доставка', reply: 'Доставляем за 1–3 дня по всей России.' }, { text: '📞 Контакты', reply: 'Пишите сюда — ответим в течение часа. Работаем с 10:00 до 20:00.' }] },
    commands: [{ command: 'faq', description: 'Частые вопросы', text: 'Выберите вопрос 👇', buttons: [{ text: '💰 Цены', reply: 'Цены начинаются от 500 ₽.' }, { text: '🚚 Доставка', reply: 'Доставляем за 1–3 дня.' }] }],
    keywords: [{ words: ['цена', 'стоимость', 'сколько стоит', 'прайс'], text: 'Цены начинаются от 500 ₽ 💰' }, { words: ['доставка', 'доставить', 'привезти'], text: 'Доставляем за 1–3 дня 🚚' }],
    fallback: { text: 'Спасибо за вопрос! Человек скоро ответит. А пока — /faq' } } },
  { id: 'shop', emoji: '🛒', name: 'Магазин', desc: 'Каталог, цены и заказ — кнопки и ссылки', script: {
    welcome: { text: 'Добро пожаловать в магазин, {first}! 🛍', buttons: [{ text: '📋 Каталог', reply: '1. Лимонад — 150 ₽\n2. Лимонный пирог — 300 ₽\n3. Набор «Лимонный день» — 500 ₽\n\nЧтобы заказать — /order' }, { text: '🛒 Заказать', reply: 'Напишите номер товара и адрес — оформим заказ!' }] },
    commands: [{ command: 'catalog', description: 'Каталог', text: '1. Лимонад — 150 ₽\n2. Лимонный пирог — 300 ₽\n3. Набор «Лимонный день» — 500 ₽' }, { command: 'order', description: 'Заказать', text: 'Напишите номер товара и адрес доставки 📦' }],
    keywords: [{ words: ['каталог', 'товары', 'ассортимент'], text: 'Смотрите /catalog 📋' }],
    fallback: { text: 'Принято! Менеджер свяжется с вами. Каталог: /catalog' } } },
  { id: 'fun', emoji: '🎲', name: 'Развлечения', desc: 'Шутки, монетка, предсказания и шар судьбы', script: {
    welcome: { text: 'Йо, {first}! Я весёлый бот 🎉\n/joke — шутка\n/coin — монетка\n/ball — шар судьбы', buttons: [{ text: '😂 Шутка', reply: '{random:Почему лимон грустный? Потому что его выжали 🍋|Программист заходит в бар… и выходит, потому что бар закрыт с 1970 года 🙃|— Доктор, я лимон! — Не кисните 🍋}' }, { text: '🪙 Монетка', reply: 'Выпало: {random:Орёл 🦅|Решка 🪙}' }] },
    commands: [
      { command: 'joke', description: 'Шутка', text: '{random:Почему лимон грустный? Потому что его выжали 🍋|— Доктор, я лимон! — Не кисните 🍋|Лимон зашёл в бар и сказал: «Мне что-нибудь кислое»}' },
      { command: 'coin', description: 'Монетка', text: 'Выпало: {random:Орёл 🦅|Решка 🪙}' },
      { command: 'ball', description: 'Шар судьбы', text: '🔮 {random:Да!|Нет.|Скорее да|Скорее нет|Спроси позже|Без сомнений|Даже не думай}' },
    ],
    keywords: [{ words: ['скучно', 'скука'], text: 'Держи шутку: {random:Почему лимон грустный? Потому что его выжали 🍋|— Доктор, я лимон! — Не кисните 🍋}' }],
    fallback: { text: 'Не понял 😅 Попробуй /joke, /coin или /ball' } } },
  { id: 'away', emoji: '🌙', name: 'Автоответчик', desc: 'Отвечает, когда вас нет на месте', script: {
    welcome: { text: 'Привет, {first}! Я автоответчик. Оставьте сообщение — хозяин ответит позже 🙂' },
    commands: [], keywords: [{ words: ['срочно', 'важно', 'помогите'], text: 'Понял, это срочно! Передам как можно скорее ⚡' }],
    fallback: { text: 'Сейчас меня нет на месте ⏳ Отвечу, как только смогу. Время сообщения: {time}' } } },
  { id: 'empty', emoji: '✏️', name: 'С нуля', desc: 'Пустой бот — всё настроите сами', script: { welcome: { text: 'Привет, {first}!' }, commands: [], keywords: [], fallback: { text: '' } } },
  { id: 'code', emoji: '💻', name: 'Свой код (API)', desc: 'Для программистов: токен и Bot API', script: null },
];

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function suggestUsername(name) {
  let u = [...String(name).toLowerCase()].map((ch) => TR[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9_]+/, '');
  u = (u || 'my').slice(0, 20);
  return /bot$/.test(u) ? u : `${u}_bot`;
}

/** Step 1: template, step 2: name. Then the constructor opens. */
export function newBotWizard({ onCreated, onCode }) {
  const grid = h('div', { class: 'bb-templates' }, TEMPLATES.map((t) => h('button', { class: 'bb-tpl', onclick: () => { m.close(); if (!t.script) onCode?.(); else nameStep(t, onCreated); } },
    h('span', { class: 'bb-tpl-emoji' }, t.emoji), h('b', {}, t.name), h('span', {}, t.desc))));
  const m = openModal({
    title: 'Новый бот', className: 'modal-bots',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Выберите шаблон — бот заработает сразу, без программирования. Потом всё можно поменять в конструкторе.'), grid),
  });
}

function nameStep(tpl, onCreated) {
  const name = h('input', { class: 'input', maxLength: 64, placeholder: 'Например: Лимонный помощник' });
  const user = h('input', { class: 'input', maxLength: 32, autocapitalize: 'off', spellcheck: false });
  const hint = h('div', { class: 'field-hint' }, 'Ссылка на бота. Должна заканчиваться на bot.');
  let touched = false, t = null;
  const check = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const u = user.value.trim().replace(/^@/, '');
      if (!/^[a-zA-Z][a-zA-Z0-9_]{2,28}bot$/i.test(u)) { hint.textContent = 'Латиница, цифры и _, в конце — bot'; hint.className = 'field-hint bad'; return; }
      try {
        const r = await api.get(`/username-check?u=${encodeURIComponent(u)}`);
        hint.textContent = r.ok ? `✓ ${location.host}/@${u} свободно` : 'Это имя уже занято — попробуйте другое';
        hint.className = `field-hint ${r.ok ? 'ok' : 'bad'}`;
      } catch { /* offline */ }
    }, 250);
  };
  name.addEventListener('input', () => { if (!touched) { user.value = suggestUsername(name.value); check(); } });
  user.addEventListener('input', () => { touched = true; check(); });
  openModal({
    title: `${tpl.emoji} ${tpl.name}`, className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Имя бота'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Юзернейм'), h('div', { class: 'input-prefix' }, h('span', {}, '@'), user), hint)),
    actions: [
      { label: 'Назад', onClick: (c) => { c(); newBotWizard({ onCreated }); } },
      { label: 'Создать', primary: true, onClick: async (close, btn) => {
        if (btn) btn.disabled = true;
        try {
          const r = await api.post('/bots', { name: name.value.trim(), username: user.value.trim(), about: tpl.desc, script: { ...tpl.script, enabled: true } });
          close();
          toast(`Бот @${r.bot.user.username} готов и уже отвечает 🎉`);
          onCreated?.(r.bot, r.token);
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => name.focus(), 50);
}

// ---------------------------------------------------------------- the constructor

function buttonsEditor(list) {
  const box = h('div', { class: 'bb-btns' });
  const draw = () => box.replaceChildren(...list.map((b, i) => {
    const isUrl = b.url !== undefined;
    const t = h('input', { class: 'input', placeholder: 'Текст кнопки', maxLength: 40, value: b.text || '' });
    const v = isUrl ? h('input', { class: 'input', placeholder: 'https://…', value: b.url || '', inputMode: 'url', autocapitalize: 'off' })
      : h('textarea', { class: 'input', rows: 1, placeholder: 'Что ответит бот на нажатие', maxLength: 2000 });
    if (!isUrl) v.value = b.reply || '';
    t.addEventListener('input', () => { b.text = t.value; });
    v.addEventListener('input', () => { if (isUrl) b.url = v.value; else b.reply = v.value; });
    return h('div', { class: 'bb-btn-row' },
      h('div', { class: 'bb-btn-kind' }, h('button', { type: 'button', class: isUrl ? '' : 'on', onclick: () => { delete b.url; b.reply = b.reply || ''; draw(); } }, 'Ответ'),
        h('button', { type: 'button', class: isUrl ? 'on' : '', onclick: () => { delete b.reply; b.url = b.url || ''; draw(); } }, 'Ссылка')),
      t, v, h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Удалить кнопку', onclick: () => { list.splice(i, 1); draw(); } }, icon('close')));
  }), ...(list.length < 8 ? [h('button', { type: 'button', class: 'link-btn sm', onclick: () => { list.push({ text: '', reply: '' }); draw(); } }, icon('plus'), 'Кнопка')] : []));
  draw();
  return box;
}

function replyEditor(rule, ph = 'Ответ бота') {
  rule.buttons = rule.buttons || [];
  const ta = h('textarea', { class: 'input', rows: 3, maxLength: 2000, placeholder: ph });
  ta.value = rule.text || '';
  ta.addEventListener('input', () => { rule.text = ta.value; });
  return h('div', { class: 'bb-reply' }, ta, buttonsEditor(rule.buttons));
}

export async function botBuilder(bot, { openChat } = {}) {
  let sc;
  try { sc = (await api.get(`/bots/${bot.user.id}/script`)).script; } catch (e) { return toast(errorText(e), 'error'); }
  sc = sc || { enabled: true, welcome: { text: 'Привет, {first}!', buttons: [] }, commands: [], keywords: [], fallback: { text: '', buttons: [] }, groups: true };
  const body = h('div', { class: 'bb' });
  const section = (emoji, title, sub, ...content) => h('section', { class: 'bb-sec' }, h('div', { class: 'bb-sec-head' }, h('span', {}, emoji), h('div', {}, h('b', {}, title), sub ? h('span', {}, sub) : null)), ...content);
  const sw = (key, label) => h('label', { class: 'bb-switch' }, h('input', { type: 'checkbox', checked: sc[key] !== false, onchange: (e) => { sc[key] = e.target.checked; } }), h('span', {}, label));
  const cmdBox = h('div', { class: 'bb-list' });
  const kwBox = h('div', { class: 'bb-list' });
  const drawCmds = () => cmdBox.replaceChildren(...sc.commands.map((c, i) => {
    const name = h('input', { class: 'input bb-cmd', maxLength: 33, value: `/${c.command || ''}`, autocapitalize: 'off', spellcheck: false });
    name.addEventListener('input', () => { c.command = name.value.replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_]/g, ''); });
    const desc = h('input', { class: 'input', maxLength: 120, value: c.description || '', placeholder: 'Описание в меню «/»' });
    desc.addEventListener('input', () => { c.description = desc.value; });
    return h('div', { class: 'bb-item' }, h('div', { class: 'bb-item-head' }, name, desc,
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Удалить', onclick: () => { sc.commands.splice(i, 1); drawCmds(); } }, icon('trash'))), replyEditor(c));
  }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { sc.commands.push({ command: '', description: '', text: '', buttons: [] }); drawCmds(); } }, icon('plus'), 'Добавить команду'));
  const drawKws = () => kwBox.replaceChildren(...sc.keywords.map((k, i) => {
    const words = h('input', { class: 'input', placeholder: 'Слова через запятую: привет, хай', value: (k.words || []).join(', ') });
    words.addEventListener('input', () => { k.words = words.value.split(',').map((w) => w.trim()).filter(Boolean); });
    return h('div', { class: 'bb-item' }, h('div', { class: 'bb-item-head' }, words,
      h('label', { class: 'bb-exact', title: 'Только если сообщение целиком совпадает' }, h('input', { type: 'checkbox', checked: !!k.exact, onchange: (e) => { k.exact = e.target.checked; } }), 'точно'),
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Удалить', onclick: () => { sc.keywords.splice(i, 1); drawKws(); } }, icon('trash'))), replyEditor(k));
  }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { sc.keywords.push({ words: [], text: '', buttons: [] }); drawKws(); } }, icon('plus'), 'Добавить ответ на слова'));
  drawCmds(); drawKws();
  body.append(
    h('div', { class: 'bb-top' }, sw('enabled', 'Конструктор включён — бот отвечает сам'), sw('groups', 'Отвечать и в группах')),
    h('div', { class: 'bb-vars' }, '💡 ', VARS_HINT),
    section('👋', 'Приветствие', 'Когда человек нажимает «Начать» (/start)', replyEditor(sc.welcome, 'Привет, {first}!')),
    section('⌨️', 'Команды', 'Появятся в меню «/» в чате с ботом', cmdBox),
    section('💬', 'Ответы на слова', 'Если в сообщении есть одно из слов', kwBox),
    section('🤷', 'Если бот не понял', 'Только в личном чате. Оставьте пустым, чтобы молчать', replyEditor(sc.fallback, 'Не понял 🤔 Напишите /help')));
  openModal({
    title: `Конструктор · @${bot.user.username}`, className: 'modal-bots bb-modal', body,
    actions: [
      { label: 'Проверить в чате', onClick: async () => { if (await save()) openChat?.(bot.user.id); } },
      { label: 'Сохранить', primary: true, onClick: async (close) => { if (await save()) close(); } },
    ],
  });
  async function save() {
    try {
      await api.put(`/bots/${bot.user.id}/script`, { script: sc });
      toast('Бот сохранён ✅');
      return true;
    } catch (e) { toast(errorText(e), 'error'); return false; }
  }
}
