import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(settings) {
  const vars = new Map();
  const root = { dataset: { theme: 'light' }, style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k) } };
  const h = (tag, props = {}, ...children) => ({ tag, props, children: children.flat().filter(Boolean), replaceChildren(...nodes) { this.children = nodes.map((n) => n && typeof n === 'object' ? n : String(n)); } });
  const document = { documentElement: root, querySelectorAll: () => [], querySelector: () => null };
  let modal;
  const load = (file, names) => {
    const src = fs.readFileSync(new URL('../public/js/' + file, import.meta.url), 'utf8')
      .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];[ \t]*$/gm, '')
      .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '');
    return vm.runInNewContext(`(() => { ${src}; return { ${names} }; })()`, {
      document, h, icon: () => null, openModal: (m) => { modal = m; }, selectedEffect: () => 'none',
    });
  };
  const custom = load('custom.js', 'initCustom, applyCustomLook');
  const themes = load('themes.js', 'initThemes, applyCustomTheme, winterSettings, themesModal');
  const state = { settings };
  custom.initCustom(state);
  themes.initThemes(state, () => { themes.applyCustomTheme(root); custom.applyCustomLook(root); });
  return { root, vars, themes, custom, get modal() { return modal; } };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) { const result = find(child, predicate); if (result) return result; }
  return null;
}

test('winter palette replaces a manual incoming colour and Standard restores it', () => {
  const settings = { bubbleIn: '#3f1d2e' };
  const f = fixture(settings);
  assert.equal(f.vars.get('--bubble-in'), '#3f1d2e');
  const controls = f.themes.winterSettings();
  assert.ok(!controls.children.includes('null'));
  find(controls, (n) => n.tag === 'button').props.onclick();
  assert.equal(settings.themeId, 'winter');
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.vars.has('--bubble-in'), false);
  assert.equal(f.vars.has('--text-in'), false);
  assert.equal(settings.bubbleIn, '#3f1d2e');
  settings.themeId = null;
  f.themes.applyCustomTheme(f.root);
  f.custom.applyCustomLook(f.root);
  assert.equal(f.vars.get('--bubble-in'), '#3f1d2e');
  assert.equal(f.vars.get('--text-in'), '#f5f7f9');
});
test('direct settings snow switch preserves the chosen theme and manual colours', () => {
  const settings = { themeId: 'space', bubbleIn: '#3f1d2e', themeFx: false };
  const f = fixture(settings);
  const controls = f.themes.winterSettings();
  find(controls, (n) => n.tag === 'input').props.onchange({ target: { checked: true } });
  assert.equal(settings.snowflakes, true);
  assert.equal(settings.themeFx, true);
  assert.equal(settings.themeId, 'space');
  find(controls, (n) => n.tag === 'input').props.onchange({ target: { checked: false } });
  assert.equal(settings.snowflakes, false);
  assert.equal(settings.bubbleIn, '#3f1d2e');
});
test('snow controls are outside the theme gallery', () => {
  const f = fixture({});
  f.themes.themesModal();
  assert.equal(find(f.modal.body, (n) => n.props?.class === 'winter-feature'), null);
  assert.equal(find(f.modal.body, (n) => n.props?.class === 'th-fx-toggle')?.children.some((n) => typeof n === 'string' && n.includes('Анимированные эффекты')), true);
});
