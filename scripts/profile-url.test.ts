// Pure unit tests for posterProfileUrl (#663): builds URLs for 5 platforms. For
// misskey/mastodon, pins down both the local and remote cases (whether screenName has an @host).

import { describe, expect, test } from 'vitest';
import { posterProfileUrl } from '../app/src/renderer/src/services/profile-url';

describe('posterProfileUrl', () => {
  test('x: ハンドルのみ', () => {
    expect(posterProfileUrl({ platform: 'x', screenName: 'alice' })).toBe('https://x.com/alice');
  });

  test('bluesky: ハンドル', () => {
    expect(posterProfileUrl({ platform: 'bluesky', screenName: 'alice.bsky.social' })).toBe('https://bsky.app/profile/alice.bsky.social');
  });

  test('bluesky: DIDでも同じ経路で組み立つ（bsky.appはDIDも解決する）', () => {
    expect(posterProfileUrl({ platform: 'bluesky', screenName: 'did:plc:abc123' })).toBe('https://bsky.app/profile/did:plc:abc123');
  });

  test('misskey: ローカルユーザー（screenNameに@hostなし）はインスタンス+ユーザー名', () => {
    expect(posterProfileUrl({ platform: 'misskey', screenName: 'carol', instance: 'misskey.io' })).toBe('https://misskey.io/@carol');
  });

  test('misskey: リモートユーザー（screenNameが user@host）はそのまま連結', () => {
    expect(posterProfileUrl({ platform: 'misskey', screenName: 'dave@remote.example', instance: 'misskey.io' })).toBe('https://misskey.io/@dave@remote.example');
  });

  test('misskey: インスタンス不明ならリンクを出さない', () => {
    expect(posterProfileUrl({ platform: 'misskey', screenName: 'carol', instance: null })).toBeNull();
  });

  test('mastodon: ローカルユーザー（acctがusernameのみ）', () => {
    expect(posterProfileUrl({ platform: 'mastodon', screenName: 'erin', instance: 'mastodon.social' })).toBe('https://mastodon.social/@erin');
  });

  test('mastodon: リモートユーザー（acctがusername@host）', () => {
    expect(posterProfileUrl({ platform: 'mastodon', screenName: 'frank@fedi.example', instance: 'mastodon.social' })).toBe('https://mastodon.social/@frank@fedi.example');
  });

  test('mastodon: インスタンス不明ならリンクを出さない', () => {
    expect(posterProfileUrl({ platform: 'mastodon', screenName: 'erin', instance: undefined })).toBeNull();
  });

  test('pixiv: screenNameが数値ユーザーIDを保持している', () => {
    expect(posterProfileUrl({ platform: 'pixiv', screenName: '12345678' })).toBe('https://www.pixiv.net/users/12345678');
  });

  test('screenName が無ければどのPFでもnull', () => {
    expect(posterProfileUrl({ platform: 'x', screenName: '' })).toBeNull();
    expect(posterProfileUrl({ platform: 'x', screenName: null })).toBeNull();
    expect(posterProfileUrl({ platform: 'pixiv', screenName: undefined })).toBeNull();
  });

  test('未知のプラットフォームはnull', () => {
    expect(posterProfileUrl({ platform: 'unknown', screenName: 'someone' })).toBeNull();
    expect(posterProfileUrl({ platform: null, screenName: 'someone' })).toBeNull();
  });
});
