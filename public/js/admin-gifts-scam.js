import {api,errorText} from './api.js';
import {h,openModal,toast,confirmDialog} from './ui.js';
import {giftById} from './catalog.js';
const button=(text,fn)=>h('button',{class:'btn',onclick:async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}}},text);
export async function markScam(type,target,refresh){
 const reason=h('textarea',{class:'input',maxLength:300,placeholder:'Причина отметки SCAM'});reason.value=target.scamReason||'';let modal;
 const body=h('div',{class:'ws-stack'},h('p',{},target.scam?'Отметка будет снята с '+(target.name||target.title):'Отметка SCAM будет видна рядом с именем '+(target.name||target.title)),target.scam?null:reason,
 button(target.scam?'Снять SCAM':'Установить SCAM',async()=>{if(!target.scam&&reason.value.trim().length<3)return toast('Укажите причину: от 3 до 300 символов','error');await api.post('/admin/'+type+'/'+target.id+'/scam',{enabled:!target.scam,reason:reason.value.trim()});modal.close();toast('Отметка обновлена');refresh?.();}));
 modal=openModal({title:'Отметка SCAM',body});
}
export async function transferInventory(userId){
 const data=await api.get('/admin/users/'+userId+'/gift-inventory'),choices=[...data.items.map(i=>({type:'collectible',id:i.id,name:(data.catalog.find(c=>c.id===i.collection)?.name||i.collection)+' #'+i.id})),...data.regular.map(g=>({type:'regular',id:g.id,name:(giftById(g.gift_id)?.name||g.gift_id)+' #'+g.id}))];
 if(!choices.length)return toast('У пользователя нет доступных подарков');
 const selection=h('select',{class:'input'},choices.map((c,i)=>h('option',{value:String(i)},(c.type==='regular'?'Обычный: ':'Коллекционный: ')+c.name))),recipient=h('input',{class:'input',placeholder:'@юзернейм нового владельца',maxLength:33});let modal;
 const body=h('div',{class:'ws-stack collectible-admin'},h('label',{},'Подарок',selection),h('label',{},'Получатель',recipient),h('p',{class:'muted'},'Владение перейдёт получателю. Объявление о продаже будет снято. В чат добавится карточка передачи от администратора.'),button('Проверить и передать',async()=>{const {user}=await api.get('/admin/gifts/recipient/'+encodeURIComponent(recipient.value.trim().replace(/^@/,''))),gift=choices[Number(selection.value)];if(user.id===userId)return toast('Этот пользователь уже владелец','error');if(!await confirmDialog('Передать '+gift.name+' пользователю '+user.name+' (@'+user.username+') от имени администрации?',{ok:'Передать'}))return;await api.post('/admin/users/'+userId+'/gifts/'+gift.id+'/transfer',{recipientId:user.id,type:gift.type});modal.close();toast('Подарок передан');}));modal=openModal({title:'Передать подарок пользователя',body});
}
