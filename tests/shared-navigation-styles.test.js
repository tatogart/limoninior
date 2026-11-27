import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('menu and chat footer styles ship in the established app stylesheet for already-open shells',()=>{
 const main=fs.readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8'),compat=fs.readFileSync(new URL('../public/css/navigation.css',import.meta.url),'utf8'),index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.ok(main.includes(compat.trim()));assert.match(index,/href="\/css\/app.css"/);assert.doesNotMatch(index,/href="\/css\/navigation.css"/);
 assert.match(main,/\.tools-group-list>\.tools-row\s*\{[^}]*display:flex/);assert.match(main,/\.chat-footer\s*\{[^}]*display:flex/);
});
