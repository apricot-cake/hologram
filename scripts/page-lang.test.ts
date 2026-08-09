// 拡張機能の設定ページを、実際のマークアップに対して動かす (#1057)。
//
// 防いでいるもの: このページは file:// 向けのフォールバックとして日本語の文言を積んでおき、
// そのうえで全文字列を _locales から差し替える。だから document の `lang` も一緒に動かないと
// いけない。失敗は表に出ない＝fr-FR の Chrome は英語の表を読むのに document は ja を名乗った
// ままで、それを言うのはスクリーンリーダーだけ。
//
// popup ページ（utils/popup.ts）も同じ2行を持つが、動かすには native-host への問い合わせ・
// runtime のメッセージ・保存履歴が要る。代入そのものを見ているのはここで、servedLocale は
// served-locale.test.ts が見る。
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, expect, test, vi } from 'vitest';
import { startOptions } from '../extension/utils/options.ts';

const OPTIONS_HTML = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', 'entrypoints', 'options.html'), 'utf8');

// startOptions が触るものだけ用意する。文言の表（文字列が実際に差し替わったことを示すには
// キー1つで足りる）と、3つのコントロールが読む local ストレージ。
function runOptionsPage(uiLanguage: string | null) {
  const dom = new JSDOM(OPTIONS_HTML, { url: 'chrome-extension://testextensionidabcdefghijklmnop/options.html' });
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
  vi.stubGlobal('chrome', {
    // uiLanguage が null なのは file:// のプレビューを表す。そこには chrome.i18n が
    // まったく無く、画面に出るのはフォールバックの日本語マークアップ。
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
