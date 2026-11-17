import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import {db,q,tx,now,audit} from './db.js';
import {requireAuth,verifyPassword,hashPassword,destroySession} from './auth.js';
import {disconnectUser,emitToUsers} from './realtime.js';
import {deleteMediaFile} from './media.js';

for(const [name,type] of [['recovery_hash','TEXT'],['deleted_at','INTEGER']]){
 if(!q("SELECT 1 FROM pragma_table_info('users') WHERE name=?").get(name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
}
export const recoveryDigest=value=>crypto.createHash('sha256').update(String(value||'').replace(/[\s-]/g,'').toUpperCase()).digest('hex');
export const newRecoveryCode=()=>crypto.randomBytes(24).toString('hex').toUpperCase().match(/.{8}/g).join('-');
const validPassword=value=>typeof value==='string'&&value.length>=8&&value.length<=128;
const error=(res,message,status=400)=>res.status(status).json({error:message});
async function confirmOwner(req){
 const u=req.user;
 if(req.session.auth_method==='google'&&req.session.created_at>now()-300000)return true;
 if(u.password_hash)return verifyPassword(String(req.body?.current||'').slice(0,128),u.password_hash);
 return false;
}
function stillCurrent(req){const u=q('SELECT password_hash,deleted_at FROM users WHERE id=?').get(req.user.id);return u&&!u.deleted_at&&u.password_hash===req.user.password_hash&&!!q('SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?').get(req.session.id,req.user.id,now());}
export function registerAccountLifecycle(api,{publicUser}){
 const limiter=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});
 api.post('/me/recovery-code',requireAuth,limiter,async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!await confirmOwner(req))return error(res,req.user.password_hash?'bad_current_password':'recent_login_required',403);
  if(!stillCurrent(req))return error(res,'recent_login_required',403);
  const code=newRecoveryCode();q('UPDATE users SET recovery_hash=? WHERE id=?').run(recoveryDigest(code),req.user.id);
  audit(req.user.id,req.ip,'recovery_code_rotated');res.json({code});
 });
 api.post('/auth/password/reset',limiter,async(req,res)=>{
  res.set('Cache-Control','no-store');
  const username=String(req.body?.username||'').replace(/^@/,'').trim().slice(0,32),code=String(req.body?.code||'').slice(0,100),password=req.body?.password;
  if(!validPassword(password))return error(res,'weak_password');
  const u=q('SELECT * FROM users WHERE username=?').get(username),digest=recoveryDigest(code);
  if(!u||u.banned||u.deleted_at||!u.recovery_hash||!crypto.timingSafeEqual(Buffer.from(digest),Buffer.from(u.recovery_hash)))return error(res,'bad_recovery_code',401);
  const hash=await hashPassword(password),nextCode=newRecoveryCode();
  const changed=tx(()=>{
   const result=q('UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=? AND banned=0 AND deleted_at IS NULL').run(hash,recoveryDigest(nextCode),u.id,digest);
   if(!result.changes)return false;
   q('DELETE FROM sessions WHERE user_id=?').run(u.id);return true;
  });
  if(!changed)return error(res,'bad_recovery_code',401);
  disconnectUser(u.id);audit(u.id,req.ip,'password_recovered');
  res.json({ok:true,code:nextCode});
 });
 api.post('/me/delete',requireAuth,limiter,async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.body?.confirmation!=='УДАЛИТЬ')return error(res,'delete_confirmation');
  if(!await confirmOwner(req))return error(res,req.user.password_hash?'bad_current_password':'recent_login_required',403);
  const uid=req.user.id;
  if(q("SELECT 1 FROM chats WHERE owner_id=? AND type IN ('group','channel')").get(uid)||q('SELECT 1 FROM communities WHERE owner_id=?').get(uid)||q('SELECT 1 FROM bots WHERE owner_id=?').get(uid))return error(res,'account_owns_resources',409);
  if(q('SELECT 1 FROM family_links WHERE child=? OR parent=?').get(uid,uid))return error(res,'account_family_linked',409);
  const recipients=q('SELECT DISTINCT other.user_id FROM chat_members mine JOIN chat_members other ON mine.chat_id=other.chat_id WHERE mine.user_id=? AND other.user_id!=?').all(uid,uid).map(r=>r.user_id);
  let profile={};try{profile=JSON.parse(req.user.profile_x||'{}');}catch{}
  const personalFiles=[req.user.avatar,profile.cover,profile.track?.file].filter(x=>typeof x==='string');
  const avatars=[...personalFiles.map(name=>({name})),...q("SELECT m.name FROM media m JOIN chats c ON c.id=m.chat_id WHERE c.owner_id=? AND c.type='saved'").all(uid),...q('SELECT file AS name FROM stories WHERE user_id=? AND file IS NOT NULL').all(uid)];
  const changed=tx(()=>{
   if(!stillCurrent(req))return false;
   // Keep a nameless sender record so other people's conversation history remains intact.
   q(`UPDATE users SET google_sub=?,email='',username=NULL,name='Удалённый аккаунт',bio='',avatar=NULL,google_pic=NULL,password_hash=NULL,recovery_hash=NULL,banned=1,banned_until=0,ban_reason=NULL,muted_until=0,deleted_at=?,last_seen=0,verified=0,coins=0,sub_tier=NULL,sub_until=0,prefs='{}',profile_color=NULL,profile_x='{}',shown_role=NULL,shown_badge=NULL,referred_by=NULL WHERE id=?`).run('deleted:'+crypto.randomBytes(24).toString('hex'),now(),uid);
   for(const table of ['sessions','push_subs','chat_members','community_members','user_rewards','staff_moderators'])q(`DELETE FROM ${table} WHERE user_id=?`).run(uid);
   q('DELETE FROM family_invites WHERE parent=?').run(uid);
   q('DELETE FROM stories WHERE user_id=?').run(uid);
   q('DELETE FROM profile_views WHERE user_id=? OR viewer_id=?').run(uid,uid);
   q('UPDATE collectible_listings SET active=0 WHERE seller_id=?').run(uid);
   q('UPDATE collectible_items SET selected=0 WHERE user_id=?').run(uid);
   q("DELETE FROM chats WHERE owner_id=? AND type='saved'").run(uid);
   audit(uid,req.ip,'account_deleted');return true;
  });
  if(!changed)return error(res,'recent_login_required',403);
  for(const file of avatars)try{deleteMediaFile(file.name);}catch{}
  emitToUsers(recipients,'user',{...publicUser(q('SELECT * FROM users WHERE id=?').get(uid)),online:false,lastSeen:null,lastSeenHidden:true});
  destroySession(res);res.json({ok:true});disconnectUser(uid);
 });
}
