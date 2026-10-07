// Applied before first paint to avoid a theme flash.
(function () {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('limoninior.settings') || '{}'); } catch (e) { /* storage unavailable */ }
  var theme = s.theme || 'system';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = s.accent || 'lime';
})();
