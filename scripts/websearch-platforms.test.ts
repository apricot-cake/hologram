// 5つのプラットフォームのモジュールと、resolve.ts のプラットフォームごとの投稿者の絞り込み
// (#207) の単体テスト。手で組んだ QueryState に対して各モジュールの build() を直に走らせる
// ＝dialect との同値検査ではない（その穴については websearch-equivalence.test.ts と
// types.ts の confidence の注記を参照）。
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
  test('高度な検索のクエリ文字列を一通り組み立てる', () => {
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

  test('空の state からは URL を組み立てない', () => {
    const r = xPlatform.build(emptyPlatformQueryState(), {});
    expect(r.url).toBeNull();
  });
});

describe('blueskyPlatform', () => {
  test('from:/since:/until:/テキストとしてのハッシュタグ/exclude に対応し、落とすのは keywordsOr だけ', () => {
    const state = { ...emptyPlatformQueryState(), terms: ['cat'], hashtag: ['photo'], fromUser: 'alice.bsky.social', keywordsOr: ['a', 'b'], exclude: ['spoiler'] };
    const r = blueskyPlatform.build(state, {});
    expect(r.url).toContain('bsky.app/search');
    const q = decodeURIComponent(new URL(r.url as string).searchParams.get('q') as string);
    expect(q).toContain('-spoiler');
    expect(r.dropped.length).toBeGreaterThan(0); // ここで対応していない概念は keywordsOr だけ
  });

  // #822: dialect 自身の GUI キャプチャ (issue #27) が、Bluesky では hashtagOr が &tag=
  // として本当に効くことを確かめた。あの Issue が疑いとして記録し、用心のため以前は落として
  // いたもの。
  test('hashtagOr は &tag= へ変換される（Bluesky に実在すると確認済み。落とさない）', () => {
    const r = blueskyPlatform.build({ ...emptyPlatformQueryState(), hashtagOr: ['cat', 'dog'] }, {});
    expect(new URL(r.url as string).searchParams.get('tag')).toBe('cat dog');
    expect(r.applied).toContain('ハッシュタグ（いずれか）');
  });

  test('excludeUser/excludeHashtag/mediaOnly/videoOnly/replies は、どれも専用のパラメータへ変換される', () => {
    const state = { ...emptyPlatformQueryState(), terms: ['cat'], excludeUser: ['bob'], excludeHashtag: ['spoiler'], mediaOnly: true, videoOnly: true, repliesOnly: true };
    const r = blueskyPlatform.build(state, {});
    const url = new URL(r.url as string);
    expect(url.searchParams.get('excludeAuthor')).toBe('bob');
    expect(url.searchParams.get('excludeTag')).toBe('spoiler');
    expect(url.searchParams.get('media')).toBe('true');
    expect(url.searchParams.get('video')).toBe('true');
    expect(url.searchParams.get('replies')).toBe('only');
  });
});

describe('misskey/mastodon: needsInstanceHost', () => {
  test('misskey はホストが無いと URL を組み立てず、ホストが欠けていることを報告する', () => {
    const r = misskeyPlatform.build({ ...emptyPlatformQueryState(), terms: ['a'] }, { instanceHost: null });
    expect(r.url).toBeNull();
    expect(r.dropped.some((d) => d.reason.includes('ホームインスタンス'))).toBe(true);
  });

  test('misskey はホストがあれば素のテキストのクエリ URL を組み立てる', () => {
    const r = misskeyPlatform.build({ ...emptyPlatformQueryState(), terms: ['a'] }, { instanceHost: 'misskey.io' });
    expect(r.url).toBe('https://misskey.io/search?q=a&type=note');
  });

  test('misskey: exclude とリモートの投稿者はどちらも変換される（#822＝dialect が両方とも効くと確認）', () => {
    const r = misskeyPlatform.build({ ...emptyPlatformQueryState(), terms: ['a'], exclude: ['b'], fromUser: 'neko@misskey.io' }, { instanceHost: 'misskey.io' });
    expect(r.url).toBe('https://misskey.io/search?q=a%20-b&type=note&username=neko&host=misskey.io');
  });

  test('mastodon: from:/has:media/hashtag/exclude は適用し、OR と min-likes は落とす', () => {
    const state = { ...emptyPlatformQueryState(), fromUser: 'alice@mastodon.social', exclude: ['spoiler'], mediaOnly: true, hashtag: ['art'], minLikes: 10 };
    const r = mastodonPlatform.build(state, { instanceHost: 'mastodon.social' });
    const q = decodeURIComponent((new URL(r.url as string).searchParams.get('q') as string).replace(/\+/g, ' '));
    // #822: dialect 自身の GUI キャプチャで、from:user@host には先頭の @ が付かないと
    // 分かった（このモジュールが以前使っていた from:@user@host は、機械で確かめたことが
    // 一度も無かった）。
    expect(q).toContain('from:alice@mastodon.social');
    expect(q).not.toContain('from:@alice');
    expect(q).toContain('has:media');
    expect(q).toContain('-spoiler');
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});

describe('pixivPlatform', () => {
  test('素のタグ検索は /tags/.../artworks の URL を組み立てる', () => {
    const r = pixivPlatform.build({ ...emptyPlatformQueryState(), hashtag: ['オリジナル'] }, {});
    expect(r.url).toContain('pixiv.net/tags/');
    expect(r.applied).toContain('タグ');
  });

  test('minLikes は最寄りのブックマーク数の節目タグへ近似し、近似した印を付ける', () => {
    const r = pixivPlatform.build({ ...emptyPlatformQueryState(), hashtag: ['a'], minLikes: 12000 }, {});
    expect(r.url).toContain('10000users');
    expect(r.approximated.length).toBeGreaterThan(0);
  });

  test('数値の作者 id は作者の作品一覧の URL を組み立て、同時に付いていた条件は落とす', () => {
    const r = pixivPlatform.build({ ...emptyPlatformQueryState(), fromUser: '123456', hashtag: ['a'] }, {});
    expect(r.url).toBe('https://www.pixiv.net/users/123456/artworks');
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});

describe('buildGoogleQuery（行を作らない素の変換）', () => {
  test('site のドメインへ絞り込み、どの概念も素のキーワードとして畳み込む', () => {
    const state = { ...emptyQueryState(), terms: ['cat'], fromUser: { platform: 'misskey' as const, handle: 'neko@misskey.io' } };
    const r = buildGoogleQuery(state, 'misskey.io');
    const q = decodeURIComponent((new URL(r.url as string).searchParams.get('q') as string).replace(/\+/g, ' '));
    expect(q).toContain('site:misskey.io');
    expect(q).toContain('cat');
  });

  test('site: の修飾だけで他に何も無ければ URL を組み立てない', () => {
    const r = buildGoogleQuery(emptyQueryState(), 'misskey.io');
    expect(r.url).toBeNull();
  });
});

describe('resolve.ts narrowForPlatform', () => {
  test('別のプラットフォームの ResolvedUser は、黙って残さず必ず落とす', () => {
    const state = { ...emptyQueryState(), fromUser: { platform: 'misskey' as const, handle: 'neko@misskey.io' } };
    const { narrowed, extraDropped } = narrowForPlatform(state, 'x');
    expect(narrowed.fromUser).toBeNull();
    expect(extraDropped.length).toBe(1);
  });

  test('プラットフォームが一致する ResolvedUser はそのまま通る', () => {
    const state = { ...emptyQueryState(), fromUser: { platform: 'x' as const, handle: 'neko' } };
    const { narrowed, extraDropped } = narrowForPlatform(state, 'x');
    expect(narrowed.fromUser).toBe('neko');
    expect(extraDropped).toEqual([]);
  });

  test('resolve() は、クエリ木の形から出た「落とした条件」を全ての行へ混ぜ込む', () => {
    const state = emptyQueryState();
    const row = resolve(state, xPlatform, {}, [{ reason: 'library-only condition' }]);
    expect(row.dropped.some((d) => d.reason === 'library-only condition')).toBe(true);
  });
});
