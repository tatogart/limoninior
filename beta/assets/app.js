import {h,icon,avatar,richText,timeHM} from '/js/ui.js';
import {stickerInfo} from '/js/catalog.js';
import {errorText} from '/js/api.js';
const root=document.querySelector('#beta-app');
const state={me:null,chats:[],current:null,messages:[],filter:'all',query:'',focus:false,inspector:true,tab:'notes',epoch:0,sending:false,drafts:{},settings:{theme:'light',dense:false,quick:true,accent:'mint'},notes:{}};
const view={};let timer,polling=false,toastTimer;
function toast(text){const el=document.querySelector('#beta-toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem('limo.beta.'+state.me.id+'.'+key))||fallback;}catch{return fallback;}}
function saveLocal(key,value){try{localStorage.setItem('limo.beta.'+state.me.id+'.'+key,JSON.stringify(value));}catch{toast('Браузер не разрешает сохранять данные на устройстве.');}}
async function request(path,{method='GET',body,beta=false}={}){
 const headers={};if(state.me)headers['X-Limochat-Account']=String(state.me.id);
 if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const response=await fetch((beta?'/api/beta':'/api/beta/app')+path,{method,credentials:'same-origin',cache:'no-store',headers,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){if(data.error==='beta_access_required'||response.status===401||data.error==='account_changed'){clearInterval(timer);location.replace('/beta');}throw Object.assign(new Error(data.error||'network'),{code:data.error,status:response.status,data});}
 return data;
}
const btn=(ic,label,action,extra={})=>h('button',{type:'button',class:'icon-button',title:label,'aria-label':label,onclick:action,...extra},icon(ic));
const title=chat=>chat?.title||chat?.peer?.name||'Чат';
const preview=message=>!message?'Начните общение':message.kind==='sticker'?'Стикер':message.kind==='image'?'Фото':message.kind==='file'?'Файл: '+(message.extra?.name||'вложение'):message.kind==='voice'?'Голосовое сообщение':message.text||'Сообщение';
const chatAvatar=(chat,size=42)=>avatar({...chat.peer,name:title(chat),src:chat.avatar||chat.peer?.avatar,saved:chat.type==='saved',online:false},size);
function applyLook(){document.documentElement.dataset.theme=state.settings.theme;document.documentElement.dataset.accent=state.settings.accent;root.classList.toggle('dense',state.settings.dense);root.classList.toggle('focus',state.focus);root.classList.toggle('inspector-open',state.inspector);}
function saveDraft(){if(!state.current||!view.input)return;state.drafts[state.current.id]=view.input.value;saveLocal('drafts',state.drafts);}
function drawList(){
 const query=state.query.toLocaleLowerCase('ru');
 const items=state.chats.filter(chat=>(state.filter!=='unread'||chat.unread>0)&&(state.filter!=='pinned'||chat.pinnedAt)&&(!query||(title(chat)+' '+(chat.peer?.username||'')+' '+preview(chat.lastMessage)).toLocaleLowerCase('ru').includes(query)));
 const sorted=[...items].sort((a,b)=>Number(!!b.pinnedAt)-Number(!!a.pinnedAt)||(b.lastMessage?.createdAt||b.createdAt)-(a.lastMessage?.createdAt||a.createdAt));
 view.list.replaceChildren(...sorted.map(chat=>h('button',{type:'button',class:'chat-item'+(state.current?.id===chat.id?' active':''),onclick:()=>openChat(chat)},
  h('span',{class:'avatar-wrap'},chatAvatar(chat),chat.peer?.online?h('i',{class:'online-dot'}):null),h('span',{class:'chat-item-content'},h('span',{class:'chat-item-top'},h('strong',{},title(chat)),h('small',{},chat.lastMessage?timeHM(chat.lastMessage.createdAt):'')),h('span',{class:'chat-item-bottom'},h('span',{},state.drafts[chat.id]?'Черновик: '+state.drafts[chat.id]:preview(chat.lastMessage)),chat.unread?h('b',{class:'unread-badge'},Math.min(chat.unread,99)):chat.pinnedAt?icon('pin'):null)))));
 if(!sorted.length)view.list.append(h('div',{class:'list-empty'},icon('search'),h('p',{},query?'Ничего не найдено':'Здесь пока пусто'),h('small',{},'Чаты, созданные в Limochat, появятся здесь.')));
 view.count.textContent=state.chats.reduce((n,c)=>n+c.unread,0)||'0';
}
function messageNode(message){
 const mine=message.senderId===state.me.id;
 const body=h('div',{class:'message-content'});
 if(message.replyTo)body.append(h('div',{class:'reply-preview'},message.replyTo.deleted?'Сообщение удалено':preview(message.replyTo)));
 if(message.kind==='image'&&message.file)body.append(h('a',{href:message.file,target:'_blank',rel:'noopener'},h('img',{class:'message-image',src:message.file,alt:'Фото из чата',loading:'lazy'})));
 if(message.kind==='sticker'){
  const info=stickerInfo(message.text);
  if(info?.type==='svg')body.append(h('img',{class:'message-sticker',src:info.src,alt:info.label||'Стикер',loading:'lazy'}));
  else if(info?.emoji)body.append(h('span',{class:'message-emoji'},info.emoji));
  else if(message.extra?.file)body.append(h('img',{class:'message-sticker',src:message.extra.file,alt:'Пользовательский стикер',loading:'lazy'}));
  else body.append(h('p',{},'Стикер · доступен в полной версии'));
 }else if(['voice','circle','video'].includes(message.kind)&&message.file)body.append(h(message.kind==='voice'?'audio':'video',{src:message.file,controls:true,preload:'metadata',class:'message-media'}));
 else if(message.kind==='file'&&message.file){if(message.extra?.danger)body.append(h('div',{class:'file-link'},icon('file'),h('span',{},message.extra?.name||'Исполняемый файл'),h('a',{href:'/'},'Открыть в полной версии')));else body.append(h('a',{class:'file-link',href:message.file,target:'_blank',rel:'noopener',download:true},icon('file'),message.extra?.name||'Скачать файл'));}
 if(message.text&&message.kind!=='sticker')body.append(h('div',{class:'message-text'},richText(message.text)));
 if(!body.childNodes.length)body.append(h('span',{class:'muted'},'Это сообщение можно открыть в полной версии Limochat.'));
 const reactions=message.reactions?.length?h('div',{class:'message-reactions'},...message.reactions.map(r=>h('span',{},r.emoji+' '+r.count))):null;
 return h('article',{class:'message '+(mine?'mine':'theirs')+(message.kind==='system'?' system':''),dataset:{messageId:message.id}},body,reactions,h('div',{class:'message-meta'},timeHM(message.createdAt),mine?' ✓':''));
}
function drawMessages({bottom=false}={}){
 const nearBottom=view.messages.scrollHeight-view.messages.scrollTop-view.messages.clientHeight<100;
 const oldTop=view.messages.scrollTop;
 view.messages.replaceChildren(...state.messages.map(messageNode));
 if(!state.messages.length)view.messages.append(h('div',{class:'conversation-start'},icon('chat'),h('h2',{},'Начните с «Привет»'),h('p',{},'Иногда одного сообщения достаточно.')));
 if(bottom||nearBottom)view.messages.scrollTop=view.messages.scrollHeight;else view.messages.scrollTop=oldTop;
}
async function markRead(){if(!state.current||!state.messages.length||document.hidden)return;const id=state.current.id,mid=state.messages.at(-1).id;try{await request('/chats/'+id+'/read',{method:'POST',body:{messageId:mid}});const chat=state.chats.find(c=>c.id===id);if(chat){chat.unread=0;drawList();}}catch{}}
async function openChat(chat){
 saveDraft();const turn=++state.epoch;state.current=chat;state.messages=[];root.classList.add('chat-open');drawList();view.chat.hidden=false;view.welcome.hidden=true;
 view.chatIdentity.replaceChildren(chatAvatar(chat,40),h('div',{},h('strong',{},title(chat)),h('small',{},chat.type==='private'?(chat.peer?.online?'В сети':'Личный чат'):chat.type==='saved'?'Только для вас':chat.membersCount+' участников')));
 view.input.value=state.drafts[chat.id]||'';view.input.disabled=chat.canPost===false||!!chat.blocked;view.send.disabled=view.input.disabled;view.attach.disabled=view.input.disabled;view.input.placeholder=view.input.disabled?'Отправка сообщений недоступна':'Написать сообщение…';view.messages.replaceChildren(h('div',{class:'list-empty'},'Загружаем переписку…'));
 try{const result=await request('/chats/'+chat.id+'/messages');if(turn!==state.epoch)return;state.messages=result.messages;view.older.hidden=!result.hasMore;drawMessages({bottom:true});drawInspector();markRead();view.input.focus();}catch(error){if(turn===state.epoch)view.messages.replaceChildren(h('div',{class:'list-empty'},errorText(error)));}
}
async function older(){if(!state.current||!state.messages.length)return;const id=state.current.id,turn=state.epoch,first=state.messages[0].id;view.older.disabled=true;try{const result=await request('/chats/'+id+'/messages?before='+first);if(turn!==state.epoch)return;const previous=view.messages.scrollHeight;state.messages=[...result.messages,...state.messages];drawMessages();view.messages.scrollTop=view.messages.scrollHeight-previous;view.older.hidden=!result.hasMore;}catch(e){toast(errorText(e));}finally{view.older.disabled=false;}}
async function send(file=null){
 if(!state.current||state.sending||view.input.disabled)return;const text=view.input.value;if(!file&&!text.trim())return;if(text.length>4096)return toast('Сообщение слишком длинное.');
 state.sending=true;view.send.disabled=true;view.attach.disabled=true;const id=state.current.id,turn=state.epoch;
 try{
  let path='/messages',body={text};
  if(file){path=file.type.startsWith('image/')?'/images':'/files';body=new FormData();body.append('file',file);body.append('text',text);}
  const result=await request('/chats/'+id+path,{method:'POST',body});const chat=state.chats.find(c=>c.id===id);if(chat)chat.lastMessage=result.message;
  if(state.drafts[id]===text)state.drafts[id]='';saveLocal('drafts',state.drafts);
  if(turn===state.epoch){if(!state.messages.some(m=>m.id===result.message.id))state.messages.push(result.message);if(view.input.value===text)view.input.value='';saveDraft();drawMessages({bottom:true});drawInspector();markRead();}drawList();
 }catch(error){toast(errorText(error));}finally{state.sending=false;view.send.disabled=!!state.current&&(state.current.canPost===false||!!state.current.blocked);view.attach.disabled=view.send.disabled;}
}
function insert(text){if(view.input.disabled)return;const start=view.input.selectionStart??view.input.value.length,end=view.input.selectionEnd??start;view.input.value=view.input.value.slice(0,start)+text+view.input.value.slice(end);view.input.focus();view.input.setSelectionRange(start+text.length,start+text.length);saveDraft();}
function drawInspector(){
 view.inspector.replaceChildren(h('div',{class:'inspector-head'},h('span',{},'ВАШЕ ПРОСТРАНСТВО'),btn('close','Скрыть панель',()=>{state.inspector=false;applyLook();})),h('div',{class:'inspector-tabs'},...[['notes','Заметки'],['look','Оформление'],['lab','Бета-лаборатория']].map(([id,label])=>h('button',{type:'button',class:state.tab===id?'selected':'',onclick:()=>{state.tab=id;drawInspector();}},label))));
 if(state.tab==='notes'){
  const key=state.current?.id||'home',note=h('textarea',{class:'note-input',placeholder:'Идея, список дел или то, что важно не забыть…',maxLength:6000,'aria-label':'Личная заметка',value:state.notes[key]||'',oninput:event=>{state.notes[key]=event.target.value;saveLocal('notes',state.notes);}});
  view.inspector.append(h('div',{class:'inspector-card'},h('span',{class:'card-eyebrow'},'ТОЛЬКО ДЛЯ ВАС'),h('h3',{},state.current?'Заметка к чату':'Мысли под рукой'),h('p',{},'Не отправляется собеседнику. Сохраняется на этом устройстве для вашего аккаунта.'),note));
  if(state.current){const media=state.messages.filter(m=>m.kind==='image'&&m.file).slice(-6);view.inspector.append(h('div',{class:'inspector-card'},h('h3',{},'Фото из открытой истории'),h('div',{class:'media-grid'},...media.map(m=>h('a',{href:m.file,target:'_blank',rel:'noopener'},h('img',{src:m.file,alt:'Фото из чата',loading:'lazy'})))),!media.length?h('p',{},'Здесь появятся фотографии из загруженных сообщений.'):null));}
 }else if(state.tab==='look'){
  const toggle=(key,label)=>h('label',{class:'setting-row'},label,h('input',{type:'checkbox',checked:state.settings[key],onchange:event=>{state.settings[key]=event.target.checked;saveLocal('settings',state.settings);applyLook();drawQuick();}}));
  view.inspector.append(h('div',{class:'inspector-card'},h('h3',{},'В вашем стиле'),h('p',{},'Эти настройки относятся только к бете.'),h('div',{class:'swatches'},...['mint','blue','rose','amber'].map(accent=>h('button',{type:'button',class:'swatch '+accent+(state.settings.accent===accent?' active':''),'aria-label':{mint:'Мятный',blue:'Синий',rose:'Розовый',amber:'Янтарный'}[accent],onclick:()=>{state.settings.accent=accent;saveLocal('settings',state.settings);applyLook();drawInspector();}}))),toggle('dense','Компактные чаты'),toggle('quick','Быстрые ответы'),h('button',{class:'wide-button',onclick:()=>{state.settings.theme=state.settings.theme==='light'?'dark':'light';saveLocal('settings',state.settings);applyLook();}},'Светлая / тёмная тема')));
 }else{
  const feedback=h('textarea',{class:'note-input',maxLength:2000,placeholder:'Что понравилось? Что мешает?','aria-label':'Отзыв о бете'}),status=h('p',{class:'feedback-status',role:'status'});
  const submit=h('button',{class:'wide-button',onclick:async()=>{if(feedback.value.trim().length<3){status.textContent='Напишите хотя бы несколько слов.';return;}submit.disabled=true;try{await request('/feedback',{method:'POST',body:{text:feedback.value},beta:true});feedback.value='';status.textContent='Отзыв отправлен администратору. Спасибо!';}catch(e){status.textContent=e.code==='beta_bad_feedback'?'Отзыв должен содержать от 3 до 2000 символов.':errorText(e);}finally{submit.disabled=false;}}},'Отправить отзыв');
  view.inspector.append(h('div',{class:'inspector-card lab-card'},h('span',{class:'card-eyebrow'},'BETA / 01'),h('h3',{},'Создаём следующую версию'),h('p',{},'Здесь можно оставить отзыв об интерфейсе. Сообщения в чатах настоящие и видны в основной версии.'),feedback,submit,status,h('a',{class:'main-link',href:'/'},'Основной сервер ↗')));
 }
}
function drawQuick(){view.quick.hidden=!state.settings.quick;}
function setFocus(value=!state.focus){state.focus=value;applyLook();view.focus?.setAttribute('aria-pressed',String(value));}
function palette(){if(!view.search)return;setFocus(false);root.classList.remove('chat-open');view.search.focus();view.search.select();}
function build(){
 if(matchMedia('(max-width:1190px)').matches)state.inspector=false;
 const rail=h('nav',{class:'rail','aria-label':'Разделы'},h('a',{class:'rail-logo',href:'/',title:'Основной сервер'},h('img',{src:'/icons/icon.svg',alt:'Limochat'})),h('span',{class:'rail-separator'}),btn('chat','Чаты',()=>{root.classList.remove('chat-open');setFocus(false);}),btn('search','Найти чат · Ctrl K',palette),btn('pencil','Личные заметки',()=>{state.inspector=true;state.tab='notes';applyLook();drawInspector();}),btn('sparkles','Бета-лаборатория',()=>{state.inspector=true;state.tab='lab';applyLook();drawInspector();}),h('div',{class:'rail-spacer'}),h('a',{class:'icon-button',href:'/',title:'Основной сервер','aria-label':'Основной сервер'},icon('back')),btn('settings','Оформление',()=>{state.inspector=true;state.tab='look';applyLook();drawInspector();}),h('div',{class:'rail-avatar',title:state.me.name},avatar({...state.me,src:state.me.avatar},32)));
 view.search=h('input',{type:'search',placeholder:'Найти чат','aria-label':'Поиск по чатам',oninput:event=>{state.query=event.target.value;drawList();}});
 view.list=h('div',{class:'chat-list'});view.count=h('span',{class:'chat-counter'},'0');
 const filters=h('div',{class:'chat-filters'},... [['all','Все'],['unread','Непрочитанные'],['pinned','Важные']].map(([id,label])=>h('button',{class:id==='all'?'selected':'',onclick:event=>{state.filter=id;filters.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===event.currentTarget));drawList();}},label)));
 const sidebar=h('aside',{class:'sidebar glass'},h('div',{class:'sidebar-title'},h('h1',{},'Сообщения'),view.count),h('label',{class:'search'},icon('search'),view.search,h('kbd',{},'⌘ K')),filters,view.list,h('footer',{class:'sidebar-footer'},h('span',{},'Limochat'),h('span',{},'Liquid Glass · Beta 01')));
 view.chatIdentity=h('div',{class:'chat-identity'});view.messages=h('div',{class:'messages',role:'log','aria-label':'Сообщения'});
 view.input=h('textarea',{rows:1,maxLength:4096,placeholder:'Написать сообщение…','aria-label':'Сообщение',oninput:saveDraft,onkeydown:event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send();}}});
 view.send=btn('send','Отправить сообщение',()=>send(),{class:'send-button'});
 const fileInput=h('input',{type:'file',hidden:true,onchange:event=>{const file=event.target.files[0];event.target.value='';if(file)send(file);}});
 view.attach=btn('attach','Прикрепить файл',()=>fileInput.click());
 const emoji=btn('smile','Добавить эмодзи',()=>{view.emoji.hidden=!view.emoji.hidden;});
 view.emoji=h('div',{class:'emoji-popover',hidden:true},...['😊','❤️','😂','🔥','👍','✨','🍋','🎉','🤝','👀','💡','💚'].map(e=>h('button',{type:'button','aria-label':e,onclick:()=>{insert(e);view.emoji.hidden=true;}},e)));
 view.quick=h('div',{class:'quick-replies'},h('span',{},'Быстрый ответ'),...['Привет! 👋','Спасибо 💚','Скоро отвечу','Договорились 🤝'].map(text=>h('button',{onclick:()=>insert(text)},text)));
 view.focus=btn('eye','Режим фокуса',()=>setFocus(),{'aria-pressed':'false'});
 view.older=h('button',{class:'load-older',hidden:true,onclick:older},'Загрузить предыдущие сообщения');
 view.chat=h('section',{class:'conversation',hidden:true},h('header',{class:'conversation-header'},btn('back','К списку чатов',()=>{saveDraft();root.classList.remove('chat-open');}),view.chatIdentity,view.focus,btn('info','Панель чата',()=>{state.inspector=!state.inspector;applyLook();drawInspector();})),view.older,view.messages,h('div',{class:'composer-wrap'},view.quick,view.emoji,h('form',{class:'composer',onsubmit:event=>{event.preventDefault();send();}},view.attach,emoji,view.input,view.send,fileInput),h('small',{class:'composer-foot'},'Enter — отправить · Shift + Enter — новая строка')));
 view.welcome=h('div',{class:'welcome'},h('div',{class:'welcome-symbol'},icon('chat')),h('span',{class:'welcome-kicker'},'ВАШЕ МЕСТО ДЛЯ ОБЩЕНИЯ'),h('h2',{},'Всё начинается\nс разговора.'),h('p',{},'Выберите чат слева. Остальное — просто.'),h('div',{class:'welcome-chips'},h('span',{},'Прозрачность'),h('span',{},'Фокус'),h('span',{},'Ваш ритм')),h('button',{class:'wide-button',onclick:palette},'Найти разговор ↗'));
 const center=h('main',{class:'center glass'},view.welcome,view.chat);
 view.inspector=h('aside',{class:'inspector glass','aria-label':'Личная панель'});
 const status=h('div',{class:'beta-header'},h('span',{class:'beta-wordmark'},'Limochat',h('b',{},'beta / 01')),h('span',{class:'live-label'},h('i'),'Тестовый интерфейс · ваш аккаунт'),h('a',{href:'/'},'Основной сервер ↗'));
 root.replaceChildren(status,h('div',{class:'workspace'},rail,sidebar,center,view.inspector));applyLook();drawList();drawInspector();drawQuick();
}
async function refresh(){
 if(polling||document.hidden)return;polling=true;try{
  const data=await request('/chats');state.chats=data.chats;drawList();
  if(state.current){const chat=state.chats.find(c=>c.id===state.current.id);if(!chat){state.current=null;view.chat.hidden=true;view.welcome.hidden=false;root.classList.remove('chat-open');return;}state.current=chat;const turn=state.epoch,result=await request('/chats/'+chat.id+'/messages');if(turn===state.epoch){const before=JSON.stringify(state.messages.slice(-result.messages.length));if(before!==JSON.stringify(result.messages)){const oldest=result.messages[0]?.id;state.messages=[...state.messages.filter(m=>m.id<oldest),...result.messages];drawMessages();}markRead();}}
 }catch(error){if(error.status!==401&&error.code!=='beta_access_required')toast(errorText(error));}finally{polling=false;}
}
async function boot(){
 try{state.me=(await request('/me')).user;state.settings={...state.settings,...readLocal('settings',{})};state.notes=readLocal('notes',{});state.drafts=readLocal('drafts',{});state.chats=(await request('/chats')).chats;build();timer=setInterval(refresh,8000);}catch(error){root.replaceChildren(h('div',{class:'fatal'},h('h2',{},'Не удалось открыть бету'),h('p',{},errorText(error)),h('button',{onclick:()=>location.reload()},'Повторить'),h('a',{href:'/'},'Обычный Limochat')));}
}
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();palette();}if(event.key==='Escape'){setFocus(false);if(view.emoji)view.emoji.hidden=true;}});
window.addEventListener('beforeunload',saveDraft);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('storage',event=>{if(event.key==='limoninior.account-change'){saveDraft();location.replace('/beta');}});
boot();
