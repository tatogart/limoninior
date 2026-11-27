import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/js/profile-music.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
function fixture(stored=null,blocked=false){
 const instances=[];let persisted=stored;
 class Node{constructor(tag,props={},children=[]){this.tag=tag;this.props=props;this.children=children.flat(Infinity).filter(Boolean);this.listeners={};this.style={};this.isConnected=true;this.value=props.value;this.classList={toggle(){}};for(const [name,value] of Object.entries(props))if(name.startsWith('on'))this.listeners[name.slice(2)]=value;}addEventListener(event,fn){this.listeners[event]=fn;}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this.props[key]=value;}emit(event){this.listeners[event]?.();}}
 class Audio{constructor(url){this.url=url;this.listeners={};this.paused=true;this.duration=100;this.currentTime=0;instances.push(this);}addEventListener(event,fn){this.listeners[event]=fn;}play(){this.paused=false;this.ended=false;this.listeners.play?.();return Promise.resolve();}pause(){this.paused=true;this.listeners.pause?.();}finish(){this.paused=true;this.ended=true;this.listeners.ended?.();}}
 const context=vm.createContext({Audio,h:(tag,props,...children)=>new Node(tag,props,children),icon:x=>x,toast(){},localStorage:{getItem(){if(blocked)throw Error();return persisted;},setItem(key,value){if(blocked)throw Error();persisted=value;}}});
 vm.runInContext(source+';globalThis.controls={trackEl,stopTrack};',context);
 const find=(node,tag)=>node.tag===tag?node:node.children?.map(n=>typeof n==='object'?find(n,tag):null).find(Boolean);
 return {instances,create:(...args)=>context.controls.trackEl(...args),stop:()=>context.controls.stopTrack(),find,persisted:()=>persisted};
}
test('profile music uses a quiet default, remembers volume including mute, and applies it to the next song',()=>{
 const f=fixture(),tracks=[{name:'First',url:'/a'},{name:'Second',url:'/b'}],one=f.create(tracks[0],tracks,0),two=f.create(tracks[1],tracks,1);
 f.find(one,'button').emit('click');assert.equal(f.instances[0].volume,.3);
 const slider=f.find(one,'input');slider.value='12';slider.emit('input');assert.equal(f.instances[0].volume,.12);assert.equal(f.persisted(),'0.12');
 assert.equal(f.find(two,'input').value,'12');f.instances[0].finish();assert.equal(f.instances.length,2);assert.equal(f.instances[1].url,'/b');assert.equal(f.instances[1].volume,.12);
 slider.value='0';slider.emit('input');assert.equal(f.instances[1].volume,0);assert.equal(f.persisted(),'0');
 f.stop();assert.equal(f.instances[1].paused,true);
 const muted=fixture('0');muted.find(muted.create(tracks[0]),'button').emit('click');assert.equal(muted.instances[0].volume,0);
});
test('only one song plays at a time and blocked storage never prevents playback',()=>{const f=fixture(null,true),one=f.create({name:'A',url:'/a'}),two=f.create({name:'B',url:'/b'});f.find(one,'button').emit('click');f.find(two,'button').emit('click');assert.equal(f.instances[0].paused,true);assert.equal(f.instances[1].paused,false);const slider=f.find(two,'input');slider.value='25';assert.doesNotThrow(()=>slider.emit('input'));assert.equal(f.instances[1].volume,.25);});
