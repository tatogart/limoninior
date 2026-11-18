import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';import {DatabaseSync} from 'node:sqlite';
test('official news is idempotent, respects occupied names, and only staff can publish',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'limo-news-'));const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'development',DEV_LOGIN:'1',PORT:String(port),APP_ORIGIN:'http://localhost:'+port,DATA_DIR:dir,ADMIN_EMAILS:'newsadminqa@dev.local',ADMIN_USERNAMES:''},stdio:['ignore','pipe','pipe']});
 let db,logs='';
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(logs)),15000);child.stdout.on('data',b=>{logs+=b;if(logs.includes('listening')){clearTimeout(timer);resolve();}});child.stderr.on('data',b=>logs+=b);child.on('exit',code=>{clearTimeout(timer);reject(Error(code+' '+logs));});});
  db=new DatabaseSync(path.join(dir,'limoninior.db'));
  const request=async(method,url,body,cookie='')=>{const r=await fetch('http://127.0.0.1:'+port+'/api'+url,{method,headers:{'content-type':'application/json',origin:'http://localhost:'+port,cookie},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const reader=await request('POST','/auth/register',{username:'newsreaderqa',name:'Reader',password:'Reader-password-123'});assert.equal(reader.status,200);
  const initial=await request('GET','/news/channel',null,reader.cookie);assert.equal(initial.status,200);assert.equal(initial.body.channel.verified,true);assert.equal(initial.body.chat,null);
  // Simulate a pre-existing unrelated account with the preferred handle.
  db.prepare('DELETE FROM chats WHERE id=?').run(initial.body.channel.id);
  db.prepare("INSERT INTO users(google_sub,email,username,name,created_at,last_seen) VALUES('local:occupied-news','','LimochatNews','Unrelated account',?,?)").run(Date.now(),Date.now());
  const first=await request('GET','/news/channel',null,reader.cookie),second=await request('GET','/news/channel',null,reader.cookie);const cid=first.body.channel.id;
  assert.equal(first.body.channel.username,'LimochatNews1');assert.equal(second.body.channel.id,cid);assert.equal(first.body.channel.title,'Новости Limochat');assert.equal(db.prepare("SELECT name FROM users WHERE username='LimochatNews'").get().name,'Unrelated account');
  assert.equal(db.prepare('SELECT count(*) n FROM chat_members WHERE chat_id=? AND user_id=?').get(cid,reader.body.user.id).n,0);
  const joined=await request('POST',`/channels/${cid}/join`,{role:'admin'},reader.cookie);assert.equal(joined.status,200);assert.equal(joined.body.chat.canPost,false);
  assert.equal((await request('POST',`/chats/${cid}/messages`,{text:'Not allowed'},reader.cookie)).status,403);
  const admin=await request('POST','/auth/dev',{name:'newsadminqa'});assert.equal(admin.status,200);assert.equal((await request('PATCH','/me',{username:'newsadminqa',name:'News editor'},admin.cookie)).status,200);
  const staff=await request('GET','/news/channel',null,admin.cookie);assert.equal(staff.body.chat.canPost,true);assert.equal(staff.body.chat.role,'admin');
  assert.equal((await request('POST',`/chats/${cid}/messages`,{text:'Test news publication'},admin.cookie)).status,200);
  const messages=await request('GET',`/channels/${cid}/messages`,null,reader.cookie);assert.ok(messages.body.messages.some(m=>m.text==='Test news publication'));
  const redirect=await fetch('http://127.0.0.1:'+port+'/news',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/@LimochatNews1');
  assert.equal(db.prepare("SELECT count(*) n FROM chats WHERE type='channel' AND title='Новости Limochat'").get().n,1);
 }finally{db?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));rmSync(dir,{recursive:true,force:true});}
});
