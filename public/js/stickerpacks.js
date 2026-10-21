// Custom sticker packs: create from your own pictures, share by link, add packs of others.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, confirmDialog, isTouch } from './ui.js';

let packs = null; // my packs (created + added), null = not loaded yet
let loading = null;
let onChange = () => {};

export function initStickerPacks(o) { onChange = o.onChange || onChange; }

export async function loadMyPacks(force = false) {
  if (packs && !force) return packs;
  loading ||= api.get('/stickers/packs').then((r) => { packs = r.packs; return packs; }).finally(() => { loading = null; });
  return loading;
}
export const myPacks = () => packs || [];
export const packLink = (slug) => `${location.origin}/addstickers/${slug}`;

function upsert(p) {
  if (!packs) return;
  const i = packs.findIndex((x) => x.id === p.id);
  if (p.added || p.mine) { if (i >= 0) packs[i] = p; else packs.push(p); } else if (i >= 0) packs.splice(i, 1);
  onChange();
}

/** A sticker image as stored in a message (custom stickers carry their picture URL). */
export function customStickerNode(m, cls) {
  const x = m.extra || {};
  const fallback = () => h('div', { class: `${cls} sticker-missing` }, x.emoji || '🙂');
  if (!x.src) return fallback();
  const img = h('img', { class: `${cls} custom-sticker`, src: x.src, alt: x.emoji || 'Стикер', draggable: false, loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  if (x.pack) {
    img.addEventListener('click', (e) => { e.stopPropagation(); openPackPreview(x.pack); });
    img.style.cursor = 'pointer';
  }
  return img;
}

/** Section of the sticker panel with my custom packs. */
export function panelSections(send) {
  const out = [];
  for (const p of myPacks()) {
    out.push(h('div', { class: 'panel-title with-act' }, h('span', {}, p.title),
      h('button', { class: 'panel-act', 'aria-label': 'Настроить набор', onclick: () => (p.mine ? openPackManager(p) : openPackPreview(p.slug)) }, icon(p.mine ? 'edit' : 'more'))));
    out.push(p.stickers.length
      ? h('div', { class: 'sticker-grid' }, p.stickers.map((s) => h('button', { class: 'sticker-btn', onclick: () => send(s.id) },
        h('img', { class: 'panel-sticker', src: s.src, alt: s.emoji, loading: 'lazy', draggable: false }))))
      : h('button', { class: 'sticker-empty', onclick: () => openPackManager(p) }, icon('plus'), 'Добавьте первые стикеры'));
  }
  out.push(h('button', { class: 'sticker-new', onclick: newPackModal }, icon('plus'), 'Создать свой набор стикеров'));
  return out;
}

// ---------------------------------------------------------------- image prep

/** Fit into 512×512 keeping transparency (animated GIFs are kept as they are). */
async function prepareSticker(file) {
  if (file.type === 'image/gif') {
    if (file.size > 1024 * 1024) throw new Error('GIF больше 1 МБ');
    return file;
  }
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9));
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// ---------------------------------------------------------------- modals

export function newPackModal() {
  const title = h('input', { class: 'input', maxLength: 48, placeholder: 'Например: Мой кот' });
  openModal({
    title: 'Новый набор стикеров',
    className: 'modal-small',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Добавьте свои картинки (PNG с прозрачным фоном смотрятся лучше всего). Набором можно поделиться ссылкой.'), title),
    actions: [
      { label: 'Отмена', onClick: (c) => c() },
      { label: 'Создать', primary: true, onClick: async (close, btn) => {
        if (!title.value.trim()) { title.focus(); return; }
        if (btn) btn.disabled = true;
        try {
          const { pack } = await api.post('/stickers/packs', { title: title.value.trim() });
          upsert(pack);
          close();
          openPackManager(pack);
        } catch (e) { toast(errorText(e), 'error'); if (btn) btn.disabled = false; }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => title.focus(), 50);
}

export function openPackManager(pack) {
  let p = pack;
  const grid = h('div', { class: 'sm-grid' });
  const count = h('span', { class: 'muted small' });
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/webp,image/jpeg,image/gif', multiple: true, class: 'hidden' });
  const emojiIn = h('input', { class: 'input sm-emoji', maxLength: 8, value: '🙂', 'aria-label': 'Эмодзи для новых стикеров' });
  const titleIn = h('input', { class: 'input', maxLength: 48, value: p.title });
  const render = () => {
    count.textContent = `${p.stickers.length} из 120`;
    grid.replaceChildren(...p.stickers.map((s) => h('div', { class: 'sm-item' },
      h('img', { src: s.src, alt: s.emoji, loading: 'lazy' }),
      h('span', { class: 'sm-item-emoji' }, s.emoji),
      h('button', { class: 'sm-del', 'aria-label': 'Удалить стикер', onclick: async () => {
        try { p = (await api.del(`/stickers/${s.id}`)).pack; upsert(p); render(); } catch (e) { toast(errorText(e), 'error'); }
      } }, icon('close')))),
    h('button', { class: 'sm-add', onclick: () => fileIn.click() }, icon('plus'), h('span', {}, 'Добавить')));
  };
  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files].slice(0, 30);
    fileIn.value = '';
    for (const f of files) {
      try {
        const blob = await prepareSticker(f);
        const fd = new FormData();
        fd.append('emoji', emojiIn.value.trim() || '🙂');
        fd.append('file', blob, 'sticker');
        p = (await api.post(`/stickers/packs/${p.id}/stickers`, fd)).pack;
        upsert(p);
        render();
      } catch (e) { toast(e.code ? errorText(e) : `${f.name}: ${e.message || 'не удалось добавить'}`, 'error'); }
    }
  });
  titleIn.addEventListener('change', async () => {
    try { p = (await api.patch(`/stickers/packs/${p.id}`, { title: titleIn.value })).pack; upsert(p); } catch (e) { toast(errorText(e), 'error'); }
  });
  render();
  const m = openModal({
    title: 'Мой набор стикеров',
    className: 'modal-stickers',
    body: h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Название'), titleIn),
      h('div', { class: 'sm-row' }, h('span', { class: 'small' }, 'Эмодзи для новых:'), emojiIn, count),
      grid, fileIn,
      h('div', { class: 'ref-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => share(p) }, icon('share'), 'Поделиться'),
        h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog(`Удалить набор «${p.title}»? Он пропадёт у всех, кто его добавил.`, { ok: 'Удалить', danger: true }))) return;
          try { await api.del(`/stickers/packs/${p.id}`); packs = packs?.filter((x) => x.id !== p.id) || null; onChange(); m.close(); toast('Набор удалён'); } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('trash'), 'Удалить набор'))),
  });
}

async function share(p) {
  const link = packLink(p.slug);
  if (navigator.share) { try { await navigator.share({ title: p.title, url: link }); return; } catch { /* cancelled */ } }
  try { await navigator.clipboard.writeText(link); toast('Ссылка на набор скопирована'); } catch { toast(link); }
}

export async function openPackPreview(slug) {
  let pack;
  try { pack = (await api.get(`/stickers/by/${encodeURIComponent(slug)}`)).pack; } catch { return toast('Набор стикеров не найден', 'error'); }
  const action = h('div', { class: 'ref-actions' });
  let m;
  const renderAction = () => action.replaceChildren(
    h('button', { class: 'btn btn-ghost', onclick: () => share(pack) }, icon('share'), 'Поделиться'),
    pack.mine
      ? h('button', { class: 'btn btn-primary', onclick: () => { m.close(); openPackManager(pack); } }, icon('edit'), 'Изменить')
      : pack.added
        ? h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
          try { await api.post(`/stickers/packs/${pack.id}/remove`); pack.added = false; upsert(pack); renderAction(); toast('Набор убран из ваших'); } catch (e) { toast(errorText(e), 'error'); }
        } }, 'Убрать')
        : h('button', { class: 'btn btn-primary', onclick: async () => {
          try { pack = (await api.post(`/stickers/packs/${pack.id}/add`)).pack; await loadMyPacks(); upsert(pack); renderAction(); toast('Набор добавлен 🎉'); } catch (e) { toast(errorText(e), 'error'); }
        } }, icon('plus'), `Добавить ${pack.stickers.length} стикеров`));
  renderAction();
  m = openModal({
    title: pack.title,
    className: 'modal-stickers',
    body: h('div', { class: 'stack' },
      h('div', { class: 'muted small' }, `Набор от ${pack.owner?.name || 'пользователя'}${pack.installs ? ` · добавили ${pack.installs}` : ''}`),
      pack.stickers.length
        ? h('div', { class: 'sm-grid preview' }, pack.stickers.map((s) => h('div', { class: 'sm-item' }, h('img', { src: s.src, alt: s.emoji, loading: 'lazy' }))))
        : h('div', { class: 'list-note' }, 'В наборе пока нет стикеров'),
      action),
  });
}
