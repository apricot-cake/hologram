// Native Messaging は拡張へ構造化されていない英語のエラー文を返す。ユーザーに見える
// 契約の両側を守る＝既知の Chrome 失敗は控えめに分類され、どの分類（unknown 含む）も
// 生の診断文を混ぜずにローカライズ済みの文へ変換される。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from '../extension/utils/i18n';
import { classifySaveFailure } from '../extension/utils/native-error';

function setLanguage(language: string) {
  vi.stubGlobal('navigator', { language });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifySaveFailure: Chrome の生エラー文の分類', () => {
  test.each([
    ['Specified native messaging host not found.', 'host-missing'],
    ['Native host disconnected (is it installed?)', 'host-missing'],
    ['Error when communicating with the native messaging host.', 'host-unavailable'],
    ['Native messaging host has exited.', 'host-unavailable'],
    ['Native host unavailable: Access is denied', 'host-unavailable'],
    ['Access to the specified native messaging host is forbidden.', 'origin-rejected'],
    ['Image download failed: HTTP 403', 'unknown'],
  ])('"%s" → %s', (raw, expected) => {
    expect(classifySaveFailure(raw)).toBe(expected);
  });
});

describe('日本語ロケールの文面', () => {
  const jaExpected = {
    'host-missing': 'Hologram の保存先に接続できません。Chrome を再起動してください',
    'host-unavailable': 'Hologram の保存プログラムを起動できませんでした。拡張機能の設定から診断ページを確認してください',
    'origin-rejected': 'Hologram の保存設定が一致していません。Hologram を再インストールしてください',
    unknown: '保存に失敗しました。拡張機能の設定から診断ページを確認してください',
  };

  test.each(Object.entries(jaExpected))('%s', async (kind, expected) => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.saveFailureText(kind)).toBe(expected);
  });

  test('分類が渡らなければ汎用メッセージ', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.saveFailureText()).toBe(jaExpected.unknown);
  });

  test('生の診断文は決して埋め込まない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.saveFailureText('unknown')).not.toContain('Image download failed');
  });
});

test('英語ロケールも生きている', async () => {
  setLanguage('en-US');
  const en = await createI18n();
  expect(en.saveFailureText('host-unavailable').startsWith("Hologram's saver could not start.")).toBe(true);
});
