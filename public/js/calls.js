// 1:1 voice / video calls over WebRTC. Signaling goes through the Socket.IO connection.
import { api, errorText } from './api.js';
import { h, icon, avatar, toast, contextMenu } from './ui.js';
import { startRingtone, startRingback, stopRing } from './sounds.js';

let ctx = null; // { socket, me, userById }
let call = null; // current call state
let overlay = null;
let ring = null;

const END_TEXT = {
  declined: 'Звонок отклонён',
  missed: 'Нет ответа',
  busy: 'Абонент занят',
  cancelled: 'Звонок отменён',
  ended: 'Звонок завершён',
  elsewhere: 'Ответили на другом устройстве',
  unavailable: 'Пользователь недоступен',
};

export function initCalls(options) {
  ctx = options;
  const s = ctx.socket;
  s.on('call:incoming', onIncoming);
  s.on('call:accepted', onAccepted);
  s.on('call:signal', onSignal);
  s.on('call:state', (p) => {
    if (!call || p.callId !== call.id) return;
    call.peerMic = p.mic;
    call.peerCam = p.cam;
    render();
  });
  s.on('call:ended', (p) => {
    if (!call || p.callId !== call.id) return;
    finish(END_TEXT[p.status] || 'Звонок завершён');
  });
}

export const inCall = () => !!call;

// ---------------------------------------------------------------- sounds

const startTone = (kind) => (kind === 'ring' ? startRingtone() : startRingback());
const stopTone = () => stopRing();

// ---------------------------------------------------------------- media

async function getMedia(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch (e) {
    if (video) {
      // No camera / denied — fall back to voice.
      try {
        toast('Камера недоступна — звонок будет голосовым');
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch { /* fall through */ }
    }
    toast(e?.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера' : 'Нет доступа к микрофону', 'error');
    return null;
  }
}

async function createPeer() {
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  try { iceServers = (await api.get('/calls/ice')).iceServers; } catch { /* default STUN */ }
  const pc = new RTCPeerConnection({ iceServers });
  call.pc = pc;
  call.pendingIce = [];
  call.local.getTracks().forEach((t) => pc.addTrack(t, call.local));
  pc.onicecandidate = (e) => { if (e.candidate) signal({ type: 'ice', candidate: e.candidate }); };
  pc.ontrack = (e) => {
    call.remote = e.streams[0];
    render();
  };
  pc.onconnectionstatechange = () => {
    if (!call) return;
    if (pc.connectionState === 'connected' && !call.connectedAt) {
      call.connectedAt = Date.now();
      render();
    }
    if (pc.connectionState === 'failed') {
      toast('Не удалось соединиться. Проверьте интернет', 'error');
      hangup();
    }
  };
  return pc;
}

const signal = (data) => ctx.socket.emit('call:signal', { callId: call?.id, data });

// ---------------------------------------------------------------- outgoing

export async function startCall(chat, peer, video) {
  if (call) return toast('Сначала завершите текущий звонок');
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return toast('Браузер не поддерживает звонки', 'error');
  call = { id: null, chatId: chat.id, peer, video, role: 'caller', status: 'calling', mic: true, cam: video, peerMic: true, peerCam: video, speaker: true };
  render();
  const local = await getMedia(video);
  if (!local || !call) { cleanup(); return; }
  call.local = local;
  call.video = local.getVideoTracks().length > 0;
  call.cam = call.video;
  render();
  ctx.socket.emit('call:invite', { chatId: chat.id, video: call.video }, (r) => {
    if (!call) return;
    if (r?.error) {
      finish(r.error === 'busy' ? 'Абонент занят' : r.error === 'busy_self' ? 'У вас уже идёт звонок'
        : r.error === 'calls_disabled' ? 'Пользователь ограничил входящие звонки' : END_TEXT[r.error] || errorText({ code: r.error }));
      return;
    }
    call.id = r.callId;
    startTone('ringback');
  });
}

async function onAccepted({ callId }) {
  if (!call || call.id !== callId) return;
  stopTone();
  call.status = 'connecting';
  render();
  const pc = await createPeer();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: 'offer', sdp: pc.localDescription });
}

// ---------------------------------------------------------------- incoming

function onIncoming({ callId, chatId, from, video }) {
  if (call) {
    if (call.id === callId) return;
    return; // already in a call; the server marks us busy
  }
  const peer = ctx.userById(from) || { id: from, name: 'Пользователь' };
  call = { id: callId, chatId, peer, video, role: 'callee', status: 'incoming', mic: true, cam: video, peerMic: true, peerCam: video, speaker: true };
  startTone('ring');
  render();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`${video ? '📹 Видеозвонок' : '📞 Звонок'} от ${peer.name}`, { tag: `call${callId}`, icon: '/icons/icon-192.png' }); } catch { /* ignore */ }
  }
}

async function accept() {
  if (!call || call.role !== 'callee' || call.status !== 'incoming') return;
  stopTone();
  call.status = 'connecting';
  render();
  const local = await getMedia(call.video);
  if (!call) return;
  if (!local) { reject(); return; }
  call.local = local;
  call.cam = local.getVideoTracks().length > 0;
  await createPeer();
  ctx.socket.emit('call:accept', { callId: call.id });
  render();
}

function reject() {
  if (!call) return;
  ctx.socket.emit('call:reject', { callId: call.id });
  finish(null);
}

async function onSignal({ callId, data }) {
  if (!call || call.id !== callId || !call.pc) return;
  const pc = call.pc;
  try {
    if (data.type === 'offer') {
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal({ type: 'answer', sdp: pc.localDescription });
      flushIce();
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(data.sdp);
      flushIce();
    } else if (data.type === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else call.pendingIce.push(data.candidate);
    }
  } catch (e) {
    console.warn('signal error', e);
  }
}

function flushIce() {
  const list = call?.pendingIce || [];
  call.pendingIce = [];
  list.forEach((c) => call.pc.addIceCandidate(c).catch(() => {}));
}

// ---------------------------------------------------------------- controls

function hangup() {
  if (!call) return;
  if (call.id) ctx.socket.emit('call:end', { callId: call.id });
  finish(null);
}

function toggleMic() {
  if (!call?.local) return;
  call.mic = !call.mic;
  call.local.getAudioTracks().forEach((t) => { t.enabled = call.mic; });
  ctx.socket.emit('call:state', { callId: call.id, mic: call.mic, cam: call.cam });
  render();
}

function toggleCam() {
  const tracks = call?.local?.getVideoTracks() || [];
  if (!tracks.length) return toast('В голосовом звонке камера недоступна');
  call.cam = !call.cam;
  tracks.forEach((t) => { t.enabled = call.cam; });
  ctx.socket.emit('call:state', { callId: call.id, mic: call.mic, cam: call.cam });
  render();
}

function toggleSpeaker() {
  if (!call) return;
  call.speaker = !call.speaker;
  if (call.remoteEl) call.remoteEl.muted = !call.speaker;
  toast(call.speaker ? 'Звук собеседника включён' : 'Звук собеседника выключен 🔇');
  render();
}

const canPickOutput = () => 'setSinkId' in HTMLMediaElement.prototype && navigator.mediaDevices?.enumerateDevices;

async function pickOutput(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  if (outs.length < 2) return toast('Другие устройства вывода не найдены');
  contextMenu(r.left, r.top - 8 - outs.length * 42, outs.map((d, i) => ({
    icon: d.deviceId === call?.sinkId ? 'check' : 'volume',
    label: d.label || `Устройство ${i + 1}`,
    onClick: async () => {
      try { await call.remoteEl?.setSinkId(d.deviceId); call.sinkId = d.deviceId; toast(`Звук: ${d.label || 'устройство'}`); } catch { toast('Не удалось переключить устройство', 'error'); }
    },
  })));
}

async function flipCam() {
  const old = call?.local?.getVideoTracks()[0];
  if (!old || !call.pc) return;
  call.facing = call.facing === 'environment' ? 'user' : 'environment';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: call.facing } });
    const track = s.getVideoTracks()[0];
    const sender = call.pc.getSenders().find((x) => x.track?.kind === 'video');
    await sender?.replaceTrack(track);
    call.local.removeTrack(old);
    old.stop();
    call.local.addTrack(track);
    render();
  } catch { toast('Не удалось переключить камеру'); }
}

function finish(text) {
  stopTone();
  if (text) toast(text);
  cleanup();
}

function cleanup() {
  if (call) {
    call.local?.getTracks().forEach((t) => t.stop());
    try { call.pc?.close(); } catch { /* ignore */ }
  }
  call = null;
  clearInterval(render.timer);
  render.timer = null;
  overlay?.classList.remove('show');
  const o = overlay;
  overlay = null;
  setTimeout(() => o?.remove(), 250);
}

// ---------------------------------------------------------------- UI

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function statusText() {
  if (!call) return '';
  if (call.status === 'incoming') return call.video ? 'Входящий видеозвонок…' : 'Входящий звонок…';
  if (call.status === 'calling') return 'Вызов…';
  if (!call.connectedAt) return 'Соединение…';
  return fmt(Math.round((Date.now() - call.connectedAt) / 1000));
}

function render() {
  if (!call) return;
  if (!overlay) {
    overlay = h('div', { class: 'call-overlay' });
    document.body.append(overlay);
    requestAnimationFrame(() => overlay?.classList.add('show'));
  }
  if (!render.timer) render.timer = setInterval(() => { const el = overlay?.querySelector('.call-status'); if (el) el.textContent = statusText(); }, 1000);

  const remoteVideo = call.remote && call.remote.getVideoTracks().length && call.peerCam;
  const peer = call.peer;
  const btn = (cls, ic, label, onClick, on) => h('div', { class: 'call-btn-wrap' },
    h('button', { class: `call-btn ${cls} ${on === false ? 'off' : ''}`, 'aria-label': label, onclick: onClick }, icon(ic)),
    h('span', {}, label));

  const stage = h('div', { class: `call-stage ${remoteVideo ? 'has-video' : ''}` });
  if (call.remote) {
    // Keep one media element for the whole call so audio doesn't restart on every re-render.
    if (!call.remoteEl) {
      call.remoteEl = h('video', { autoplay: true, playsInline: true, class: 'call-remote' });
      call.remoteEl.srcObject = call.remote;
      if (call.sinkId) call.remoteEl.setSinkId?.(call.sinkId).catch(() => {});
    }
    call.remoteEl.muted = !call.speaker;
    call.remoteEl.classList.toggle('audio-only', !remoteVideo);
    stage.append(call.remoteEl);
  }
  if (!remoteVideo) {
    stage.append(h('div', { class: 'call-peer' },
      h('div', { class: `call-avatar ${call.status === 'incoming' || call.status === 'calling' ? 'pulse' : ''}` }, avatar({ id: peer.id, name: peer.name, src: peer.avatar }, 132)),
      h('div', { class: 'call-name' }, peer.name),
      h('div', { class: 'call-status' }, statusText()),
      call.connectedAt && !call.peerMic ? h('div', { class: 'call-note' }, '🔇 Микрофон собеседника выключен') : null));
  } else {
    stage.append(h('div', { class: 'call-top' }, h('div', { class: 'call-name small' }, peer.name), h('div', { class: 'call-status' }, statusText())));
  }
  if (call.local && call.local.getVideoTracks().length && call.cam) {
    if (!call.localEl) {
      call.localEl = h('video', { autoplay: true, playsInline: true, muted: true, class: 'call-local' });
      call.localEl.muted = true;
    }
    if (call.localEl.srcObject !== call.local) call.localEl.srcObject = call.local;
    stage.append(call.localEl);
  }

  const controls = call.status === 'incoming'
    ? h('div', { class: 'call-controls' },
      btn('red', 'phoneDown', 'Отклонить', reject),
      btn('green', call.video ? 'video' : 'phone', 'Ответить', accept))
    : h('div', { class: 'call-controls' },
      btn('glass', call.speaker ? 'volume' : 'volumeOff', call.speaker ? 'Динамик' : 'Динамик выкл.', toggleSpeaker, call.speaker),
      btn('glass', call.mic ? 'mic' : 'micOff', call.mic ? 'Микрофон' : 'Микр. выкл.', toggleMic, call.mic),
      call.local?.getVideoTracks().length ? btn('glass', call.cam ? 'video' : 'videoOff', 'Камера', toggleCam, call.cam) : null,
      call.local?.getVideoTracks().length && /Android|iPhone|iPad/i.test(navigator.userAgent) ? btn('glass', 'refresh', 'Повернуть', flipCam) : null,
      canPickOutput() && !/Android|iPhone|iPad/i.test(navigator.userAgent) ? btn('glass', 'devices', 'Вывод', pickOutput) : null,
      btn('red', 'phoneDown', 'Завершить', hangup));

  overlay.replaceChildren(
    h('div', { class: 'call-bg', style: peer.avatar ? { backgroundImage: `url("${peer.avatar}")` } : null }),
    stage,
    h('div', { class: 'call-secure' }, '🔒 Звонок шифруется'),
    controls);
}
