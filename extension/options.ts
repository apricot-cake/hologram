'use strict';

// Options page (manifest options_ui — the single home for extension settings;
// the future toolbar popup deliberately links here instead of hosting its
// own). No settings yet: the theme pref was removed (extension pages follow
// the browser via prefers-color-scheme; the on-page capture UI is a theme-
// independent scrim solid), so the page currently just hosts the diagnostics
// link and awaits the capture settings planned to consolidate here.
//
// Wrapped in an IIFE for the same reason as diag.ts: tsc compiles every
// extension file as one program, so top-level names must stay unique.
(() => {
  // Strings come from _locales via chrome.i18n (the standard channel for
  // extension pages); the static HTML text is the Japanese fallback for a
  // file:// preview where chrome.i18n is absent.
  try {
    // No on-page heading — the page opens as a tab (manifest options_ui
    // open_in_tab) and the localized document title set here carries the name.
    const title = chrome.i18n && chrome.i18n.getMessage('optionsTitle');
    if (title) document.title = title;
    const diagLink = document.getElementById('diagLink');
    const diagText = chrome.i18n && chrome.i18n.getMessage('optionsOpenDiag');
    if (diagLink && diagText) diagLink.textContent = diagText;
  } catch {
    /* not running as an extension page — static fallback text stays */
  }
})();
