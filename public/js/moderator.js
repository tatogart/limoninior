import {api,errorText} from './api.js';
import {h,openModal,toast,confirmDialog} from './ui.js';
export async function moderatorPanel(){
 try{
 await api.get('/staff/access');
 const body=h('div',{class:'ws-stack'}),content=h('div'),tabs=h('div',{class:'ws-actions'});
 const run=fn=>async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}};
 const button=(label,fn)=>h('button',{class:'btn',onclick:run(fn)},label);
 async function reports(){const r=await api.get('/staff/reports');content.replaceChildren(...r.reports.map(v=>h('section',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},'Репорт #'+v.id+' · '+v.reason),h('p',{},v.comment),h('pre',{class:'ws-pre'},v.snapshot),button('Рассмотрено',async()=>{await api.post('/staff/reports/'+v.id,{status:'resolved'});reports();}),button('Отклонить',async()=>{await api.post('/staff/reports/'+v.id,{status:'dismissed'});reports();})))));if(!r.reports.length)content.append(h('p',{},'Открытых репортов нет'));}
 async function verifications(){const r=await api.get('/staff/verifications');content.replaceChildren(...r.channels.map(v=>h('section',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},v.title),h('p',{},v.description),button('Одобрить заявку',async()=>{if(await confirmDialog('Одобрить верификацию '+v.title+'?',{ok:'Одобрить'})){await api.post('/staff/verifications/'+v.id,{approve:true});verifications();}}),button('Отклонить заявку',async()=>{await api.post('/staff/verifications/'+v.id,{approve:false});verifications();})))));if(!r.channels.length)content.append(h('p',{},'Заявок нет'));}
 function users(){const query=h('input',{class:'input',placeholder:'Имя или @юзернейм'}),list=h('div');content.replaceChildren(query,button('Найти',async()=>{const r=await api.get('/staff/users?q='+encodeURIComponent(query.value.replace(/^@/,'')));list.replaceChildren(...r.users.map(u=>h('section',{class:'ws-card'},h('b',{},u.name),h('p',{},'@'+u.username),h('p',{},u.bio))));}),list);}
 tabs.append(button('Репорты',reports),button('Профили',users),button('Заявки на галочки',verifications));body.append(h('p',{},'Панель модератора. Изменения записываются в журнал действий.'),tabs,content);openModal({title:'Модерация',className:'ws-modal',body});await reports();
 }catch(e){toast(errorText(e),'error');}
}