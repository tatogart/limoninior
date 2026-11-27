import {MAX_SAVED_ACCOUNTS,savedAccountSessions,rememberCurrentAccount,switchSavedAccount,forgetSavedAccount,sessionFromCookie} from './auth.js';
import {audit} from './db.js';
export function registerMultiAccounts(api,{meUser,disconnectSession}){
 const summary=req=>{const current=sessionFromCookie(req.headers?.cookie);return {limit:MAX_SAVED_ACCOUNTS,currentId:current?.user.id||null,accounts:savedAccountSessions(req).map(a=>({id:a.user.id,name:a.user.name,username:a.user.username,avatar:a.user.avatar?'/media/'+a.user.avatar:null,current:a.user.id===current?.user.id}))};};
 const check=(req,res)=>{const expected=req.headers?.['x-limochat-account'],current=sessionFromCookie(req.headers?.cookie);if(expected&&String(current?.user.id||'')!==String(expected)){res.status(409).json({error:'account_changed'});return false;}return true;};
 api.get('/auth/accounts',(req,res)=>{res.set('Cache-Control','no-store');rememberCurrentAccount(req,res);savedAccountSessions(req,res);res.json(summary(req));});
 api.post('/auth/accounts/switch',(req,res)=>{
  res.set('Cache-Control','no-store');if(!check(req,res))return;
  const uid=Number(req.body?.userId);if(!Number.isSafeInteger(uid)||uid<1)return res.status(400).json({error:'bad_account'});
  const old=sessionFromCookie(req.headers?.cookie),target=switchSavedAccount(req,res,uid);
  if(!target)return res.status(401).json({error:'account_expired'});
  if(old&&old.session.id!==target.session.id)disconnectSession(old.session.id);
  audit(uid,req.ip,'account_switch');res.json({ok:true,user:meUser(target.user)});
 });
 api.post('/auth/accounts/remove',(req,res)=>{
  res.set('Cache-Control','no-store');if(!check(req,res))return;
  const uid=Number(req.body?.userId);if(!Number.isSafeInteger(uid)||uid<1)return res.status(400).json({error:'bad_account'});
  const result=forgetSavedAccount(req,res,uid);if(result.removed)disconnectSession(result.removed);
  if(result.removed)audit(uid,req.ip,'account_forget');res.json({ok:true,currentRemoved:result.currentRemoved});
 });
}
