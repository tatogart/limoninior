import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/js/api.js',import.meta.url),'utf8');
function fixture(){let status=401,data={error:'unauthorized'};const events=[];const ctx=vm.createContext({fetch:async()=>{if(status===0)throw Error('network');return {status,ok:status<400,json:async()=>data};},FormData,Event,window:{dispatchEvent:e=>events.push(e.type)}});vm.runInContext(source.replaceAll('export ','')+';globalThis.client={api,setAccountId};',ctx);return {client:ctx.client,events,response(s,d){status=s;data=d;}};}
test('expired authenticated API sessions request recovery once, retaining the original API error',async()=>{
 const f=fixture();f.client.setAccountId(12);
 await assert.rejects(f.client.api.get('/chats'),e=>e.status===401&&e.code==='unauthorized');
 await assert.rejects(f.client.api.get('/me'));assert.deepEqual(f.events,['limochat:session-expired']);
 f.client.setAccountId(13);await assert.rejects(f.client.api.get('/chats'));assert.equal(f.events.length,2);
});
test('signed-out requests, login failures and network errors do not trigger session recovery',async()=>{
 const f=fixture();await assert.rejects(f.client.api.get('/me'));assert.equal(f.events.length,0);
 f.client.setAccountId(12);await assert.rejects(f.client.api.post('/auth/login',{}));assert.equal(f.events.length,0);
 f.response(401,{error:'wrong_password'});await assert.rejects(f.client.api.get('/me'));assert.equal(f.events.length,0);
 f.response(0,{error:'network'});await assert.rejects(f.client.api.get('/me'));assert.equal(f.events.length,0);
});
test('account mismatch keeps its separate account-switch handling',async()=>{
 const f=fixture();f.client.setAccountId(12);f.response(409,{error:'account_changed'});await assert.rejects(f.client.api.get('/me'));assert.deepEqual(f.events,['limochat:account-changed']);
});
