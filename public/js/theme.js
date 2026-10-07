// Applied before first paint to avoid a theme flash.
(function () {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('limoninior.settings') || '{}'); } catch (e) { /* storage unavailable */ }
  var theme = s.theme || 'system';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = s.accent || 'lime';
})();

// Track the real visible height (keyboard, browser bars) for the app container.
(function () {
  var vv = window.visualViewport;
  function fit() {
    var h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
    if (vv && vv.offsetTop) window.scrollTo(0, 0);
  }
  fit();
  (vv || window).addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
