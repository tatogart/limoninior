import test from 'node:test';
import assert from 'node:assert/strict';
import {chatMatches,exportTranscript,localDateRange,rankChats} from '../public/js/workspace-model.js';
const state={chats:[{chatId:1,archived:1},{chatId:2,unread:1}],folders:[{id:5,chatIds:[1,2]}]};
test('archive stays out of regular folders; unread includes manual flags; drafts filter whitespace',()=>{
 assert.equal(chatMatches({id:1},'all',state),false);assert.equal(chatMatches({id:1},'archive',state),true);
 assert.equal(chatMatches({id:1},'folder:5',state),false);assert.equal(chatMatches({id:2},'folder:5',state),true);
 assert.equal(chatMatches({id:2},'unread',state),true);assert.equal(chatMatches({id:3,unread:3},'unread',state),true);
 assert.equal(chatMatches({id:3},'drafts',state,new Map([[3,'  ']])),false);
 assert.equal(chatMatches({id:3},'drafts',state,new Map([[3,'Текст']])),true);
});
test('exports are chronological, valid JSON, plain text and contain no private workspace data',()=>{
 const messages=[{id:2,createdAt:2000,senderName:'<script>',kind:'file',text:'B',file:'/media/test',note:'SECRET'},{id:1,createdAt:1000,text:'A',kind:'text'}];
 const json=JSON.parse(exportTranscript(messages,'Тест','json'));assert.deepEqual(json.messages.map(m=>m.id),[1,2]);
 assert.equal(json.messages[1].author,'<script>');assert.ok(!JSON.stringify(json).includes('SECRET'));
 const text=exportTranscript(messages,'Тест','txt');assert.ok(text.indexOf('A')<text.indexOf('B'));assert.ok(text.includes('/media/test'));
});
test('date filters include the entire last local day and reject inverted ranges',()=>{
 const r=localDateRange('2026-11-10','2026-11-11');assert.equal(r.from,+new Date('2026-11-10T00:00:00'));assert.equal(r.to,+new Date('2026-11-12T00:00:00'));
 assert.throws(()=>localDateRange('2026-11-12','2026-11-10'));assert.throws(()=>localDateRange('bad',''));
});
test('quick switch finds Cyrillic titles and usernames and prioritises prefix matches',()=>{
 const chats=[{id:1,title:'Мой рабочий',lastMessage:{id:10}},{id:2,title:'Рабочий',peer:{username:'seek'}}];
 assert.equal(rankChats(chats,'рабочий',c=>c.title)[0].id,2);assert.equal(rankChats(chats,'SEEK',c=>c.title)[0].id,2);
});
