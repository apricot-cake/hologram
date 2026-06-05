'use strict';

// Validates metadata.js against real public posts (X / Bluesky / Misskey).
//   node scripts/test-metadata.js   (needs network)

const { fetchPostMetadata } = require('../metadata');

function show(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify({
    platform: r.platform, screenName: r.screenName, displayName: r.displayName, userId: r.userId,
    text: (r.text || '').slice(0, 50), date: r.date, likes: r.likes, reposts: r.reposts,
    replies: r.replies, lang: r.lang, mediaType: r.mediaType,
    isReply: r.isReply, isQuote: r.isQuote, isThread: r.isThread
  }, null, 0));
}

async function recentBlueskyUrl() {
  const r = await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=5');
  const j = await r.json();
  for (const it of (j.feed || [])) {
    const uri = it.post && it.post.uri; // at://did/app.bsky.feed.post/rkey
    const handle = it.post && it.post.author && it.post.author.handle;
    const m = uri && uri.match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
    if (m && handle) return `https://bsky.app/profile/${handle}/post/${m[1]}`;
  }
  return null;
}

async function recentMisskeyUrl() {
  const r = await fetch('https://misskey.io/api/notes/local-timeline', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5 })
  });
  const j = await r.json();
  const note = (j || []).find(n => n && n.id);
  return note ? `https://misskey.io/notes/${note.id}` : null;
}

(async () => {
  let pass = true;

  const x = await fetchPostMetadata('https://x.com/jack/status/20');
  show('X (jack/status/20)', x);
  if (!(x.text && x.screenName === 'jack' && x.likes > 0 && x.date)) { pass = false; console.log('  X FAIL'); }

  try {
    const burl = await recentBlueskyUrl();
    if (burl) {
      const b = await fetchPostMetadata(burl);
      show('Bluesky (' + burl + ')', b);
      if (!(b.userId && b.userId.startsWith('did:') && b.screenName)) { pass = false; console.log('  Bluesky FAIL'); }
    } else { console.log('Bluesky: no recent post found (skip)'); }
  } catch (e) { console.log('Bluesky ERR', e.message); }

  try {
    const murl = await recentMisskeyUrl();
    if (murl) {
      const m = await fetchPostMetadata(murl);
      show('Misskey (' + murl + ')', m);
      if (!(m.screenName && m.date)) { pass = false; console.log('  Misskey FAIL'); }
    } else { console.log('Misskey: no recent note found (skip)'); }
  } catch (e) { console.log('Misskey ERR', e.message); }

  console.log('\n' + (pass ? 'METADATA_TEST_PASS' : 'METADATA_TEST_FAIL'));
  process.exit(pass ? 0 : 1);
})();
