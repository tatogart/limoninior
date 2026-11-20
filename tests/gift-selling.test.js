import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-gift-sell-'));
const {db,q}=await import('../server/db.js');
const {registerCollectibles,profileGiftInventory,visibleGiftCount,giftSellInfo,GIFT_SELL_WINDOW}=await import('../server/collectibles.js');
const {getPolicy,policyToken}=await import('../server/collectible-engine.js');
const {upgradeCost}=await import('../public/js/collectible-traits.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=2;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen,coins) VALUES(?,?,?,?,0,0,1000)').run(id,'test:'+id,'','Viewer '+id);
const routes=new Map(),router=Object.fromEntries(['get','post','delete'].map(method=>[method,(url,fn)=>routes.set(method+' '+url,fn)]));registerCollectibles(router);
function call(method,url,{id=1,user=1,body={}}={}){const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};routes.get(method+' '+url)({params:{id,type:'regular'},user:{id:user},body,ip:''},res);return res;}
const gift=(age=0,price=250)=>Number(q("INSERT INTO user_gifts(gift_id,to_id,from_id,note,price,created_at) VALUES('rocket',1,2,'Test',?,?)").run(price,Date.now()-age).lastInsertRowid);
const sell=(id,user=1)=>call('post','/gifts/regular/:id/sell',{id,user});
test('72 hour deadline uses original receipt time and excludes zero-value/future gifts',()=>{
 const created=1000;const row={price:250,created_at:created,sold_at:0};
 assert.equal(giftSellInfo(row,created).canSell,true);assert.equal(giftSellInfo(row,created+GIFT_SELL_WINDOW-1).canSell,true);
 assert.equal(giftSellInfo(row,created+GIFT_SELL_WINDOW).canSell,false);assert.equal(giftSellInfo(row,created-1).canSell,false);
 assert.equal(giftSellInfo({...row,price:0},created).canSell,false);assert.equal(giftSellInfo({...row,sold_at:123},created).canSell,false);
});
test('only recipient may sell once; recorded price is credited and sold gifts disappear everywhere',()=>{
 const id=gift(),balance=q('SELECT coins FROM users WHERE id=1').get().coins;
 assert.equal(sell(id,2).statusCode,404);
 const info=profileGiftInventory(1,1).gifts.find(g=>g.id===id);assert.equal(info.canSell,true);assert.equal(info.sellValue,250);assert.equal('canSell' in profileGiftInventory(1,2).gifts.find(g=>g.id===id),false);
 const result=sell(id);assert.equal(result.statusCode,200);assert.equal(result.body.amount,250);assert.equal(result.body.balance,balance+250);
 assert.equal(sell(id).statusCode,404);assert.equal(q('SELECT coins FROM users WHERE id=1').get().coins,balance+250);
 assert.ok(q('SELECT sold_at FROM user_gifts WHERE id=?').get(id).sold_at>0);
 assert.equal(profileGiftInventory(1,1).gifts.length,0);assert.equal(profileGiftInventory(1,2).gifts.length,0);assert.equal(visibleGiftCount(1),0);
 const policy=getPolicy();assert.equal(call('post','/collectibles/gifts/:id/upgrade',{id,body:{expectedCost:upgradeCost(250,policy),policyToken:policyToken(policy)}}).statusCode,400);
 assert.equal(call('get','/collectibles').body.upgradeable.some(g=>g.id===id),false);
 assert.equal(call('post','/gifts/:type/:id/visibility',{id,body:{hidden:false}}).statusCode,404);
});
test('expired gifts and upgraded NFTs cannot be sold for lemons',()=>{
 const expired=gift(GIFT_SELL_WINDOW),zero=gift(0,0),future=gift(-60000);
 for(const id of [expired,zero,future])assert.equal(sell(id).statusCode,409);
 const id=gift(),policy=getPolicy();assert.equal(call('post','/collectibles/gifts/:id/upgrade',{id,body:{expectedCost:upgradeCost(250,policy),policyToken:policyToken(policy)}}).statusCode,200);
 const balance=q('SELECT coins FROM users WHERE id=1').get().coins;
 assert.equal(sell(id).body.error,'gift_collectible_no_sell');assert.equal(q('SELECT coins FROM users WHERE id=1').get().coins,balance);
 assert.equal(q('SELECT sold_at FROM user_gifts WHERE id=?').get(id).sold_at,0);
});
test('hidden recent gifts remain sellable and their IDs cannot be recycled',()=>{
 const id=gift();call('post','/gifts/:type/:id/visibility',{id,body:{hidden:true}});assert.equal(sell(id).statusCode,200);
 assert.ok(gift()>id);
});
