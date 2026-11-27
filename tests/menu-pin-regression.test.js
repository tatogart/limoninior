import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const ui=fs.readFileSync(new URL('../public/js/ui.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
test('menu actions wait for history cleanup before opening another overlay',()=>{
 const microtasks=[],pops=[];let menu,opened=0,closed=0;
 const ctx=vm.createContext({queueMicrotask:fn=>microtasks.push(fn),setTimeout(){},console,
 history:{state:{},pushState(){},go(){pops.push(()=>ctx.handleBack());}},
 document:{body:{append(node){menu=node;}},addEventListener(){}},window:{innerHeight:800,innerWidth:400,addEventListener(){}},requestAnimationFrame:fn=>fn(),icon:()=>({}),
 h:(tag,props,...children)=>({tag,props,children:children.flat(),style:{},classList:{add(){}},remove(){},getBoundingClientRect:()=>({width:200,height:200})})});
 const historyCode=ui.slice(ui.indexOf('const overlays ='),ui.indexOf('let modalStack =')).replaceAll('export ','');
 const menuCode=ui.slice(ui.indexOf('let activeMenu ='),ui.indexOf('export const isTouch')).replaceAll('export ','');
 vm.runInContext(historyCode+menuCode,ctx);
 ctx.contextMenu(100,100,[{label:'Информация',onClick(){opened++;ctx.registerOverlay(()=>closed++);}}]);
 menu.children[0].props.onclick();assert.equal(opened,0);
 microtasks.splice(0).forEach(fn=>fn());assert.equal(opened,0);
 pops.splice(0).forEach(fn=>fn());assert.equal(opened,1);assert.equal(closed,0);
 ctx.handleBack();assert.equal(closed,1);
});
test('read-only pinned message never passes null to native replaceChildren',()=>{
 let children=[];const c={pinnedMessage:{id:3,text:'Фото'}};
 const ctx=vm.createContext({curChat:()=>c,V:{pinBar:{classList:{toggle(){}},replaceChildren(...nodes){children=nodes;}},view:{classList:{toggle(){}}}},canPinIn:()=>false,h:(tag)=>({tag}),messagePreview:()=>'',icon:()=>({})});
 vm.runInContext(app.slice(app.indexOf('function renderPinBar()'),app.indexOf('async function pinMessage')),ctx);
 ctx.renderPinBar();assert.equal(children.length,1);assert.ok(children.every(Boolean));
 c.pinnedMessage=null;ctx.renderPinBar();assert.equal(children.length,0);
});
test('preview handles legacy messages with null text',()=>{
 const ctx=vm.createContext({});vm.runInContext(app.slice(app.indexOf('function messagePreview('),app.indexOf('\n}\n',app.indexOf('function messagePreview('))+3),ctx);
 for(const text of [null,undefined,'hello'])assert.equal(ctx.messagePreview({kind:'text',text}),text||'');
});
