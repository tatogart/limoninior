import {db,q,tx,now,audit,blockedBetween} from './db.js';
db.exec(`CREATE TABLE IF NOT EXISTS paid_reactions(id INTEGER PRIMARY KEY,message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,amount INTEGER NOT NULL,request_key TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(sender_id,request_key));CREATE INDEX IF NOT EXISTS paid_reactions_message ON paid_reactions(message_id);`);
export const paidSummary=id=>q('SELECT COALESCE(SUM(amount),0) AS total FROM paid_reactions WHERE message_id=?').get(id).total;
export function registerPaidReactions(api,{isMember,postError,pushMe,emitToChat,limiter}){
 api.post('/messages/:id/lemons',limiter,(req,res)=>{
 const id=Number(req.params.id),amount=req.body?.amount,key=req.body?.requestKey;
 if(!Number.isSafeInteger(amount)||amount<1||amount>1000||typeof key!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(key))return res.status(400).json({error:'bad_amount'});
 const m=q('SELECT * FROM messages WHERE id=?').get(id||0);
 if(!m||!isMember(m.chat_id,req.user.id)||['system','call','gcall'].includes(m.kind))return res.status(404).json({error:'not_found'});
 const posting=postError(m.chat_id,req.user.id);if(posting)return res.status(403).json({error:posting});
 const chat=q('SELECT * FROM chats WHERE id=?').get(m.chat_id),recipient=chat.type==='channel'?chat.owner_id:m.sender_id;
 const author=recipient&&q('SELECT * FROM users WHERE id=?').get(recipient);
 if(!author||author.id===req.user.id||author.banned||/^(bot:|system:)/.test(author.google_sub)||blockedBetween(req.user.id,author.id))return res.status(403).json({error:'cannot_tip'});
 let replay=false;
 const result=tx(()=>{
 const old=q('SELECT * FROM paid_reactions WHERE sender_id=? AND request_key=?').get(req.user.id,key);
 if(old){if(old.message_id!==id||old.amount!==amount)return 'conflict';replay=true;return 'ok';}
 if(!q('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?').run(amount,req.user.id,amount).changes)return 'funds';
 q('UPDATE users SET coins=coins+? WHERE id=?').run(amount,author.id);
 q('INSERT INTO paid_reactions(message_id,sender_id,recipient_id,amount,request_key,created_at) VALUES(?,?,?,?,?,?)').run(id,req.user.id,author.id,amount,key,now());
 audit(req.user.id,req.ip,'paid_reaction',{messageId:id,recipientId:author.id,amount});return 'ok';
 });
 if(result!=='ok')return res.status(result==='funds'?400:409).json({error:result==='funds'?'not_enough_coins':'request_conflict'});
 const payload={chatId:m.chat_id,messageId:id,paidLemons:paidSummary(id)};
 if(!replay){pushMe(req.user.id);pushMe(author.id);emitToChat(m.chat_id,'message:paid',payload);}
 res.json({...payload,balance:q('SELECT coins FROM users WHERE id=?').get(req.user.id).coins});
 });
}
