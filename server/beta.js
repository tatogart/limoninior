import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {db,q,now,tx,audit} from './db.js';
import {requireAuth,sessionFromCookie} from './auth.js';

db.exec(`
 CREATE TABLE IF NOT EXISTS beta_codes(id INTEGER PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,max_uses INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,revoked_at INTEGER NOT NULL DEFAULT 0,created_by INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS beta_grants(session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,user_id INTEGER NOT NULL,code_id INTEGER NOT NULL REFERENCES beta_codes(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS beta_feedback(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL);
`);
// Access belongs to an account, independently of individual device sessions.
db.exec(`CREATE TABLE IF NOT EXISTS beta_account_grants(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code_id INTEGER NOT NULL REFERENCES beta_codes(id),expires_at INTEGER NOT NULL);
 INSERT OR IGNORE INTO beta_account_grants(user_id,code_id,expires_at) SELECT user_id,code_id,MAX(expires_at) FROM beta_grants GROUP BY user_id;`);
let notifyAccess=()=>{};
export function setBetaNotifier(notify){notifyAccess=notify;}
const digest=code=>crypto.createHash('sha256').update(code).digest('hex');
const normalize=code=>String(code||'').toUpperCase().replace(/[\s-]/g,'');
export function betaGrant(sessionId,userId,time=now()){
 return q('SELECT g.expires_at,c.label,c.id AS code_id FROM beta_account_grants g JOIN beta_codes c ON c.id=g.code_id WHERE g.user_id=? AND g.expires_at>? AND c.expires_at>? AND c.revoked_at=0').get(userId,time,time)||null;
}
export function createBetaCode(actor,{label='Бета-тест',maxUses=1,days=7}={}){
 if(typeof label!=='string'||!label.trim()||label.length>80||!Number.isInteger(maxUses)||maxUses<1||maxUses>100||!Number.isInteger(days)||days<1||days>30)throw Object.assign(Error('beta_bad_settings'),{status:400});
 const raw='LIMO'+crypto.randomBytes(10).toString('hex').toUpperCase(),time=now();
 const result=q('INSERT INTO beta_codes(token_hash,label,max_uses,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)').run(digest(raw),label.trim(),maxUses,time+days*86400000,actor,time);
 audit(actor,'','beta_code_create',{id:Number(result.lastInsertRowid),maxUses,days});
 return {id:Number(result.lastInsertRowid),code:raw.slice(0,4)+'-'+raw.slice(4).match(/.{1,5}/g).join('-'),expiresAt:time+days*86400000};
}
export function redeemBetaCode(session,user,code,time=now()){
 if(session.user_id!==user.id||session.expires_at<=time)return null;
 const raw=normalize(code);if(!/^LIMO[A-F0-9]{20}$/.test(raw))return null;
 return tx(()=>{
  const existing=betaGrant(session.id,user.id,time);if(existing)return existing;
  const row=q('SELECT * FROM beta_codes WHERE token_hash=? AND revoked_at=0 AND expires_at>? AND uses<max_uses').get(digest(raw),time);
  if(!row)return null;
  const expires=row.expires_at;
  if(expires<=time)return null;
  if(!q('UPDATE beta_codes SET uses=uses+1 WHERE id=? AND uses<max_uses AND revoked_at=0').run(row.id).changes)return null;
  q('INSERT INTO beta_account_grants(user_id,code_id,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_id=excluded.code_id,expires_at=excluded.expires_at').run(user.id,row.id,expires);
  audit(user.id,'','beta_access_redeem',{codeId:row.id});return betaGrant(session.id,user.id,time);
 });
}
export function requireBeta(req,res,next){
 if(!betaGrant(req.session.id,req.user.id))return res.status(403).json({error:'beta_access_required'});
 res.set('Cache-Control','no-store');next();
}
export function betaRouter(coreApi){
 const router=express.Router();
 router.get('/status',(req,res)=>{const current=sessionFromCookie(req.headers.cookie),grant=current?betaGrant(current.session.id,current.user.id):null;res.set('Cache-Control','no-store').json({authenticated:!!current,access:!!grant,expiresAt:grant?.expires_at||null,name:current?.user.name||null});});
 const limiter=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'too_many_attempts'}});
 router.post('/redeem',requireAuth,limiter,(req,res)=>{const grant=redeemBetaCode(req.session,req.user,req.body?.code);if(!grant)return res.status(400).json({error:'beta_bad_code'});notifyAccess(req.user.id);res.json({ok:true,expiresAt:grant.expires_at});});
 router.post('/leave',requireAuth,(req,res)=>{res.json({ok:true,url:'/'});});
 const feedbackLimiter=rateLimit({windowMs:3600000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,keyGenerator:req=>'u'+req.user.id});
 router.post('/feedback',requireAuth,requireBeta,feedbackLimiter,(req,res)=>{const text=String(req.body?.text||'').trim();if(text.length<3||text.length>2000)return res.status(400).json({error:'beta_bad_feedback'});q('INSERT INTO beta_feedback(user_id,text,created_at) VALUES(?,?,?)').run(req.user.id,text,now());res.json({ok:true});});
 router.use('/app',requireAuth,requireBeta,coreApi);
 router.use((_req,res)=>res.status(404).json({error:'not_found'}));
 return router;
}
export function registerBetaAdmin(admin){
 admin.get('/beta/codes',(_req,res)=>res.json({codes:q('SELECT id,label,max_uses AS maxUses,uses,expires_at AS expiresAt,revoked_at AS revokedAt,created_at AS createdAt,(SELECT count(*) FROM beta_account_grants g WHERE g.code_id=c.id AND g.expires_at>?) AS grants FROM beta_codes c ORDER BY id DESC LIMIT 100').all(now())}));
 admin.post('/beta/codes',(req,res)=>{try{res.json(createBetaCode(req.user.id,req.body));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}});
 admin.post('/beta/codes/:id/revoke',(req,res)=>{const id=Number(req.params.id);const result=q('UPDATE beta_codes SET revoked_at=? WHERE id=? AND revoked_at=0').run(now(),id||0);audit(req.user.id,req.ip,'beta_code_revoke',{id});for(const grant of q('SELECT user_id FROM beta_account_grants WHERE code_id=?').all(id||0))notifyAccess(grant.user_id);res.json({ok:!!result.changes});});
 admin.get('/beta/feedback',(_req,res)=>res.json({feedback:q('SELECT f.*,u.name,u.username FROM beta_feedback f JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 100').all()}));
}
