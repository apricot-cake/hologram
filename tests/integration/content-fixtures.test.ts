// extension/utils/extractor/ 配下の各サイトモジュールのうち、DOM を相手にする部分（プラット
// フォームの判定・パーマリンクの取り出し）の、オフラインで動く純粋な単体
// テスト。jsdom の上で、手書きの HTML フィクスチャ（scripts/fixtures/content/*.html）に対して
// 動かす。
//
// フィクスチャは X/Bluesky/pixiv から実際に取ってきたものではない（どれも
// ログイン済みの生きたセッションが要るので、このスイートは意図してそれを避けている）。
// コードが狙うセレクタや testid の形を最小限に再現し、監査で直した厄介なケース（引用と被引用
// カード、返信と親、グリッドの隣、アバターと作品＝サイトモジュールの「(audit 2026-06-11)」の
// コメントを参照）を覆っている。ここが捕まえるのは「自分のコード変更が解析のロジックを壊した」
// という後退であって、「サイトが DOM を変えた」は捕まえない。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getContentSite } from '../../extension/utils/extractor/index.ts';

const FIXTURES_DIR = path.join(import.meta.dirname, '../../scripts/fixtures/content');

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
    config = getContentSite();
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

describe('X: 画像拡大表示（lightbox）', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('x-lightbox.html', 'https://x.com/alice/status/111/photo/2');
    config = getContentSite();
  });
  afterAll(() => ctx.restore());

  test('パーマリンクは URL の /photo/N を落とした投稿のもの', () => {
    const img = ctx.document.getElementById('viewerImg');
    expect(config.getPermalink(img)).toBe('https://x.com/alice/status/111');
  });
});

describe('Bluesky', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('bluesky.html', 'https://bsky.app/home');
    config = getContentSite();
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

describe('pixiv: 一覧グリッド', () => {
  let ctx: ReturnType<typeof installFixture>;
  let config: any;

  beforeAll(() => {
    ctx = installFixture('pixiv.html', 'https://www.pixiv.net/tags/foo');
    config = getContentSite();
  });
  afterAll(() => ctx.restore());

  test('プラットフォームを判定する', () => {
    expect(config?.platform).toBe('pixiv');
  });

  test('グリッドのクリックは自分の画像へ解決する（隣ではない・A-5c）', () => {
    const imgB = ctx.document.getElementById('pxImgB');
    expect(config.getPermalink(imgB)).toBe('https://www.pixiv.net/artworks/1002');
  });
});

describe('pixiv: 作品ページ', () => {
  let ctx: ReturnType<typeof installFixture>;

  beforeAll(() => {
    ctx = installFixture('pixiv-artwork.html', 'https://www.pixiv.net/artworks/2001');
  });
  afterAll(() => ctx.restore());

  test('figure のクリックは自分の画像へ落ちる（A-5a）', () => {
    const config = getContentSite();
    const mainFigure = ctx.document.getElementById('mainFigure');
    expect(config.getPermalink(mainFigure)).toBe('https://www.pixiv.net/artworks/2001');
  });
});
