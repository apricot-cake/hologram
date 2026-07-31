// extension/utils/background.ts の純関数群（chrome.* に依存しない部分）の単体テスト。
// #127: サービスワーカーの司令塔は今までテストゼロだったが、送信元検証（セキュリティ境界）
// と画像URL同定（正規表現主体で退行しやすい）だけは chrome.* なしで直接呼べるので、
// startBackground() の外へ出してここから検証する。

import { describe, expect, test } from 'vitest';
import { buildRecord, generateCaptureId, hiRes, isAllowedSender, matchMediaIndex, pickPrimaryImage } from '../extension/utils/background';

describe('isAllowedSender — 送信元タブの origin 検証', () => {
  test.each([
    ['https://x.com/alice/status/123', 'x', true],
    ['https://twitter.com/alice/status/123', 'x', true],
    ['https://pro.x.com/alice/status/123', 'x', true], // サブドメインも許容
    ['https://mobile.twitter.com/alice/status/123', 'x', true],
    ['https://evil.com/x.com', 'x', false], // ホスト名が一致しない偽装
    ['https://bsky.app/profile/alice/post/1', 'bluesky', true],
    ['https://x.com/alice/status/123', 'bluesky', false], // プラットフォームとホストの不一致
    ['https://www.pixiv.net/artworks/1', 'pixiv', true],
    ['https://pixiv.net/artworks/1', 'pixiv', true],
  ])('%s / %s → %s', (tabUrl, platformId, expected) => {
    expect(isAllowedSender(tabUrl, platformId)).toBe(expected);
  });

  test.each([
    ['https://mastodon.social/@alice/1', 'mastodon', true],
    ['https://misskey.io/notes/abc', 'misskey', true],
    ['http://mastodon.social/@alice/1', 'mastodon', false], // https 限定
  ])('misskey/mastodon は任意ホストの https のみ許容: %s / %s → %s', (tabUrl, platformId, expected) => {
    expect(isAllowedSender(tabUrl, platformId)).toBe(expected);
  });

  test('未知の platformId は拒否', () => {
    expect(isAllowedSender('https://x.com/alice/status/123', 'unknown')).toBe(false);
  });

  test('壊れた URL / 空文字は拒否', () => {
    expect(isAllowedSender('not-a-url', 'x')).toBe(false);
    expect(isAllowedSender('', 'x')).toBe(false);
    expect(isAllowedSender(undefined as unknown as string, 'x')).toBe(false);
  });
});

// 画像 URL の同一性キー（mediaKeyOf）そのものは media-identity.test.ts が見る＝
// 保存済み判定（#334）と共有する1つの規則なので、家はそちら。ここが見るのはその
// 使い手であるドラッグ経路の突き合わせ。
describe('matchMediaIndex — ドラッグ画像が post.media[] の何番目か', () => {
  test('鍵が一致するインデックスを返す', () => {
    const media = [{ url: 'https://pbs.twimg.com/media/AAA?format=jpg' }, { url: 'https://pbs.twimg.com/media/BBB?format=jpg' }];
    expect(matchMediaIndex('x', ['https://pbs.twimg.com/media/BBB?name=orig'], media)).toBe(1);
  });

  test('一致なしは -1', () => {
    const media = [{ url: 'https://pbs.twimg.com/media/AAA?format=jpg' }];
    expect(matchMediaIndex('x', ['https://pbs.twimg.com/media/ZZZ?format=jpg'], media)).toBe(-1);
  });

  test('キー抽出できる url が1つもなければ -1', () => {
    expect(matchMediaIndex('x', [''], [{ url: 'https://pbs.twimg.com/media/AAA?format=jpg' }])).toBe(-1);
  });
});

describe('hiRes — 原寸化', () => {
  test('x: name=orig を付与', () => {
    const result = hiRes('x', 'https://pbs.twimg.com/media/AAA?format=jpg&name=small');
    expect(new URL(result).searchParams.get('name')).toBe('orig');
  });

  test('bluesky: 末尾の @jpeg を外す', () => {
    expect(hiRes('bluesky', 'https://cdn.bsky.app/img/feed_thumbnail/plain/xyz@jpeg')).toBe('https://cdn.bsky.app/img/feed_thumbnail/plain/xyz');
  });

  test('対象外の platform/url はそのまま返す', () => {
    expect(hiRes('pixiv', 'https://i.pximg.net/img-original/x/1_p0.png')).toBe('https://i.pximg.net/img-original/x/1_p0.png');
    expect(hiRes('x', 'https://example.com/not-twimg.jpg')).toBe('https://example.com/not-twimg.jpg');
  });

  test('url が falsy ならそのまま返す', () => {
    expect(hiRes('x', '')).toBe('');
    expect(hiRes('x', null as unknown as string)).toBeNull();
  });
});

describe('pickPrimaryImage — ドラッグ画像1枚から保存する原寸 URL を選ぶ', () => {
  test('pixiv: ドラッグ画像のページ番号 (_p<N>) で media[] を引き当てる', () => {
    const meta = { media: [{ url: 'https://i.pximg.net/img-original/x/1_p0.png' }, { url: 'https://i.pximg.net/img-original/x/1_p1.png', referer: 'https://www.pixiv.net/' }] };
    const result = pickPrimaryImage('pixiv', ['https://i.pximg.net/c/600x1200/img-master/x/1_p1_master1200.jpg'], meta);
    expect(result).toEqual({ url: 'https://i.pximg.net/img-original/x/1_p1.png', referer: 'https://www.pixiv.net/', index: 1 });
  });

  test('pixiv: ページ番号が一致しない（未対応の URL 形状）ときはドラッグ URL のまま、index は -1', () => {
    const meta = { media: [{ url: 'https://i.pximg.net/img-original/x/1_p0.png' }, { url: 'https://i.pximg.net/img-original/x/1_p1.png' }] };
    const result = pickPrimaryImage('pixiv', ['https://i.pximg.net/somewhere/unmatched.jpg'], meta);
    expect(result).toEqual({ url: 'https://i.pximg.net/somewhere/unmatched.jpg', referer: 'https://www.pixiv.net/', index: -1 });
  });

  test('pixiv: media が1枚だけならページ番号なしでも引き当てる', () => {
    const meta = { media: [{ url: 'https://i.pximg.net/img-original/x/1_p0.png', referer: 'https://www.pixiv.net/' }] };
    const result = pickPrimaryImage('pixiv', ['https://i.pximg.net/somewhere/unmatched.jpg'], meta);
    expect(result).toEqual({ url: 'https://i.pximg.net/img-original/x/1_p0.png', referer: 'https://www.pixiv.net/', index: 0 });
  });

  test('x: mediaKey で一致した media[] エントリを使う', () => {
    const meta = { media: [{ url: 'https://pbs.twimg.com/media/AAA?format=jpg', referer: undefined }] };
    const result = pickPrimaryImage('x', ['https://pbs.twimg.com/media/AAA?name=small'], meta);
    expect(result).toEqual({ url: 'https://pbs.twimg.com/media/AAA?format=jpg', referer: undefined, index: 0 });
  });

  test('x: 一致しない場合はドラッグ URL を hiRes 化して使う（media が1枚ならindex 0）', () => {
    const meta = { media: [{ url: 'https://pbs.twimg.com/media/BBB?format=jpg' }] };
    const result = pickPrimaryImage('x', ['https://pbs.twimg.com/media/AAA?name=small'], meta);
    expect(result.url).toContain('name=orig');
    expect(result.index).toBe(0);
  });

  test('media が空でも例外にならない（呼び出し側で null/url なしを見て弾く）', () => {
    const result = pickPrimaryImage('x', ['https://pbs.twimg.com/media/AAA?name=small'], { media: [] });
    expect(result.index).toBe(-1);
  });
});

describe('buildRecord — サイドカーレコードの組み立て', () => {
  const base = { captureId: 'cap1', capturedAt: '2026-07-27T00:00:00.000Z', postUrl: 'https://x.com/alice/status/1', sendPlatform: 'x', extra: { image: 'cap1.jpg' } };

  test('meta の各フィールドをレコードへ写す', () => {
    const meta = { url: 'https://x.com/alice/status/1', platform: 'x', text: 'hello', displayName: 'Alice', likes: 3, date: '2026-01-01T00:00:00.000Z', hashtags: ['a'], tags: [] };
    const rec = buildRecord(meta, base);
    expect(rec).toMatchObject({ captureId: 'cap1', url: 'https://x.com/alice/status/1', platform: 'x', text: 'hello', displayName: 'Alice', likes: 3, date: '2026-01-01T00:00:00.000Z', image: 'cap1.jpg' });
    expect(rec.capturedAt).toBe('2026-07-27T00:00:00.000Z');
    expect(rec.updatedAt).toBe('2026-07-27T00:00:00.000Z');
  });

  test('meta.url が無ければ postUrl にフォールバック', () => {
    const rec = buildRecord({}, base);
    expect(rec.url).toBe('https://x.com/alice/status/1');
  });

  test('meta.platform が無ければ sendPlatform にフォールバック（URL がパースできなかった場合）', () => {
    const rec = buildRecord({ platform: null }, base);
    expect(rec.platform).toBe('x');
  });

  test('meta.date が無ければ null（capturedAt へフォールバックしない）', () => {
    const rec = buildRecord({}, base);
    expect(rec.date).toBeNull();
  });

  test('hashtags / tags は未指定なら空配列', () => {
    const rec = buildRecord({}, base);
    expect(rec.hashtags).toEqual([]);
    expect(rec.tags).toEqual([]);
  });

  test('extra はレコードへマージされる（同名キーは extra が勝つ）', () => {
    const rec = buildRecord({ text: 'from-meta' }, { ...base, extra: { text: 'from-extra' } });
    expect(rec.text).toBe('from-extra');
  });

  // #188: pixiv シリーズ情報も他の meta フィールドと同じ経路でレコードへ写る
  test('meta.seriesId/seriesTitle/seriesOrder をレコードへ写す', () => {
    const rec = buildRecord({ seriesId: '12345', seriesTitle: 'ある冒険', seriesOrder: 3 }, base);
    expect({ seriesId: rec.seriesId, seriesTitle: rec.seriesTitle, seriesOrder: rec.seriesOrder }).toEqual({ seriesId: '12345', seriesTitle: 'ある冒険', seriesOrder: 3 });
  });
});

describe('generateCaptureId — #125 の外部参照キーになる想定なので形式を固定する', () => {
  test('`<epoch ms>-<4桁16進>` の形式', () => {
    expect(generateCaptureId()).toMatch(/^\d+-[0-9a-f]{4}$/);
  });

  test('連続呼び出しでも重複しにくい（乱数部を含む）', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateCaptureId()));
    expect(ids.size).toBeGreaterThan(1);
  });
});
