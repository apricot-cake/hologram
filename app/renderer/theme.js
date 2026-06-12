'use strict';

/* Theme: auto (follow the OS) / light / dark.
   We store the PREF (auto/light/dark); the APPLIED value (light/dark) is resolved
   from it — 'auto' tracks the OS via prefers-color-scheme. Applied as early as
   possible from main's ?theme= query (no flash), reconciled with config.json over
   IPC. The control lives in Settings → 外観 (a 3-way select).
   External file because the page CSP is `script-src 'self'`. */
(function () {
  var KEY = 'corpus-theme';
  var mql = null;
  try { mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mql = null; }
  var pref = 'auto';   // auto | light | dark

  function cleanPref(t) { return (t === 'light' || t === 'dark') ? t : 'auto'; }
  function systemDark() { return !!(mql && mql.matches); }
  function resolve(p) { p = cleanPref(p); return p === 'auto' ? (systemDark() ? 'dark' : 'light') : p; }

  function apply(p) {
    pref = cleanPref(p);
    if (resolve(pref) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    var sel = document.getElementById('themeSelect');
    if (sel && sel.value !== pref) sel.value = pref;
    if (window.corpus && window.corpus.setTitleBarOverlay) {
      var d = (resolve(pref) === 'dark');
      try { window.corpus.setTitleBarOverlay({ color: d ? '#202226' : '#ffffff', symbolColor: d ? '#9aa3af' : '#5b6470' }); } catch (e) {}
    }
    return pref;
  }
  function get() { return pref; }
  function set(p, persist) {
    apply(p);
    try { localStorage.setItem(KEY, pref); } catch (e) { /* ignore */ }
    if (persist !== false && window.corpus && window.corpus.setPref) {
      try { window.corpus.setPref('theme', pref); } catch (e) { /* ignore */ }
    }
    return pref;
  }

  // 1) Apply ASAP (runs during <head> parse → no flash). main passes the config
  //    theme as ?theme=; fall back to the localStorage cache; else 'auto'.
  var initial = null;
  try { initial = new URLSearchParams(location.search).get('theme'); } catch (e) { /* ignore */ }
  if (!initial) { try { initial = localStorage.getItem(KEY); } catch (e) { /* ignore */ } }
  apply(initial || 'auto');
  try { localStorage.setItem(KEY, pref); } catch (e) { /* ignore */ }

  // While in 'auto', follow live OS theme changes.
  if (mql) {
    var onSys = function () { if (pref === 'auto') apply('auto'); };
    if (mql.addEventListener) mql.addEventListener('change', onSys);
    else if (mql.addListener) mql.addListener(onSys);
  }

  window.corpusTheme = { apply: apply, get: get, set: set, resolve: function () { return resolve(pref); } };

  // 2) Wire the Settings select + reconcile with config once DOM/IPC are ready.
  function init() {
    var sel = document.getElementById('themeSelect');
    if (sel) {
      sel.value = pref;
      if (!sel._wired) { sel._wired = true; sel.addEventListener('change', function () { set(sel.value); }); }
    }
    if (window.corpus && window.corpus.getPrefs) {
      window.corpus.getPrefs().then(function (p) {
        if (!p || !p.theme) return;
        if (cleanPref(p.theme) !== pref) set(p.theme, false);
        try { localStorage.setItem(KEY, cleanPref(p.theme)); } catch (e) { /* ignore */ }
      }).catch(function () { /* ignore */ });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
