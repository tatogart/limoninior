import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const code=fs.readFileSync(new URL('../public/js/theme.js',import.meta.url),'utf8');
function surface(){const listeners={};return {addEventListener(name,fn){(listeners[name]||=[]).push(fn);},emit(name){for(const fn of listeners[name]||[])fn();}};}
function fixture(withViewport=true){
 const props=new Map(),frames=new Map(),timers=new Map();let id=0;
 const root={dataset:{},style:{setProperty:(k,v)=>props.set(k,v)}};
 const document={...surface(),documentElement:root,getElementById:()=>null,activeElement:{tagName:'BODY'}};
 const viewport={...surface(),height:800,width:390,offsetTop:0,offsetLeft:0,scale:1};
 const window={...surface(),innerHeight:800,innerWidth:390,visualViewport:withViewport?viewport:undefined,scrollTo(){throw Error('must not fight native focus panning');}};
 vm.runInNewContext(code,{window,document,localStorage:{getItem:()=>null},location:{pathname:'/'},matchMedia:()=>({matches:false}),requestAnimationFrame(fn){frames.set(++id,fn);return id;},setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(key){timers.delete(key);},isFinite,Math});
 return {window,document,viewport,props,root,frames,focus(){document.activeElement={tagName:'TEXTAREA'};document.emit('focusin');},flush(){const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn();}};
}
test('iOS visual viewport shrink and panning keep the composer inside the visible area',()=>{
 const f=fixture();f.focus();f.viewport.height=450;f.viewport.offsetTop=120;f.viewport.emit('resize');f.viewport.emit('scroll');assert.equal(f.frames.size,1);f.flush();assert.equal(f.props.get('--app-h'),'450px');assert.equal(f.props.get('--app-top'),'120px');assert.equal(f.root.dataset.keyboard,'open');
 f.document.activeElement={tagName:'BODY'};f.viewport.height=800;f.viewport.offsetTop=0;f.document.emit('focusout');f.viewport.emit('resize');f.flush();assert.equal(f.props.get('--app-h'),'800px');assert.equal(f.props.get('--app-top'),'0px');assert.equal(f.root.dataset.keyboard,'closed');
});
test('Android layout resizing does not subtract keyboard height twice',()=>{
 const f=fixture();f.focus();f.window.innerHeight=430;f.viewport.height=430;f.window.emit('resize');f.flush();assert.equal(f.props.get('--app-h'),'430px');assert.equal(f.root.dataset.keyboard,'open');
});
test('fallback resize without VisualViewport and orientation changes remain usable',()=>{
 const f=fixture(false);f.focus();f.window.innerHeight=420;f.window.emit('resize');f.flush();assert.equal(f.props.get('--app-h'),'420px');
 f.document.activeElement={tagName:'BODY'};f.window.innerWidth=844;f.window.innerHeight=390;f.window.emit('orientationchange');f.flush();assert.equal(f.props.get('--app-h'),'390px');assert.equal(f.root.dataset.keyboard,'closed');
});
test('pinch zoom does not shrink the app layout or disable magnification',()=>{
 const f=fixture();f.viewport.scale=2;f.viewport.height=400;f.viewport.offsetTop=80;f.viewport.emit('resize');f.flush();assert.equal(f.props.get('--app-h'),'800px');assert.equal(f.props.get('--app-top'),'0px');
});
