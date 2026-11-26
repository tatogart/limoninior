import {h,icon,avatar,openModal,lastSeenText} from '/js/ui.js';
import {giftById} from '/js/catalog.js';
import {giftArt,collectiblePreview} from '/js/gift-art.js';
import {errorText} from '/js/api.js';

export async function showProfile(id,{request,me,onUpdate,onChat,onCall}){
 const body=h('div',{class:'beta-profile'},h('p',{role:'status'},'Загрузка профиля…'));
 const modal=openModal({title:id===me.id?'Мой профиль':'Профиль',className:'beta-profile-modal',body});
 let user;
 function draw(){
  const own=user.id===me.id;
  const header=h('div',{class:'profile-hero'},avatar({...user,src:user.avatar},88),h('h2',{},user.name,user.verified?h('span',{'aria-label':'Подтверждённый аккаунт'},' ✓'):null),h('p',{},user.username?'@'+user.username:''),h('small',{},user.bot?'Бот':lastSeenText(user)),user.scam?h('strong',{class:'scam-label'},'SCAM'):null);
  body.replaceChildren(header,user.bio?h('p',{class:'profile-bio'},user.bio):h('p',{class:'profile-bio muted'},'Описание не добавлено'));
  if(own){
   const name=h('input',{class:'profile-input',value:user.name,maxLength:64,required:true,'aria-label':'Имя'}),bio=h('textarea',{class:'profile-input',value:user.bio||'',maxLength:160,'aria-label':'О себе',rows:3}),status=h('p',{role:'status',class:'profile-status'});
   const submit=h('button',{type:'submit',class:'wide-button'},'Сохранить');
   const form=h('form',{class:'profile-edit',onsubmit:async e=>{e.preventDefault();if(!name.value.trim())return;submit.disabled=true;try{user=(await request('/me',{method:'PATCH',body:{name:name.value,bio:bio.value}})).user;onUpdate(user);header.querySelector('h2').textContent=user.name;status.textContent='Сохранено';}catch(error){status.textContent=errorText(error);}finally{submit.disabled=false;}}},h('label',{},'Имя',name),h('label',{},'О себе',bio),submit,status);
   const file=h('input',{type:'file',accept:'image/*',hidden:true,onchange:async e=>{const image=e.target.files[0];if(!image)return;const data=new FormData();data.append('file',image);try{user=(await request('/me/avatar',{method:'POST',body:data})).user;onUpdate(user);draw();}catch(error){status.textContent=errorText(error);}}});
   body.append(h('button',{class:'wide-button',onclick:()=>file.click()},'Изменить фото'),file,form);
  }else if(!user.bot){
   body.append(h('div',{class:'profile-actions'},h('button',{class:'wide-button',onclick:()=>{modal.close();onChat(user);}},icon('chat'),'Написать'),h('button',{class:'wide-button',onclick:()=>{modal.close();onCall(user,false);}},icon('phone'),'Позвонить')));
  }
  const gifts=h('div',{class:'beta-profile-gifts'},h('p',{role:'status'},'Загрузка подарков…'));body.append(h('h3',{},'Подарки'),gifts);
  request('/users/'+user.id+'/gifts').then(data=>{
   const items=[...data.gifts.map(g=>({...giftById(g.giftId),...g})),...(data.collectibles||[]).map(g=>({...g,collectible:true}))];
   gifts.replaceChildren(...(items.length?items.map(g=>h('div',{class:'beta-gift-tile'},g.collectible?collectiblePreview(g):giftArt(g),h('b',{},g.name||'Подарок'),g.serial?h('small',{},'#'+g.serial):null,g.hidden?h('small',{},'Скрыт от других'):null)):[h('p',{class:'muted'},'Подарков пока нет')]));
  }).catch(error=>gifts.replaceChildren(h('p',{},errorText(error))));
 }
 try{user=(await request(id===me.id?'/me':'/users/'+id)).user;draw();}catch(error){body.replaceChildren(h('p',{role:'alert'},errorText(error)));}
 return modal;
}
