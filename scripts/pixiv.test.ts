// Deterministic unit tests for pixiv (no network use). Verifies parsePostUrl,
// multi-page media[] derivation, and fetchPixivIllust's field mapping by stubbing
// fetch. The real fetch runs from the extension's service worker with the user's
// pixiv cookie + host_permission, so a real fetch from Node wouldn't be
// representative = simulate the ajax response instead.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { parsePostUrl } from '../extension/utils/extractor/index.ts';
import { fetchPixivIllust, pixivBookmarksUserIdFromUrl, pixivMedia } from '../extension/utils/extractor/pixiv.ts';

// Returns a real Response = metadata.ts reads the response body exactly once, stacks
// it into the raw-source layer (#292), then JSON.parses it. A hand-rolled mock that
// only has json() wouldn't go through that path.
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parsePostUrl', () => {
  test('/en/artworks/<id>', () => {
    expect(parsePostUrl('https://www.pixiv.net/en/artworks/12345')?.id).toBe('12345');
  });

  test('/artworks は platform=pixiv', () => {
    expect(parsePostUrl('https://www.pixiv.net/artworks/999')?.platform).toBe('pixiv');
  });

  test('www なしホスト', () => {
    expect(parsePostUrl('https://pixiv.net/artworks/42')?.id).toBe('42');
  });

  test('作品でない（/users）は null', () => {
    expect(parsePostUrl('https://www.pixiv.net/users/1')).toBeNull();
  });
});

describe('pixivBookmarksUserIdFromUrl（#280、ブックマーク一覧のURL判定）', () => {
  test('/users/<id>/bookmarks/artworks からidを読む', () => {
    expect(pixivBookmarksUserIdFromUrl('/users/12345/bookmarks/artworks')).toBe('12345');
  });

  test('/en/ ロケール接頭辞つきでも読む', () => {
    expect(pixivBookmarksUserIdFromUrl('/en/users/12345/bookmarks/artworks')).toBe('12345');
  });

  test('末尾スラッシュがあっても読む', () => {
    expect(pixivBookmarksUserIdFromUrl('/users/12345/bookmarks/artworks/')).toBe('12345');
  });

  test('ブックマーク一覧でないパスは null（作品ページ）', () => {
    expect(pixivBookmarksUserIdFromUrl('/artworks/12345')).toBeNull();
  });

  test('ブックマーク一覧でないパスは null（プロフィール本体）', () => {
    expect(pixivBookmarksUserIdFromUrl('/users/12345')).toBeNull();
  });

  test('小説のブックマーク一覧（/novels）は対象外', () => {
    expect(pixivBookmarksUserIdFromUrl('/users/12345/bookmarks/novels')).toBeNull();
  });
});

describe('pixivMedia（複数ページの導出）', () => {
  const media = pixivMedia({
    pageCount: 2,
    width: 10,
    height: 20,
    urls: { original: 'https://i.pximg.net/img-original/img/2021/01/01/00/00/00/100_p0.jpg' },
  });

  test('_p0 から _p1 を導出', () => {
    expect(media).toHaveLength(2);
    expect(media[1].url).toMatch(/100_p1\.jpg$/);
  });

  test('全エントリが pixiv の Referer を持つ', () => {
    expect(media.every((x) => x.referer === 'https://www.pixiv.net/')).toBe(true);
  });

  test('先頭ページだけ寸法を持ち、2枚目以降は null', () => {
    expect(media[0].width).toBe(10);
    expect(media[1].width).toBeNull();
  });
});

describe('fetchPixivIllust', () => {
  const body = {
    illustTitle: 'My Art',
    userId: '77',
    userName: 'Artist',
    likeCount: 10,
    bookmarkCount: 20,
    viewCount: 300,
    commentCount: 4,
    createDate: '2021-05-06T07:08:09+09:00',
    pageCount: 3,
    width: 1000,
    height: 1500,
    tags: { tags: [{ tag: 'foo' }, { tag: 'bar' }] },
    urls: { original: 'https://i.pximg.net/img-original/img/2021/05/06/07/08/09/555_p0.png' },
  };

  test('成功応答のフィールド対応', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: false, body }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');

    expect(rec.platform).toBe('pixiv');
    expect(rec.title).toBe('My Art'); // ← illustTitle
    expect({ displayName: rec.displayName, screenName: rec.screenName, userId: rec.userId }).toEqual({ displayName: 'Artist', screenName: '77', userId: '77' });
    expect({ likes: rec.likes, bookmarks: rec.bookmarks, views: rec.views, replies: rec.replies }).toEqual({ likes: 10, bookmarks: 20, views: 300, replies: 4 });
    expect(rec.hashtags).toEqual(['foo', 'bar']); // ← tags.tags
    expect(rec.media).toHaveLength(3);
    expect(rec.media[2].url.endsWith('555_p2.png')).toBe(true);
    expect(rec.media[0].referer).toBe('https://www.pixiv.net/');
    expect(rec.mediaType).toBe('image');
  });

  // Deleted / private / R-18-while-logged-out come back as 200 + {error:true}
  test('エラー body は空レコード（throw しない）', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: true, message: 'not found' }));
    const rec = await fetchPixivIllust({ id: '1' }, 'https://www.pixiv.net/artworks/1');

    expect(rec.platform).toBe('pixiv');
    expect(rec.title).toBeNull();
    expect(rec.media).toHaveLength(0);
  });

  test('HTTP エラーは空レコード', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({}, 404));
    const rec = await fetchPixivIllust({ id: '2' }, 'u');

    expect(rec.media).toHaveLength(0);
    expect(rec.likes).toBeNull();
  });

  // seriesNavData を持たない応答（この describe の `body` 自体）では3フィールドとも null。
  test('seriesNavData の無い応答はシリーズ3フィールドとも null', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: false, body }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');
    expect({ seriesId: rec.seriesId, seriesTitle: rec.seriesTitle, seriesOrder: rec.seriesOrder }).toEqual({ seriesId: null, seriesTitle: null, seriesOrder: null });
  });
});

// #188: シリーズ所属情報。フィールド名は実際の pixiv 応答から確認済み
// （scripts/canary/snapshots/pixiv.json の "single" サンプル、2026-07-30 取得）——
// seriesNavData はシリーズに属する作品にだけ現れるオブジェクトで、その
// トップレベルの order がこの作品自身の話数（next/prev の order は隣の作品のもの）。
describe('シリーズ情報（#188）', () => {
  const seriesBody = {
    illustTitle: 'My Art',
    userId: '77',
    pageCount: 1,
    urls: { original: 'https://i.pximg.net/img-original/img/2021/05/06/07/08/09/555_p0.png' },
    tags: { tags: [] },
    seriesNavData: {
      isNotifying: false,
      isWatched: false,
      next: { id: '556', order: 4, title: '次話' },
      order: 3,
      prev: { id: '554', order: 2, title: '前話' },
      seriesId: '12345',
      seriesType: 'illust',
      title: 'ある冒険',
    },
  };

  test('seriesNavData の seriesId/title/order をそのまま記録する', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: false, body: seriesBody }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');
    expect({ seriesId: rec.seriesId, seriesTitle: rec.seriesTitle, seriesOrder: rec.seriesOrder }).toEqual({ seriesId: '12345', seriesTitle: 'ある冒険', seriesOrder: 3 });
  });

  // next/prev の order を拾ってはいけない（3 ではなく 4 や 2 になっていないか）。
  test('order はこの作品自身のもの（next/prev の order とは別）', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: false, body: seriesBody }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');
    expect(rec.seriesOrder).not.toBe(seriesBody.seriesNavData.next.order);
    expect(rec.seriesOrder).not.toBe(seriesBody.seriesNavData.prev.order);
  });

  test('先頭作品（prev が無い）でも order は取れる', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: false, body: { ...seriesBody, seriesNavData: { ...seriesBody.seriesNavData, prev: null, order: 1 } } }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');
    expect(rec.seriesOrder).toBe(1);
  });

  test('シリーズに属さない作品は seriesNavData が null で、3フィールドとも null のまま', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: false, body: { ...seriesBody, seriesNavData: null } }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');
    expect({ seriesId: rec.seriesId, seriesTitle: rec.seriesTitle, seriesOrder: rec.seriesOrder }).toEqual({ seriesId: null, seriesTitle: null, seriesOrder: null });
  });
});

// #119 St3: illustType 2 is ugoira = a zip of frame images plus a per-frame display
// duration. Neither the zip nor the durations are in the illust payload; /ugoira_meta
// carries both. What gets saved is the raw original pixiv distributes as-is, with no
// conversion (i.e. no bringing in an encoder).
describe('うごイラ（#119 St3）', () => {
  const UGOIRA_ILLUST = {
    error: false,
    body: {
      illustTitle: 'Moving',
      illustType: 2,
      userId: '7',
      userName: 'Artist',
      pageCount: 1,
      width: 700,
      height: 700,
      urls: { original: 'https://i.pximg.net/img-original/img/2026/07/26/1/147661146_ugoira0.jpg' },
      tags: { tags: [] },
    },
  };
  const UGOIRA_META = {
    error: false,
    body: {
      src: 'https://i.pximg.net/img-zip-ugoira/img/2026/07/26/1/147661146_ugoira600x600.zip',
      originalSrc: 'https://i.pximg.net/img-zip-ugoira/img/2026/07/26/1/147661146_ugoira1920x1080.zip',
      mime_type: 'image/jpeg',
      frames: [
        { file: '000000.jpg', delay: 60 },
        { file: '000001.jpg', delay: 30 },
      ],
    },
  };

  function stub(routes: [string, unknown, number?][]) {
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url);
      for (const [frag, body, status] of routes) if (u.includes(frag)) return jsonRes(body, status ?? 200);
      return jsonRes({}, 404);
    });
  }

  test('原本サイズの zip・コマ表・ポスター・Referer を1エントリに載せる', async () => {
    stub([
      ['/ugoira_meta', UGOIRA_META],
      ['/ajax/illust/', UGOIRA_ILLUST],
    ]);

    const rec = await fetchPixivIllust({ id: '147661146' }, 'https://www.pixiv.net/artworks/147661146');
    expect(rec.media).toHaveLength(1);
    expect(rec.media[0]).toMatchObject({
      url: UGOIRA_META.body.originalSrc,
      type: 'ugoira',
      poster: UGOIRA_ILLUST.body.urls.original,
      referer: 'https://www.pixiv.net/',
      width: 700,
      height: 700,
      frames: UGOIRA_META.body.frames,
    });
  });

  // The display label is "short silent loop" = the same category as X's animated_gif
  // or Mastodon's gifv. This is deliberately different from the ingest path
  // (media[].type) (no coining a new term in the facets)
  test('mediaType は gif（media[].type は ugoira）', async () => {
    stub([
      ['/ugoira_meta', UGOIRA_META],
      ['/ajax/illust/', UGOIRA_ILLUST],
    ]);

    const rec = await fetchPixivIllust({ id: '1' }, 'u');
    expect(rec.mediaType).toBe('gif');
    expect(rec.media[0].type).toBe('ugoira');
  });

  test('コマ表が取れなければ静止画（1コマ目）として保存する', async () => {
    stub([
      ['/ugoira_meta', { error: false, body: { originalSrc: 'https://i.pximg.net/x.zip', frames: [] } }],
      ['/ajax/illust/', UGOIRA_ILLUST],
    ]);

    const rec = await fetchPixivIllust({ id: '1' }, 'u');
    expect(rec.mediaType).toBe('image');
    expect(rec.media).toHaveLength(1);
    expect(rec.media[0].url).toBe(UGOIRA_ILLUST.body.urls.original);
    expect(rec.media[0].type).toBeUndefined();
  });

  test('ugoira_meta が 404 でも保存は続く（静止画へ）', async () => {
    stub([['/ajax/illust/', UGOIRA_ILLUST]]);

    const rec = await fetchPixivIllust({ id: '1' }, 'u');
    expect(rec.mediaType).toBe('image');
    expect(rec.media[0].url).toBe(UGOIRA_ILLUST.body.urls.original);
  });

  test('取得原本（#292）に ugoira_meta の本文も積む', async () => {
    stub([
      ['/ugoira_meta', UGOIRA_META],
      ['/ajax/illust/', UGOIRA_ILLUST],
    ]);

    const rec = await fetchPixivIllust({ id: '1' }, 'u');
    expect(rec.raw.map((r: any) => r.sourceKind)).toContain('api:pixiv/ugoira-meta');
  });

  test('うごイラでない作品は ugoira_meta を引かない', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      seen.push(String(url));
      return jsonRes({ error: false, body: { illustType: 0, userId: '7', pageCount: 1, urls: { original: 'https://i.pximg.net/a_p0.jpg' }, tags: { tags: [] } } });
    });

    await fetchPixivIllust({ id: '1' }, 'u');
    expect(seen.some((u) => u.includes('ugoira_meta'))).toBe(false);
  });
});
