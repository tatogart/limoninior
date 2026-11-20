import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildClient, assetUrl } from '../scripts/build-client.mjs';
import { clientNeedsUpdate, allowAutomaticReload } from '../public/js/client-update.js';

test('a stale client is detected even when both config fetches return the same git version', () => {
  const cfg = { version: '6e4c590', clientBuild: 'bbbbbbbbbbbbbbbb' };
  assert.equal(clientNeedsUpdate(cfg, 'aaaaaaaaaaaaaaaa', '6e4c590'), true);
  assert.equal(clientNeedsUpdate(cfg, 'bbbbbbbbbbbbbbbb', 'older label'), false);
  assert.equal(clientNeedsUpdate({ version: 'next' }, 'dev', 'old'), true);
  assert.equal(clientNeedsUpdate({ version: 'same' }, 'dev', 'same'), false);
  assert.equal(clientNeedsUpdate(null, 'dev', 'same'), false);
});

test('automatic reload happens once per build transition and blocked storage is safe', () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(allowAutomaticReload('old', 'new', storage), true);
  assert.equal(allowAutomaticReload('old', 'new', storage), false);
  assert.equal(allowAutomaticReload('new', 'newer', storage), true);
  assert.equal(allowAutomaticReload('old', 'new', { getItem() { throw Error('blocked'); } }), false);
});

test('versioned URLs preserve existing parameters and fragments and leave external scripts alone', () => {
  const id = '0123456789abcdef';
  assert.equal(assetUrl('./ui.js', id), `./ui.js?v=${id}`);
  assert.equal(assetUrl('/js/ui.js?locale=ru#test', id), `/js/ui.js?locale=ru&v=${id}#test`);
  assert.equal(assetUrl('https://accounts.google.com/gsi/client', id), 'https://accounts.google.com/gsi/client');
  assert.equal(assetUrl('//cdn.example.com/a.js', id), '//cdn.example.com/a.js');
  assert.equal(assetUrl('/icons/icon.svg', id), '/icons/icon.svg');
});

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'limo-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pub = path.join(root, 'public');
  fs.mkdirSync(path.join(pub, 'js'), { recursive: true });
  fs.mkdirSync(path.join(pub, 'css'));
  fs.writeFileSync(path.join(root, 'VERSION'), '6e4c590');
  fs.writeFileSync(path.join(pub, 'index.html'), '<link rel="stylesheet" href="/css/app.css"><script type="module" src="/js/app.js"></script>');
  fs.writeFileSync(path.join(pub, 'js/app.js'), "import { CLIENT_BUILD } from './client-build.js';\nimport { value } from './ui.js?locale=ru';\nexport const view = value;\n");
  fs.writeFileSync(path.join(pub, 'js/ui.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(pub, 'css/app.css'), 'body { color: green; }');
  fs.writeFileSync(path.join(pub, 'sw.js'), "const VERSION = 'v40';\nconst ASSETS = ['/', '/js/app.js', '/js/ui.js', '/js/client-build.js', '/css/app.css'];\n");
  return { root, pub, read: name => fs.readFileSync(path.join(pub, name), 'utf8') };
}

test('one build fingerprints entrypoints, nested modules, CSS and service worker together', (t) => {
  const { pub, read } = project(t);
  const result = buildClient(pub);
  assert.match(result.id, /^[a-f0-9]{16}$/);
  assert.ok(read('index.html').includes(`/js/app.js?v=${result.id}`));
  assert.ok(read('index.html').includes(`/css/app.css?v=${result.id}`));
  assert.ok(read('js/app.js').includes(`./client-build.js?v=${result.id}`));
  assert.ok(read('js/app.js').includes(`./ui.js?locale=ru&v=${result.id}`));
  assert.ok(read('sw.js').includes(`v40-${result.id}`));
  assert.ok(read('sw.js').includes(`/js/app.js?v=${result.id}`));
  assert.ok(read('js/client-build.js').includes(result.id));
  assert.ok(read('js/client-build.js').includes('6e4c590'));
  assert.deepEqual(JSON.parse(read('client-build.json')), result);
  for (const file of ['js/app.js', 'js/client-build.js', 'sw.js']) {
    assert.equal(spawnSync(process.execPath, ['--check', path.join(pub, file)]).status, 0);
  }
});

test('rebuilding is deterministic and a same-size code change changes the hash', (t) => {
  const { pub, read } = project(t);
  const first = buildClient(pub);
  const original = read('js/app.js');
  const second = buildClient(pub);
  assert.equal(first.id, second.id);
  assert.equal(read('js/app.js'), original);
  const file = path.join(pub, 'js/ui.js');
  const stat = fs.statSync(file);
  fs.writeFileSync(file, 'export const value = 2;\n');
  fs.utimesSync(file, stat.atime, stat.mtime);
  const third = buildClient(pub);
  assert.notEqual(first.id, third.id);
  assert.equal(buildClient(pub).id, third.id);
});
