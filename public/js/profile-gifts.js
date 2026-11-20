import {api,errorText} from './api.js';
import {h,openModal,toast} from './ui.js';
import {giftById} from './catalog.js';
import {giftArt,collectiblePreview} from './gift-art.js';

export async function profileGiftsGrid(userId,{onChange}={}){
 const root=h('div',{class:'profile-gift-browser'}),grid=h('div',{class:'profile-gifts profile-gift-grid'});
 let data;
 async function load(){
  data=await api.get('/users/'+userId+'/gifts');
  const items=[...data.gifts.map(g=>({...giftById(g.giftId),...g,type:'regular'})),...(data.collectibles||[]).map(g=>({...g,type:'collectible'}))].filter(g=>g.name).sort((a,b)=>b.createdAt-a.createdAt||b.id-a.id);
  grid.replaceChildren(...(items.length?items.map(item=>h('button',{type:'button',class:'pg-item profile-gift-tile'+(item.hidden?' is-hidden':''),'aria-label':item.name+(item.type==='collectible'?' #'+item.serial:'')+(item.hidden?' · скрыт из профиля':''),onclick:()=>passport(item)},
   h('div',{class:'pg-art'},item.type==='collectible'?collectiblePreview(item):giftArt(item)),
   h('span',{class:'profile-gift-title'},item.name),
   h('span',{class:'profile-gift-meta'},item.type==='collectible'?'#'+item.serial:(item.fromName||'Подарок')),
   item.hidden?h('span',{class:'profile-gift-hidden'},'Скрыт'):item.type==='collectible'?h('span',{class:'profile-gift-collectible'},'Коллекционный'):null)):[h('p',{class:'list-note'},'Подарков пока нет') ]));
  root.replaceChildren(...[data.isOwner?h('p',{class:'profile-gift-hint'},'Нажмите на подарок, чтобы скрыть его из профиля или вернуть. Скрытые подарки здесь видите только вы.'):null,grid].filter(Boolean));
 }
 function passport(item){
  let busy=false;const box=h('div',{class:'gift-passport'},item.type==='collectible'?collectiblePreview(item):giftArt(item),h('b',{},item.name),item.serial?h('span',{class:'muted'},'Коллекционный подарок #'+item.serial):null,item.edition?h('span',{class:'limited-gift-label'},'Экземпляр '+item.edition+'/'+item.limited):null,item.fromName?h('p',{},'От: '+item.fromName):null,item.note?h('p',{class:'pre'},item.note):null);
  if(item.traits){const table=h('table',{class:'collectible-traits-table'});for(const [key,label] of [['rarity','Редкость'],['model','Форма'],['backdrop','Фон'],['color','Цвет'],['symbol','Узор']])if(item.traits[key])table.append(h('tr',{},h('th',{},label),h('td',{},item.traits[key].name)));box.append(table);}
  if(data.isOwner)box.append(h('p',{class:'profile-gift-hint'},'Настройка скрывает подарок в профиле. Старые сообщения и объявления на площадке остаются видимыми.'));
  openModal({title:'Подарок',body:box,actions:data.isOwner?[{label:item.hidden?'Показать в профиле':'Скрыть из профиля',primary:true,onClick:async(close,button)=>{if(busy)return;busy=true;button.disabled=true;try{await api.post('/gifts/'+item.type+'/'+item.id+'/visibility',{hidden:!item.hidden});await load();await onChange?.();close();toast(item.hidden?'Подарок снова виден в профиле':'Подарок скрыт из профиля');}catch(error){toast(errorText(error),'error');}finally{busy=false;button.disabled=false;}}}]:[]});
 }
 try{await load();}catch(error){root.replaceChildren(h('p',{class:'list-note'},'Не удалось загрузить подарки'),h('button',{class:'btn',onclick:async()=>{try{await load();}catch(e){toast(errorText(e),'error');}}},'Повторить'));}
 return root;
}
