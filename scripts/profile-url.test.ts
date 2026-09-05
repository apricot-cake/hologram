// posterProfileUrl (#663) の純粋な単体テスト。3つのプラットフォームぶんの URL を組み立てる。

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
