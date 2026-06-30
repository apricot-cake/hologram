// Bridge to the renderer's existing i18n. `window.corpusI18n` (from i18n.js)
// resolves to { lang, resolved, getMessage }. The island reuses the SAME message
// keys as the rest of the app — no duplicated strings. Call initI18n() once before
// rendering so t() is synchronous inside components.

let api = null;

export async function initI18n() {
  try {
    api = await window.corpusI18n;
  } catch {
    api = null; // i18n unavailable — t() falls back to the raw key
  }
  return api;
}

export function t(key, subs) {
  if (!api) return key;
  return api.getMessage(key, subs);
}

export function lang() {
  return api ? api.lang : 'auto';
}
