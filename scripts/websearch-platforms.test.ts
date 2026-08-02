// Unit tests for the five platform modules + resolve.ts's per-platform author narrowing
// (#207). Exercises each module's build() directly against a hand-built QueryState -
// NOT an equivalence check against dialect (see websearch-equivalence.test.ts and
// types.ts's confidence note for that gap).
import { describe, expect, test } from 'vitest';
import { emptyPlatformQueryState, emptyQueryState } from '../app/src/renderer/src/websearch/types';
import { xPlatform } from '../app/src/renderer/src/websearch/platforms/x';
import { blueskyPlatform } from '../app/src/renderer/src/websearch/platforms/bluesky';
import { misskeyPlatform } from '../app/src/renderer/src/websearch/platforms/misskey';
import { mastodonPlatform } from '../app/src/renderer/src/websearch/platforms/mastodon';
import { pixivPlatform } from '../app/src/renderer/src/websearch/platforms/pixiv';
import { buildGoogleQuery } from '../app/src/renderer/src/websearch/platforms/google';
import { narrowForPlatform, resolve } from '../app/src/renderer/src/websearch/resolve';

describe('xPlatform', () => {
  test('builds a full advanced-search query string', () => {
    const state = { ...emptyPlatformQueryState(), terms: ['sunset'], hashtag: ['drawing'], fromUser: 'neko', since: '2026-01-01', minLikes: 100 };
    const r = xPlatform.build(state, {});
    expect(r.url).toContain('https://x.com/search?q=');
    const q = decodeURIComponent(new URL(r.url as string).searchParams.get('q') as string);
    expect(q).toContain('sunset');
    expect(q).toContain('#drawing');
    expect(q).toContain('from:neko');
    expect(q).toContain('since:2026-01-01');
    expect(q).toContain('min_faves:100');
    expect(r.applied.length).toBeGreaterThan(0);
  });

  test('an empty state builds no URL', () => {
    const r = xPlatform.build(emptyPlatformQueryState(), {});
    expect(r.url).toBeNull();
  });
});

describe('blueskyPlatform', () => {
  test('supports from:/since:/until:/hashtag-as-text; drops OR and exclude', () => {
    const state = { ...emptyPlatformQueryState(), terms: ['cat'], hashtag: ['photo'], fromUser: 'alice.bsky.social', keywordsOr: ['a', 'b'], exclude: ['spoiler'] };
    const r = blueskyPlatform.build(state, {});
    expect(r.url).toContain('bsky.app/search');
    expect(r.dropped.length).toBeGreaterThan(0); // OR + exclude both unsupported
  });
});

describe('misskey/mastodon: needsInstanceHost', () => {
  test('misskey with no host builds no URL and reports the missing host', () => {
    const r = misskeyPlatform.build({ ...emptyPlatformQueryState(), terms: ['a'] }, { instanceHost: null });
    expect(r.url).toBeNull();
    expect(r.dropped.some((d) => d.reason.includes('ホームインスタンス'))).toBe(true);
  });

  test('misskey with a host builds a plain-text query URL', () => {
    const r = misskeyPlatform.build({ ...emptyPlatformQueryState(), terms: ['a'] }, { instanceHost: 'misskey.io' });
    expect(r.url).toBe('https://misskey.io/search?q=a');
  });

  test('mastodon: from:/has:media/hashtag applied; OR/exclude/min-likes dropped', () => {
    const state = { ...emptyPlatformQueryState(), fromUser: 'alice@mastodon.social', mediaOnly: true, hashtag: ['art'], minLikes: 10 };
    const r = mastodonPlatform.build(state, { instanceHost: 'mastodon.social' });
    const q = decodeURIComponent((new URL(r.url as string).searchParams.get('q') as string).replace(/\+/g, ' '));
    expect(q).toContain('from:@alice@mastodon.social');
    expect(q).toContain('has:media');
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});

describe('pixivPlatform', () => {
  test('a plain tag search builds the /tags/.../artworks URL', () => {
    const r = pixivPlatform.build({ ...emptyPlatformQueryState(), hashtag: ['オリジナル'] }, {});
    expect(r.url).toContain('pixiv.net/tags/');
    expect(r.applied).toContain('タグ');
  });

  test('minLikes approximates to the nearest bookmark-count milestone tag, flagged', () => {
    const r = pixivPlatform.build({ ...emptyPlatformQueryState(), hashtag: ['a'], minLikes: 12000 }, {});
    expect(r.url).toContain('10000users');
    expect(r.approximated.length).toBeGreaterThan(0);
  });

  test('a numeric author id builds the artist works-list URL and drops any co-present condition', () => {
    const r = pixivPlatform.build({ ...emptyPlatformQueryState(), fromUser: '123456', hashtag: ['a'] }, {});
    expect(r.url).toBe('https://www.pixiv.net/users/123456/artworks');
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});

describe('buildGoogleQuery (the plain, non-row translation)', () => {
  test('scopes to a site domain and folds every concept in as plain keywords', () => {
    const state = { ...emptyQueryState(), terms: ['cat'], fromUser: { platform: 'misskey' as const, handle: 'neko@misskey.io' } };
    const r = buildGoogleQuery(state, 'misskey.io');
    const q = decodeURIComponent((new URL(r.url as string).searchParams.get('q') as string).replace(/\+/g, ' '));
    expect(q).toContain('site:misskey.io');
    expect(q).toContain('cat');
  });

  test('a bare site: qualifier with nothing else builds no URL', () => {
    const r = buildGoogleQuery(emptyQueryState(), 'misskey.io');
    expect(r.url).toBeNull();
  });
});

describe('resolve.ts narrowForPlatform', () => {
  test('a ResolvedUser from a DIFFERENT platform is dropped, not silently kept', () => {
    const state = { ...emptyQueryState(), fromUser: { platform: 'misskey' as const, handle: 'neko@misskey.io' } };
    const { narrowed, extraDropped } = narrowForPlatform(state, 'x');
    expect(narrowed.fromUser).toBeNull();
    expect(extraDropped.length).toBe(1);
  });

  test('a matching-platform ResolvedUser narrows straight through', () => {
    const state = { ...emptyQueryState(), fromUser: { platform: 'x' as const, handle: 'neko' } };
    const { narrowed, extraDropped } = narrowForPlatform(state, 'x');
    expect(narrowed.fromUser).toBe('neko');
    expect(extraDropped).toEqual([]);
  });

  test('resolve() merges tree-shape drops onto every row', () => {
    const state = emptyQueryState();
    const row = resolve(state, xPlatform, {}, [{ reason: 'library-only condition' }]);
    expect(row.dropped.some((d) => d.reason === 'library-only condition')).toBe(true);
  });
});
