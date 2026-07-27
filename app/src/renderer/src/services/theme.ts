'use strict';

/* Pre-paint theme boot: set [data-theme] before first paint so there's no flash.
   Built standalone (build-theme-boot.mjs, Vite lib IIFE → public/theme.js) and loaded in
   <head>, BEFORE the app's module entry (which loads at the end of <body> and so can't run pre-paint —
   see the load-order comment in index.html). External file because the page CSP is
   `script-src 'self'`; a browser can't type-strip .ts at runtime, so this one file
   needs its own tiny build step outside electron-vite's normal renderer bundling
   (build-theme-boot.mjs).

   FOUC-only: it resolves the pref (main passes config's theme as ?theme=; else the
   localStorage cache; else 'auto') and sets the attribute, nothing more. It publishes no
   window global. The LIVE theme runtime — the apply/get/set/resolve API the
   React Appearance section drives, OS-change following, and the config.json reconcile —
   lives in services/theme-api.ts, part of the normal renderer bundle. */
(function () {
  const KEY = 'hologram-theme';
  function cleanPref(t: string): string {
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function systemDark(): boolean {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_e) {
      return false;
    }
  }

  // Apply ASAP (runs during <head> parse → no flash).
  let initial: string | null = null;
  try {
    initial = new URLSearchParams(location.search).get('theme');
  } catch (_e) {
    /* ignore */
  }
  if (!initial) {
    try {
      initial = localStorage.getItem(KEY);
    } catch (_e) {
      /* ignore */
    }
  }
  const pref = cleanPref(initial || 'auto');
  const dark = pref === 'auto' ? systemDark() : pref === 'dark';
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem(KEY, pref);
  } catch (_e) {
    /* ignore */
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
// document-level guard only neutralizes drops that no element handled. Lives in the
// pre-paint boot (not the app.js runtime) so it's armed before the window can be dropped
// onto.
(function () {
  const stop = function (e: Event) {
    e.preventDefault();
  };
  window.addEventListener('dragover', stop, false);
  window.addEventListener('drop', stop, false);
})();
