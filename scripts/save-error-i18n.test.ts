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
    // 見捨てられた脚（#507）。ホストの「timed out」だけは host-unavailable のまま＝
    // どちらもタイムアウトだが、保存プログラムが黙ったと分かる方が案内が具体的になる。
    ['metadata fetch timed out after 20000ms', 'timeout'],
    ['crop timed out after 10000ms', 'timeout'],
    ['save timed out — no result from the background within 90000ms', 'timeout'],
    ['Native host timed out', 'host-unavailable'],
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

// #507: 打ち切りの文面は「失敗した」で終わらせず、次の一手が読めること。
// 一過性の原因が多いので再試行が先頭で、診断ページは他の分類に譲る。
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

// #367: 「保存はできたが記録に欠けがある」時の但し書き。バナーへ出すようになった以上、
// どの状況でどう名乗るかが文面レベルで固定されている必要がある＝理由が分かればそれを名指し、
// 分からなければ family を名乗り、画面から埋まった時は「取れなかった」と言わない。
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

  // どれも「保存はできている」と読めること＝失敗の文面（何も保存されていない）と
  // 取り違えられたら、但し書きをバナーへ出したことがそのまま誤報になる。
  test('どの但し書きも「保存しました」で始まり「失敗しました」とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();

    for (const reason of [undefined, 'protected', 'ageRestricted'] as const) {
      expect(ja.partialSaveText(reason).startsWith('保存しました')).toBe(true);
      expect(ja.partialSaveText(reason)).not.toBe(ja.saveFailureText('post-unavailable', reason));
    }
  });

  // #202 との噛み合わせ。画面から本文か作者を埋めた保存に「投稿情報は取得できません」と
  // 言うのは事実に反する＝レコードは空ではない。理由（鍵付き・年齢制限）はここで黙る＝
  // API がなぜ答えなかったかは、中身が入った時点でユーザーの手当てを要さない話になる。
  test('画面から本文・作者が埋まったら「取れなかった」とは言わない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.partialSaveText('protected', ['text', 'displayName']);

    expect(text).toBe('保存しました（投稿情報は画面から補完・数値は概数）');
    expect(text).not.toContain('取得できません');
    expect(text).not.toContain('鍵付き');
  });

  // 数値だけを画面から拾った場合は「補完した」とは名乗らない＝本文も作者も空のままで、
  // ユーザーが見直すべきレコードであることは変わらない。
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

// #205: 拡張とホストの版がずれた時の案内。⚠️これは「失敗」の一族ではない＝保存は
// 済んでいる。上の bannerFailed* 系と取り違えると、保存できたのに何も残っていないと
// 読める文になるので、区別が文面レベルで残っていることをここで固定する。
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
