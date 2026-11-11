import { api, errorText } from './api.js';
import { h, icon, toast, openModal, isTouch, richText } from './ui.js';
import { SURPRISE_SKINS, ScratchProgress } from './surprise-shared.js';

export function surpriseModal(chat, onSent) {
  let skin = 'lemon';
  const title = h('input', { class: 'input', maxLength: 60, placeholder: 'Надпись на обложке (необязательно)', 'aria-label': 'Надпись на обложке' });
  const text = h('textarea', { class: 'input', rows: 4, maxLength: 1000, placeholder: 'Комплимент, смешное предсказание или неожиданный план…', 'aria-label': 'Текст сюрприза' });
  const count = h('span', { class: 'muted small' }, '0 / 1000');
  text.addEventListener('input', () => { count.textContent = `${text.value.length} / 1000`; });
  const preview = h('div', { class: 'surprise-mini', 'aria-hidden': 'true' });
  const choices = h('div', { class: 'surprise-skins', role: 'group', 'aria-label': 'Обложка сюрприза' });
  const render = () => {
    choices.replaceChildren(...Object.entries(SURPRISE_SKINS).map(([id, s]) => h('button', {
      type: 'button', class: `surprise-skin ${skin === id ? 'selected' : ''}`, 'aria-pressed': skin === id ? 'true' : 'false',
      onclick: () => { skin = id; render(); },
    }, h('span', {}, s.emoji), s.label)));
    const s = SURPRISE_SKINS[skin];
    preview.style.background = `linear-gradient(130deg, ${s.colors[0]}, ${s.colors[1]})`;
    preview.style.color = s.ink;
    preview.replaceChildren(h('span', {}, s.emoji), h('b', {}, 'Сотри — и улыбнись'));
  };
  render();
  openModal({
    title: 'Лимонный сюрприз', className: 'modal-small',
    body: h('div', { class: 'stack' }, preview,
      h('p', { class: 'muted small' }, 'Спрячь послание под обложкой. Собеседник сотрёт её пальцем — и найдёт твой сюрприз.'),
      choices, title, text, count),
    actions: [
      { label: 'Отмена', onClick: (close) => close() },
      { label: 'Отправить сюрприз 🍋', primary: true, onClick: async (close, button) => {
        if (!text.value.trim()) { text.focus(); return; }
        button.disabled = true;
        try {
          const { message } = await api.post(`/chats/${chat.id}/surprise`, { title: title.value, text: text.value, skin });
          close(); onSent?.(message); toast('Сюрприз отправлен 🍋');
        } catch (e) { button.disabled = false; toast(errorText(e), 'error'); }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => text.focus(), 50);
}

export function surpriseEl(message, userId) {
  const skin = SURPRISE_SKINS[message.extra?.skin] || SURPRISE_SKINS.lemon;
  const progress = new ScratchProgress();
  const canvas = h('canvas', { class: 'surprise-coating', width: 600, height: 360, 'aria-hidden': 'true' });
  const hint = h('div', { class: 'surprise-hint', 'aria-hidden': 'true' }, h('span', {}, skin.emoji), h('b', {}, 'Сотри меня'), h('small', {}, 'Проведи пальцем или мышью'));
  const content = h('div', { class: 'surprise-content', 'aria-live': 'polite' }, h('span', {}, '✨'), h('b', {}, 'Здесь прячется улыбка'));
  const stage = h('div', { class: 'surprise-stage' }, content, canvas, hint);
  stage.style.setProperty('--surprise-ink', skin.ink);
  const status = h('span', { class: 'surprise-status', role: 'status' }, 'Сотри обложку или нажми «Открыть»');
  const button = h('button', { class: 'surprise-open', type: 'button', onclick: () => reveal() }, icon('sparkles'), 'Открыть');
  const card = h('div', { class: 'surprise' },
    h('div', { class: 'surprise-label' }, skin.emoji, ' ЛИМОННЫЙ СЮРПРИЗ'),
    h('b', { class: 'surprise-title' }, message.text || 'Для тебя кое-что есть'),
    stage, h('div', { class: 'surprise-footer' }, status, button));
  let ctx = null, active = null, loading = false, opened = false;
  let key = null;
  if (Number.isSafeInteger(userId) && userId > 0 && Number.isSafeInteger(message.id)) key = `limo.surprise.${userId}.${message.id}`;

  function paint() {
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    const gradient = ctx.createLinearGradient(0, 0, 300, 180);
    gradient.addColorStop(0, skin.colors[0]); gradient.addColorStop(1, skin.colors[1]);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 300, 180);
    ctx.fillStyle = skin.ink; ctx.globalAlpha = 0.12;
    for (let row = 0; row < 5; row++) for (let col = 0; col < 9; col++) {
      ctx.beginPath(); ctx.ellipse(col * 40 + (row % 2 ? 20 : 0), row * 45, 5, 9, 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 48; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'destination-out';
  }

  async function reveal() {
    if (loading || opened) return;
    loading = true; active = null; progress.end(); button.disabled = true;
    status.textContent = 'Открываем…';
    try {
      const result = await api.post(`/messages/${message.id}/surprise-open`);
      if (typeof result?.text !== 'string') throw new Error('bad surprise');
      content.replaceChildren(h('span', { class: 'surprise-reveal-emoji', 'aria-hidden': 'true' }, skin.emoji), h('div', { class: 'surprise-text' }, richText(result.text)));
      opened = true; card.classList.add('opened');
      canvas.remove(); hint.remove();
      status.textContent = 'Теперь этот сюрприз твой'; button.remove();
      // Only an opened flag stays on the device. Re-check membership on each reload.
      try { if (key) localStorage.setItem(key, '1'); } catch { /* optional */ }
    } catch (e) {
      status.textContent = 'Не получилось открыть. Попробуй ещё раз';
      button.disabled = false; button.textContent = 'Повторить';
      toast(errorText(e), 'error');
    } finally { loading = false; }
  }

  function scratch(event, first = false) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || opened || loading) return;
    const x = Math.max(0, Math.min(300, (event.clientX - rect.left) * 300 / rect.width));
    const y = Math.max(0, Math.min(180, (event.clientY - rect.top) * 180 / rect.height));
    const old = first ? null : progress.previous;
    const amount = first ? progress.begin(x, y) : progress.move(x, y);
    if (ctx) {
      ctx.beginPath(); ctx.moveTo(old?.x ?? x, old?.y ?? y); ctx.lineTo(x + 0.01, y); ctx.stroke();
    }
    hint.classList.add('scratching');
    status.textContent = `Открыто ${Math.min(99, Math.round(amount / 0.4 * 100))}% — ещё чуть-чуть`;
    if (amount >= 0.4) reveal();
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (opened || loading || (e.pointerType === 'mouse' && e.button !== 0) || active !== null) return;
    e.preventDefault(); active = e.pointerId; canvas.setPointerCapture?.(active); scratch(e, true);
  });
  canvas.addEventListener('pointermove', (e) => { if (active === e.pointerId) scratch(e); });
  const end = () => { active = null; progress.end(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  // Keep scratch strokes and the open button out of the chat's swipe/reply/heart gestures.
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'dblclick']) stage.addEventListener(type, (e) => e.stopPropagation());
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  button.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  button.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
  paint();
  try { if (key && localStorage.getItem(key) === '1') reveal(); } catch { /* optional */ }
  return card;
}
