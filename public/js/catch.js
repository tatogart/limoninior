import { api, errorText } from './api.js';
import { h, toast, richText } from './ui.js';
import { SURPRISE_SKINS } from './surprise-shared.js';

// No timer or automatic movement: touch and keyboard users can play at their own pace.
export function catchEl(message, userId) {
  const skin = SURPRISE_SKINS[message.extra?.skin] || SURPRISE_SKINS.lemon;
  let hits = 0, loading = false, opened = false;
  const status = h('span', { class: 'catch-score', role: 'status' }, 'Поймано: 0 / 5');
  const field = h('div', { class: 'catch-field', 'aria-label': 'Поле для ловли лимона' });
  field.style.background = `linear-gradient(130deg, ${skin.colors[0]}, ${skin.colors[1]})`;
  const target = h('button', { type: 'button', class: 'catch-target', 'aria-label': 'Поймать лимон: 1 из 5', onclick: hit }, '🍋');
  const hint = h('p', { class: 'catch-hint' }, 'Лови лимон — он перепрыгивает на новое место. Пять попаданий откроют послание!');
  const fallback = h('button', { type: 'button', class: 'catch-skip', onclick: () => reveal() }, 'Открыть без игры');
  field.append(target);
  const card = h('div', { class: 'surprise catch-card' },
    h('div', { class: 'surprise-label' }, '🍋 ПОЙМАЙ ЛИМОН'),
    h('b', { class: 'surprise-title' }, message.text || 'Поймай мой сюрприз'), hint,
    field, h('div', { class: 'catch-footer' }, status, fallback));
  const key = Number.isSafeInteger(userId) && userId > 0 && Number.isSafeInteger(message.id)
    ? `limo.surprise.${userId}.${message.id}` : null;

  function place() {
    // A stride through the 3x3 board avoids repeats and keeps the whole button reachable.
    const slot = ((Math.abs(Number(message.id) || 0) % 9) + hits * 4) % 9;
    target.style.left = `${14 + (slot % 3) * 36}%`;
    target.style.top = `${14 + Math.floor(slot / 3) * 36}%`;
    target.setAttribute('aria-label', `Поймать лимон: ${Math.min(hits + 1, 5)} из 5`);
  }
  async function hit() {
    if (loading || opened || hits >= 5) return;
    hits++;
    status.textContent = `Поймано: ${hits} / 5`;
    if (hits === 5) return reveal();
    place();
  }
  async function reveal() {
    if (loading || opened) return;
    loading = true; target.disabled = true; fallback.disabled = true;
    status.textContent = 'Открываем послание…';
    try {
      const result = await api.post(`/messages/${message.id}/surprise-open`);
      if (typeof result?.text !== 'string') throw new Error('bad surprise');
      opened = true; card.classList.add('opened'); field.classList.add('catch-won');
      field.style.background = '';
      field.replaceChildren(h('span', { class: 'catch-trophy', 'aria-hidden': 'true' }, '🍋'), h('div', { class: 'surprise-text' }, richText(result.text)));
      hint.textContent = hits >= 5 ? 'Пять лимонов — и послание твоё!' : 'Твоё послание открыто';
      status.textContent = 'Послание открыто'; fallback.remove();
      try { if (key) localStorage.setItem(key, '1'); } catch { /* optional */ }
    } catch (e) {
      status.textContent = 'Не удалось открыть. Попробуй ещё раз';
      target.disabled = false; fallback.disabled = false; fallback.textContent = 'Повторить открытие';
      toast(errorText(e), 'error');
    } finally { loading = false; }
  }
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'dblclick']) {
    field.addEventListener(type, (event) => event.stopPropagation());
    fallback.addEventListener(type, (event) => event.stopPropagation());
  }
  place();
  try { if (key && localStorage.getItem(key) === '1') reveal(); } catch { /* optional */ }
  return card;
}
