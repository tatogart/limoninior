// Pure helpers shared by the UI and regression tests.
export function chatMatches(chat, scope, state, drafts = new Map()) {
 const prefs=state.chats?.find(p=>p.chatId===chat.id)||{};
 if(scope==='archive')return !!prefs.archived;
 if(prefs.archived)return false;
 if(scope==='unread')return !!chat.unread||!!prefs.unread;
 if(scope==='drafts')return !!drafts.get(chat.id)?.trim();
 if(scope==='private')return chat.type==='private';
 if(scope==='groups')return chat.type==='group';
 if(scope==='channels')return chat.type==='channel';
 if(scope.startsWith('folder:'))return !!state.folders?.find(f=>f.id===Number(scope.slice(7)))?.chatIds.includes(chat.id);
 return true;
}
export function exportTranscript(messages, title, format) {
 const ordered=[...messages].sort((a,b)=>a.id-b.id);
 const safe=ordered.map(m=>({id:m.id,date:new Date(m.createdAt).toISOString(),author:m.senderName||'Система',kind:m.kind,text:m.text||'',file:m.file||null,replyTo:m.replyTo?.id||null}));
 if(format==='json')return JSON.stringify({format:'limochat-transcript-v1',chat:title,messages:safe},null,2);
 return `${title}\nЭкспорт Limochat · ${safe.length} сообщений\nВложения указаны ссылками и доступны только участникам чата.\n\n`+
  safe.map(m=>`[${m.date}] ${m.author} · ${m.kind}\n${m.text}${m.file?'\nВложение: '+m.file:''}`).join('\n\n');
}
export function localDateRange(from,to){
 const stamp=(s)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('date');const d=new Date(s+'T00:00:00');if(!Number.isFinite(+d))throw Error('date');return d;};
 const range={};if(from)range.from=+stamp(from);
 if(to){const end=stamp(to);end.setDate(end.getDate()+1);range.to=+end;}
 if(range.from!=null&&range.to!=null&&range.from>=range.to)throw Error('date');
 return range;
}
export function rankChats(chats, query, titleOf) {
 const term=query.trim().normalize('NFKC').toLowerCase();
 return chats.filter(c=>!term||`${titleOf(c)} ${c.peer?.username||''}`.normalize('NFKC').toLowerCase().includes(term))
  .sort((a,b)=>Number(titleOf(b).toLowerCase().startsWith(term))-Number(titleOf(a).toLowerCase().startsWith(term))||(b.pinnedAt||0)-(a.pinnedAt||0)||(b.lastMessage?.id||0)-(a.lastMessage?.id||0));
}
