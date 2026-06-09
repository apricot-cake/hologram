'use strict';

/* Theme (light / dark).
   Applied as early as possible from a localStorage cache so there's no flash of
   the wrong theme on launch, then reconciled with config.json (the source of
   truth) over IPC. The toggle lives in the sidebar brand bar and works in both
   post- and image-view (the sidebar is shared).

   This is an external file because the page CSP is `script-src 'self'` — inline
   <script> would be blocked. Loaded in <head> with no defer so it runs during
   parse, before the body paints. */
(function () {
  var KEY = 'corpus-theme';
  var clean = function (t) { return t === 'dark' ? 'dark' : 'light'; };

  function apply(theme) {
    theme = clean(theme);
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    // The control now lives in Settings → 外観 (a dark-theme switch).
    var box = document.getElementById('themeDarkToggle');
    if (box) box.checked = (theme === 'dark');
    return theme;
  }

  function get() {
    var t = document.documentElement.getAttribute('data-theme');
    if (!t) { try { t = localStorage.getItem(KEY); } catch (e) { t = null; } }
    return clean(t);
  }

  function set(theme, persist) {
    theme = apply(theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
    if (persist !== false && window.corpus && window.corpus.setPref) {
      try { window.corpus.setPref('theme', theme); } catch (e) { /* ignore */ }
    }
    return theme;
  }

  function toggle() { return set(get() === 'dark' ? 'light' : 'dark'); }

  // 1) Apply immediately (runs during <head> parse → no flash). main.js passes
  //    the config theme as ?theme= so the very first paint is correct even on a
  //    fresh profile with no cache; fall back to the localStorage cache.
  var initial = null;
  try { initial = new URLSearchParams(location.search).get('theme'); } catch (e) { /* ignore */ }
  if (!initial) { try { initial = localStorage.getItem(KEY); } catch (e) { /* ignore */ } }
  apply(initial || 'light');
  if (initial) { try { localStorage.setItem(KEY, clean(initial)); } catch (e) { /* ignore */ } }

  window.corpusTheme = { apply: apply, get: get, set: set, toggle: toggle };

  // 2) Wire the toggle button + reconcile with config once DOM/IPC are ready.
  function init() {
    var box = document.getElementById('themeDarkToggle');
    if (box && !box._wired) {
      box._wired = true;
      box.addEventListener('change', function () { set(box.checked ? 'dark' : 'light'); });
    }
    apply(get());   // sync the switch now that it exists

    if (window.corpus && window.corpus.getPrefs) {
      window.corpus.getPrefs().then(function (p) {
        if (!p || !p.theme) return;
        // config.json is the source of truth: sync the cache + UI if they differ.
        if (clean(p.theme) !== get()) set(p.theme, false);
        try { localStorage.setItem(KEY, clean(p.theme)); } catch (e) { /* ignore */ }
      }).catch(function () { /* ignore */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
