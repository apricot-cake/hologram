// The extension's own settings page, run against its real markup (#1057).
//
// What is being guarded: the page ships Japanese text as the file:// fallback and
// then replaces every string from _locales, so the document's `lang` has to move
// with them. The failure is silent — a fr-FR Chrome reads the English table while
// the document still claims ja, and only a screen reader ever says so.
//
// The popup page (utils/popup.ts) carries the same two lines, but driving it needs
// the native-host probe, runtime messaging and the save history; the assignment
// itself is the one tested here, and servedLocale is covered by
// served-locale.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, expect, test, vi } from 'vitest';
import { startOptions } from '../extension/utils/options.ts';

const OPTIONS_HTML = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', 'entrypoints', 'options.html'), 'utf8');

// Only what startOptions touches: the message table (one key is enough to prove
// the strings really were replaced) and the storage the three controls read.
function runOptionsPage(uiLanguage: string | null) {
  const dom = new JSDOM(OPTIONS_HTML, { url: 'chrome-extension://testextensionidabcdefghijklmnop/options.html' });
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
  vi.stubGlobal('chrome', {
    // null uiLanguage stands for the file:// preview, where there is no
    // chrome.i18n at all and the Japanese fallback markup is what is on screen.
    i18n: uiLanguage === null ? undefined : { getUILanguage: () => uiLanguage, getMessage: (key: string) => (key === 'optionsTitle' ? 'Hologram settings' : '') },
    storage: { local: { get: (_key: string, cb: (got: Record<string, unknown>) => void) => cb({}), set: () => {} } },
    runtime: { lastError: undefined },
  });
  startOptions();
  return dom.window.document;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('_locales に ja がある UI 言語では ja を名乗る', () => {
  expect(runOptionsPage('ja').documentElement.lang).toBe('ja');
});

test('英語の UI 言語では en を名乗る', () => {
  const doc = runOptionsPage('en-US');
  expect(doc.documentElement.lang).toBe('en');
  // 文言が実際に差し替わっていること＝lang だけ動かして中身が日本語のまま、の逆を防ぐ
  expect(doc.getElementById('pageTitle')?.textContent).toBe('Hologram settings');
});

// ここが getUILanguage() の生値を書けない理由の現場。fr-FR の Chrome には
// default_locale の en が配られるので、名乗るのも en。
test('_locales に無い UI 言語では、配られる en を名乗る（fr-FR と書かない）', () => {
  expect(runOptionsPage('fr-FR').documentElement.lang).toBe('en');
});

test('chrome.i18n が無い file:// プレビューでは、静的な日本語のまま ja が残る', () => {
  const doc = runOptionsPage(null);
  expect(doc.documentElement.lang).toBe('ja');
  expect(doc.getElementById('pageTitle')?.textContent).toBe('Hologram 設定');
});
