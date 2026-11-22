import crypto from 'node:crypto';
import {db,q,now,tx,audit} from './db.js';
import {config} from './config.js';
import {isAdminUser} from './auth.js';

db.exec(`
 CREATE TABLE IF NOT EXISTS team_applications(
  id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,experience TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'submitted',
  admin_id INTEGER REFERENCES users(id),proposed_at INTEGER,call_token TEXT,
  note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
 );
 CREATE UNIQUE INDEX IF NOT EXISTS team_one_active ON team_applications(user_id)
  WHERE status IN ('submitted','awaiting_time','time_proposed','scheduled');
 CREATE TABLE IF NOT EXISTS team_drafts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,stage TEXT NOT NULL,role TEXT,experience TEXT,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS team_interviews(token TEXT PRIMARY KEY,application_id INTEGER NOT NULL REFERENCES team_applications(id),applicant_id INTEGER NOT NULL,admin_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS team_outbox(id INTEGER PRIMARY KEY,recipient INTEGER NOT NULL,text TEXT NOT NULL,delivered_at INTEGER NOT NULL DEFAULT 0);
`);
const ACTIVE="('submitted','awaiting_time','time_proposed','scheduled')";
const ROLES=['Модератор','Администратор'];
let helpers=null,flushing=false;
const active=uid=>q('SELECT * FROM team_applications WHERE user_id=? AND status IN '+ACTIVE+' ORDER BY id DESC LIMIT 1').get(uid);
const date=at=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'long',timeStyle:'short'}).format(at)+' МСК';
const fail=code=>{throw Object.assign(new Error(code),{status:409});};
const enqueue=(uid,text)=>q('INSERT INTO team_outbox(recipient,text) VALUES(?,?)').run(uid,text);
const adminUsers=()=>q("SELECT * FROM users WHERE banned=0 AND google_sub NOT LIKE 'bot:%' AND google_sub NOT LIKE 'system:%'").all().filter(isAdminUser);
const notifyAdmins=text=>{for(const user of adminUsers())enqueue(user.id,text);};
export function teamBot(){
 let user=q("SELECT * FROM users WHERE google_sub='bot:team-recruitment'").get();if(user)return user;
 return tx(()=>{
  let username='LimoTeamBot',n=1;
  while(q('SELECT 1 FROM users WHERE username=?').get(username)||q('SELECT 1 FROM chats WHERE username=?').get(username))username='LimoTeam'+(++n)+'Bot';
  const t=now(),result=q("INSERT INTO users(google_sub,email,username,name,bio,verified,coins,created_at,last_seen) VALUES('bot:team-recruitment','',?,'Команда Limochat','Заявки в команду и согласование собеседований. Время — МСК. Права не выдаются автоматически.',1,0,?,?)").run(username,t,t);
  const id=Number(result.lastInsertRowid);
  q('INSERT INTO bots(user_id,owner_id,token_hash,commands,created_at) VALUES(?,?,?,?,?)').run(id,id,crypto.randomBytes(32).toString('hex'),JSON.stringify([{command:'apply',description:'Подать заявку'},{command:'status',description:'Статус заявки'},{command:'cancel',description:'Отменить черновик'}]),t);
  return q('SELECT * FROM users WHERE id=?').get(id);
 });
}
export function flushTeamOutbox(){
 if(!helpers||flushing)return;flushing=true;
 try{
  const bot=teamBot();
  for(const item of q('SELECT * FROM team_outbox WHERE delivered_at=0 ORDER BY id LIMIT 40').all()){
   try{
    const user=q('SELECT * FROM users WHERE id=?').get(item.recipient);
    if(!user||user.banned||user.deleted_at)continue;
    // An existing message makes delivery idempotent even after a restart between send and acknowledgement.
    const exists=q("SELECT 1 FROM messages WHERE sender_id=? AND json_extract(CASE WHEN json_valid(extra) THEN extra ELSE '{}' END,'$.teamDelivery')=?").get(bot.id,item.id);
    if(!exists)helpers.postMessage(helpers.ensurePrivateChat(bot.id,item.recipient),bot.id,{kind:'text',text:item.text,extra:{teamDelivery:item.id}});
    q('UPDATE team_outbox SET delivered_at=? WHERE id=?').run(now(),item.id);
   }catch(e){console.error('team bot delivery failed',item.id);}
  }
 }finally{flushing=false;}
}
const reply=(uid,text)=>{enqueue(uid,text);flushTeamOutbox();};
export function parseInterviewTime(value,time=now()){
 const match=String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);if(!match)return null;
 const [year,month,day,hour,minute]=match.slice(1).map(Number);
 const at=Date.UTC(year,month-1,day,hour-3,minute),local=new Date(at+3*3600000);
 if(local.getUTCFullYear()!==year||local.getUTCMonth()!==month-1||local.getUTCDate()!==day||local.getUTCHours()!==hour||local.getUTCMinutes()!==minute)return null;
 return at>=time+5*60000&&at<=time+90*86400000?at:null;
}
export function teamCallAllowed(token,userId,time=now()){
 const row=q('SELECT i.*,a.status,a.call_token FROM team_interviews i LEFT JOIN team_applications a ON a.id=i.application_id WHERE i.token=?').get(token);
 return !row||row.status==='scheduled'&&row.call_token===token&&row.expires_at>time&&(row.applicant_id===userId||row.admin_id===userId);
}
export function submitTeamApplication(userId,role,experience,time=now()){
 if(!ROLES.includes(role)||typeof experience!=='string'||experience.trim().length<10||experience.length>2000)fail('team_bad_application');
 return tx(()=>{
  if(active(userId))fail('team_active_application');
  const recent=q('SELECT created_at FROM team_applications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  if(recent&&time-recent.created_at<86400000)fail('team_application_cooldown');
  const r=q('INSERT INTO team_applications(user_id,role,experience,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId,role,experience.trim(),time,time);
  const id=Number(r.lastInsertRowid),user=q('SELECT name,username FROM users WHERE id=?').get(userId);
  enqueue(userId,'Заявка #'+id+' на роль «'+role+'» отправлена. Администратор рассмотрит её вручную. /status — статус заявки.');
  notifyAdmins('📋 Новая заявка #'+id+'\nРоль: '+role+'\nКандидат: '+user.name+' (@'+user.username+')\n\n'+experience.trim()+'\n\nРассмотрение: админка → Заявки в команду.');
  q('DELETE FROM team_drafts WHERE user_id=?').run(userId);audit(userId,'','team_application_submit',{id,role});
  return q('SELECT * FROM team_applications WHERE id=?').get(id);
 });
}
export function proposeInterview(userId,at,time=now()){
 if(!Number.isSafeInteger(at)||at<time+5*60000||at>time+90*86400000)fail('team_bad_time');
 return tx(()=>{
  const app=active(userId);if(!app||app.status!=='awaiting_time')fail('team_changed');
  q("UPDATE team_applications SET status='time_proposed',proposed_at=?,version=version+1,updated_at=? WHERE id=?").run(at,time,app.id);
  enqueue(userId,'Предложено: '+date(at)+'. Ожидайте подтверждения администратора. Ссылка появится после подтверждения.');
  enqueue(app.admin_id,'🕒 Кандидат по заявке #'+app.id+' предложил '+date(at)+'. Подтвердите время в админке → Заявки в команду.');
 });
}
export function reviewTeamApplication(actor,id,{action,version,note=''},time=now()){
 if(!isAdminUser(actor))fail('forbidden');
 if(!Number.isSafeInteger(id)||!Number.isSafeInteger(version)||typeof note!=='string'||note.length>1000)fail('team_changed');
 return tx(()=>{
  const app=q('SELECT * FROM team_applications WHERE id=?').get(id);
  if(!app||app.version!==version)fail('team_changed');
  const candidate=q('SELECT * FROM users WHERE id=?').get(app.user_id);
  if(!candidate||candidate.banned||candidate.deleted_at||actor.id===app.user_id)fail('forbidden');
  let status=app.status,token=app.call_token;
  if(action==='invite'){
   if(!['submitted','awaiting_time','time_proposed'].includes(status))fail('team_changed');
   if(app.admin_id&&app.admin_id!==actor.id)fail('team_assigned');
   status='awaiting_time';
   enqueue(app.user_id,'📞 Заявка #'+id+': приглашаем на собеседование. Администратор: '+actor.name+'.\nКогда вам удобно? Отправьте дату и время по Москве в формате ГГГГ-ММ-ДД ЧЧ:ММ (например, 2026-12-01 18:30). От 5 минут до 90 дней вперёд.'+(note?'\nКомментарий: '+note:''));
   q('UPDATE team_applications SET admin_id=?,proposed_at=NULL WHERE id=?').run(actor.id,id);
  }else if(action==='confirm'){
   if(status!=='time_proposed'||app.admin_id!==actor.id)fail('team_changed');
   if(!app.proposed_at||app.proposed_at<time+60000)fail('team_bad_time');
   status='scheduled';token=crypto.randomBytes(18).toString('base64url');
   q('INSERT INTO call_links(token,creator_id,title,created_at) VALUES(?,?,?,?)').run(token,actor.id,'Собеседование Limochat #'+id,time);
   q('INSERT INTO team_interviews(token,application_id,applicant_id,admin_id,expires_at) VALUES(?,?,?,?,?)').run(token,id,app.user_id,actor.id,app.proposed_at+86400000);
   const message='✅ Собеседование по заявке #'+id+' подтверждено.\nВремя: '+date(app.proposed_at)+'\nСсылка: '+config.appOrigin+'/call/'+token+'\nВход доступен только кандидату и согласовавшему администратору. Ссылка действует до '+date(app.proposed_at+86400000)+'.'+(note?'\nКомментарий: '+note:'');
   enqueue(app.user_id,message);enqueue(actor.id,message);
  }else if(action==='reject'){
   if(!['submitted','awaiting_time','time_proposed'].includes(status))fail('team_changed');
   status='rejected';enqueue(app.user_id,'По заявке #'+id+' принято решение: отклонена.'+(note?'\nКомментарий: '+note:''));
  }else if(action==='complete'){
   if(status!=='scheduled'||app.admin_id!==actor.id)fail('team_changed');
   status='completed';enqueue(app.user_id,'Рассмотрение заявки #'+id+' завершено.'+(note?'\nКомментарий: '+note:'')+'\nПрава в мессенджере назначаются отдельно администратором.');
  }else fail('team_changed');
  q('UPDATE team_applications SET status=?,call_token=?,note=?,version=version+1,updated_at=? WHERE id=?').run(status,token,note,time,id);
  audit(actor.id,'','team_application_review',{id,action});
  return q('SELECT * FROM team_applications WHERE id=?').get(id);
 });
}
export function handleTeamBot(botId,chatId,message){
 if(q('SELECT google_sub FROM users WHERE id=?').get(botId)?.google_sub!=='bot:team-recruitment')return false;
 const chat=q('SELECT type FROM chats WHERE id=?').get(chatId),uid=message.sender_id,user=q('SELECT * FROM users WHERE id=?').get(uid||0);
 if(chat?.type!=='private'||!user||user.banned||/^(bot|system):/.test(user.google_sub))return true;
 const text=String(message.text||'').trim(),current=active(uid);
 if(text==='/start'||text==='/help'){reply(uid,'Официальный бот заявок в команду Limochat.\n/apply — подать заявку\n/status — статус заявки\n/cancel — удалить незавершённый черновик\n\nЗаявку рассматривает администратор. Она не выдаёт права автоматически. Время созвона согласовывается в МСК.');return true;}
 if(text==='/status'){reply(uid,current?'Заявка #'+current.id+' · '+({submitted:'На рассмотрении',awaiting_time:'Ожидается удобное время от вас',time_proposed:'Время ожидает подтверждения',scheduled:'Созвон подтверждён'})[current.status]+(current.proposed_at?'\nВремя: '+date(current.proposed_at):'')+(current.status==='scheduled'?'\n'+config.appOrigin+'/call/'+current.call_token:''):'Активных заявок нет. /apply — подать заявку.');return true;}
 if(text==='/cancel'){q('DELETE FROM team_drafts WHERE user_id=?').run(uid);reply(uid,'Черновик удалён. Уже отправленная заявка остаётся на рассмотрении.');return true;}
 if(text==='/apply'){
  if(current){reply(uid,'У вас уже есть заявка #'+current.id+'. /status — её статус.');return true;}
  q("INSERT INTO team_drafts(user_id,stage,updated_at) VALUES(?,'role',?) ON CONFLICT(user_id) DO UPDATE SET stage='role',role=NULL,experience=NULL,updated_at=excluded.updated_at").run(uid,now());
  reply(uid,'На какую роль подаёте заявку? Отправьте «Модератор» или «Администратор».');return true;
 }
 try{
  if(current?.status==='awaiting_time'){
   const at=parseInterviewTime(text.replace(/^\/time\s+/,''));if(!at){reply(uid,'Нужна будущая дата и время по Москве: ГГГГ-ММ-ДД ЧЧ:ММ, от 5 минут до 90 дней вперёд.');return true;}
   proposeInterview(uid,at);flushTeamOutbox();return true;
  }
  const draft=q('SELECT * FROM team_drafts WHERE user_id=?').get(uid);
  if(!draft||now()-draft.updated_at>86400000){reply(uid,'/apply — начать заявку; /status — проверить отправленную.');return true;}
  if(draft.stage==='role'){
   const role=ROLES.find(r=>r.toLowerCase()===text.toLowerCase());if(!role){reply(uid,'Выберите «Модератор» или «Администратор».');return true;}
   q("UPDATE team_drafts SET role=?,stage='experience',updated_at=? WHERE user_id=?").run(role,now(),uid);reply(uid,'Расскажите об опыте и почему хотите помогать: от 10 до 2000 символов. Текст заявки будет доступен администраторам Limochat.');return true;
  }
  if(draft.stage==='experience'){
   if(text.length<10||text.length>2000){reply(uid,'Опыт и мотивация: от 10 до 2000 символов.');return true;}
   q("UPDATE team_drafts SET experience=?,stage='confirm',updated_at=? WHERE user_id=?").run(text,now(),uid);
   reply(uid,'Проверьте заявку:\nРоль: '+draft.role+'\nАккаунт: @'+user.username+'\nОпыт: '+text+'\n\n/submit — отправить администраторам; /cancel — отменить черновик.');return true;
  }
  if(draft.stage==='confirm'&&text==='/submit'){submitTeamApplication(uid,draft.role,draft.experience);flushTeamOutbox();return true;}
  reply(uid,'/submit — отправить подготовленную заявку; /cancel — отменить.');
 }catch(e){reply(uid,({team_active_application:'Активная заявка уже существует. /status',team_application_cooldown:'Новую заявку можно подать не чаще одного раза в сутки.',team_changed:'Статус изменился. Проверьте /status.'})[e.message]||'Не удалось сохранить заявку. Попробуйте ещё раз.');}
 return true;
}
export function registerTeamApi(api,options){
 helpers=options;teamBot();
 api.get('/partners/team-bot',(req,res)=>{const bot=teamBot();res.set('Cache-Control','no-store').json({id:bot.id,username:bot.username});});
 queueMicrotask(flushTeamOutbox);
}
export function registerTeamAdmin(admin){
 admin.get('/team-applications',(req,res)=>{
  res.set('Cache-Control','no-store');
  const status=String(req.query.status||'active'),where=status==='all'?'1':status==='active'?'a.status IN '+ACTIVE:'a.status=?',args=['all','active'].includes(status)?[]:[status];
  const items=q('SELECT a.*,u.name,u.username,ad.name AS admin_name FROM team_applications a JOIN users u ON u.id=a.user_id LEFT JOIN users ad ON ad.id=a.admin_id WHERE '+where+' ORDER BY a.id DESC LIMIT 100').all(...args);
  res.json({applications:items,myId:req.user.id,pendingDelivery:q('SELECT count(*) n FROM team_outbox WHERE delivered_at=0').get().n,bot:helpers?.publicUser?helpers.publicUser(teamBot()):null});
 });
 admin.post('/team-applications/:id/action',(req,res)=>{
  try{const result=reviewTeamApplication(req.user,Number(req.params.id),req.body||{});flushTeamOutbox();res.json({ok:true,application:result});}
  catch(e){if(e.status)return res.status(e.message==='forbidden'?403:409).json({error:e.message});throw e;}
 });
 admin.post('/team-applications/deliver',(req,res)=>{flushTeamOutbox();res.json({ok:true});});
}
setInterval(flushTeamOutbox,30000).unref();
