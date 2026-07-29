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

// #505: 「保存できた上で投稿情報だけ欠けた」と「何も保存されなかった」は正反対の
// 結果なので、文面が取り違えられてはいけない。年齢制限の投稿は生きているため、
// 「削除」と同じ言葉で数えるのも誤り。
describe('取得できなかった投稿の理由（post-unavailable）', () => {
  test('年齢制限は理由を名指しし、「保存しました」とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.saveFailureText('post-unavailable', 'ageRestricted');
    expect(text).toContain('年齢制限');
    expect(text).toContain('何も保存できませんでした');
    expect(text).not.toContain('保存しました');
    // 部分保存の文面（画像は保存済み）とは別物であること
    expect(text).not.toBe(ja.partialSaveText('ageRestricted'));
  });

  test('鍵付きも理由を名指しする', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.saveFailureText('post-unavailable', 'protected')).toContain('鍵付き');
  });

  test('理由が分からなければ家族全体を名乗る（年齢制限も候補に含める）', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.saveFailureText('post-unavailable');
    expect(text).toContain('何も保存できませんでした');
    expect(text).toContain('年齢制限');
  });

  test('理由は post-unavailable 以外の分類には効かない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    // ホストが落ちているのは投稿の事情ではない＝年齢制限の文面へ倒れてはいけない
    expect(ja.saveFailureText('host-missing', 'ageRestricted')).toBe('Hologram の保存先に接続できません。Chrome を再起動してください');
  });

  test('英語ロケールも同じ区別を持つ', async () => {
    setLanguage('en-US');
    const en = await createI18n();
    expect(en.saveFailureText('post-unavailable', 'ageRestricted')).toContain('Nothing was saved');
    expect(en.saveFailureText('post-unavailable', 'ageRestricted')).toContain('age-restricted');
  });
});
