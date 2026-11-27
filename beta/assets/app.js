import {t,getLanguage,setLanguage,betaError} from '/js/beta-i18n.js';
import {h,icon,avatar,richText,timeHM,contextMenu,handleBack,afterHistory,openModal,closeTopModal,closeMenu} from '/js/ui.js';
import {stickerInfo} from '/js/catalog.js';
import {setAccountId} from '/js/api.js';
import {io} from '/vendor/socket.io.esm.min.js';
import {initCalls,startCall,inCall} from '/js/calls.js';
import {showProfile} from './profiles.js';
import {emptyChatCopy} from './empty-copy.js';
import {storyQuote} from '/js/stories.js';
const root=document.querySelector('#beta-app');
const state={me:null,chats:[],current:null,messages:[],filter:'all',query:'',focus:false,inspector:false,tab:'notes',epoch:0,sending:false,drafts:{},settings:{theme:'dark',dense:false,quick:false,accent:'mint'},notes:{},reply:null,searchText:''};
const view={};let socket;let timer,polling=false,toastTimer;
function toast(text){const el=document.querySelector('#beta-toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem('limo.beta.'+state.me.id+'.'+key))||fallback;}catch{return fallback;}}
function saveLocal(key,value){try{localStorage.setItem('limo.beta.'+state.me.id+'.'+key,JSON.stringify(value));}catch{toast(t("Браузер не разрешает сохранять данные на устройстве."));}}
async function request(path,{method='GET',body,beta=false}={}){
 const headers={};if(state.me)headers['X-Limochat-Account']=String(state.me.id);
 if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const response=await fetch((beta?'/api/beta':'/api/beta/app')+path,{method,credentials:'same-origin',cache:'no-store',headers,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){if(data.error==='beta_access_required'||response.status===401||data.error==='account_changed'){clearInterval(timer);socket?.disconnect();location.replace(response.status===401?'/?next=/beta&login=expired':'/beta');}throw Object.assign(new Error(data.error||'network'),{code:data.error,status:response.status,data});}
 return data;
}
const btn=(ic,label,action,extra={})=>h('button',{type:'button',class:'icon-button',title:label,'aria-label':label,onclick:action,...extra},icon(ic));
const title=chat=>chat?.type==='saved'?t('Избранное'):chat?.title||chat?.peer?.name||t("Чат");
const preview=message=>!message?t("Начните общение"):message.kind==='sticker'?t("Стикер"):message.kind==='image'?t("Фото"):message.kind==='file'?t("Файл: ")+(message.extra?.name||t("вложение")):message.kind==='voice'?t("Голосовое сообщение"):message.text||t("Сообщение");
const chatAvatar=(chat,size=42)=>avatar({...chat.peer,name:title(chat),src:chat.avatar||chat.peer?.avatar,saved:chat.type==='saved',online:false},size);
function applyLook(){syncNav();document.documentElement.dataset.theme=state.settings.theme;document.documentElement.dataset.accent=state.settings.accent;root.classList.toggle('dense',state.settings.dense);root.classList.toggle('focus',state.focus);root.classList.toggle('inspector-open',state.inspector);}
function saveDraft(){if(!state.current||!view.input)return;state.drafts[state.current.id]=view.input.value;saveLocal('drafts',state.drafts);}
function drawList(){
 const listKey=JSON.stringify([state.query,state.filter,state.current?.id,state.drafts,state.chats]);if(view.listKey===listKey)return;view.listKey=listKey;
 const entranceKey=state.query+'|'+state.filter;const arrive=view.entranceKey!==entranceKey;view.entranceKey=entranceKey;
 const query=state.query.toLocaleLowerCase('ru');
 const items=state.chats.filter(chat=>(state.filter!=='unread'||chat.unread>0)&&(state.filter!=='pinned'||chat.pinnedAt)&&(!query||(title(chat)+' '+(chat.peer?.username||'')+' '+preview(chat.lastMessage)).toLocaleLowerCase('ru').includes(query)));
 const sorted=[...items].sort((a,b)=>Number(!!b.pinnedAt)-Number(!!a.pinnedAt)||(b.lastMessage?.createdAt||b.createdAt)-(a.lastMessage?.createdAt||a.createdAt));
 view.list.replaceChildren(...sorted.map(chat=>h('button',{type:'button',class:'chat-item'+(state.current?.id===chat.id?' active':''),onclick:()=>openChat(chat)},
  h('span',{class:'avatar-wrap'},chatAvatar(chat),chat.peer?.online?h('i',{class:'online-dot'}):null),h('span',{class:'chat-item-content'},h('span',{class:'chat-item-top'},h('strong',{},title(chat)),h('small',{},chat.lastMessage?timeHM(chat.lastMessage.createdAt):'')),h('span',{class:'chat-item-bottom'},h('span',{},state.drafts[chat.id]?t("Черновик: ")+state.drafts[chat.id]:(chat.lastMessage?preview(chat.lastMessage):emptyChatCopy(chat,t).list)),chat.unread?h('b',{class:'unread-badge'},Math.min(chat.unread,99)):chat.pinnedAt?icon('pin'):null)))));
 if(arrive&&!matchMedia('(prefers-reduced-motion:reduce)').matches)[...view.list.children].slice(0,12).forEach((node,index)=>{node.classList.add('list-arrive');node.style.setProperty('--arrival',Math.min(index*22,180)+'ms');});
 if(!sorted.length)view.list.append(h('div',{class:'list-empty'},icon('search'),h('p',{},query?t("Чат не найден"):state.filter==='unread'?t("Всё прочитано"):state.filter==='pinned'?t("Важные чаты — здесь"):t("Ваши разговоры впереди")),h('small',{},query?t("Попробуйте другое имя или @юзернейм."):state.filter==='unread'?t("Новые сообщения появятся в этой вкладке."):state.filter==='pinned'?t("Закреплённые чаты появятся в этой вкладке."):t("Чаты, созданные в Limochat, появятся здесь."))));
 const unread=state.chats.reduce((n,c)=>n+c.unread,0);view.count.textContent=unread;view.count.hidden=!unread;
}
function messageNode(message){
 const mine=message.senderId===state.me.id;
 const body=h('div',{class:'message-content'});
 if(message.replyTo)body.append(h('button',{class:'reply-preview',type:'button',onclick:()=>{const node=[...view.messages.children].find(n=>n.dataset.messageId===String(message.replyTo.id));if(node)node.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});else toast(t("Сообщение находится выше. Загрузите предыдущие сообщения."));}},h('b',{},message.replyTo.deleted?t("Сообщение удалено"):t("Ответ на сообщение")),h('span',{},message.replyTo.deleted?'':preview(message.replyTo))));
 if(message.extra?.story)body.append(storyQuote(message.extra.story,()=>showQuotedStory(message.extra.story),t));
 if(message.kind==='image'&&message.file)body.append(h('a',{href:message.file,target:'_blank',rel:'noopener'},h('img',{class:'message-image',src:message.file,alt:t("Фото из чата"),loading:'lazy'})));
 if(message.kind==='sticker'){
  const info=stickerInfo(message.text);
  if(info?.type==='svg')body.append(h('img',{class:'message-sticker',src:info.src,alt:info.label||t("Стикер"),loading:'lazy'}));
  else if(info?.emoji)body.append(h('span',{class:'message-emoji'},info.emoji));
  else if(message.extra?.file)body.append(h('img',{class:'message-sticker',src:message.extra.file,alt:t("Пользовательский стикер"),loading:'lazy'}));
  else body.append(h('p',{},t("Стикер · доступен в полной версии")));
 }else if(['voice','circle','video'].includes(message.kind)&&message.file)body.append(h(message.kind==='voice'?'audio':'video',{src:message.file,controls:true,preload:'metadata',class:'message-media'}));
 else if(message.kind==='file'&&message.file){if(message.extra?.danger)body.append(h('div',{class:'file-link'},icon('file'),h('span',{},message.extra?.name||t("Исполняемый файл")),h('a',{href:'/?server=main'},t("Открыть в полной версии"))));else body.append(h('a',{class:'file-link',href:message.file,target:'_blank',rel:'noopener',download:true},icon('file'),message.extra?.name||t("Скачать файл")));}
 if(message.text&&message.kind!=='sticker')body.append(h('div',{class:'message-text'},richText(message.text)));
 if(!body.childNodes.length)body.append(h('span',{class:'muted'},t("Это сообщение можно открыть в полной версии Limochat.")));
 const reactions=message.reactions?.length?h('div',{class:'message-reactions'},...message.reactions.map(r=>h('span',{},r.emoji+' '+r.count))):null;
 return h('article',{oncontextmenu:event=>{event.preventDefault();messageActions(message,event.clientX,event.clientY);},class:'message '+(mine?'mine':'theirs')+(message.kind==='system'?' system':''),dataset:{messageId:message.id}},body,reactions,h('div',{class:'message-meta'},timeHM(message.createdAt),mine?' ✓':''));
}
function drawMessages({bottom=false}={}){
 const previousIds=new Set([...view.messages.querySelectorAll('[data-message-id]')].map(node=>node.dataset.messageId));
 const previousLast=view.messages.lastElementChild?.dataset.messageId;
 const animateNew=previousIds.size>0;
 const nearBottom=view.messages.scrollHeight-view.messages.scrollTop-view.messages.clientHeight<100;
 const oldTop=view.messages.scrollTop;
 view.messages.replaceChildren(...state.messages.map(message=>{const node=messageNode(message);if(animateNew&&!previousIds.has(String(message.id))&&Number(message.id)>Number(previousLast))node.classList.add('message-new');return node;}));
 if(!state.messages.length){const copy=emptyChatCopy(state.current,t);view.messages.append(h('div',{class:'conversation-start'},icon('chat'),h('h2',{},copy.title),h('p',{},copy.text)));}
 if(bottom||nearBottom)view.messages.scrollTop=view.messages.scrollHeight;else view.messages.scrollTop=oldTop;
 updateMessageSearch();updateJump();
}
async function markRead(){if(!state.current||!state.messages.length||document.hidden)return;const id=state.current.id,mid=state.messages.at(-1).id;try{await request('/chats/'+id+'/read',{method:'POST',body:{messageId:mid}});const chat=state.chats.find(c=>c.id===id);if(chat){chat.unread=0;drawList();}}catch{}}
async function openChat(chat){
 saveDraft();state.reply=null;state.searchText='';view.messageSearch.value='';view.searchBar.hidden=true;drawReply();const turn=++state.epoch;state.current=chat;state.messages=[];root.classList.add('chat-open');drawList();view.chat.hidden=false;view.welcome.hidden=true;
 view.voice.hidden=view.video.hidden=chat.type!=='private'||!chat.peer||chat.peer.bot||chat.peer.id===state.me.id||!!chat.blocked;
 view.chatIdentity.disabled=!chat.peer;view.chatIdentity.replaceChildren(chatAvatar(chat,40),h('div',{},h('strong',{},title(chat)),h('small',{},chat.type==='private'?(chat.peer?.online?t("В сети"):t("Личный чат")):chat.type==='saved'?t("Только для вас"):chat.membersCount+t(" участников"))));
 view.input.value=state.drafts[chat.id]||'';view.input.disabled=chat.canPost===false||!!chat.blocked;view.send.disabled=view.input.disabled;view.attach.disabled=view.input.disabled;view.input.placeholder=view.input.disabled?t("Отправка сообщений недоступна"):t("Написать сообщение…");view.messages.replaceChildren(h('div',{class:'list-empty'},t("Загружаем переписку…")));
 try{const result=await request('/chats/'+chat.id+'/messages');if(turn!==state.epoch)return;state.messages=result.messages;view.older.hidden=!result.hasMore;drawMessages({bottom:true});drawInspector();markRead();view.input.focus();}catch(error){if(turn===state.epoch)view.messages.replaceChildren(h('div',{class:'list-empty'},betaError(error)));}
}
async function older(){if(!state.current||!state.messages.length)return;const id=state.current.id,turn=state.epoch,first=state.messages[0].id;view.older.disabled=true;try{const result=await request('/chats/'+id+'/messages?before='+first);if(turn!==state.epoch)return;const previous=view.messages.scrollHeight;state.messages=[...result.messages,...state.messages];drawMessages();view.messages.scrollTop=view.messages.scrollHeight-previous;view.older.hidden=!result.hasMore;}catch(e){toast(betaError(e));}finally{view.older.disabled=false;}}
async function send(file=null){
 if(!state.current||state.sending||view.input.disabled)return;const text=view.input.value;if(!file&&!text.trim())return;if(text.length>4096)return toast(t("Сообщение слишком длинное."));
 state.sending=true;view.send.disabled=true;view.attach.disabled=true;const id=state.current.id,turn=state.epoch;
 try{
  const reply=state.reply;let path='/messages',body={text,...(reply?{replyTo:reply.id}:{})};
  if(file){path=file.type.startsWith('image/')?'/images':'/files';body=new FormData();body.append('file',file);body.append('text',text);if(reply)body.append('replyTo',reply.id);}
  const result=await request('/chats/'+id+path,{method:'POST',body});const chat=state.chats.find(c=>c.id===id);if(chat)chat.lastMessage=result.message;
  if(state.drafts[id]===text)state.drafts[id]='';saveLocal('drafts',state.drafts);
  if(turn===state.epoch){if(!state.messages.some(m=>m.id===result.message.id))state.messages.push(result.message);if(view.input.value===text)view.input.value='';if(state.reply===reply){state.reply=null;drawReply();}saveDraft();drawMessages({bottom:true});drawInspector();markRead();}drawList();
 }catch(error){toast(betaError(error));}finally{state.sending=false;view.send.disabled=!!state.current&&(state.current.canPost===false||!!state.current.blocked);view.attach.disabled=view.send.disabled;}
}
function insert(text){if(view.input.disabled)return;const start=view.input.selectionStart??view.input.value.length,end=view.input.selectionEnd??start;view.input.value=view.input.value.slice(0,start)+text+view.input.value.slice(end);view.input.focus();view.input.setSelectionRange(start+text.length,start+text.length);saveDraft();}
function syncNav(){
 const active=state.inspector?(state.tab==='notes'?'notes':state.tab==='look'?'settings':'lab'):'chats';
 for(const button of view.rail?.querySelectorAll('[data-section]')||[]){const selected=button.dataset.section===active;button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
}
function navButton(key,ic,label,action){const button=btn(ic,label,()=>{action();syncNav();},{dataset:{section:key}});button.append(h('span',{class:'nav-label'},label));return button;}
function drawInspector(){
 syncNav();
 view.inspector.replaceChildren(h('div',{class:'inspector-head'},h('span',{},t("Панель чата")),btn('close',t("Скрыть панель"),()=>{state.inspector=false;applyLook();})),h('div',{class:'inspector-tabs'},...[['notes',t("Заметки")],['look',t("Оформление")],['lab',t("Бета-лаборатория")]].map(([id,label])=>h('button',{type:'button',class:state.tab===id?'selected':'',onclick:()=>{state.tab=id;drawInspector();}},label))));
 if(state.tab==='notes'){
  const key=state.current?.id||'home',note=h('textarea',{class:'note-input',placeholder:t("Идея, список дел или то, что важно не забыть…"),maxLength:6000,'aria-label':t("Личная заметка"),value:state.notes[key]||'',oninput:event=>{state.notes[key]=event.target.value;saveLocal('notes',state.notes);}});
  view.inspector.append(h('div',{class:'inspector-card'},h('h3',{},state.current?t("Заметка к чату"):t("Заметки")),h('p',{},t("Не отправляется собеседнику. Сохраняется на этом устройстве для вашего аккаунта.")),note));
  if(state.current){const media=state.messages.filter(m=>m.kind==='image'&&m.file).slice(-6);view.inspector.append(h('div',{class:'inspector-card'},h('h3',{},t("Фото из открытой истории")),h('div',{class:'media-grid'},...media.map(m=>h('a',{href:m.file,target:'_blank',rel:'noopener'},h('img',{src:m.file,alt:t("Фото из чата"),loading:'lazy'})))),!media.length?h('p',{},t("Здесь появятся фотографии из загруженных сообщений.")):null));}
 }else if(state.tab==='look'){
  const language=h('select',{'aria-label':t('Язык'),class:'beta-language',onchange:event=>{if(inCall()){event.target.value=getLanguage();toast(t('Завершите звонок перед сменой языка.'));return;}saveDraft();setLanguage(event.target.value);location.reload();}},...['ru','en'].map(code=>h('option',{value:code,selected:code===getLanguage()},code==='ru'?'Русский':'English')));
  view.inspector.append(h('label',{class:'setting-row'},t('Язык'),language));

  const toggle=(key,label)=>h('label',{class:'setting-row'},label,h('input',{type:'checkbox',checked:state.settings[key],onchange:event=>{state.settings[key]=event.target.checked;saveLocal('settings',state.settings);applyLook();drawQuick();}}));
  view.inspector.append(h('div',{class:'inspector-card'},h('h3',{},t("Оформление")),h('div',{class:'swatches'},...['mint','blue','rose','amber'].map(accent=>h('button',{type:'button',class:'swatch '+accent+(state.settings.accent===accent?' active':''),'aria-label':{mint:t("Мятный"),blue:t("Синий"),rose:t("Розовый"),amber:t("Янтарный")}[accent],onclick:()=>{state.settings.accent=accent;saveLocal('settings',state.settings);applyLook();drawInspector();}}))),toggle('dense',t("Компактные чаты")),toggle('quick',t("Быстрые ответы")),h('button',{class:'wide-button',onclick:()=>{state.settings.theme=state.settings.theme==='light'?'dark':'light';saveLocal('settings',state.settings);applyLook();}},t("Светлая / тёмная тема"))));
 }else{
  const feedback=h('textarea',{class:'note-input',maxLength:2000,placeholder:t("Что понравилось? Что мешает?"),'aria-label':t("Отзыв о бете")}),status=h('p',{class:'feedback-status',role:'status'});
  const submit=h('button',{class:'wide-button',onclick:async()=>{if(feedback.value.trim().length<3){status.textContent=t("Напишите хотя бы несколько слов.");return;}submit.disabled=true;try{await request('/feedback',{method:'POST',body:{text:feedback.value},beta:true});feedback.value='';status.textContent=t("Отзыв отправлен администратору. Спасибо!");}catch(e){status.textContent=e.code==='beta_bad_feedback'?t("Отзыв должен содержать от 3 до 2000 символов."):betaError(e);}finally{submit.disabled=false;}}},t("Отправить отзыв"));
  view.inspector.append(h('div',{class:'inspector-card lab-card'},h('h3',{},t("Отзыв о бете")),h('p',{},t("Здесь можно оставить отзыв об интерфейсе. Сообщения в чатах настоящие и видны в основной версии.")),feedback,submit,status));
 }
}
function drawReply(){if(!view.reply)return;view.reply.hidden=!state.reply;view.reply.replaceChildren();if(state.reply)view.reply.append(h('span',{},preview(state.reply)),btn('close',t("Отменить ответ"),()=>{state.reply=null;drawReply();}));}
function messageActions(message,x,y){contextMenu(x,y,[!view.input.disabled?{icon:'reply',label:t("Ответить"),onClick:()=>{state.reply=message;drawReply();view.input.focus();}}:null,message.text?{icon:'copy',label:t("Копировать текст"),onClick:async()=>{try{await navigator.clipboard.writeText(message.text);toast(t("Текст скопирован"));}catch{toast(t("Не удалось скопировать текст"));}}}:null]);}
function updateJump(){if(view.jump)view.jump.hidden=view.messages.scrollHeight-view.messages.scrollTop-view.messages.clientHeight<180;}
function updateMessageSearch(){if(!view.searchCount)return;const query=state.searchText.trim().toLocaleLowerCase('ru');const matches=[];for(const node of view.messages.querySelectorAll('[data-message-id]')){const found=!!query&&node.textContent.toLocaleLowerCase('ru').includes(query);node.classList.toggle('search-match',found);if(found)matches.push(node);}view.searchMatches=matches;view.searchCount.textContent=query?matches.length+t(" в загруженной истории"):'';}
function nextSearch(){const matches=view.searchMatches||[];if(!matches.length)return;view.searchIndex=((view.searchIndex??-1)+1)%matches.length;matches[view.searchIndex].scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
function drawQuick(){view.quick.hidden=!state.settings.quick;}
function setFocus(value=!state.focus){state.focus=value;applyLook();view.focus?.setAttribute('aria-pressed',String(value));}
function palette(){if(!view.search)return;setFocus(false);root.classList.remove('chat-open');view.search.focus();view.search.select();}
function build(){
 if(matchMedia('(max-width:1190px)').matches)state.inspector=false;
 const rail=view.rail=h('nav',{class:'rail','aria-label':t("Разделы")},h('a',{class:'rail-logo',href:'/?server=main',title:t("Основной сервер")},h('img',{src:'/icons/icon.svg',alt:'Limochat'})),h('span',{class:'rail-separator'}),navButton('chats','chat',t("Чаты"),()=>{state.inspector=false;root.classList.remove('chat-open');setFocus(false);}),btn('search',t("Найти чат · Ctrl K"),palette,{class:'icon-button rail-search'}),navButton('notes','pencil',t("Заметки"),()=>{state.inspector=true;state.tab='notes';applyLook();drawInspector();}),btn('sparkles',t("Бета-лаборатория"),()=>{state.inspector=true;state.tab='lab';applyLook();drawInspector();},{class:'icon-button rail-lab'}),h('div',{class:'rail-spacer'}),h('a',{class:'icon-button nav-main',href:'/?server=main',title:t("Основной сервер"),'aria-label':t("Основной сервер")},icon('back'),h('span',{class:'nav-label'},t("Основной"))),btn('user',t("Профиль"),()=>profile(state.me.id),{class:'icon-button nav-profile'}),navButton('settings','settings',t("Оформление"),()=>{state.inspector=true;state.tab='look';applyLook();drawInspector();}),h('div',{class:'rail-avatar',title:state.me.name},avatar({...state.me,src:state.me.avatar},32)));
 view.search=h('input',{type:'search',placeholder:t("Найти чат"),'aria-label':t("Поиск по чатам"),oninput:event=>{state.query=event.target.value;drawList();}});
 view.list=h('div',{class:'chat-list'});view.count=h('span',{class:'chat-counter'},'0');
 const filters=h('div',{class:'chat-filters'},... [['all',t("Все")],['unread',t("Непрочитанные")],['pinned',t("Важные")]].map(([id,label])=>h('button',{class:id==='all'?'selected':'',onclick:event=>{state.filter=id;filters.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===event.currentTarget));drawList();}},label)));
 const sidebar=h('aside',{class:'sidebar glass'},h('div',{class:'sidebar-title'},h('div',{class:'sidebar-heading'},h('h1',{},t("Чаты")),h('p',{},t("Все разговоры в одном месте"))),view.count),h('label',{class:'search'},icon('search'),view.search),filters,view.list);
 view.rail.querySelector('.nav-profile').append(h('span',{class:'nav-label'},t("Профиль")));
 view.chatIdentity=h('button',{type:'button',class:'chat-identity','aria-label':t("Открыть профиль"),onclick:()=>{if(state.current?.peer)profile(state.current.peer.id);}});view.messages=h('div',{class:'messages',role:'log','aria-label':t("Сообщения")});
 view.input=h('textarea',{rows:1,maxLength:4096,placeholder:t("Написать сообщение…"),'aria-label':t("Сообщение"),oninput:saveDraft,onkeydown:event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send();}}});
 view.send=btn('send',t("Отправить сообщение"),()=>send(),{class:'send-button'});
 const fileInput=h('input',{type:'file',hidden:true,onchange:event=>{const file=event.target.files[0];event.target.value='';if(file)send(file);}});
 view.attach=btn('attach',t("Прикрепить файл"),()=>fileInput.click());
 const emoji=btn('smile',t("Добавить эмодзи"),()=>{view.emoji.hidden=!view.emoji.hidden;});
 view.emoji=h('div',{class:'emoji-popover',hidden:true},...['😊','❤️','😂','🔥','👍','✨','🍋','🎉','🤝','👀','💡','💚'].map(e=>h('button',{type:'button','aria-label':e,onclick:()=>{insert(e);view.emoji.hidden=true;}},e)));
 view.quick=h('div',{class:'quick-replies'},h('span',{},t("Быстрый ответ")),...[t("Привет! 👋"),t("Спасибо 💚"),t("Скоро отвечу"),t("Договорились 🤝")].map(text=>h('button',{onclick:()=>insert(text)},text)));
 view.focus=btn('eye',t("Режим фокуса"),()=>setFocus(),{'aria-pressed':'false',class:'icon-button focus-toggle'});
 view.older=h('button',{class:'load-older',hidden:true,onclick:older},t("Загрузить предыдущие сообщения"));
 view.reply=h('div',{class:'compose-reply',hidden:true});
 view.searchCount=h('span',{class:'message-search-count','aria-live':'polite'});
 view.messageSearch=h('input',{type:'search',placeholder:t("Поиск в загруженной истории"),'aria-label':t("Поиск сообщений"),oninput:e=>{state.searchText=e.target.value;view.searchIndex=-1;updateMessageSearch();},onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();nextSearch();}}});
 view.searchBar=h('div',{class:'message-search',hidden:true},view.messageSearch,view.searchCount,btn('down',t("Следующее совпадение"),nextSearch),btn('close',t("Закрыть поиск"),()=>{view.searchBar.hidden=true;view.messageSearch.value='';state.searchText='';updateMessageSearch();}));
 view.jump=btn('down',t("К новым сообщениям"),()=>{view.messages.scrollTo({top:view.messages.scrollHeight,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});},{class:'jump-latest',hidden:true});
 view.messages.addEventListener('scroll',updateJump,{passive:true});
 view.voice=btn('phone',t("Аудиозвонок"),()=>callCurrent(false),{hidden:true});view.video=btn('video',t("Видеозвонок"),()=>callCurrent(true),{hidden:true});
 view.chat=h('section',{class:'conversation',hidden:true},h('header',{class:'conversation-header'},btn('back',t("К списку чатов"),()=>{saveDraft();root.classList.remove('chat-open');}),view.chatIdentity,view.voice,view.video,btn('search',t("Поиск сообщений"),()=>{view.searchBar.hidden=!view.searchBar.hidden;if(!view.searchBar.hidden)view.messageSearch.focus();}),view.focus,btn('info',t("Панель чата"),()=>{state.inspector=!state.inspector;applyLook();drawInspector();})),view.searchBar,view.older,view.messages,view.jump,h('div',{class:'composer-wrap'},view.reply,view.quick,view.emoji,h('form',{class:'composer',onsubmit:event=>{event.preventDefault();send();}},view.attach,emoji,view.input,view.send,fileInput),null));
 view.welcome=h('div',{class:'welcome'},h('div',{class:'welcome-symbol'},icon('chat')),h('h2',{},t("Выберите чат")),h('p',{},t("Начните или продолжите разговор.")));

 const center=h('main',{class:'center glass'},view.welcome,view.chat);
 view.inspector=h('aside',{class:'inspector glass','aria-label':t("Личная панель")});
 const status=h('div',{class:'beta-header'},h('span',{class:'beta-wordmark'},'Limochat',h('b',{},'beta')));
 root.replaceChildren(status,h('div',{class:'workspace'},rail,sidebar,center,view.inspector));applyLook();drawList();drawInspector();drawQuick();
}
async function refresh(){
 if(polling||document.hidden)return;polling=true;try{
  const data=await request('/chats');state.chats=data.chats;drawList();
  if(state.current){const chat=state.chats.find(c=>c.id===state.current.id);if(!chat){state.current=null;view.chat.hidden=true;view.welcome.hidden=false;root.classList.remove('chat-open');return;}state.current=chat;const turn=state.epoch,result=await request('/chats/'+chat.id+'/messages');if(turn===state.epoch){const before=JSON.stringify(state.messages.slice(-result.messages.length));if(before!==JSON.stringify(result.messages)){const oldest=result.messages[0]?.id;state.messages=[...state.messages.filter(m=>m.id<oldest),...result.messages];drawMessages();}markRead();}}
 }catch(error){if(error.status!==401&&error.code!=='beta_access_required')toast(betaError(error));}finally{polling=false;}
}
async function showQuotedStory(quote){try{const {feed}=await request('/stories');const story=feed.flatMap(group=>group.stories).find(item=>item.id===quote.id);if(!story||story.expiresAt<Date.now())return toast(t("История больше недоступна"));openModal({translate:t,title:t("История"),body:story.kind==='image'?h('img',{class:'beta-story-photo',src:story.file,alt:story.text||t("Фото истории")}):h('p',{class:'profile-bio'},story.text)});request('/stories/'+story.id+'/view',{method:'POST',body:{}}).catch(()=>{});}catch(error){toast(betaError(error));}}
function profile(id){return showProfile(id,{request,me:state.me,onUpdate:user=>{state.me=user;toast(t("Профиль обновлён"));},onChat:user=>afterHistory(()=>openPrivate(user)),onCall:(user,video)=>afterHistory(()=>callUser(user,video))});}
async function openPrivate(user){try{const {chat}=await request('/chats/private',{method:'POST',body:{userId:user.id}});const existing=state.chats.findIndex(c=>c.id===chat.id);if(existing<0)state.chats.push(chat);else state.chats[existing]=chat;await openChat(chat);return chat;}catch(error){toast(betaError(error));}}
async function callUser(user,video){if(inCall())return toast(t("Сначала завершите текущий звонок"));if(!socket?.connected)return toast(t("Нет соединения. Подождите подключения."));const chat=await openPrivate(user);if(chat&&!chat.blocked&&!user.bot)startCall(chat,user,video);}
function callCurrent(video){const chat=state.current;if(chat?.type!=='private'||!chat.peer||chat.peer.bot||chat.blocked)return;if(!socket?.connected)return toast(t("Нет соединения. Подождите подключения."));startCall(chat,chat.peer,video);}
function connectCalls(){socket=io({transports:['websocket','polling'],withCredentials:true,auth:{accountId:state.me.id}});initCalls({socket,translate:t,userById:id=>id===state.me.id?state.me:state.chats.find(c=>c.peer?.id===id)?.peer});socket.on('message',()=>refresh());socket.on('me',user=>{if(user.id===state.me.id)state.me=user;});socket.on('family:changed',()=>location.reload());socket.on('disconnect',reason=>{if(reason==='io server disconnect')request('/me').then(()=>socket.connect()).catch(()=>{});});socket.on('connect',()=>refresh());socket.on('connect_error',error=>{if(/account_changed|unauthorized/.test(error.message)){socket.disconnect();location.replace(error.message==='unauthorized'?'/?next=/beta&login=expired':'/beta');}});}
window.addEventListener('popstate',()=>handleBack());
async function boot(){
 try{state.me=(await request('/me')).user;setAccountId(state.me.id);state.settings={...state.settings,...readLocal('settings',{})};state.notes=readLocal('notes',{});state.drafts=readLocal('drafts',{});state.chats=(await request('/chats')).chats;build();connectCalls();timer=setInterval(refresh,8000);}catch(error){root.replaceChildren(h('div',{class:'fatal'},h('h2',{},t("Не удалось открыть бету")),h('p',{},betaError(error)),h('button',{onclick:()=>location.reload()},t("Повторить")),h('a',{href:'/?server=main'},t("Обычный Limochat"))));}
}
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();palette();}if(event.key==='Escape'){closeMenu();if(closeTopModal())return;setFocus(false);if(view.emoji)view.emoji.hidden=true;}});
window.addEventListener('beforeunload',saveDraft);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('storage',event=>{if(event.key==='limoninior.account-change'){saveDraft();location.replace('/beta');}});
// Follow the visible viewport when mobile browser chrome or the keyboard changes.
function fitViewport(){document.documentElement.style.setProperty('--beta-viewport-height',(window.visualViewport?.height||window.innerHeight)+'px');}
window.visualViewport?.addEventListener('resize',fitViewport);
window.addEventListener('resize',fitViewport);
fitViewport();
boot();
