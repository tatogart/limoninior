import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';

test('account recovery and deletion require ownership, revoke sessions and preserve other people’s messages',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'limo-account-'));
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),APP_ORIGIN:'http://localhost:3000',NODE_ENV:'development',DEV_LOGIN:'1',GOOGLE_CLIENT_ID:'test-client',DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
 let logs='',address,db;
 try{
  address=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('server startup timeout '+logs)),15000);
   server.stdout.on('data',chunk=>{logs+=chunk;const m=logs.match(/listening on http:\/\/[^:]+:(\d+)/);if(m){clearTimeout(timeout);resolve('http://127.0.0.1:'+m[1]);}});
   server.stderr.on('data',chunk=>{logs+=chunk;});server.on('exit',code=>{clearTimeout(timeout);reject(Error('server exited '+code+' '+logs));});
  });
  const request=async(method,url,body,cookie='')=>{const r=await fetch(address+'/api'+url,{method,headers:{origin:'http://localhost:3000','content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const post=(url,body,cookie)=>request('POST',url,body,cookie);
  const a=await post('/auth/register',{username:'recoveryqa',name:'Recovery QA',password:'First-password-123'});assert.equal(a.status,200,JSON.stringify(a.body));assert.ok(a.body.recoveryCode);const uid=a.body.user.id;
  db=new DatabaseSync(path.join(dataDir,'limoninior.db'));
  assert.notEqual(db.prepare('SELECT recovery_hash FROM users WHERE id=?').get(uid).recovery_hash,a.body.recoveryCode.replaceAll('-',''));
  const session2=await post('/auth/login',{username:'recoveryqa',password:'First-password-123'});assert.equal(session2.status,200);
  const invalid=await post('/auth/password/reset',{username:'recoveryqa',code:'wrong',password:'Second-password-123'});assert.equal(invalid.status,401);
  assert.equal((await post('/me/recovery-code',{current:'wrong'},a.cookie)).status,403);
  const reset=await post('/auth/password/reset',{username:'recoveryqa',code:a.body.recoveryCode,password:'Second-password-123'});assert.equal(reset.status,200);assert.ok(reset.body.code);
  assert.equal((await request('GET','/me',undefined,session2.cookie)).status,401);assert.equal((await request('GET','/me',undefined,a.cookie)).status,401);
  assert.equal((await post('/auth/password/reset',{username:'recoveryqa',code:a.body.recoveryCode,password:'Third-password-123'})).status,401);
  const login=await post('/auth/login',{username:'recoveryqa',password:'Second-password-123'});assert.equal(login.status,200);
  const b=await post('/auth/register',{username:'receiverqa',name:'Receiver QA',password:'Other-password-123'});assert.equal(b.status,200);
  const desktopRequest=await post('/auth/desktop/start',{});
  assert.equal(desktopRequest.status,200);assert.equal((await post('/auth/desktop/approve',{id:desktopRequest.body.id,approve:desktopRequest.body.approve},b.cookie)).status,403);
  db.prepare("UPDATE sessions SET auth_method='google',created_at=? WHERE user_id=?").run(Date.now()-360000,b.body.user.id);
  assert.equal((await post('/me/recovery-code',{},b.cookie)).status,403);
  db.prepare("UPDATE sessions SET created_at=? WHERE user_id=?").run(Date.now(),b.body.user.id);
  const googleRecovery=await post('/me/recovery-code',{},b.cookie);assert.equal(googleRecovery.status,200);assert.ok(googleRecovery.body.code);
  assert.equal((await post('/auth/desktop/approve',{id:desktopRequest.body.id,approve:desktopRequest.body.approve},b.cookie)).status,200);
  const googleChange=await post('/me/password',{password:'Google-recovered-password'},b.cookie);assert.equal(googleChange.status,200);assert.ok(googleChange.body.recoveryCode);
  assert.equal((await post('/auth/desktop/poll',{id:desktopRequest.body.id,poll:desktopRequest.body.poll})).status,410);
  const chat=await post('/chats/private',{userId:b.body.user.id},login.cookie);assert.equal(chat.status,200);
  const sent=await post('/chats/'+chat.body.chat.id+'/messages',{text:'Shared history survives deletion'},login.cookie);assert.equal(sent.status,200);
  assert.equal((await post('/me/delete',{confirmation:'УДАЛИТЬ',current:'wrong'},login.cookie)).status,403);
  assert.equal((await post('/me/delete',{confirmation:'',current:'Second-password-123'},login.cookie)).status,400);
  db.prepare("INSERT INTO chats(type,title,owner_id,created_at) VALUES('group','Owned group',?,?)").run(uid,Date.now());
  assert.equal((await post('/me/delete',{confirmation:'УДАЛИТЬ',current:'Second-password-123'},login.cookie)).status,409);
  db.prepare("UPDATE chats SET owner_id=? WHERE owner_id=? AND type='group'").run(b.body.user.id,uid);
  const deleted=await post('/me/delete',{confirmation:'УДАЛИТЬ',current:'Second-password-123'},login.cookie);assert.equal(deleted.status,200,JSON.stringify(deleted.body));
  assert.equal((await request('GET','/me',undefined,login.cookie)).status,401);
  const tombstone=db.prepare('SELECT * FROM users WHERE id=?').get(uid);assert.equal(tombstone.name,'Удалённый аккаунт');assert.equal(tombstone.username,null);assert.equal(tombstone.password_hash,null);assert.equal(tombstone.recovery_hash,null);assert.equal(tombstone.email,'');assert.equal(tombstone.coins,0);assert.ok(tombstone.deleted_at);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(uid).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM messages WHERE sender_id=? AND text=?').get(uid,'Shared history survives deletion').n,1);
  assert.equal((await request('GET','/me',undefined,b.cookie)).status,200);
  assert.equal((await post('/auth/password/reset',{username:'recoveryqa',code:reset.body.code,password:'Fourth-password-123'})).status,401);
 }finally{
  db?.close();server.kill();await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});rmSync(dataDir,{recursive:true,force:true});
 }
});
