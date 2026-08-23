// extension/utils/extractor/ 配下の各サイトモジュールのうち、DOM を相手にする部分（プラット
// フォームの判定・投稿要素の特定・パーマリンクの取り出し）の、オフラインで動く純粋な単体
// テスト。jsdom の上で、手書きの HTML フィクスチャ（scripts/fixtures/content/*.html）に対して
// 動かす。
//
// フィクスチャは X/Bluesky/Misskey/pixiv から実際に取ってきたものではない（どれも
// ログイン済みの生きたセッションが要るので、このスイートは意図してそれを避けている）。
// コードが狙うセレクタや testid の形を最小限に再現し、監査で直した厄介なケース（引用と被引用
// カード、返信と親、グリッドの隣、アバターと作品＝サイトモジュールの「(audit 2026-06-11)」の
// コメントを参照）を覆っている。ここが捕まえるのは「自分のコード変更が解析のロジックを壊した」
// という後退であって、「サイトが DOM を変えた」は捕まえない＝そちらは実サイトに対する e2e
// スイート（scripts/e2e-capture-test.cts）の担当。
//
// 撮影範囲を返す関数（getMisskeyCaptureRect / getPixivCaptureRect）はここでは覆わない。
// getBoundingClientRect に依存していて、jsdom はレイアウトをしない（常に大きさ0の矩形を返す）
// ため。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getCaptureSite } from '../extension/utils/extractor/index.ts';
import { findMisskeyPostElement } from '../extension/utils/extractor/misskey.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');

// フィクスチャの DOM を、content script の実行文脈が使うのと同じグローバル
// （window, document, location, ...）として据える。site-detect.ts の関数は呼ばれた時点で
// グローバルを読む（モジュールの読み込み時には DOM を触らない）ので、フィクスチャごとに
// 差し替えても差し支えない。
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

// document を読み込み直さず location だけ差し替える＝1つのフィクスチャで、同じプラット
// フォームの複数のページ遷移を表せる
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

// #325: 画像の lightbox＝X が /<user>/status/<id>/photo/<n> で開く別の層。
// article の子孫ではないので、通常の祖先の探索では投稿要素が見つからず、Alt+S が何もしない
// ように見えていた。
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
