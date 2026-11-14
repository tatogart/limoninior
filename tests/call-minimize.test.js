import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/js/calls.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\bexport /g,'');
function fixture(){
 const node=(tag,props={},...children)=>{
 const classes=new Set((props.class||'').split(' '));
 return {tag,props,children:children.flat(Infinity).filter(x=>x!=null&&x!==false),classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){on?classes.add(c):classes.delete(c);},contains:c=>classes.has(c)},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},querySelector(){return null;},querySelectorAll(){return [];},remove(){this.removed=true;}};
 };
 let stopped=0,closed=0,released=0,back;const emitted=[];
 const remote={getVideoTracks:()=>[]},track={stop(){stopped++;}},local={getTracks:()=>[track],getAudioTracks:()=>[track],getVideoTracks:()=>[]};
 const context=vm.createContext({h:node,icon:n=>node('icon',{name:n}),avatar:()=>node('avatar'),toast(){},registerOverlay(fn){back=fn;return ()=>released++;},document:{body:node('body')},navigator:{userAgent:'Android',mediaDevices:{}},HTMLMediaElement:class{},setInterval:()=>1,clearInterval(){},setTimeout:fn=>fn(),requestAnimationFrame:fn=>fn(),stopRing(){},Date,console});
 context.initial={id:7,peer:{id:2,name:'Друг'},status:'connected',connectedAt:Date.now(),mic:true,cam:false,local,remote,speaker:true,pc:{close(){closed++;}}};
 context.transport={socket:{emit(...args){emitted.push(args);}}};
 vm.runInContext(source+`;call=initial;ctx=transport;globalThis.ui={render,minimize,expand,hangup,toggleMic,getCall:()=>call,getOverlay:()=>overlay};`,context);
 return {ui:context.ui,stats:()=>({stopped,closed,released}),emitted,back:()=>back(),remote,local};
}
test('minimizing and restoring a live call preserves peer connection, tracks and remote media element',()=>{
 const f=fixture();f.ui.render();const c=f.ui.getCall(),media=c.remoteEl,pc=c.pc;
 f.ui.minimize();assert.equal(c.mini,true);assert.ok(f.ui.getOverlay().classList.contains('call-minimized'));assert.deepEqual(f.stats(),{stopped:0,closed:0,released:1});assert.equal(f.emitted.length,0);
 f.ui.render();assert.equal(c.remoteEl,media);assert.equal(c.pc,pc);assert.equal(c.local,f.local);assert.equal(c.remote,f.remote);
 f.ui.expand();assert.equal(c.mini,false);assert.equal(c.remoteEl,media);assert.equal(f.ui.getOverlay().classList.contains('call-minimized'),false);
 f.back();assert.equal(c.mini,true);assert.equal(f.emitted.length,0);
 f.ui.toggleMic();assert.equal(c.mic,false);assert.equal(f.emitted[0][0],'call:state');
 f.ui.hangup();assert.equal(f.ui.getCall(),null);assert.equal(f.emitted.at(-1)[0],'call:end');assert.equal(f.stats().stopped,1);assert.equal(f.stats().closed,1);
});
test('incoming calls can be minimized without accepting or rejecting them',()=>{
 const f=fixture();f.ui.getCall().status='incoming';f.ui.render();f.ui.minimize();
 assert.equal(f.ui.getCall().status,'incoming');assert.equal(f.emitted.length,0);
 const flatten=n=>[n,...(n.children||[]).filter(x=>typeof x==='object').flatMap(flatten)];
 const labels=flatten(f.ui.getOverlay()).map(n=>n.props?.['aria-label']);
 assert.ok(labels.includes('Ответить'));assert.ok(labels.includes('Отклонить'));assert.ok(labels.includes('Развернуть звонок'));
});
