import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const GENERATED = 'js/client-build.js';
const LOCAL_ASSET = /^(?:\.{0,2}\/|[a-zA-Z0-9_-])[^:]*\.(?:js|css)(?:\?[^#]*)?(?:#.*)?$/;

export function assetUrl(specifier, id) {
  if (!LOCAL_ASSET.test(specifier) || specifier.startsWith('//')) return specifier;
  const [beforeHash, fragment] = specifier.split('#', 2);
  const [file, query = ''] = beforeHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('v', id);
  return `${file}?${params}${fragment === undefined ? '' : `#${fragment}`}`;
}

function normalize(source) {
  const clean = source.replace(/(['"])([^'"\n]+\.(?:js|css)(?:\?[^'"\n]*)?(?:#[^'"\n]*)?)\1/g, (match, quote, specifier) => {
    if (!LOCAL_ASSET.test(specifier) || specifier.startsWith('//')) return match;
    const [beforeHash, fragment] = specifier.split('#', 2);
    const [file, query = ''] = beforeHash.split('?', 2);
    const params = new URLSearchParams(query);
    if (!/^[a-f0-9]{16}$/.test(params.get('v') || '')) return match;
    params.delete('v');
    return quote + file + (params.size ? `?${params}` : '') + (fragment === undefined ? '' : `#${fragment}`) + quote;
  });
  return clean.replace(/const VERSION = '([^']+?)-[a-f0-9]{16}';/, "const VERSION = '$1';");
}

/** Build only the installed copy. Source checkout and persistent user data stay untouched. */
export function buildClient(publicDir) {
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && /\.(js|css|html|webmanifest)$/.test(item.name)) files.push(full);
    }
  }
  walk(publicDir);
  const sources = files.filter(full => path.relative(publicDir, full).split(path.sep).join('/') !== GENERATED)
    .map(full => ({ full, relative: path.relative(publicDir, full).split(path.sep).join('/'), content: normalize(fs.readFileSync(full, 'utf8')) }));
  const hash = crypto.createHash('sha256');
  for (const source of sources) hash.update(source.relative).update('\0').update(source.content).update('\0');
  const id = hash.digest('hex').slice(0, 16);
  let version = '';
  try { version = fs.readFileSync(path.join(publicDir, '..', 'VERSION'), 'utf8').trim(); } catch { /* development */ }
  for (const source of sources) {
    let content = source.content;
    if (source.relative.endsWith('.js')) {
      content = content.replace(/(\bfrom\s*['"]|\bimport\s*['"]|\bimport\s*\(\s*['"])([^'"\n]+)(['"])/g,
        (_, before, specifier, after) => before + assetUrl(specifier, id) + after);
    }
    if (source.relative.endsWith('.html')) {
      content = content.replace(/(\b(?:src|href)\s*=\s*['"])([^'"]+)(['"])/g,
        (_, before, url, after) => before + assetUrl(url, id) + after);
    }
    if (source.relative === 'sw.js') {
      content = content.replace(/const VERSION = '([^']+)';/, (_, base) => `const VERSION = '${base}-${id}';`);
      content = content.replace(/(['"])(\/(?:js|css|vendor)\/[^'"]+)\1/g, (_, quote, url) => quote + assetUrl(url, id) + quote);
    }
    fs.writeFileSync(source.full, content);
  }
  fs.mkdirSync(path.join(publicDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, GENERATED), `export const CLIENT_BUILD = ${JSON.stringify(id)};\nexport const CLIENT_VERSION = ${JSON.stringify(version)};\n`);
  fs.writeFileSync(path.join(publicDir, 'client-build.json'), JSON.stringify({ id, version }) + '\n');
  return { id, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'));
  console.log(JSON.stringify(buildClient(root)));
}
