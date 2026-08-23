// parsePostUrl（extension/utils/extractor/index.ts）の回帰テスト＝投稿の URL から
// プラットフォームを同定する。この関数はどの取り込みでも最初に走り、プラットフォームが URL の
// 形を変えたとき真っ先に壊れる。純関数（DOM もネットワークも要らない）。

import { describe, expect, test } from 'vitest';
import { parsePostUrl, parseProfileUrl } from '../extension/utils/extractor/index.ts';

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

  // メディアのタブはプロフィールの下位ページであって、投稿ではない
  test.each(['https://bsky.app/profile/alice.bsky.social/media', 'https://bsky.app/profile/alice.bsky.social'])('投稿でない: %s', (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });
});

describe('Misskey / pixiv', () => {
  test('Misskey ノート', () => {
    expect(parsePostUrl('https://misskey.io/notes/9abcdef')).toEqual({ platform: 'misskey', host: 'misskey.io', noteId: '9abcdef' });
  });

  test.each([
    ['https://www.pixiv.net/artworks/12345', { platform: 'pixiv', id: '12345' }],
    ['https://www.pixiv.net/en/artworks/67890', { platform: 'pixiv', id: '67890' }], // ロケールの接頭辞つき
    ['https://pixiv.net/artworks/24680', { platform: 'pixiv', id: '24680' }],
  ])('pixiv 作品 %s', (url, expected) => {
    expect(parsePostUrl(url)).toEqual(expected);
  });
});

// 投稿でないものと壊れた入力には null を返す（null のレコードは platform:null で保存され、
// 表示側では隠れる。content.js はここへ来る前に打ち切るが、パーサ自身も null を返すという
// 取り決めを持っている）
describe('非投稿・不正入力は null', () => {
  test.each([['https://example.com/foo'], ['https://x.com/alice'], ['not a url'], [''], [null]])('%s', (url) => {
    expect(parsePostUrl(url)).toBeNull();
  });
});

describe('プロフィール URL', () => {
  test('プロフィール自身だけを受け付け、下位ページを除く', () => {
    expect(parseProfileUrl('https://x.com/alice')).toMatchObject({ platform: 'x', screenName: 'alice', url: 'https://x.com/alice' });
    expect(parseProfileUrl('https://bsky.app/profile/alice.bsky.social')).toMatchObject({ platform: 'bluesky', actor: 'alice.bsky.social' });
    expect(parseProfileUrl('https://www.pixiv.net/users/123')).toMatchObject({ platform: 'pixiv', userId: '123' });
    expect(parseProfileUrl('https://x.com/home')).toBeNull();
    expect(parseProfileUrl('https://bsky.app/profile/alice.bsky.social/media')).toBeNull();
  });

  test('インスタンス型サイトは DOM で決めた platform に限定して解析する', () => {
    expect(parseProfileUrl('https://misskey.io/@alice', 'misskey')).toMatchObject({ platform: 'misskey', username: 'alice' });
  });
});
