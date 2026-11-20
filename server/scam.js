import {db,q,audit} from './db.js';
for(const table of ['users','chats'])for(const [col,definition] of [['scam','INTEGER NOT NULL DEFAULT 0'],['scam_reason',"TEXT NOT NULL DEFAULT ''"]])if(!q('PRAGMA table_info('+table+')').all().some(c=>c.name===col))db.exec('ALTER TABLE '+table+' ADD COLUMN '+col+' '+definition);
export function registerScamAdmin(admin,{pushMe,broadcastProfile,pushChat}={}){
 for(const [type,table] of [['users','users'],['channels','chats']])admin.post('/'+type+'/:id/scam',(req,res)=>{
 const id=Number(req.params.id),enabled=req.body?.enabled,reason=String(req.body?.reason||'').trim();
 if(typeof enabled!=='boolean'||enabled&&(reason.length<3||reason.length>300))return res.status(400).json({error:'bad_scam_reason'});
 const target=q('SELECT * FROM '+table+' WHERE id=?'+(type==='channels'?" AND type='channel'":'')).get(id||0);if(!target)return res.status(404).json({error:'not_found'});
 q('UPDATE '+table+' SET scam=?,scam_reason=? WHERE id=?').run(enabled?1:0,enabled?reason:'',id);audit(req.user.id,req.ip,'admin_scam',{type,id,enabled,reason:enabled?reason:''});
 if(type==='users'){pushMe?.(id);broadcastProfile?.(q('SELECT * FROM users WHERE id=?').get(id));}else pushChat?.(id);res.json({ok:true});
 });
}
