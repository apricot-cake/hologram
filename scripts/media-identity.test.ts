// extension/utils/media-identity.ts の getMediaIdentitySite().extractIdentity/
// isPostMedia の、オフライン純ユニットテスト。jsdom 上で手書きの HTML フィクスチャ
// （scripts/fixtures/content/media-*.html）に対して走らせる。content-fixtures.test.ts
// と同じ据え方（フィクスチャの DOM をコンテンツスクリプトの実行文脈と同じグローバルに
// する）だが、別ファイル: site-detect.ts 用の fixtures/content/*.html には <img> が無く、
// ここが見る「ドラッグ／ホバーした画像がどの投稿の所有物か」は判定できない。
//
// extractIdentity は drag.ts のドラッグ保存と overlay.ts のホバー保存ボタン両方が読む
// 同定ロジック（#94）＝この2つの保存経路が同じ画像を違う投稿だと答えることは絶対に
// あってはならない。isPostMedia はホバーボタンの表示可否だけのゲート（drag.ts は使わない）。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getMediaIdentitySite } from '../extension/utils/media-identity';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures', 'content');

const KEYS = ['window', 'document', 'location', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLImageElement', 'Node'];

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

  // #372: 動画・GIF 投稿のサムネは media/ ではなく *_video_thumb/ で配られる。
  // 3本とも実測で確認済みのパス（推測で許可集合へ足さない＝#372 の受け入れ条件）。
  test.each([
    ['動画（amplify_video_thumb/）', 'imgAmplify'],
    ['動画（ext_tw_video_thumb/）', 'imgExtTw'],
    ['GIF（tweet_video_thumb/）', 'imgGif'],
  ])('%s も投稿メディアとして isPostMedia が真', (_label, id) => {
    expect(config.isPostMedia(ctx.document.getElementById(id))).toBe(true);
  });

  // 許可集合をホスト一致へ緩めると真になってしまうもの＝緩めていないことの証拠。
  test('リンクカードの絵は card_img/ パスで isPostMedia が偽', () => {
    expect(config.isPostMedia(ctx.document.getElementById('imgCard'))).toBe(false);
  });

  test('リンクカードの絵も投稿へは同定される（identity と isPostMedia は別のゲート）', () => {
    expect(config.extractIdentity(ctx.document.getElementById('imgCard'))).toEqual({ postId: '555', link: 'https://x.com/erin/status/555' });
  });

  // #450: 再生が始まった動画投稿には <img> が無く、ポスターだけが手掛かりとして残る。
  // ホバーできる状態の動画投稿は必ずこの形なので、ここが通らないとボタンは出ない。
  test('再生中の動画投稿は <video> の poster で isPostMedia が真', () => {
    expect(config.isPostMedia(ctx.document.getElementById('videoPlaying'))).toBe(true);
  });

  test('再生中の動画投稿も投稿へ同定される', () => {
    expect(config.extractIdentity(ctx.document.getElementById('videoPlaying'))).toEqual({ postId: '666', link: 'https://x.com/frank/status/666' });
  });

  // 判定の根拠はあくまでパスであって要素の種類ではない＝<video> でも投稿メディアの
  // パスでなければ偽。
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
