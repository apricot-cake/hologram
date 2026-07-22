'use strict';

// Options page (manifest options_ui — the single home for extension settings;
// the future toolbar popup deliberately links here instead of hosting its
// own). The theme pref was removed (extension pages follow the browser via
// prefers-color-scheme; the on-page capture UI is a theme-independent scrim
// solid), so what lives here is the saved-post badge switch plus the
// diagnostics link.
//
// Wrapped in an IIFE for the same reason as diag.ts: tsc compiles every
// extension file as one program, so top-level names must stay unique.
(() => {
  // Read by badge.js (content script) and written only here. Absent = ON: the
  // badge ships enabled, and the check is local-only, so there is nothing to
  // opt into (#54).
  const SAVED_BADGE_KEY = 'savedBadge';

  // Strings come from _locales via chrome.i18n (the standard channel for
  // extension pages); the static HTML text is the Japanese fallback for a
  // file:// preview where chrome.i18n is absent.
  try {
    // No on-page heading — the page opens as a tab (manifest options_ui
    // open_in_tab) and the localized document title set here carries the name.
    const title = chrome.i18n && chrome.i18n.getMessage('optionsTitle');
    if (title) document.title = title;
    const setText = (id: string, key: string) => {
      const el = document.getElementById(id);
      const text = chrome.i18n && chrome.i18n.getMessage(key);
      if (el && text) el.textContent = text;
    };
    setText('diagLink', 'optionsOpenDiag');
    setText('savedBadgeLabel', 'optionsSavedBadge');
    setText('savedBadgeDesc', 'optionsSavedBadgeDesc');
  } catch {
    /* not running as an extension page — static fallback text stays */
  }

  const box = document.getElementById(SAVED_BADGE_KEY);
  if (box instanceof HTMLInputElement) {
    chrome.storage.local.get(SAVED_BADGE_KEY, (got) => {
      if (chrome.runtime.lastError) return;
      box.checked = got[SAVED_BADGE_KEY] !== false;
    });
    box.addEventListener('change', () => {
      // badge.js listens on chrome.storage.onChanged, so open timelines follow
      // this without a reload.
      chrome.storage.local.set({ [SAVED_BADGE_KEY]: box.checked });
    });
  }
})();
