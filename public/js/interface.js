import {h,icon,openModal} from './ui.js';

export function navigation({onSelect,avatar}){
 const buttons=new Map(),badge=h('span',{class:'shell-unread hidden','aria-hidden':'true'});
 const el=h('nav',{class:'shell-nav','aria-label':'Основные разделы'},...[
  ['chats','chat','Чаты'],['contacts','user','Контакты'],['settings','settings','Настройки'],['profile','user','Профиль']
 ].map(([id,ic,label])=>{const button=h('button',{type:'button',class:'shell-nav-item',dataset:{section:id},onclick:()=>onSelect(id)},h('span',{class:'shell-nav-icon'},id==='profile'?avatar():icon(ic),id==='chats'?badge:null),h('span',{class:'shell-nav-label'},label));buttons.set(id,button);return button;}));
 return {el,select(id){for(const [key,button] of buttons){button.classList.toggle('selected',key===id);if(key===id)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}},unread(n){badge.textContent=n>99?'99+':String(n);badge.classList.toggle('hidden',!n);buttons.get('chats').setAttribute('aria-label',n?'Чаты, непрочитанных: '+n:'Чаты');}};
}
export function settingsHome({me,avatar,actions,version}){
 const row=(ic,title,subtitle,color,action)=>h('button',{type:'button',class:'hub-row',onclick:action},h('span',{class:'hub-icon',style:{'--tile-color':color}},icon(ic)),h('span',{class:'hub-row-text'},h('b',{},title),subtitle?h('small',{},subtitle):null),icon('right','hub-chevron'));
 const section=(title,...rows)=>h('section',{class:'hub-card'},title?h('h2',{},title):null,...rows);
 const search=h('input',{type:'search',class:'input hub-search',placeholder:'Поиск настроек','aria-label':'Поиск настроек'});
 const body=h('div',{class:'settings-home'},h('div',{class:'hub-account'},h('button',{class:'hub-avatar',onclick:actions.edit,'aria-label':'Редактировать профиль'},avatar()),h('h1',{},me.name),h('span',{class:'muted'},'@'+me.username)),search,
 section(null,row('user','Аккаунт','Имя, фото, музыка и плейлисты','#299fea',actions.edit),row('chat','Настройки чатов','Темы, обои и размер текста','#edaa32',actions.appearance),row('lock','Конфиденциальность','Время входа, звонки, блокировки','#48ba58',actions.privacy),row('bell','Уведомления','Звуки, вибрация и push','#e95b78',actions.notifications),row('folder','Папки с чатами','Органайзер, папки и шаблоны','#2faada',actions.folders),row('devices','Устройства','Управление активными сеансами','#46b9bf',actions.devices)),
 section('Оформление',row('palette','Темы Limochat','Выберите свою атмосферу','#9669de',actions.themes),row('sparkles','Читаемость и анимации','Шрифт и производительность','#e5893d',actions.performance)),
 section('Limochat',row('crown','Limochat Premium','Больше возможностей','#9867ee',actions.subscription),row('gift','Коллекционные подарки','Коллекции и площадка','#eea52d',actions.gifts),row('shield','Безопасность','Пароль и восстановление аккаунта','#52b87c',actions.security),row('shield','Родительский контроль','Семья и ограничения','#31a9c1',actions.family)),
 section('Дополнительно',row('settings','Все настройки','Полный список параметров','#6d91b3',actions.allSettings)),
 section('Помощь',row('megaphone','Новости Limochat','Что нового в мессенджере','#3da4e8',actions.news),row('info','Справка','Ответы на вопросы','#2fa8e7',actions.help),row('lock','Конфиденциальность данных',null,'#4dbb65',actions.policy)),h('p',{class:'hub-version'},'Limochat · '+version));
 search.addEventListener('input',()=>{const query=search.value.trim().toLocaleLowerCase('ru');for(const row of body.querySelectorAll('.hub-row'))row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(query);for(const card of body.querySelectorAll('.hub-card'))card.hidden=![...card.querySelectorAll('.hub-row')].some(row=>!row.hidden);});
 return openModal({title:'Настройки',className:'shell-screen shell-settings',body});
}
export function contactsScreen({users,avatar,status,onOpen,onFind}){
 const input=h('input',{class:'input hub-search',type:'search',placeholder:'Найти собеседника','aria-label':'Поиск собеседников'}),list=h('div',{class:'hub-card contact-list'});
 const draw=()=>{const query=input.value.trim().toLocaleLowerCase('ru');const rows=users.filter(u=>(u.name+' '+u.username).toLocaleLowerCase('ru').includes(query));list.replaceChildren(...(rows.length?rows.map(u=>h('button',{type:'button',class:'contact-row',onclick:()=>onOpen(u.id)},avatar(u),h('span',{class:'grow'},h('b',{},u.name),h('small',{class:u.online?'accent':'muted'},status(u))),icon('right'))):[h('p',{class:'list-note'},query?'Нет совпадений':'Здесь появятся ваши собеседники из личных чатов')]));};input.addEventListener('input',draw);draw();
 return openModal({title:'Контакты',className:'shell-screen shell-contacts',body:h('div',{class:'contacts-home'},input,h('button',{class:'hub-find',onclick:onFind},icon('search'),'Найти по @юзернейму'),h('p',{class:'hub-caption'},'Собеседники из ваших чатов'),list)});
}
let profileTabSequence=0;
export function profileTabs(tabs){
 const prefix="profile-"+(++profileTabSequence)+"-";
 const bar=h('div',{class:'profile-tabs',role:'tablist','aria-label':'Разделы профиля'}),panels=h('div',{class:'profile-tab-content'}),buttons=[];
 const select=index=>{tabs.forEach((tab,i)=>{tab.content.hidden=i!==index;buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});};
 tabs.forEach((tab,index)=>{const button=h('button',{type:'button',role:'tab',id:prefix+'tab-'+tab.id,'aria-controls':prefix+'panel-'+tab.id,onclick:()=>select(index)},tab.title);tab.content.id=prefix+'panel-'+tab.id;tab.content.setAttribute('role','tabpanel');tab.content.setAttribute('aria-labelledby',button.id);buttons.push(button);bar.append(button);panels.append(tab.content);button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(next!==undefined){event.preventDefault();select(next);buttons[next].focus();}});});select(0);
 return h('section',{class:'profile-library'},bar,panels);
}
