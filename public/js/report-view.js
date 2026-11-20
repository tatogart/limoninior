const REASONS={spam:'Спам или реклама',scam:'Мошенничество',abuse:'Оскорбления и травля',nsfw:'Непристойный контент',violence:'Насилие и угрозы',fake:'Выдаёт себя за другого',other:'Другое'};
const TYPES={text:'Текстовое сообщение',image:'Фото',file:'Файл',voice:'Голосовое сообщение',video:'Видео',sticker:'Стикер',gift:'Подарок',call:'Звонок'};
const timestamp=v=>Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=8640000000000000?Number(v):null;
const text=v=>typeof v==='string'?v:'';
export function reportView(report){
 let s=report.snapshot;try{if(typeof s==='string')s=JSON.parse(s);}catch{s=null;}if(!s||typeof s!=='object'||Array.isArray(s))s={};
 const sender=s.sender&&typeof s.sender==='object'?s.sender:report.target_type==='user'?s:{};
 const author=[text(sender.name),sender.username?'@'+text(sender.username):''].filter(Boolean).join(' · ');
 const chat=({private:'Личная переписка',saved:'Избранное',group:'Группа',channel:'Канал'})[s.chatType||s.type]||({user:'Профиль пользователя',anon:'Анонимное сообщение',community:'Сообщество'})[report.target_type]||'Сообщение';
 const file=typeof s.file==='string'&&/^\/media\/[a-zA-Z0-9_./-]+$/.test(s.file)&&!s.file.split('/').includes('..')?s.file:null;
 return {reason:REASONS[report.reason]||REASONS.other,author,context:chat+(s.chatTitle||s.title?' · '+text(s.chatTitle||s.title):''),kind:TYPES[s.kind]||'Сообщение',text:text(s.text)||text(s.bio)||text(s.description),file,at:timestamp(s.at),createdAt:timestamp(report.created_at)};
}
