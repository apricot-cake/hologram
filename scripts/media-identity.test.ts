// Offline pure unit test for each site module's mediaIdentity (getMediaIdentitySite()).extractIdentity/
// isPostMedia in extension/utils/extractor/. Runs against hand-written HTML fixtures
// (scripts/fixtures/content/media-*.html) on jsdom. Same setup as content-fixtures.test.ts
// (installing the fixture DOM into the same globals as the content script's execution context),
// but a separate file: fixtures/content/*.html for site-detect.ts has no <img>, so it can't
// judge what this test looks at — "which post does the dragged/hovered image belong to".
//
// extractIdentity is the identification logic (#94) read by both drag.ts's drag-save and
// overlay.ts's hover-save button — these two save paths must never disagree about which
// post the same image belongs to. isPostMedia is only the gate for whether the hover button shows (drag.ts doesn't use it).

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getMediaIdentitySite, mediaKeyOf } from '../extension/utils/extractor/index.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');

// getComputedStyle: only Misskey's matchesPage (the --MI_THEME-accent
// fingerprint, shared with site-detect.ts) reads it — see content-fixtures.test.ts.
const KEYS = ['window', 'document', 'location', 'getComputedStyle', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLImageElement', 'Node'];

function installFixture(fixtureFile: string, url: string) {
  const dom = new JSDOM(fs.readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8'), { url });
  const saved: Record<string, any> = {};
  for (const k of KEYS) {
    saved[k] = (global as any)[k];
    (global as any)[k] = (dom.window as any)[k];
  }
  const restore = () => {
    for (const k of KEYS) (global as any)[k] = saved[k];
  };
  return { dom, document: dom.window.document, restore };
}

function setLocation(dom: JSDOM, url: string) {
  dom.reconfigure({ url });
  (global as any).location = dom.window.location;
}

describe('X (Twitter)', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('media-x.html', 'https://x.com/home');
    config = getMediaIdentitySite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('x');
  });

  test('投稿の絵は、アンカーの外にあっても article 経由で同定される', () => {
    const img = ctx.document.getElementById('imgPost1');
    expect(config.extractIdentity(img)).toEqual({ postId: '111', link: 'https://x.com/alice/status/111' });
  });

  test('投稿の絵は media/ CDN パスで isPostMedia が真', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgPost1'))).toBe(true);
  });

  test('アバターは /status/ アンカーにも article にも属さず null', () => {
    expect(config.extractIdentity(ctx.document.getElementById('imgAvatar'))).toBeNull();
  });

  test('アバターは profile_images/ パスで isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgAvatar'))).toBe(false);
  });

  // #372: video/GIF post thumbnails are served from *_video_thumb/, not media/.
  // All three paths were confirmed by actual observation (don't add to the allow set by guesswork — that's #372's acceptance condition).
  test.each([
    ['動画（amplify_video_thumb/）', 'imgAmplify'],
    ['動画（ext_tw_video_thumb/）', 'imgExtTw'],
    ['GIF（tweet_video_thumb/）', 'imgGif'],
  ])('%s も投稿メディアとして isPostMedia が真', (_label, id) => {
    expect(config.isPostMedia(ctx.document.getElementById(id))).toBe(true);
  });

  // Would become true if the allow set were loosened to a host match — proof it hasn't been loosened.
  test('リンクカードの絵は card_img/ パスで isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgCard'))).toBe(false);
  });

  test('リンクカードの絵も投稿へは同定される（identity と isPostMedia は別のゲート）', () => {
    expect(config.extractIdentity(ctx.document.getElementById('imgCard'))).toEqual({ postId: '555', link: 'https://x.com/erin/status/555' });
  });

  // #450: a video post that has started playing has no <img> — only the poster remains as a clue.
  // A hoverable video post is always in this shape, so if this fails the button never shows.
  test('再生中の動画投稿は <video> の poster で isPostMedia が真', () => {
    expect(config.isPostMedia(ctx.document.getElementById('videoPlaying'))).toBe(true);
  });

  test('再生中の動画投稿も投稿へ同定される', () => {
    expect(config.extractIdentity(ctx.document.getElementById('videoPlaying'))).toEqual({ postId: '666', link: 'https://x.com/frank/status/666' });
  });

  // The basis for the judgment is strictly the path, not the element type — even a <video>
  // is false if it's not on a post-media path.
  test('poster が投稿メディアのパスでない <video> は isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('videoNotPostMedia'))).toBe(false);
  });

  test('写真ビューアの絵（アンカー無し・article の外）は URL バーへ落ちる', () => {
    setLocation(ctx.dom, 'https://x.com/frank/status/555/photo/1');
    const img = ctx.document.getElementById('imgViewer');
    expect(config.extractIdentity(img)).toEqual({ postId: '555', link: 'https://x.com/frank/status/555' });
  });
});

describe('Bluesky', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('media-bluesky.html', 'https://bsky.app/home');
    config = getMediaIdentitySite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('bluesky');
  });

  test('投稿の絵はコンテナ経由でパーマリンクへ同定される', () => {
    const img = ctx.document.getElementById('imgPost1');
    expect(config.extractIdentity(img)).toEqual({ postId: '3kabc', link: 'https://bsky.app/profile/alice.bsky.social/post/3kabc' });
  });

  test('投稿の絵は feed_ CDN パスで isPostMedia が真', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgPost1'))).toBe(true);
  });

  test('同じコンテナ内のアバターも投稿へは同定される（identity と isPostMedia は別のゲート）', () => {
    const img = ctx.document.getElementById('imgAvatar');
    expect(config.extractIdentity(img)).toEqual({ postId: '9zzz', link: 'https://bsky.app/profile/carol.bsky.social/post/9zzz' });
  });

  test('アバターは avatar/ CDN パスで isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgAvatar'))).toBe(false);
  });
});

describe('pixiv', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('media-pixiv.html', 'https://www.pixiv.net/tags/foo');
    config = getMediaIdentitySite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('pixiv');
  });

  test('ファイル名の <id>_p<N> を最優先で読む', () => {
    const img = ctx.document.getElementById('imgFilename');
    expect(config.extractIdentity(img)).toEqual({ postId: '1001', link: 'https://www.pixiv.net/artworks/1001' });
  });

  test('ファイル名から取れなければ最寄りの /artworks/ リンクへ落ちる', () => {
    const img = ctx.document.getElementById('imgLinkFallback');
    expect(config.extractIdentity(img)).toEqual({ postId: '1002', link: 'https://www.pixiv.net/artworks/1002' });
  });

  test('ファイル名の <id>_p<N> が無い絵は isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgLinkFallback'))).toBe(false);
    expect(config.isPostMedia(ctx.document.getElementById('imgLocationFallback'))).toBe(false);
  });

  test('リンクも取れなければ作品ページの URL バーへ落ちる', () => {
    setLocation(ctx.dom, 'https://www.pixiv.net/artworks/2001');
    const img = ctx.document.getElementById('imgLocationFallback');
    expect(config.extractIdentity(img)).toEqual({ postId: '2001', link: 'https://www.pixiv.net/artworks/2001' });
  });
});

describe('Misskey', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('media-misskey.html', 'https://misskey.io/');
    config = getMediaIdentitySite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('misskey');
  });

  test('投稿の絵はノートの article 経由で同定される', () => {
    const img = ctx.document.getElementById('imgPost1');
    expect(config.extractIdentity(img)).toEqual({ postId: '9abc', link: 'https://misskey.io/notes/9abc' });
  });

  test('投稿の絵は isPostMedia が真', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgPost1'))).toBe(true);
  });

  test('同じノート内のアバターも投稿へは同定される（identity と isPostMedia は別のゲート）', () => {
    const img = ctx.document.getElementById('imgAvatar');
    expect(config.extractIdentity(img)).toEqual({ postId: '9def', link: 'https://misskey.io/notes/9def' });
  });

  test('アバターは /@ プロフィールリンクの中にあるため isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgAvatar'))).toBe(false);
  });
});

// mediaKeyOf = the single rule per platform for "are these two URLs the same image".
// The thumbnail the page shows, the full-size the API announces, and the URL actually
// downloaded by the save are all different notations of the same image, so a plain
// string comparison would answer "different" every time.
//
// There are two readers of this, and both must be the same function (#334): the path that
// decides "which announced image number does the pointed-at image correspond to" for
// drag/hover saves (pickPrimaryImage in background.ts), and the path that decides "which
// image of this post is already in the library" for the timeline (overlay.ts). If the rule
// drifts between them, a save button gets shown on an image that's already saved.
describe('mediaKeyOf — 表記ゆれを越えた画像の同一性', () => {
  test('x: name= のサイズ指定が違っても同じ絵', () => {
    const key = mediaKeyOf('x', 'https://pbs.twimg.com/media/ABC123?format=jpg&name=orig');
    expect(key).toBe('media/ABC123');
    expect(mediaKeyOf('x', 'https://pbs.twimg.com/media/ABC123?format=jpg&name=small')).toBe(key);
    expect(mediaKeyOf('x', 'https://pbs.twimg.com/media/ABC123.jpg')).toBe(key);
  });

  test('x: 同じ投稿の写真と動画サムネは別の絵', () => {
    expect(mediaKeyOf('x', 'https://pbs.twimg.com/amplify_video_thumb/999/img/JJJ.jpg')).toBe('amplify_video_thumb/999');
    expect(mediaKeyOf('x', 'https://pbs.twimg.com/media/999?name=orig')).toBe('media/999');
  });

  test('x: アバター・カード画像は同定しない（保存の対象ではない）', () => {
    expect(mediaKeyOf('x', 'https://pbs.twimg.com/profile_images/FFF.jpg')).toBeNull();
    expect(mediaKeyOf('x', 'https://pbs.twimg.com/card_img/1/CCC?format=jpg')).toBeNull();
  });

  test('bluesky: @jpeg の有無・サムネと原寸で同じ blob CID', () => {
    const cid = `bafkrei${'a'.repeat(52)}`;
    const key = mediaKeyOf('bluesky', `https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:xyz/${cid}@jpeg`);
    expect(key).toBe(cid);
    expect(mediaKeyOf('bluesky', `https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:xyz/${cid}@jpeg`)).toBe(key);
    expect(mediaKeyOf('bluesky', `https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:xyz/${cid}`)).toBe(key);
  });

  test('pixiv: サムネイル表記と原寸で同じ <id>_p<N>', () => {
    const key = mediaKeyOf('pixiv', 'https://i.pximg.net/img-original/img/2026/01/01/00/00/00/1001_p1.png');
    expect(key).toBe('1001_p1');
    expect(mediaKeyOf('pixiv', 'https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/01/01/00/00/00/1001_p1_square1200.jpg')).toBe(key);
    expect(mediaKeyOf('pixiv', 'https://i.pximg.net/c/600x1200_90/img-master/img/2026/01/01/00/00/00/1001_p1_master1200.jpg')).toBe(key);
  });

  test('pixiv: 同じ作品でもページが違えば別の絵', () => {
    expect(mediaKeyOf('pixiv', 'https://i.pximg.net/img-original/img/x/1001_p0.png')).toBe('1001_p0');
    expect(mediaKeyOf('pixiv', 'https://i.pximg.net/img-original/img/x/1001_p2.png')).toBe('1001_p2');
  });

  test('misskey/mastodon: 拡張子とクエリを落としたファイル名', () => {
    expect(mediaKeyOf('misskey', 'https://misskey.io/files/abcDEF123.webp?thumbnail')).toBe('abcDEF123');
    expect(mediaKeyOf('mastodon', 'https://mastodon.social/media/xyz.png')).toBe('xyz');
  });

  // null means "can't be compared", not "doesn't match" — the caller must not treat it as a definite answer.
  // The video body itself (X saves .mp4, but the page side only has the poster) falls into this case.
  test('比べられない URL は null', () => {
    expect(mediaKeyOf('x', 'https://video.twimg.com/ext_tw_video/999/pu/vid/720x1280/abc.mp4')).toBeNull();
    expect(mediaKeyOf('unknown-platform', 'https://example.com/a.jpg')).toBeNull();
    expect(mediaKeyOf('x', '')).toBeNull();
    expect(mediaKeyOf('x', null)).toBeNull();
  });
});
