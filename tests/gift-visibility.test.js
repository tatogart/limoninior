import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-gift-privacy-'));
const {db,q}=await import('../server/db.js');const {registerCollectibles,profileGiftInventory,visibleGiftCount,selectedCollectible}=await import('../server/collectibles.js');const {getPolicy,policyToken}=await import('../server/collectible-engine.js');const {upgradeCost}=await import('../public/js/collectible-traits.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=2;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen,coins) VALUES(?,?,?,?,0,0,1000)').run(id,'test:'+id,'','Viewer '+id);
const routes=new Map(),router=Object.fromEntries(['get','post','delete'].map(method=>[method,(url,fn)=>routes.set(method+' '+url,fn)]));registerCollectibles(router);
function call(route,{id=1,type='collectible',user=1,body={}}={}){const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};routes.get('post '+route)({params:{id,type},user:{id:user},body,ip:''},res);return res;}
const visibility=(type,id,hidden,user=1)=>call('/gifts/:type/:id/visibility',{id,type,user,body:{hidden}});
const regular=()=>Number(q("INSERT INTO user_gifts(gift_id,to_id,from_id,note,price,created_at) VALUES('rocket',1,2,'A gift',250,0)").run().lastInsertRowid);
const collectible=()=>Number(q("INSERT INTO collectible_items(user_id,collection,created_at,selected) VALUES(1,'rocket-comet',0,1)").run().lastInsertRowid);
test('profile lists regular and collectible gifts; only owners can see and change hidden items',()=>{
 const gift=regular(),item=collectible();assert.equal(profileGiftInventory(1,2).collectibles.length,1);assert.equal(visibleGiftCount(1),2);
 assert.equal(visibility('regular',gift,true,2).statusCode,404);assert.equal(visibility('collectible',item,true,2).statusCode,404);
 assert.equal(visibility('regular',gift,'true').statusCode,400);assert.equal(visibility('users',item,true).statusCode,400);
 assert.equal(visibility('regular',gift,true).statusCode,200);assert.equal(visibility('collectible',item,true).statusCode,200);
 const visitor=profileGiftInventory(1,2),owner=profileGiftInventory(1,1);assert.equal(visitor.gifts.length,0);assert.equal(visitor.collectibles.length,0);assert.equal(owner.gifts.length,1);assert.equal(owner.collectibles.length,1);assert.equal(owner.collectibles[0].hidden,true);assert.equal(visibleGiftCount(1),0);assert.equal(selectedCollectible(1),null);
 visibility('regular',gift,false);visibility('collectible',item,false);assert.equal(profileGiftInventory(1,2).collectibles[0].serial,item);assert.equal(visibleGiftCount(1),2);
});
test('hidden regular gifts stay hidden through upgrade and are never counted twice',()=>{
 const id=regular();visibility('regular',id,true);const policy=getPolicy();const result=call('/collectibles/gifts/:id/upgrade',{id,body:{expectedCost:upgradeCost(250,policy),policyToken:policyToken(policy)}});assert.equal(result.statusCode,200);
 const owner=profileGiftInventory(1,1);assert.equal(owner.gifts.some(g=>g.id===id),false);assert.equal(owner.collectibles.find(g=>g.id===result.body.serial).hidden,true);assert.equal(profileGiftInventory(1,2).collectibles.some(g=>g.id===result.body.serial),false);
 visibility('collectible',result.body.serial,false);assert.equal(visibleGiftCount(1),3);
 visibility('collectible',result.body.serial,true);assert.equal(call('/collectibles/items/:id/transfer',{id:result.body.serial,body:{recipientId:2}}).statusCode,200);assert.equal(profileGiftInventory(2,1).collectibles.some(g=>g.id===result.body.serial),true);
});
