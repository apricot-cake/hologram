// Native Messaging returns unstructured English error text to the extension. This
// guards both sides of the contract visible to the user = known Chrome failures are
// conservatively classified, and every classification (including unknown) is converted
// to localized text without mixing in the raw diagnostic string.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from '../extension/utils/i18n';
import { classifySaveFailure, saveFailureConsoleLevel } from '../extension/utils/native-error';

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
    // The abandoned leg (#507). Only the host's own "timed out" stays host-unavailable =
    // both are timeouts, but knowing the save program itself went silent makes the guidance more specific.
    ['metadata fetch timed out after 20000ms', 'timeout'],
    ['crop timed out after 10000ms', 'timeout'],
    ['save timed out — no result from the background within 90000ms', 'timeout'],
    ['Native host timed out', 'host-unavailable'],
    ['Image download failed: HTTP 403', 'unknown'],
  ])('"%s" → %s', (raw, expected) => {
    expect(classifySaveFailure(raw)).toBe(expected);
  });
});

// #580: refusals that are outcomes of a save (an unobtainable post, a tab over
// its in-flight budget) must not land in the chrome://extensions error console;
// everything actually broken must keep doing so.
describe('saveFailureConsoleLevel: エラー欄に出すか（#580）', () => {
  test.each([
    ['post-unavailable', 'warn'],
    ['busy', 'warn'],
    ['host-missing', 'error'],
    ['host-unavailable', 'error'],
    ['origin-rejected', 'error'],
    ['timeout', 'error'],
    ['unknown', 'error'],
  ] as const)('%s → console.%s', (kind, level) => {
    expect(saveFailureConsoleLevel(kind)).toBe(level);
  });
});

describe('日本語ロケールの文面', () => {
  const jaExpected = {
    'host-missing': 'Hologram の保存先に接続できません。Chrome を再起動してください',
    'host-unavailable': 'Hologram の保存プログラムを起動できませんでした。拡張機能の設定から診断ページを確認してください',
    'origin-rejected': 'Hologram の保存設定が一致していません。Hologram を再インストールしてください',
    timeout: '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）',
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

// #507: the abort message must not just end at "it failed" — the next step must be
// readable from it. Since the cause is often transient, retry comes first, and the
// diagnostics page is left to the other classifications.
describe('打ち切りの文面（timeout）', () => {
  test.each([
    ['ja-JP', 'もう一度お試しください'],
    ['en-US', 'Try again'],
  ])('%s は次の一手を書く', async (language, nextStep) => {
    setLanguage(language);
    const i18n = await createI18n();
    const text = i18n.saveFailureText('timeout');
    expect(text).toContain(nextStep);
    expect(text).not.toBe(i18n.saveFailureText('unknown'));
  });
});

// #505: "saved successfully but missing post info" and "nothing was saved at all" are
// opposite outcomes, so the wording must never be confused between them. An
// age-restricted post is still alive, so counting it under the same word as "deleted" is also wrong.
describe('取得できなかった投稿の理由（post-unavailable）', () => {
  test('年齢制限は理由を名指しし、「保存しました」とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.saveFailureText('post-unavailable', 'ageRestricted');
    expect(text).toContain('年齢制限');
    expect(text).toContain('何も保存できませんでした');
    expect(text).not.toContain('保存しました');
    // must be distinct from the partial-save wording (image already saved)
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
    // The host being down has nothing to do with the post = it must not fall back to the age-restriction wording
    expect(ja.saveFailureText('host-missing', 'ageRestricted')).toBe('Hologram の保存先に接続できません。Chrome を再起動してください');
  });

  test('英語ロケールも同じ区別を持つ', async () => {
    setLanguage('en-US');
    const en = await createI18n();
    expect(en.saveFailureText('post-unavailable', 'ageRestricted')).toContain('Nothing was saved');
    expect(en.saveFailureText('post-unavailable', 'ageRestricted')).toContain('age-restricted');
  });
});

// #367: the disclaimer for "it saved, but the record has gaps". Now that it's shown in
// a banner, which situation names itself how must be pinned down at the wording level =
// name the reason if it's known, name the family if not, and never say "couldn't be
// retrieved" once the page has filled the gap.
describe('保存の但し書き（partialSaveText・#367）', () => {
  test('理由が分かれば名指しする', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();

    expect(ja.partialSaveText('protected')).toContain('鍵付きアカウント');
    expect(ja.partialSaveText('ageRestricted')).toContain('年齢制限');
  });

  test('理由が分からなければ汎用の但し書き', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();

    expect(ja.partialSaveText()).toBe('保存しました（投稿情報の取得に失敗）');
    expect(ja.partialSaveText(null)).toBe('保存しました（投稿情報の取得に失敗）');
  });

  // Every one of these must read as "the save did succeed" = if it gets confused with
  // the failure wording (nothing was saved), showing the disclaimer in a banner becomes a false report in itself.
  test('どの但し書きも「保存しました」で始まり「失敗しました」とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();

    for (const reason of [undefined, 'protected', 'ageRestricted'] as const) {
      expect(ja.partialSaveText(reason).startsWith('保存しました')).toBe(true);
      expect(ja.partialSaveText(reason)).not.toBe(ja.saveFailureText('post-unavailable', reason));
    }
  });

  // Meshes with #202. Saying "post info could not be retrieved" for a save whose text or
  // author was filled in from the page is factually wrong = the record is not empty. The
  // reason (protected / age-restricted) stays silent here = once the content is filled in,
  // why the API didn't answer stops being something the user needs to address.
  test('画面から本文・作者が埋まったら「取れなかった」とは言わない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.partialSaveText('protected', ['text', 'displayName']);

    expect(text).toBe('保存しました（投稿情報は画面から補完・数値は概数）');
    expect(text).not.toContain('取得できません');
    expect(text).not.toContain('鍵付き');
  });

  // If only numbers were picked up from the page, it does not claim to have "filled in" =
  // text and author both remain empty, and it's still a record the user should review.
  test('数値だけ埋まった場合は理由つきの但し書きのまま', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();

    expect(ja.partialSaveText('protected', ['likes', 'views'])).toContain('鍵付きアカウント');
    expect(ja.partialSaveText('protected', [])).toContain('鍵付きアカウント');
  });

  test('英語ロケールも同じ区別を持つ', async () => {
    setLanguage('en-US');
    const en = await createI18n();

    expect(en.partialSaveText('protected')).toContain('private account');
    expect(en.partialSaveText('protected', ['text'])).toContain('read from the page');
    expect(en.partialSaveText('protected', ['text'])).not.toContain('unavailable');
  });
});

// #205: the notice for when the extension and host versions have drifted. ⚠️This does
// NOT belong to the "failure" family = the save has already completed. If it gets
// confused with the bannerFailed* family above, the wording reads as if nothing was
// saved even though it was, so this pins down that the distinction survives at the wording level.
describe('版のずれの案内（#205）', () => {
  test('どちらを更新すればよいかまで言う', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.skewSaveText('host-old')).toContain('Hologram アプリを更新');
    expect(ja.skewSaveText('host-new')).toContain('拡張機能を更新');
  });

  test('保存できたことが先に立つ＝失敗とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    for (const skew of ['host-old', 'host-new'] as const) {
      expect(ja.skewSaveText(skew)).toContain('保存しました');
      expect(ja.skewSaveText(skew)).not.toContain('失敗');
    }
  });

  test('ずれていなければ何も言わない＝呼び出し側が通常の文面へ落ちる', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.skewSaveText('match')).toBeNull();
    expect(ja.skewSaveText(null)).toBeNull();
    expect(ja.skewSaveText()).toBeNull();
  });

  test('英語ロケールも同じ区別を持つ', async () => {
    setLanguage('en-US');
    const en = await createI18n();
    expect(en.skewSaveText('host-old')).toContain('update the Hologram app');
    expect(en.skewSaveText('host-new')).toContain('update the extension');
    expect(en.skewSaveText('match')).toBeNull();
  });
});
