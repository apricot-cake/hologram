// extension/utils/extractor/index.ts の登録簿そのものが満たすべき不変条件 (#212)。
//
// サイトごとの読み取りが正しいかは content-fixtures.test.ts（DOM 側）と parse-url /
// metadata-* / media-identity（URL・API 側）が見ている。ここが見るのは「登録簿が唯一の
// 正本であること」＝#212 が行き着いた形の不具合を、値を検査して塞ぐ。その形とは、DOM 側と
// URL 側が同じ platform の文字列を名乗ることだけで繋がっていて、ずれても型の体系では
// 検知できない、というもの。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { API_HOST_PERMISSIONS, EXTRACTORS, RESIDENT_MATCHES, extractorFor } from '../extension/utils/extractor/index.ts';

afterEach(() => vi.unstubAllGlobals());

describe('extractor 登録簿', () => {
  test('platform は一意で、登録簿から引き直すと同じモジュールに戻る', () => {
    const platforms = EXTRACTORS.map((e) => e.platform);
    expect(new Set(platforms).size).toBe(platforms.length);
    for (const extractor of EXTRACTORS) {
      expect(extractorFor(extractor.platform)).toBe(extractor);
    }
  });

  test('各相が名乗る platform はモジュールの platform と一致する', () => {
    // #212 より前、この一致は「誰かが同じ文字列を書いた」からそうなっていただけだった。
    for (const extractor of EXTRACTORS) {
      expect(extractor.content.platform).toBe(extractor.platform);
      if (extractor.mediaIdentity) expect(extractor.mediaIdentity.platform).toBe(extractor.platform);
    }
  });

  test('DOM 相を持つのは常駐対象として名乗り出たサイトだけ', () => {
    // 常駐スクリプトを持たないサイトが mediaIdentity や overlay を持っていても、そこへは
    // 到達できない＝登録簿の記述と manifest の match がずれているということ。
    for (const extractor of EXTRACTORS) {
      const resident = Boolean(extractor.residentMatches?.length);
      expect(Boolean(extractor.mediaIdentity)).toBe(resident);
      expect(Boolean(extractor.overlay)).toBe(resident);
    }
  });

  test('manifest へ渡す match / host_permissions は登録簿から組み上がる', () => {
    expect(RESIDENT_MATCHES.length).toBeGreaterThan(0);
    expect(API_HOST_PERMISSIONS.length).toBeGreaterThan(0);
    for (const pattern of [...RESIDENT_MATCHES, ...API_HOST_PERMISSIONS]) {
      expect(pattern).toMatch(/^https:\/\/[^/]+\/\*$/);
    }
    expect(RESIDENT_MATCHES).toEqual(EXTRACTORS.flatMap((e) => [...(e.residentMatches ?? [])]));
  });

  test('Bluesky Saved Posts は一括取り込みページとして識別する', () => {
    const bluesky = extractorFor('bluesky');
    vi.stubGlobal('location', { pathname: '/saved' });
    expect(bluesky?.content.isBulkCapturePage?.()).toBe(true);
    expect(bluesky?.content.capturedVia).toBe('bluesky-saved');
    vi.stubGlobal('location', { pathname: '/profile/alice.bsky.social' });
    expect(bluesky?.content.isBulkCapturePage?.()).toBe(false);
  });

  test('X は現行と旧形式のブックマーク一覧だけを一括取り込みページとして識別する', () => {
    const x = extractorFor('x');
    for (const pathname of ['/i/history', '/i/history/', '/i/bookmarks', '/i/bookmarks/folder-id']) {
      vi.stubGlobal('location', { pathname });
      expect(x?.content.isBulkCapturePage?.()).toBe(true);
    }
    for (const pathname of ['/i/history/likes', '/home', '/search']) {
      vi.stubGlobal('location', { pathname });
      expect(x?.content.isBulkCapturePage?.()).toBe(false);
    }
  });
});
