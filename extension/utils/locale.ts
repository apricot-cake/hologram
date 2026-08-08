// Which of the extension's OWN locales a given language tag ends up being served
// (#1057). Not the same question as "what language is the browser in": `_locales`
// holds ja and en only, and wxt.config.ts sets `default_locale: 'en'`, so Chrome's
// documented lookup — the exact locale, then the locale without its region, then
// `default_locale` — collapses to the one line below for this pair.
//
// This has to be restated here because Chrome reports no such thing. Both
// `chrome.i18n.getUILanguage()` and the `@@ui_locale` predefined message return the
// BROWSER's UI language, which stops matching the strings on screen the moment the
// fallback fires: an fr-FR Chrome reads the English table, and writing `lang="fr-FR"`
// on that page would hand English prose to a French speech synthesizer.
//
// Adding a locale to `_locales/` means adding it here — one place, and the only
// place that knows the set (the app renderer resolves the same ja/en pair in
// app/src/renderer/src/services/i18n.ts, a different process and a different bundle,
// off the user's own language setting rather than the browser's).
export function servedLocale(tag: string | null | undefined): 'ja' | 'en' {
  return tag?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

// Declares the language of a piece of OUR UI standing on someone else's page
// (#1057, WCAG 2.2 SC 3.1.2 Language of Parts). The text inside is in whatever
// i18n.ts's createI18n resolved from navigator.language; the page around it is in
// whatever language the site is — x.com serves `<html lang="en">` while the banner
// says 保存中... Without this the page's declaration is what gets inherited and a
// screen reader reads the wrong language aloud. For the corner control that reading
// is the ONLY output it has (overlay.ts draws no text at all, so its strings exist
// purely as accessible names).
//
// Written on the shadow HOST rather than inside the tree: the host is the node the
// page's own declaration reaches, so it is where the override belongs, and one
// attribute covers every surface the root will ever hold.
export function markUiLanguage(host: HTMLElement): void {
  host.lang = servedLocale(navigator.language);
}
