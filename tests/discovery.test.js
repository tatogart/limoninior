import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-discovery-'));
const {db,q}=await import('../server/db.js');const {registerDiscovery,cleanDiscovery,DEFAULT_DISCOVERY}=await import('../server/discovery.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=4;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(?,?,?,?,0,0)').run(id,'test:'+id,'','Игрок '+id);
q("INSERT INTO chats(id,type,title,created_at) VALUES(1,'private','Private',0),(2,'channel','Subscribed',0),(3,'channel','Secret',0)").run();for(const [cid,uid] of [[1,1],[1,2],[2,1],[2,2],[3,3]])q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(?,?,0)').run(cid,uid);
q("INSERT INTO messages(id,chat_id,sender_id,kind,text,created_at) VALUES(1,1,2,'text','Сходим в кафе на обед',100),(2,2,2,'text','Публикация канала',100),(3,3,3,'text','Секретное кафе',100)").run();
const routes=new Map(),router=Object.fromEntries(['get','post','put','delete'].map(method=>[method,(url,...handlers)=>routes.set(method+' '+url,handlers.at(-1))]));registerDiscovery(router,{serializeMessage:m=>({id:m.id,text:m.text,chatId:m.chat_id}),moderationError:()=>null});
function call(method,url,{user=1,id,body={},query={}}={}){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};routes.get(method+' '+url)({user:{id:user},params:{id},body,query},res);return res;}
test('layout settings reject invalid positions and stay account isolated',()=>{
 assert.equal(cleanDiscovery({...DEFAULT_DISCOVERY,width:999}),null);const settings={...DEFAULT_DISCOVERY,side:'right',labs:{focus:true,still:false,denseFeed:false}};
 assert.equal(call('put','/discovery/settings',{body:settings}).code,200);assert.equal(call('get','/discovery/settings').body.settings.side,'right');assert.equal(call('get','/discovery/settings',{user:2}).body.settings.side,'left');
});
test('feed includes only own/contact posts and subscribed channels, never private messages or blocked authors',()=>{
 call('post','/discovery/feed',{user:2,body:{text:'Запись друга'}});call('post','/discovery/feed',{user:3,body:{text:'Чужая запись'}});
 let items=call('get','/discovery/feed').body.items;assert.ok(items.some(x=>x.text==='Запись друга'));assert.ok(items.some(x=>x.text==='Публикация канала'));assert.ok(!items.some(x=>x.text==='Чужая запись'||x.text.includes('Секретное')||x.id===1&&x.source==='channel'));
 const own=items.find(x=>x.text==='Запись друга');call('delete','/discovery/feed/:id',{id:own.id});assert.ok(q('SELECT 1 FROM feed_posts WHERE id=?').get(own.id));
 q('INSERT INTO blocks VALUES(1,2,0)').run();items=call('get','/discovery/feed').body.items;assert.ok(!items.some(x=>x.text==='Запись друга'));q('DELETE FROM blocks').run();
 assert.equal(call('get','/discovery/feed',{query:{cursor:'bad'}}).code,400);
});
test('topic search expands food terms and never returns messages outside memberships',()=>{
 const r=call('get','/discovery/search',{query:{q:'еда'}});assert.ok(r.body.messages.some(m=>m.id===1));assert.ok(!r.body.messages.some(m=>m.id===3));
 q('DELETE FROM chat_members WHERE chat_id=1 AND user_id=1').run();assert.ok(!call('get','/discovery/search',{query:{q:'еда'}}).body.messages.some(m=>m.id===1));q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(1,1,0)').run();
});
test('club rooms enforce membership, two players, turn order, stale request rejection and agreed rematch',()=>{
 let room=call('post','/discovery/rooms',{body:{game:'tic'}}).body;const id=room.id;
 assert.equal(call('get','/discovery/rooms/:id',{user:3,id}).code,404);assert.equal(call('post','/discovery/rooms/:id/move',{id,body:{position:0,version:room.version,round:1}}).code,409);
 room=call('post','/discovery/rooms/:id/join',{user:2,id}).body;assert.equal(room.players.length,2);assert.equal(call('post','/discovery/rooms/:id/join',{user:3,id}).code,409);
 const move=(user,position)=>{const r=call('post','/discovery/rooms/:id/move',{user,id,body:{position,round:room.state.round,version:room.version}});if(r.code===200)room=r.body;return r;};
 assert.equal(move(2,0).code,409);const previous=room.version;assert.equal(move(1,0).code,200);assert.equal(call('post','/discovery/rooms/:id/move',{user:2,id,body:{position:4,round:1,version:previous}}).code,409);
 move(2,3);move(1,1);move(2,4);move(1,2);assert.equal(room.state.winner,1);assert.equal(move(2,5).code,409);
 room=call('post','/discovery/rooms/:id/rematch',{id}).body;assert.equal(room.state.round,1);room=call('post','/discovery/rooms/:id/rematch',{id,user:2}).body;assert.equal(room.state.round,2);assert.ok(room.state.board.every(x=>x===0));
 call('delete','/discovery/rooms/:id',{id,user:1});assert.equal(call('get','/discovery/rooms/:id',{id,user:1}).code,404);assert.equal(call('get','/discovery/rooms/:id',{id,user:2}).body.players.length,1);
});
test('feed cursor handles publications with identical timestamps without duplication or lost records',()=>{
 const insert=q('INSERT INTO feed_posts(user_id,text,created_at) VALUES(1,?,500)');for(let i=0;i<35;i++)insert.run('Page '+i);
 const first=call('get','/discovery/feed').body;assert.equal(first.items.length,30);assert.ok(first.cursor);
 const second=call('get','/discovery/feed',{query:{cursor:first.cursor}}).body;
 const all=[...first.items,...second.items].filter(x=>x.text.startsWith('Page '));assert.equal(all.length,35);assert.equal(new Set(all.map(x=>x.id)).size,35);
});
test('four-in-a-row validates gravity, wins after four pieces and keeps previous state immutable',async()=>{
 const {initialClub,clubMove}=await import('../public/js/club-engine.js');let s=initialClub('four');const first=s;
 for(const [seat,col] of [[1,0],[2,1],[1,0],[2,1],[1,0],[2,1],[1,0]])s=clubMove('four',s,seat,col);
 assert.equal(s.winner,1);assert.equal(first.board.every(x=>x===0),true);assert.equal(clubMove('four',s,2,1),null);
 s=initialClub('tic');for(const [seat,pos] of [[1,0],[2,1],[1,2],[2,4],[1,3],[2,5],[1,7],[2,6],[1,8]])s=clubMove('tic',s,seat,pos);assert.equal(s.draw,true);
});
