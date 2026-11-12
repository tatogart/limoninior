import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-mod-'));
const {db,q}=await import('../server/db.js');
const {registerModerator,registerModeratorAdmin}=await import('../server/moderator.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=3;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(?,?,?,?,0,0)').run(id,'test:'+id,'','Test');
db.exec("CREATE TABLE reports(id INTEGER PRIMARY KEY,target_type TEXT,target_id INTEGER,reason TEXT,comment TEXT,snapshot TEXT,status TEXT,created_at INTEGER,resolution TEXT,resolved_by INTEGER,resolved_at INTEGER)");
const routes=new Map(),router=Object.fromEntries(['get','post'].map(method=>[method,(url,...handlers)=>routes.set(method+' '+url,handlers)]));
registerModeratorAdmin(router);registerModerator(router,{publicUser:u=>({id:u.id,name:u.name}),pushChat(){}});
function call(method,url,{user=1,id=2,body={},query={}}={}){let index=0;const res={code:200,set(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};const req={user:{id:user},params:{id},body,query,ip:'127.0.0.1'};const handlers=routes.get(method+' '+url);const next=()=>handlers[index++]?.(req,res,next);next();return res;}
test('ordinary accounts cannot access any moderation data',()=>{for(const url of ['/staff/reports','/staff/users','/staff/verifications'])assert.equal(call('get',url).code,404);});
test('admin grant enables only explicit moderation routes and revocation is immediate',()=>{call('post','/users/:id/moderator',{body:{enabled:true}});assert.equal(call('get','/staff/reports',{user:2}).code,200);assert.equal(routes.has('post /staff/coins'),false);call('post','/users/:id/moderator',{body:{enabled:false}});assert.equal(call('get','/staff/reports',{user:2}).code,404);});
test('moderator can approve only a pending channel request',()=>{call('post','/users/:id/moderator',{body:{enabled:true}});q("INSERT INTO chats(id,type,title,created_at,verify_requested) VALUES(1,'channel','Test',0,1)").run();assert.equal(call('post','/staff/verifications/:id',{user:2,id:1,body:{approve:true}}).code,200);assert.equal(call('post','/staff/verifications/:id',{user:2,id:1,body:{approve:true}}).code,409);assert.equal(call('post','/staff/verifications/:id',{user:3,id:1,body:{approve:true}}).code,404);});
test('public profile lookup does not expose email or password fields',()=>{const r=call('get','/staff/users',{user:2,query:{q:'Test'}});assert.equal(r.body.users.length,3);assert.ok(r.body.users.every(u=>!('email' in u)&&!('password_hash' in u)));});
