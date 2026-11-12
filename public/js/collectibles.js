import {api,errorText} from './api.js';import {h,openModal,toast,afterHistory} from './ui.js';
export async function collectiblesModal({buy,refreshMe}){
 try{let modal;const data=await api.get('/collectibles'),body=h('div',{class:'ws-stack'});
 body.append(h('p',{},'Коллекционные подарки Limochat: уникальный номер экземпляра и украшение профиля. Это внутренняя коллекция, без блокчейна.'));
 const card=(item,serial,action)=>h('article',{class:'collectible-card',style:{'--collectible-color':item.color}},h('div',{class:'collectible-art','aria-hidden':true},item.emoji),h('b',{},item.name),h('small',{},serial?'Экземпляр #'+serial:item.price+' ₽ · один раз'),action);
 body.append(h('h3',{},'Моя коллекция'));
 if(!data.items.length)body.append(h('p',{class:'muted'},'Пока пусто. После подтверждения покупки подарок появится здесь.'));
 for(const row of data.items){const item=data.catalog.find(x=>x.id===row.collection);if(!item)continue;body.append(card(item,row.id,h('button',{class:'btn',onclick:async()=>{try{await api.post('/collectibles/showcase',{id:row.selected?0:row.id});await refreshMe();toast(row.selected?'Убрано из профиля':'Добавлено в профиль');modal.close();afterHistory(()=>collectiblesModal({buy,refreshMe}));}catch(e){toast(errorText(e),'error');}}},row.selected?'Убрать из профиля':'Показать в профиле')));}
 body.append(h('h3',{},'Витрина'));
 for(const item of data.catalog)body.append(card(item,null,h('button',{class:'btn',onclick:()=>buy(item)},'Обсудить покупку')));
 modal=openModal({title:'Коллекционные подарки',className:'ws-modal',body});
 }catch(e){toast(errorText(e),'error');}
}
