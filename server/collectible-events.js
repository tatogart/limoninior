import {q,now} from './db.js';
// Called inside the ownership transaction: a failed receipt rolls back the transfer.
export function transferReceipt({fromId,toId,actorId,item,regular=false,purchasePrice=null,adminOverride=false}){
 const from=q('SELECT id,name,username FROM users WHERE id=?').get(fromId),to=q('SELECT id,name,username FROM users WHERE id=?').get(toId);
 const key=Math.min(fromId,toId)+':'+Math.max(fromId,toId);let chat=q('SELECT id FROM chats WHERE pair_key=?').get(key);
 if(!chat){const r=q("INSERT INTO chats(type,pair_key,created_at) VALUES('private',?,?)").run(key,now());chat={id:Number(r.lastInsertRowid)};for(const uid of [fromId,toId])q('INSERT INTO chat_members(chat_id,user_id,joined_at) VALUES(?,?,?)').run(chat.id,uid,now());}
 const extra={collectibleTransfer:{from,to,actorId,byAdmin:adminOverride||(actorId!==fromId&&purchasePrice===null),regular,purchasePrice,item}};
 const text=(purchasePrice===null?'Передача подарка':'Покупка подарка')+': '+item.name+' #'+item.serial+' · '+from.name+' → '+to.name;
 const r=q("INSERT INTO messages(chat_id,sender_id,kind,text,created_at,extra) VALUES(?,NULL,'system',?,?,?)").run(chat.id,text,now(),JSON.stringify(extra));q('UPDATE chats SET last_msg_id=? WHERE id=?').run(Number(r.lastInsertRowid),chat.id);return q('SELECT * FROM messages WHERE id=?').get(Number(r.lastInsertRowid));
}
