'use strict';

// Deterministic pixiv unit test (no network). Validates parsePostUrl, the
// multi-page media[] derivation, and fetchPixivIllust's field mapping by
// injecting a fake global fetch. The real fetch runs in the extension service
// worker with the user's pixiv cookies + host_permission, so a live Node fetch
// is unrepresentative — we mock the ajax response instead.
//
//   node scripts/test-pixiv.js

const { parsePostUrl, fetchPixivIllust, pixivMedia } = require('../extension/metadata');

let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('PASS', msg);
  } else {
    fail++;
    console.log('FAIL', msg);
  }
}

// --- parsePostUrl ---
ok(parsePostUrl('https://www.pixiv.net/en/artworks/12345')?.id === '12345', 'parse /en/artworks/<id>');
ok(parsePostUrl('https://www.pixiv.net/artworks/999')?.platform === 'pixiv', 'parse /artworks platform=pixiv');
ok(parsePostUrl('https://pixiv.net/artworks/42')?.id === '42', 'parse no-www host');
ok(parsePostUrl('https://www.pixiv.net/users/1') === null, 'non-artwork (/users) → null');

// --- pixivMedia (multi-page derivation) ---
const media = pixivMedia({ pageCount: 2, width: 10, height: 20, urls: { original: 'https://i.pximg.net/img-original/img/2021/01/01/00/00/00/100_p0.jpg' } });
ok(media.length === 2 && /100_p1\.jpg$/.test(media[1].url), 'media _p0 → _p1 derived');
ok(
  media.every((x) => x.referer === 'https://www.pixiv.net/'),
  'every media entry carries pixiv Referer',
);
ok(media[0].width === 10 && media[1].width === null, 'page 0 keeps dims, later pages null');

(async () => {
  // --- fetchPixivIllust success mapping ---
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
  global.fetch = async () => ({ ok: true, json: async () => ({ error: false, body }) });
  const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');
  ok(rec.platform === 'pixiv', 'rec.platform=pixiv');
  ok(rec.title === 'My Art', 'title ← illustTitle');
  ok(rec.displayName === 'Artist' && rec.screenName === '77' && rec.userId === '77', 'author fields');
  ok(rec.likes === 10 && rec.bookmarks === 20 && rec.views === 300 && rec.replies === 4, 'engagement fields');
  ok(JSON.stringify(rec.hashtags) === JSON.stringify(['foo', 'bar']), 'hashtags ← tags.tags');
  ok(rec.media.length === 3 && rec.media[2].url.endsWith('555_p2.png'), 'media 3 pages derived');
  ok(rec.media[0].referer === 'https://www.pixiv.net/', 'media Referer set');
  ok(rec.mediaType === 'image', 'mediaType=image');

  // --- error body (deleted / private / R-18 logged out): 200 + {error:true} ---
  global.fetch = async () => ({ ok: true, json: async () => ({ error: true, message: 'not found' }) });
  const rec2 = await fetchPixivIllust({ id: '1' }, 'https://www.pixiv.net/artworks/1');
  ok(rec2.platform === 'pixiv' && rec2.title === null && rec2.media.length === 0, 'error body → empty record, no throw');

  // --- HTTP error → empty record ---
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const rec3 = await fetchPixivIllust({ id: '2' }, 'u');
  ok(rec3.media.length === 0 && rec3.likes === null, 'HTTP 404 → empty record');

  console.log(fail ? '\nPIXIV_TEST_FAIL' : '\nPIXIV_TEST_PASS');
  process.exit(fail ? 1 : 0);
})();
