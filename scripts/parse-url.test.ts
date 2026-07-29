// parsePostUrl（extension/utils/extractor/index.ts）の回帰テスト: 投稿 URL → プラットフォーム
// 同定。取り込みのたび最初に走る関数であり、プラットフォーム側の URL 体系変更で最初に
// 壊れる場所。純関数（DOM もネットワークも要らない）。

import { describe, expect, test } from 'vitest';
import { parsePostUrl } from '../extension/utils/extractor/index.ts';

describe('X / Twitter（content.js が受け付ける pro./mobile. サブドメイン込み）', () => {
  test.each([
    ['https://x.com/alice/status/123', { platform: 'x', id: '123', screenName: 'alice' }],
    ['https://twitter.com/bob/status/456', { platform: 'x', id: '456', screenName: 'bob' }],
    ['https://pro.x.com/carol/status/789', { platform: 'x', id: '789', screenName: 'carol' }],
    ['https://mobile.twitter.com/dave/status/111', { platform: 'x', id: '111', screenName: 'dave' }],
    ['https://x.com/alice/status/123/photo/1', { platform: 'x', id: '123', screenName: 'alice' }],
  ])('%s', (url, expected) => {
    expect(parsePostUrl(url)).toEqual(expected);
  });
});

describe('Bluesky', () => {
  test.each([
    ['https://bsky.app/profile/alice.bsky.social/post/3kabc', { platform: 'bluesky', handle: 'alice.bsky.social', rkey: '3kabc' }],
    ['https://bsky.app/profile/alice.bsky.social/post/3kabc?ref=x', { platform: 'bluesky', handle: 'alice.bsky.social', rkey: '3kabc' }],
  ])('%s', (url, expected) => {
    expect(parsePostUrl(url)).toEqual(expected);
  });

  // メディアタブはプロフィールの下位ページであって投稿ではない
  test.each(['https://bsky.app/profile/alice.bsky.social/media', 'https://bsky.app/profile/alice.bsky.social'])('投稿でない: %s', (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });
});

describe('Mastodon: status（/@user/<numericId>）とプロフィール下位ページの区別', () => {
  test('status', () => {
    expect(parsePostUrl('https://mastodon.social/@alice/109252111')).toEqual({ platform: 'mastodon', host: 'mastodon.social', id: '109252111' });
  });

  test.each(['https://mastodon.social/@alice/media', 'https://mastodon.social/@alice'])('投稿でない: %s', (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });
});

describe('Misskey / pixiv', () => {
  test('Misskey ノート', () => {
    expect(parsePostUrl('https://misskey.io/notes/9abcdef')).toEqual({ platform: 'misskey', host: 'misskey.io', noteId: '9abcdef' });
  });

  test.each([
    ['https://www.pixiv.net/artworks/12345', { platform: 'pixiv', id: '12345' }],
    ['https://www.pixiv.net/en/artworks/67890', { platform: 'pixiv', id: '67890' }], // ロケール接頭辞つき
    ['https://pixiv.net/artworks/24680', { platform: 'pixiv', id: '24680' }],
  ])('pixiv 作品 %s', (url, expected) => {
    expect(parsePostUrl(url)).toEqual(expected);
  });
});

// 投稿でないもの・壊れた入力は null（null レコードは platform:null で保存され
// ビューアで隠れる。content.js はその前に打ち切るが、パーサ自体は null と言う契約）
describe('非投稿・不正入力は null', () => {
  test.each([['https://example.com/foo'], ['https://x.com/alice'], ['not a url'], [''], [null]])('%s', (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });
});
