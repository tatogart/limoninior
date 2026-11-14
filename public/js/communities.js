// Communities (like Discord servers): one entry in the chat list that opens a list of its channels —
// text chats (#), announcement channels (📢) and voice rooms (🔊). Channels are ordinary chats.
import { api, errorText } from './api.js';
import { h, icon, avatar, toast, openModal, closeTopModal, confirmDialog, contextMenu, isTouch, plural, listTime, nameWithBadge, afterHistory, goBack } from './ui.js';

export const communities = new Map();
let openId = null;
let d = null; // app hooks

export function initCommunities(deps) { d = deps; }
export const openCommunityId = () => openId;
export const communityOf = (c) => (c?.communityId ? communities.get(c.communityId) || null : null);
export const communityLink = (cm) => (cm.inviteToken ? `${location.origin}/community/${cm.inviteToken}` : null);
const isStaff = (cm) => cm?.role === 'owner' || cm?.role === 'admin';
const membersText = (n) => `${n} ${plural(n, 'участник', 'участника', 'участников')}`;
const KIND_ICON = { text: 'hash', news: 'megaphone', voice: 'headphones' };
const KIND_NAME = { text: 'Текстовый чат', news: 'Канал объявлений', voice: 'Голосовая комната' };

export function setCommunities(list) {
  communities.clear();
  for (const cm of list) communities.set(cm.id, cm);
  if (openId && !communities.has(openId)) openId = null;
}
export function upsertCommunity(cm) { communities.set(cm.id, cm); }
export function removeCommunity(id) {
  communities.delete(id);
  if (openId === id) closeCommunity({ quiet: true });
}

/** Chats of the community in display order (only those that already arrived). */
export function channelsOf(cm) {
  return cm.channels.map((ch) => d.S.chats.get(ch.id)).filter(Boolean);
}
export function communityUnread(cm) {
  return channelsOf(cm).reduce((n, c) => n + (c.muted ? 0 : c.unread || 0), 0);
}
/** Sort key for the chat list: the newest message in any of its channels. */
export function communityActivity(cm) {
  return channelsOf(cm).reduce((mx, c) => Math.max(mx, c.lastMessage?.id || 0), 0) || cm.createdAt / 1e9;
}

// ---------------------------------------------------------------- open / close

export function openCommunity(id) {
  if (!communities.has(id)) return;
  const was = openId;
  openId = id;
  d.renderChatList();
  if (was) return;
  afterHistory(() => {
    if (openId !== id) return;
    const st = history.state || {};
    if (st.community) history.replaceState({ ...st, community: id }, '', '/');
    else history.pushState({ community: id }, '', '/');
  });
}

export function closeCommunity({ fromHistory = false, quiet = false } = {}) {
  if (!openId) return;
  openId = null;
  d.renderChatList();
  if (fromHistory || quiet) return;
  const st = history.state || {};
  if (st.chat) history.replaceState({ chat: st.chat }, '', '/');
  else if (st.community) goBack();
}

// ---------------------------------------------------------------- chat list entry

export function communityItem(cm) {
  const chats = channelsOf(cm);
  const last = chats.filter((c) => c.lastMessage).sort((a, b) => b.lastMessage.id - a.lastMessage.id)[0];
  const lm = last?.lastMessage;
  const unread = communityUnread(cm);
  const allMuted = chats.length && chats.every((c) => c.muted);
  const live = chats.find((c) => c.ckind === 'voice' && c.groupCall);
  let preview;
  if (live) preview = h('span', { class: 'accent' }, `🎧 ${live.title}: ${live.groupCall.count} в комнате`);
  else if (!lm) preview = h('span', { class: 'muted' }, 'Нет сообщений');
  else {
    const who = lm.kind === 'system' || last.type === 'channel' ? null : lm.senderId === d.S.me.id ? 'Вы' : d.userName(lm.senderId).split(' ')[0];
    preview = [h('span', { class: 'preview-who' }, `#${last.title}${who ? ` · ${who}` : ''}: `), d.messagePreview(lm)];
  }
  return h('button', {
    class: 'chat-item community-item',
    onclick: () => openCommunity(cm.id),
    oncontextmenu: (e) => { e.preventDefault(); communityMenu(cm, e.clientX, e.clientY); },
  },
  communityAvatar(cm, 54),
  h('div', { class: 'chat-item-body' },
    h('div', { class: 'chat-item-top' },
      h('span', { class: 'chat-item-title' }, icon('community', 'title-ic'), h('span', { class: 'ellipsis' }, cm.title), allMuted ? icon('mute', 'mute-ic') : null),
      h('span', { class: 'chat-item-time' }, lm ? listTime(lm.createdAt) : '')),
    h('div', { class: 'chat-item-bottom' },
      h('span', { class: 'chat-item-preview' }, preview),
      unread ? h('span', { class: 'badge' }, unread > 999 ? '999+' : unread) : null)));
}

export function communityAvatar(cm, size) {
  const a = avatar({ id: cm.id + 7, name: cm.title, src: cm.avatar }, size);
  a.classList.add('community-ava');
  return a;
}

// ---------------------------------------------------------------- sidebar view

export function communityView() {
  const cm = communities.get(openId);
  if (!cm) return h('div');
  const groups = [
    ['news', 'Объявления'],
    ['text', 'Текстовые чаты'],
    ['voice', 'Голосовые комнаты'],
  ];
  const byKind = (k) => cm.channels.filter((ch) => (ch.kind || 'text') === k);
  return h('div', { class: 'cm-view' },
    h('div', { class: 'cm-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Назад к чатам', onclick: () => closeCommunity() }, icon('back')),
      h('button', { class: 'cm-head-info', onclick: () => communityInfoModal(cm) },
        communityAvatar(cm, 40),
        h('div', { class: 'grow' }, h('div', { class: 'cm-title ellipsis' }, cm.title), h('div', { class: 'cm-sub' }, membersText(cm.membersCount)))),
      h('button', { class: 'icon-btn', 'aria-label': 'Пригласить', title: 'Пригласить', onclick: () => inviteModal(cm) }, icon('plus')),
      h('button', { class: 'icon-btn', 'aria-label': 'Меню сообщества', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); communityMenu(cm, r.right - 230, r.bottom + 4); } }, icon('more'))),
    h('div', { class: 'cm-channels' },
      ...groups.flatMap(([k, label]) => {
        const list = byKind(k);
        if (!list.length && !isStaff(cm)) return [];
        return [
          h('div', { class: 'cm-group' }, h('span', {}, label),
            isStaff(cm) ? h('button', { class: 'cm-group-add', 'aria-label': `Создать: ${label}`, title: 'Создать', onclick: () => newChannelModal(cm, k) }, icon('plus')) : null),
          ...list.map((ch) => channelRow(cm, ch)),
        ];
      })));
}

function channelRow(cm, ch) {
  const c = d.S.chats.get(ch.id);
  const kind = ch.kind || 'text';
  const unread = c && !c.muted ? c.unread : 0;
  const call = kind === 'voice' ? c?.groupCall : null;
  const inside = call && d.currentRoomId() === call.roomId;
  const row = h('button', {
    class: `cm-ch ${d.S.current === ch.id ? 'active' : ''} ${unread ? 'unread' : ''} ${c?.muted ? 'muted' : ''}`,
    onclick: () => openChannel(cm, ch),
    oncontextmenu: (e) => { e.preventDefault(); channelMenu(cm, ch, e.clientX, e.clientY); },
  },
  icon(KIND_ICON[kind] || 'hash', 'cm-ch-ic'),
  h('span', { class: 'cm-ch-name ellipsis' }, ch.title),
  c?.muted ? icon('mute', 'mute-ic') : null,
  kind === 'voice' && call ? h('span', { class: `pill ${inside ? '' : 'live-pill'}` }, inside ? 'вы здесь' : `${call.count}`) : null,
  unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null);
  if (!call?.users?.length) return row;
  call.users.forEach(d.ensureUser);
  return h('div', { class: 'cm-voice' }, row,
    h('div', { class: 'cm-voice-users' }, call.users.map((id) => {
      const u = id === d.S.me.id ? d.S.me : d.S.users.get(id) || { id, name: '…' };
      return h('div', { class: 'cm-voice-user' }, avatar(u, 22), h('span', { class: 'ellipsis' }, u.name));
    })));
}

function openChannel(cm, ch) {
  const c = d.S.chats.get(ch.id);
  if (!c) return toast('Канал ещё загружается…');
  d.openChat(c.id);
  if ((ch.kind || 'text') === 'voice') d.joinVoice(c);
}

// ---------------------------------------------------------------- menus

function communityMenu(cm, x, y) {
  const chats = channelsOf(cm);
  const allMuted = chats.length && chats.every((c) => c.muted);
  contextMenu(x, y, [
    { icon: 'info', label: 'О сообществе', onClick: () => communityInfoModal(cm) },
    { icon: 'plus', label: 'Пригласить друзей', onClick: () => inviteModal(cm) },
    { icon: 'group', label: 'Участники', onClick: () => membersModal(cm) },
    isStaff(cm) ? { icon: 'hash', label: 'Создать канал', onClick: () => newChannelModal(cm, 'text') } : null,
    isStaff(cm) ? { icon: 'settings', label: 'Настройки', onClick: () => settingsModal(cm) } : null,
    { icon: allMuted ? 'bell' : 'mute', label: allMuted ? 'Включить уведомления' : 'Выключить уведомления', onClick: () => muteAll(cm, !allMuted) },
    { icon: 'leave', label: 'Покинуть сообщество', danger: true, onClick: () => leave(cm) },
  ]);
}

function channelMenu(cm, ch, x, y) {
  const c = d.S.chats.get(ch.id);
  const i = cm.channels.findIndex((x2) => x2.id === ch.id);
  contextMenu(x, y, [
    c ? { icon: c.muted ? 'bell' : 'mute', label: c.muted ? 'Включить уведомления' : 'Выключить уведомления', onClick: () => d.toggleMute(c) } : null,
    isStaff(cm) ? { icon: 'edit', label: 'Переименовать', onClick: () => renameChannel(cm, ch) } : null,
    isStaff(cm) && i > 0 ? { icon: 'up', label: 'Выше', onClick: () => move(cm, i, -1) } : null,
    isStaff(cm) && i < cm.channels.length - 1 ? { icon: 'down', label: 'Ниже', onClick: () => move(cm, i, 1) } : null,
    isStaff(cm) && cm.channels.length > 1 ? { icon: 'trash', label: 'Удалить канал', danger: true, onClick: () => deleteChannel(cm, ch) } : null,
  ]);
}

async function muteAll(cm, muted) {
  try {
    for (const c of channelsOf(cm)) if (!!c.muted !== muted) d.upsertChat((await api.post(`/chats/${c.id}/mute`, { muted })).chat);
    d.renderChatList();
    d.updateBadge();
    toast(muted ? 'Уведомления сообщества выключены 🔕' : 'Уведомления сообщества включены 🔔');
  } catch (e) { toast(errorText(e), 'error'); }
}

const apply = (r) => { if (r?.community) { upsertCommunity(r.community); d.renderChatList(); } return r?.community; };

async function move(cm, i, dir) {
  const ids = cm.channels.map((x) => x.id);
  [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
  try { apply(await api.post(`/communities/${cm.id}/channels/order`, { ids })); } catch (e) { toast(errorText(e), 'error'); }
}

function renameChannel(cm, ch) {
  const input = h('input', { class: 'input', value: ch.title, maxLength: 48 });
  openModal({
    title: 'Название канала',
    className: 'modal-small',
    body: input,
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try { apply(await api.patch(`/communities/${cm.id}/channels/${ch.id}`, { title: input.value })); close(); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => input.select(), 50);
}

async function deleteChannel(cm, ch) {
  if (!(await confirmDialog(`Удалить канал «${ch.title}» со всей перепиской?`, { ok: 'Удалить', danger: true }))) return;
  try { apply(await api.del(`/communities/${cm.id}/channels/${ch.id}`)); toast('Канал удалён'); } catch (e) { toast(errorText(e), 'error'); }
}

async function leave(cm) {
  const text = cm.role === 'owner'
    ? `Покинуть «${cm.title}»? Сообщество перейдёт к админу или самому давнему участнику.`
    : `Покинуть сообщество «${cm.title}»?`;
  if (!(await confirmDialog(text, { ok: 'Покинуть', danger: true }))) return;
  try {
    await api.post(`/communities/${cm.id}/leave`);
    while (closeTopModal()) { /* close all */ }
    d.dropCommunity(cm.id);
    toast('Вы покинули сообщество');
  } catch (e) { toast(errorText(e), 'error'); }
}

// ---------------------------------------------------------------- modals

const KIND_CHOICES = [
  ['text', 'hash', 'Текстовый чат', 'Пишут все участники'],
  ['news', 'megaphone', 'Объявления', 'Пишут только админы, остальные читают и реагируют'],
  ['voice', 'headphones', 'Голосовая комната', 'Заходите и общайтесь голосом или с видео, до 8 человек'],
];

function kindPicker(initial) {
  let value = initial;
  const wrap = h('div', { class: 'cm-kinds' });
  const render = () => wrap.replaceChildren(...KIND_CHOICES.map(([k, ic, title, sub]) => h('button', {
    class: `cm-kind ${value === k ? 'on' : ''}`, type: 'button', onclick: () => { value = k; render(); },
  }, icon(ic), h('div', {}, h('b', {}, title), h('span', {}, sub)))));
  render();
  return { wrap, get: () => value };
}

export function newChannelModal(cm, kind = 'text') {
  const picker = kindPicker(kind);
  const title = h('input', { class: 'input', maxLength: 48, placeholder: 'Например: мемы' });
  openModal({
    title: 'Новый канал',
    className: 'modal-small',
    body: h('div', { class: 'stack' }, picker.wrap, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Название'), title)),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать', primary: true, onClick: async (close, btn) => {
        if (!title.value.trim()) { title.focus(); return; }
        if (btn) btn.disabled = true;
        try {
          const r = await api.post(`/communities/${cm.id}/channels`, { title: title.value.trim(), kind: picker.get() });
          d.upsertChat(r.chat);
          apply(r);
          close();
          if (picker.get() !== 'voice') d.openChat(r.chat.id);
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => title.focus(), 50);
}

export function newCommunityModal() {
  const title = h('input', { class: 'input', maxLength: 64, placeholder: 'Название, например: Лимонный клуб' });
  const desc = h('textarea', { class: 'input', rows: 2, maxLength: 255, placeholder: 'О чём сообщество (необязательно)' });
  openModal({
    title: 'Новое сообщество',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('div', { class: 'cm-hero' }, h('div', { class: 'cm-hero-ic' }, icon('community')),
        h('div', {}, h('b', {}, 'Как сервер в Discord'), h('span', {}, 'Несколько чатов, канал объявлений и голосовая комната — под одной ссылкой-приглашением.'))),
      title, desc),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать', primary: true, onClick: async (close, btn) => {
        if (!title.value.trim()) { title.focus(); return; }
        if (btn) btn.disabled = true;
        try {
          const r = await api.post('/communities', { title: title.value.trim(), description: desc.value.trim() });
          r.chats.forEach(d.upsertChat);
          upsertCommunity(r.community);
          close();
          openCommunity(r.community.id);
          inviteModal(r.community, true);
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => title.focus(), 50);
}

export function inviteModal(cm, fresh = false) {
  const link = communityLink(cm);
  openModal({
    title: fresh ? 'Сообщество создано 🎉' : 'Пригласить друзей',
    className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('p', { class: 'small' }, fresh
        ? 'Мы сделали три канала: объявления, общий чат и голосовую комнату. Отправьте ссылку друзьям — по ней они вступят в сообщество.'
        : 'Отправьте ссылку — по ней можно вступить в сообщество.'),
      link ? h('button', { class: 'ref-link mono-link', onclick: () => d.copyText(link) }, h('span', { class: 'ellipsis' }, link), icon('copy')) : null,
      h('div', { class: 'ref-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => d.shareLink(link, cm.title) }, icon('share'), 'Поделиться'))),
  });
}

export async function communityInfoModal(cm) {
  const staff = isStaff(cm);
  openModal({
    title: 'Сообщество',
    className: 'modal-profile',
    body: h('div', { class: 'profile' },
      h('div', { class: 'profile-hero' }, communityAvatar(cm, 110),
        h('div', { class: 'profile-name' }, cm.title),
        h('div', { class: 'profile-status' }, `${membersText(cm.membersCount)} · ${cm.channels.length} ${plural(cm.channels.length, 'канал', 'канала', 'каналов')}`)),
      cm.description ? h('div', { class: 'profile-rows' }, h('div', { class: 'profile-row' }, icon('info'),
        h('div', {}, h('div', { class: 'row-main pre' }, cm.description), h('div', { class: 'row-sub' }, 'Описание')))) : null,
      h('div', { class: 'profile-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => inviteModal(cm) }, icon('plus'), 'Пригласить'),
        h('button', { class: 'btn btn-ghost', onclick: () => membersModal(cm) }, icon('group'), 'Участники'),
        staff ? h('button', { class: 'btn btn-ghost', onclick: () => { closeTopModal(); settingsModal(cm); } }, icon('settings'), 'Настройки') : null),
      h('div', { class: 'settings-label' }, 'Каналы'),
      h('div', { class: 'cm-info-channels' }, cm.channels.map((ch) => h('button', {
        class: 'cm-ch', onclick: () => { while (closeTopModal()) { /* close all */ } openCommunity(cm.id); openChannel(cm, ch); },
      }, icon(KIND_ICON[ch.kind] || 'hash', 'cm-ch-ic'), h('span', { class: 'cm-ch-name ellipsis' }, ch.title), h('span', { class: 'muted small' }, KIND_NAME[ch.kind] || '')))),
      h('button', { class: 'btn btn-danger-ghost btn-block', onclick: () => leave(cm) }, icon('leave'), 'Покинуть сообщество')),
  });
}

export function membersModal(cm) {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск участников' });
  const head = h('div', { class: 'muted small' });
  const list = h('div', { class: 'fwd-list' }, h('span', { class: 'spinner' }));
  const roleLabel = { owner: 'владелец', admin: 'админ' };
  let t = null;
  const load = async () => {
    try {
      const r = await api.get(`/communities/${cm.id}/members?q=${encodeURIComponent(search.value.trim())}`);
      head.textContent = `Всего: ${membersText(r.total)}`;
      list.replaceChildren(...(r.members.length ? r.members.map((u) => {
        d.mergeUser(u);
        const canManage = u.id !== d.S.me.id && (cm.role === 'owner' || (cm.role === 'admin' && u.role === 'member'));
        return h('div', { class: 'fwd-item static' },
          h('button', { class: 'sub-who', onclick: () => d.openUserProfile(u.id) }, d.userAvatar(u, 42, true),
            h('div', { class: 'grow' }, h('div', { class: 'row-main' }, nameWithBadge(u.name, u)), h('div', { class: 'row-sub' }, `@${u.username}`))),
          roleLabel[u.role] ? h('span', { class: `pill ${u.role === 'owner' ? 'gold' : ''}` }, roleLabel[u.role]) : null,
          canManage ? h('button', { class: 'icon-btn', 'aria-label': 'Действия', onclick: (e) => {
            const rc = e.currentTarget.getBoundingClientRect();
            contextMenu(rc.right - 230, rc.bottom + 4, [
              cm.role === 'owner' ? { icon: 'shield', label: u.role === 'admin' ? 'Снять админа' : 'Сделать админом', onClick: () => setRole(u, u.role === 'admin' ? 'member' : 'admin') } : null,
              { icon: 'leave', label: 'Исключить', danger: true, onClick: () => kick(u, false) },
              { icon: 'block', label: 'Исключить и запретить вход', danger: true, onClick: () => kick(u, true) },
            ]);
          } }, icon('more')) : null);
      }) : [h('div', { class: 'list-note' }, 'Никого не найдено')]));
    } catch (e) { list.replaceChildren(h('div', { class: 'list-note' }, errorText(e))); }
  };
  const setRole = async (u, role) => {
    try { await api.patch(`/communities/${cm.id}/members/${u.id}`, { role }); toast(role === 'admin' ? `${u.name} теперь админ` : `${u.name} больше не админ`); load(); } catch (e) { toast(errorText(e), 'error'); }
  };
  const kick = async (u, ban) => {
    if (!(await confirmDialog(ban ? `Исключить ${u.name} и запретить возвращаться по ссылке?` : `Исключить ${u.name} из сообщества?`, { ok: 'Исключить', danger: true }))) return;
    try { await api.del(`/communities/${cm.id}/members/${u.id}${ban ? '?ban=1' : ''}`); toast('Участник исключён'); load(); } catch (e) { toast(errorText(e), 'error'); }
  };
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  openModal({ title: 'Участники', body: h('div', { class: 'stack' }, search, head, list) });
  load();
}

export function settingsModal(cm) {
  const title = h('input', { class: 'input', maxLength: 64, value: cm.title });
  const desc = h('textarea', { class: 'input', rows: 3, maxLength: 255, placeholder: 'Описание' });
  desc.value = cm.description || '';
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const ava = h('button', { class: 'avatar-edit', type: 'button', onclick: () => fileIn.click() }, communityAvatar(cm, 96), h('span', { class: 'avatar-edit-overlay' }, icon('camera')));
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', await d.prepareImage(f, 640, true), 'avatar');
      const fresh = apply(await api.post(`/communities/${cm.id}/avatar`, fd));
      ava.firstChild.replaceWith(communityAvatar(fresh, 96));
    } catch (e) { toast(errorText(e), 'error'); }
  });
  openModal({
    title: 'Настройки сообщества',
    body: h('div', { class: 'stack' },
      h('div', { class: 'bot-head' }, ava, fileIn),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Название'), title),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Описание'), desc),
      h('div', { class: 'muted small' }, 'Каналы: создавайте кнопкой «+» у разделов, а переименовать, переставить или удалить канал можно правой кнопкой мыши или долгим нажатием на него.'),
      h('div', { class: 'bot-acts' },
        h('button', { class: 'btn btn-ghost', onclick: async () => {
          if (!(await confirmDialog('Сделать новую ссылку-приглашение? Старая перестанет работать, участники останутся.', { ok: 'Сбросить', danger: true }))) return;
          try { const fresh = apply(await api.post(`/communities/${cm.id}/invite-reset`)); d.copyText(communityLink(fresh)); } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('refresh'), 'Новая ссылка'),
        cm.role === 'owner' ? h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog(`Удалить сообщество «${cm.title}» со всеми каналами и перепиской? Это нельзя отменить.`, { ok: 'Удалить навсегда', danger: true }))) return;
          try { await api.del(`/communities/${cm.id}`); while (closeTopModal()) { /* close all */ } d.dropCommunity(cm.id); toast('Сообщество удалено'); } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('trash'), 'Удалить сообщество') : null)),
    actions: [
      { label: 'Закрыть', onClick: (c) => c() },
      { label: 'Сохранить', primary: true, onClick: async (close) => {
        try { apply(await api.patch(`/communities/${cm.id}`, { title: title.value, description: desc.value })); close(); toast('Сохранено'); } catch (e) { toast(errorText(e), 'error'); }
      } },
    ],
  });
}

/** /community/<token> link: preview and join. */
export async function openCommunityInvite(token) {
  let cm;
  try { cm = (await api.get(`/communities/invite/${encodeURIComponent(token)}`)).community; } catch { return toast('Ссылка-приглашение недействительна или устарела', 'error'); }
  if (cm.joined && communities.has(cm.id)) return openCommunity(cm.id);
  openModal({
    title: 'Приглашение',
    className: 'modal-profile',
    body: h('div', { class: 'profile' },
      h('div', { class: 'profile-hero' }, communityAvatar(cm, 110),
        h('div', { class: 'profile-name' }, cm.title),
        h('div', { class: 'profile-status' }, `Сообщество · ${membersText(cm.membersCount)} · ${cm.channelsCount} ${plural(cm.channelsCount, 'канал', 'канала', 'каналов')}`)),
      cm.description ? h('div', { class: 'profile-rows' }, h('div', { class: 'profile-row' }, icon('info'),
        h('div', {}, h('div', { class: 'row-main pre' }, cm.description), h('div', { class: 'row-sub' }, 'Описание')))) : null,
      h('button', { class: 'btn btn-primary btn-block', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const r = await api.post(`/communities/invite/${encodeURIComponent(token)}/join`);
          r.chats.forEach(d.upsertChat);
          upsertCommunity(r.community);
          closeTopModal();
          openCommunity(r.community.id);
          toast(`Добро пожаловать в «${r.community.title}» 🎉`);
        } catch (err) { btn.disabled = false; toast(errorText(err), 'error'); }
      } }, icon('plus'), 'Вступить')),
  });
}
