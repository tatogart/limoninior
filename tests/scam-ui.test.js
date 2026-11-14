import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8'),ui=readFileSync(new URL('../public/js/ui.js',import.meta.url),'utf8');
const fn=name=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\n}\n',source.indexOf('function '+name+'('))+2);
function fixture(chat){
 const h=(tag,props={},...children)=>({tag,props,children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),title={replaceChildren(...nodes){this.children=nodes;}},users=new Map(chat.peer?[[chat.peer.id,chat.peer]]:[]);
 const ctx=vm.createContext({h,badge:()=>h('verified'),S:{users,drafts:new Map(),me:{id:1},current:chat.id},V:{headerTitle:title,headerAvatar:{replaceChildren(){}}},curChat:()=>chat,communityOf:()=>null,chatAvatar:()=>null,renderHeaderStatus(){},peerOf:c=>c.peer?users.get(c.peer.id):null,chatTitle:c=>c.peer?users.get(c.peer.id).name:c.title,peerEmoji:()=>null,streakBadge:()=>null,typingText:()=>null,isGroup:c=>c.type==='group',isChannel:c=>c.type==='channel',workspaceUnread:()=>false,icon:()=>null});
 vm.runInContext(ui.match(/export const scamBadge=.*\n/)[0].replace('export ', '')+ui.match(/export const trustBadge=.*\n/)[0].replace('export ', '')+source.match(/const chatTrustBadge = .*\n/)[0]+fn('chatItem')+fn('renderHeader')+';globalThis.row=()=>chatItem(curChat());globalThis.header=renderHeader;',ctx);
 return {ctx,title,users};
}
const nodes=x=>!x?[]:[x,...(x.children||[]).flatMap(nodes)];const marked=x=>nodes(x).some(n=>n.props?.class==='scam-badge');
test('SCAM appears in chat rows and headers for users, bots and channels; removal updates both',()=>{
 for(const kind of ['user','bot','channel']){const account={id:2,name:'Тест',verified:true,scam:true,scamReason:'Причина',bot:kind==='bot'},chat=kind==='channel'?{id:10,type:'channel',title:'Канал',...account}:{id:10,type:'private',peer:account};const {ctx,title}=fixture(chat);assert.equal(marked(ctx.row()),true,kind+' row');ctx.header();assert.equal(marked(title),true,kind+' header');assert.equal(nodes(title).some(n=>n.tag==='verified'),false);if(kind==='channel')chat.scam=false;else account.scam=false;assert.equal(marked(ctx.row()),false);ctx.header();assert.equal(marked(title),false);assert.equal(nodes(title).some(n=>n.tag==='verified'),true);}
});
