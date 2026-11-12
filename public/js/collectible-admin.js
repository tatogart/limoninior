import {api,errorText} from './api.js';
import {TRAITS} from './collectible-traits.js';
import {h,openModal,toast,confirmDialog} from './ui.js';
const button=(label,fn)=>h('button',{class:'btn',onclick:async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}}},label);
export async function collectibleSettings(){
 const {policy}=await api.get('/admin/collectibles/settings'),box=h('div',{class:'ws-stack collectible-admin'}),controls={},weights={};
 box.append(h('h2',{},'Коллекционные подарки'),h('p',{},'Настройки применяются к новым улучшениям. Атрибуты уже выпущенных экземпляров сохраняются.'));
 for(const [key,label] of [['enabled','Разрешить улучшения'],['transfersEnabled','Разрешить передачи']]){const el=h('input',{type:'checkbox',checked:policy[key]});controls[key]=el;box.append(h('label',{},el,' '+label));}
 for(const [key,label,min,max] of [['minGiftPrice','Подарок должен быть дороже, 🍋',0,100000],['upgradePercent','Стоимость улучшения, % от цены',1,100],['minUpgradeCost','Минимальная стоимость улучшения, 🍋',1,10000]]){const el=h('input',{class:'input',type:'number',min,max,value:policy[key]});controls[key]=el;box.append(h('label',{},label,el));}
 for(const [key,label] of [['rarity','Редкости'],['model','Формы'],['backdrop','Фоны'],['color','Цвета'],['symbol','Узоры']]){
 const group=h('details',{},h('summary',{},label+' — веса выпадения')),rows=h('div',{class:'ws-stack collectible-admin'});weights[key]={};
 const total=()=>Object.values(weights[key]).reduce((a,x)=>a+Math.max(0,Number(x.input.value)||0),0);
 const update=()=>{const sum=total();for(const x of Object.values(weights[key]))x.odds.textContent=sum?Number((Number(x.input.value)/sum*100).toFixed(2))+'%':'Нужен положительный вес';};
 for(const r of TRAITS[key]){const input=h('input',{class:'input',type:'number',min:0,max:10000,value:policy.weights[key][r.id],oninput:update}),odds=h('small',{});weights[key][r.id]={input,odds};rows.append(h('label',{},r.name,input,odds));}update();group.append(rows);box.append(group);
 }
 box.append(button('Сохранить настройки',async()=>{const next={weights:{}};for(const [k,el] of Object.entries(controls))next[k]=el.type==='checkbox'?el.checked:Number(el.value);for(const [k,rows] of Object.entries(weights))next.weights[k]=Object.fromEntries(Object.entries(rows).map(([id,x])=>[id,Number(x.input.value)]));await api.post('/admin/collectibles/settings',next);toast('Настройки коллекций сохранены');}));return box;
}
export async function grantCollectible(userId){
 const {catalog}=await api.get('/admin/collectibles/settings'),box=h('div',{class:'ws-stack collectible-admin'}),collection=h('select',{class:'input'},catalog.map(c=>h('option',{value:c.id},c.name))),controls={};box.append(h('label',{},'Коллекция',collection));
 for(const [key,label] of [['rarity','Редкость'],['model','Форма'],['backdrop','Фон'],['color','Цвет'],['symbol','Узор']]){const input=h('select',{class:'input'},h('option',{value:''},'Случайно'),TRAITS[key].map(r=>h('option',{value:r.id},r.name)));controls[key]=input;box.append(h('label',{},label,input));}
 let modal;box.append(button('Выдать подарок',async()=>{if(!await confirmDialog('Выдать коллекционный подарок выбранному пользователю?',{ok:'Выдать'}))return;const traits=Object.fromEntries(Object.entries(controls).filter(([,el])=>el.value).map(([k,el])=>[k,el.value]));const result=await api.post('/admin/users/'+userId+'/collectible',{collection:collection.value,traits});toast('Выдан экземпляр #'+result.serial);modal.close();}));modal=openModal({title:'Выдать коллекционный подарок',body:box});
}
