// Profile 2.0 on the client: cover, emoji status, mood, links, birthday, city, interests,
// animated effect, profile track and the views counter.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, richText } from './ui.js';
import { EFFECTS, effectLayer } from './themes.js';
import { lookPicker } from './custom.js';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const STATUS_EMOJI = ['😎', '🔥', '🍋', '💚', '⭐', '👑', '🎮', '🎧', '📚', '💻', '🏀', '⚽', '🎨', '🎬', '✈️', '🌙', '☕', '🍕', '🐱', '🐶', '🦊', '🐼', '🦄', '🌸', '🌈', '⚡', '💎', '🚀', '🎵', '❤️', '💜', '💙', '🤍', '🖤', '😴', '🤒', '🏖️', '🎉', '💪', '🧠'];

const isBirthday = (b) => { if (!b) return false; const d = new Date(); return d.getDate() === b.d && d.getMonth() + 1 === b.m; };
export const bdayToday = (u) => isBirthday(u?.px?.bday);

/** Small decorations next to a name: emoji status and a cake on the birthday. */
export function nameDecor(u) {
  const out = [];
  if (u?.px?.emoji) out.push(h('span', { class: 'emoji-status', title: u.px.mood || 'Статус' }, u.px.emoji));
  if (bdayToday(u)) out.push(h('span', { class: 'emoji-status bday', title: 'Сегодня день рождения!' }, '🎂'));
  return out;
}

/** Cover background for the profile hero (photo, own gradient, or the color preset). */
export function decorateCover(cover, u) {
  const px = u.px || {};
  if (px.cover) {
    cover.classList.add('has-photo');
    cover.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35)), url("${px.cover}")`;
  } else if (px.coverColors) {
    cover.classList.add('has-grad');
    cover.style.backgroundImage = `radial-gradient(120% 90% at 10% 0%, ${px.coverColors[0]}, transparent 70%), linear-gradient(135deg, ${px.coverColors[0]}, ${px.coverColors[1]})`;
  }
  if (px.effect && EFFECTS[px.effect]) cover.prepend(effectLayer(px.effect, 12));
}

const ageOf = (b) => {
  if (!b?.y) return 0;
  const d = new Date();
  let a = d.getFullYear() - b.y;
  if (d.getMonth() + 1 < b.m || (d.getMonth() + 1 === b.m && d.getDate() < b.d)) a--;
  return a;
};
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
export const bdayText = (b) => `${b.d} ${MONTHS[b.m - 1]}${b.showYear && b.y ? ` ${b.y} · ${ageOf(b)} ${plural(ageOf(b), 'год', 'года', 'лет')}` : ''}`;

// ---------------------------------------------------------------- profile track

const player = { audio: null, url: null, ui: null };
export function trackEl(track) {
  if (!track) return null;
  const btn = h('button', { class: 'pf-track-btn', 'aria-label': 'Слушать' }, icon('play'));
  const bar = h('i', { class: 'pf-track-bar' });
  const el = h('div', { class: 'pf-track' }, btn,
    h('div', { class: 'grow' }, h('div', { class: 'pf-track-name' }, '🎵 ', track.name), h('div', { class: 'pf-track-line' }, bar)),
    h('div', { class: 'pf-track-eq' }, h('i'), h('i'), h('i'), h('i')));
  const ui = (playing, frac) => { btn.replaceChildren(icon(playing ? 'pause' : 'play')); el.classList.toggle('playing', playing); bar.style.width = `${(frac || 0) * 100}%`; };
  btn.addEventListener('click', () => {
    if (player.url === track.url && player.audio) { if (player.audio.paused) player.audio.play().catch(() => {}); else player.audio.pause(); return; }
    player.audio?.pause();
    const a = new Audio(track.url);
    Object.assign(player, { audio: a, url: track.url, ui });
    const upd = () => player.audio === a && ui(!a.paused, a.duration ? a.currentTime / a.duration : 0);
    ['play', 'pause', 'timeupdate', 'ended'].forEach((ev) => a.addEventListener(ev, upd));
    a.play().catch(() => toast('Не удалось воспроизвести', 'error'));
  });
  return el;
}
export function stopTrack() { player.audio?.pause(); player.audio = null; player.url = null; }

// ---------------------------------------------------------------- what other people see

export function profileInfoRows(u) {
  const px = u.px || {};
  const rows = [];
  if (px.city) rows.push(h('div', { class: 'pf-row' }, h('span', { class: 'pf-row-emoji' }, '📍'), h('div', {}, h('div', { class: 'row-main' }, px.city), h('div', { class: 'row-sub' }, 'Город'))));
  if (px.bday) rows.push(h('div', { class: `pf-row ${bdayToday(u) ? 'pf-bday-today' : ''}` }, h('span', { class: 'pf-row-emoji' }, '🎂'),
    h('div', {}, h('div', { class: 'row-main' }, bdayToday(u) ? `Сегодня день рождения! 🎉` : bdayText(px.bday)), h('div', { class: 'row-sub' }, bdayToday(u) ? bdayText(px.bday) : 'День рождения'))));
  for (const l of px.links || []) {
    rows.push(h('a', { class: 'pf-row ext-link pf-link', href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, h('span', { class: 'pf-row-emoji' }, '🔗'),
      h('div', { class: 'grow' }, h('div', { class: 'row-main accent' }, l.title), h('div', { class: 'row-sub ellipsis' }, l.url.replace(/^https?:\/\//, '').replace(/\/$/, '')))));
  }
  return rows;
}

export function tagsEl(u) {
  const tags = u.px?.tags;
  if (!tags?.length) return null;
  return h('div', { class: 'pf-tags' }, tags.map((t) => h('span', { class: 'pf-tag' }, `#${t}`)));
}

export function moodEl(u) {
  return u.px?.mood ? h('div', { class: 'pf-mood' }, richText(u.px.mood)) : null;
}

// ---------------------------------------------------------------- editor (own profile)

let deps = null; // { me(), setMe(patch), prepareImage }
export function initProfileX(d) { deps = d; }

/** "Оформление профиля" block for the edit dialog. Returns { el, patch() }. */
export function profileEditor(me, onPreview) {
  const px = { ...(me.px || {}) };
  const state = {
    emoji: px.emoji || null, mood: px.mood || '', city: px.city || '', effect: px.effect || 'none',
    coverColors: px.coverColors || null, tags: (px.tags || []).join(', '),
    links: (px.links || []).map((l) => ({ ...l })),
    bday: px.bday ? { ...px.bday } : null,
    nameColor: px.nameColor || null, frame: px.frame || 'none',
  };
  const preview = () => onPreview?.({ ...px, emoji: state.emoji, mood: state.mood, effect: state.effect, coverColors: state.coverColors, nameColor: state.nameColor, frame: state.frame });

  const emojiBtn = h('button', { type: 'button', class: 'pf-emoji-pick' });
  const drawEmoji = () => emojiBtn.replaceChildren(state.emoji ? h('span', { class: 'pf-emoji-cur' }, state.emoji) : icon('smile'), h('span', {}, state.emoji ? 'Сменить эмодзи-статус' : 'Эмодзи-статус рядом с именем'));
  drawEmoji();
  emojiBtn.addEventListener('click', () => {
    const m = openModal({
      title: 'Эмодзи-статус', className: 'modal-small',
      body: h('div', { class: 'stack' },
        h('div', { class: 'pf-emoji-grid' }, STATUS_EMOJI.map((e) => h('button', { class: state.emoji === e ? 'on' : '', onclick: () => { state.emoji = e; drawEmoji(); preview(); m.close(); } }, e))),
        state.emoji ? h('button', { class: 'btn btn-ghost', onclick: () => { state.emoji = null; drawEmoji(); preview(); m.close(); } }, 'Убрать статус') : null),
    });
  });

  const input = (key, ph, max) => {
    const el = h('input', { class: 'input', placeholder: ph, maxLength: max, value: state[key] });
    el.addEventListener('input', () => { state[key] = el.value; if (key === 'mood') preview(); });
    return el;
  };

  // Cover: photo or gradient
  const coverIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const coverActs = h('div', { class: 'pf-cover-acts' });
  const c1 = h('input', { type: 'color', value: state.coverColors?.[0] || '#a3e635' });
  const c2 = h('input', { type: 'color', value: state.coverColors?.[1] || '#22d3ee' });
  const gradOn = () => { state.coverColors = [c1.value, c2.value]; preview(); drawCover(); };
  c1.addEventListener('input', gradOn); c2.addEventListener('input', gradOn);
  const drawCover = () => coverActs.replaceChildren(...[
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => coverIn.click() }, icon('image'), px.cover ? 'Другое фото' : 'Фото обложки'),
    px.cover ? h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: async () => {
      try { Object.assign(px, (await api.del('/me/cover')).px); delete px.cover; deps.setMe({ px: { ...px } }); preview(); drawCover(); } catch (e) { toast(errorText(e), 'error'); }
    } }, 'Убрать фото') : null,
    h('label', { class: 'pf-grad' }, c1, c2, h('span', {}, 'Градиент')),
    state.coverColors ? h('button', { type: 'button', class: 'link-btn sm', onclick: () => { state.coverColors = null; preview(); drawCover(); } }, 'Цвет по умолчанию') : null].filter(Boolean));
  drawCover();
  coverIn.addEventListener('change', async () => {
    const f = coverIn.files[0]; coverIn.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', await deps.prepareImage(f, 1280, false), 'cover');
      const r = await api.post('/me/cover', fd);
      px.cover = r.px.cover;
      deps.setMe({ px: r.px });
      preview(); drawCover();
      toast('Обложка обновлена');
    } catch (e) { toast(errorText(e), 'error'); }
  });

  // Effect chips
  const fx = h('div', { class: 'th-chips' });
  const drawFx = () => fx.replaceChildren(...Object.entries(EFFECTS).map(([k, v]) => h('button', { type: 'button', class: `rw-chip ${state.effect === k ? 'on' : ''}`, onclick: () => { state.effect = k; drawFx(); preview(); } }, v.name)));
  drawFx();

  // Birthday
  const bd = h('input', { class: 'input', type: 'date', max: new Date().toISOString().slice(0, 10) });
  if (state.bday) bd.value = `${state.bday.y || 2000}-${String(state.bday.m).padStart(2, '0')}-${String(state.bday.d).padStart(2, '0')}`;
  const showYear = h('input', { type: 'checkbox', checked: !!state.bday?.showYear });
  const readBd = () => {
    if (!bd.value) { state.bday = null; return; }
    const [y, m, d] = bd.value.split('-').map(Number);
    state.bday = { d, m, y, showYear: showYear.checked };
  };
  bd.addEventListener('change', readBd); showYear.addEventListener('change', readBd);

  // Links
  const linksBox = h('div', { class: 'pf-links-ed' });
  const drawLinks = () => linksBox.replaceChildren(...[
    ...state.links.map((l, i) => {
      const t = h('input', { class: 'input', placeholder: 'Название', maxLength: 30, value: l.title || '' });
      const u = h('input', { class: 'input', placeholder: 'https://…', maxLength: 300, value: l.url || '', inputMode: 'url', autocapitalize: 'off' });
      t.addEventListener('input', () => { l.title = t.value; });
      u.addEventListener('input', () => { l.url = u.value; });
      return h('div', { class: 'pf-link-row' }, t, u, h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Убрать', onclick: () => { state.links.splice(i, 1); drawLinks(); } }, icon('close')));
    }),
    state.links.length < 4 ? h('button', { type: 'button', class: 'link-btn sm', onclick: () => { state.links.push({ title: '', url: '' }); drawLinks(); } }, icon('plus'), 'Добавить ссылку') : null].filter(Boolean));
  drawLinks();

  // Track
  const trackIn = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.ogg,.wav', class: 'hidden' });
  const trackBox = h('div', { class: 'pf-track-ed' });
  const drawTrack = () => trackBox.replaceChildren(
    px.track ? trackEl(px.track) : h('div', { class: 'muted small' }, 'Песня, которую услышат в вашем профиле'),
    h('div', { class: 'pf-cover-acts' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => trackIn.click() }, icon('music'), px.track ? 'Заменить трек' : 'Загрузить трек'),
      px.track ? h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: async () => {
        try { await api.del('/me/track'); stopTrack(); delete px.track; deps.setMe({ px: { ...px } }); drawTrack(); } catch (e) { toast(errorText(e), 'error'); }
      } }, 'Убрать') : null));
  drawTrack();
  trackIn.addEventListener('change', async () => {
    const f = trackIn.files[0]; trackIn.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast('Файл больше 10 МБ', 'error');
    const dur = await new Promise((r) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => r(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => r(0);
      setTimeout(() => r(0), 3000);
      a.src = URL.createObjectURL(f);
    });
    try {
      const fd = new FormData();
      fd.append('file', f, f.name);
      fd.append('duration', String(Math.round(dur)));
      trackBox.classList.add('busy');
      const r = await api.post('/me/track', fd);
      px.track = r.px.track;
      deps.setMe({ px: r.px });
      drawTrack();
      toast('Трек профиля загружен 🎵');
    } catch (e) { toast(errorText(e), 'error'); }
    trackBox.classList.remove('busy');
  });

  const el = h('div', { class: 'pf-card pf-form pf-decor' },
    h('div', { class: 'pf-decor-title' }, '✨ Оформление профиля'),
    emojiBtn,
    lookPicker(state, () => preview(), me),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Настроение'), input('mood', 'Например: 🎮 играю в лаунчер', 60)),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Обложка'), coverActs, coverIn),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Эффект профиля'), fx),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Трек профиля'), trackBox, trackIn),
    h('div', { class: 'pf-two' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Город'), input('city', 'Москва', 40)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'День рождения'), bd, h('label', { class: 'th-check' }, showYear, 'Показывать год'))),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Интересы (через запятую)'), input('tags', 'игры, музыка, аниме', 200)),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Ссылки'), linksBox));

  const patch = () => ({
    emoji: state.emoji, mood: state.mood, city: state.city, effect: state.effect, coverColors: state.coverColors,
    tags: state.tags, links: state.links.filter((l) => l.url.trim()), bday: state.bday,
    nameColor: state.nameColor, frame: state.frame,
  });
  return { el, patch };
}
