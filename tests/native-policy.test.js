import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {trusted,external}=require('../native/desktop/policy.cjs');
test('native desktop permits only exact application origin inside its window',()=>{
 assert.ok(trusted('https://81-90-31-167.sslip.io/chats'));assert.ok(trusted('https://81-90-31-167.sslip.io:443/'));
 for(const url of ['http://81-90-31-167.sslip.io','https://81-90-31-167.sslip.io.attacker.test','https://81-90-31-167.sslip.io:444','https://user:password@81-90-31-167.sslip.io','file:///C:/Windows','javascript:alert(1)'])assert.equal(trusted(url),false,url);
});
test('external links never launch file, executable or custom schemes',()=>{
 assert.ok(external('https://example.org/'));assert.ok(external('mailto:user@example.org'));
 for(const url of ['file:///C:/Windows','cmd.exe','powershell:run','javascript:alert(1)','data:text/html,x'])assert.equal(external(url),false,url);
});
