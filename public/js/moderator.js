import {reportView} from './report-view.js';
import {api,errorText} from './api.js';
import {h,icon,openModal,toast,confirmDialog} from './ui.js';
export async function moderatorPanel(){
 try{
 const access=await api.get('/staff/access');if(!access.moderator)return toast('Недостаточно прав','error');
 const body=h('div',{class:'ws-stack moderation-home'}),content=h('div',{class:'ws-stack'}),tabs=h('div',{class:'moderation-tabs'}),summary=h('div',{class:'moderation-summary'});
 const run=fn=>async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}};
 const button=(label,fn)=>h('button',{type:'button',class:'btn',onclick:run(fn)},label);
 const date=t=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(t)+' МСК';
 const names={warn:'Предупреждение',mute:'Мут',ban:'Временный бан'};
 let epoch=0;
 async function counters(){const s=await api.get('/staff/summary');summary.replaceChildren(...[[s.open,'Открыто'],[s.resolved,'Решено'],[s.verifications,'Заявок'],[s.actions,'Ваших мер за 7 дней']].map(([n,label])=>h('div',{},h('strong',{},n),h('small',{},label))));}
 function sanctions(id,type,refresh){
  const duration=h('select',{class:'input','aria-label':'Срок ограничения'},...[1,6,24,72,168].map(n=>h('option',{value:String(n)},n+' ч')));
  const reason=h('textarea',{class:'input',rows:2,maxLength:500,placeholder:type==='users'?'Причина меры (обязательно)':'Примечание к мере','aria-label':'Причина модерации'});
  let busy=false;
  const act=(label,action)=>button(label,async()=>{if(busy)return;if(type==='users'&&reason.value.trim().length<3)return toast('Укажите причину: минимум 3 символа','error');if(!await confirmDialog(label+' пользователю?'+(action==='warn'?'':' Срок: '+duration.value+' ч'),{ok:label,danger:action==='ban'}))return;if(busy)return;busy=true;try{await api.post('/staff/'+type+'/'+id+'/action',{action,hours:Number(duration.value),reason:reason.value});await refresh();await counters();}finally{busy=false;}});
  return h('details',{class:'mod-measures'},h('summary',{},'Меры к пользователю'),h('div',{class:'ws-stack'},reason,duration,h('div',{class:'ws-actions'},act('Предупредить','warn'),act('Мут','mute'),act('Временный бан','ban'))));
 }
 let reportStatus='open',reportReason='';
 async function reports(){
  const turn=++epoch;const r=await api.get('/staff/reports?'+new URLSearchParams({status:reportStatus,reason:reportReason}));if(turn!==epoch)return;
  const status=h('select',{class:'input','aria-label':'Статус жалоб',onchange:e=>{reportStatus=e.target.value;run(reports)();}},...[['open','Открытые'],['resolved','Рассмотренные'],['dismissed','Отклонённые']].map(([v,l])=>h('option',{value:v,selected:v===reportStatus},l)));
  const reason=h('select',{class:'input','aria-label':'Причина жалобы',onchange:e=>{reportReason=e.target.value;run(reports)();}},...Object.entries({'':'Все причины',spam:'Спам',abuse:'Оскорбления',scam:'Мошенничество',nsfw:'Непристойное',violence:'Насилие',fake:'Выдаёт себя за другого',other:'Другое'}).map(([v,l])=>h('option',{value:v,selected:v===reportReason},l)));
  content.replaceChildren(h('div',{class:'mod-filters'},status,reason),...r.reports.map(v=>{
   const view=reportView(v),note=h('textarea',{class:'input',rows:2,maxLength:1000,placeholder:'Комментарий к решению','aria-label':'Комментарий к решению'});
   return h('section',{class:'ws-card mod-report'},h('div',{class:'ws-card-body'},h('b',{},'Жалоба #'+v.id+' · '+view.reason),h('small',{class:'muted'},date(v.created_at)),view.author?h('div',{},'Автор: '+view.author):null,h('div',{class:'muted'},view.context),h('small',{class:'muted'},view.kind),h('blockquote',{class:'mod-report-text'},view.text||'Без текста'),view.file?h('a',{class:'btn',href:view.file,target:'_blank',rel:'noopener noreferrer'},'Открыть вложение'):null,v.comment?h('p',{class:'mod-report-text'},'Комментарий: '+v.comment):null,
    v.status==='open'?h('div',{class:'ws-stack'},sanctions(v.id,'reports',reports),note,h('div',{class:'ws-actions'},... [['resolved','Рассмотрено'],['dismissed','Отклонить']].map(([status,label])=>button(label,async()=>{await api.post('/staff/reports/'+v.id,{status,note:note.value});await reports();await counters();})))):h('p',{class:'mod-report-text'},'Решение: '+(v.resolution||'Без комментария')+(v.resolved_at?' · '+date(v.resolved_at):''))));
  }));if(!r.reports.length)content.append(h('p',{class:'muted'},'Жалоб с такими фильтрами нет'));
 }
 async function verifications(){
  const turn=++epoch;const r=await api.get('/staff/verifications');if(turn!==epoch)return;
  const cards=r.channels.map(v=>{
   const actions=[[true,'Одобрить'],[false,'Отклонить']].map(([approve,label])=>button(label,async()=>{
    if(!await confirmDialog(label+' заявку '+v.title+'?',{ok:label}))return;
    await api.post('/staff/verifications/'+v.id,{approve});await verifications();await counters();
   }));
   return h('section',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},v.title),h('p',{},v.description),h('div',{class:'ws-actions'},...actions)));
  });
  content.replaceChildren(...cards);if(!r.channels.length)content.append(h('p',{class:'muted'},'Заявок нет'));
 }
 function users(){++epoch;const query=h('input',{class:'input',placeholder:'Имя или @юзернейм','aria-label':'Поиск пользователя'}),list=h('div',{class:'ws-stack'});const search=async()=>{const turn=++epoch;const r=await api.get('/staff/users?q='+encodeURIComponent(query.value.replace(/^@/,'')));if(turn!==epoch)return;list.replaceChildren(...r.users.map(u=>h('section',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},u.name),h('p',{},'@'+(u.username||'—')),h('p',{class:'mod-report-text'},u.bio||''),h('p',{class:'muted'},u.moderation.banned?'Заблокирован'+(u.moderation.bannedUntil?' до '+date(u.moderation.bannedUntil):''):u.moderation.mutedUntil>Date.now()?'Мут до '+date(u.moderation.mutedUntil):'Без активных ограничений'),h('small',{class:'muted'},'Мер в журнале: '+u.moderation.actions),u.moderation.protected?h('p',{class:'muted'},'Защищённый аккаунт'):sanctions(u.id,'users',search)))));if(!r.users.length)list.append(h('p',{class:'muted'},'Пользователи не найдены'));};query.addEventListener('keydown',e=>{if(e.key==='Enter')run(search)();});content.replaceChildren(query,button('Найти',search),list);}
 async function history(){const turn=++epoch;const r=await api.get('/staff/actions');if(turn!==epoch)return;content.replaceChildren(...r.actions.map(a=>h('section',{class:'ws-card'},h('div',{class:'ws-card-body'},h('b',{},names[a.action]+' · '+(a.name||'Аккаунт #'+a.user_id)),h('p',{class:'mod-report-text'},a.reason),h('small',{class:'muted'},date(a.created_at)+' · модератор #'+a.actor),h('p',{class:'muted'},a.revoked_at?'Отменено '+date(a.revoked_at):a.until_at?'Срок: до '+date(a.until_at):'Без ограничения доступа'),a.canRevoke?button('Отменить свою меру',async()=>{if(!await confirmDialog('Отменить это временное ограничение?',{ok:'Отменить меру'}))return;await api.post('/staff/actions/'+a.id+'/revoke');await history();await counters();}):null))));if(!r.actions.length)content.append(h('p',{class:'muted'},'Журнал пока пуст'));}
 tabs.replaceChildren(...[['Жалобы','shield',reports],['Пользователи','user',users],['Верификация','check',verifications],['Журнал','clock',history]].map(([label,ic,fn],i)=>{const b=h('button',{type:'button',class:'btn'+(i===0?' btn-primary':''),onclick:run(async()=>{tabs.querySelectorAll('button').forEach(node=>node.classList.toggle('btn-primary',node===b));await fn();})},icon(ic),label);return b;}));
 body.append(h('p',{class:'muted'},'Меры требуют причины и записываются в журнал. Чужие переписки и данные входа здесь недоступны.'),summary,tabs,content);openModal({title:'Модерация',className:'ws-modal',body});await Promise.all([reports(),counters()]);
 }catch(e){toast(errorText(e),'error');}
}
