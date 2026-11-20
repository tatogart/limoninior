// Applied before first paint to avoid a theme flash.
(function () {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('limoninior.settings') || '{}'); } catch (e) { /* storage unavailable */ }
  var theme = s.theme || 'system';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (s.themeId && s.themeBase && location.pathname.indexOf('/admin') !== 0) theme = s.themeBase; // a custom theme decides light/dark
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = s.accent || 'blue';
  // "Liquid Glass" is the default look; "classic" is the flat one.
  document.documentElement.dataset.style = s.style || 'glass';
  document.documentElement.dataset.wallpaper = s.wallpaper || 'auto';
  document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  document.documentElement.style.setProperty('--msg-size', (s.textSize || 15.5) + 'px');
})();

// Follow the visible viewport in browsers that resize only the visual viewport and those
// that resize the layout too. Never fight Safari's focus panning with scrollTo().
(function () {
  var vv = window.visualViewport;
  var root = document.documentElement;
  var raf = 0, settle = 0;
  var baseline = window.innerHeight, lastWidth = window.innerWidth;
  function editing() {
    var el = document.activeElement;
    return !!el && !el.disabled && !el.readOnly && (el.isContentEditable ||
      el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|file|color|hidden)$/i.test(el.type));
  }
  function fit() {
    raf = 0;
    // Keep normal pinch-to-zoom behaviour; don't reflow the app around a magnified area.
    if (vv && Math.abs(vv.scale - 1) > 0.01) return;
    var height = vv ? vv.height : window.innerHeight;
    if (!isFinite(height) || height <= 0) return;
    var top = vv ? Math.max(0, vv.offsetTop || 0) : 0;
    if (Math.abs(window.innerWidth - lastWidth) > 80) baseline = window.innerHeight;
    lastWidth = window.innerWidth;
    var focused = editing();
    baseline = focused ? Math.max(baseline, window.innerHeight, height) : Math.max(window.innerHeight, height);
    root.style.setProperty('--app-h', Math.round(height) + 'px');
    root.style.setProperty('--app-top', Math.round(top) + 'px');
    root.dataset.keyboard = focused && baseline - height > 100 ? 'open' : 'closed';
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(fit); }
  function focusChanged() {
    schedule();
    clearTimeout(settle);
    settle = setTimeout(schedule, 300);
  }
  fit();
  if (vv) { vv.addEventListener('resize', schedule); vv.addEventListener('scroll', schedule); }
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('orientationchange', focusChanged);
  document.addEventListener('focusin', focusChanged);
  document.addEventListener('focusout', focusChanged);
})();
