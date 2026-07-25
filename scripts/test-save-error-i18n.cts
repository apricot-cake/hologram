'use strict';
// Native Messaging gives the extension unstructured English error text. Guard
// both halves of the user-facing contract: known Chrome failures are classified
// conservatively, and every class (including unknown) becomes localized text
// without interpolating the raw diagnostic detail.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

let failed = 0;
const check = (name, condition) => {
  if (!condition) {
    console.error('FAIL', name);
    failed++;
  }
};

function setLanguage(language) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language },
    configurable: true,
  });
}

(async () => {
  const classifier = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'utils', 'native-error.ts')).href);
  const i18n = await import(pathToFileURL(path.join(__dirname, '..', 'extension', 'utils', 'i18n.ts')).href);

  const cases = [
    ['Specified native messaging host not found.', 'host-missing'],
    ['Native host disconnected (is it installed?)', 'host-missing'],
    ['Error when communicating with the native messaging host.', 'host-unavailable'],
    ['Native messaging host has exited.', 'host-unavailable'],
    ['Native host unavailable: Access is denied', 'host-unavailable'],
    ['Access to the specified native messaging host is forbidden.', 'origin-rejected'],
    ['Image download failed: HTTP 403', 'unknown'],
  ];
  for (const [raw, expected] of cases) {
    check(`classifies "${raw}" as ${expected}`, classifier.classifySaveFailure(raw) === expected);
  }

  setLanguage('ja-JP');
  const ja = await i18n.createI18n();
  const jaExpected = {
    'host-missing': 'Hologram の保存先に接続できません。Chrome を再起動してください',
    'host-unavailable': 'Hologram の保存プログラムを起動できませんでした。拡張機能の設定から診断ページを確認してください',
    'origin-rejected': 'Hologram の保存設定が一致していません。Hologram を再インストールしてください',
    unknown: '保存に失敗しました。拡張機能の設定から診断ページを確認してください',
  };
  for (const [kind, expected] of Object.entries(jaExpected)) {
    check(`Japanese ${kind} message`, ja.saveFailureText(kind) === expected);
  }
  check('missing failure kind uses the Japanese generic message', ja.saveFailureText() === jaExpected.unknown);

  setLanguage('en-US');
  const en = await i18n.createI18n();
  check('English locale remains available', en.saveFailureText('host-unavailable').startsWith("Hologram's saver could not start."));
  check('raw diagnostic text is never interpolated', !ja.saveFailureText('unknown').includes('Image download failed'));

  console.log(failed === 0 ? `PASS test-save-error-i18n: ${cases.length + 7} checks` : `FAIL test-save-error-i18n: ${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
