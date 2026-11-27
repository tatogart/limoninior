import {db,q,now,audit} from './db.js';
import {isAdminUser} from './auth.js';
db.exec('CREATE TABLE IF NOT EXISTS staff_moderators(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,granted_by INTEGER NOT NULL,granted_at INTEGER NOT NULL)');
db.exec(`CREATE TABLE IF NOT EXISTS moderator_actions(id INTEGER PRIMARY KEY,actor INTEGER NOT NULL,user_id INTEGER NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,until_at INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,revoked_at INTEGER NOT NULL DEFAULT 0,report_id INTEGER); CREATE INDEX IF NOT EXISTS moderator_actions_user ON moderator_actions(user_id,id);`);
export const isModerator=(id)=>!!q('SELECT 1 FROM staff_moderators WHERE user_id=?').get(id);
export function registerModeratorAdmin(admin,{pushMe}={}){
 admin.get('/users/:id/moderator',(req,res)=>res.json({enabled:isModerator(Number(req.params.id)||0)}));
 admin.post('/users/:id/moderator',(req,res)=>{
 const id=Number(req.params.id),u=q('SELECT * FROM users WHERE id=?').get(id||0);
 if(!u||isAdminUser(u)||typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'forbidden'});
 if(req.body.enabled)q('INSERT INTO staff_moderators VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING').run(id,req.user.id,now());
 else q('DELETE FROM staff_moderators WHERE user_id=?').run(id);
 audit(req.user.id,req.ip,'moderator_access',{id,enabled:req.body.enabled});pushMe?.(id);res.json({ok:true});
 });
}
export function registerModerator(api,{publicUser,pushChat,notify,disconnectUser=()=>{}}){
 api.get('/staff/access',(req,res)=>res.json({moderator:isModerator(req.user.id)||isAdminUser(req.user)}));
 const guard=(req,res,next)=>{if(!isModerator(req.user.id)&&!isAdminUser(req.user))return res.status(404).json({error:'not_found'});res.set('Cache-Control','no-store');next();};
 api.get('/staff/summary',guard,(req,res)=>res.json({open:q("SELECT count(*) n FROM reports WHERE status='open'").get().n,resolved:q("SELECT count(*) n FROM reports WHERE status='resolved'").get().n,verifications:q("SELECT count(*) n FROM chats WHERE type='channel' AND verify_requested>0 AND verified=0").get().n,actions:q('SELECT count(*) n FROM moderator_actions WHERE actor=? AND created_at>=?').get(req.user.id,now()-7*86400000).n}));
 api.get('/staff/reports',guard,(req,res)=>{
  const status=['open','resolved','dismissed'].includes(req.query?.status)?req.query.status:'open',reason=String(req.query?.reason||'');
  res.json({reports:q("SELECT id,target_type,target_id,reason,comment,snapshot,status,created_at,resolution,resolved_by,resolved_at FROM reports WHERE status=? AND (?='' OR reason=?) ORDER BY id DESC LIMIT 100").all(status,reason,reason)});
 });
 api.get('/staff/actions',guard,(req,res)=>res.json({actions:q('SELECT a.*,u.name,u.username FROM moderator_actions a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100').all().map(a=>({...a,canRevoke:a.actor===req.user.id&&!a.revoked_at&&a.until_at>now()&&a.action!=='warn'}))}));
 api.post('/staff/actions/:id/revoke',guard,(req,res)=>{
  const action=q('SELECT * FROM moderator_actions WHERE id=?').get(Number(req.params.id)||0);
  if(!action||action.actor!==req.user.id||action.revoked_at||action.until_at<=now()||!['mute','ban'].includes(action.action))return res.status(409).json({error:'moderation_changed'});
  const user=q('SELECT * FROM users WHERE id=?').get(action.user_id);
  if(!user||isAdminUser(user)||isModerator(user.id))return res.status(403).json({error:'forbidden'});
  const result=action.action==='mute'?q('UPDATE users SET muted_until=0 WHERE id=? AND muted_until=?').run(user.id,action.until_at):q('UPDATE users SET banned=0,banned_until=0,ban_reason=NULL WHERE id=? AND banned=1 AND banned_until=? AND ban_reason=?').run(user.id,action.until_at,action.reason);
  if(!result.changes)return res.status(409).json({error:'moderation_changed'});
  q('UPDATE moderator_actions SET revoked_at=? WHERE id=?').run(now(),action.id);audit(req.user.id,req.ip,'moderator_revoke',{id:action.id,userId:user.id});notify?.(user.id,'Модератор отменил временное ограничение.');res.json({ok:true});
 });
 api.post('/staff/reports/:id',guard,(req,res)=>{
 const id=Number(req.params.id),status=req.body?.status;
 if(!['resolved','dismissed'].includes(status))return res.status(400).json({error:'forbidden'});
 const r=q("UPDATE reports SET status=?,resolution=?,resolved_by=?,resolved_at=? WHERE id=? AND status='open'").run(status,String(req.body?.note||'').slice(0,1000),req.user.id,now(),id||0);
 audit(req.user.id,req.ip,'moderator_report',{id,status});res.json({ok:!!r.changes});
 });
 function sanction(req,res,report,userId){
  const action=req.body?.action,hours=Number(req.body?.hours);
  if(!['warn','mute','ban'].includes(action)||(action!=='warn'&&![1,6,24,72,168].includes(hours)))return res.status(400).json({error:'forbidden'});
  const note=String(req.body?.reason||'').trim().slice(0,500);
  if(!report&&note.length<3)return res.status(400).json({error:'moderation_reason'});
  const u=q('SELECT * FROM users WHERE id=?').get(userId||0);
  if(!u||u.id===req.user.id||isAdminUser(u)||isModerator(u.id)||/^(system|bot):/.test(u.google_sub)||u.banned||u.deleted_at)return res.status(403).json({error:'forbidden'});
  const reason=report?'Жалоба #'+report.id+': '+report.reason+(note?' · '+note:''):note;
  const until=action==='warn'?0:now()+hours*3600000;
  db.exec('BEGIN IMMEDIATE');
  try{
   if(action==='mute')q('UPDATE users SET muted_until=MAX(muted_until,?) WHERE id=?').run(until,u.id);
   if(action==='ban'){q('UPDATE users SET banned=1,banned_until=?,ban_reason=? WHERE id=?').run(until,reason,u.id);q('DELETE FROM sessions WHERE user_id=?').run(u.id);}
   if(report)q("UPDATE reports SET status='resolved',resolution=?,resolved_by=?,resolved_at=? WHERE target_type=? AND target_id=? AND status='open'").run(action+(action==='warn'?'':': '+hours+' ч')+' · '+reason,req.user.id,now(),report.target_type,report.target_id);
   q('INSERT INTO moderator_actions(actor,user_id,action,reason,until_at,created_at,report_id) VALUES(?,?,?,?,?,?,?)').run(req.user.id,u.id,action,reason,until,now(),report?.id||null);
   audit(req.user.id,req.ip,'moderator_action',{reportId:report?.id||null,userId:u.id,action,hours:action==='warn'?null:hours,reason});db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  if(action==='ban')disconnectUser(u.id);
  notify?.(u.id,action==='warn'?'⚠️ Предупреждение модерации: '+reason+'. Пожалуйста, соблюдайте правила Limochat.':(action==='mute'?'Ограничено право писать':'Временная блокировка')+' на '+hours+' ч. '+reason);
  res.json({ok:true});
 }
 api.post('/staff/users/:id/action',guard,(req,res)=>sanction(req,res,null,Number(req.params.id)));
 api.post('/staff/reports/:id/action',guard,(req,res)=>{
  const report=q('SELECT * FROM reports WHERE id=?').get(Number(req.params.id)||0);
  if(!report||report.status!=='open')return res.status(409).json({error:'not_found'});
  let snap;try{snap=JSON.parse(report.snapshot);}catch{return res.status(400).json({error:'not_found'});}
  return sanction(req,res,report,Number(snap?.offender));
 });
 api.get('/staff/users',guard,(req,res)=>{const query=String(req.query.q||'').slice(0,64);if(query.length<2)return res.json({users:[]});const like='%'+query.replace(/[\\%_]/g,c=>'\\'+c)+'%';res.json({users:q("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' LIMIT 30").all(like,like).map(u=>({...publicUser(u),moderation:{mutedUntil:u.muted_until||0,banned:!!u.banned,bannedUntil:u.banned_until||0,protected:isAdminUser(u)||isModerator(u.id)||/^(system|bot):/.test(u.google_sub),actions:q('SELECT count(*) n FROM moderator_actions WHERE user_id=?').get(u.id).n}}))});});
 api.get('/staff/verifications',guard,(req,res)=>res.json({channels:q("SELECT id,title,username,description,verify_requested FROM chats WHERE type='channel' AND verify_requested>0 AND verified=0 ORDER BY verify_requested LIMIT 100").all()}));
 api.post('/staff/verifications/:id',guard,(req,res)=>{
 const id=Number(req.params.id),approve=req.body?.approve;if(typeof approve!=='boolean')return res.status(400).json({error:'forbidden'});
 const r=q("UPDATE chats SET verified=?,verify_requested=0 WHERE id=? AND type='channel' AND verify_requested>0 AND verified=0").run(approve?1:0,id||0);
 if(!r.changes)return res.status(409).json({error:'not_found'});
 audit(req.user.id,req.ip,'moderator_verification',{id,approve});pushChat(id);res.json({ok:true});
 });
}
