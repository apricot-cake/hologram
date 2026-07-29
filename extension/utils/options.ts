'use strict';

// Options page (manifest options_ui — the single home for extension settings;
// the future toolbar popup deliberately links here instead of hosting its
// own). The theme pref was removed because every extension surface follows the
// browser through prefers-color-scheme (#270), so what lives here is the
// timeline overlay's two settings, the duplicate warning, and the diagnostics
// link. The look is utils/page.css, shared with the diagnostics page (#44).
//
// Wrapped in an IIFE for the same reason as diag.ts: tsc compiles every
// extension file as one program, so top-level names must stay unique.
export function startOptions(): void {
  // Both read by overlay.js (content script) and written only here.
  // Absent = the defaults overlay.js ships with: the mark is always shown
  // (#309) and the save button is on (#94). The check is local-only, so there
  // is nothing to opt into.
  const MARK_MODE_KEY = 'savedBadgeMode';
  const HOVER_SAVE_KEY = 'hoverSaveButton';
  // Read by capture.ts/drag.ts through duplicate-guard.ts (#34); the warning
  // itself carries the same opt-out, so this row is the way back.
  const DUPLICATE_WARNING_KEY = 'duplicateWarning';
  const MARK_MODES = ['always', 'hover', 'off'];

  // Strings come from _locales via chrome.i18n (the standard channel for
  // extension pages); the static HTML text is the Japanese fallback for a
  // file:// preview where chrome.i18n is absent.
  try {
    // The page opens as a tab (manifest options_ui open_in_tab), so it carries
    // its own name and a line saying what it is: it can be reached cold from
    // chrome://extensions or a context menu, and a bare list of three
    // checkboxes does not tell that reader whose settings they are (#44).
    const title = chrome.i18n && chrome.i18n.getMessage('optionsTitle');
    if (title) document.title = title;
    const setText = (id: string, key: string) => {
      const el = document.getElementById(id);
      const text = chrome.i18n && chrome.i18n.getMessage(key);
      if (el && text) el.textContent = text;
    };
    setText('pageTitle', 'optionsTitle');
    setText('pageLede', 'optionsLede');
    setText('sectionTimeline', 'optionsSectionTimeline');
    setText('sectionSaving', 'optionsSectionSaving');
    setText('diagLink', 'optionsOpenDiag');
    setText('savedBadgeLabel', 'optionsSavedBadge');
    setText('savedBadgeDesc', 'optionsSavedBadgeDesc');
    setText('savedBadgeModeHoverLabel', 'optionsSavedBadgeHover');
    setText('savedBadgeModeAlwaysLabel', 'optionsSavedBadgeAlways');
    setText('savedBadgeModeOffLabel', 'optionsSavedBadgeOff');
    setText('hoverSaveLabel', 'optionsHoverSave');
    setText('hoverSaveDesc', 'optionsHoverSaveDesc');
    setText('duplicateWarningLabel', 'optionsDuplicateWarning');
    setText('duplicateWarningDesc', 'optionsDuplicateWarningDesc');
  } catch {
    /* not running as an extension page — static fallback text stays */
  }

  // overlay.js listens on chrome.storage.onChanged, so open timelines follow
  // both of these without a reload.
  const radios = MARK_MODES.map((mode) => document.getElementById(`savedBadgeMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
  if (radios.length === MARK_MODES.length) {
    chrome.storage.local.get(MARK_MODE_KEY, (got) => {
      if (chrome.runtime.lastError) return;
      const stored = got[MARK_MODE_KEY];
      const current = typeof stored === 'string' && MARK_MODES.includes(stored) ? stored : 'always';
      for (const radio of radios) radio.checked = radio.value === current;
    });
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        if (radio.checked) chrome.storage.local.set({ [MARK_MODE_KEY]: radio.value });
      });
    }
  }

  // Both remaining settings are the same shape: a checkbox whose absent value
  // means "on", stored under the id it carries in the page.
  for (const key of [HOVER_SAVE_KEY, DUPLICATE_WARNING_KEY]) {
    const box = document.getElementById(key);
    if (!(box instanceof HTMLInputElement)) continue;
    chrome.storage.local.get(key, (got) => {
      if (chrome.runtime.lastError) return;
      box.checked = got[key] !== false;
    });
    box.addEventListener('change', () => {
      chrome.storage.local.set({ [key]: box.checked });
    });
  }
}
