import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-paid-'));
const {db,q}=await import('../server/db.js');const {registerPaidReactions,paidSummary}=await import('../server/paid-reactions.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=3;id++)q('INSERT INTO users(id,google_sub,email,name,coins,created_at,last_seen) VALUES(?,?,?,?,100,0,0)').run(id,'test:'+id,'','User');
q("INSERT INTO chats(id,type,title,owner_id,created_at) VALUES(1,'private','',2,0),(2,'channel','Channel',2,0)").run();
for(const cid of [1,2])for(const uid of [1,2])q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(?,?,0)').run(cid,uid);
q("INSERT INTO messages(id,chat_id,sender_id,kind,text,created_at) VALUES(1,1,2,'text','Hi',0),(2,2,NULL,'text','Post',0)").run();
let route;registerPaidReactions({post(_,...handlers){route=handlers.at(-1);}},{isMember:(cid,uid)=>!!q('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(cid,uid),postError:()=>null,pushMe(){},emitToChat(){}});
function call({id=1,user=1,amount=10,key='request-key-000001'}={}){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};route({user:{id:user},params:{id},body:{amount,requestKey:key},ip:'127.0.0.1'},res);return res;}
test('paid reaction credits author exactly once and channels credit their owner',()=>{
 assert.equal(call().code,200);assert.equal(call().code,200);assert.equal(q('SELECT coins FROM users WHERE id=1').get().coins,90);assert.equal(q('SELECT coins FROM users WHERE id=2').get().coins,110);assert.equal(paidSummary(1),10);
 assert.equal(call({id:2,key:'request-key-000002'}).code,200);assert.equal(q('SELECT coins FROM users WHERE id=2').get().coins,120);
 assert.equal(call({amount:11}).code,409);
});
test('rejects self support, non members, invalid amounts, insufficient balance and blocking',()=>{
 assert.equal(call({user:2}).code,403);assert.equal(call({user:3}).code,404);
 for(const amount of [0,-5,1.5,1001,'10'])assert.equal(call({amount}).code,400);
 assert.equal(call({amount:1000,key:'request-key-000003'}).code,400);
 q('INSERT INTO blocks VALUES(2,1,0)').run();assert.equal(call({key:'request-key-000004'}).code,403);q('DELETE FROM blocks').run();
});
test('failed ledger insertion rolls back both balances',()=>{
 const before=q('SELECT coins FROM users WHERE id IN(1,2) ORDER BY id').all();
 db.exec("CREATE TRIGGER fail_paid BEFORE INSERT ON paid_reactions BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
 assert.throws(()=>call({key:'request-key-000005'}));assert.deepEqual(q('SELECT coins FROM users WHERE id IN(1,2) ORDER BY id').all(),before);db.exec('DROP TRIGGER fail_paid');
});
