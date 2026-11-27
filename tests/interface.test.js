import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/js/interface.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
class Node{
 constructor(tag,props={},children=[]){this.tag=tag;this.props=props;this.children=children.flat(Infinity).filter(x=>x!=null);this.listeners={};this.hidden=false;this.tabIndex=0;this.value='';this.dataset=props.dataset||{};this.id=props.id;this.className=props.class||'';this.classes=new Set(this.className.split(' '));this.classList={toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);},contains:name=>this.classes.has(name)};for(const [key,value] of Object.entries(props))if(key.startsWith('on'))this.listeners[key.slice(2)]=value;}
 get textContent(){return this.text??this.children.map(x=>x instanceof Node?x.textContent:String(x)).join('');}set textContent(value){this.text=String(value);}
 setAttribute(key,value){this.props[key]=String(value);}removeAttribute(key){delete this.props[key];}
 append(...children){this.children.push(...children.flat(Infinity));}replaceChildren(...children){this.children=children.flat(Infinity);this.text=undefined;}
 addEventListener(event,fn){this.listeners[event]=fn;}focus(){this.focused=true;}
 querySelectorAll(selector){const match=node=>selector.startsWith('.')?node.classes.has(selector.slice(1)):node.tag===selector;const result=[];for(const child of this.children)if(child instanceof Node){if(match(child))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
}
function setup(){const context=vm.createContext({h:(tag,props,...children)=>new Node(tag,props,children),icon:name=>new Node('svg',{'aria-label':name}),openModal:options=>options});vm.runInContext(source+';globalThis.ui={navigation,profileTabs,settingsHome,contactsScreen};',context);return context.ui;}
test('navigation switches destinations and maintains accessible unread badges',()=>{const ui=setup(),selected=[];const nav=ui.navigation({onSelect:id=>selected.push(id),avatar:()=>new Node('img')});nav.select('settings');const buttons=nav.el.querySelectorAll('button');assert.equal(buttons.length,4);assert.equal(buttons[2].props['aria-current'],'page');assert.equal(buttons[0].props['aria-current'],undefined);buttons[1].listeners.click();assert.deepEqual(selected,['contacts']);nav.unread(121);assert.equal(nav.el.querySelectorAll('.shell-unread')[0].textContent,'99+');nav.unread(0);assert.ok(nav.el.querySelectorAll('.shell-unread')[0].classes.has('hidden'));});
test('profile tabs switch real panels and support arrow keys',()=>{const ui=setup(),gift=new Node('section'),music=new Node('section');const el=ui.profileTabs([{id:'gifts',title:'Подарки',content:gift},{id:'music',title:'Музыка',content:music}]);const buttons=el.querySelectorAll('button');assert.equal(gift.hidden,false);assert.equal(music.hidden,true);buttons[1].listeners.click();assert.equal(gift.hidden,true);assert.equal(music.hidden,false);assert.equal(buttons[1].props['aria-selected'],'true');buttons[1].listeners.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(gift.hidden,false);assert.equal(buttons[0].focused,true);});
test('settings search filters sections and account actions are connected',()=>{const ui=setup();let opened=false,accountsOpened=false;const actions=new Proxy({accounts:()=>{accountsOpened=true;},edit:()=>{opened=true;}},{get:(target,key)=>target[key]||(()=>{})});const screen=ui.settingsHome({me:{name:'Seek',username:'seek'},avatar:()=>new Node('img'),actions,version:'test'});const rows=screen.body.querySelectorAll('.hub-row');rows.find(row=>row.textContent.includes('Имя, фото')).listeners.click();assert.equal(opened,true);rows.find(row=>row.textContent.includes('Мои аккаунты')).listeners.click();assert.equal(accountsOpened,true);const search=screen.body.querySelectorAll('input')[0];search.value='уведомления';search.listeners.input();assert.equal(rows.filter(row=>!row.hidden).length,1);assert.ok(rows.find(row=>!row.hidden).textContent.includes('Уведомления'));search.value='';search.listeners.input();assert.equal(rows.filter(row=>row.hidden).length,0);});
test('contacts search uses existing interlocutors and opens the selected conversation',()=>{const ui=setup();let id;const screen=ui.contactsScreen({users:[{id:1,name:'Анна',username:'anna'},{id:2,name:'Борис',username:'boris'}],avatar:()=>new Node('img'),status:()=>'',onOpen:value=>id=value,onFind(){}});const search=screen.body.querySelectorAll('input')[0];search.value='boris';search.listeners.input();const rows=screen.body.querySelectorAll('.contact-row');assert.equal(rows.length,1);rows[0].listeners.click();assert.equal(id,2);search.value='никого';search.listeners.input();assert.equal(screen.body.querySelectorAll('.contact-row').length,0);});

test('accounts picker switches saved sessions and confirms individual sign-out',async()=>{
 const source=fs.readFileSync(new URL('../public/js/accounts.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 let modal,switched=0,added=0,confirmation='',allowed=true;
 const requests=[];
 const context=vm.createContext({
  h:(tag,props,...children)=>new Node(tag,props,children),icon:name=>new Node('svg',{'aria-label':name}),avatar:()=>new Node('img'),
  openModal:options=>{modal=options;return options;},errorText:e=>String(e),toast(){},
  confirmDialog:async text=>{confirmation=text;return true;},
  api:{get:async()=>({limit:5,accounts:[{id:1,name:'Первый',username:'first',current:true},{id:2,name:'Второй',username:'second',current:false}]}),
   post:async(url,body)=>{requests.push([url,body.userId]);return {currentRemoved:body.userId===1};}}
 });
 vm.runInContext(source+';globalThis.picker=accountsModal;',context);
 context.picker({canChange:()=>allowed,onSwitch:()=>switched++,onAdd:()=>added++});
 await new Promise(resolve=>setImmediate(resolve));
 const rows=modal.body.querySelectorAll('.accounts-row');assert.equal(rows.length,2);
 await rows[1].querySelectorAll('.accounts-select')[0].listeners.click();
 assert.deepEqual(requests[0],['/auth/accounts/switch',2]);assert.equal(switched,1);
 // Use a fresh picker after navigation, as the real app does.
 context.picker({canChange:()=>allowed,onSwitch:()=>switched++,onAdd:()=>added++});
 await new Promise(resolve=>setImmediate(resolve));
 const add=modal.body.querySelectorAll('.accounts-add')[0];allowed=false;add.listeners.click();assert.equal(added,0);allowed=true;add.listeners.click();assert.equal(added,1);
 await modal.body.querySelectorAll('.accounts-remove')[0].listeners.click();
 assert.equal(typeof confirmation,'string');assert.match(confirmation,/Первый/);
 assert.deepEqual(requests[1],['/auth/accounts/remove',1]);assert.equal(switched,2);
});
