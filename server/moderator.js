import {db,q,now,audit} from './db.js';
import {isAdminUser} from './auth.js';
db.exec('CREATE TABLE IF NOT EXISTS staff_moderators(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,granted_by INTEGER NOT NULL,granted_at INTEGER NOT NULL)');
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
 api.get('/staff/reports',guard,(req,res)=>res.json({reports:q("SELECT id,target_type,target_id,reason,comment,snapshot,status,created_at FROM reports WHERE status='open' ORDER BY id DESC LIMIT 100").all()}));
 api.post('/staff/reports/:id',guard,(req,res)=>{
 const id=Number(req.params.id),status=req.body?.status;
 if(!['resolved','dismissed'].includes(status))return res.status(400).json({error:'forbidden'});
 const r=q("UPDATE reports SET status=?,resolution=?,resolved_by=?,resolved_at=? WHERE id=? AND status='open'").run(status,String(req.body?.note||'').slice(0,1000),req.user.id,now(),id||0);
 audit(req.user.id,req.ip,'moderator_report',{id,status});res.json({ok:!!r.changes});
 });
 api.post('/staff/reports/:id/action',guard,(req,res)=>{
 const report=q('SELECT * FROM reports WHERE id=?').get(Number(req.params.id)||0);
 if(!report||report.status!=='open')return res.status(409).json({error:'not_found'});
 const action=req.body?.action,hours=Number(req.body?.hours);
 if(!['warn','mute','ban'].includes(action)||(action!=='warn'&&![1,6,24,72,168].includes(hours)))return res.status(400).json({error:'forbidden'});
 let snap;try{snap=JSON.parse(report.snapshot);}catch{return res.status(400).json({error:'not_found'});}
 const u=q('SELECT * FROM users WHERE id=?').get(Number(snap?.offender)||0);
 if(!u||u.id===req.user.id||isAdminUser(u)||isModerator(u.id)||u.google_sub==='system:limoninior'||u.banned)return res.status(403).json({error:'forbidden'});
 const reason='Жалоба #'+report.id+': '+report.reason;
 db.exec('BEGIN IMMEDIATE');
 try{
 if(action==='mute')q('UPDATE users SET muted_until=MAX(muted_until,?) WHERE id=?').run(now()+hours*3600000,u.id);
 if(action==='ban'){q('UPDATE users SET banned=1,banned_until=?,ban_reason=? WHERE id=?').run(now()+hours*3600000,reason,u.id);q('DELETE FROM sessions WHERE user_id=?').run(u.id);}
 q("UPDATE reports SET status='resolved',resolution=?,resolved_by=?,resolved_at=? WHERE target_type=? AND target_id=? AND status='open'").run(action+(action==='warn'?'':': '+hours+' ч'),req.user.id,now(),report.target_type,report.target_id);
 audit(req.user.id,req.ip,'moderator_action',{reportId:report.id,userId:u.id,action,hours:action==='warn'?null:hours});
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 if(action==='ban')disconnectUser(u.id);
 notify?.(u.id,action==='warn'?'⚠️ Предупреждение модерации: '+reason+'. Пожалуйста, соблюдайте правила Limochat.':(action==='mute'?'Ограничено право писать':'Временная блокировка')+' на '+hours+' ч. '+reason);
 res.json({ok:true});
 });
 api.get('/staff/users',guard,(req,res)=>{const query=String(req.query.q||'').slice(0,64);if(query.length<2)return res.json({users:[]});const like='%'+query.replace(/[\\%_]/g,c=>'\\'+c)+'%';res.json({users:q("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' LIMIT 30").all(like,like).map(publicUser)});});
 api.get('/staff/verifications',guard,(req,res)=>res.json({channels:q("SELECT id,title,username,description,verify_requested FROM chats WHERE type='channel' AND verify_requested>0 AND verified=0 ORDER BY verify_requested LIMIT 100").all()}));
 api.post('/staff/verifications/:id',guard,(req,res)=>{
 const id=Number(req.params.id),approve=req.body?.approve;if(typeof approve!=='boolean')return res.status(400).json({error:'forbidden'});
 const r=q("UPDATE chats SET verified=?,verify_requested=0 WHERE id=? AND type='channel' AND verify_requested>0 AND verified=0").run(approve?1:0,id||0);
 if(!r.changes)return res.status(409).json({error:'not_found'});
 audit(req.user.id,req.ip,'moderator_verification',{id,approve});pushChat(id);res.json({ok:true});
 });
}
