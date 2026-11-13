import {TRAITS,traitSummary} from './collectible-traits.js';
import {collectiblePreview,giftArt} from './gift-art.js';
import {giftById} from './catalog.js';
import {api,errorText} from './api.js';
import {h,openModal,toast,afterHistory,confirmDialog} from './ui.js';
export async function collectiblesModal({refreshMe},initialTab='mine'){
 try{
 const [data,groups,market]=await Promise.all([api.get('/collectibles'),api.get('/collectibles/albums'),api.get('/collectibles/market')]);
 let modal,tab=initialTab,album=0;const body=h('div',{class:'collectibles-ui'}),list=h('div',{class:'collection-grid'}),tabs=h('div',{class:'ws-tabs'}),albums=h('div',{class:'ws-tabs'}),albumActions=h('div',{class:'ws-actions'});
 const query=h('input',{class:'input',type:'search',placeholder:'Название или номер'}),sort=h('select',{class:'input','aria-label':'Сортировка подарков'},[['new','Сначала новые'],['old','Сначала старые'],['price','По цене']].map(([value,text])=>h('option',{value},text)));
 const run=fn=>async()=>{try{await fn();}catch(e){toast(({gift_already_upgraded:'Этот подарок уже улучшен',gift_not_upgradeable:'Этот подарок нельзя улучшить',already_listed:'Подарок уже выставлен',cancel_listing_first:'Сначала снимите подарок с продажи',upgrade_changed:'Цена или шансы изменились. Закройте и заново откройте коллекции.',upgrades_disabled:'Улучшения временно отключены',transfers_disabled:'Передачи временно отключены'})[e.code||e.message]||errorText(e),'error');}};
 const button=(text,fn)=>h('button',{class:'btn',onclick:run(fn)},text);
 const reopen=()=>{modal.close();afterHistory(()=>collectiblesModal({refreshMe},tab));};
 const info=r=>({...data.catalog.find(c=>c.id===(r.collection||r.id)),...r});
 function preview(r){const item=info(r),box=h('div',{class:'ws-stack'});box.append(collectiblePreview(item),h('b',{},item.name+(r.serial?' #'+r.serial:'')),item.limited?h('span',{class:'limited-gift-label'},item.edition?'Экземпляр '+item.edition+'/5':'Лимитка · всего 5'):null);
 if(item.traits){const table=h('table',{class:'collectible-traits-table'});for(const [key,label] of [['rarity','Редкость'],['model','Форма'],['backdrop','Фон'],['color','Цвет'],['symbol','Узор']]){const t=item.traits[key];if(t)table.append(h('tr',{},h('th',{},label),h('td',{},t.name),h('td',{},Number(t.chance.toFixed(2))+'%')));}box.append(table,h('p',{class:'muted'},'Шансы на момент выпуска. Атрибуты закреплены за экземпляром.'));}else box.append(h('p',{class:'muted'},r.serial?'Ранее выпущенный экземпляр без случайных атрибутов.':'При улучшении оформление выпадет случайно.'));
 openModal({title:'Паспорт подарка',body:box});}
 function transfer(r){const input=h('input',{class:'input',placeholder:'@юзернейм получателя',maxLength:33});let m;m=openModal({title:'Передать #'+r.serial,body:h('div',{class:'ws-stack'},h('p',{},'Подарок полностью перейдёт выбранному пользователю. Передача бесплатна.'),input,button('Проверить получателя',async()=>{const {user}=await api.get('/collectibles/recipient/'+encodeURIComponent(input.value.trim().replace(/^@/,'')));if(await confirmDialog('Передать '+r.name+' #'+r.serial+' пользователю '+user.name+' (@'+user.username+')? Вы потеряете владение этим подарком.',{ok:'Передать'})){await api.post('/collectibles/items/'+r.serial+'/transfer',{recipientId:user.id});await refreshMe();m.close();reopen();}}))});}
 function assign(row){const selected=new Set(groups.albums.filter(a=>a.itemIds.includes(row.id)).map(a=>a.id)),box=h('div',{class:'ws-stack'});for(const a of groups.albums)box.append(h('label',{class:'ws-check'},h('input',{type:'checkbox',checked:selected.has(a.id),onchange:e=>e.target.checked?selected.add(a.id):selected.delete(a.id)}),a.name));if(!groups.albums.length)box.append(h('p',{},'Сначала создайте подборку.'));let editor;box.append(button('Сохранить',async()=>{await api.post('/collectibles/items/'+row.id+'/albums',{albumIds:[...selected]});editor.close();reopen();}));editor=openModal({title:'В подборки',body:box});}
 function listForSale(r){const price=h('input',{class:'input',type:'number',min:1,max:1000000,placeholder:'Цена в лимонах'});let m;m=openModal({title:'Продать #'+r.serial,body:h('div',{class:'ws-stack'},price,button('Выставить',async()=>{await api.post('/collectibles/items/'+r.serial+'/list',{price:Number(price.value)});m.close();reopen();}))});}
 function upgrade(gift){const box=h('div',{class:'ws-stack'}),g=giftById(gift.giftId);box.append(giftArt(g),h('p',{},'Улучшение стоит '+gift.upgradeCost+' 🍋. Форма, фон, цвет, узор и редкость выбираются случайно на сервере. Повторное улучшение недоступно.'));
 for(const [key,label] of [['rarity','Редкость'],['model','Формы'],['backdrop','Фоны'],['color','Цвета'],['symbol','Узоры']]){const rows=TRAITS[key],total=Object.values(data.policy.weights[key]).reduce((a,b)=>a+b,0);box.append(h('details',{},h('summary',{},label+' · шансы'),h('p',{class:'muted'},rows.map(r=>r.name+' '+Number((data.policy.weights[key][r.id]/total*100).toFixed(2))+'%').join(' · '))));}
 let m;box.append(button('Улучшить · '+gift.upgradeCost+' 🍋',async()=>{if(!await confirmDialog('Списать '+gift.upgradeCost+' лимонов за случайное улучшение? Результат не выбирается вручную.',{ok:'Улучшить'}))return;const result=await api.post('/collectibles/gifts/'+gift.id+'/upgrade',{expectedCost:gift.upgradeCost,policyToken:data.policyToken});await refreshMe();m.close();tab='mine';reopen();afterHistory(()=>preview({...result.item,serial:result.serial}));}));m=openModal({title:'Случайное улучшение',body:box});}
 function draw(){
 sort.querySelector('option[value=price]').textContent=tab==='market'?'По цене':'По названию';
 tabs.replaceChildren(...[['mine','Мои'],['market','Площадка'],['upgrade','Улучшить'],['catalog','Коллекции']].map(([id,name])=>h('button',{class:'ws-chip '+(tab===id?'selected':''),onclick:()=>{tab=id;draw();}},name)));
 albums.hidden=albumActions.hidden=tab!=='mine';
 albums.replaceChildren(h('button',{class:'ws-chip '+(!album?'selected':''),onclick:()=>{album=0;draw();}},'Все'),...groups.albums.map(a=>h('button',{class:'ws-chip '+(album===a.id?'selected':''),onclick:()=>{album=a.id;draw();}},a.name+' · '+a.itemIds.length)));
 const term=query.value.trim().toLowerCase();list.replaceChildren();
 if(tab==='market'){
 const rows=market.listings.filter(l=>(info(l).name+' '+l.serial+' '+l.seller).toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.price-b.price:sort.value==='old'?a.id-b.id:b.id-a.id);
 for(const l of rows){const c=info(l);list.append(h('article',{class:'collectible-card'},collectiblePreview(c),h('b',{},c.name+' #'+l.serial),c.edition?h('span',{class:'limited-gift-label'},c.edition+'/5'):null,h('small',{},traitSummary(c.traits)),h('small',{},l.seller+' · '+l.price+' 🍋'),l.sellerId===market.myId?button('Снять с продажи',async()=>{await api.post('/collectibles/listings/'+l.id+'/cancel');reopen();}):button('Купить',async()=>{if(await confirmDialog('Купить #'+l.serial+' за '+l.price+' лимонов?',{ok:'Купить'})){await api.post('/collectibles/listings/'+l.id+'/buy');await refreshMe();reopen();}}),button('Посмотреть',()=>preview(l))));}
 if(!rows.length)list.append(h('p',{class:'muted'},'Объявлений пока нет. Выставьте подарок из раздела «Мои».'));return;
 }
 if(tab==='upgrade'){
 list.append(h('p',{class:'collectible-hint'},data.policy.enabled?'Случайное улучшение подарков дороже '+data.policy.minGiftPrice+' 🍋. Стоимость: '+data.policy.upgradePercent+'% цены подарка, минимум '+data.policy.minUpgradeCost+' 🍋.':'Улучшения временно отключены.'));
 const rows=(data.upgradeable||[]).filter(g=>(giftById(g.giftId)?.name||'').toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.price-b.price:sort.value==='old'?a.id-b.id:b.id-a.id);
 for(const g of rows){const c=giftById(g.giftId);list.append(h('article',{class:'collectible-card'},giftArt(c),h('b',{},c.name+' #'+g.id),data.policy.enabled?button('Улучшить · '+g.upgradeCost+' 🍋',()=>upgrade(g)):null));}
 if(!rows.length)list.append(h('p',{class:'muted'},'Нет подходящих подарков для улучшения.'));return;
 }
 let rows=tab==='mine'?data.items.map(r=>({...info(r),serial:r.id,selected:r.selected,traits:r.traits})):data.catalog;
 if(tab==='mine'&&album)rows=rows.filter(r=>groups.albums.find(a=>a.id===album)?.itemIds.includes(r.serial));
 rows=rows.filter(r=>(r.name+' '+(r.serial||'')).toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.name.localeCompare(b.name):sort.value==='old'?(a.serial||0)-(b.serial||0):(b.serial||0)-(a.serial||0));
 for(const r of rows)list.append(h('article',{class:'collectible-card'},collectiblePreview(r),h('b',{},r.name),r.limited?h('span',{class:'limited-gift-label'},r.edition?'Экземпляр '+r.edition+'/5':'Осталось '+(data.limitedStock?.[r.id]?.remaining??0)+'/5'):null,r.traits?h('small',{},traitSummary(r.traits)):null,h('small',{},r.serial?'#'+r.serial:r.sourceGift?'Улучшение: '+giftById(r.sourceGift).name:'Ранее выпущенная коллекция'),button('Посмотреть',()=>preview(r)),r.serial?h('details',{},h('summary',{},'Действия'),h('div',{class:'ws-stack'},button(r.selected?'Убрать из профиля':'Показать в профиле',async()=>{await api.post('/collectibles/showcase',{id:r.selected?0:r.serial});await refreshMe();reopen();}),button('В подборки',()=>assign({id:r.serial})),button('Продать',()=>listForSale(r)),data.policy.transfersEnabled?button('Передать',()=>transfer(r)):null)):null));
 if(!rows.length)list.append(h('p',{class:'muted'},'Здесь пока нет подарков.'));
 }
 albumActions.append(button('Новая подборка',()=>{const name=h('input',{class:'input',maxLength:40,placeholder:'Название'});let m;m=openModal({title:'Новая подборка',body:h('div',{class:'ws-stack'},name,button('Создать',async()=>{await api.post('/collectibles/albums',{name:name.value});m.close();reopen();}))});}),button('Удалить подборку',async()=>{if(!album)return toast('Выберите подборку');if(await confirmDialog('Удалить подборку? Подарки сохранятся.',{ok:'Удалить'})){await api.del('/collectibles/albums/'+album);reopen();}}));
 query.addEventListener('input',draw);sort.addEventListener('change',draw);
 body.append(h('p',{class:'muted'},'Площадка пользователей · баланс '+market.balance+' 🍋'),tabs,h('div',{class:'collectible-filters'},query,sort),albums,albumActions,list);
 modal=openModal({title:'Коллекционные подарки',className:'ws-modal collectibles-modal',body});draw();
 }catch(e){toast(errorText(e),'error');}
}
