'use strict';

// Validates metadata.js against real public posts (X / Bluesky / Misskey).
//   node scripts/test-metadata.js   (needs network)

const { fetchPostMetadata } = require('../extension/metadata');

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

// Prefer a post WITH images so media[] extraction is actually exercised; fall
// back to any post so the test still runs when no image post is found.
async function recentBlueskyUrl() {
  for (const actor of ['bsky.app', 'pfrazee.com', 'jay.bsky.team']) {
    const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${actor}&limit=40`);
    const j = await r.json();
    let fallback = null;
    for (const it of j.feed || []) {
      const uri = it.post && it.post.uri; // at://did/app.bsky.feed.post/rkey
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

async function recentMisskeyUrl() {
  const r = await fetch('https://misskey.io/api/notes/global-timeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 60 }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  const img = j.find((n) => n && Array.isArray(n.files) && n.files.some((f) => f.type && f.type.startsWith('image/') && f.type !== 'image/gif'));
  const note = img || j.find((n) => n && n.id);
  return note ? `https://misskey.io/notes/${note.id}` : null;
}

async function recentMastodonUrl() {
  // public timeline needs auth on some instances; use a known public account.
  const acc = await (await fetch('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron')).json();
  if (!acc || !acc.id) return null;
  const base = `https://mastodon.social/api/v1/accounts/${acc.id}/statuses?limit=20&exclude_reblogs=true`;
  // Prefer a status with an image attachment (only_media=true), fall back to any.
  let st = await (await fetch(base + '&only_media=true')).json();
  let s = Array.isArray(st) ? st.find((x) => x && x.account && !x.reblog && (x.media_attachments || []).some((a) => a.type === 'image')) : null;
  if (!s) {
    st = await (await fetch(base)).json();
    s = Array.isArray(st) ? st.find((x) => x && x.account && !x.reblog) : null;
  }
  // Canonical web URL (/@user/id) that parsePostUrl understands.
  return s ? `https://mastodon.social/@${s.account.acct}/${s.id}` : null;
}

// pixiv: daily ranking JSON is publicly readable; prefer a multi-page entry so
// the /ajax/illust/<id>/pages path (mixed-extension safe) is exercised.
async function recentPixivUrl() {
  const r = await fetch('https://www.pixiv.net/ranking.php?mode=daily&format=json&p=1', {
    headers: { Referer: 'https://www.pixiv.net/' },
  });
  if (!r.ok) return null;
  const j = await r.json();
  const items = Array.isArray(j.contents) ? j.contents : [];
  const ok = (c) => c && c.illust_id && String(c.illust_type) !== '2'; // exclude ugoira
  const multi = items.find((c) => ok(c) && Number(c.illust_page_count) > 1);
  const any = multi || items.find(ok);
  return any ? { url: `https://www.pixiv.net/artworks/${any.illust_id}`, pages: Number(any.illust_page_count) || 1 } : null;
}

// media[] must always be an array; when the post is an image post, it must be
// populated with url-bearing descriptors.
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

  // X: the saved url must be the canonical permalink — /photo/N suffixes and
  // subdomain hosts (pro.x.com) are rebuilt to https://x.com/<user>/status/<id>.
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

  // X: media[] must point at the true original (?name=orig — the bare pbs URL
  // serves the medium variant).
  try {
    const xm = await fetchPostMetadata('https://x.com/BarackObama/status/266031293945503744');
    if (xm.media && xm.media.length) {
      console.log(`=== X media orig === ${xm.media[0].url}`);
      if (!xm.media.every((m) => /name=orig/.test(m.url))) {
        pass = false;
        console.log('  X media orig FAIL');
      }
    } else console.log('X media post: no media returned (skip orig check)');
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
      console.log('Bluesky: no recent post found (skip)');
    }
  } catch (e) {
    console.log('Bluesky ERR', e.message);
  }

  try {
    const murl = await recentMisskeyUrl();
    if (murl) {
      const m = await fetchPostMetadata(murl);
      show('Misskey (' + murl + ')', m);
      if (!(m.screenName && m.date && mediaOk(m))) {
        pass = false;
        console.log('  Misskey FAIL');
      }
    } else {
      console.log('Misskey: no recent note found (skip)');
    }
  } catch (e) {
    console.log('Misskey ERR', e.message);
  }

  try {
    const aurl = await recentMastodonUrl();
    if (aurl) {
      const a = await fetchPostMetadata(aurl);
      show('Mastodon (' + aurl + ')', a);
      if (!(a.platform === 'mastodon' && a.screenName && a.date && a.userId && mediaOk(a))) {
        pass = false;
        console.log('  Mastodon FAIL');
      }
    } else {
      console.log('Mastodon: no recent status (skip)');
    }
  } catch (e) {
    console.log('Mastodon ERR', e.message);
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
    } else console.log('pixiv: no ranking entry found (skip)');
  } catch (e) {
    console.log('pixiv ERR', e.message);
  }

  console.log('\n' + (pass ? 'METADATA_TEST_PASS' : 'METADATA_TEST_FAIL'));
  process.exit(pass ? 0 : 1);
})();
