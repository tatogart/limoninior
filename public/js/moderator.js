import {reportView} from './report-view.js';
import {api,errorText} from './api.js';
import {h,openModal,toast,confirmDialog} from './ui.js';
export async function moderatorPanel(){
 try{
 await api.get('/staff/access');
 const body=h('div',{class:'ws-stack'}),content=h('div'),tabs=h('div',{class:'ws-actions'});
 const run=fn=>async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}};
 const button=(label,fn)=>h('button',{class:'btn',onclick:run(fn)},label);
 const date=t=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(t)+' МСК';
 function sanctions(v){
 const duration=h('select',{class:'input','aria-label':'Срок ограничения'},...[1,6,24,72,168].map(n=>h('option',{value:String(n)},n+' ч')));
 const act=(label,action)=>button(label,async()=>{if(!await confirmDialog(label+' автору нарушения?'+(action==='warn'?'':' Срок: '+duration.value+' ч'),{ok:label}))return;await api.post('/staff/reports/'+v.id+'/action',{action,hours:Number(duration.value)});await reports();});
 return h('details',{},h('summary',{},'Меры к нарушителю'),h('div',{class:'ws-stack'},duration,h('div',{class:'ws-actions'},act('Предупредить','warn'),act('Мут','mute'),act('Временный бан','ban'))));
 }
 async function reports(){const r=await api.get('/staff/reports');content.replaceChildren(...r.reports.map(v=>{const view=reportView(v);return h('section',{class:'ws-card mod-report'},h('div',{class:'ws-card-body'},h('b',{},'Жалоба #'+v.id+' · '+view.reason),view.createdAt?h('small',{class:'muted'},'Поступила: '+date(view.createdAt)):null,view.author?h('div',{},h('strong',{},v.target_type==='user'?'Пользователь: ':'Автор сообщения: '),view.author):null,h('div',{class:'muted'},view.context),h('small',{class:'muted'},view.kind+(view.at?' · '+date(view.at):'')),h('blockquote',{class:'mod-report-text'},view.text||'Без текста'),view.file?h('a',{class:'btn',href:view.file,target:'_blank',rel:'noopener noreferrer'},'Открыть вложение'):null,v.comment?h('p',{class:'mod-report-text'},h('strong',{},'Комментарий к жалобе: '),v.comment):null,sanctions(v),h('div',{class:'ws-actions'},button('Рассмотрено',async()=>{await api.post('/staff/reports/'+v.id,{status:'resolved'});await reports();}),button('Отклонить',async()=>{await api.post('/staff/reports/'+v.id,{status:'dismissed'});await reports();}))));}));if(!r.reports.length)content.append(h('p',{},'Открытых репортов нет'));}
 async function verifications(){const r=await api.get('/staff/verifications');content.replaceChildren(...r.channels.map(v=>h('section',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},v.title),h('p',{},v.description),button('Одобрить заявку',async()=>{if(await confirmDialog('Одобрить верификацию '+v.title+'?',{ok:'Одобрить'})){await api.post('/staff/verifications/'+v.id,{approve:true});verifications();}}),button('Отклонить заявку',async()=>{await api.post('/staff/verifications/'+v.id,{approve:false});verifications();})))));if(!r.channels.length)content.append(h('p',{},'Заявок нет'));}
 function users(){const query=h('input',{class:'input',placeholder:'Имя или @юзернейм'}),list=h('div');content.replaceChildren(query,button('Найти',async()=>{const r=await api.get('/staff/users?q='+encodeURIComponent(query.value.replace(/^@/,'')));list.replaceChildren(...r.users.map(u=>h('section',{class:'ws-card'},h('b',{},u.name),h('p',{},'@'+u.username),h('p',{},u.bio))));}),list);}
 tabs.append(button('Репорты',reports),button('Профили',users),button('Заявки на галочки',verifications));body.append(h('p',{},'Панель модератора. Изменения записываются в журнал действий.'),tabs,content);openModal({title:'Модерация',className:'ws-modal',body});await reports();
 }catch(e){toast(errorText(e),'error');}
}