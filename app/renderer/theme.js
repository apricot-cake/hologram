'use strict';

/* Theme: auto (follow the OS) / light / dark.
   We store the PREF (auto/light/dark); the APPLIED value (light/dark) is resolved
   from it — 'auto' tracks the OS via prefers-color-scheme. Applied as early as
   possible from main's ?theme= query (no flash), reconciled with config.json over
   IPC. The control lives in Settings → 外観 (the React Appearance section drives
   window.corpusTheme — theme.js owns no settings DOM).
   External file because the page CSP is `script-src 'self'`. */
(function () {
  const KEY = 'corpus-theme';
  let mql = null;
  try {
    mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  } catch (e) {
    mql = null;
  }
  let pref = 'auto'; // auto | light | dark

  function cleanPref(t) {
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function systemDark() {
    return !!(mql && mql.matches);
  }
  function resolve(p) {
    p = cleanPref(p);
    return p === 'auto' ? (systemDark() ? 'dark' : 'light') : p;
  }

  // Native titlebar overlay (Windows). While a modal scrim is up we darken it so the
  // OS window controls don't stay bright against the dimmed page (modalDark).
  let modalDark = false;
  function barColors() {
    const d = resolve(pref) === 'dark';
    if (modalDark) return { color: d ? '#0a0a0c' : '#9a9c9f', symbolColor: d ? '#7a818b' : '#34373c', height: 37 };
    return { color: d ? '#0e0f11' : '#eceef2', symbolColor: d ? '#9aa3af' : '#5b6470', height: 37 };
  }
  function setBar() {
    if (window.corpus && window.corpus.setTitleBarOverlay) {
      try {
        window.corpus.setTitleBarOverlay(barColors());
      } catch (e) {}
    }
  }
  function applyTitleBar(modal) {
    modalDark = !!modal;
    setBar();
  }

  function apply(p) {
    pref = cleanPref(p);
    if (resolve(pref) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    setBar(); // modalDark-aware; keeps the dark titlebar if a modal is open
    return pref;
  }
  function get() {
    return pref;
  }
  function set(p, persist) {
    apply(p);
    try {
      localStorage.setItem(KEY, pref);
    } catch (e) {
      /* ignore */
    }
    if (persist !== false && window.corpus && window.corpus.setPref) {
      try {
        window.corpus.setPref('theme', pref);
      } catch (e) {
        /* ignore */
      }
    }
    return pref;
  }

  // 1) Apply ASAP (runs during <head> parse → no flash). main passes the config
  //    theme as ?theme=; fall back to the localStorage cache; else 'auto'.
  let initial = null;
  try {
    initial = new URLSearchParams(location.search).get('theme');
  } catch (e) {
    /* ignore */
  }
  if (!initial) {
    try {
      initial = localStorage.getItem(KEY);
    } catch (e) {
      /* ignore */
    }
  }
  apply(initial || 'auto');
  try {
    localStorage.setItem(KEY, pref);
  } catch (e) {
    /* ignore */
  }

  // While in 'auto', follow live OS theme changes.
  if (mql) {
    const onSys = function () {
      if (pref === 'auto') apply('auto');
    };
    if (mql.addEventListener) mql.addEventListener('change', onSys);
    else if (mql.addListener) mql.addListener(onSys);
  }

  window.corpusTheme = {
    apply: apply,
    get: get,
    set: set,
    resolve: function () {
      return resolve(pref);
    },
    applyTitleBar: applyTitleBar,
  };

  // 2) Reconcile with config.json once. Preload's window.corpus exists before any
  //    page script runs, so no readiness gate is needed — the old DOMContentLoaded
  //    wait existed only for the legacy #themeSelect wiring (removed: the React
  //    Appearance section owns the control via window.corpusTheme now).
  if (window.corpus && window.corpus.getPrefs) {
    window.corpus
      .getPrefs()
      .then(function (p) {
        if (!p || !p.theme) return;
        if (cleanPref(p.theme) !== pref) set(p.theme, false);
        try {
          localStorage.setItem(KEY, cleanPref(p.theme));
        } catch (e) {
          /* ignore */
        }
      })
      .catch(function () {
        /* ignore */
      });
  }
})();

// Navigation hardening: a file dropped onto the window would otherwise make the
// top frame navigate to file://…, which inherits this same preload and could
// invoke destructive IPC (clearAll/importComplete/…). The app has no
// drop-a-file-to-import affordance — media import goes through the OS file
// picker (importImages button → dialog) — so blocking the browser's default
// drop/dragover everywhere is safe. The app's own internal drag-and-drop
// (folder reordering, query-builder pills) is element-scoped and already calls
// preventDefault() in its own bubble-phase handlers, so those keep working; this
// document-level guard only neutralizes drops that no element handled.
(function () {
  const stop = function (e) {
    e.preventDefault();
  };
  window.addEventListener('dragover', stop, false);
  window.addEventListener('drop', stop, false);
})();
