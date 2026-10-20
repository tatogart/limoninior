// Roles and badges earned in the owner's game launcher ("Лимон чат" rewards) + linking the launcher.
import { api, errorText } from './api.js';
import { h, icon, toast, openModal, confirmDialog } from './ui.js';

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
      : h('div', { class: 'muted small' }, 'Ролей пока нет — их выдаёт лаунчер с играми за достижения.'),
    badges.length ? h('div', { class: 'rw-badges' }, h('span', { class: 'field-label' }, 'Значки:'), ...badges.map((b) => h('span', { class: 'rw-badge', title: `${b.name}${b.desc ? ` — ${b.desc}` : ''}` }, `${b.emoji} ${b.name}`))) : null);
  const choose = async (id) => {
    try { await api.post('/me/role', { role: id }); d.setMe({ role: id }); render(); toast(id ? 'Роль показывается рядом с именем' : 'Роль скрыта'); } catch (e) { toast(errorText(e), 'error'); }
  };
  render();
  return wrap;
}

// ---------------------------------------------------------------- launcher link

export async function launcherModal() {
  let st;
  try { st = await api.get('/me/launcher'); } catch (e) { return toast(errorText(e), 'error'); }
  const base = `${location.origin}/ext/v1`;
  const body = h('div', { class: 'stack' });
  const keyBox = (token) => h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'Ваш ключ для лаунчера. Вставьте его в лаунчер. Показываем один раз — сохраните. Никому не передавайте.'),
    h('button', { class: 'ref-link mono-link', onclick: () => navigator.clipboard?.writeText(token).then(() => toast('Ключ скопирован'), () => toast(token)) }, h('span', { class: 'ellipsis' }, token), icon('copy')));
  const render = (token) => body.replaceChildren(
    h('div', { class: 'cap-hero' }, h('div', { class: 'cap-hero-ic' }, '🎮'),
      h('div', {}, h('b', {}, 'Награды из лаунчера с играми'), h('span', {}, 'Играйте в лаунчере — роли и значки за достижения появятся здесь, в профиле Limochat.'))),
    h('div', { class: `ln-status ${st.connected ? 'on' : ''}` }, st.connected
      ? `✅ Лаунчер подключён${st.lastUsed ? ` · последний раз ${new Date(st.lastUsed).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : ' · ещё не заходил'}`
      : 'Лаунчер не подключён'),
    token ? keyBox(token) : null,
    h('div', { class: 'ref-actions' },
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (st.connected && !(await confirmDialog('Выдать новый ключ? Старый перестанет работать.', { ok: 'Выдать' }))) return;
        try { const r = await api.post('/me/launcher'); st = { connected: true, lastUsed: 0 }; render(r.token); } catch (e) { toast(errorText(e), 'error'); }
      } }, icon('key'), st.connected ? 'Новый ключ' : 'Подключить'),
      st.connected ? h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
        if (!(await confirmDialog('Отключить лаунчер? Полученные роли и значки останутся.', { ok: 'Отключить', danger: true }))) return;
        try { await api.del('/me/launcher'); st = { connected: false }; render(); } catch (e) { toast(errorText(e), 'error'); }
      } }, 'Отключить') : null),
    h('details', { class: 'ln-dev' }, h('summary', {}, 'Для разработчика лаунчера'),
      h('div', { class: 'bot-methods' },
        h('div', {}, h('code', {}, 'GET /me'), h('span', {}, 'кто подключён и какие награды уже есть')),
        h('div', {}, h('code', {}, 'GET /rewards'), h('span', {}, 'список наград (id, роль или значок)')),
        h('div', {}, h('code', {}, 'POST /rewards'), h('span', {}, '{"reward":"legend"} или {"rewards":["legend","explorer"]} — выдать'))),
      h('pre', { class: 'bot-code' }, `// адрес: ${base}\nfetch('${base}/rewards', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer ' + KEY,\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify({ reward: 'legend' }),\n}).then((r) => r.json());`)));
  render();
  openModal({ title: 'Лаунчер игр', className: 'modal-small', body });
}
