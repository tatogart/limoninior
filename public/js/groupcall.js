// Group calls (groups and invite links): a WebRTC mesh, every participant ↔ every participant.
// Uses the "perfect negotiation" pattern so both sides can add tracks at any time.
import { api, errorText } from './api.js';
import { h, icon, avatar, toast, registerOverlay } from './ui.js';
import { canShareScreen, getScreenTrack } from './calls.js';

const ERR = {
  room_full: 'В звонке уже 8 человек — это максимум',
  call_ended: 'Звонок уже закончился',
  not_found: 'Звонок не найден или ссылка устарела',
  busy_self: 'Сначала завершите текущий звонок',
  too_many: 'Слишком много ссылок, попробуйте позже',
};

let ctx = null; // { socket, me(), user(id), ensureUser(id), onChange() }
let gc = null;
let iceCache = null;

export const inGroupCall = () => !!gc;
export const currentRoomId = () => gc?.roomId || null;

export function initGroupCalls(o) {
  ctx = o;
  const s = ctx.socket;
  s.on('gc:peer-joined', (p) => {
    if (!gc || p.roomId !== gc.roomId) return;
    addPeer(p.sid, p.userId, p.mic, p.cam, p.screen);
    render();
  });
  s.on('gc:peer-left', (p) => {
    if (!gc || p.roomId !== gc.roomId) return;
    dropPeer(p.sid);
    render();
  });
  s.on('gc:peer-state', (p) => {
    const peer = gc?.peers.get(p.sid);
    if (!peer) return;
    peer.mic = p.mic; peer.cam = p.cam; peer.screen = !!p.screen;
    render();
  });
  s.on('gc:signal', onSignal);
  // Socket reconnected (network blip): rejoin the same room.
  s.on('connect', () => { if (gc) rejoin(); });
}

const emit = (ev, data) => new Promise((resolve) => ctx.socket.timeout(10_000).emit(ev, data, (err, res) => resolve(err ? { error: 'timeout' } : res)));

async function iceServers() {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  try {
    const r = await api.get('/calls/ice');
    iceCache = { servers: r.iceServers, until: Date.now() + 10 * 60_000 };
  } catch { iceCache = { servers: [{ urls: 'stun:stun.l.google.com:19302' }], until: Date.now() + 60_000 }; }
  return iceCache.servers;
}

// ------------------------------------------------------------------ public API

export async function startGroupCall(chat, video = false) {
  if (gc?.chatId === chat.id) return expand();
  const r = await emit('gc:start', { chatId: chat.id, video });
  if (r?.error) return toast(ERR[r.error] || errorText({ code: r.error }), 'error');
  return joinGroupCall({ roomId: r.roomId, video, title: chat.title });
}

export async function createCallLink(title = '') {
  const r = await emit('gc:link', { title });
  if (r?.error) { toast(ERR[r.error] || 'Не удалось создать ссылку', 'error'); return null; }
  return r.token;
}

export const callLink = (token) => `${location.origin}/call/${token}`;

export async function callInfo({ roomId, token }) {
  return emit('gc:info', { roomId, token });
}

export async function joinGroupCall({ roomId, token, video = false, title = '' }) {
  if (ctx.inOneToOne?.()) return toast(ERR.busy_self, 'error');
  if (gc) {
    if ((roomId && gc.roomId === roomId) || (token && gc.token === token)) return expand();
    leaveGroupCall();
  }
  let local;
  try {
    local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
    });
  } catch {
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (video) toast('Камера недоступна — заходим только со звуком');
    } catch {
      local = new MediaStream();
      toast('Нет доступа к микрофону — вас не будет слышно', 'error');
    }
  }
  gc = {
    roomId, token, title, chatId: null, local, sid: null,
    peers: new Map(), mic: local.getAudioTracks().length > 0, cam: local.getVideoTracks().length > 0,
    muted: false, mini: false, joinedAt: Date.now(), ice: await iceServers(),
  };
  const r = await emit('gc:join', { roomId, token, mic: gc.mic, cam: gc.cam });
  if (!gc) return;
  if (r?.error) {
    local.getTracks().forEach((t) => t.stop());
    gc = null;
    return toast(ERR[r.error] || errorText({ code: r.error }), 'error');
  }
  Object.assign(gc, { roomId: r.roomId, token: r.token, chatId: r.chatId, title: r.title || title, sid: r.sid });
  for (const p of r.peers) addPeer(p.sid, p.userId, p.mic, p.cam, p.screen);
  startMeter();
  render();
  ctx.onChange?.();
}

export function leaveGroupCall() {
  if (!gc) return;
  const g = gc;
  gc = null;
  ctx.socket.emit('gc:leave');
  for (const p of g.peers.values()) { try { p.pc.close(); } catch { /* ignore */ } }
  g.local.getTracks().forEach((t) => t.stop());
  g.screen?.stop();
  clearInterval(g.meterTimer);
  clearInterval(g.timer);
  g.audioCtx?.close?.().catch(() => {});
  g.release?.();
  g.root?.classList.remove('show');
  setTimeout(() => g.root?.remove(), 250);
  ctx.onChange?.();
}

async function rejoin() {
  const g = gc;
  const r = await emit('gc:join', { roomId: g.roomId, token: g.token, mic: g.mic, cam: g.cam });
  if (gc !== g) return;
  if (r?.error) { toast(ERR[r.error] || 'Звонок прерван', 'error'); return leaveGroupCall(); }
  g.sid = r.sid;
  for (const p of [...g.peers.keys()]) dropPeer(p);
  for (const p of r.peers) addPeer(p.sid, p.userId, p.mic, p.cam, p.screen);
  render();
}

// ------------------------------------------------------------------ peers

function addPeer(sid, userId, mic, cam, screen = false) {
  if (!gc || sid === gc.sid) return;
  if (gc.peers.has(sid)) dropPeer(sid);
  ctx.ensureUser?.(userId);
  const pc = new RTCPeerConnection({ iceServers: gc.ice });
  const peer = { sid, userId, pc, stream: new MediaStream(), mic, cam, screen, makingOffer: false, ignoreOffer: false, polite: gc.sid > sid, el: null };
  gc.peers.set(sid, peer);
  for (const t of gc.local.getAudioTracks()) pc.addTrack(t, gc.local);
  // Outgoing video: the shared screen wins over the camera.
  const v = gc.screen || gc.local.getVideoTracks()[0];
  if (v) pc.addTrack(v, gc.local);
  // Always be ready to receive audio + video even if we send none.
  if (!gc.local.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
  if (!v) pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = ({ track }) => {
    if (!peer.stream.getTracks().includes(track)) peer.stream.addTrack(track);
    track.onunmute = () => render();
    attachMeter(peer);
    render();
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) send(sid, { candidate }); };
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      send(sid, { description: pc.localDescription });
    } catch { /* retried on next negotiation */ } finally { peer.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce?.();
    render();
  };
  return peer;
}

function dropPeer(sid) {
  const p = gc?.peers.get(sid);
  if (!p) return;
  gc.peers.delete(sid);
  try { p.pc.close(); } catch { /* ignore */ }
  p.el?.remove();
}

const send = (to, data) => ctx.socket.emit('gc:signal', { to, data });

async function onSignal({ from, userId, data }) {
  if (!gc) return;
  let peer = gc.peers.get(from);
  if (!peer) peer = addPeer(from, userId, true, false);
  if (!peer) return;
  const pc = peer.pc;
  try {
    if (data.description) {
      const offerCollision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        await pc.setLocalDescription();
        send(from, { description: pc.localDescription });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn(e); }
    }
  } catch (e) { console.warn('gc signal', e); }
}

// ------------------------------------------------------------------ controls

function sendState() { ctx.socket.emit('gc:state', { mic: gc.mic, cam: gc.cam, screen: !!gc.screen }); }

/** Send `track` as our video to every peer (reusing the video transceiver). */
async function setOutgoingVideo(track) {
  for (const p of gc.peers.values()) {
    const trs = p.pc.getTransceivers().filter((t) => t.receiver.track?.kind === 'video');
    const tr = trs.find((t) => t.sender.track || /send/.test(t.direction)) || trs.find((t) => t.direction === 'recvonly');
    if (tr) {
      if (track && !/send/.test(tr.direction)) tr.direction = 'sendrecv';
      await tr.sender.replaceTrack(track);
    } else if (track) p.pc.addTrack(track, gc.local);
  }
}

async function toggleScreen() {
  if (gc.screen) return stopScreen();
  let track;
  try { track = await getScreenTrack(); } catch { return; } // cancelled
  if (!gc) { track.stop(); return; }
  gc.screen = track;
  track.onended = () => { if (gc?.screen === track) stopScreen(); };
  await setOutgoingVideo(track);
  sendState();
  toast('Вы показываете экран');
  render();
}

async function stopScreen() {
  const track = gc?.screen;
  if (!track) return;
  gc.screen = null;
  track.stop();
  gc.selfScreen = null;
  await setOutgoingVideo(gc.local.getVideoTracks()[0] || null);
  sendState();
  render();
}

function toggleMic() {
  const tracks = gc.local.getAudioTracks();
  if (!tracks.length) return toast('Нет доступа к микрофону', 'error');
  gc.mic = !gc.mic;
  tracks.forEach((t) => { t.enabled = gc.mic; });
  sendState();
  render();
}

async function toggleCam() {
  const tracks = gc.local.getVideoTracks();
  if (tracks.length) {
    gc.cam = !gc.cam;
    tracks.forEach((t) => { t.enabled = gc.cam; });
  } else {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
      const track = s.getVideoTracks()[0];
      gc.local.addTrack(track);
      if (!gc.screen) await setOutgoingVideo(track); // while sharing, peers keep seeing the screen
      gc.cam = true;
    } catch { return toast('Нет доступа к камере', 'error'); }
  }
  sendState();
  render();
}

async function flipCam() {
  const old = gc.local.getVideoTracks()[0];
  if (!old) return;
  gc.facing = gc.facing === 'environment' ? 'user' : 'environment';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: gc.facing } });
    const track = s.getVideoTracks()[0];
    for (const p of gc.peers.values()) {
      const sender = p.pc.getSenders().find((x) => x.track === old);
      await sender?.replaceTrack(track);
    }
    gc.local.removeTrack(old); old.stop(); gc.local.addTrack(track);
    render();
  } catch { toast('Не удалось переключить камеру'); }
}

function toggleSound() {
  gc.muted = !gc.muted;
  for (const p of gc.peers.values()) if (p.el) p.el.querySelector('video').muted = gc.muted;
  toast(gc.muted ? 'Звук участников выключен 🔇' : 'Звук включён');
  render();
}

async function invite() {
  if (gc.token) {
    const link = callLink(gc.token);
    if (navigator.share) { try { await navigator.share({ title: 'Звонок в Limoninior', url: link }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(link); toast('Ссылка на звонок скопирована'); } catch { toast(link); }
  } else {
    toast('Участники группы видят звонок в чате и могут присоединиться');
  }
}

function minimize() { gc.mini = true; gc.release?.(); gc.release = null; render(); }
function expand() { if (!gc) return; gc.mini = false; render(); }

// ------------------------------------------------------------------ speaking indicator

function startMeter() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    gc.audioCtx = new AC();
    gc.meters = new Map();
    if (gc.local.getAudioTracks().length) gc.meters.set('me', makeAnalyser(gc.local));
    gc.meterTimer = setInterval(tickMeters, 200);
  } catch { /* optional */ }
}

function makeAnalyser(stream) {
  const an = gc.audioCtx.createAnalyser();
  an.fftSize = 256;
  gc.audioCtx.createMediaStreamSource(stream).connect(an);
  return { an, buf: new Uint8Array(an.fftSize) };
}

function attachMeter(peer) {
  if (!gc?.audioCtx || gc.meters.has(peer.sid) || !peer.stream.getAudioTracks().length) return;
  try { gc.meters.set(peer.sid, makeAnalyser(peer.stream)); } catch { /* ignore */ }
}

function level({ an, buf }) {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += ((v - 128) / 128) ** 2;
  return Math.sqrt(sum / buf.length);
}

function tickMeters() {
  if (!gc?.root) return;
  for (const [key, m] of gc.meters) {
    const speaking = level(m) > 0.04 && (key === 'me' ? gc.mic : gc.peers.get(key)?.mic !== false);
    gc.root.querySelector(`[data-tile="${key}"]`)?.classList.toggle('speaking', speaking);
  }
}

// ------------------------------------------------------------------ UI

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function render() {
  if (!gc) return;
  if (!gc.root) {
    gc.root = h('div', { class: 'gc-overlay' });
    document.body.append(gc.root);
    requestAnimationFrame(() => gc?.root?.classList.add('show'));
    gc.timer = setInterval(() => { const t = gc?.root?.querySelector('.gc-time'); if (t) t.textContent = fmt(Math.round((Date.now() - gc.joinedAt) / 1000)); }, 1000);
  }
  if (!gc.mini && !gc.release) gc.release = registerOverlay(() => { gc.release = null; minimize(); });
  gc.root.classList.toggle('mini', gc.mini);
  const me = ctx.me();
  const count = gc.peers.size + 1;

  if (gc.mini) {
    gc.root.replaceChildren(h('div', { class: 'gc-pill' },
      h('button', { class: 'gc-pill-main', onclick: expand },
        h('span', { class: 'gc-dot' }), h('b', {}, gc.title || 'Групповой звонок'), h('span', { class: 'gc-time' }, fmt(Math.round((Date.now() - gc.joinedAt) / 1000))), h('span', {}, `· ${count}`)),
      h('button', { class: `gc-pill-btn ${gc.mic ? '' : 'off'}`, 'aria-label': 'Микрофон', onclick: toggleMic }, icon(gc.mic ? 'mic' : 'micOff')),
      h('button', { class: 'gc-pill-btn red', 'aria-label': 'Выйти', onclick: leaveGroupCall }, icon('phoneDown'))));
    return;
  }

  const items = [
    { key: 'me', user: me, stream: gc.local, mic: gc.mic, cam: gc.cam, screen: !!gc.screen, self: true },
    ...[...gc.peers.values()].map((p) => ({ key: p.sid, user: ctx.user(p.userId) || { id: p.userId, name: '…' }, stream: p.stream, mic: p.mic, cam: p.cam, screen: p.screen, peer: p })),
  ];
  // Whoever shares the screen goes first and big (spotlight layout).
  const sharer = items.find((it) => it.screen && !it.self) || items.find((it) => it.screen);
  if (sharer) items.sort((x, y) => (y === sharer) - (x === sharer));
  const grid = h('div', { class: `gc-grid n${Math.min(count, 9)} ${sharer ? 'spotlight' : ''}` });
  for (const it of items) {
    const hasVideo = it.self && it.screen ? true
      : (it.cam || it.screen) && it.stream.getVideoTracks().some((t) => t.readyState === 'live' && (it.self || !t.muted));
    let video;
    if (it.self && it.screen) {
      if (!gc.selfScreen) {
        gc.selfScreen = h('video', { autoplay: true, playsInline: true, muted: true, class: 'gc-video' });
        gc.selfScreen.srcObject = new MediaStream([gc.screen]);
      }
      video = gc.selfScreen;
    } else if (it.self) {
      gc.selfVideo ||= h('video', { autoplay: true, playsInline: true, muted: true, class: 'gc-video mirror' });
      gc.selfVideo.muted = true;
      if (gc.selfVideo.srcObject !== gc.local) gc.selfVideo.srcObject = gc.local;
      video = gc.selfVideo;
    } else {
      // Keep one media element per peer so audio never restarts.
      if (!it.peer.media) {
        it.peer.media = h('video', { autoplay: true, playsInline: true, class: 'gc-video' });
        it.peer.media.srcObject = it.peer.stream;
      }
      it.peer.media.muted = gc.muted;
      video = it.peer.media;
      video.play?.().catch(() => {});
    }
    const t = h('div', { class: `gc-tile ${hasVideo ? 'has-video' : ''} ${it === sharer ? 'screen' : ''}`, dataset: { tile: it.key } },
      video,
      hasVideo ? null : h('div', { class: 'gc-ava' }, avatar(it.user, 84)),
      it.screen ? h('div', { class: 'gc-screen-tag' }, icon('screen'), it.self ? 'Вы показываете экран' : 'Экран') : null,
      h('div', { class: 'gc-name' }, it.mic ? null : icon('micOff', 'gc-mute'), h('span', {}, it.self ? 'Вы' : it.user.name),
        !it.self && it.peer.pc.connectionState && !['connected', 'new'].includes(it.peer.pc.connectionState) ? h('span', { class: 'gc-conn' }, 'соединение…') : null));
    if (it.peer) it.peer.el = t;
    grid.append(t);
  }

  const btn = (cls, ic, label, onClick) => h('div', { class: 'call-btn-wrap' },
    h('button', { class: `call-btn ${cls}`, 'aria-label': label, onclick: onClick }, icon(ic)), h('span', {}, label));
  const phone = /Android|iPhone|iPad/i.test(navigator.userAgent);
  gc.root.replaceChildren(...[
    h('div', { class: 'gc-top' },
      h('button', { class: 'gc-top-btn', 'aria-label': 'Свернуть', onclick: minimize }, icon('down')),
      h('div', { class: 'gc-title' }, h('b', {}, gc.title || 'Групповой звонок'),
        h('span', {}, h('span', { class: 'gc-time' }, fmt(Math.round((Date.now() - gc.joinedAt) / 1000))), ` · ${count} ${count === 1 ? 'участник' : count < 5 ? 'участника' : 'участников'}`)),
      h('button', { class: 'gc-top-btn', 'aria-label': 'Пригласить', onclick: invite }, icon(gc.token ? 'share' : 'group'))),
    grid,
    count === 1 ? h('div', { class: 'gc-alone' }, gc.token ? 'Вы пока одни. Отправьте ссылку, чтобы позвать людей' : 'Ждём участников группы…',
      gc.token ? h('button', { class: 'btn btn-sm', onclick: invite }, icon('share'), 'Ссылка на звонок') : null) : null,
    h('div', { class: 'call-controls' },
      btn(`glass ${gc.mic ? '' : 'off'}`, gc.mic ? 'mic' : 'micOff', gc.mic ? 'Микрофон' : 'Микр. выкл.', toggleMic),
      btn(`glass ${gc.cam ? 'lit' : ''}`, gc.cam ? 'video' : 'videoOff', 'Камера', toggleCam),
      gc.cam && phone ? btn('glass', 'refresh', 'Повернуть', flipCam) : null,
      canShareScreen() ? btn(`glass ${gc.screen ? 'lit' : ''}`, 'screen', gc.screen ? 'Остановить' : 'Экран', toggleScreen) : null,
      btn(`glass ${gc.muted ? 'off' : ''}`, gc.muted ? 'volumeOff' : 'volume', gc.muted ? 'Звук выкл.' : 'Звук', toggleSound),
      btn('red', 'phoneDown', 'Выйти', leaveGroupCall))].filter(Boolean));
}
