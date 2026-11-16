import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-profile-badges-'));
const {db,q}=await import('../server/db.js');const {rewardCatalog,grantReward,revokeReward,userRewards,registerRewards}=await import('../server/rewards.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
q("INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(1,'test:1','','Test',0,0)").run();
test('profile badges have distinct vector icons, grant once, remain badges and revoke cleanly',()=>{
 const badges=rewardCatalog().filter(r=>r.category==='profile');assert.equal(badges.length,5);assert.equal(new Set(badges.map(r=>r.icon)).size,5);
 for(const r of badges){assert.equal(r.kind,'badge');assert.equal(grantReward(1,r.id,'admin'),true);assert.equal(grantReward(1,r.id,'admin'),false);}
 assert.equal(userRewards(1).length,5);assert.equal(q('SELECT shown_role FROM users WHERE id=1').get().shown_role,null);
 revokeReward(1,'profile_blogger');assert.equal(userRewards(1).length,4);assert.ok(!userRewards(1).some(r=>r.id==='profile_blogger'));
});
test('ordinary user cannot select or self-grant a badge through the role endpoint',()=>{
 let handler;registerRewards({get(){},post(_path,fn){handler=fn;}},{bad:(res,error,status)=>res.status(status).json({error}),pushMe(){}});
 const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};handler({user:{id:1},body:{role:'profile_developer'}},res);assert.equal(res.code,404);assert.equal(q('SELECT shown_role FROM users WHERE id=1').get().shown_role,null);
});
test('name badge selection is owned, single, hideable and cleared when revoked',async()=>{
 const {selectedProfileBadge}=await import('../server/rewards.js');const routes=new Map();let broadcasts=0;
 registerRewards({get(){},post(path,fn){routes.set(path,fn);}},{bad:(res,error,status=400)=>res.status(status).json({error}),pushMe(){},broadcastUser(){broadcasts++;}});
 q("INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(2,'test:2','','Other',0,0)").run();
 const call=(badge,user=1)=>{const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};routes.get('/me/badge')({user:{id:user},body:{badge}},res);return res;};
 assert.equal(call('profile_blogger').code,404);assert.equal(call('profile_developer',2).code,404);assert.equal(call(true).code,400);
 assert.equal(call('profile_developer').code,200);assert.equal(selectedProfileBadge(1).id,'profile_developer');assert.equal(selectedProfileBadge(1).icon,'terminal');
 call('profile_designer');assert.equal(selectedProfileBadge(1).id,'profile_designer');
 call(null);assert.equal(selectedProfileBadge(1),null);assert.equal(q('SELECT shown_badge FROM users WHERE id=1').get().shown_badge,null);
 call('profile_developer');revokeReward(1,'profile_developer');assert.equal(selectedProfileBadge(1),null);assert.equal(q('SELECT shown_badge FROM users WHERE id=1').get().shown_badge,null);assert.equal(broadcasts,4);
});
