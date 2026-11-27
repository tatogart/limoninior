import crypto from 'node:crypto';
import {q,tx,kvGet,kvSet,now} from './db.js';
import {isAdminUser} from './auth.js';
const KEY='official_news_channel';
export function ensureNewsChannel(official,staff=[]){
 return tx(()=>{
  let channel=q("SELECT * FROM chats WHERE id=? AND type='channel' AND owner_id=?").get(Number(kvGet(KEY))||0,official.id);
  if(!channel)channel=q("SELECT * FROM chats WHERE type='channel' AND owner_id=? AND username='LimochatNews'").get(official.id);
  if(!channel){
   let username='LimochatNews',suffix=0;
   while(q('SELECT 1 FROM users WHERE username=? UNION ALL SELECT 1 FROM chats WHERE username=?').get(username,username)){
    username='LimochatNews'+(++suffix>99?crypto.randomBytes(6).toString('hex'):suffix);
   }
   const result=q("INSERT INTO chats(type,title,description,username,invite_token,owner_id,created_at,verified) VALUES('channel',?,?,?,?,?,?,1)").run('Новости Limochat','Официальные новости Limochat: обновления, исправления и важные объявления команды проекта.',username,crypto.randomBytes(12).toString('base64url'),official.id,now());
   channel=q('SELECT * FROM chats WHERE id=?').get(Number(result.lastInsertRowid));
  }
  kvSet(KEY,channel.id);
  q("INSERT OR IGNORE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'owner',?)").run(channel.id,official.id,now());
  for(const user of staff){
   if(user.id===official.id||user.banned||!isAdminUser(user))continue;
   q("INSERT INTO chat_members(chat_id,user_id,role,joined_at,last_read_id) VALUES(?,?,'admin',?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET role='admin'").run(channel.id,user.id,now(),channel.last_msg_id);
  }
  return channel;
 });
}
