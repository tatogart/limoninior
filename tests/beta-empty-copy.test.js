import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyChatCopy} from '../beta/assets/empty-copy.js';
test('private greetings vary by chat and remain stable across refreshes',()=>{
 const titles=new Set();for(let id=1;id<=12;id++){const chat={id,type:'private'};const copy=emptyChatCopy(chat);assert.deepEqual(copy,emptyChatCopy(chat));assert.ok(copy.text&&copy.list);titles.add(copy.title);}assert.equal(titles.size,12);
});
test('empty-state text respects chat purpose and posting restrictions',()=>{
 assert.match(emptyChatCopy({type:'saved'}).text,/для себя/);
 assert.match(emptyChatCopy({type:'private',peer:{bot:true}}).text,/\/start/);
 assert.match(emptyChatCopy({type:'channel',canPost:false}).text,/появятся/);
 assert.match(emptyChatCopy({type:'group',canPost:false}).text,/появятся/);
 assert.match(emptyChatCopy({type:'private',blocked:'me'}).text,/недоступна/);
 assert.match(emptyChatCopy({type:'private',canPost:false}).text,/недоступна/);
});
