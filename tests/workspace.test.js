import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'limo-workspace-'));
process.env.DATA_DIR=dir;
const {db,q}=await import('../server/db.js');
const {registerWorkspace}=await import('../server/workspace.js');
after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
for(let id=1;id<=3;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(?,?,?,?,0,0)').run(id,'test:'+id,'test@test.invalid','Человек '+id);
for(let id=1;id<=3;id++)q("INSERT INTO chats(id,type,title,created_at) VALUES(?,'group',?,0)").run(id,'Чат '+id);
for(const [chat,user] of [[1,1],[1,2],[2,2],[3,1]])q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(?,?,0)').run(chat,user);
const isMember=(cid,uid)=>!!q('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(cid,uid);
const int=(v)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const clean=(v,n)=>String(v??'').trim().slice(0,n);
const routes=new Map(),events=[];
const router=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,...handlers)=>routes.set(method+' '+url,handlers.at(-1))]));
registerWorkspace(router,{isMember,int,clean,bad:(res,error,status=400)=>res.status(status).json({error}),
 serializeMessage:m=>({id:m.id,chatId:m.chat_id,text:m.text,kind:m.kind}),emitToUser:(...args)=>events.push(args),emitToChat(){},chatForUser:(id)=>({id})});
function call(method,url,{id,body={},query={},user=1}={}){
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 routes.get(method+' '+url)({params:{id},body,query,user:{id:user}},res);return res;
}
function message(chat,text,kind='text',extra=null,sender=1,time=1000){return Number(q('INSERT INTO messages(chat_id,sender_id,text,kind,extra,created_at) VALUES(?,?,?,?,?,?)').run(chat,sender,text,kind,extra,time).lastInsertRowid);}
beforeEach(()=>{
 for(const table of ['workspace_chats','workspace_folders','workspace_bookmarks','workspace_tasks','workspace_templates','messages'])q('DELETE FROM '+table).run();
 q('UPDATE chat_members SET last_read_id=0').run();events.length=0;
});
test('notes, archive and manual unread are private, partial updates preserve other fields',()=>{
 assert.equal(call('patch','/workspace/chats/:id',{id:1,body:{note:'Личное',archived:true,unread:true}}).statusCode,200);
 call('patch','/workspace/chats/:id',{id:1,body:{archived:false}});
 const a=call('get','/workspace').body.chats[0];assert.equal(a.note,'Личное');assert.equal(a.unread,1);assert.equal(a.archived,0);
 assert.deepEqual(call('get','/workspace',{user:2}).body.chats,[]);
 assert.ok(events.every(e=>e[0]===1));
 assert.equal(call('patch','/workspace/chats/:id',{id:2,body:{note:'no'}}).statusCode,404);
 assert.equal(call('patch','/workspace/chats/:id',{id:1,body:{archived:'false'}}).statusCode,400);
 assert.equal(call('patch','/workspace/chats/:id',{id:1,body:{note:'x'.repeat(4001)}}).statusCode,400);
});
test('folders support membership, reject outsiders atomically, and cannot be edited by another user',()=>{
 const id=call('post','/workspace/folders',{body:{name:'Учёба'}}).body.id;
 assert.equal(call('put','/workspace/folders/:id',{id,body:{name:'Учёба',chatIds:[1,1,3]}}).statusCode,200);
 assert.deepEqual(call('get','/workspace').body.folders[0].chatIds,[1,3]);
 assert.equal(call('put','/workspace/folders/:id',{id,body:{name:'Bad',chatIds:[1,2]}}).statusCode,400);
 assert.equal(call('get','/workspace').body.folders[0].name,'Учёба');
 assert.equal(call('put','/workspace/folders/:id',{id,user:2,body:{name:'bad',chatIds:[]}}).statusCode,404);
 call('delete','/workspace/folders/:id',{id,user:2});assert.equal(call('get','/workspace').body.folders.length,1);
 call('delete','/workspace/folders/:id',{id});assert.equal(q('SELECT COUNT(*) AS n FROM workspace_folder_chats').get().n,0);
});
test('bookmarks are private, idempotent, paginated, labelled and cascade on deletion',()=>{
 const id=message(1,'Важное'),other=message(2,'Чужое');
 assert.equal(call('put','/workspace/bookmarks/:id',{id:other}).statusCode,404);
 call('put','/workspace/bookmarks/:id',{id,body:{tag:'Документы'}});call('put','/workspace/bookmarks/:id',{id,body:{tag:'Учёба'}});
 assert.equal(call('get','/workspace').body.bookmarks.length,1);
 assert.equal(call('get','/workspace/bookmarks').body.items[0].tag,'Учёба');
 assert.equal(call('get','/workspace/bookmarks',{user:2}).body.items.length,0);
 q('DELETE FROM messages WHERE id=?').run(id);assert.equal(call('get','/workspace').body.bookmarks.length,0);
});
test('revoked chat membership hides notes, bookmarks, folder entries, sources and denies export/search',()=>{
 const id=message(1,'hello');call('put','/workspace/bookmarks/:id',{id});
 call('patch','/workspace/chats/:id',{id:1,body:{note:'private'}});
 call('post','/workspace/tasks',{body:{text:'todo',messageId:id}});
 q('DELETE FROM chat_members WHERE chat_id=1 AND user_id=1').run();
 try{
  const w=call('get','/workspace').body;assert.deepEqual(w.chats,[]);assert.deepEqual(w.bookmarks,[]);assert.equal(w.tasks[0].messageId,null);
  assert.equal(call('get','/workspace/bookmarks').body.items.length,0);
  assert.equal(call('get','/workspace/search',{query:{chatId:1}}).statusCode,404);
  assert.equal(call('get','/workspace/chats/:id/export',{id:1}).statusCode,404);
 }finally{q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(1,1,0)').run();}
});
test('templates validate, preserve line breaks, remain isolated and enforce their limit',()=>{
 call('post','/workspace/templates',{body:{title:'Ответ',text:'Первая\nВторая'}});
 const t=call('get','/workspace').body.templates[0];assert.equal(t.text,'Первая\nВторая');
 assert.equal(call('put','/workspace/templates/:id',{id:t.id,user:2,body:{title:'bad',text:'bad'}}).statusCode,404);
 assert.equal(call('post','/workspace/templates',{body:{title:'x',text:'a'.repeat(4097)}}).statusCode,400);
 for(let i=1;i<5;i++)call('post','/workspace/templates',{body:{title:'x',text:'a'}});
 assert.equal(call('post','/workspace/templates',{body:{title:'x',text:'a'}}).body.error,'subscription_limit');
});
test('tasks keep done, due date and source; updates and deletion require ownership',()=>{
 const mid=message(1,'Задание');call('post','/workspace/tasks',{body:{text:'Сделать',due:5000,messageId:mid}});
 const t=call('get','/workspace').body.tasks[0];assert.equal(t.chatId,1);assert.equal(t.messageId,mid);
 assert.equal(call('put','/workspace/tasks/:id',{id:t.id,user:2,body:{text:'bad'}}).statusCode,404);
 call('put','/workspace/tasks/:id',{id:t.id,body:{text:'Готово',done:true,due:null}});
 const done=call('get','/workspace').body.tasks[0];assert.equal(done.done,1);assert.equal(done.due,null);assert.equal(done.messageId,mid);
 assert.equal(call('post','/workspace/tasks',{body:{text:'x',due:'not-a-date'}}).statusCode,400);
 assert.equal(call('post','/workspace/tasks',{body:{text:'x',messageId:message(2,'secret')}}).statusCode,404);
});
test('bulk read touches only selected memberships and never changes peers read state',()=>{
 const last=message(1,'hello','text',null,2);message(3,'other');
 call('patch','/workspace/chats/:id',{id:1,body:{unread:true}});
 assert.equal(call('post','/workspace/read-all',{body:{chatIds:[1,2]}}).statusCode,400);
 assert.equal(q('SELECT last_read_id FROM chat_members WHERE chat_id=1 AND user_id=1').get().last_read_id,0);
 call('post','/workspace/read-all',{body:{chatIds:[1]}});
 assert.equal(q('SELECT last_read_id FROM chat_members WHERE chat_id=1 AND user_id=1').get().last_read_id,last);
 assert.equal(q('SELECT last_read_id FROM chat_members WHERE chat_id=1 AND user_id=2').get().last_read_id,0);
 assert.equal(q('SELECT last_read_id FROM chat_members WHERE chat_id=3 AND user_id=1').get().last_read_id,0);
 assert.equal(call('get','/workspace').body.chats[0].unread,0);
});
test('search is Cyrillic case-insensitive, escapes SQL wildcards and excludes non-member chats',()=>{
 message(1,'ПРИВЕТ Мир 100%_');message(2,'ПРИВЕТ secret');message(1,'surprise','surprise');
 assert.equal(call('get','/workspace/search',{query:{q:'привет'}}).body.messages.length,1);
 assert.equal(call('get','/workspace/search',{query:{q:'%_'}}).body.messages.length,1);
 assert.equal(call('get','/workspace/search',{query:{q:"' OR 1=1 --"}}).body.messages.length,0);
 assert.equal(call('get','/workspace/search').body.messages.length,1);
});
test('search combines date, sender, type and file name filters with stable cursor pagination',()=>{
 message(1,'caption','image',null,2,1000);
 const file=message(1,'','file',JSON.stringify({name:'Отчёт.pdf'}),1,2000);
 message(1,'https://example.test','text',null,1,3000);
 assert.equal(call('get','/workspace/search',{query:{q:'отчёт',kind:'file',sender:'me',from:1500,to:2500}}).body.messages[0].id,file);
 assert.equal(call('get','/workspace/search',{query:{kind:'links'}}).body.messages.length,1);
 assert.equal(call('get','/workspace/search',{query:{from:'NaN'}}).statusCode,400);
 for(let i=0;i<60;i++)message(1,'paged');
 const first=call('get','/workspace/search').body;assert.equal(first.messages.length,50);assert.equal(first.hasMore,true);
 const second=call('get','/workspace/search',{query:{before:first.messages.at(-1).id}}).body;
 assert.equal(second.messages.length,13);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.messages,...second.messages].map(m=>m.id)).size,63);
});
test('export snapshots exclude new arrivals and enforce access on later pages',()=>{
 for(let i=0;i<205;i++)message(1,'row '+i);
 const first=call('get','/workspace/chats/:id/export',{id:1}).body;assert.equal(first.messages.length,200);assert.equal(first.hasMore,true);
 message(1,'new');const next=call('get','/workspace/chats/:id/export',{id:1,query:{before:first.messages.at(-1).id,ceiling:first.ceiling}}).body;
 assert.equal(next.messages.length,5);assert.equal(next.hasMore,false);
 assert.equal(call('get','/workspace/chats/:id/export',{id:2}).statusCode,404);
});
test('old-message context is bounded and inaccessible to non-members',()=>{
 const ids=[];for(let i=0;i<100;i++)ids.push(message(1,'row '+i));
 const r=call('get','/workspace/messages/:id/context',{id:ids[50]});
 assert.equal(r.body.messages.length,41);assert.equal(r.body.messages[20].id,ids[50]);
 assert.equal(call('get','/workspace/messages/:id/context',{id:ids[50],user:3}).statusCode,404);
});
test('creating a folder with its chats is atomic and rejects invalid selections',()=>{
 assert.equal(call('post','/workspace/folders',{body:{name:'Bad',chatIds:[1,2]}}).statusCode,400);
 assert.equal(call('get','/workspace').body.folders.length,0);
 const id=call('post','/workspace/folders',{body:{name:'Good',chatIds:[1,3]}}).body.id;
 assert.deepEqual(call('get','/workspace').body.folders.find(f=>f.id===id).chatIds,[1,3]);
});
