// extension/utils/background.ts の純粋関数群（chrome.* に依存しない部分）の単体テスト。
// #127: service worker の司令塔はこれまでテストが1件も無かった。送信元の検証（セキュリティ
// 境界）と保存レコードの組み立ては chrome.* 無しで直接呼べる。
// そこで startBackground() の外へ出し、ここから検証する。

import { describe, expect, test } from 'vitest';
import { buildRecord, generateCaptureId, isAllowedSender, missingMediaCount } from '../extension/utils/background';

describe('isAllowedSender — 送信元タブの origin 検証', () => {
  test.each([
    ['https://x.com/alice/status/123', 'x', true],
    ['https://twitter.com/alice/status/123', 'x', true],
    ['https://pro.x.com/alice/status/123', 'x', true], // サブドメインも許す
    ['https://mobile.twitter.com/alice/status/123', 'x', true],
    ['https://evil.com/x.com', 'x', false], // ホスト名が一致しない偽装
    ['https://bsky.app/profile/alice/post/1', 'bluesky', true],
    ['https://x.com/alice/status/123', 'bluesky', false], // platform とホストが噛み合っていない
    ['https://www.pixiv.net/artworks/1', 'pixiv', true],
    ['https://pixiv.net/artworks/1', 'pixiv', true],
  ])('%s / %s → %s', (tabUrl, platformId, expected) => {
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

describe('missingMediaCount — 保存できなかった画像数', () => {
  test('15枚を要求してホスト上限の12枚だけ保存した場合は3枚を通知する', () => {
    expect(missingMediaCount(15, 12)).toBe(3);
  });

  test('選択した1枚を保存できた場合は不足なし', () => {
    expect(missingMediaCount(1, 1)).toBe(0);
  });

  test('保存済み数が要求数を超えても負数にしない', () => {
    expect(missingMediaCount(1, 2)).toBe(0);
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
