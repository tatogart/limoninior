// Applied before first paint to avoid a theme flash.
(function () {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('limoninior.settings') || '{}'); } catch (e) { /* storage unavailable */ }
  var theme = s.theme || 'system';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = s.accent || 'lime';
  // "Liquid Glass" is the default look; "classic" is the flat one.
  document.documentElement.dataset.style = s.style || 'glass';
  document.documentElement.dataset.wallpaper = s.wallpaper || 'auto';
  document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  document.documentElement.style.setProperty('--msg-size', (s.textSize || 15.5) + 'px');
})();

// Keyboard handling. Android (interactive-widget=resizes-content) shrinks the layout itself, so the
// fixed #app follows the keyboard natively in the same frame. iOS only shrinks the visual viewport:
// there we size #app from it by hand.
(function () {
  var vv = window.visualViewport;
  var root = document.documentElement;
  var raf = 0;
  function fit() {
    raf = 0;
    if (!vv) return;
    var overlay = window.innerHeight - vv.height > 1 && Math.abs(vv.scale - 1) < 0.01;
    if (overlay) root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
    else root.style.removeProperty('--app-h');
    if (vv.offsetTop) window.scrollTo(0, 0);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(fit); }
  fit();
  if (vv) { vv.addEventListener('resize', schedule); vv.addEventListener('scroll', schedule); }
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
