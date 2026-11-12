import {api,errorText} from './api.js';import {h,openModal,toast,afterHistory,confirmDialog} from './ui.js';
export async function collectiblesModal({buy,refreshMe}){
 try{
 const [data,groups]=await Promise.all([api.get('/collectibles'),api.get('/collectibles/albums')]);let modal,tab='mine',album=0;const body=h('div',{class:'ws-stack'}),list=h('div',{class:'collection-grid'}),tabs=h('div',{class:'ws-tabs'}),albums=h('div',{class:'ws-tabs'});
 const query=h('input',{class:'input',type:'search',placeholder:'Название или номер подарка'}),sort=h('select',{class:'input','aria-label':'Сортировка подарков'},[['new','Сначала новые'],['old','Сначала старые'],['price','По цене']].map(([value,text])=>h('option',{value},text)));
 const run=fn=>async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}};
 const button=(text,fn)=>h('button',{class:'btn',onclick:run(fn)},text);
 const reopen=()=>{modal.close();afterHistory(()=>collectiblesModal({buy,refreshMe}));};
 function assign(row){const selected=new Set(groups.albums.filter(a=>a.itemIds.includes(row.id)).map(a=>a.id));const box=h('div',{class:'ws-stack'});for(const a of groups.albums)box.append(h('label',{class:'ws-check'},h('input',{type:'checkbox',checked:selected.has(a.id),onchange:e=>e.target.checked?selected.add(a.id):selected.delete(a.id)}),a.name));if(!groups.albums.length)box.append(h('p',{},'Сначала создайте подборку в коллекции.'));let editor;box.append(button('Сохранить',async()=>{await api.post('/collectibles/items/'+row.id+'/albums',{albumIds:[...selected]});editor.close();reopen();}));editor=openModal({title:'В подборки',body:box});}
 function draw(){
 tabs.replaceChildren(...[['mine','Мои подарки'],['catalog','Витрина']].map(([id,name])=>h('button',{class:'ws-chip '+(tab===id?'selected':''),onclick:()=>{tab=id;draw();}},name)));
 albums.replaceChildren(h('button',{class:'ws-chip '+(!album?'selected':''),onclick:()=>{album=0;draw();}},'Все'),...groups.albums.map(a=>h('button',{class:'ws-chip '+(album===a.id?'selected':''),onclick:()=>{album=a.id;draw();}},a.name+' · '+a.itemIds.length)));albums.hidden=tab!=='mine';
 const term=query.value.trim().toLowerCase();let rows=tab==='mine'?data.items.map(row=>({...data.catalog.find(c=>c.id===row.collection),serial:row.id,selected:row.selected})):data.catalog;
 if(tab==='mine'&&album)rows=rows.filter(r=>groups.albums.find(a=>a.id===album)?.itemIds.includes(r.serial));
 rows=rows.filter(r=>(r.name+' '+(r.serial||'')).toLowerCase().includes(term)).sort((a,b)=>sort.value==='price'?a.price-b.price:sort.value==='old'?(a.serial||0)-(b.serial||0):(b.serial||0)-(a.serial||0));
 list.replaceChildren(...rows.map(r=>h('article',{class:'collectible-card',style:{'--collectible-color':r.color}},h('div',{class:'collectible-art'},r.emoji),h('b',{},r.name),h('small',{},r.serial?'Экземпляр #'+r.serial:r.price+' ₽ · один раз'),r.serial?h('div',{class:'ws-actions'},button(r.selected?'Убрать с витрины профиля':'Показать в профиле',async()=>{await api.post('/collectibles/showcase',{id:r.selected?0:r.serial});await refreshMe();reopen();}),button('В подборки',()=>assign({id:r.serial}))):button('Обсудить покупку',()=>buy(r)))));
 if(!rows.length)list.append(h('p',{class:'muted'},tab==='mine'?'Здесь пока нет подарков.':'Ничего не найдено.'));
 }
 query.addEventListener('input',draw);sort.addEventListener('change',draw);
 body.append(h('p',{},'Коллекционные подарки Limochat: уникальные номера, личные подборки и витрина профиля. Без блокчейна.'),tabs,h('div',{class:'ws-actions'},query,sort),albums,h('div',{class:'ws-actions'},button('Новая подборка',()=>{const name=h('input',{class:'input',maxLength:40,placeholder:'Например: Любимые'});let m;m=openModal({title:'Новая подборка',body:h('div',{class:'ws-stack'},name,button('Создать',async()=>{await api.post('/collectibles/albums',{name:name.value});m.close();reopen();}))});}),button('Удалить подборку',async()=>{if(!album)return toast('Выберите подборку');if(await confirmDialog('Удалить подборку? Подарки сохранятся.',{ok:'Удалить'})){await api.del('/collectibles/albums/'+album);reopen();}})),list);
 modal=openModal({title:'Коллекционные подарки',className:'ws-modal',body});draw();
 }catch(e){toast(errorText(e),'error');}
}
