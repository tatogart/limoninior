import {api,errorText} from './api.js';
import {h,icon,avatar,openModal,toast,confirmDialog} from './ui.js';

export function accountsModal({canChange,onSwitch,onAdd}){
 const list=h('div',{class:'accounts-list','aria-live':'polite'});
 const count=h('p',{class:'accounts-caption'});
 let busy=false,loaded=false,limit=5,total=0;
 const add=h('button',{type:'button',class:'btn btn-primary btn-block accounts-add',disabled:true,onclick:()=>{
  if(busy||!loaded||total>=limit||!canChange())return;
  onAdd();
 }},icon('plus'),'Добавить аккаунт');
 const modal=openModal({title:'Аккаунты',className:'modal-accounts',body:h('div',{class:'accounts-home'},
  h('p',{class:'accounts-description'},'Переключайтесь между аккаунтами на этом устройстве без повторного ввода пароля.'),count,list,add,
  h('p',{class:'accounts-caption'},'Удаление из списка завершает только этот сеанс. Сам аккаунт и его переписки сохранятся. Уведомления приходят для активного аккаунта.'))});
 const draw=async()=>{
  list.replaceChildren(h('p',{class:'accounts-caption'},'Загружаем аккаунты…'));
  try{
   const data=await api.get('/auth/accounts');limit=data.limit;total=data.accounts.length;loaded=true;
   count.textContent=total+' из '+limit+' аккаунтов';
   list.replaceChildren(...data.accounts.map(user=>{
    const choose=h('button',{type:'button',class:'accounts-select',disabled:user.current,onclick:async()=>{
     if(busy||!canChange())return;busy=true;add.disabled=true;
     list.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{await api.post('/auth/accounts/switch',{userId:user.id});onSwitch();}
     catch(e){busy=false;toast(errorText(e),'error');await draw();}
    }},avatar(user,48),h('span',{class:'accounts-text'},h('strong',{},user.name||'Аккаунт'),h('small',{},user.username?'@'+user.username:'Без юзернейма')),user.current?h('span',{class:'accounts-current'},icon('check'),'Выбран'):icon('right'));
    const remove=h('button',{type:'button',class:'accounts-remove','aria-label':'Убрать аккаунт '+(user.name||user.id),title:'Убрать с устройства',onclick:async()=>{
     if(busy||(user.current&&!canChange()))return;
     if(!await confirmDialog('Вы выйдете из аккаунта '+(user.name||'')+' на этом устройстве. Его можно добавить снова.',{ok:'Убрать',danger:true}))return;
     if(busy)return;busy=true;add.disabled=true;list.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{const result=await api.post('/auth/accounts/remove',{userId:user.id});if(result.currentRemoved){onSwitch();return;}busy=false;await draw();}
     catch(e){busy=false;toast(errorText(e),'error');await draw();}
    }},icon('logout'));
    return h('div',{class:'accounts-row'+(user.current?' selected':'')},choose,remove);
   }));
   if(!total)list.append(h('p',{class:'accounts-empty'},'Пока нет сохранённых аккаунтов. Добавьте первый.'));
   add.disabled=busy||total>=limit;
  }catch(e){loaded=false;list.replaceChildren(h('p',{class:'accounts-caption'},errorText(e)),h('button',{type:'button',class:'btn btn-ghost',onclick:draw},'Повторить'));add.disabled=true;}
 };
 draw();return modal;
}
