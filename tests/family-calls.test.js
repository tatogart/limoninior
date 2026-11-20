import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-family-calls-'));
const {db,q}=await import('../server/db.js');
await import('../server/family.js');
const {registerGroupCallHandlers}=await import('../server/groupcalls.js');
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(let id=1;id<=2;id++)q('INSERT INTO users(id,google_sub,email,name,created_at,last_seen) VALUES(?,?,?,?,0,0)').run(id,'test:'+id,'','Test');
q('INSERT INTO family_links(child,parent,controls) VALUES(2,1,?)').run(JSON.stringify({calls:true}));
test('group-call socket routes enforce family restrictions without HTTP endpoints',()=>{
 const handlers=new Map(),socket={id:'test-socket',on:(name,fn)=>handlers.set(name,fn)};
 registerGroupCallHandlers({},socket,2,{inOneToOne:()=>false});
 for(const event of ['gc:start','gc:link','gc:join']){
  let response;handlers.get(event)({chatId:1},r=>response=r);assert.equal(response?.error,'family_restricted',event);
 }
 q('UPDATE family_links SET controls=? WHERE child=2').run(JSON.stringify({paused:true}));
 let response;handlers.get('gc:join')({},r=>response=r);assert.equal(response.error,'family_paused');
});
