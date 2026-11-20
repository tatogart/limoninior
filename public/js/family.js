import {api,errorText} from './api.js';
import {h,icon,openModal,toast,confirmDialog} from './ui.js';
const labels={paused:'Приостановить доступ',games:'Запретить игры',purchases:'Запретить покупки и подарки',newChats:'Запретить создание чатов и вступление',calls:'Запретить входящие и исходящие звонки',bots:'Запретить ботов и студию',stories:'Запретить просмотр и публикацию историй',channels:'Запретить открывать каналы',quiet:'Включить ограничение по расписанию'};
const days=[[1,'Пн'],[2,'Вт'],[3,'Ср'],[4,'Чт'],[5,'Пт'],[6,'Сб'],[0,'Вс']];
export async function familyModal(){
 try{
 const state=await api.get('/family'),body=h('div',{class:'ws-stack family-home'});
 let modal;
 const action=(label,fn,primary=false)=>{let busy=false;const b=h('button',{type:'button',class:'btn'+(primary?' btn-primary':''),onclick:async()=>{if(busy)return;busy=true;b.disabled=true;try{await fn();}catch(e){toast(errorText(e),'error');}finally{busy=false;b.disabled=false;}}},label);return b;};
 const refresh=()=>{modal.close();familyModal();};
 const intro=h('div',{class:'family-intro'},icon('shield'),h('div',{},h('h2',{},state.parent?'Ваш семейный доступ':'Семья под защитой'),h('p',{},'Подключение подтверждает ребёнок. Родитель управляет ограничениями и расписанием, не получает доступа к переписке. Ограничения действуют для связанного аккаунта на всех устройствах.')));body.append(intro);
 const pinInput=(placeholder)=>h('input',{class:'input',type:'password',inputMode:'numeric',maxLength:6,placeholder,'aria-label':placeholder,autocomplete:'off'});
 if(state.parent){
  const c=state.controls,pin=pinInput('Родительский PIN — 6 цифр');
  body.append(h('section',{class:'family-card'},h('h3',{},'Родитель: '+state.parent.name),h('div',{class:'family-status'},...Object.entries(labels).filter(([key])=>c[key]).map(([,label])=>h('span',{},label))),!Object.keys(labels).some(k=>c[k])?h('p',{class:'muted'},'Ограничения не включены'):null,c.quiet?h('p',{class:'muted'},'Расписание: '+c.quietStart+':00–'+c.quietEnd+':00 · '+c.timeZone+' · '+days.filter(([d])=>c.quietDays.includes(d)).map(([,l])=>l).join(', ')+'. Ночной интервал относится ко дню начала.'):null,pin,action('Отключить связь',async()=>{if(await confirmDialog('Отключить родительский контроль?',{ok:'Отключить'})){await api.post('/family/disconnect',{pin:pin.value});refresh();}})));
 }else{
  const current=state.pinSet?pinInput('Текущий родительский PIN'):null,pin=pinInput(state.pinSet?'Новый родительский PIN':'Задайте PIN — 6 цифр');
  body.append(h('section',{class:'family-card'},h('h3',{},'Родительский PIN'),h('p',{class:'muted'},state.pinSet?'Для смены кода нужен текущий PIN. После пяти ошибок — пауза 15 минут.':'Задайте код, прежде чем приглашать ребёнка. Не передавайте его ребёнку.'),current,pin,action(state.pinSet?'Сменить PIN':'Сохранить PIN',async()=>{await api.post('/family/pin',{pin:pin.value,...(current?{currentPin:current.value}:{})});pin.value='';if(current)current.value='';toast('PIN сохранён');refresh();},true)));
  const invite=h('div',{class:'ws-stack'});
  body.append(h('section',{class:'family-card'},h('h3',{},'Добавить ребёнка'),h('p',{class:'muted'},'Одноразовый код действует 15 минут. Ребёнок вводит его в своём аккаунте и подтверждает подключение.'),action('Создать приглашение',async()=>{
   const {token}=await api.post('/family/invite');const out=h('textarea',{class:'input',readOnly:true,rows:2,'aria-label':'Код приглашения'});out.value=token;
   invite.replaceChildren(out,action('Скопировать код',async()=>{try{await navigator.clipboard.writeText(token);toast('Код скопирован');}catch{out.focus();out.select();toast('Скопируйте выделенный код');}}));
  }),invite));
  const code=h('input',{class:'input',placeholder:'Код приглашения родителя','aria-label':'Код приглашения родителя'});
  body.append(h('details',{class:'family-card'},h('summary',{},'Подключиться как ребёнок'),h('div',{class:'ws-stack'},h('p',{class:'muted'},'Родитель сможет ограничить доступ, звонки, игры и покупки. Для самостоятельного отключения потребуется его PIN.'),code,action('Подтвердить подключение',async()=>{if(await confirmDialog('Подключить родительский контроль с этим кодом?',{ok:'Подключить'})){await api.post('/family/accept',{token:code.value});refresh();}}))));
 }
 for(const item of state.children){
  const c={...item.controls,quietDays:[...item.controls.quietDays]},card=h('section',{class:'family-card'},h('div',{class:'family-child-head'},icon('user'),h('h3',{},item.user.name),h('small',{class:'muted'},'@'+(item.user.username||'—'))));
  const switches=h('div',{class:'family-controls'});
  for(const [key,label] of Object.entries(labels))switches.append(h('label',{class:'family-check'},h('span',{},label),h('input',{type:'checkbox',checked:c[key],onchange:e=>c[key]=e.target.checked})));
  card.append(switches);
  const schedule=h('div',{class:'family-schedule'},h('h4',{},'Расписание ограничения'),h('p',{class:'muted'},'Выберите дни начала интервала. Например, пятница 22:00–07:00 включает утро субботы. Одинаковые часы означают целый выбранный день.'));
  const daybar=h('div',{class:'family-days'});
  for(const [day,label] of days)daybar.append(h('label',{},h('input',{type:'checkbox',checked:c.quietDays.includes(day),onchange:e=>{c.quietDays=e.target.checked?[...new Set([...c.quietDays,day])]:c.quietDays.filter(n=>n!==day);}}),label));
  schedule.append(daybar);
  const hours=h('div',{class:'mod-filters'});
  for(const [key,label] of [['quietStart','Начало, час'],['quietEnd','Конец, час']])hours.append(h('label',{},label,h('select',{class:'input','aria-label':label,onchange:e=>c[key]=Number(e.target.value)},...Array.from({length:24},(_,n)=>h('option',{value:String(n),selected:n===c[key]},String(n).padStart(2,'0')+':00')))));
  const zones=[...new Set([c.timeZone,Intl.DateTimeFormat().resolvedOptions().timeZone,'Europe/Moscow','Europe/Kaliningrad','Europe/Samara','Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Kamchatka','Europe/Sofia','UTC'])];
  schedule.append(hours,h('label',{},'Часовой пояс',h('select',{class:'input','aria-label':'Часовой пояс',onchange:e=>c.timeZone=e.target.value},...zones.map(zone=>h('option',{value:zone,selected:zone===c.timeZone},zone)))));
  card.append(schedule,h('div',{class:'ws-actions'},action('Сохранить ограничения',async()=>{if(!c.quietDays.length)return toast('Выберите хотя бы один день','error');await api.put('/family/children/'+item.user.id,c);toast('Ограничения сохранены');},true),action('Отключить связь',async()=>{if(await confirmDialog('Отключить контроль для '+item.user.name+'?',{ok:'Отключить'})){await api.post('/family/disconnect',{child:item.user.id});refresh();}})));body.append(card);
 }
 modal=openModal({title:'Родительский контроль',className:'ws-modal',body});
 }catch(e){toast(errorText(e),'error');}
}
