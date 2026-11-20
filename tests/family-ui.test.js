import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/js/family.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
class Element{
 constructor(tag,props={},children=[]){this.tag=tag;this.props=props;this.children=children.flat(Infinity).filter(c=>c!=null);this.value=props.value||'';this.disabled=!!props.disabled;this.listeners={};for(const [k,v] of Object.entries(props))if(k.startsWith('on'))this.listeners[k.slice(2)]=v;}
 append(...children){this.children.push(...children.flat(Infinity));}replaceChildren(...children){this.children=children.flat(Infinity);}
 setAttribute(k,v){this.props[k]=v;}removeAttribute(k){delete this.props[k];}focus(){this.focused=true;}
 get textContent(){return this.text??this.children.map(c=>c instanceof Element?c.textContent:String(c)).join('');}set textContent(value){this.text=String(value);}
 find(tag){return this.children.flatMap(c=>c instanceof Element?[...(c.tag===tag?[c]:[]),...c.find(tag)]:[]);}
}
function setup(fail=false){
 let modal,pinSet=false;const posts=[],toasts=[];
 const context=vm.createContext({
  h:(tag,props,...children)=>new Element(tag,props,children),icon:()=>new Element('svg'),Intl,
  openModal:options=>{modal=options;return {close(){}};},toast:message=>toasts.push(message),errorText:()=> 'Ошибка соединения',confirmDialog:async()=>true,
  navigator:{clipboard:{writeText:async()=>{}}},
  api:{get:async()=>({parent:null,pinSet,children:[]}),post:async(url,body)=>{posts.push([url,body]);if(fail)throw Error('network');if(url==='/family/pin'){pinSet=true;return {ok:true};}if(url==='/family/invite')return {token:'test-invitation-code'};}}
 });
 vm.runInContext(source+';globalThis.render=familyModal;',context);
 return {render:context.render,get modal(){return modal;},posts,toasts};
}
test('short PIN shows inline validation; six digits persist then unlock invitations',async()=>{
 const ui=setup();await ui.render();
 let pin=ui.modal.body.find('input').find(e=>e.props.type==='password');
 let save=ui.modal.body.find('button').find(e=>e.textContent==='Сохранить PIN');
 let invite=ui.modal.body.find('button').find(e=>e.textContent==='Создать приглашение');
 assert.equal(invite.disabled,true);assert.ok(ui.modal.body.textContent.includes('6 цифр'));
 pin.value='1234';await save.listeners.click();assert.equal(ui.posts.length,0);assert.equal(pin.props['aria-invalid'],'true');assert.ok(ui.modal.body.textContent.includes('Сейчас введено: 4'));assert.equal(pin.focused,true);
 pin.value='012345';pin.listeners.input();await save.listeners.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.posts[0][0],'/family/pin');assert.equal(ui.posts[0][1].pin,'012345');assert.equal(pin.value,'');assert.ok(ui.toasts.includes('PIN сохранён'));
 invite=ui.modal.body.find('button').find(e=>e.textContent==='Создать приглашение');assert.equal(invite.disabled,false);
 assert.ok(ui.modal.body.find('input').some(e=>e.props['aria-label']==='Текущий родительский PIN'));
 await invite.listeners.click();assert.equal(ui.posts[1][0],'/family/invite');assert.equal(ui.modal.body.find('textarea')[0].value,'test-invitation-code');
});
test('failed PIN save keeps the entered value and invitation stays locked',async()=>{
 const ui=setup(true);await ui.render();const pin=ui.modal.body.find('input').find(e=>e.props.type==='password');pin.value='012345';
 await ui.modal.body.find('button').find(e=>e.textContent==='Сохранить PIN').listeners.click();
 assert.equal(pin.value,'012345');assert.ok(!ui.toasts.includes('PIN сохранён'));assert.equal(ui.modal.body.find('button').find(e=>e.textContent==='Создать приглашение').disabled,true);
});
