import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../beta/assets/app.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\nfunction ',start+1));}
test('beta search highlights only matching loaded messages and clears highlights',()=>{
 const nodes=['Привет мир','Другое сообщение','ПРИВЕТ'].map(textContent=>({textContent,matched:false,classList:{toggle(_key,value){this.owner.matched=value;}}}));nodes.forEach(n=>n.classList.owner=n);
 const state={searchText:'привет'},view={messages:{querySelectorAll:()=>nodes},searchCount:{}};
 const ctx=vm.createContext({state,view});vm.runInContext(fn('updateMessageSearch'),ctx);ctx.updateMessageSearch();assert.equal(view.searchMatches.length,2);assert.equal(nodes[1].matched,false);assert.match(view.searchCount.textContent,/2/);
 state.searchText='';ctx.updateMessageSearch();assert.ok(nodes.every(n=>!n.matched));assert.equal(view.searchCount.textContent,'');
});
test('beta jump button appears only when away from latest messages',()=>{
 const view={messages:{scrollHeight:1000,clientHeight:400,scrollTop:0},jump:{hidden:true}};const ctx=vm.createContext({view});vm.runInContext(fn('updateJump'),ctx);ctx.updateJump();assert.equal(view.jump.hidden,false);view.messages.scrollTop=600;ctx.updateJump();assert.equal(view.jump.hidden,true);
});
