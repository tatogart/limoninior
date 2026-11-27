import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-beta-'));
const {db,q}=await import('../server/db.js');
const {createBetaCode,redeemBetaCode,betaGrant,requireBeta}=await import('../server/beta.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(const id of [1,2])q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(?,?,?,?,0,0)').run(id,'test:'+id,'','Tester '+id);
const expires=Date.now()+30*86400000;
for(const id of [1,2,3])q('INSERT INTO sessions(id,token_hash,user_id,created_at,last_used,expires_at) VALUES(?,?,?,0,0,?)').run(id,'test:'+id,id===3?2:1,expires);
const session=id=>q('SELECT * FROM sessions WHERE id=?').get(id),user=id=>q('SELECT * FROM users WHERE id=?').get(id);
test('random codes are stored as hashes, enforce activation count and bind a grant to the account across sessions',()=>{
 const code=createBetaCode(1,{label:'Preview',maxUses:1,days:2});assert.match(code.code,/^LIMO(?:-[A-F0-9]{5}){4}$/);
 const stored=q('SELECT * FROM beta_codes WHERE id=?').get(code.id);assert.notEqual(stored.token_hash,code.code);assert.equal(stored.token_hash.length,64);
 assert.equal(redeemBetaCode(session(1),user(1),'wrong'),null);
 assert.ok(redeemBetaCode(session(1),user(1),code.code));assert.ok(redeemBetaCode(session(1),user(1),code.code));assert.equal(q('SELECT uses FROM beta_codes WHERE id=?').get(code.id).uses,1);
 assert.ok(redeemBetaCode(session(2),user(1),code.code));assert.equal(q('SELECT uses FROM beta_codes WHERE id=?').get(code.id).uses,1);assert.equal(redeemBetaCode(session(3),user(2),code.code),null);
 assert.equal(betaGrant(1,2),null);assert.ok(betaGrant(2,1));
 assert.ok(betaGrant(1,1));q('UPDATE beta_codes SET revoked_at=? WHERE id=?').run(Date.now(),code.id);assert.equal(betaGrant(1,1),null);
});
test('expiry and revocation close account access; logout does not remove eligibility',()=>{
 for(const settings of [{days:0},{days:31},{maxUses:0},{maxUses:101},{maxUses:1.5},{label:''}])assert.throws(()=>createBetaCode(1,settings),/beta_bad_settings/);
 const code=createBetaCode(1,{label:'Expiry',maxUses:2,days:1});assert.ok(redeemBetaCode(session(2),user(1),code.code));assert.equal(betaGrant(2,1,code.expiresAt+1),null);
 q('DELETE FROM sessions WHERE id=2').run();assert.equal(q('SELECT count(*) n FROM beta_account_grants WHERE user_id=1').get().n,1);assert.ok(betaGrant(99,1));
 const res={status(n){this.code=n;return this;},json(value){this.body=value;return this;}};let next=false;requireBeta({user:{id:2},session:{id:3}},res,()=>next=true);assert.equal(res.code,403);assert.equal(next,false);
});
