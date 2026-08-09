// extension/utils/extractor/index.ts の登録簿そのものが満たすべき不変条件 (#212)。
//
// サイトごとの読み取りが正しいかは content-fixtures.test.ts（DOM 側）と parse-url /
// metadata-* / media-identity（URL・API 側）が見ている。ここが見るのは「登録簿が唯一の
// 正本であること」＝#212 が行き着いた形の不具合を、値を検査して塞ぐ。その形とは、DOM 側と
// URL 側が同じ platform の文字列を名乗ることだけで繋がっていて、ずれても型の体系では
// 検知できない、というもの。

import { describe, expect, test } from 'vitest';
import { API_HOST_PERMISSIONS, EXTRACTORS, RESIDENT_MATCHES, extractorFor } from '../extension/utils/extractor/index.ts';

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
      expect(extractor.capture.platform).toBe(extractor.platform);
      if (extractor.mediaIdentity) expect(extractor.mediaIdentity.platform).toBe(extractor.platform);
    }
  });

  test('インスタンス型（任意ホスト）のサイトは固定ホストのサイトより後ろに並ぶ', () => {
    // Misskey / Mastodon は URL のパターンでもページの判定でもホストを問わない。だから
    // 先に並んでいると、他のサイトが答える機会を得る前に、そのサイトのページへ答えて
    // しまう。登録簿の並び順は意図してそうしている。
    const firstInstanceHosted = EXTRACTORS.findIndex((e) => Boolean(e.derivedApiHost));
    const lastFixedHost = EXTRACTORS.map((e) => Boolean(e.derivedApiHost)).lastIndexOf(false);
    expect(firstInstanceHosted).toBeGreaterThan(lastFixedHost);
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
});
