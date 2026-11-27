import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {t,setLanguage,translations,betaError} from '../public/js/beta-i18n.js';
import {emptyChatCopy} from '../beta/assets/empty-copy.js';
test('English localizes all empty chat variants and Russian can be restored',()=>{
 try{setLanguage('en');assert.equal(t('Чаты'),'Chats');assert.equal(t('Вы вошли как {name}. Введите приглашение, чтобы продолжить.',{name:'Чаты'}),'Signed in as Чаты. Enter your invitation code to continue.');
 for(const chat of [...Array.from({length:12},(_,id)=>({id,type:'private'})),{type:'saved'},{type:'group'},{type:'channel',canPost:false},{peer:{bot:true}},{blocked:'me'}])for(const text of Object.values(emptyChatCopy(chat,t)))assert.doesNotMatch(text,/[А-Яа-яЁё]/);
 assert.match(betaError({code:'unauthorized'}),/session expired/);
 setLanguage('ru');assert.equal(t('Чаты'),'Чаты');assert.equal(t('not-a-key'),'not-a-key');}finally{setLanguage('ru');}
});
test('language survives reload, updates document language and tolerates blocked storage',()=>{
 const source=fs.readFileSync(new URL('../public/js/beta-i18n.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');const saved=new Map();const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 function load(localStorage=storage){const document={documentElement:{lang:''}},ctx=vm.createContext({localStorage,document,errorText:()=>''});vm.runInContext(source+';globalThis.lang={getLanguage,setLanguage,t};',ctx);return {document,lang:ctx.lang};}
 const first=load();first.lang.setLanguage('en');assert.equal(first.document.documentElement.lang,'en');const second=load();assert.equal(second.lang.getLanguage(),'en');assert.equal(second.lang.t('Профиль'),'Profile');second.lang.setLanguage('invalid');assert.equal(second.lang.getLanguage(),'ru');
 const blocked=load({getItem(){throw Error();},setItem(){throw Error();}});assert.doesNotThrow(()=>blocked.lang.setLanguage('en'));assert.equal(blocked.lang.t('Сохранить'),'Save');
});
test('every explicit interface translation has an English catalog entry',()=>{
 for(const path of ['beta/assets/app.js','beta/assets/profiles.js','public/js/calls.js','public/js/beta-gate.js']){
  const source=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
  for(const match of source.matchAll(/\b(?:t|tr)\((["'])([^"'\n]*[А-Яа-яЁё][^"'\n]*)\1/g))assert.ok(Object.hasOwn(translations,match[2]),path+': '+match[2]);
 }
});
