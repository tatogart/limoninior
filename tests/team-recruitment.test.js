import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'limo-team-'));
process.env.ADMIN_USERNAMES='recruitadmin,secondadmin';
const {db,q}=await import('../server/db.js');
const {teamBot,registerTeamApi,registerTeamAdmin,handleTeamBot,submitTeamApplication,proposeInterview,reviewTeamApplication,parseInterviewTime,teamCallAllowed,flushTeamOutbox}=await import('../server/team-recruitment.js');
const {registerGroupCallHandlers}=await import('../server/groupcalls.js');
db.exec("CREATE TABLE IF NOT EXISTS bots(user_id INTEGER PRIMARY KEY REFERENCES users(id),owner_id INTEGER NOT NULL,token_hash TEXT NOT NULL,commands TEXT NOT NULL,created_at INTEGER NOT NULL)");
after(()=>{db.close();fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
for(const [id,username] of [[1,'candidateqa'],[2,'recruitadmin'],[3,'outsiderqa'],[4,'secondadmin']])q('INSERT INTO users(id,google_sub,email,name,username,created_at,last_seen) VALUES(?,?,?,?,?,0,0)').run(id,'test:'+id,'','User '+id,username);
const routes=new Map(),router={get:(url,fn)=>routes.set('get '+url,fn),post:(url,fn)=>routes.set('post '+url,fn)};
let simulateFailure=false;
function privateChat(a,b){
 const key=Math.min(a,b)+':'+Math.max(a,b);let row=q('SELECT id FROM chats WHERE pair_key=?').get(key);if(row)return row.id;
 return Number(q("INSERT INTO chats(type,pair_key,created_at) VALUES('private',?,?)").run(key,Date.now()).lastInsertRowid);
}
registerTeamApi(router,{publicUser:u=>({id:u.id,username:u.username}),ensurePrivateChat:privateChat,postMessage:(chatId,senderId,fields)=>{
 if(simulateFailure)throw Error('delivery unavailable');
 q("INSERT INTO messages(chat_id,sender_id,text,extra,created_at) VALUES(?,?,?,?,?)").run(chatId,senderId,fields.text,JSON.stringify(fields.extra||{}),Date.now());
}});
registerTeamAdmin(router);
const bot=teamBot(),chat=privateChat(bot.id,1);
function say(text){assert.equal(handleTeamBot(bot.id,chat,{sender_id:1,text}),true);}
const admin=()=>q('SELECT * FROM users WHERE id=2').get();
const current=()=>q('SELECT * FROM team_applications WHERE user_id=1 ORDER BY id DESC LIMIT 1').get();
test('official bot collects authenticated identity, previews a draft and submits only on confirmation',()=>{
 assert.equal(teamBot().id,bot.id);assert.ok(bot.verified);assert.equal(handleTeamBot(1,chat,{sender_id:1,text:'/apply'}),false);
 say('/apply');say('Модератор');say('Мне нравится помогать людям и разбирать жалобы.');
 assert.equal(current(),undefined);assert.match(q("SELECT text FROM messages ORDER BY id DESC LIMIT 1").get().text,/@candidateqa/);
 say('/submit');const app=current();assert.equal(app.status,'submitted');assert.equal(app.user_id,1);assert.equal(app.role,'Модератор');
 say('/submit');assert.equal(q('SELECT count(*) n FROM team_applications').get().n,1);
 assert.throws(()=>submitTeamApplication(1,'Модератор','Достаточный опыт для новой заявки'),/team_active_application/);
});
test('candidate proposes Moscow time; assigned administrator alone confirms and link reaches both users once',()=>{
 let app=current();
 assert.throws(()=>reviewTeamApplication(q('SELECT * FROM users WHERE id=3').get(),app.id,{action:'invite',version:app.version}),/forbidden/);
 reviewTeamApplication(admin(),app.id,{action:'invite',version:app.version});
 app=current();assert.equal(app.status,'awaiting_time');assert.equal(app.call_token,null);
 const at=Date.now()+86400000,local=new Date(at+3*3600000).toISOString().slice(0,16).replace('T',' ');
 say(local);app=current();assert.equal(app.status,'time_proposed');
 assert.throws(()=>reviewTeamApplication(q('SELECT * FROM users WHERE id=4').get(),app.id,{action:'confirm',version:app.version}),/team_changed/);
 const approved=reviewTeamApplication(admin(),app.id,{action:'confirm',version:app.version});flushTeamOutbox();
 assert.equal(approved.status,'scheduled');assert.equal(q('SELECT count(*) n FROM call_links').get().n,1);
 const messages=q("SELECT m.text,c.pair_key FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.text LIKE ?").all('%/call/'+approved.call_token+'%');
 assert.equal(messages.length,2);assert.ok(messages.some(m=>m.pair_key===Math.min(bot.id,1)+':'+Math.max(bot.id,1)));assert.ok(messages.some(m=>m.pair_key===Math.min(bot.id,2)+':'+Math.max(bot.id,2)));
 assert.throws(()=>reviewTeamApplication(admin(),app.id,{action:'confirm',version:app.version}),/team_changed/);
 assert.equal(teamCallAllowed(approved.call_token,1),true);assert.equal(teamCallAllowed(approved.call_token,2),true);assert.equal(teamCallAllowed(approved.call_token,3),false);assert.equal(teamCallAllowed(approved.call_token,4),false);
 assert.equal(teamCallAllowed(approved.call_token,1,approved.proposed_at+86400000),false);
 const handlers=new Map();registerGroupCallHandlers({}, {id:'outsider',on:(event,fn)=>handlers.set(event,fn)},3,{inOneToOne:()=>false});
 let response;handlers.get('gc:info')({token:approved.call_token},r=>response=r);assert.equal(response.error,'not_found');
 const staffTable=q("SELECT 1 FROM sqlite_master WHERE name='staff_moderators'").get();if(staffTable)assert.equal(q('SELECT count(*) n FROM staff_moderators WHERE user_id=1').get().n,0);
});
test('date parser rejects impossible dates and uses explicit Moscow time',()=>{
 const t=Date.UTC(2026,10,22,10);
 assert.equal(parseInterviewTime('2026-11-23 18:30',t),Date.UTC(2026,10,23,15,30));
 for(const input of ['завтра вечером','2026-02-30 10:00','2026-11-23 24:00','2026-11-22 13:01','2028-11-23 18:30'])assert.equal(parseInterviewTime(input,t),null,input);
});
test('delivery retries survive transient failure and do not duplicate acknowledged messages',()=>{
 simulateFailure=true;say('/status');
 const pending=q('SELECT count(*) n FROM team_outbox WHERE delivered_at=0').get().n;assert.ok(pending>0);
 simulateFailure=false;flushTeamOutbox();assert.equal(q('SELECT count(*) n FROM team_outbox WHERE delivered_at=0').get().n,0);
 const count=q('SELECT count(*) n FROM messages').get().n;flushTeamOutbox();assert.equal(q('SELECT count(*) n FROM messages').get().n,count);
 // Simulate a restart after insertion but before delivery acknowledgement.
 q('UPDATE team_outbox SET delivered_at=0 WHERE id=(SELECT max(id) FROM team_outbox)').run();flushTeamOutbox();
 assert.equal(q('SELECT count(*) n FROM messages').get().n,count);
});
test('completion closes interview access without granting permissions and rejects stale reviews',()=>{
 const app=current();reviewTeamApplication(admin(),app.id,{action:'complete',version:app.version,note:'Спасибо за встречу'});
 assert.equal(teamCallAllowed(app.call_token,1),false);assert.equal(current().status,'completed');
 assert.throws(()=>reviewTeamApplication(admin(),app.id,{action:'invite',version:app.version}),/team_changed/);
 assert.throws(()=>submitTeamApplication(1,'Модератор','Новая заявка в тот же день'),/team_application_cooldown/);
});
