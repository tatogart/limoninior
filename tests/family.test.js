import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FAMILY_DEFAULTS,normalizeFamilyControls,quietNow} from '../server/family-schedule.js';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-family-'));
const {db,q}=await import('../server/db.js');
const {registerFamily,familyPolicy,familyCallError}=await import('../server/family.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=4;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(?,?,?,?,0,0)').run(id,id===4?'bot:test':'test:'+id,'','Test '+id);
const routes=new Map();let middleware;
const router=Object.fromEntries(['get','post','put'].map(method=>[method,(url,...handlers)=>routes.set(method+' '+url,handlers)]));router.use=fn=>middleware=fn;
registerFamily(router,{bad:(res,error,status=400)=>res.status(status).json({error}),int:v=>Number.isSafeInteger(Number(v))?Number(v):null,publicUser:u=>({id:u.id,name:u.name}),emitToUser(){}});
function call(method,url,{user=1,id=2,body={},path=url}={}){
 const req={user:{id:user},params:{id},body,path,method:method.toUpperCase(),ip:'127.0.0.1'};
 const res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 let i=0;const handlers=routes.get(method+' '+url);const next=()=>handlers[i++]?.(req,res,next);next();return res;
}
function allowed(path,method='GET',body={}){
 const res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};let passed=false;
 middleware({user:{id:2},path,method,body},res,()=>passed=true);return {passed,code:res.code,error:res.body?.error};
}
test('schedule handles selected weekdays, midnight, full days and local time zones',()=>{
 const p={...FAMILY_DEFAULTS,quiet:true,quietDays:[5],timeZone:'Europe/Moscow'};
 assert.equal(quietNow(p,new Date('2026-11-20T19:00:00Z')),true); // Friday 22:00
 assert.equal(quietNow(p,new Date('2026-11-21T03:59:00Z')),true); // Saturday 06:59
 assert.equal(quietNow(p,new Date('2026-11-21T04:00:00Z')),false);
 assert.equal(quietNow(p,new Date('2026-11-21T20:00:00Z')),false);
 assert.equal(quietNow({...p,quietStart:10,quietEnd:14},new Date('2026-11-20T08:00:00Z')),true);
 assert.equal(quietNow({...p,quietStart:7,quietEnd:7},new Date('2026-11-20T01:00:00Z')),true);
 assert.equal(quietNow({...p,timeZone:'UTC'},new Date('2026-11-20T19:00:00Z')),false);
});
test('control validation rejects invalid schedules and keeps new restrictions with old clients',()=>{
 for(const patch of [{calls:'false'},{quietDays:[]},{quietDays:[7]},{quietStart:24},{quietEnd:1.5},{timeZone:'not/a-zone'}])assert.equal(normalizeFamilyControls(patch),null);
 assert.equal(normalizeFamilyControls({games:false},{...FAMILY_DEFAULTS,calls:true}).calls,true);
 assert.deepEqual(normalizeFamilyControls({quietDays:[5,5,1]}).quietDays,[1,5]);
});
test('parent PIN cannot be replaced without its current value and attempts are limited',()=>{
 assert.equal(call('post','/family/invite').body.error,'family_pin_required');
 for(const pin of ['1234','abcdef','1234567','']){const invalid=call('post','/family/pin',{body:{pin}});assert.equal(invalid.code,400);assert.equal(invalid.body.error,'bad_family_pin_format');assert.equal(call('get','/family').body.pinSet,false);}
 assert.equal(call('post','/family/pin',{body:{pin:'123456'}}).code,200);
 for(let i=0;i<5;i++)assert.equal(call('post','/family/pin',{body:{pin:'234567',currentPin:'000000'}}).code,403);
 assert.equal(call('post','/family/pin',{body:{pin:'234567',currentPin:'123456'}}).code,429);
 q('UPDATE family_pin_attempts SET until_at=1 WHERE child=1').run();
 assert.equal(call('post','/family/pin',{body:{pin:'234567',currentPin:'123456'}}).code,200);
 assert.equal(call('get','/family').body.pinSet,true);
});
test('link requires child consent, controls are parent-owned and granular restrictions run on the server',()=>{
 const invite=call('post','/family/invite').body.token;
 assert.equal(call('post','/family/accept',{body:{token:invite}}).code,400);
 assert.equal(call('post','/family/accept',{user:2,body:{token:invite}}).code,200);
 assert.equal(call('post','/family/accept',{user:3,body:{token:invite}}).code,400);
 assert.equal(call('put','/family/children/:id',{user:3,body:{paused:true}}).code,404);
 assert.equal(call('put','/family/children/:id',{user:2,body:{paused:true}}).code,404);
 assert.equal(call('put','/family/children/:id',{body:{calls:true,bots:true,stories:true,channels:true,newChats:true}}).code,200);
 assert.equal(familyCallError(2),'family_restricted');assert.equal(familyCallError(3),null);
 q("INSERT INTO chats(id,type,title,created_at) VALUES(1,'private','Bot',0),(2,'channel','Channel',0),(3,'private','Human',0)").run();
 q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(1,2,0),(1,4,0),(3,2,0),(3,3,0)').run();
 for(const route of ['/calls/ice','/stories','/channels/popular','/bots','/chats/1/messages','/chats/2/messages'])assert.equal(allowed(route).code,403,route);
 assert.equal(allowed('/chats/private','POST',{userId:4}).code,403);
 assert.equal(allowed('/channels/invite/test/join','POST').code,403);
 assert.equal(allowed('/communities/test/join','POST').code,403);
 assert.equal(allowed('/chats/3/messages').passed,true);
 assert.equal(allowed('/chats/3/messages','POST',{text:'hello'}).passed,true);
 assert.equal(call('put','/family/children/:id',{body:{paused:true}}).code,200);
 assert.equal(familyCallError(2),'family_paused');assert.equal(allowed('/chats').error,'family_paused');
 assert.equal(allowed('/me').passed,true);assert.equal(allowed('/family').passed,true);
 assert.equal(call('post','/family/disconnect',{user:2,body:{pin:'123456'}}).code,403);
 assert.equal(call('post','/family/disconnect',{user:2,body:{pin:'234567'}}).code,200);
 assert.equal(familyPolicy(2),null);assert.equal(allowed('/channels/popular').passed,true);
});
