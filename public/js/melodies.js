import { api, errorText } from './api.js';
import { h, icon, toast, openModal, isTouch } from './ui.js';
import { melodyNotes } from './melody-shared.js';

let playing = null;
export function stopMelody() {
  const old = playing;
  playing = null;
  if (!old) return;
  clearTimeout(old.timer);
  old.reset();
  old.ctx.close().catch(() => {});
}
window.addEventListener('pagehide', stopMelody);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMelody(); });

export function melodyModal(chat, onSent) {
  const text = h('textarea', { class: 'input', rows: 3, maxLength: 240, 'aria-label': 'Фраза для мелодии', placeholder: 'Например: «Мы с тобой на одной волне 🍋»' });
  openModal({
    title: 'Сообщение-мелодия', className: 'modal-small',
    body: h('div', { class: 'stack' },
      h('div', { class: 'melody-hero', 'aria-hidden': 'true' }, '♫'),
      h('p', { class: 'muted small' }, 'У каждой фразы свой мотив. Напиши что-нибудь — собеседник сможет услышать, как звучат твои слова.'), text),
    actions: [
      { label: 'Отмена', onClick: (close) => close() },
      { label: 'Отправить мелодию', primary: true, onClick: async (close, button) => {
        if (!text.value.trim()) { text.focus(); return; }
        button.disabled = true;
        try {
          const { message } = await api.post(`/chats/${chat.id}/melody`, { text: text.value });
          close(); onSent?.(message);
        } catch (e) { button.disabled = false; toast(errorText(e), 'error'); }
      } },
    ],
  });
  if (!isTouch()) setTimeout(() => text.focus(), 50);
}

export function melodyEl(message, getVolume = () => 0.6) {
  const notes = melodyNotes(message.text);
  const bars = h('div', { class: 'melody-bars', 'aria-hidden': 'true' }, notes.map((note, i) =>
    h('i', { style: { height: `${note.height}px`, '--note-delay': `${i * 0.07}s` } })));
  const button = h('button', { class: 'melody-play', type: 'button', 'aria-label': 'Послушать мелодию', onclick: play }, icon('play'), 'Послушать');
  const card = h('div', { class: 'melody-card' },
    h('div', { class: 'melody-kicker' }, '♫ СЛОВА ЗВУЧАТ'),
    h('div', { class: 'melody-phrase' }, message.text), bars, button);
  const reset = () => {
    card.classList.remove('playing'); button.disabled = false;
    button.setAttribute('aria-label', 'Послушать мелодию'); button.replaceChildren(icon('play'), 'Послушать');
  };
  async function play() {
    if (playing?.button === button) { stopMelody(); return; }
    stopMelody();
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return toast('Этот браузер не поддерживает воспроизведение мелодий', 'error');
    let state;
    try {
      const ctx = new Audio();
      state = { ctx, button, reset, timer: null };
      playing = state; button.disabled = true;
      await ctx.resume();
      if (playing !== state) return;
      button.disabled = false; card.classList.add('playing');
      button.setAttribute('aria-label', 'Остановить мелодию'); button.replaceChildren(icon('pause'), 'Остановить');
      const value = Number(getVolume());
      const volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.6;
      const master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
      let at = ctx.currentTime + 0.03;
      for (const note of notes) {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = note.frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.1, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration - 0.01);
        oscillator.connect(gain); gain.connect(master);
        oscillator.start(at); oscillator.stop(at + note.duration);
        at += note.duration;
      }
      state.timer = setTimeout(() => { if (playing === state) stopMelody(); }, (at - ctx.currentTime) * 1000 + 100);
    } catch {
      if (state && playing !== state) return;
      if (state) stopMelody();
      else reset();
      toast('Не удалось включить звук. Нажми ещё раз', 'error');
    }
  }
  // Do not turn the play button into the chat's double-tap reaction.
  for (const type of ['touchstart', 'touchend', 'dblclick']) button.addEventListener(type, (e) => e.stopPropagation());
  return card;
}
