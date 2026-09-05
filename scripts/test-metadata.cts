'use strict';

// metadata.js を実際の公開投稿（X / Bluesky / pixiv）に対して検証する。
//   node scripts/test-metadata.cts   （ネットワークが必要）

const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');

function show(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        platform: r.platform,
        screenName: r.screenName,
        displayName: r.displayName,
        userId: r.userId,
        text: (r.text || '').slice(0, 50),
        date: r.date,
        likes: r.likes,
        reposts: r.reposts,
        replies: r.replies,
        lang: r.lang,
        mediaType: r.mediaType,
        media: (r.media || []).length,
        isReply: r.isReply,
        isQuote: r.isQuote,
        isThread: r.isThread,
        avatar: r.avatar ? r.avatar.slice(0, 48) : null,
        followers: r.followers,
        authorCreatedAt: r.authorCreatedAt,
      },
      null,
      0,
    ),
  );
}

// 画像「付き」の投稿を優先し、media[] の抽出が実際に運動するようにする。
// 画像付きの投稿が見つからない場合でもテストが動くよう、どんな投稿にも
// フォールバックする。
async function recentBlueskyUrl() {
  for (const actor of ['bsky.app', 'pfrazee.com', 'jay.bsky.team']) {
    const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${actor}&limit=40`);
    const j = await r.json();
    let fallback: string | null = null;
    for (const it of j.feed || []) {
      const uri = it.post && it.post.uri; // at://did/app.bsky.feed.post/rkey の形
      const handle = it.post && it.post.author && it.post.author.handle;
      const m = uri && uri.match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
      if (!m || !handle) continue;
      const url = `https://bsky.app/profile/${handle}/post/${m[1]}`;
      const et = (it.post.embed && it.post.embed.$type) || '';
      if (et.includes('images')) return url;
      if (!fallback) fallback = url;
    }
    if (fallback) return fallback;
  }
  return null;
}

// pixiv: デイリーランキングの JSON は公開で読める。複数ページのエントリを
// 優先し、/ajax/illust/<id>/pages の経路（拡張子混在に対して安全）を運動
// させる。
async function recentPixivUrl() {
  const r = await fetch('https://www.pixiv.net/ranking.php?mode=daily&format=json&p=1', {
    headers: { Referer: 'https://www.pixiv.net/' },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const items = Array.isArray(j.contents) ? j.contents : [];
  const ok = (c) => c && c.illust_id && String(c.illust_type) !== '2'; // うごイラを除外
  const multi = items.find((c) => ok(c) && Number(c.illust_page_count) > 1);
  const any = multi || items.find(ok);
  return any ? { url: `https://www.pixiv.net/artworks/${any.illust_id}`, pages: Number(any.illust_page_count) || 1 } : null;
}

// media[] は常に配列でなければならない。投稿が画像投稿の場合、url を持つ
// 記述子で埋まっていなければならない。
function mediaOk(r) {
  if (!Array.isArray(r.media)) return false;
  if (r.mediaType === 'image') return r.media.length > 0 && r.media.every((m) => m && typeof m.url === 'string');
  return true;
}

(async () => {
  let pass = true;

  const x = await fetchPostMetadata('https://x.com/jack/status/20');
  show('X (jack/status/20)', x);
  if (!(x.text && x.screenName === 'jack' && x.likes > 0 && x.date && mediaOk(x))) {
    pass = false;
    console.log('  X FAIL');
  }

  // X: 保存される url は正規のパーマリンクでなければならない — /photo/N の
  // サフィックスとサブドメインのホスト（pro.x.com）は
  // https://x.com/<user>/status/<id> へ組み直される。
  try {
    const xp = await fetchPostMetadata('https://x.com/jack/status/20/photo/1');
    const xs = await fetchPostMetadata('https://pro.x.com/jack/status/20');
    console.log(`\n=== X canonical === photo-suffix -> ${xp.url} / subdomain -> ${xs.url} (platform ${xs.platform})`);
    if (!(xp.url === 'https://x.com/jack/status/20' && xs.platform === 'x' && xs.url === 'https://x.com/jack/status/20')) {
      pass = false;
      console.log('  X canonical FAIL');
    }
  } catch (e) {
    pass = false;
    console.log('X canonical ERR', e.message);
  }

  // X: media[] は本物の原本を指さなければならない（?name=orig — 素の pbs
  // URL は medium のバリアントを配信する）。
  try {
    const xm = await fetchPostMetadata('https://x.com/BarackObama/status/266031293945503744');
    if (xm.media && xm.media.length) {
      console.log(`=== X media orig === ${xm.media[0].url}`);
      if (!xm.media.every((m) => /name=orig/.test(m.url))) {
        pass = false;
        console.log('  X media orig FAIL');
      }
    } else console.log('X media post: メディアが返らなかった（orig の検証はスキップ）');
  } catch (e) {
    console.log('X media ERR', e.message);
  }

  try {
    const burl = await recentBlueskyUrl();
    if (burl) {
      const b = await fetchPostMetadata(burl);
      show('Bluesky (' + burl + ')', b);
      if (!(b.userId && b.userId.startsWith('did:') && b.screenName && mediaOk(b))) {
        pass = false;
        console.log('  Bluesky FAIL');
      }
    } else {
      console.log('Bluesky: 最近の投稿が見つからなかった（スキップ）');
    }
  } catch (e) {
    console.log('Bluesky ERR', e.message);
  }

  try {
    const pinfo = await recentPixivUrl();
    if (pinfo) {
      const p = await fetchPostMetadata(pinfo.url);
      show(`pixiv (${pinfo.url}, ${pinfo.pages}p)`, p);
      const pOk = p.platform === 'pixiv' && p.title && p.userId && Array.isArray(p.media) && p.media.length === pinfo.pages && p.media.every((m) => m && m.url && m.referer);
      if (!pOk) {
        pass = false;
        console.log('  pixiv FAIL');
      }
    } else console.log('pixiv: ランキングのエントリが見つからなかった（スキップ）');
  } catch (e) {
    console.log('pixiv ERR', e.message);
  }

  console.log('\n' + (pass ? 'METADATA_TEST_PASS' : 'METADATA_TEST_FAIL'));
  process.exit(pass ? 0 : 1);
})();
