import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../beta/assets/app.js',import.meta.url),'utf8');
class Element{
 constructor(tag,props={},...children){this.tag=tag;this.props=props;this.dataset=props.dataset||{};this.style={setProperty(){}};this.hidden=props.hidden||false;this.value=props.value||'';this.className=props.class||'';this.children=[];this.scrollHeight=200;this.clientHeight=200;this.scrollTop=0;this.classList={add(){},remove(){},contains(){return false;},toggle(){}};this.append(...children);}
 append(...children){this.children.push(...children.flat().filter(c=>c!=null));}replaceChildren(...children){this.children=[];this.append(...children);}addEventListener(){}setAttribute(){}removeAttribute(){}focus(){}select(){}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){const matches=n=>n instanceof Element&&(selector==='[data-section]'?n.dataset.section:selector==='[data-message-id]'?n.dataset.messageId:selector[0]==='.'?n.className.split(' ').includes(selector.slice(1)):n.tag===selector);return this.children.flatMap(n=>n instanceof Element?[...(matches(n)?[n]:[]),...n.querySelectorAll(selector)]:[]);}
}
function fixture(){
 const root=new Element('root'),document={querySelector:()=>root,documentElement:{style:{setProperty(){}},dataset:{}},addEventListener(){},hidden:false};let init,transport,called;
 const ctx=vm.createContext({t:s=>s,getLanguage:()=>'ru',document,window:{addEventListener(){},innerHeight:800},matchMedia:()=>({matches:false}),h:(...args)=>new Element(...args),icon:n=>new Element('svg',{name:n}),avatar:()=>new Element('avatar'),richText:s=>s,timeHM:()=>'',setInterval(){},clearInterval(){},location:{},localStorage:{getItem:()=>null,setItem(){}},errorText:()=>'',io:opts=>{transport={connected:true,opts,on(){}};return transport;},initCalls:options=>init=options,startCall:(...args)=>called=args,inCall:()=>false,handleBack(){},setAccountId(){},closeTopModal(){},closeMenu(){},contextMenu(){},afterHistory:fn=>fn()});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/\nboot\(\);\s*$/,'')+';globalThis.testing={state,view,build,openChat,connectCalls,callCurrent};',ctx);
 ctx.testing.state.me={id:1,name:'Tester'};ctx.testing.build();return {ctx,ui:ctx.testing,init:()=>init,transport:()=>transport,called:()=>called};
}
test('beta builds profile navigation, shared call transport and peer profile button',()=>{
 const f=fixture();assert.ok(f.ui.view.rail.querySelector('.nav-profile'));assert.equal(f.ui.view.chatIdentity.tag,'button');f.ui.connectCalls();assert.equal(f.transport().opts.auth.accountId,1);assert.equal(f.init().socket,f.transport());
 const peer={id:2,name:'Friend'},chat={id:4,type:'private',peer};f.ui.state.current=chat;f.ui.callCurrent(true);assert.equal(f.called()[0],chat);assert.equal(f.called()[1],peer);assert.equal(f.called()[2],true);
 f.ui.state.current={...chat,blocked:'me'};const previous=f.called();f.ui.callCurrent(false);assert.equal(f.called(),previous);
});
test('story preview uses image fallback and keeps complete emoji graphemes',()=>{
 const src=fs.readFileSync(new URL('../public/js/stories.js',import.meta.url),'utf8');const ctx=vm.createContext({h:(...args)=>new Element(...args),icon:n=>new Element('svg',{name:n}),bgCss:()=>'',Intl,Date,toast(){}});vm.runInContext(src.slice(src.indexOf('export function storyQuote')).replace('export ',''),ctx);
 const quote=ctx.storyQuote({kind:'image',file:'/missing.svg',expiresAt:Date.now()+60000},()=>{});const thumb=quote.children[0];assert.equal(thumb.children[0].tag,'img');thumb.children[0].props.onerror();assert.equal(thumb.children[0].tag,'svg');
 const expired=ctx.storyQuote({kind:'image',file:'/private.svg',expiresAt:1},()=>{});assert.equal(expired.querySelectorAll('img').length,0);
 const text=ctx.storyQuote({kind:'text',text:'👨‍👩‍👧‍👦❤️hello',expiresAt:Date.now()+60000},()=>{});assert.equal(text.children[0].children[0].children[0],'👨‍👩‍👧‍👦❤️');
});
