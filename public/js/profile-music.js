import {api,errorText} from './api.js';
import {h,icon,toast,openModal,confirmDialog} from './ui.js';

const VOLUME_KEY='limochat.profileMusicVolume';
function readVolume(){try{const raw=localStorage.getItem(VOLUME_KEY);if(raw!==null&&Number.isFinite(Number(raw)))return Math.min(1,Math.max(0,Number(raw)));}catch{}return 0.3;}
const player={audio:null,url:null,queue:[],index:0,volume:readVolume()};
const views=new Set();
function updateViews(){for(const view of views){if(!view.el.isConnected){views.delete(view);continue;}view.update();}}
function play(queue,index){
 const track=queue[index];if(!track)return;
 player.audio?.pause();
 const audio=new Audio(track.url);audio.volume=player.volume;
 Object.assign(player,{audio,url:track.url,queue,index});
 const update=()=>{if(player.audio===audio)updateViews();};
 for(const event of ['play','pause','timeupdate','loadedmetadata'])audio.addEventListener(event,update);
 audio.addEventListener('ended',()=>{if(player.audio!==audio)return;if(index+1<queue.length)play(queue,index+1);else updateViews();});
 audio.addEventListener('error',()=>{if(player.audio===audio){toast('Не удалось загрузить трек','error');updateViews();}});
 audio.play().catch(()=>{if(player.audio===audio)toast('Не удалось воспроизвести','error');});
 updateViews();
}
export function stopTrack(){player.audio?.pause();player.audio=null;player.url=null;player.queue=[];updateViews();}
export function trackEl(track,queue=[track],index=0){
 if(!track)return null;
 const btn=h('button',{type:'button',class:'pf-track-btn','aria-label':'Слушать '+track.name},icon('play'));
 const bar=h('i',{class:'pf-track-bar'});
 const volume=h('input',{type:'range',min:0,max:100,step:1,value:Math.round(player.volume*100),'aria-label':'Громкость музыки',class:'pf-music-volume'});
 const level=h('span',{class:'small'},Math.round(player.volume*100)+'%');
 const previous=h('button',{type:'button',class:'btn btn-ghost btn-sm','aria-label':'Предыдущий трек',onclick:()=>play(queue,Math.max(0,index-1))},'‹');
 const next=h('button',{type:'button',class:'btn btn-ghost btn-sm','aria-label':'Следующий трек',onclick:()=>play(queue,Math.min(queue.length-1,index+1))},'›');
 previous.disabled=index===0;next.disabled=index===queue.length-1;
 const el=h('div',{class:'pf-track pf-music-track'},h('div',{class:'pf-music-main'},btn,h('div',{class:'grow'},h('div',{class:'pf-track-name'},'🎵 ',track.name),h('div',{class:'pf-track-line'},bar)),queue.length>1?previous:null,queue.length>1?next:null),h('label',{class:'pf-music-volume-row'},h('span',{},'Громкость'),volume,level));
 const update=()=>{const active=player.url===track.url&&player.audio,playing=active&&!player.audio.paused&&!player.audio.ended;btn.replaceChildren(icon(playing?'pause':'play'));btn.setAttribute('aria-label',(playing?'Пауза: ':'Слушать ')+track.name);el.classList.toggle('playing',!!playing);bar.style.width=(active&&player.audio.duration?player.audio.currentTime/player.audio.duration*100:0)+'%';volume.value=String(Math.round(player.volume*100));level.textContent=volume.value+'%';};
 views.add({el,update});update();
 volume.addEventListener('input',()=>{player.volume=Number(volume.value)/100;if(player.audio)player.audio.volume=player.volume;try{localStorage.setItem(VOLUME_KEY,String(player.volume));}catch{}updateViews();});
 btn.addEventListener('click',()=>{if(player.url===track.url&&player.audio){if(player.audio.paused)player.audio.play().catch(()=>toast('Не удалось воспроизвести','error'));else player.audio.pause();}else play(queue,index);});
 return el;
}
export function playlistsEl(playlists){
 if(!playlists?.length)return null;
 return h('div',{class:'pf-playlists'},...playlists.map(list=>h('details',{class:'pf-playlist'},h('summary',{},list.name+' · '+list.tracks.length),...(list.tracks.length?list.tracks.map((track,index)=>trackEl(track,list.tracks,index)):[h('p',{class:'muted small'},'В плейлисте пока нет треков')]))));
}

export function playlistEditor(px,onUpdate){
 const box=h('div',{class:'pf-playlist-editor'});
 const apply=result=>{px.playlists=result.px.playlists||[];onUpdate(result.px);stopTrack();draw();};
 let busy=false;
 const run=async fn=>{if(busy)return;busy=true;box.classList.add('busy');try{await fn();}catch(error){toast(errorText(error),'error');}finally{busy=false;box.classList.remove('busy');}};
 function nameDialog(list){
  const input=h('input',{class:'input',maxLength:60,value:list?.name||'',placeholder:'Название плейлиста'});let modal;
  modal=openModal({title:list?'Название плейлиста':'Новый плейлист',body:input,actions:[{label:'Сохранить',primary:true,onClick:()=>run(async()=>{const name=input.value.trim();if(!name)return toast('Введите название','error');const result=list?await api.patch('/me/playlists/'+list.id,{name}):await api.post('/me/playlists',{name});apply(result);modal.close();})}]});
 }
 function draw(){
  const playlists=px.playlists||[];
  box.replaceChildren(h('p',{class:'muted small'},'До 5 плейлистов и 20 треков суммарно. Каждый файл — до 10 МБ. Музыку видят посетители профиля.'));
  for(const list of playlists){
   const upload=h('input',{type:'file',accept:'audio/*,.mp3,.m4a,.ogg,.wav',class:'hidden'});
   upload.addEventListener('change',()=>{const file=upload.files[0];upload.value='';if(!file)return;if(file.size>10*1024*1024)return toast('Файл больше 10 МБ','error');run(async()=>{const data=new FormData();data.append('file',file,file.name);apply(await api.post('/me/playlists/'+list.id+'/tracks',data));});});
   const move=(index,delta)=>run(async()=>{const ids=list.tracks.map(t=>t.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];apply(await api.patch('/me/playlists/'+list.id,{trackIds:ids}));});
   const rows=list.tracks.map((track,index)=>h('div',{class:'pf-playlist-edit-track'},h('div',{class:'grow'},trackEl(track,list.tracks,index)),h('div',{class:'pf-cover-acts'},h('button',{type:'button',class:'btn btn-ghost btn-sm',disabled:index===0,'aria-label':'Выше: '+track.name,onclick:()=>move(index,-1)},'↑'),h('button',{type:'button',class:'btn btn-ghost btn-sm',disabled:index===list.tracks.length-1,'aria-label':'Ниже: '+track.name,onclick:()=>move(index,1)},'↓'),h('button',{type:'button',class:'btn btn-danger-ghost btn-sm',onclick:()=>run(async()=>{if(await confirmDialog('Удалить трек «'+track.name+'» из плейлиста?',{ok:'Удалить',danger:true}))apply(await api.del('/me/playlists/'+list.id+'/tracks/'+track.id));})},'Удалить трек'))));
   box.append(h('section',{class:'pf-playlist'},h('b',{},list.name+' · '+list.tracks.length),...rows,upload,h('div',{class:'pf-cover-acts'},h('button',{type:'button',class:'btn btn-ghost btn-sm',onclick:()=>upload.click()},'Добавить трек'),h('button',{type:'button',class:'btn btn-ghost btn-sm',onclick:()=>nameDialog(list)},'Переименовать'),h('button',{type:'button',class:'btn btn-danger-ghost btn-sm',onclick:()=>run(async()=>{if(await confirmDialog('Удалить плейлист «'+list.name+'» и все его треки?',{ok:'Удалить',danger:true}))apply(await api.del('/me/playlists/'+list.id));})},'Удалить плейлист'))));
  }
  if(playlists.length<5)box.append(h('button',{type:'button',class:'btn btn-ghost',onclick:()=>nameDialog()},'Создать плейлист'));
 }
 draw();return box;
}
