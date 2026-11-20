import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';

test('saved accounts isolate cookies, switching, revocation, capacity and stale tabs',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'limo-multi-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='https://accounts.example.test';
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',APP_ORIGIN:origin,NODE_ENV:'production',DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
 let logs='',db;
 try{
  const address=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('startup timeout '+logs)),15000);
   server.stdout.on('data',chunk=>{logs+=chunk;if(logs.includes('listening on')){clearTimeout(timeout);resolve('http://127.0.0.1:'+port);}});
   server.stderr.on('data',chunk=>{logs+=chunk;});
   server.on('exit',code=>{clearTimeout(timeout);reject(Error('server exited '+code+' '+logs));});
  });
  db=new DatabaseSync(path.join(dataDir,'limoninior.db'));
  const jar=new Map();
  async function request(method,url,body,options={}){
   const cookies=options.jar||jar;
   const res=await fetch(address+'/api'+url,{method,headers:{origin:options.origin||origin,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(options.account?{'x-limochat-account':String(options.account)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const headers=res.headers.getSetCookie();
   for(const line of headers){const first=line.split(';')[0],i=first.indexOf('='),key=first.slice(0,i),value=first.slice(i+1);if(value)cookies.set(key,value);else cookies.delete(key);}
   return {status:res.status,body:await res.json(),headers};
  }
  const post=(url,body,options)=>request('POST',url,body,options);
  const get=(url,options)=>request('GET',url,undefined,options);
  const register=name=>post('/auth/register',{username:name,name,password:'Password-123456'});
  const login=(name,password='Password-123456')=>post('/auth/login',{username:name,password});
  const a=await register('multiqaone');assert.equal(a.status,200,JSON.stringify(a.body));const aid=a.body.user.id;
  const firstToken=jar.get('__Host-sid');
  assert.ok(firstToken);assert.equal(jar.get('__Host-sid-account-'+aid),firstToken);
  for(const cookie of a.headers){assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Lax/i);assert.match(cookie,/Path=\//);}
  const b=await register('multiqatwo');assert.equal(b.status,200,JSON.stringify(b.body));const bid=b.body.user.id;
  let accounts=await get('/auth/accounts');assert.equal(accounts.status,200);assert.equal(accounts.body.currentId,bid);assert.equal(accounts.body.limit,5);
  assert.deepEqual(accounts.body.accounts.map(a=>a.id).sort((a,b)=>a-b),[aid,bid].sort((a,b)=>a-b));
  for(const account of accounts.body.accounts)assert.deepEqual(Object.keys(account).sort(),['avatar','current','id','name','username']);
  for(const token of jar.values())assert.ok(!JSON.stringify(accounts.body).includes(token),'account list must not expose session tokens');
  jar.set('__Host-sid-account-999999',firstToken);
  accounts=await get('/auth/accounts');assert.equal(accounts.body.accounts.length,2);assert.ok(!jar.has('__Host-sid-account-999999'),'mismatched slots cleared');
  assert.equal((await post('/auth/accounts/switch',{userId:999999})).status,401);
  assert.equal((await post('/auth/accounts/switch',{userId:aid},{origin:'https://attacker.invalid'})).status,403);
  assert.equal((await post('/auth/accounts/switch',{userId:aid},{account:bid})).status,200);
  assert.equal((await get('/me')).body.user.id,aid);
  assert.equal((await request('PATCH','/me/prefs',{lastSeen:'nobody'},{account:bid})).status,409,'stale tabs cannot act as another account');
  assert.equal((await get('/me',{account:bid})).body.error,'account_changed');
  assert.equal((await post('/auth/accounts/remove',{userId:aid},{account:bid})).status,409);
  const remove=await post('/auth/accounts/remove',{userId:bid},{account:aid});assert.equal(remove.status,200);assert.equal(remove.body.currentRemoved,false);
  assert.equal((await get('/me')).body.user.id,aid);assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(bid).n,0);
  assert.equal((await post('/auth/accounts/switch',{userId:bid})).status,401);
  assert.equal((await login('multiqatwo')).status,200);
  db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(bid);
  accounts=await get('/auth/accounts');assert.deepEqual(accounts.body.accounts.map(a=>a.id),[aid]);assert.ok(!jar.has('__Host-sid-account-'+bid));
  assert.equal((await post('/auth/accounts/switch',{userId:aid})).status,200,'standby account works after active expires');
  assert.equal((await login('multiqatwo')).status,200);
  assert.equal((await post('/auth/password/reset',{username:'multiqaone',code:a.body.recoveryCode,password:'Changed-password-123'})).status,200);
  accounts=await get('/auth/accounts');assert.deepEqual(accounts.body.accounts.map(a=>a.id),[bid]);
  assert.equal((await post('/auth/accounts/switch',{userId:aid})).status,401);
  assert.equal((await get('/me')).body.user.id,bid,'resetting one account preserves another');
  assert.equal((await post('/auth/logout',{})).status,200);
  assert.equal((await get('/me')).status,401);assert.equal((await get('/auth/accounts')).body.accounts.length,0);
  assert.equal((await login('multiqaone','Changed-password-123')).status,200);
  const otherIds=[];
  for(let i=0;i<4;i++){const result=await register('multicap'+i);assert.equal(result.status,200,JSON.stringify(result.body));otherIds.push(result.body.user.id);}
  assert.equal((await get('/auth/accounts')).body.accounts.length,5);
  const overflow=await register('multioverflow');assert.equal(overflow.status,400);assert.equal(overflow.body.error,'account_limit');
  assert.equal(db.prepare('SELECT count(*) n FROM users WHERE username=?').get('multioverflow').n,0,'capacity checked before creating account');
  assert.equal((await login('multiqatwo')).body.error,'account_limit');
  assert.equal((await login('multiqaone','Changed-password-123')).status,200,'reauthenticating an existing slot is allowed');
  const forgotten=await post('/auth/accounts/remove',{userId:aid},{account:aid});assert.equal(forgotten.body.currentRemoved,true);
  assert.equal((await get('/me')).status,401);assert.equal((await get('/auth/accounts')).body.accounts.length,4);
  assert.equal((await post('/auth/accounts/switch',{userId:otherIds[0]})).status,200,'saved slots remain usable without an active session');
  db.prepare('UPDATE users SET banned=1 WHERE id=?').run(otherIds[1]);
  assert.equal((await get('/auth/accounts')).body.accounts.length,3);
  assert.equal((await post('/auth/accounts/switch',{userId:otherIds[1]})).status,401);
 }finally{
  db?.close();server.kill();await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r);});rmSync(dataDir,{recursive:true,force:true});
 }
});
