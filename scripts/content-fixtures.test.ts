// Offline pure unit tests for the DOM-facing pieces (platform detection, locating the post
// element, permalink extraction) of each site module under extension/utils/extractor/. Run
// against hand-written HTML fixtures (scripts/fixtures/content/*.html) on top of jsdom.
//
// The fixtures are not real captures from X/Bluesky/Misskey/Mastodon/pixiv (all of those would
// require a logged-in live session, which this suite deliberately avoids). They minimally
// reproduce the selector/testid shapes the code targets, covering the tricky cases fixed during
// audits (quote vs. quoted-post, reply vs. parent, grid neighbor, avatar vs. artwork — see the
// "(audit 2026-06-11)" comments in the site modules). What this catches is a regression where
// "my own code change broke the parsing logic"; it does not catch "the site changed its DOM" —
// that's the job of the real-site e2e suite (scripts/e2e-capture-test.cts).
//
// The capture-rect functions (getMisskeyCaptureRect / getPixivCaptureRect) are not covered
// here, since they depend on getBoundingClientRect and jsdom doesn't do layout (always returns
// a zero rect).

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getCaptureSite } from '../extension/utils/extractor/index.ts';
import { findMastodonPostElement } from '../extension/utils/extractor/mastodon.ts';
import { findMisskeyPostElement } from '../extension/utils/extractor/misskey.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');

// Install the fixture DOM as the same globals (window, document, location, ...) the content
// script's execution context uses. site-detect.ts's functions read from globals at call time
// (they don't touch the DOM at module-load time), so it's safe to swap these per fixture.
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

// Swap out only location without reloading the document = one fixture can represent multiple
// page transitions on the same platform
function setLocation(dom: JSDOM, url: string) {
  dom.reconfigure({ url });
  (global as any).location = dom.window.location;
}

describe('X (Twitter)', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('x.html', 'https://x.com/home');
    config = getCaptureSite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('x');
  });

  test('通常のパーマリンク（A-1b/A-1c/A-1h）', () => {
    expect(config.getPermalink(ctx.document.getElementById('tweetNormal'))).toBe('https://x.com/alice/status/111');
  });

  test('引用は引用した側を取る（被引用カードではない・A-1e）', () => {
    expect(config.getPermalink(ctx.document.getElementById('tweetQuote'))).toBe('https://x.com/bob/status/222');
  });

  test('リポストは兄弟の social-context リンクを無視する（A-1d）', () => {
    expect(config.getPermalink(ctx.document.getElementById('tweetRetweet'))).toBe('https://x.com/erin/status/444');
  });

  test('記事内にリンクが無ければ location.href へ落ちる（A-1b/A-1c）', () => {
    setLocation(ctx.dom, 'https://x.com/frank/status/555');
    expect(config.getPermalink(ctx.document.getElementById('tweetNoLink'))).toBe('https://x.com/frank/status/555');
  });
});

// #325: the image lightbox — a separate layer X opens at /<user>/status/<id>/photo/<n>.
// It isn't a descendant of the article, so a normal ancestor search can't find the post element,
// and Alt+S appeared to do nothing.
describe('X: 画像拡大表示（lightbox）', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('x-lightbox.html', 'https://x.com/alice/status/111/photo/2');
    config = getCaptureSite();
  });
  afterAll(() => ctx.restore());

  test('拡大中の画像そのものが対象になる（撮影範囲＝画像の矩形）', () => {
    const img = ctx.document.getElementById('viewerImg');
    expect(config.findPostElement(img)).toBe(img);
  });

  test('パーマリンクは URL の /photo/N を落とした投稿のもの', () => {
    const img = ctx.document.getElementById('viewerImg');
    expect(config.getPermalink(config.findPostElement(img))).toBe('https://x.com/alice/status/111');
  });

  test('動画投稿のポスターフレームも同じ扱い（#450）', () => {
    const video = ctx.document.getElementById('viewerVideo');
    expect(config.findPostElement(video)).toBe(video);
  });

  test('ラッパ要素がクリック対象でも、中の画像/動画を引き当てる（swipe-to-dismiss 相当・#582）', () => {
    const img = ctx.document.getElementById('viewerImg');
    const video = ctx.document.getElementById('viewerVideo');
    expect(config.findPostElement(ctx.document.getElementById('viewerMediaBox'))).toBe(img);
    expect(config.findPostElement(ctx.document.getElementById('viewerVideoBox'))).toBe(video);
  });

  test('メディアでないビューアの部品（閉じるボタン・背景）は捕捉しない', () => {
    expect(config.findPostElement(ctx.document.getElementById('viewerClose'))).toBe(null);
    expect(config.findPostElement(ctx.document.getElementById('viewerBackdrop'))).toBe(null);
  });

  test('ビューア内のアバターは捕捉しない（URL から投稿は引けてしまうため）', () => {
    expect(config.findPostElement(ctx.document.getElementById('viewerAvatar'))).toBe(null);
  });

  test('背後の返信の画像は返信自身へ帰属する（URL バーの投稿に化けない・A-1n）', () => {
    const post = config.findPostElement(ctx.document.getElementById('replyImg'));
    expect(post?.id).toBe('tweetReply');
    expect(config.getPermalink(post)).toBe('https://x.com/bob/status/222');
  });

  test('背後の投稿詳細の画像は従来どおり記事へ解決する', () => {
    const post = config.findPostElement(ctx.document.getElementById('detailImg'));
    expect(post?.id).toBe('tweetDetail');
    expect(config.getPermalink(post)).toBe('https://x.com/alice/status/111');
  });

  test('/photo/N でない URL では同じ形でも捕捉しない（ビューアが開いている時だけ）', () => {
    setLocation(ctx.dom, 'https://x.com/alice/status/111');
    expect(config.findPostElement(ctx.document.getElementById('viewerImg'))).toBe(null);
  });
});

describe('Bluesky', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('bluesky.html', 'https://bsky.app/home');
    config = getCaptureSite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('bluesky');
  });

  test('本文中の同一著者リンク（おとり）より自分のパーマリンクが勝つ（A-2a）', () => {
    expect(config.getPermalink(ctx.document.getElementById('bskyNormal'))).toBe('https://bsky.app/profile/alice.bsky.social/post/3kabc');
  });

  test('スレッド内の個別項目のパーマリンク（A-2b）', () => {
    expect(config.getPermalink(ctx.document.getElementById('bskyIndividual'))).toBe('https://bsky.app/profile/bob.bsky.social/post/xyz789');
  });

  test('引用の詳細ページは埋め込みリンクを無視し location へ落ちる（A-2f）', () => {
    setLocation(ctx.dom, 'https://bsky.app/profile/mallory.bsky.social/post/mainpost');
    expect(config.getPermalink(ctx.document.getElementById('bskyQuote'))).toBe('https://bsky.app/profile/mallory.bsky.social/post/mainpost');
  });
});

describe('Misskey', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('misskey.html', 'https://misskey.io/');
    config = getCaptureSite();
  });
  afterAll(() => ctx.restore());

  test('--MI_THEME-accent とノートの形で判定する', () => {
    expect(config?.platform).toBe('misskey');
  });

  test('通常のノートのパーマリンク（A-3a）', () => {
    expect(config.getPermalink(ctx.document.getElementById('noteNormal'))).toBe('https://misskey.io/notes/9normal');
  });

  test('親プレビュー内のクリックは返信ノートへ解決する（プレビューではない・A-3e）', () => {
    const replyNote = ctx.document.getElementById('noteReply');
    const parentPreviewLink = replyNote.querySelector('.reply-parent-preview a');
    expect(findMisskeyPostElement(parentPreviewLink)).toBe(replyNote);
  });

  test('返信のパーマリンクは自分のもの（親のものではない・A-3e）', () => {
    expect(config.getPermalink(ctx.document.getElementById('noteReply'))).toBe('https://misskey.io/notes/9reply');
  });

  test('記事にリンクが無ければ location.href へ落ちる（A-3b）', () => {
    setLocation(ctx.dom, 'https://misskey.io/notes/9fallback');
    expect(config.getPermalink(ctx.document.getElementById('noteFallback'))).toBe('https://misskey.io/notes/9fallback');
  });
});

describe('Mastodon', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('mastodon.html', 'https://mastodon.social/@alice');
    config = getCaptureSite();
  });
  afterAll(() => ctx.restore());

  test('meta[application-name] で判定する（A-4a/A-4b）', () => {
    expect(config?.platform).toBe('mastodon');
  });

  test('通常の status のパーマリンク', () => {
    expect(config.getPermalink(ctx.document.getElementById('statusNormal'))).toBe('https://mastodon.social/@alice/109252111');
  });

  test('引用プレビュー内のクリックは引用した側の status へ解決する（A-4f）', () => {
    const quotedContent = ctx.document.querySelector('#statusQuoteInner .status__content');
    expect(findMastodonPostElement(quotedContent)).toBe(ctx.document.getElementById('statusQuote'));
  });

  test('引用した status のパーマリンクは自分のもの（A-4f）', () => {
    expect(config.getPermalink(ctx.document.getElementById('statusQuote'))).toBe('https://mastodon.social/@bob/2001');
  });
});

describe('pixiv: 一覧グリッド', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('pixiv.html', 'https://www.pixiv.net/tags/foo');
    config = getCaptureSite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('pixiv');
  });

  test('グリッドのクリックは自分の画像へ解決する（隣ではない・A-5c）', () => {
    const imgB = ctx.document.getElementById('pxImgB');
    expect(config.getPermalink(config.findPostElement(imgB))).toBe('https://www.pixiv.net/artworks/1002');
  });
});

describe('pixiv: 作品ページ', () => {
  let ctx: ReturnType<typeof installFixture>;

  beforeAll(() => {
    ctx = installFixture('pixiv-artwork.html', 'https://www.pixiv.net/artworks/2001');
  });
  afterAll(() => ctx.restore());

  test('figure のクリックは自分の画像へ落ちる（A-5a）', () => {
    const config = getCaptureSite();
    const mainFigure = ctx.document.getElementById('mainFigure');
    expect(config.getPermalink(config.findPostElement(mainFigure))).toBe('https://www.pixiv.net/artworks/2001');
  });
});

describe('pixiv: 作品ページのコメント欄', () => {
  let ctx: ReturnType<typeof installFixture>;

  beforeAll(() => {
    ctx = installFixture('pixiv-artwork-comments.html', 'https://www.pixiv.net/artworks/3001');
  });
  afterAll(() => ctx.restore());

  test('コメントのアバターをクリックしても作品の figure へ解決する（A-5e）', () => {
    const config = getCaptureSite();
    const resolved = config.findPostElement(ctx.document.getElementById('avatarImg'));

    expect(resolved?.id).toBe('mainFigure2');
    expect(config.getPermalink(resolved)).toBe('https://www.pixiv.net/artworks/3001');
  });
});
