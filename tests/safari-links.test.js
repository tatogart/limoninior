import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/js/ui.js',import.meta.url),'utf8');
test('link parsing does not require lookbehind and does not turn email fragments into links',()=>{
 assert.ok(!source.includes('(?<!'));const constants=source.slice(source.indexOf('const TLDS ='),source.indexOf('const SHORTENERS ='));
 const start=source.indexOf('export function richText('),fn=source.slice(start,source.indexOf('\n}\n',start)+2).replace('export ','');
 const ctx=vm.createContext({URL,linkRisk:()=>({level:null,reasons:[]}),h:(tag,props,...children)=>({tag,props,children})});vm.runInContext(constants+fn+';globalThis.render=richText;',ctx);
 const parts=ctx.render('Почта user@example.com, ссылка example.com и https://openai.com.');const links=parts.filter(p=>p?.tag==='a');assert.equal(links.length,2);assert.equal(links[0].props.href,'https://example.com/');assert.ok(parts.some(p=>typeof p==='string'&&p.includes('user@example.com')));
});
