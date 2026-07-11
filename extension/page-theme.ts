'use strict';

// Theme boot for the extension's own pages (options.html, diag.html — loaded
// in <head> before their main scripts). Counterpart of the app's renderer/
// theme.ts pre-paint boot, adapted to this origin: the pref lives in
// chrome.storage.local 'theme' ('light' | 'dark', anything else = 'auto'),
// the same key the content-script glass UI (glass-ui.ts) follows.
//
// An explicit pref stamps [data-theme] on <html>; 'auto' leaves it unstamped
// so the pages' prefers-color-scheme CSS decides (which also means the
// pre-storage-read paint is already correct for auto, the default). The
// storage read is async, so a forced-opposite-of-OS pref can flash one frame
// — accepted on these small internal pages (the app avoids it with a
// synchronous localStorage cache; extension storage has no sync read).
//
// Guarded so the file is inert when chrome.storage is absent (e.g. the page
// opened as file:// for a quick look outside the extension).
(() => {
  function apply(v: unknown) {
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
  }
  try {
    chrome.storage.local.get('theme', (r) => apply(r && r.theme));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.theme) apply(changes.theme.newValue);
    });
  } catch {
    /* not running as an extension page — leave the OS-driven CSS as is */
  }
})();
