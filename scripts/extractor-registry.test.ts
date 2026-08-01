// Invariants that the registry itself in extension/utils/extractor/index.ts must
// satisfy (#212).
//
// Whether each individual site's reading is correct is covered by
// content-fixtures.test.ts (the DOM side) and parse-url / metadata-* /
// media-identity (the URL/API side). What this covers instead is "the registry
// is the single source of truth" — closing off, by checking values, the shape of
// bug that #212 collapsed into: **the DOM side and the URL side are only
// connected by claiming the same platform string, and if they drift apart the
// type system can't detect it**.

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
    // Before #212, this match only held because "someone wrote the same string" — nothing more.
    for (const extractor of EXTRACTORS) {
      expect(extractor.capture.platform).toBe(extractor.platform);
      if (extractor.mediaIdentity) expect(extractor.mediaIdentity.platform).toBe(extractor.platform);
    }
  });

  test('インスタンス型（任意ホスト）のサイトは固定ホストのサイトより後ろに並ぶ', () => {
    // Misskey / Mastodon don't care about host in either their URL pattern or
    // page detection, so if they were listed first they'd answer for other
    // sites' pages before those sites get a chance. The registry's ordering is by design.
    const firstInstanceHosted = EXTRACTORS.findIndex((e) => Boolean(e.derivedApiHost));
    const lastFixedHost = EXTRACTORS.map((e) => Boolean(e.derivedApiHost)).lastIndexOf(false);
    expect(firstInstanceHosted).toBeGreaterThan(lastFixedHost);
  });

  test('DOM 相を持つのは常駐対象として名乗り出たサイトだけ', () => {
    // Even if a site with no resident content script has mediaIdentity / overlay,
    // it's unreachable = it means the registry's description and the manifest's match are out of sync.
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
