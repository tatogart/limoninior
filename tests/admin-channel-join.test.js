import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';import {DatabaseSync} from 'node:sqlite';
test('only an elevated administrator can join private channels; roles and invitation stay unchanged',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'limo-admin-join-')),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://localhost:'+port;
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'development',DEV_LOGIN:'1',PORT:String(port),APP_ORIGIN:origin,DATA_DIR:dir,ADMIN_EMAILS:'joinadminqa@dev.local',ADMIN_USERNAMES:'',ADMIN_TOTP_SECRET:'JBSWY3DPEHPK3PXP'},stdio:['ignore','pipe','pipe']});let db,logs='';
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(logs)),15000);child.stdout.on('data',b=>{logs+=b;if(logs.includes('listening')){clearTimeout(timer);resolve();}});child.stderr.on('data',b=>logs+=b);child.on('exit',code=>{clearTimeout(timer);reject(Error(code+' '+logs));});});
  db=new DatabaseSync(path.join(dir,'limoninior.db'));
  const request=async(method,url,body,cookie='')=>{const r=await fetch('http://127.0.0.1:'+port+'/api'+url,{method,headers:{'content-type':'application/json',origin,cookie},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const owner=await request('POST','/auth/register',{username:'channelownerqa',name:'Owner',password:'Owner-password-123'});
  const created=await request('POST','/channels',{title:'Private test',isPrivate:true},owner.cookie);assert.equal(created.status,200);const cid=created.body.chat.id;
  const endpoint=`/admin/channels/${cid}/join`;
  assert.equal((await request('POST',endpoint,{})).status,401);
  assert.equal((await request('POST',endpoint,{},owner.cookie)).status,404);
  const admin=await request('POST','/auth/dev',{name:'joinadminqa'});assert.equal(admin.status,200);
  await request('PATCH','/me',{username:'joinadminqa',name:'Admin'},admin.cookie);
  assert.equal((await request('POST',endpoint,{},admin.cookie)).status,403);
  db.prepare('UPDATE sessions SET admin_until=? WHERE user_id=?').run(Date.now()+60000,admin.body.user.id);
  const before=db.prepare('SELECT * FROM chats WHERE id=?').get(cid);
  const joined=await request('POST',endpoint,{role:'owner'},admin.cookie);assert.equal(joined.status,200);assert.equal(joined.body.url,'/?chat='+cid);
  const member=db.prepare('SELECT * FROM chat_members WHERE chat_id=? AND user_id=?').get(cid,admin.body.user.id);assert.equal(member.role,'member');
  const opened=await request('GET',`/chats/${cid}`,null,admin.cookie);assert.equal(opened.status,200);assert.equal(opened.body.chat.canPost,false);
  assert.equal((await request('POST',`/chats/${cid}/messages`,{text:'Cannot publish'},admin.cookie)).status,403);
  db.prepare("UPDATE chat_members SET role='admin' WHERE chat_id=? AND user_id=?").run(cid,admin.body.user.id);
  assert.equal((await request('POST',endpoint,{},admin.cookie)).status,200);
  assert.equal(db.prepare('SELECT role FROM chat_members WHERE chat_id=? AND user_id=?').get(cid,admin.body.user.id).role,'admin');
  assert.equal(db.prepare('SELECT count(*) n FROM chat_members WHERE chat_id=? AND user_id=?').get(cid,admin.body.user.id).n,1);
  const after=db.prepare('SELECT * FROM chats WHERE id=?').get(cid);assert.equal(after.owner_id,before.owner_id);assert.equal(after.invite_token,before.invite_token);assert.equal(after.username,null);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_log WHERE action='admin_channel_join'").get().n,2);
  assert.equal((await request('POST','/admin/channels/999999/join',{},admin.cookie)).status,404);
  const community=await request('POST','/communities',{title:'Private community QA'},owner.cookie);assert.equal(community.status,200);
  const communityId=community.body.community.id;
  const news=db.prepare("SELECT id FROM chats WHERE community_id=? AND ckind='news'").get(communityId).id;
  const joinCommunity='/admin/channels/'+news+'/join';
  assert.equal((await request('POST',joinCommunity,{},owner.cookie)).status,404);
  const joinedCommunity=await request('POST',joinCommunity,{role:'owner'},admin.cookie);assert.equal(joinedCommunity.status,200);assert.equal(joinedCommunity.body.communityId,communityId);
  assert.equal(db.prepare('SELECT role FROM community_members WHERE community_id=? AND user_id=?').get(communityId,admin.body.user.id).role,'member');
  const channels=db.prepare('SELECT id FROM chats WHERE community_id=?').all(communityId);
  for(const ch of channels){assert.equal(db.prepare('SELECT role FROM chat_members WHERE chat_id=? AND user_id=?').get(ch.id,admin.body.user.id).role,'member');assert.equal((await request('GET','/chats/'+ch.id,null,admin.cookie)).status,200);}
  assert.equal((await request('POST','/chats/'+news+'/messages',{text:'Not a publisher'},admin.cookie)).status,403);
  assert.equal((await request('POST',joinCommunity,{},admin.cookie)).status,200);
  assert.equal(db.prepare('SELECT count(*) n FROM community_members WHERE community_id=? AND user_id=?').get(communityId,admin.body.user.id).n,1);
  assert.equal(db.prepare('SELECT owner_id FROM communities WHERE id=?').get(communityId).owner_id,owner.body.user.id);

 }finally{db?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));rmSync(dir,{recursive:true,force:true});}
});
