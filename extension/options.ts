'use strict';

// Options page (manifest options_ui — the single home for extension settings;
// the future toolbar popup deliberately links here instead of hosting its
// own). One setting so far: the theme pref (chrome.storage.local 'theme'),
// read live by glass-ui.ts on host pages and by page-theme.js on this page
// and diag.html — so picking a value re-themes this very page as instant
// feedback, no save button needed.
//
// Wrapped in an IIFE for the same reason as diag.ts: tsc compiles every
// extension file as one program, so top-level names must stay unique.
(() => {
  // Strings come from _locales via chrome.i18n (the standard channel for
  // extension pages); the static HTML text is the Japanese fallback for a
  // file:// preview where chrome.i18n is absent.
  function localize(id: string, key: string) {
    const el = document.getElementById(id);
    const text = chrome.i18n && chrome.i18n.getMessage(key);
    if (el && text) el.textContent = text;
  }
  try {
    const title = chrome.i18n && chrome.i18n.getMessage('optionsTitle');
    if (title) document.title = title;
    localize('title', 'optionsTitle');
    localize('themeLabel', 'optionsThemeLabel');
    localize('themeHint', 'optionsThemeHint');
    localize('diagLink', 'optionsOpenDiag');
    const sel = document.getElementById('theme') as HTMLSelectElement;
    const optKeys: Record<string, string> = { auto: 'optionsThemeAuto', light: 'optionsThemeLight', dark: 'optionsThemeDark' };
    for (const opt of Array.from(sel.options)) {
      const text = chrome.i18n && chrome.i18n.getMessage(optKeys[opt.value]);
      if (text) opt.textContent = text;
    }

    chrome.storage.local.get('theme', (r) => {
      const v = r && r.theme;
      sel.value = v === 'light' || v === 'dark' ? v : 'auto';
    });
    sel.addEventListener('change', () => {
      const v = sel.value === 'light' || sel.value === 'dark' ? sel.value : 'auto';
      chrome.storage.local.set({ theme: v });
    });
  } catch {
    /* not running as an extension page — static fallback text stays */
  }
})();
