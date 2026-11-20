import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';import {DatabaseSync} from 'node:sqlite';
test('new referrals award seven days, preserve previous rewards and publish one release announcement',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'limo-ref-week-')),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));let child,db;
 async function start(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'development',DEV_LOGIN:'1',PORT:String(port),APP_ORIGIN:'http://localhost:'+port,DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let logs='';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(logs)),15000);child.stdout.on('data',b=>{logs+=b;if(logs.includes('listening')){clearTimeout(timer);resolve();}});child.stderr.on('data',b=>logs+=b);child.on('exit',code=>{clearTimeout(timer);reject(Error(code+' '+logs));});});}
 async function stop(){if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}}
 try{
  await start();db=new DatabaseSync(path.join(dir,'limoninior.db'));
  const request=async(method,url,body,cookie='')=>{const r=await fetch('http://127.0.0.1:'+port+'/api'+url,{method,headers:{'content-type':'application/json',origin:'http://localhost:'+port,cookie},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=async(username)=>{const r=await request('POST','/auth/register',{username,name:username,password:'Referral-password-123'});assert.equal(r.status,200);return r;};
  const inviter=await register('refinviterqa'),old=await register('refpreviousqa'),fresh=await register('refnewqa');
  const priorUntil=Date.now()+30*864e5;
  db.prepare("UPDATE users SET sub_tier='premium',sub_until=? WHERE id=?").run(priorUntil,inviter.body.user.id);
  db.prepare("UPDATE users SET referred_by=?,ref_rewarded=1,sub_tier='plus',sub_until=? WHERE id=?").run(inviter.body.user.id,priorUntil,old.body.user.id);
  const before=Date.now(),claim=await request('POST','/me/referral',{ref:'refinviterqa'},fresh.cookie),after=Date.now();assert.equal(claim.status,200,JSON.stringify(claim.body));
  const newUser=db.prepare('SELECT * FROM users WHERE id=?').get(fresh.body.user.id),referrer=db.prepare('SELECT * FROM users WHERE id=?').get(inviter.body.user.id);
  assert.ok(newUser.sub_until>=before+7*864e5&&newUser.sub_until<=after+7*864e5);assert.equal(newUser.ref_reward_days,7);assert.equal(newUser.sub_tier,'plus');assert.equal(referrer.sub_tier,'premium');assert.equal(referrer.sub_until,priorUntil+7*864e5);
  assert.equal(db.prepare('SELECT sub_until FROM users WHERE id=?').get(old.body.user.id).sub_until,priorUntil);
  const referrals=await request('GET','/referrals',null,inviter.cookie);assert.equal(referrals.body.days,7);assert.equal(referrals.body.invited.find(u=>u.id===old.body.user.id).rewardDays,30);assert.equal(referrals.body.invited.find(u=>u.id===fresh.body.user.id).rewardDays,7);
  assert.equal((await request('POST','/me/referral',{ref:'refinviterqa'},fresh.cookie)).status,400);assert.equal(db.prepare('SELECT sub_until FROM users WHERE id=?').get(inviter.body.user.id).sub_until,priorUntil+7*864e5);
  const announcementId=Number(db.prepare("SELECT value FROM kv WHERE key='news:referral-week-2026-11-18'").get().value);assert.ok(db.prepare('SELECT text FROM messages WHERE id=?').get(announcementId).text.includes('7 дней подписки вместо 30'));
  await stop();await start();assert.equal(Number(db.prepare("SELECT value FROM kv WHERE key='news:referral-week-2026-11-18'").get().value),announcementId);assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE text LIKE '🎁 Обновление приглашений%'").get().n,1);assert.equal(db.prepare('SELECT sub_until FROM users WHERE id=?').get(old.body.user.id).sub_until,priorUntil);
 }finally{db?.close();await stop();rmSync(dir,{recursive:true,force:true});}
});
