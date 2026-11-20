// Video circles ("кружки", like Telegram): a round video message up to 60 seconds.
// Recording draws the camera into a square canvas (center crop, mirrored front camera) and
// records that plus the microphone, so every circle is a neat square video.
import { api, errorText } from './api.js';
import { h, icon, toast, registerOverlay } from './ui.js';

const MAX_SEC = 60;
const SIZE = 400;
let deps = null; // { onSent(message), inCall() }
export function initCircles(d) { deps = d; }

function pickMime() {
  const opts = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
  return opts.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}
export const circlesSupported = () => !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Full-screen recorder. Sends the circle to chatId when done. */
export async function recordCircle(chatId, replyTo = null) {
  if (!circlesSupported()) return toast('Этот браузер не умеет записывать видео', 'error');
  if (deps?.inCall?.()) return toast('Сейчас идёт звонок', 'error');
  let facing = 'user';
  let cam = null, mic = null;
  const getCam = async () => {
    cam?.getTracks().forEach((t) => t.stop());
    cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = cam;
    await video.play().catch(() => {});
  };
  const video = h('video', { class: 'cr-src', muted: true, playsInline: true, autoplay: true });
  video.muted = true;
  const canvas = h('canvas', { class: 'cr-canvas', width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d');
  const ring = h('div', { class: 'cr-ring' });
  const time = h('div', { class: 'cr-time' }, '0:00');
  const hint = h('div', { class: 'cr-hint' }, 'Нажмите ⏺, чтобы начать запись');
  const recBtn = h('button', { class: 'cr-rec', 'aria-label': 'Записать' }, h('i'));
  const flipBtn = h('button', { class: 'cr-small', 'aria-label': 'Сменить камеру' }, icon('refresh'));
  const closeBtn = h('button', { class: 'cr-small', 'aria-label': 'Отмена' }, icon('close'));
  const root = h('div', { class: 'cr-overlay' },
    h('div', { class: 'cr-stage' }, h('div', { class: 'cr-circle' }, canvas, ring), time),
    hint,
    h('div', { class: 'cr-controls' }, closeBtn, recBtn, flipBtn));
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('show'));

  let raf = 0, recorder = null, chunks = [], started = 0, tick = 0, done = false;
  const draw = () => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      const s = Math.min(vw, vh);
      ctx.save();
      if (facing === 'user') { ctx.translate(SIZE, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SIZE, SIZE);
      ctx.restore();
    }
    raf = requestAnimationFrame(draw);
  };
  const cleanup = () => {
    done = true;
    cancelAnimationFrame(raf);
    clearInterval(tick);
    cam?.getTracks().forEach((t) => t.stop());
    mic?.getTracks().forEach((t) => t.stop());
    release?.();
    root.classList.remove('show');
    setTimeout(() => root.remove(), 220);
  };
  const cancel = () => { if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); } cleanup(); };
  const release = registerOverlay(() => { if (!done) cancel(); });

  try {
    await getCam();
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
  } catch {
    cleanup();
    return toast('Нет доступа к камере. Разрешите её в настройках браузера.', 'error');
  }
  draw();

  const start = () => {
    const out = canvas.captureStream ? canvas.captureStream(30) : cam;
    const stream = new MediaStream([...out.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])]);
    const mime = pickMime();
    try {
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 700_000, audioBitsPerSecond: 48_000 });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.start(500);
    started = Date.now();
    root.classList.add('recording');
    hint.textContent = 'Идёт запись · нажмите ⏹, чтобы отправить';
    recBtn.setAttribute('aria-label', 'Отправить');
    tick = setInterval(() => {
      const sec = (Date.now() - started) / 1000;
      time.textContent = fmt(sec);
      ring.style.setProperty('--p', `${Math.min(1, sec / MAX_SEC) * 360}deg`);
      if (sec >= MAX_SEC) finish();
    }, 100);
    navigator.vibrate?.(15);
  };
  const finish = () => {
    if (!recorder || recorder.state === 'inactive') return;
    const duration = (Date.now() - started) / 1000;
    const type = recorder.mimeType || 'video/webm';
    recorder.onstop = () => {
      cleanup();
      if (duration < 1) return toast('Слишком короткий кружок');
      send(chatId, new Blob(chunks, { type }), duration, replyTo);
    };
    recorder.stop();
  };
  recBtn.addEventListener('click', () => (recorder ? finish() : start()));
  closeBtn.addEventListener('click', () => cancel());
  flipBtn.addEventListener('click', async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    try { await getCam(); } catch { facing = 'user'; toast('Вторая камера недоступна'); }
  });
}

async function send(chatId, blob, duration, replyTo) {
  const fd = new FormData();
  fd.append('file', blob, blob.type.includes('mp4') ? 'circle.mp4' : 'circle.webm');
  fd.append('duration', String(Math.round(duration * 10) / 10));
  if (replyTo) fd.append('replyTo', String(replyTo));
  const t = toast('Отправляем кружок…');
  try {
    const { message } = await api.post(`/chats/${chatId}/circle`, fd);
    deps?.onSent?.(message);
  } catch (e) { toast(errorText(e), 'error'); }
  t?.remove?.();
}

// ---------------------------------------------------------------- playback

let playing = null; // { video, el }
function stopPlaying() {
  if (!playing) return;
  const { video, el } = playing;
  playing = null;
  video.muted = true;
  video.loop = true;
  el.classList.remove('playing');
  video.play().catch(() => {});
}

/** Round video in a message: plays silently on loop; tap to play with sound. */
export function circleEl(m) {
  const x = m.extra || {};
  const video = h('video', { class: 'circle-video', src: m.localUrl || m.file, muted: true, loop: true, playsInline: true, preload: 'metadata', autoplay: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  video.muted = true;
  const prog = h('div', { class: 'circle-prog' });
  const dur = h('span', { class: 'circle-dur' }, fmt(x.duration || 0));
  const mute = h('span', { class: 'circle-mute' }, icon('volumeOff'));
  const el = h('div', { class: 'circle-msg' }, video, prog, dur, mute);
  video.addEventListener('timeupdate', () => {
    if (playing?.video !== video) return;
    const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : x.duration || 1;
    prog.style.setProperty('--p', `${Math.min(1, video.currentTime / d) * 360}deg`);
    dur.textContent = fmt(Math.max(0, d - video.currentTime));
  });
  video.addEventListener('ended', () => { if (playing?.video === video) { stopPlaying(); prog.style.setProperty('--p', '0deg'); dur.textContent = fmt(x.duration || 0); } });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (playing?.video === video) {
      if (video.paused) video.play().catch(() => {}); else video.pause();
      el.classList.toggle('paused', video.paused);
      return;
    }
    stopPlaying();
    playing = { video, el };
    el.classList.add('playing');
    el.classList.remove('paused');
    video.loop = false;
    video.muted = false;
    video.currentTime = 0;
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
  });
  // Only play the silent loop while visible (saves battery and data).
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([en]) => {
      if (playing?.video === video) return;
      if (en.isIntersecting) video.play().catch(() => {}); else video.pause();
    }, { threshold: 0.3 });
    io.observe(el);
  }
  return el;
}
