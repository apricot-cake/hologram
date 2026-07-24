'use strict';

// Options page (manifest options_ui — the single home for extension settings;
// the future toolbar popup deliberately links here instead of hosting its
// own). The theme pref was removed (extension pages follow the browser via
// prefers-color-scheme; the on-page capture UI is a theme-independent scrim
// solid), so what lives here is the timeline overlay's two settings plus the
// diagnostics link.
//
// Wrapped in an IIFE for the same reason as diag.ts: tsc compiles every
// extension file as one program, so top-level names must stay unique.
export function startOptions(): void {
  // Both read by overlay.js (content script) and written only here.
  // Absent = the defaults overlay.js ships with: the mark appears on hover
  // (#309) and the save button is on (#94). The check is local-only, so there
  // is nothing to opt into.
  const MARK_MODE_KEY = 'savedBadgeMode';
  const HOVER_SAVE_KEY = 'hoverSaveButton';
  const MARK_MODES = ['hover', 'always', 'off'];

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
    setText('savedBadgeModeHoverLabel', 'optionsSavedBadgeHover');
    setText('savedBadgeModeAlwaysLabel', 'optionsSavedBadgeAlways');
    setText('savedBadgeModeOffLabel', 'optionsSavedBadgeOff');
    setText('hoverSaveLabel', 'optionsHoverSave');
    setText('hoverSaveDesc', 'optionsHoverSaveDesc');
  } catch {
    /* not running as an extension page — static fallback text stays */
  }

  // overlay.js listens on chrome.storage.onChanged, so open timelines follow
  // both of these without a reload.
  const radios = MARK_MODES.map((mode) => document.getElementById(`savedBadgeMode${mode[0].toUpperCase()}${mode.slice(1)}`)).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
  if (radios.length === MARK_MODES.length) {
    chrome.storage.local.get(MARK_MODE_KEY, (got) => {
      if (chrome.runtime.lastError) return;
      const stored = got[MARK_MODE_KEY];
      const current = typeof stored === 'string' && MARK_MODES.includes(stored) ? stored : 'hover';
      for (const radio of radios) radio.checked = radio.value === current;
    });
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        if (radio.checked) chrome.storage.local.set({ [MARK_MODE_KEY]: radio.value });
      });
    }
  }

  const box = document.getElementById(HOVER_SAVE_KEY);
  if (box instanceof HTMLInputElement) {
    chrome.storage.local.get(HOVER_SAVE_KEY, (got) => {
      if (chrome.runtime.lastError) return;
      box.checked = got[HOVER_SAVE_KEY] !== false;
    });
    box.addEventListener('change', () => {
      chrome.storage.local.set({ [HOVER_SAVE_KEY]: box.checked });
    });
  }
}
