import {collectiblePreview,giftArt} from './gift-art.js';
import {giftById} from './catalog.js';
import {api,errorText} from './api.js';
import {h,openModal,toast,afterHistory,confirmDialog} from './ui.js';
export async function collectiblesModal({refreshMe},initialTab='mine'){
 try{
 const [data,groups,market]=await Promise.all([api.get('/collectibles'),api.get('/collectibles/albums'),api.get('/collectibles/market')]);
 let modal,tab=initialTab,album=0;const body=h('div',{class:'collectibles-ui'}),list=h('div',{class:'collection-grid'}),tabs=h('div',{class:'ws-tabs'}),albums=h('div',{class:'ws-tabs'}),albumActions=h('div',{class:'ws-actions'});
 const query=h('input',{class:'input',type:'search',placeholder:'Название или номер'}),sort=h('select',{class:'input','aria-label':'Сортировка подарков'},[['new','Сначала новые'],['old','Сначала старые'],['price','По цене']].map(([value,text])=>h('option',{value},text)));
 const run=fn=>async()=>{try{await fn();}catch(e){toast(({gift_already_upgraded:'Этот подарок уже улучшен',gift_not_upgradeable:'Этот подарок нельзя улучшить',already_listed:'Подарок уже выставлен'})[e.error||e.message]||errorText(e),'error');}};
 const button=(text,fn)=>h('button',{class:'btn',onclick:run(fn)},text);
 const reopen=()=>{modal.close();afterHistory(()=>collectiblesModal({refreshMe},tab));};
 const info=r=>data.catalog.find(c=>c.id===r.collection)||r;
 function preview(r){const item=info(r),box=h('div',{class:'ws-stack'}),art=collectiblePreview(item,item.backdrop||'aurora');box.append(art,h('b',{},item.name+(r.serial?' #'+r.serial:'')));for(const id of ['aurora','night','sunset','ice'])box.append(button(({aurora:'Сияние',night:'Ночь',sunset:'Закат',ice:'Лёд'})[id],()=>{art.dataset.backdrop=id;}));openModal({title:'Просмотр подарка',body:box});}
 function assign(row){const selected=new Set(groups.albums.filter(a=>a.itemIds.includes(row.id)).map(a=>a.id)),box=h('div',{class:'ws-stack'});for(const a of groups.albums)box.append(h('label',{class:'ws-check'},h('input',{type:'checkbox',checked:selected.has(a.id),onchange:e=>e.target.checked?selected.add(a.id):selected.delete(a.id)}),a.name));if(!groups.albums.length)box.append(h('p',{},'Сначала создайте подборку.'));let editor;box.append(button('Сохранить',async()=>{await api.post('/collectibles/items/'+row.id+'/albums',{albumIds:[...selected]});editor.close();reopen();}));editor=openModal({title:'В подборки',body:box});}
 function listForSale(r){const price=h('input',{class:'input',type:'number',min:1,max:1000000,placeholder:'Цена в лимонах'});let m;m=openModal({title:'Продать #'+r.serial,body:h('div',{class:'ws-stack'},price,button('Выставить',async()=>{await api.post('/collectibles/items/'+r.serial+'/list',{price:Number(price.value)});m.close();reopen();}))});}
 function upgrade(gift){const variants=data.catalog.filter(c=>c.sourceGift===gift.giftId),box=h('div',{class:'collection-grid'});let m;for(const c of variants)box.append(h('article',{class:'collectible-card'},collectiblePreview(c,c.backdrop),h('b',{},c.name),button('Выбрать · 20 🍋',async()=>{if(!await confirmDialog('Улучшить подарок за 20 лимонов? Каждый обычный подарок можно улучшить один раз.',{ok:'Улучшить'}))return;await api.post('/collectibles/gifts/'+gift.id+'/upgrade',{collection:c.id});await refreshMe();m.close();tab='mine';reopen();})));m=openModal({title:'Выберите вариант улучшения',body:box});}
 function draw(){
 sort.querySelector('option[value=price]').textContent=tab==='market'?'По цене':'По названию';
 tabs.replaceChildren(...[['mine','Мои'],['market','Площадка'],['upgrade','Улучшить'],['catalog','Коллекции']].map(([id,name])=>h('button',{class:'ws-chip '+(tab===id?'selected':''),onclick:()=>{tab=id;draw();}},name)));
 albums.hidden=albumActions.hidden=tab!=='mine';
 albums.replaceChildren(h('button',{class:'ws-chip '+(!album?'selected':''),onclick:()=>{album=0;draw();}},'Все'),...groups.albums.map(a=>h('button',{class:'ws-chip '+(album===a.id?'selected':''),onclick:()=>{album=a.id;draw();}},a.name+' · '+a.itemIds.length)));
 const term=query.value.trim().toLowerCase();list.replaceChildren();
 if(tab==='market'){
 const rows=market.listings.filter(l=>(info(l).name+' '+l.serial+' '+l.seller).toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.price-b.price:sort.value==='old'?a.id-b.id:b.id-a.id);
 for(const l of rows){const c=info(l);list.append(h('article',{class:'collectible-card'},collectiblePreview(c,c.backdrop),h('b',{},c.name+' #'+l.serial),h('small',{},l.seller+' · '+l.price+' 🍋'),l.sellerId===market.myId?button('Снять с продажи',async()=>{await api.post('/collectibles/listings/'+l.id+'/cancel');reopen();}):button('Купить',async()=>{if(await confirmDialog('Купить #'+l.serial+' за '+l.price+' лимонов?',{ok:'Купить'})){await api.post('/collectibles/listings/'+l.id+'/buy');await refreshMe();reopen();}}),button('Посмотреть',()=>preview(l))));}
 if(!rows.length)list.append(h('p',{class:'muted'},'Объявлений пока нет. Выставьте подарок из раздела «Мои».'));return;
 }
 if(tab==='upgrade'){
 list.append(h('p',{class:'collectible-hint'},'Подарки дороже 125 🍋 можно улучшить за 20 🍋. Вы выбираете вариант; улучшение доступно один раз.'));
 const rows=(data.upgradeable||[]).filter(g=>(giftById(g.giftId)?.name||'').toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.price-b.price:sort.value==='old'?a.id-b.id:b.id-a.id);
 for(const g of rows){const c=giftById(g.giftId);list.append(h('article',{class:'collectible-card'},giftArt(c),h('b',{},c.name+' #'+g.id),button('Улучшить · 20 🍋',()=>upgrade(g))));}
 if(!rows.length)list.append(h('p',{class:'muted'},'Нет подходящих подарков для улучшения.'));return;
 }
 let rows=tab==='mine'?data.items.map(r=>({...info(r),serial:r.id,selected:r.selected})):data.catalog;
 if(tab==='mine'&&album)rows=rows.filter(r=>groups.albums.find(a=>a.id===album)?.itemIds.includes(r.serial));
 rows=rows.filter(r=>(r.name+' '+(r.serial||'')).toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.name.localeCompare(b.name):sort.value==='old'?(a.serial||0)-(b.serial||0):(b.serial||0)-(a.serial||0));
 for(const r of rows)list.append(h('article',{class:'collectible-card'},collectiblePreview(r,r.backdrop),h('b',{},r.name),h('small',{},r.serial?'#'+r.serial:r.sourceGift?'Улучшение: '+giftById(r.sourceGift).name:'Ранее выпущенная коллекция'),button('Посмотреть',()=>preview(r)),r.serial?h('details',{},h('summary',{},'Действия'),h('div',{class:'ws-stack'},button(r.selected?'Убрать из профиля':'Показать в профиле',async()=>{await api.post('/collectibles/showcase',{id:r.selected?0:r.serial});await refreshMe();reopen();}),button('В подборки',()=>assign({id:r.serial})),button('Продать',()=>listForSale(r)))):null));
 if(!rows.length)list.append(h('p',{class:'muted'},'Здесь пока нет подарков.'));
 }
 albumActions.append(button('Новая подборка',()=>{const name=h('input',{class:'input',maxLength:40,placeholder:'Название'});let m;m=openModal({title:'Новая подборка',body:h('div',{class:'ws-stack'},name,button('Создать',async()=>{await api.post('/collectibles/albums',{name:name.value});m.close();reopen();}))});}),button('Удалить подборку',async()=>{if(!album)return toast('Выберите подборку');if(await confirmDialog('Удалить подборку? Подарки сохранятся.',{ok:'Удалить'})){await api.del('/collectibles/albums/'+album);reopen();}}));
 query.addEventListener('input',draw);sort.addEventListener('change',draw);
 body.append(h('p',{class:'muted'},'Площадка пользователей · баланс '+market.balance+' 🍋'),tabs,h('div',{class:'collectible-filters'},query,sort),albums,albumActions,list);
 modal=openModal({title:'Коллекционные подарки',className:'ws-modal collectibles-modal',body});draw();
 }catch(e){toast(errorText(e),'error');}
}
