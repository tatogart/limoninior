import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {config} from './config.js';
import {db,q,now,tx} from './db.js';
import {saveImage} from './media.js';
db.exec("CREATE TABLE IF NOT EXISTS studio_sessions(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,pack_id INTEGER,mode TEXT NOT NULL DEFAULT 'sticker'); CREATE TABLE IF NOT EXISTS custom_emojis(id INTEGER PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),file TEXT NOT NULL,animated INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);");
export const subscribed=u=>!!u?.sub_tier&&u.sub_until>now();
export const animatedAllowed=u=>subscribed(u)&&['premium','max'].includes(u.sub_tier);
export function studioBot(){
 let u=q("SELECT * FROM users WHERE google_sub='bot:sticker-studio'").get();if(u)return u;
 return tx(()=>{const username=q("SELECT 1 FROM users WHERE username='LimoStickerBot'").get()||q("SELECT 1 FROM chats WHERE username='LimoStickerBot'").get()?null:'LimoStickerBot';const r=q("INSERT INTO users(google_sub,email,username,name,bio,verified,coins,created_at,last_seen) VALUES('bot:sticker-studio','',?,'Студия стикеров и эмодзи','Официальная студия Limochat',1,0,?,?)").run(username,now(),now());const id=Number(r.lastInsertRowid);q("INSERT INTO bots(user_id,owner_id,token_hash,commands,created_at) VALUES(?,?,?,?,?)").run(id,id,crypto.randomBytes(32).toString('hex'),JSON.stringify([{command:'new',description:'Набор стикеров: /new Название'},{command:'emoji',description:'Создать эмодзи'},{command:'packs',description:'Мои наборы'}]),now());return q('SELECT * FROM users WHERE id=?').get(id);});
}
export function handleStudio(botId,chatId,msg,helpers){
 const b=q('SELECT google_sub FROM users WHERE id=?').get(botId);if(b?.google_sub!=='bot:sticker-studio')return false;
 const chat=q('SELECT type FROM chats WHERE id=?').get(chatId);if(chat?.type!=='private')return true;
 const user=q('SELECT * FROM users WHERE id=?').get(msg.sender_id);if(!user||user.id===botId)return true;
 const say=text=>helpers.postMessage(chatId,botId,{kind:'text',text});
 const text=String(msg.text||'').trim();
 if(text==='/start'||text==='/help'){say('Студия стикеров и эмодзи.\n/new Название — новый набор стикеров\n/emoji — режим создания эмодзи\n/packs — ваши наборы\nОтправьте картинку после выбора режима. Создание доступно с Plus; анимация — с Premium и Max. Обычные эмодзи остаются бесплатными.');return true;}
 if(text==='/packs'){const rows=q('SELECT id,title,slug FROM sticker_packs WHERE owner_id=?').all(user.id);say(rows.length?rows.map(p=>p.title+' · /use '+p.id+' — '+config.appOrigin+'/addstickers/'+p.slug).join('\n').slice(0,4000):'Наборов ещё нет. /new Название');return true;}
 if(!subscribed(user)){say('Для создания нужен Plus, Premium или Max. Откройте Подписки в меню.');return true;}
 if(text.startsWith('/new ')){const title=text.slice(5).trim().slice(0,48);if(!title)return true;if(q('SELECT COUNT(*) AS n FROM sticker_packs WHERE owner_id=?').get(user.id).n>=20){say('Лимит: 20 наборов.');return true;}
 const pid=tx(()=>{const r=q('INSERT INTO sticker_packs(owner_id,title,slug,created_at) VALUES(?,?,?,?)').run(user.id,title,crypto.randomBytes(6).toString('base64url'),now());const id=Number(r.lastInsertRowid);q('INSERT INTO user_sticker_packs VALUES(?,?,?)').run(user.id,id,now());return id;});
 q("INSERT INTO studio_sessions VALUES(?,?,'sticker') ON CONFLICT(user_id) DO UPDATE SET pack_id=excluded.pack_id,mode='sticker'").run(user.id,pid);say('Набор создан. Отправьте PNG, JPG, WebP или GIF до 1 МБ.');return true;}
 if(text.startsWith('/use ')){const id=Number(text.slice(5));if(!Number.isSafeInteger(id)||!q('SELECT 1 FROM sticker_packs WHERE id=? AND owner_id=?').get(id,user.id)){say('Набор не найден. /packs — ваши наборы.');return true;}q("INSERT INTO studio_sessions VALUES(?,?,'sticker') ON CONFLICT(user_id) DO UPDATE SET pack_id=excluded.pack_id,mode='sticker'").run(user.id,id);say('Набор выбран. Отправьте картинку.');return true;}
 if(text==='/emoji'){q("INSERT INTO studio_sessions VALUES(?,NULL,'emoji') ON CONFLICT(user_id) DO UPDATE SET mode='emoji'").run(user.id);say('Отправьте картинку до 1 МБ. Для анимированной картинки нужен Premium или Max.');return true;}
 if(!msg.file){say('Начните с /new Название или /emoji.');return true;}
 const session=q('SELECT * FROM studio_sessions WHERE user_id=?').get(user.id);if(!session){say('Сначала выберите /new Название или /emoji.');return true;}
 const media=q('SELECT * FROM media WHERE name=? AND owner_id=? AND chat_id=?').get(msg.file,user.id,chatId);if(!media||media.size>1024*1024){say('Нужна картинка размером до 1 МБ.');return true;}
 const buffer=fs.readFileSync(path.join(config.dataDir,'media',media.name));const animated=buffer.subarray(0,3).toString()==='GIF'||buffer.includes(Buffer.from('ANIM'))||buffer.includes(Buffer.from('acTL'));
 if(animated&&!animatedAllowed(user)){say('Анимированные эмодзи и стикеры доступны с Premium или Max.');return true;}
 if(session.mode==='emoji'&&q('SELECT COUNT(*) AS n FROM custom_emojis WHERE owner_id=?').get(user.id).n>=120){say('Лимит: 120 эмодзи.');return true;}
 if(session.mode==='sticker'&&(!q('SELECT 1 FROM sticker_packs WHERE id=? AND owner_id=?').get(session.pack_id,user.id)||q('SELECT COUNT(*) AS n FROM stickers WHERE pack_id=?').get(session.pack_id).n>=120)){say('Набор недоступен или заполнен. Создайте новый.');return true;}
 let img;try{img=saveImage({buffer},{ownerId:user.id,kind:'avatar',maxBytes:1024*1024});}catch{say('Не удалось прочитать картинку. Используйте PNG, JPG, WebP или GIF.');return true;}
 if(session.mode==='emoji'){const r=q('INSERT INTO custom_emojis(owner_id,file,animated,created_at) VALUES(?,?,?,?)').run(user.id,img.name,Number(animated),now());say('Эмодзи готов! Вставьте этот код в сообщение: [e:'+r.lastInsertRowid+']');}
 else{q('INSERT INTO stickers(pack_id,file,emoji,pos,created_at) VALUES(?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM stickers WHERE pack_id=?),?)').run(session.pack_id,img.name,'🙂',session.pack_id,now());const p=q('SELECT slug FROM sticker_packs WHERE id=?').get(session.pack_id);say('Стикер добавлен! '+config.appOrigin+'/addstickers/'+p.slug+'\nОтправьте ещё картинку или /emoji.');}
 return true;
}
export function registerStudio(api,{publicUser}){
 api.post('/studio/bot',(req,res)=>res.json({user:publicUser(studioBot())}));
 api.get('/studio/emojis',(req,res)=>res.json({emojis:q('SELECT id,animated FROM custom_emojis WHERE owner_id=? ORDER BY id DESC LIMIT 120').all(req.user.id)}));
 api.get('/studio/emojis/:id',(req,res)=>{const row=q('SELECT file FROM custom_emojis WHERE id=?').get(Number(req.params.id)||0);if(!row)return res.status(404).end();res.redirect('/media/'+row.file);});
}
