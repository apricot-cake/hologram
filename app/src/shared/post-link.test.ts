import { describe, expect, test } from 'vitest';
import { makePostLink, parsePostLink } from './post-link.ts';

describe('保存済み投稿のリンク', () => {
  test('投稿と個別メディアのURLを往復する', () => {
    const target = { url: 'https://x.com/a/status/123', mediaUrl: 'https://pbs.twimg.com/media/abc?format=jpg&name=orig' };
    expect(parsePostLink(makePostLink(target))).toEqual(target);
    expect(parsePostLink(makePostLink({ url: target.url }))).toEqual({ url: target.url });
  });
  test.each(['https://x.com/a/status/123', 'hologram://delete?url=https://x.com/a/status/123', 'hologram://post?url=file:///secret', 'hologram://post?url=https://x.com/home', 'hologram://post?url=https://x.com/a/status/123&url=https://x.com/b/status/456', 'hologram://post/path?url=https://x.com/a/status/123'])(
    '不正な宛先を拒否する: %s',
    (value) => {
      expect(parsePostLink(value)).toBeNull();
    },
  );
});
