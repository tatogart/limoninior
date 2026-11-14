import {api,errorText} from './api.js';
import {h,icon,openModal,toast,confirmDialog,closeTopModal,afterHistory,timeHM,dayLabel} from './ui.js';
import {chatMatches,exportTranscript,localDateRange,rankChats} from './workspace-model.js';

const hubs=new Set();
let C, W={chats:[],folders:[],bookmarks:[],templates:[],tasks:[]},scope='all',bar,ready=false,refreshTimer;
const btn=(label,fn,cls='')=>h('button',{type:'button',class:`btn ${cls}`,onclick:fn},label);
const small=(text)=>h('p',{class:'ws-hint'},text);
const field=(label,el)=>h('label',{class:'ws-field'},h('span',{},label),el);
const input=(placeholder,maxLength=60)=>h('input',{class:'input',placeholder,maxLength});
const textArea=(placeholder,maxLength)=>h('textarea',{class:'input ws-textarea',placeholder,maxLength,rows:5});
const prefs=(id)=>W.chats.find(p=>p.chatId===id)||{};
const title=(id)=>{const c=C.S.chats.get(id);return c?C.chatTitle(c):'Чат';};
const stamp=(at)=>`${dayLabel(at)} ${timeHM(at)}`;
const run=async(fn)=>{try{return await fn();}catch(e){toast(errorText(e),'error');return false;}};
const mutation=async(fn)=>{await fn();await refreshWorkspace();return true;};
const closeAnd=(fn)=>{while(closeTopModal()){}afterHistory(fn);};
const accessibleChats=()=>[...C.S.chats.values()].filter(c=>!c.preview);
export function initWorkspace(context){C=context;scope='all';ready=false;W={chats:[],folders:[],bookmarks:[],templates:[],tasks:[]};}
let refreshQueue=Promise.resolve();
export function refreshWorkspace(){
 refreshQueue=refreshQueue.catch(()=>{}).then(async()=>{
  if(!C?.S.me)return;
  try{W=await api.get('/workspace');ready=true;
   if(scope.startsWith('folder:')&&!W.folders.some(f=>`folder:${f.id}`===scope))scope='all';
   renderBar();C.renderChatList();
  }catch(e){ready=false;renderBar();throw e;}
 });
 return refreshQueue;
}

export function workspaceChanged(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refreshWorkspace().catch(()=>{}),100);}
export function workspaceFilter(c){return chatMatches(c,scope,W,C.S.drafts);}
export function updateWorkspaceBar(){renderBar();}
export function workspaceOpened(id){if(prefs(id).unread)run(()=>mutation(()=>api.patch(`/workspace/chats/${id}`,{unread:false})));}
export function workspaceAll(){return scope==='all';}
export function workspaceUnread(c){return !!prefs(c.id).unread;}
export function workspaceBar(){bar=h('div',{class:'ws-bar','aria-label':'Фильтры чатов'});renderBar();return bar;}
function setScope(value){scope=value;C.clearSearch();C.closeCommunity();renderBar();C.renderChatList();}
function renderBar(){
 if(!bar)return;
 const offset=bar.querySelector('.ws-chips')?.scrollLeft||0;
 const chips=[['all','Все'],['unread','Не прочитано'],['drafts','Черновики'],['archive','Архив'],...W.folders.map(f=>['folder:'+f.id,f.name])];
 bar.replaceChildren(...[h('div',{class:'ws-chips'},chips.map(([id,name])=>{
  const count=accessibleChats().filter(c=>chatMatches(c,id,W,C.S.drafts)).length;
  return h('button',{type:'button',class:`ws-chip ${scope===id?'selected':''}`,'aria-pressed':scope===id,onclick:()=>setScope(id)},name,id!=='all'&&count?h('span',{},String(count)):null);
 })),h('button',{class:'icon-btn ws-tools','aria-label':'Органайзер',title:'Органайзер',onclick:()=>workspaceHub()},icon('bookmark')),
 !ready?h('button',{class:'ws-retry',onclick:()=>run(refreshWorkspace)},'Загрузить папки'):null].filter(Boolean));
 bar.querySelector('.ws-chips').scrollLeft=offset;
}
export function workspaceChatItems(c){
 if(c.preview)return [];
 return [
  {icon:'bookmark',label:'Добавить в папку',onClick:()=>assignFolders(c)},
  {icon:'download',label:prefs(c.id).archived?'Вернуть из архива':'В архив',onClick:()=>run(async()=>{await refreshWorkspace();await mutation(()=>api.patch(`/workspace/chats/${c.id}`,{archived:!prefs(c.id).archived}));toast('Сохранено');})},
  {icon:'eye',label:prefs(c.id).unread?'Снять отметку «не прочитано»':'Отметить непрочитанным',onClick:()=>run(async()=>{await refreshWorkspace();await mutation(()=>api.patch(`/workspace/chats/${c.id}`,{unread:!prefs(c.id).unread}));})},
  {icon:'pencil',label:'Личная заметка к чату',onClick:()=>requireReady(()=>noteEditor(c))},
 ];
}
export function workspaceMessageItems(m){
 if(!Number.isSafeInteger(m.id))return [];
 return [
  {icon:'bookmark',label:W.bookmarks.some(b=>b.messageId===m.id)?'Изменить закладку':'В закладки',onClick:()=>bookmarkEditor(m)},
  {icon:'check',label:'Создать личную задачу',onClick:()=>taskEditor(null,m)},
 ];
}
function editor(titleText,body,save,{remove}={}){
 let modal,busy=false;
 const submit=btn('Сохранить',()=>run(async()=>{
  if(busy)return;busy=true;submit.disabled=true;
  try{if(await save()!==false){modal.close();toast('Сохранено');}}
  finally{busy=false;submit.disabled=false;}
 }),'btn-primary');
 modal=openModal({title:titleText,className:'ws-modal',body:h('div',{class:'ws-stack'},body,h('div',{class:'ws-actions'},[
  ...(remove?[btn('Удалить',()=>run(async()=>{if(await confirmDialog('Удалить эту запись?',{ok:'Удалить',danger:true})){await remove();modal.close();}}),'btn-danger')]:[]),submit])),onClose:()=>{for(const draw of hubs)draw();}});
 return modal;
}
function requireReady(fn){return run(async()=>{await refreshWorkspace();fn();});}
export function workspaceHub(initial='bookmarks'){
 return requireReady(()=>{
  const body=h('div',{class:'ws-stack'}),content=h('div',{class:'ws-content'}),tabs=h('div',{class:'ws-tabs'});
  let active=initial;
  const render=()=>{
   tabs.replaceChildren(...[['bookmarks','Закладки'],['tasks','Задачи'],['notes','Заметки'],['templates','Шаблоны'],['folders','Папки']].map(([id,name])=>h('button',{class:`ws-chip ${active===id?'selected':''}`,'aria-pressed':active===id,onclick:()=>{active=id;render();}},name)));
   content.replaceChildren();
   if(active==='bookmarks')bookmarksView(content);
   if(active==='tasks')tasksView(content,render);
   if(active==='notes')notesView(content);
   if(active==='templates')templatesView(content);
   if(active==='folders')foldersView(content);
  };
  body.append(h('div',{class:'ws-intro'},h('b',{},'Важное — под рукой'),small('Личные папки, закладки и задачи. Сохраняются в вашем аккаунте; собеседники их не видят.')),
   h('div',{class:'ws-actions'},btn('Поиск сообщений',()=>workspaceSearch()),btn('Быстрый переход',commandPalette),btn('Прочитать все',readAll)),tabs,content,
   btn('Обновить',()=>run(async()=>{await refreshWorkspace();render();}),'btn-ghost'));
  openModal({title:'Органайзер',className:'ws-modal',body,onClose:()=>hubs.delete(render)});hubs.add(render);render();
 });
}
function foldersView(root){
 root.append(btn('Новая папка',()=>folderEditor()),small(`Папки: ${W.folders.length}/${W.limits?.folders??5}. Больше папок доступно с подпиской. Архив хранится отдельно.`));
 for(const f of W.folders)root.append(h('div',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},f.name),small(`${f.chatIds.length} чатов`)),btn('Открыть',()=>closeAnd(()=>setScope('folder:'+f.id))),btn('Изменить',()=>folderEditor(f))));
 if(!W.folders.length)root.append(small('Создайте папки «Учёба», «Друзья» или «Работа» и выберите чаты.'));
}
function folderEditor(f,initialIds=[]){
 const name=input('Название папки',32);name.value=f?.name||'';
 const selected=new Set(f?.chatIds||initialIds),list=h('div',{class:'ws-picker'}),search=input('Найти чат');
 const draw=()=>{list.replaceChildren(...rankChats(accessibleChats(),search.value,C.chatTitle).map(c=>h('label',{class:'ws-check'},h('input',{type:'checkbox',checked:selected.has(c.id),onchange:e=>e.target.checked?selected.add(c.id):selected.delete(c.id)}),C.chatTitle(c))));};
 search.addEventListener('input',draw);draw();
 editor(f?'Изменить папку':'Новая папка',[field('Название',name),search,list],async()=>{
  if(!name.value.trim()){name.focus();return false;}
  const data={name:name.value,chatIds:[...selected]};
  if(f)await api.put(`/workspace/folders/${f.id}`,data);
  else await api.post('/workspace/folders',data);
  await refreshWorkspace();
 },{remove:f?()=>mutation(()=>api.del(`/workspace/folders/${f.id}`)):null});
}
function assignFolders(c){
 return requireReady(()=>{
  if(!W.folders.length)return folderEditor(null,[c.id]);
  const picked=new Set(W.folders.filter(f=>f.chatIds.includes(c.id)).map(f=>f.id));
  editor('Папки чата',W.folders.map(f=>h('label',{class:'ws-check'},h('input',{type:'checkbox',checked:picked.has(f.id),onchange:e=>e.target.checked?picked.add(f.id):picked.delete(f.id)}),f.name)),async()=>{
   for(const f of W.folders){const ids=new Set(f.chatIds);picked.has(f.id)?ids.add(c.id):ids.delete(c.id);
    if(ids.has(c.id)!==f.chatIds.includes(c.id))await api.put(`/workspace/folders/${f.id}`,{name:f.name,chatIds:[...ids]});}
   await refreshWorkspace();
  });
 });
}
function noteEditor(c){
 const note=textArea('Что важно помнить об этом чате?',4000);note.value=prefs(c.id).note||'';
 editor('Заметка · '+C.chatTitle(c),[small('Видна только вам. Чтобы удалить заметку, сохраните пустой текст.'),field('Личная заметка',note)],()=>mutation(()=>api.patch(`/workspace/chats/${c.id}`,{note:note.value})));
}
function notesView(root){
 const search=input('Поиск в заметках',100),list=h('div');
 const draw=()=>{const q=search.value.trim().toLowerCase();const notes=W.chats.filter(p=>p.note&&`${p.note} ${title(p.chatId)}`.toLowerCase().includes(q));
  list.replaceChildren(...notes.map(p=>h('div',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},title(p.chatId)),h('p',{class:'ws-pre'},p.note)),btn('Изменить',()=>{const c=C.S.chats.get(p.chatId);if(c)noteEditor(c);}))));if(!notes.length)list.append(small('Заметок нет. Добавьте личную заметку через меню нужного чата.'));};
 search.addEventListener('input',draw);root.append(search,list);draw();
}
function bookmarkEditor(m){
 const old=W.bookmarks.find(b=>b.messageId===m.id),tag=input('Например: Учёба',32);tag.value=old?.tag||'';
 editor('Закладка',[small(C.messagePreview(m)),field('Метка (необязательно)',tag)],()=>mutation(()=>api.put(`/workspace/bookmarks/${m.id}`,{tag:tag.value})),{remove:old?()=>mutation(()=>api.del(`/workspace/bookmarks/${m.id}`)):null});
}
function messageCard(m,{tag,extra}={}){
 return h('article',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},title(m.chatId)),small(`${m.senderName||C.userName(m.senderId)} · ${stamp(m.createdAt)}${tag?' · '+tag:''}`),h('p',{class:'ws-pre'},C.messagePreview(m)),
  h('div',{class:'ws-actions'},btn('К сообщению',()=>C.jumpToMessage(m.chatId,m.id)),extra)));
}
function bookmarksView(root){
 const query=input('Поиск по тексту и метке',100),list=h('div'),more=btn('Загрузить ещё',()=>run(load));let items=[],before;
 const draw=()=>{const term=query.value.trim().toLowerCase();const matches=items.filter(i=>`${i.tag} ${C.messagePreview(i.message)} ${title(i.message.chatId)}`.toLowerCase().includes(term));
  list.replaceChildren(...matches.map(i=>messageCard(i.message,{tag:i.tag,extra:btn('Метка',()=>bookmarkEditor(i.message))})));if(!matches.length)list.append(small('Закладок не найдено. Сохраните важное сообщение через его меню.'));};
 async function load(){more.disabled=true;try{const r=await api.get('/workspace/bookmarks'+(before?'?before='+before:''));items.push(...r.items);before=items.at(-1)?.message.id;more.hidden=!r.hasMore;draw();}finally{more.disabled=false;}}
 query.addEventListener('input',draw);root.append(query,small('Поиск по загруженным закладкам. Для старых записей нажмите «Загрузить ещё».'),list,more);run(load);
}
function templateEditor(t){
 const name=input('Название',60),text=textArea('Текст быстрого ответа',4096);name.value=t?.title||'';text.value=t?.text||'';
 editor(t?'Изменить шаблон':'Новый шаблон',[field('Название',name),field('Текст',text),small('Шаблон вставляется в поле сообщения. Отправляете его вы.')],()=>{
  if(!name.value.trim()||!text.value.trim()){toast('Заполните название и текст');return false;}
  return mutation(()=>t?api.put(`/workspace/templates/${t.id}`,{title:name.value,text:text.value}):api.post('/workspace/templates',{title:name.value,text:text.value}));
 },{remove:t?()=>mutation(()=>api.del(`/workspace/templates/${t.id}`)):null});
}
export function templatePicker(){return workspaceHub('templates');}
function templatesView(root){
 root.append(btn('Создать шаблон',()=>templateEditor()),small(`Шаблоны: ${W.templates.length}/${W.limits?.templates??5}. Вставляются в чат без автоматической отправки.`));
 for(const t of W.templates)root.append(h('div',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},t.title),h('p',{class:'ws-pre'},t.text)),h('div',{class:'ws-actions'},btn('Вставить',()=>{if(C.insertTemplate(t.text))closeAnd(()=>C.focusComposer());}),btn('Изменить',()=>templateEditor(t)))));
 if(!W.templates.length)root.append(small('Сохраните ответы, адреса или инструкции, которые часто отправляете.'));
}
function taskEditor(t,m){
 const text=textArea('Что нужно сделать?',500);text.value=t?.text|| (m?C.messagePreview(m).slice(0,500):'');
 const date=h('input',{class:'input',type:'datetime-local'});
 if(t?.due){const d=new Date(t.due);date.value=new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 editor(t?'Изменить задачу':'Новая задача',[field('Задача',text),field('Срок (необязательно)',date),small('Личный список дел. Просроченные задачи выделяются; push-напоминание здесь не создаётся.')],()=>{
  if(!text.value.trim())return false;
  const data={text:text.value,due:date.value?+new Date(date.value):null,done:!!t?.done,...(m?{messageId:m.id}:{})};
  return mutation(()=>t?api.put(`/workspace/tasks/${t.id}`,data):api.post('/workspace/tasks',data));
 },{remove:t?()=>mutation(()=>api.del(`/workspace/tasks/${t.id}`)):null});
}
function tasksView(root,redraw){
 let mode='open';const list=h('div'),select=h('select',{class:'input','aria-label':'Фильтр задач'},[['open','В работе'],['late','Просрочены'],['done','Выполнены'],['all','Все задачи']].map(([v,t])=>h('option',{value:v},t)));
 const draw=()=>{const tasks=W.tasks.filter(t=>mode==='all'||mode==='done'&&t.done||mode==='open'&&!t.done||mode==='late'&&!t.done&&t.due&&t.due<Date.now());
  list.replaceChildren(...tasks.map(t=>h('div',{class:`ws-card ${!t.done&&t.due&&t.due<Date.now()?'ws-overdue':''}`},h('input',{type:'checkbox','aria-label':'Задача выполнена: '+t.text,checked:!!t.done,onchange:e=>{const done=e.target.checked;e.target.disabled=true;run(async()=>{try{await mutation(()=>api.put(`/workspace/tasks/${t.id}`,{text:t.text,due:t.due,done}));draw();}catch(err){e.target.checked=!!t.done;throw err;}finally{e.target.disabled=false;}});}}),
   h('div',{class:'ws-card-body'},h('p',{class:`ws-pre ${t.done?'ws-done':''}`},t.text),t.due?small('Срок: '+stamp(t.due)):null,h('div',{class:'ws-actions'},btn('Изменить',()=>taskEditor(t)),t.messageId?btn('Источник',()=>C.jumpToMessage(t.chatId,t.messageId)):null)))));
  if(!tasks.length)list.append(small('Здесь пока нет задач. Создайте новую или превратите сообщение в задачу.'));};
 select.addEventListener('change',()=>{mode=select.value;draw();});root.append(h('div',{class:'ws-actions'},btn('Новая задача',()=>taskEditor()),select),list);draw();
}
async function readAll(){
 const chats=accessibleChats().filter(c=>workspaceFilter(c)&&(c.unread||prefs(c.id).unread));
 if(!chats.length)return toast('Нет непрочитанных чатов в этом разделе');
 if(!await confirmDialog(`Прочитать все чаты в текущем разделе (${chats.length})? Собеседники увидят отметку прочтения.`,{ok:'Прочитать'}))return;
 await run(async()=>{for(let i=0;i<chats.length;i+=500)await api.post('/workspace/read-all',{chatIds:chats.slice(i,i+500).map(c=>c.id)});await refreshWorkspace();toast('Все чаты раздела прочитаны');});
}
export function commandPalette(){
 const query=input('Название чата или @юзернейм',100),list=h('div',{class:'ws-picker'});
 const draw=()=>{const chats=rankChats(accessibleChats(),query.value,C.chatTitle).slice(0,40);
  list.replaceChildren(...chats.map(c=>btn(`${C.chatTitle(c)}${prefs(c.id).archived?' · архив':''}`,()=>closeAnd(()=>C.openChat(c.id)),'ws-command')));
  if(!chats.length)list.append(small('Чатов не найдено'));};
 query.addEventListener('input',draw);query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();list.querySelector('button')?.click();}});
 openModal({title:'Быстрый переход · Ctrl / ⌘ K',className:'ws-modal',body:h('div',{class:'ws-stack'},query,list,h('div',{class:'ws-actions'},btn('Органайзер',()=>workspaceHub()),btn('Поиск сообщений',()=>workspaceSearch())))});draw();setTimeout(()=>query.focus(),50);
}
export function workspaceSearch(chat=null,media=false){
 const query=input(media?'Название файла или подпись':'Что найти?',100);
 const kind=h('select',{class:'input','aria-label':'Тип сообщения'},[['all','Все сообщения'],['text','Текст'],['image','Фото'],['file','Файлы'],['links','Ссылки'],['voice','Голосовые'],['circle','Кружки']].map(([v,t])=>h('option',{value:v},t)));kind.value=media?'file':'all';
 const from=h('input',{class:'input',type:'date'}),to=h('input',{class:'input',type:'date'});
 const sender=h('select',{class:'input','aria-label':'Автор сообщений'},[['all','Все авторы'],['me','Только мои'],['others','Другие участники']].map(([v,t])=>h('option',{value:v},t)));
 const list=h('div',{'aria-live':'polite'}),status=h('p',{class:'ws-hint'}),more=btn('Загрузить ещё',()=>run(()=>load(false)));
 let epoch=0,before,hasMore=false,alive=true,timer;
 const filterFields=[query,kind,from,to,sender];
 async function load(reset=true){
  const n=++epoch;clearTimeout(timer);
  if(reset){before=undefined;list.replaceChildren();}
  const p=new URLSearchParams({q:query.value,kind:kind.value,sender:sender.value});
  if(chat)p.set('chatId',chat.id);
  try{for(const [key,value] of Object.entries(localDateRange(from.value,to.value)))p.set(key,String(value));}
  catch{status.textContent='Проверьте даты: начало периода должно быть не позже конца.';more.hidden=true;return;}
  if(before)p.set('before',before);
  more.disabled=true;status.textContent='Ищем…';
  try{
   const r=await api.get('/workspace/search?'+p);
   if(!alive||n!==epoch)return;
   before=r.messages.at(-1)?.id||before;hasMore=r.hasMore;
   for(const m of r.messages)list.append(messageCard(m,{extra:h('span',{class:'ws-actions'},m.kind==='image'?btn('Открыть фото',()=>C.openViewer(m)):null,m.kind==='file'?btn('Скачать файл',()=>C.downloadFile(m)):null,m.kind==='voice'?h('audio',{controls:true,preload:'none',src:m.file}):null,m.kind==='circle'?h('video',{controls:true,preload:'none',src:m.file,class:'ws-video'}):null,btn('Закладка',()=>bookmarkEditor(m)),btn('В задачу',()=>taskEditor(null,m)))}));
   status.textContent=list.childElementCount?`Найдено: ${list.childElementCount}${hasMore?' · есть ещё':''}`:'Ничего не найдено. Попробуйте другой текст или период.';
   more.hidden=!hasMore;
  }catch(e){if(alive&&n===epoch){status.textContent=errorText(e);more.hidden=true;}}
  finally{if(n===epoch)more.disabled=false;}
 }
 const search=btn('Найти',()=>run(()=>load(true)),'btn-primary');
 for(const el of filterFields)el.addEventListener(el===query?'input':'change',()=>{epoch++;clearTimeout(timer);timer=setTimeout(()=>load(true),el===query?300:0);});
 query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();load(true);}});
 openModal({title:media?'Вложения · '+C.chatTitle(chat):chat?'Поиск · '+C.chatTitle(chat):'Поиск во всех чатах',className:'ws-modal',
  body:h('div',{class:'ws-stack'},query,h('div',{class:'ws-grid'},field('Тип',kind),field('Автор',sender),field('С даты',from),field('По дату включительно',to)),search,status,list,more),
  onClose:()=>{alive=false;epoch++;clearTimeout(timer);}});
 load(true);
}
export function exportChat(c){
 const status=small('Текст и сведения о вложениях. Сами файлы не скачиваются; ссылки требуют доступа к чату.'),format=h('select',{class:'input','aria-label':'Формат экспорта'},h('option',{value:'txt'},'Текст (.txt)'),h('option',{value:'json'},'JSON (.json)'));
 let cancelled=false,busy=false;
 const start=btn('Скачать переписку',()=>run(async()=>{
  if(busy)return;busy=true;start.disabled=true;format.disabled=true;
  try{
   let before,ceiling,more=true;const messages=[];
   while(more&&!cancelled){
    const p=new URLSearchParams();if(before)p.set('before',before);if(ceiling)p.set('ceiling',ceiling);
    const r=await api.get(`/workspace/chats/${c.id}/export?${p}`);
    if(cancelled)return;
    messages.push(...r.messages);ceiling=r.ceiling;before=r.messages.at(-1)?.id;more=r.hasMore;
    status.textContent=`Подготовлено ${messages.length} сообщений…`;
    if(messages.length>=50000&&more)throw new Error('export_limit');
   }
   if(cancelled)return;
   const value=exportTranscript(messages,C.chatTitle(c),format.value);
   const blob=new Blob([value],{type:format.value==='json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
   const link=h('a',{href:url,download:`limochat-${c.id}-${new Date().toISOString().slice(0,10)}.${format.value}`});
   document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
   status.textContent=`Готово: ${messages.length} сообщений. Файл передан браузеру для сохранения.`;
  }catch(e){status.textContent=e.message==='export_limit'?'В чате больше 50 000 сообщений. Экспорт остановлен без создания неполного файла.':errorText(e);}
  finally{busy=false;start.disabled=false;format.disabled=false;}
 }),'btn-primary');
 openModal({title:'Экспорт · '+C.chatTitle(c),className:'ws-modal',body:h('div',{class:'ws-stack'},status,field('Формат',format),start,small('Закройте окно, чтобы остановить подготовку. Личные заметки и задачи в экспорт не входят.')),
 onClose:()=>{cancelled=true;}});
}

export function openMessageContext(messageId){
 return run(async()=>{
  const {messages}=await api.get(`/workspace/messages/${messageId}/context`);
  const body=h('div',{class:'ws-stack'},small('Фрагмент старой переписки: до 20 сообщений до и после выбранного.'));
  for(const m of messages)body.append(h('article',{class:`ws-card ${m.id===messageId?'ws-target':''}`},h('div',{class:'ws-card-body'},h('b',{},m.senderName),small(stamp(m.createdAt)),h('p',{class:'ws-pre'},C.messagePreview(m)),m.kind==='image'?btn('Открыть фото',()=>C.openViewer(m)):null,m.kind==='file'?btn('Скачать файл',()=>C.downloadFile(m)):null)));
  openModal({title:'Контекст сообщения',className:'ws-modal',body});
  requestAnimationFrame(()=>body.querySelector('.ws-target')?.scrollIntoView({block:'center'}));
 });
}
