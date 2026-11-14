import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function surface(){const listeners=new Map();return {listeners,addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);},emit(k,event){for(const fn of listeners.get(k)||[])fn(event);}};}
const code=fs.readFileSync(new URL('../public/js/games-extra.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/\bexport /g,'');
function fixture(){const window=surface(),ctx=vm.createContext({window,Date,h:(tag,props,...children)=>({tag,props,children})});vm.runInContext(code+';globalThis.input={directional,press};',ctx);return {window,...ctx.input};}
test('mobile swipes work without pointer capture and suppress duplicate pointer-touch input',()=>{
 const f=fixture(),board=surface(),moves=[];const cleanup=f.directional(board,d=>moves.push(d));let prevented=0;const touch=(x,y,end=false)=>({[end?'changedTouches':'touches']:[{clientX:x,clientY:y}],preventDefault(){prevented++;}});
 board.emit('touchstart',touch(10,30));board.emit('pointerdown',{pointerType:'touch',clientX:10,clientY:30});board.emit('pointerup',{pointerType:'touch',clientX:100,clientY:30});board.emit('touchend',touch(100,30,true));assert.deepEqual(moves,['R']);assert.equal(prevented,2);
 board.emit('touchstart',touch(20,100));board.emit('touchend',touch(20,10,true));assert.deepEqual(moves,['R','U']);
 cleanup();f.window.emit('keydown',{key:'ArrowLeft',preventDefault(){}});assert.equal(moves.length,2);
});
test('mobile buttons act on touchend exactly once and still support mouse and keyboard',()=>{
 const f=fixture();let count=0;const btn=f.press('Go',()=>count++);
 btn.props.ontouchend({preventDefault(){}});btn.props.onclick({detail:1});assert.equal(count,1);
 btn.props.onclick({detail:0});assert.equal(count,2);
});
