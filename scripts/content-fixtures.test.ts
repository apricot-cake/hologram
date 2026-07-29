// extension/utils/extractor/ 各サイトモジュールの DOM 相（プラットフォーム判定・投稿要素の特定・
// パーマリンク抽出）の、オフライン純ユニットテスト。jsdom 上で手書きの HTML フィクスチャ
// （scripts/fixtures/content/*.html）に対して走らせる。
//
// フィクスチャは X/Bluesky/Misskey/Mastodon/pixiv の実採取物ではない（どれもログイン済みの
// 生セッションが要り、このスイートは意図的にそれを避ける）。コードが狙っているセレクタ／
// testid の形を最小限で再現し、監査で直したきわどいケース（引用 vs 被引用・返信 vs 親・
// グリッドの隣・アバター vs 作品。サイトモジュールの "(audit 2026-06-11)" コメント参照）を
// 覆うもの。ここで捕まるのは「自分のコード変更が解析ロジックを壊した」退行で、
// 「サイト側が DOM を変えた」は捕まらない＝それは実サイト e2e（scripts/e2e-capture-test.cts）の担当。
//
// 撮影範囲の関数（getMisskeyCaptureRect / getPixivCaptureRect）はここでは見ない＝
// getBoundingClientRect に依存し、jsdom はレイアウトしない（常にゼロ矩形）ため。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getCaptureSite } from '../extension/utils/extractor/index.ts';
import { findMastodonPostElement } from '../extension/utils/extractor/mastodon.ts';
import { findMisskeyPostElement } from '../extension/utils/extractor/misskey.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');

// フィクスチャの DOM を、コンテンツスクリプトの実行文脈と同じグローバル（window・document・
// location・…）として据える。site-detect.ts の関数は呼び出し時にグローバルから読むので
// （モジュール読み込み時には DOM を触らない）、フィクスチャごとに差し替えて安全。
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

// ドキュメントを読み直さずに location だけ差し替える＝1つのフィクスチャで同じ
// プラットフォームの複数のページ遷移を代表させる
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
