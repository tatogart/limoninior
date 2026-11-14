// Custom sticker packs: create from your own pictures, share by link, add packs of others.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, confirmDialog, isTouch } from './ui.js';

let packs = null; // my packs (created + added), null = not loaded yet
let loading = null;
let onChange = () => {};
let openStudio=()=>{};

export function initStickerPacks(o) { onChange = o.onChange || onChange;openStudio=o.openStudio||openStudio; }

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
  out.push(h('button', { class: 'sticker-new', onclick: newPackModal }, icon('plus'), 'Открыть бота студии'));
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

export function newPackModal(){openStudio();}
export function openPackManager(){openStudio();}

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
