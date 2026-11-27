import {api,errorText} from './api.js';
import {h,openModal,toast} from './ui.js';
export function paidLemonDialog(message,me,onChange){
 let busy=false,key=crypto.randomUUID();
 const amount=h('input',{class:'input',type:'number',min:'1',max:'1000',step:'1','aria-label':'Количество лимонов',value:1}),status=h('p',{class:'muted small','aria-live':'polite'});
 const send=h('button',{class:'btn btn-primary btn-block',onclick:async()=>{
 if(busy)return;const value=Number(amount.value);if(!Number.isSafeInteger(value)||value<1||value>1000)return toast('Выберите от 1 до 1000 лимонов','error');
 busy=true;send.disabled=true;status.textContent='Отправляем…';
 try{const r=await api.post('/messages/'+message.id+'/lemons',{amount:value,requestKey:key});me.coins=r.balance;onChange(r);modal.close();toast('Автор получил '+value+' 🍋');}
 catch(e){status.textContent=errorText(e);busy=false;send.disabled=false;}
 }},'Отправить 1 🍋');
 const update=()=>{send.textContent='Отправить '+(Number(amount.value)||0)+' 🍋';};amount.addEventListener('input',()=>{key=crypto.randomUUID();update();});
 const modal=openModal({title:'Поддержать автора',className:'modal-small',body:h('div',{class:'paid-lemon-dialog'},h('p',{},'Лимоны спишутся с вашего баланса и полностью поступят автору сообщения. Перевод нельзя отменить.'),h('blockquote',{class:'mod-report-text'},String(message.text||'Сообщение #'+message.id).slice(0,180)),h('b',{},'Ваш баланс: '+(me.coins||0)+' 🍋'),h('div',{class:'paid-lemon-presets'},...[1,5,10,50,100].map(n=>h('button',{class:'btn',onclick:()=>{if(busy)return;amount.value=n;key=crypto.randomUUID();update();}},n+' 🍋'))),amount,send,status)});
}
