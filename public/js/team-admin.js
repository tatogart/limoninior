import {api,errorText} from './api.js';
import {h,openModal,toast,confirmDialog} from './ui.js';
const names={submitted:'Новая',awaiting_time:'Кандидат выбирает время',time_proposed:'Нужно подтвердить время',scheduled:'Созвон подтверждён',rejected:'Отклонена',completed:'Завершена'};
const date=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'long',timeStyle:'short'}).format(value)+' МСК';
export function teamApplications({onError}={}){
 const root=h('div',{class:'ws-stack'}),list=h('div',{class:'ws-stack'}),delivery=h('p',{class:'muted',role:'status'}),status=h('select',{class:'input','aria-label':'Статус заявок'},...Object.entries({active:'Активные',submitted:'Новые',awaiting_time:'Ожидаем время',time_proposed:'Время на подтверждение',scheduled:'Назначенные созвоны',rejected:'Отклонённые',completed:'Завершённые',all:'Все'}).map(([value,label])=>h('option',{value},label)));
 let epoch=0;
 const error=e=>{if(onError)onError(e);else toast(errorText(e),'error');};
 const button=(label,fn)=>{let busy=false;const b=h('button',{type:'button',class:'btn',onclick:async()=>{if(busy)return;busy=true;b.disabled=true;try{await fn();}catch(e){error(e);}finally{busy=false;b.disabled=false;}}},label);return b;};
 async function load(){
  const turn=++epoch;
  try{
   const data=await api.get('/admin/team-applications?status='+encodeURIComponent(status.value));if(turn!==epoch||!root.isConnected&&root.wasConnected)return;
   root.wasConnected=root.isConnected;
   delivery.textContent=data.pendingDelivery?'Ожидают доставки сообщений: '+data.pendingDelivery+'. Бот повторит отправку автоматически.':'Уведомления доставлены.';
   list.replaceChildren(...data.applications.map(app=>{
    const note=h('textarea',{class:'input',rows:2,maxLength:1000,placeholder:'Комментарий кандидату (необязательно)','aria-label':'Комментарий по заявке #'+app.id});
    const act=(action,label)=>button(label,async()=>{
     if(!await confirmDialog(label+' по заявке #'+app.id+'?'+(action==='confirm'?' '+date(app.proposed_at):''),{ok:label}))return;
     await api.post('/admin/team-applications/'+app.id+'/action',{action,version:app.version,note:note.value});toast('Решение сохранено. Бот отправит уведомления.');await load();
    });
    const actions=h('div',{class:'ws-actions'}),self=app.user_id===data.myId;
    if(!self&&['submitted','awaiting_time','time_proposed'].includes(app.status)){
     if(!app.admin_id||app.admin_id===data.myId)actions.append(act('invite',app.status==='submitted'?'Пригласить на созвон':'Попросить другое время'));
     if(app.status==='time_proposed'&&app.admin_id===data.myId)actions.append(act('confirm','Подтвердить время и отправить ссылку'));
     actions.append(act('reject','Отклонить заявку'));
    }
    if(!self&&app.status==='scheduled'&&app.admin_id===data.myId)actions.append(act('complete','Завершить рассмотрение'));
    const card=h('section',{class:'ws-card'},h('div',{class:'ws-card-body ws-stack'},
     h('strong',{},'Заявка #'+app.id+' · '+app.role),h('span',{},app.name+' · @'+(app.username||'без юзернейма')),
     h('span',{class:'muted'},names[app.status]||app.status),
     self?h('p',{class:'muted'},'Это ваша заявка. Её должен рассмотреть другой администратор.'):null,h('small',{class:'muted'},'Подана: '+date(app.created_at)),
     h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},app.experience),
     app.admin_name?h('small',{class:'muted'},'Созвон проводит: '+app.admin_name):null,
     app.proposed_at?h('p',{},'Предложенное время: '+date(app.proposed_at)):null,
     app.status==='scheduled'&&app.admin_id===data.myId?h('a',{class:'btn',href:'/call/'+app.call_token,target:'_blank',rel:'noopener'},'Открыть созвон'):null,
     app.note?h('p',{style:{whiteSpace:'pre-wrap'}},'Комментарий: '+app.note):null,
     actions.children.length?note:null,actions));
    return card;
   }));
   if(!data.applications.length)list.append(h('p',{class:'muted'},'Заявок с таким статусом нет.'));
  }catch(e){error(e);}
 }
 status.addEventListener('change',load);
 root.append(h('p',{class:'muted'},'Заявки поступают через официального бота. Кандидат предлагает время по Москве, администратор подтверждает — бот отправляет ссылку обоим. Назначение прав выполняется отдельно.'),
 h('div',{class:'ws-actions'},status,button('Обновить',load),button('Повторить доставку',async()=>{await api.post('/admin/team-applications/deliver');await load();})),delivery,list);
 load();return root;
}
