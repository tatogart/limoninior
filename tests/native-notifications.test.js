import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8'),start=app.indexOf('async function notify(chat, m)');const notifySource=app.slice(start,app.indexOf('\n}\n',start)+2);
test('desktop notifications work without Web Push, respect privacy and focus the app on click',async()=>{
 const shown=[],opened=[];let focused=0;class Notification {static permission='granted';constructor(title,options){this.title=title;this.options=options;shown.push(this);}close(){this.closed=true;}}
 const S={current:1,me:{prefs:{pushPreview:false}},settings:{notify:true}};
 const ctx=vm.createContext({S,Notification,window:{Notification,limoNative:{desktop:true,show(){focused++;}},focus(){}},document:{hidden:true},navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({})}})}},isGroup:()=>false,isChannel:()=>false,userName:()=> 'Друг',messagePreview:()=> 'Приватный текст',openChat:id=>opened.push(id)});
 vm.runInContext(notifySource+';globalThis.run=notify;',ctx);await ctx.run({id:9},{chatId:9,senderId:2});assert.equal(shown.length,1);assert.equal(shown[0].options.body,'Новое сообщение');shown[0].onclick();assert.equal(focused,1);assert.deepEqual(opened,[9]);
 await ctx.run({id:9,muted:true},{chatId:9});assert.equal(shown.length,1);S.me.prefs.notifyPrivate=false;await ctx.run({id:9},{chatId:9});assert.equal(shown.length,1);
});
test('cold-start notification click preserves the target chat in the launch URL',async()=>{
 let click,pending,target;const ctx=vm.createContext({URL,Number,location:{origin:'https://test.invalid'},self:{addEventListener(type,fn){if(type==='notificationclick')click=fn;},clients:{matchAll:async()=>[],openWindow:async url=>{target=url;}}}});
 vm.runInContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),ctx);
 click({notification:{close(){},data:{chatId:42}},waitUntil:p=>pending=p});await pending;assert.equal(target,'/?chat=42');
 click({notification:{close(){},data:{chatId:'invalid'}},waitUntil:p=>pending=p});await pending;assert.equal(target,'/');
});
