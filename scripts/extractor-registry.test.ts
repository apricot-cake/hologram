// extension/utils/extractor/index.ts の登録簿そのものが満たすべき不変条件（#212）。
//
// 個々のサイトの読み取りが正しいかは content-fixtures.test.ts（DOM 相）と
// parse-url / metadata-* / media-identity（URL・API 相）が見る。ここが見るのは
// 「登録簿が唯一の真実源である」ことのほうで、#212 が畳んだ事故の型＝**DOM 側と
// URL 側が同じ platform 文字列を名乗っているだけで繋がっており、ずれても型では
// 検出できない**を、値として突き合わせて塞ぐ。

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
    // #212 以前はこの一致が「同じ文字列を書いたから」でしか成り立っていなかった。
    for (const extractor of EXTRACTORS) {
      expect(extractor.capture.platform).toBe(extractor.platform);
      if (extractor.mediaIdentity) expect(extractor.mediaIdentity.platform).toBe(extractor.platform);
    }
  });

  test('インスタンス型（任意ホスト）のサイトは固定ホストのサイトより後ろに並ぶ', () => {
    // Misskey / Mastodon は URL パターンもページ判定もホストを問わないので、
    // 先に並ぶと他サイトのページに対して先に答えてしまう。登録簿の並び順は仕様。
    const firstInstanceHosted = EXTRACTORS.findIndex((e) => Boolean(e.derivedApiHost));
    const lastFixedHost = EXTRACTORS.map((e) => Boolean(e.derivedApiHost)).lastIndexOf(false);
    expect(firstInstanceHosted).toBeGreaterThan(lastFixedHost);
  });

  test('DOM 相を持つのは常駐対象として名乗り出たサイトだけ', () => {
    // 常駐コンテンツスクリプトが載らないサイトに mediaIdentity / overlay があっても
    // 到達しない＝登録簿の記述と manifest の match が食い違っているということ。
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
