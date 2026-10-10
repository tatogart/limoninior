// Ringtones & notification sounds: built-in melodies are synthesized with WebAudio,
// custom ones are user-picked audio files kept on this device (IndexedDB).

const KEY = 'limoninior.settings';
const settings = () => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  return { ringtone: 'lemon', messageSound: 'pop', volume: 0.8, vibrate: true, inAppSounds: true, ...s };
};

// [frequency Hz, start s, duration s]
const N = (f, t, d) => [f, t, d];
export const RINGTONES = {
  lemon: { name: 'Лимонад', wave: 'triangle', loop: 2.4, notes: [N(784, 0, 0.16), N(988, 0.18, 0.16), N(1175, 0.36, 0.16), N(988, 0.54, 0.16), N(1319, 0.72, 0.32), N(1175, 1.1, 0.16), N(988, 1.28, 0.4)] },
  classic: { name: 'Классика', wave: 'sine', loop: 3, notes: [N(440, 0, 0.9), N(480, 0, 0.9), N(440, 1.1, 0.9), N(480, 1.1, 0.9)] },
  marimba: { name: 'Маримба', wave: 'sine', loop: 2, notes: [N(523, 0, 0.22), N(659, 0.2, 0.22), N(784, 0.4, 0.22), N(1047, 0.6, 0.35), N(784, 0.95, 0.22), N(659, 1.15, 0.3)] },
  retro: { name: 'Ретро 8-бит', wave: 'square', loop: 1.6, notes: [N(660, 0, 0.1), N(880, 0.12, 0.1), N(660, 0.24, 0.1), N(880, 0.36, 0.1), N(990, 0.5, 0.25)] },
  calm: { name: 'Спокойный', wave: 'sine', loop: 3.2, notes: [N(392, 0, 0.6), N(494, 0.5, 0.6), N(587, 1, 0.9)] },
  none: { name: 'Без звука (только вибрация)', notes: [] },
};
export const MESSAGE_SOUNDS = {
  pop: { name: 'Поп', wave: 'sine', notes: [N(880, 0, 0.07), N(1320, 0.06, 0.09)] },
  chime: { name: 'Колокольчик', wave: 'triangle', notes: [N(1047, 0, 0.18), N(1568, 0.1, 0.3)] },
  drop: { name: 'Капля', wave: 'sine', notes: [N(1400, 0, 0.05), N(700, 0.04, 0.12)] },
  ding: { name: 'Дзынь', wave: 'triangle', notes: [N(1760, 0, 0.35)] },
  lemon: { name: 'Лимончик', wave: 'triangle', notes: [N(988, 0, 0.08), N(1319, 0.09, 0.08), N(1568, 0.18, 0.16)] },
  none: { name: 'Без звука', notes: [] },
};

let ac = null;
function audio() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
// Browsers only allow sound after a user gesture: unlock on the first tap/click.
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => audio(), { once: true, capture: true }));

function playNotes(def, volume, at = 0) {
  const ctx = audio();
  if (!ctx || !def?.notes?.length) return;
  const t0 = ctx.currentTime + at;
  for (const [f, start, dur] of def.notes) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = def.wave || 'sine';
    osc.frequency.value = f;
    const peak = 0.22 * volume * (def.wave === 'square' ? 0.4 : 1);
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  }
}

// ---------- custom sounds (IndexedDB) ----------

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('limoninior-sounds', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((res) => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
  } catch { return null; }
}
async function idbPut(key, val) {
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

/** Save a user's own audio file as the ringtone ('ringtone') or message sound ('message'). */
export async function setCustomSound(kind, file) {
  if (!file.type.startsWith('audio/')) throw new Error('not_audio');
  if (file.size > 3 * 1024 * 1024) throw new Error('too_big');
  await idbPut(kind, { blob: file, name: file.name });
}
export async function customSoundName(kind) {
  return (await idbGet(kind))?.name || null;
}

let customEl = null;
async function playCustom(kind, { loop = false } = {}) {
  const rec = await idbGet(kind);
  if (!rec) return false;
  stopCustom();
  const el = new Audio(URL.createObjectURL(rec.blob));
  el.loop = loop;
  el.volume = Math.min(1, settings().volume);
  customEl = el;
  try { await el.play(); return true; } catch { return false; }
}
function stopCustom() {
  if (!customEl) return;
  customEl.pause();
  URL.revokeObjectURL(customEl.src);
  customEl = null;
}

// ---------- public API ----------

export async function playMessageSound(force = false) {
  const s = settings();
  if (!force && !s.inAppSounds) return;
  if (s.vibrate) navigator.vibrate?.(60);
  if (s.messageSound === 'custom') { if (await playCustom('message')) return; }
  playNotes(MESSAGE_SOUNDS[s.messageSound] || MESSAGE_SOUNDS.pop, s.volume);
}

let ringTimer = null;
/** Incoming-call ringtone. Returns nothing; call stopRing() to stop. */
export async function startRingtone() {
  stopRing();
  const s = settings();
  const vib = () => { if (s.vibrate) navigator.vibrate?.([600, 300, 600]); };
  vib();
  if (s.ringtone === 'custom' && await playCustom('ringtone', { loop: true })) {
    ringTimer = setInterval(vib, 2000);
    return;
  }
  const def = RINGTONES[s.ringtone] || RINGTONES.lemon;
  const tick = () => { playNotes(def, s.volume); vib(); };
  tick();
  ringTimer = setInterval(tick, (def.loop || 2.5) * 1000);
}

/** Outgoing-call "ringback" tone. */
export function startRingback() {
  stopRing();
  const s = settings();
  const def = { wave: 'sine', notes: [N(425, 0, 1)] };
  playNotes(def, s.volume * 0.6);
  ringTimer = setInterval(() => playNotes(def, s.volume * 0.6), 4000);
}

export function stopRing() {
  clearInterval(ringTimer);
  ringTimer = null;
  stopCustom();
  navigator.vibrate?.(0);
}

/** Short preview in settings. */
export async function preview(kind, id) {
  stopRing();
  const s = settings();
  if (id === 'custom') {
    const ok = await playCustom(kind === 'ring' ? 'ringtone' : 'message');
    if (ok) setTimeout(stopCustom, 4000);
    return ok;
  }
  playNotes((kind === 'ring' ? RINGTONES : MESSAGE_SOUNDS)[id], s.volume);
  return true;
}
