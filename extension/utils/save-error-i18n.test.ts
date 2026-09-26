// Native Messaging は構造を持たない英語のエラー文を拡張機能へ返す。ここでは利用者から見える
// 取り決めの両側を守る＝既知の Chrome の失敗を保守的に分類し、どの分類（unknown を含む）も、
// 生の診断文字列を混ぜずにローカライズされた文言へ変換する。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from './i18n';
import { classifySaveFailure, saveFailureConsoleLevel } from './native-error';

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
    // 打ち切りの側 (#507)。ホスト自身の `timed out` だけは host-unavailable のまま＝どちらも
    // タイムアウトだが、保存プログラム自体が黙ったと分かる方が案内を具体的にできる。
    ['metadata fetch timed out after 20000ms', 'timeout'],
    ['crop timed out after 10000ms', 'timeout'],
    ['save timed out — no result from the background within 90000ms', 'timeout'],
    ['Native host timed out', 'host-unavailable'],
    ['Image download failed: HTTP 403', 'unknown'],
  ])('"%s" → %s', (raw, expected) => {
    expect(classifySaveFailure(raw)).toBe(expected);
  });
});

// #580: 保存の結果としての拒否（取得できない投稿、実行中の枠を超えたタブ）は
// chrome://extensions のエラー欄に出してはいけない。本当に壊れているものは今までどおり出す。
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
    'host-missing': 'アプリに接続できません',
    'host-unavailable': 'アプリに接続できません',
    'origin-rejected': '保存に必要な設定を確認してください',
    timeout: '保存できませんでした',
    unknown: '保存できませんでした',
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
  expect(en.saveFailureText('host-unavailable')).toBe("Can't connect to the app");
});

// #507: 打ち切りの文面は「失敗した」で終わってはいけない＝そこから次の一手が読み取れること。
// 原因は一時的なことが多いので、まず再試行を出し、診断ページは他の分類に任せる。
describe('打ち切りの文面（timeout）', () => {
  test.each([
    ['ja-JP', '保存できませんでした'],
    ['en-US', 'Could not save'],
  ])('%s は次の一手を書く', async (language, nextStep) => {
    setLanguage(language);
    const i18n = await createI18n();
    const text = i18n.saveFailureText('timeout');
    expect(text).toContain(nextStep);
    expect(text).toBe(i18n.saveFailureText('unknown'));
  });
});

// #505:「保存はできたが投稿情報が欠けている」と「何も保存できなかった」は正反対の結末なので、
// 文面を取り違えては絶対にいけない。年齢制限の投稿は生きているので、「削除された」と同じ語で
// 数えるのも誤り。
describe('取得できなかった投稿の理由（post-unavailable）', () => {
  test('年齢制限は理由を名指しし、「保存しました」とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.saveFailureText('post-unavailable', 'ageRestricted');
    expect(text).not.toContain('年齢制限');
    expect(text).toBe('保存できませんでした');
    expect(text).not.toContain('保存しました');
    // 部分保存の文面（画像は保存済み）とは別であること
    expect(text).not.toBe(ja.partialSaveText('ageRestricted'));
  });

  test('鍵付きも理由を名指しする', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    expect(ja.saveFailureText('post-unavailable', 'protected')).toBe('保存できませんでした');
  });

  test('理由が分からなければ家族全体を名乗る（年齢制限も候補に含める）', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.saveFailureText('post-unavailable');
    expect(text).toBe('保存できませんでした');
    expect(text).not.toContain('年齢制限');
  });

  test('理由は post-unavailable 以外の分類には効かない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    // ホストが落ちていることは投稿とは無関係＝代わりに年齢制限の文面を使ってはいけない
    expect(ja.saveFailureText('host-missing', 'ageRestricted')).toBe('アプリに接続できません');
  });

  test('英語ロケールも同じ区別を持つ', async () => {
    setLanguage('en-US');
    const en = await createI18n();
    expect(en.saveFailureText('post-unavailable', 'ageRestricted')).toBe('Could not save');
  });
});

// #367:「保存はできたが、レコードに欠けがある」ときの但し書き。バナーに出すようになった今、
// どの状況がどう名乗るかを文言の水準で固定する＝理由が分かれば理由を名指しし、分からなければ
// 家族を名乗り、画面が欠けを埋めた後は「取得できなかった」とは決して言わない。
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

  // どれも「保存自体は成功した」と読めなければならない＝失敗の文面（何も保存できなかった）と
  // 取り違えられると、但し書きをバナーに出すこと自体が誤報になる。
  test('どの但し書きも「保存しました」で始まり「失敗しました」とは読めない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();

    for (const reason of [undefined, 'protected', 'ageRestricted'] as const) {
      expect(ja.partialSaveText(reason)?.startsWith('保存しました')).toBe(true);
      expect(ja.partialSaveText(reason)).not.toBe(ja.saveFailureText('post-unavailable', reason));
    }
  });

  // #202 と噛み合う。本文や作者を画面から埋めた保存に対して「投稿情報を取得できなかった」と
  // 言うのは事実として誤り＝レコードは空ではない。理由（鍵付き／年齢制限）はここでは黙る＝
  // 中身が埋まった後は、API が答えなかった理由は利用者が手を打つべきことではなくなる。
  test('画面から本文・作者が埋まったら「取れなかった」とは言わない', async () => {
    setLanguage('ja-JP');
    const ja = await createI18n();
    const text = ja.partialSaveText('protected', ['text', 'displayName']);

    expect(text).toBeNull();
  });

  // 画面から拾えたのが数値だけなら「補完した」とは名乗らない＝本文も作者も空のままで、利用者が
  // 見直すべきレコードであることに変わりはない。
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
    expect(en.partialSaveText('protected', ['text'])).toBeNull();
  });
});

// #205: 拡張機能とホストの版がずれたときの案内。これは「失敗」の家族には一切属さない＝保存は
// 既に終わっている。上の bannerFailed* の家族と取り違えられると、保存できているのに何も保存
// されなかったかのように読めてしまうので、その区別が文言の水準で保たれることをここで固定する。
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
