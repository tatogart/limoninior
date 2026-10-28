// Anonymous messages: a "ask me anything" card in profiles, the inbox with answers, and what you sent.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, confirmDialog, isTouch } from './ui.js';

export const STYLES = {
  lemon: { name: 'Лимон', emoji: '🍋' },
  love: { name: 'Любовь', emoji: '💘' },
  night: { name: 'Ночь', emoji: '🌙' },
  fire: { name: 'Огонь', emoji: '🔥' },
  mint: { name: 'Мята', emoji: '🌿' },
  sky: { name: 'Небо', emoji: '☁️' },
};
const IDEAS = ['Что ты обо мне думаешь на самом деле? 👀', 'Какая у тебя самая странная привычка?', 'Ты мне нравишься 🙈', 'Посоветуй музыку 🎧', 'Какой твой самый смелый поступок?', 'Что бы ты сделал(а) с миллионом? 💸'];

let deps = null; // { reportModal(type, id, title), onUnread(n) }
export function initAnon(d) { deps = d; }

const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The NGL-style card in someone's profile. */
export function anonCard(u) {
  if (!u?.px?.anon) return null;
  return h('button', { class: 'anon-card', onclick: () => anonSendModal(u) },
    h('span', { class: 'anon-card-mask' }, '🎭'),
    h('div', { class: 'grow' }, h('b', {}, 'Напиши анонимно'), h('span', {}, `${u.name.split(' ')[0]} не узнает, что это вы`)),
    icon('send'));
}

export function anonSendModal(u) {
  let style = 'lemon';
  const ta = h('textarea', { class: 'anon-input', rows: 4, maxLength: 1000, placeholder: 'Напишите что угодно — имя не покажем…' });
  const paper = h('div', { class: `anon-paper st-${style}` }, h('div', { class: 'anon-paper-head' }, '🎭 Анонимно для ', h('b', {}, u.name)), ta);
  const styles = h('div', { class: 'anon-styles' });
  const drawStyles = () => styles.replaceChildren(...Object.entries(STYLES).map(([k, v]) => h('button', { type: 'button', class: `anon-style st-${k} ${style === k ? 'on' : ''}`, title: v.name, onclick: () => { style = k; paper.className = `anon-paper st-${k}`; drawStyles(); } }, v.emoji)));
  drawStyles();
  const idea = h('button', { type: 'button', class: 'link-btn sm', onclick: () => { ta.value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; ta.focus(); } }, '🎲 Подсказать идею');
  openModal({
    title: 'Анонимное послание', className: 'modal-small anon-modal',
    body: h('div', { class: 'stack' }, paper, h('div', { class: 'anon-row' }, styles, idea),
      h('p', { class: 'muted small' }, '🔒 Получатель не увидит, кто вы. Но модераторы видят автора, если на послание пожалуются — пишите по-доброму.')),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Отправить анонимно', primary: true, onClick: async (close, btn) => {
        if (!ta.value.trim()) return toast('Напишите что-нибудь');
        if (btn) btn.disabled = true;
        try { await api.post(`/users/${u.id}/anon`, { text: ta.value, style }); close(); toast('🎭 Отправлено анонимно'); } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => ta.focus(), 60);
}

function replyModal(item, done) {
  const ta = h('textarea', { class: 'input', rows: 3, maxLength: 1000, placeholder: 'Ваш ответ — автор послания его увидит' });
  ta.value = item.reply || '';
  openModal({
    title: 'Ответить', className: 'modal-small',
    body: h('div', { class: 'stack' }, h('div', { class: `anon-paper small st-${item.style}` }, h('div', { class: 'anon-text' }, item.text)), ta),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Ответить', primary: true, onClick: async (close) => {
        try { await api.post(`/anon/${item.id}/reply`, { text: ta.value }); close(); toast('Ответ отправлен'); done?.(); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => ta.focus(), 60);
}

/** Inbox (received) + sent, with the "accept anonymous messages" switch. */
export async function anonInbox(tab = 'in') {
  const body = h('div', { class: 'anon-inbox' });
  let open = true;
  const render = async () => {
    body.replaceChildren(h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
    let items = [];
    try {
      if (tab === 'in') { const r = await api.get('/anon/inbox'); items = r.items; open = r.open; api.post('/anon/read').catch(() => {}); deps?.onUnread?.(0); }
      else items = (await api.get('/anon/sent')).items;
    } catch (e) { body.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); return; }
    const sw = h('span', { class: `switch ${open ? 'on' : ''}` });
    body.replaceChildren(...[
      h('div', { class: 'segmented anon-tabs' },
        h('button', { class: tab === 'in' ? 'on' : '', onclick: () => { tab = 'in'; render(); } }, 'Входящие'),
        h('button', { class: tab === 'out' ? 'on' : '', onclick: () => { tab = 'out'; render(); } }, 'Отправленные')),
      tab === 'in' ? h('button', { class: 'set-row clickable anon-open-row', onclick: async () => {
        try { open = (await api.patch('/me/anon', { open: !open })).open; sw.classList.toggle('on', open); toast(open ? 'Анонимные послания включены' : 'Больше никто не сможет писать вам анонимно'); } catch (e) { toast(errorText(e), 'error'); }
      } }, h('div', { class: 'set-text' }, h('div', { class: 'row-main' }, 'Принимать анонимные послания'), h('div', { class: 'row-sub' }, 'В профиле появится кнопка «Напиши мне анонимно»')), sw) : null,
      items.length ? null : h('div', { class: 'anon-empty' }, h('div', {}, '🎭'), tab === 'in'
        ? 'Пока никто не писал. Поделитесь ссылкой на профиль — друзья смогут написать вам анонимно!'
        : 'Вы ещё никому не писали анонимно. Откройте профиль друга и нажмите «Напиши анонимно».'),
      ...items.map((it) => h('div', { class: `anon-paper st-${it.style} ${!it.read && tab === 'in' ? 'new' : ''}` },
        h('div', { class: 'anon-paper-head' }, tab === 'in' ? '🎭 Аноним' : h('span', {}, '🎭 Вы → ', h('b', {}, it.to?.name || 'удалённый аккаунт')), h('span', { class: 'anon-when' }, when(it.at))),
        h('div', { class: 'anon-text' }, it.text),
        it.reply ? h('div', { class: 'anon-reply' }, h('b', {}, tab === 'in' ? 'Ваш ответ' : 'Ответ'), it.reply) : null,
        h('div', { class: 'anon-acts' }, ...(tab === 'in' ? [
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => replyModal(it, render) }, it.reply ? 'Изменить ответ' : 'Ответить'),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Ещё', onclick: (e) => menu(e, it) }, icon('more')),
        ] : [h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api.del(`/anon/${it.id}`).catch(() => {}); render(); } }, 'Скрыть')])))),
    ].filter(Boolean));
  };
  const menu = async (e, it) => {
    const choice = await new Promise((resolve) => {
      const m = openModal({ className: 'modal-small', title: 'Послание', body: h('div', { class: 'stack' },
        h('button', { class: 'btn btn-ghost btn-block', onclick: () => { resolve('hide'); m.close(); } }, icon('trash'), 'Удалить'),
        h('button', { class: 'btn btn-ghost btn-block', onclick: () => { resolve('block'); m.close(); } }, icon('block'), 'Заблокировать этого анонима'),
        h('button', { class: 'btn btn-danger-ghost btn-block', onclick: () => { resolve('report'); m.close(); } }, icon('warning'), 'Пожаловаться')), onClose: () => resolve(null) });
    });
    if (choice === 'hide') { await api.del(`/anon/${it.id}`).catch(() => {}); render(); }
    if (choice === 'block' && await confirmDialog('Этот человек больше не сможет писать вам анонимно. Кто это — вы так и не узнаете.', { ok: 'Заблокировать', danger: true })) {
      try { await api.post(`/anon/${it.id}/block`); toast('Аноним заблокирован'); render(); } catch (err) { toast(errorText(err), 'error'); }
    }
    if (choice === 'report') deps?.reportModal?.('anon', it.id, 'Жалоба на анонимное послание');
  };
  openModal({ title: '🎭 Анонимные послания', className: 'modal-anon', body });
  render();
}
