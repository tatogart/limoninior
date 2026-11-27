import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';import {DatabaseSync} from 'node:sqlite';
test('team recruitment bot works through real messages; admin review requires elevation; both receive one call link',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'limo-team-http-')),probe=net.createServer();
 await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:origin,DATA_DIR:dataDir,NODE_ENV:'development',ADMIN_EMAILS:'admin@example.test',ADMIN_USERNAMES:'teamqaadmin',ADMIN_TOTP_SECRET:'JBSWY3DPEHPK3PXP'},stdio:['ignore','pipe','pipe']});
 let logs='',db;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout '+logs)),15000);server.stdout.on('data',c=>{logs+=c;if(logs.includes('listening on')){clearTimeout(timer);resolve();}});server.stderr.on('data',c=>logs+=c);server.on('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code+' '+logs));});});
  db=new DatabaseSync(path.join(dataDir,'limoninior.db'));
  const request=async(method,url,body,cookie='',requestOrigin=origin)=>{
   const response=await fetch(origin+'/api'+url,{method,headers:{origin:requestOrigin,'content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const candidate=await request('POST','/auth/register',{username:'teamqacandidate',name:'Candidate QA',password:'Team-test-password'});
  const administrator=await request('POST','/auth/register',{username:'teamqareviewer',name:'Admin QA',password:'Admin-test-password'});
  assert.equal(candidate.status,200,JSON.stringify(candidate.body));assert.equal(administrator.status,200,JSON.stringify(administrator.body));
  db.prepare('UPDATE users SET username=? WHERE id=?').run('teamqaadmin',administrator.body.user.id);
  const bot=await request('GET','/partners/team-bot');assert.equal(bot.status,200);assert.ok(bot.body.username.endsWith('Bot'));
  const chat=await request('POST','/chats/private',{userId:bot.body.id},candidate.cookie);assert.equal(chat.status,200,JSON.stringify(chat.body));
  for(const text of ['/apply','Модератор','Я хочу помогать пользователям и умею разбирать жалобы.','/submit']){
   const sent=await request('POST','/chats/'+chat.body.chat.id+'/messages',{text},candidate.cookie);assert.equal(sent.status,200,JSON.stringify(sent.body));
  }
  assert.equal((await request('GET','/admin/team-applications',undefined,candidate.cookie)).status,404);
  assert.equal((await request('GET','/admin/team-applications',undefined,administrator.cookie)).status,403);
  db.prepare('UPDATE sessions SET admin_until=? WHERE user_id=?').run(Date.now()+3600000,administrator.body.user.id);
  let list=await request('GET','/admin/team-applications',undefined,administrator.cookie);assert.equal(list.status,200);assert.equal(list.body.applications.length,1);
  let app=list.body.applications[0];assert.equal(app.user_id,candidate.body.user.id);
  assert.equal((await request('POST','/admin/team-applications/'+app.id+'/action',{action:'invite',version:app.version},candidate.cookie)).status,404);
  assert.equal((await request('POST','/admin/team-applications/'+app.id+'/action',{action:'invite',version:app.version},administrator.cookie,'https://attacker.invalid')).status,403);
  assert.equal((await request('POST','/admin/team-applications/'+app.id+'/action',{action:'invite',version:app.version},administrator.cookie)).status,200);
  const time=new Date(Date.now()+86400000+3*3600000).toISOString().slice(0,16).replace('T',' ');
  assert.equal((await request('POST','/chats/'+chat.body.chat.id+'/messages',{text:time},candidate.cookie)).status,200);
  list=await request('GET','/admin/team-applications',undefined,administrator.cookie);app=list.body.applications[0];assert.equal(app.status,'time_proposed');
  const approved=await request('POST','/admin/team-applications/'+app.id+'/action',{action:'confirm',version:app.version},administrator.cookie);
  assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.application.status,'scheduled');
  const token=approved.body.application.call_token;assert.ok(token);
  const delivery=db.prepare('SELECT c.pair_key,m.text FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.text LIKE ?').all('%/call/'+token+'%');
  assert.equal(delivery.length,2,'one interview link delivered to each participant');
  assert.equal((await request('POST','/admin/team-applications/'+app.id+'/action',{action:'confirm',version:app.version},administrator.cookie)).status,409);
  assert.equal(db.prepare('SELECT count(*) n FROM call_links WHERE token=?').get(token).n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM staff_moderators WHERE user_id=?').get(candidate.body.user.id).n,0);
 }finally{db?.close();server.kill();await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r);});rmSync(dataDir,{recursive:true,force:true});}
});
