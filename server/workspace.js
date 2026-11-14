import {planLimits} from '../public/js/subscription-limits.js';
// Private, account-synchronised organisation. Never changes another member's view.
import { db, q, tx, now } from './db.js';

db.exec(`
 CREATE TABLE IF NOT EXISTS workspace_chats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  archived INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, chat_id));
 CREATE TABLE IF NOT EXISTS workspace_folders (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_folder_chats (
  folder_id INTEGER NOT NULL REFERENCES workspace_folders(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, PRIMARY KEY(folder_id, chat_id));
 CREATE TABLE IF NOT EXISTS workspace_bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY(user_id, message_id));
 CREATE TABLE IF NOT EXISTS workspace_templates (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, text TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_tasks (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, due INTEGER,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL, created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS workspace_folders_user ON workspace_folders(user_id);
 CREATE INDEX IF NOT EXISTS workspace_templates_user ON workspace_templates(user_id);
 CREATE INDEX IF NOT EXISTS workspace_tasks_user ON workspace_tasks(user_id);
`);
db.function('workspace_fold', { deterministic: true }, (v) => String(v ?? '').normalize('NFKC').toLowerCase());

export function registerWorkspace(api, { bad, int, clean, isMember, serializeMessage, emitToUser, emitToChat, chatForUser, searchLimiter,activePlan=()=>null }) {
 const changed = (uid) => emitToUser(uid, 'workspace:changed', {});
 const member = (req, res) => {
  const id = int(req.params.id);
  if (!id || !isMember(id, req.user.id)) { bad(res, 'not_found', 404); return null; }
  return id;
 };
 const accessibleMessage = (id, uid) => q(`SELECT m.* FROM messages m JOIN chat_members cm ON cm.chat_id=m.chat_id
  WHERE m.id=? AND cm.user_id=?`).get(id || 0, uid);
 const limit = (table, uid, max) => q(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).get(uid).n >= max;
 const failLimit = (res) => bad(res, 'workspace_limit');
 const own = (table, req) => q(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(int(req.params.id) || 0, req.user.id);

 api.get('/workspace', (req, res) => {
  const uid = req.user.id;
  const folders = q('SELECT id,name FROM workspace_folders WHERE user_id=? ORDER BY id').all(uid).map((f) => ({ ...f,
   chatIds: q(`SELECT fc.chat_id FROM workspace_folder_chats fc JOIN chat_members cm ON cm.chat_id=fc.chat_id
    WHERE fc.folder_id=? AND cm.user_id=?`).all(f.id, uid).map((r) => r.chat_id) }));
  res.json({ folders,limits:planLimits(activePlan(req.user)?.id),
   chats: q(`SELECT w.chat_id AS chatId,w.archived,w.unread,w.note FROM workspace_chats w JOIN chat_members cm
    ON cm.chat_id=w.chat_id AND cm.user_id=w.user_id WHERE w.user_id=?`).all(uid),
   bookmarks: q(`SELECT b.message_id AS messageId,b.tag FROM workspace_bookmarks b JOIN messages m ON m.id=b.message_id
    JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=b.user_id WHERE b.user_id=?`).all(uid),
   templates: q('SELECT id,title,text FROM workspace_templates WHERE user_id=? ORDER BY id DESC').all(uid),
   tasks: q(`SELECT t.id,t.text,t.done,t.due,t.created_at AS createdAt,
    CASE WHEN cm.user_id IS NOT NULL THEN t.message_id END AS messageId,
    CASE WHEN cm.user_id IS NOT NULL THEN m.chat_id END AS chatId
    FROM workspace_tasks t LEFT JOIN messages m ON m.id=t.message_id
    LEFT JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=t.user_id
    WHERE t.user_id=? ORDER BY t.done, t.due IS NULL, t.due, t.id DESC`).all(uid) });
 });
 api.patch('/workspace/chats/:id', (req, res) => {
  const id = member(req, res); if (!id) return;
  const b = req.body || {};
  if (('archived' in b && typeof b.archived !== 'boolean') || ('unread' in b && typeof b.unread !== 'boolean') ||
      ('note' in b && (typeof b.note !== 'string' || b.note.length > 4000))) return bad(res, 'bad_workspace');
  const old = q('SELECT * FROM workspace_chats WHERE user_id=? AND chat_id=?').get(req.user.id,id) || {};
  q(`INSERT INTO workspace_chats(user_id,chat_id,archived,unread,note) VALUES(?,?,?,?,?)
   ON CONFLICT(user_id,chat_id) DO UPDATE SET archived=excluded.archived,unread=excluded.unread,note=excluded.note`)
   .run(req.user.id,id,Number(b.archived ?? !!old.archived),Number(b.unread ?? !!old.unread), b.note === undefined ? old.note || '' : clean(b.note,4000));
  changed(req.user.id); res.json({ ok:true });
 });
 api.post('/workspace/folders', (req, res) => {
  const name = clean(req.body?.name,32); if (!name) return bad(res,'bad_title');
  if (limit('workspace_folders',req.user.id,planLimits(activePlan(req.user)?.id).folders)) return bad(res,'subscription_limit');
  const ids=req.body?.chatIds??[];
  if(!Array.isArray(ids)||ids.length>500||ids.some(id=>!int(id)||!isMember(Number(id),req.user.id)))return bad(res,'bad_workspace');
  const id=tx(()=>{
   const r=q('INSERT INTO workspace_folders(user_id,name) VALUES(?,?)').run(req.user.id,name);
   const fid=Number(r.lastInsertRowid);
   for(const cid of new Set(ids.map(Number)))q('INSERT INTO workspace_folder_chats(folder_id,chat_id) VALUES(?,?)').run(fid,cid);
   return fid;
  });
  changed(req.user.id); res.json({id});
 });
 api.put('/workspace/folders/:id', (req,res) => {
  const f=own('workspace_folders',req); if(!f) return bad(res,'not_found',404);
  const name=clean(req.body?.name,32), ids=req.body?.chatIds;
  if(!name || !Array.isArray(ids) || ids.length>500 || ids.some((id)=>!int(id)||!isMember(Number(id),req.user.id))) return bad(res,'bad_workspace');
  tx(()=>{
   q('UPDATE workspace_folders SET name=? WHERE id=?').run(name,f.id);
   q('DELETE FROM workspace_folder_chats WHERE folder_id=?').run(f.id);
   for(const id of new Set(ids.map(Number))) q('INSERT INTO workspace_folder_chats(folder_id,chat_id) VALUES(?,?)').run(f.id,id);
  });
  changed(req.user.id); res.json({ok:true});
 });
 api.delete('/workspace/folders/:id', (req,res)=>{
  q('DELETE FROM workspace_folders WHERE id=? AND user_id=?').run(int(req.params.id)||0,req.user.id);
  changed(req.user.id); res.json({ok:true});
 });
 api.post('/workspace/read-all', (req,res)=>{
  const ids=req.body?.chatIds;
  if(!Array.isArray(ids)||ids.length>500||ids.some((id)=>!int(id)||!isMember(Number(id),req.user.id))) return bad(res,'bad_workspace');
  const updates=[];
  tx(()=>{
   for(const id of new Set(ids.map(Number))){
    const last=q('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE chat_id=?').get(id).id;
    q('UPDATE chat_members SET last_read_id=MAX(last_read_id,?) WHERE chat_id=? AND user_id=?').run(last,id,req.user.id);
    q('UPDATE workspace_chats SET unread=0 WHERE chat_id=? AND user_id=?').run(id,req.user.id);
    updates.push({id,last});
   }
  });
  for(const {id,last} of updates){
   emitToUser(req.user.id,'chat',chatForUser(id,req.user.id));
   if(q('SELECT type FROM chats WHERE id=?').get(id).type!=='channel') emitToChat(id,'read',{chatId:id,userId:req.user.id,messageId:last},req.user.id);
  }
  changed(req.user.id); res.json({ok:true});
 });
 api.put('/workspace/bookmarks/:id', (req,res)=>{
  const m=accessibleMessage(int(req.params.id),req.user.id); if(!m) return bad(res,'not_found',404);
  const exists=q('SELECT 1 FROM workspace_bookmarks WHERE user_id=? AND message_id=?').get(req.user.id,m.id);
  if(!exists&&limit('workspace_bookmarks',req.user.id,500)) return failLimit(res);
  q(`INSERT INTO workspace_bookmarks(user_id,message_id,tag,created_at) VALUES(?,?,?,?)
   ON CONFLICT(user_id,message_id) DO UPDATE SET tag=excluded.tag`).run(req.user.id,m.id,clean(req.body?.tag,32),now());
  changed(req.user.id); res.json({ok:true});
 });
 api.delete('/workspace/bookmarks/:id', (req,res)=>{
  q('DELETE FROM workspace_bookmarks WHERE user_id=? AND message_id=?').run(req.user.id,int(req.params.id)||0);
  changed(req.user.id); res.json({ok:true});
 });
 api.get('/workspace/bookmarks', (req,res)=>{
  const before=int(req.query.before)||Number.MAX_SAFE_INTEGER;
  const rows=q(`SELECT m.*,b.tag FROM workspace_bookmarks b JOIN messages m ON m.id=b.message_id
   JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=b.user_id
   WHERE b.user_id=? AND m.id<? ORDER BY m.id DESC LIMIT 51`).all(req.user.id,before);
  res.json({items:rows.slice(0,50).map(m=>({message:serializeMessage(m,req.user.id),tag:m.tag})),hasMore:rows.length>50});
 });
 const saveTemplate=(req,res,existing)=>{
  const title=clean(req.body?.title,60), text=clean(req.body?.text,4096);
  if(!title||!text||String(req.body?.text).length>4096) return bad(res,'bad_workspace');
  if(existing) q('UPDATE workspace_templates SET title=?,text=? WHERE id=?').run(title,text,existing.id);
  else { if(limit('workspace_templates',req.user.id,planLimits(activePlan(req.user)?.id).templates)) return bad(res,'subscription_limit');
   q('INSERT INTO workspace_templates(user_id,title,text) VALUES(?,?,?)').run(req.user.id,title,text); }
  changed(req.user.id); res.json({ok:true});
 };
 api.post('/workspace/templates',(req,res)=>saveTemplate(req,res));
 api.put('/workspace/templates/:id',(req,res)=>{const t=own('workspace_templates',req);if(!t)return bad(res,'not_found',404);return saveTemplate(req,res,t);});
 api.delete('/workspace/templates/:id',(req,res)=>{
  q('DELETE FROM workspace_templates WHERE id=? AND user_id=?').run(int(req.params.id)||0,req.user.id);
  changed(req.user.id);res.json({ok:true});
 });
 const saveTask=(req,res,existing)=>{
  const b=req.body||{},text=clean(b.text,500), due=b.due==null?null:Number(b.due);
  if(!text||(b.done!==undefined&&typeof b.done!=='boolean')||(due!==null&&(!Number.isSafeInteger(due)||due<0||due>8640000000000000))) return bad(res,'bad_workspace');
  const mid=b.messageId==null?null:int(b.messageId);
  if(b.messageId!=null&&(!mid||!accessibleMessage(mid,req.user.id))) return bad(res,'not_found',404);
  if(existing) q('UPDATE workspace_tasks SET text=?,done=?,due=? WHERE id=?').run(text,Number(b.done??!!existing.done),due,existing.id);
  else {if(limit('workspace_tasks',req.user.id,500)) return failLimit(res);
   q('INSERT INTO workspace_tasks(user_id,text,due,message_id,created_at) VALUES(?,?,?,?,?)').run(req.user.id,text,due,mid,now());}
  changed(req.user.id);res.json({ok:true});
 };
 api.post('/workspace/tasks',(req,res)=>saveTask(req,res));
 api.put('/workspace/tasks/:id',(req,res)=>{const t=own('workspace_tasks',req);if(!t)return bad(res,'not_found',404);return saveTask(req,res,t);});
 api.delete('/workspace/tasks/:id',(req,res)=>{
  q('DELETE FROM workspace_tasks WHERE id=? AND user_id=?').run(int(req.params.id)||0,req.user.id);changed(req.user.id);res.json({ok:true});
 });
 // Cursor pagination and membership check on EVERY page, including exports.
 const search=(req,res)=>{
  const uid=req.user.id, p=req.query, chatId=p.chatId==null?null:int(p.chatId);
  if(p.chatId!=null&&(!chatId||!isMember(chatId,uid)))return bad(res,'not_found',404);
  const conditions=['cm.user_id=?','m.id<?'], args=[uid,int(p.before)||Number.MAX_SAFE_INTEGER];
  if(chatId){conditions.push('m.chat_id=?');args.push(chatId);}
  const kinds={image:['image'],file:['file'],voice:['voice'],circle:['circle'],text:['text']};
  if(p.kind&&p.kind!=='all'&&p.kind!=='links'&&!kinds[p.kind])return bad(res,'bad_workspace');
  if(kinds[p.kind]){conditions.push('m.kind=?');args.push(kinds[p.kind][0]);}
  else conditions.push("m.kind IN ('text','image','file','voice','circle','system')");
  if(p.kind==='links')conditions.push("(m.text LIKE '%https://%' OR m.text LIKE '%http://%')");
  const raw=clean(p.q,100).normalize('NFKC').toLowerCase();
  if(raw){const like=`%${raw.replace(/[\\%_]/g,ch=>'\\'+ch)}%`;
   conditions.push("(workspace_fold(m.text) LIKE ? ESCAPE '\\' OR workspace_fold(CASE WHEN json_valid(m.extra) THEN json_extract(m.extra,'$.name') END) LIKE ? ESCAPE '\\')");args.push(like,like);}
  for(const [key,op] of [['from','>='],['to','<']]) if(p[key]!==undefined){
   const value=Number(p[key]);if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)return bad(res,'bad_workspace');
   conditions.push(`m.created_at${op}?`);args.push(value);
  }
  if(p.sender==='me'){conditions.push('m.sender_id=?');args.push(uid);}
  else if(p.sender==='others'){conditions.push('(m.sender_id IS NULL OR m.sender_id!=?)');args.push(uid);}
  else if(p.sender&&p.sender!=='all')return bad(res,'bad_workspace');
  const rows=q(`SELECT m.*,u.name AS sender_name FROM messages m JOIN chat_members cm ON cm.chat_id=m.chat_id
   LEFT JOIN users u ON u.id=m.sender_id WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT 51`).all(...args);
  res.json({messages:rows.slice(0,50).map(m=>({...serializeMessage(m,uid),senderName:m.sender_name||'Система'})),hasMore:rows.length>50});
 };
 if(searchLimiter)api.get('/workspace/search',searchLimiter,search);else api.get('/workspace/search',search);
 api.get('/workspace/messages/:id/context',(req,res)=>{
  const m=accessibleMessage(int(req.params.id),req.user.id);if(!m)return bad(res,'not_found',404);
  const older=q('SELECT m.*,u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.chat_id=? AND m.id<? ORDER BY m.id DESC LIMIT 20').all(m.chat_id,m.id).reverse();
  const newer=q('SELECT m.*,u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.chat_id=? AND m.id>=? ORDER BY m.id LIMIT 21').all(m.chat_id,m.id);
  res.json({messages:[...older,...newer].map(row=>({...serializeMessage(row,req.user.id),senderName:row.sender_name||'Система'}))});
 });
 api.get('/workspace/chats/:id/export',(req,res)=>{
  const id=member(req,res);if(!id)return;
  const ceiling=int(req.query.ceiling)||q('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE chat_id=?').get(id).id;
  const rows=q(`SELECT m.*,u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id
   WHERE m.chat_id=? AND m.id<=? AND m.id<? ORDER BY m.id DESC LIMIT 201`).all(id,ceiling,int(req.query.before)||Number.MAX_SAFE_INTEGER);
  res.json({ceiling,hasMore:rows.length>200,messages:rows.slice(0,200).map(m=>({...serializeMessage(m,req.user.id),senderName:m.sender_name||'Система'}))});
 });
}
