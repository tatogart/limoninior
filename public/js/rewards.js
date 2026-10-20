// Roles and badges for playing in the owner's game launcher ("Лимон чат" rewards). The admin grants them.
import { api, errorText } from './api.js';
import { h, toast } from './ui.js';

let catalog = new Map();
let d = null; // { me(), setMe(patch) }
export function initRewards(deps) { d = deps; return loadCatalog(); }
export async function loadCatalog() {
  try { const { rewards } = await api.get('/rewards/catalog'); catalog = new Map(rewards.map((r) => [r.id, r])); } catch { /* offline */ }
}
export const rewardInfo = (id) => catalog.get(id) || null;

/** Small colored role tag next to a name ("👑 Легенда"). */
export function roleTag(roleId, cls = '') {
  const r = roleId && rewardInfo(roleId);
  if (!r || r.kind !== 'role') return null;
  return h('span', { class: `role-tag ${cls}`, style: { '--rc': r.color || '#22c55e' }, title: r.desc ? `Роль «${r.name}»: ${r.desc}` : `Роль «${r.name}»` }, h('i', {}, r.emoji), r.name);
}

/** The "Роли и значки" block for a profile (null when there are none). */
export async function rewardsBlock(userId) {
  let list = [];
  try { list = (await api.get(`/users/${userId}/rewards`)).rewards; } catch { return null; }
  const items = list.map((x) => rewardInfo(x.id)).filter(Boolean);
  if (!items.length) return null;
  return h('div', { class: 'rw-block' },
    h('div', { class: 'pf-section-title' }, `Роли и значки · ${items.length}`),
    h('div', { class: 'rw-grid' }, items.map((r) => h('div', { class: `rw-item rw-${r.kind}`, style: { '--rc': r.color || '#22c55e' }, title: r.desc || '' },
      h('div', { class: 'rw-emoji' }, r.emoji),
      h('div', { class: 'grow' }, h('b', {}, r.name), h('span', {}, `${r.kind === 'role' ? 'Роль' : 'Значок'}${r.desc ? ` · ${r.desc}` : ''}`))))));
}

/** In my own profile: choose which role is shown next to my name. */
export async function rolePicker() {
  let list = [];
  try { list = (await api.get(`/users/${d.me().id}/rewards`)).rewards; } catch { return null; }
  const roles = list.map((x) => rewardInfo(x.id)).filter((r) => r?.kind === 'role');
  const badges = list.map((x) => rewardInfo(x.id)).filter((r) => r?.kind === 'badge');
  const wrap = h('div', { class: 'rw-pick' });
  const render = () => wrap.replaceChildren(
    h('div', { class: 'field-label' }, 'Роль рядом с именем'),
    roles.length ? h('div', { class: 'rw-roles' },
      h('button', { type: 'button', class: `rw-chip ${d.me().role ? '' : 'on'}`, onclick: () => choose(null) }, 'Не показывать'),
      ...roles.map((r) => h('button', { type: 'button', class: `rw-chip ${d.me().role === r.id ? 'on' : ''}`, style: { '--rc': r.color }, onclick: () => choose(r.id) }, `${r.emoji} ${r.name}`)))
      : h('div', { class: 'muted small' }, 'Ролей пока нет — их выдаёт администрация за достижения в играх.'),
    badges.length ? h('div', { class: 'rw-badges' }, h('span', { class: 'field-label' }, 'Значки:'), ...badges.map((b) => h('span', { class: 'rw-badge', title: `${b.name}${b.desc ? ` — ${b.desc}` : ''}` }, `${b.emoji} ${b.name}`))) : null);
  const choose = async (id) => {
    try { await api.post('/me/role', { role: id }); d.setMe({ role: id }); render(); toast(id ? 'Роль показывается рядом с именем' : 'Роль скрыта'); } catch (e) { toast(errorText(e), 'error'); }
  };
  render();
  return wrap;
}
