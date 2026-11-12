import {api,errorText} from './api.js';
import {h,openModal,toast,confirmDialog} from './ui.js';
export async function familyModal(){
 try{
 const state=await api.get('/family'),body=h('div',{class:'ws-stack'});
 const action=(label,fn)=>h('button',{class:'btn',onclick:async()=>{try{await fn();}catch(e){toast(errorText(e),'error');}}},label);
 body.append(h('p',{},'Связь подключается с подтверждением ребёнка. Родитель видит настройки ограничений, но не получает доступ к переписке. Отключение доступно обоим.'));
 let modal;
 const refresh=()=>{modal.close();familyModal();};
 if(state.parent){body.append(h('b',{},'Родитель: '+state.parent.name),h('p',{},'Текущие ограничения: '+Object.entries(state.controls).filter(([k,v])=>typeof v==='boolean'&&v).map(([k])=>({paused:'пауза',games:'игры',purchases:'покупки',newChats:'новые чаты',quiet:'ночной режим'})[k]).join(', ')),action('Отключить связь',async()=>{if(await confirmDialog('Отключить родительский контроль?',{ok:'Отключить'})){await api.post('/family/disconnect');refresh();}}));}
 else{
 body.append(action('Создать приглашение ребёнку',async()=>{const {token}=await api.post('/family/invite');const out=h('textarea',{class:'input',readOnly:true,value:token});body.append(h('p',{},'Передайте этот код ребёнку. Действует 15 минут, используется один раз.'),out);}));
 const code=h('input',{class:'input',placeholder:'Код приглашения родителя'});body.append(code,action('Подтвердить подключение к родителю',async()=>{if(await confirmDialog('Подключить родительский контроль? Родитель сможет ограничивать доступ, игры и покупки.',{ok:'Подключить'})){await api.post('/family/accept',{token:code.value});refresh();}}));
 }
 for(const item of state.children){const c={...item.controls},card=h('section',{class:'ws-card'},h('b',{},item.user.name));
 for(const [key,label] of Object.entries({paused:'Приостановить доступ',games:'Запретить игры',purchases:'Запретить покупки и подарки',newChats:'Запретить создание новых чатов',quiet:'Ночное ограничение (МСК)'}))card.append(h('label',{class:'ws-check'},h('input',{type:'checkbox',checked:c[key],onchange:e=>c[key]=e.target.checked}),label));
 for(const [key,label] of [['quietStart','Начало, час МСК'],['quietEnd','Конец, час МСК']])card.append(h('label',{},label,h('input',{class:'input',type:'number',min:0,max:23,value:c[key],oninput:e=>c[key]=Number(e.target.value)})));
 card.append(action('Сохранить ограничения',async()=>{await api.put('/family/children/'+item.user.id,c);toast('Ограничения сохранены');}),action('Отключить связь',async()=>{if(await confirmDialog('Отключить связь?',{ok:'Отключить'})){await api.post('/family/disconnect',{child:item.user.id});refresh();}}));body.append(card);}
 modal=openModal({title:'Родительский контроль',className:'ws-modal',body});
 }catch(e){toast(errorText(e),'error');}
}
