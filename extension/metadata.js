'use strict';

// Stable metadata acquisition from official / public APIs (no DOM scraping).
// Given a post URL, fetch the post's metadata from the platform API and return
// a normalized record (sidecar field names). Used by background.js via
// importScripts; also requirable in Node for tests.
//
//   X (Twitter): cdn.syndication.twimg.com (unofficial embed JSON; needs
//                host_permissions because its CORS is restricted). No public
//                official API — likes/replies/text/author/date/media only
//                (no reposts/bookmarks/views).
//   Bluesky    : public.api.bsky.app (official public API, CORS *).
//   Misskey    : <instance>/api/notes/show (official API, CORS * by default).

function parsePostUrl(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname;
  let m;
  if (host === 'bsky.app' && (m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/))) {
    return { platform: 'bluesky', handle: m[1], rkey: m[2] };
  }
  // Subdomains (pro.x.com, mobile.twitter.com …) serve the same web UI and are
  // accepted by content.js's host match — accept them here too, otherwise the
  // capture saves with platform-only metadata. (audit 2026-06-11)
  if ((host === 'x.com' || host === 'twitter.com' ||
       host.endsWith('.x.com') || host.endsWith('.twitter.com')) &&
      (m = u.pathname.match(/\/status\/(\d+)/))) {
    return { platform: 'x', id: m[1], screenName: (u.pathname.match(/^\/([^/]+)\/status/) || [])[1] || null };
  }
  // Mastodon web URL: /@user/<numericId> (id starts with a digit; excludes
  // profile sub-pages like /@user/media). Must come before the Misskey /notes/.
  if ((m = u.pathname.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/))) {
    return { platform: 'mastodon', host, id: decodeURIComponent(m[1]) };
  }
  if ((m = u.pathname.match(/^\/notes\/([^/?#]+)/))) {
    return { platform: 'misskey', host, noteId: m[1] };
  }
  // pixiv artwork: /artworks/<id> (with optional /en /ja locale prefix).
  if ((host === 'www.pixiv.net' || host === 'pixiv.net') && (m = u.pathname.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/))) {
    return { platform: 'pixiv', id: m[1] };
  }
  return null;
}

function emptyRecord(url, platform) {
  return {
    url: url || null, platform: platform || null, text: null, title: null,
    displayName: null, screenName: null, userId: null,
    likes: null, reposts: null, replies: null, bookmarks: null, views: null,
    date: null, mediaType: null, media: [], lang: null,
    isReply: null, isQuote: null, isThread: null, quotedUrl: null,
    // Reply parent's platform-local post id (tweet id / rkey / note id / status
    // id). Lets the viewer group a self-reply with its parent when both are in
    // the library.
    replyToId: null,
    hashtags: [], tags: []
  };
}

function toIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// --- X / Twitter (syndication) ---
function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function xMediaType(details) {
  const t = details && details[0] && details[0].type;
  if (t === 'video') return 'video';
  if (t === 'animated_gif') return 'gif';
  if (t === 'photo') return 'image';
  return null;
}

// Original-resolution still images only (skip video/animated_gif).
// The bare pbs.twimg.com URL serves the MEDIUM variant; ?name=orig is required
// for the actual original (verified empirically — audit 2026-06-11).
function xMedia(details) {
  if (!Array.isArray(details)) return [];
  return details
    .filter((m) => m && m.type === 'photo' && m.media_url_https)
    .map((m) => ({
      url: m.media_url_https + (m.media_url_https.includes('?') ? '' : '?name=orig'),
      alt: m.ext_alt_text || null,
      width: (m.original_info && m.original_info.width) || null,
      height: (m.original_info && m.original_info.height) || null
    }));
}

async function fetchXTweet(parsed, url) {
  const rec = emptyRecord(url, 'x');
  rec.screenName = parsed.screenName;
  // Canonical permalink: anchors on the page can carry /photo/N, /analytics or
  // query strings, and subdomain hosts (pro.x.com) may not resolve as a status
  // page — rebuild the bare https://x.com/<user>/status/<id> form.
  if (parsed.screenName) rec.url = `https://x.com/${parsed.screenName}/status/${parsed.id}`;
  try {
    const api = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.id}&token=${xToken(parsed.id)}&lang=en`;
    const res = await fetch(api, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return rec;
    const j = await res.json();
    rec.text = j.text || null;
    if (j.user) {
      rec.displayName = j.user.name || null;
      rec.screenName = j.user.screen_name || rec.screenName;
      rec.userId = j.user.id_str || null;
      if (j.user.screen_name) rec.url = `https://x.com/${j.user.screen_name}/status/${parsed.id}`;
    }
    rec.likes = j.favorite_count ?? null;
    rec.replies = j.conversation_count ?? null;
    rec.date = toIso(j.created_at);
    rec.lang = j.lang || null;
    rec.mediaType = xMediaType(j.mediaDetails);
    rec.media = xMedia(j.mediaDetails);
    if (j.in_reply_to_screen_name) {
      rec.isReply = true;
      rec.replyToId = j.in_reply_to_status_id_str || null;
      // self-reply (thread): promote to thread and clear isReply, so the four
      // platforms categorize mutually-exclusively (a self-thread is not a reply).
      if (j.in_reply_to_user_id_str && j.user && j.in_reply_to_user_id_str === j.user.id_str) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    if (j.quoted_tweet) {
      rec.isQuote = true;
      // Guard screen_name: a quoted_tweet can carry a user object without a
      // screen_name, which would otherwise build .../undefined/status/<id>.
      const qt = j.quoted_tweet;
      if (qt.user && qt.user.screen_name && qt.id_str) {
        rec.quotedUrl = `https://x.com/${qt.user.screen_name}/status/${qt.id_str}`;
      }
    }
  } catch {
    // network/parse failure — keep what we have (URL + screenName)
  }
  return rec;
}

// --- Bluesky (public API) ---
async function resolveBlueskyDid(handle) {
  if (!handle || handle.startsWith('did:')) return handle || null;
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.did && /^did:[a-z]+:.+/.test(data.did)) ? data.did : null;
  } catch {
    return null;
  }
}

function bskyMediaType(post) {
  const e = post.embed || (post.record && post.record.embed);
  const type = e && e.$type ? e.$type : '';
  if (type.includes('app.bsky.embed.video')) return 'video';
  if (type.includes('app.bsky.embed.images')) return 'image';
  if (type.includes('recordWithMedia')) {
    const mt = e.media && e.media.$type ? e.media.$type : '';
    if (mt.includes('video')) return 'video';
    if (mt.includes('images')) return 'image';
  }
  return null;
}

// Original-resolution still images from an images embed (or recordWithMedia).
function bskyMedia(post) {
  const e = post.embed || (post.record && post.record.embed);
  if (!e) return [];
  const type = e.$type || '';
  let images = null;
  if (type.includes('app.bsky.embed.images')) images = e.images;
  else if (type.includes('recordWithMedia') && e.media && (e.media.$type || '').includes('images')) images = e.media.images;
  if (!Array.isArray(images)) return [];
  return images
    .filter((im) => im && im.fullsize)
    .map((im) => ({
      url: im.fullsize,
      alt: im.alt || null,
      width: (im.aspectRatio && im.aspectRatio.width) || null,
      height: (im.aspectRatio && im.aspectRatio.height) || null
    }));
}

async function fetchBlueskyPost(parsed, url) {
  const rec = emptyRecord(url, 'bluesky');
  rec.screenName = parsed.handle;
  const did = await resolveBlueskyDid(parsed.handle);
  if (did) rec.userId = did;
  if (!did) return rec;
  try {
    const uri = `at://${did}/app.bsky.feed.post/${parsed.rkey}`;
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=1`);
    if (!res.ok) return rec;
    const data = await res.json();
    const thread = data && data.thread;
    const post = thread && thread.post;
    if (!post) return rec;
    const record = post.record || {};
    rec.text = record.text || null;
    rec.date = toIso(record.createdAt);
    rec.likes = post.likeCount ?? null;
    rec.reposts = post.repostCount ?? null;
    rec.replies = post.replyCount ?? null;
    if (post.author) {
      rec.displayName = post.author.displayName || null;
      rec.screenName = post.author.handle || rec.screenName;
      rec.userId = post.author.did || rec.userId;
    }
    if (record.langs && record.langs.length) rec.lang = record.langs[0];
    rec.mediaType = bskyMediaType(post);
    rec.media = bskyMedia(post);
    if (record.reply) {
      rec.isReply = true;
      // self-reply (thread): parent author DID matches this author
      const parentUri = record.reply.parent && record.reply.parent.uri;
      const m = parentUri && parentUri.match(/^at:\/\/(did:[^/]+)\//);
      const pm = parentUri && parentUri.match(/\/app\.bsky\.feed\.post\/([^/?#]+)/);
      rec.replyToId = pm ? pm[1] : null;
      if (m && post.author && m[1] === post.author.did) { rec.isThread = true; rec.isReply = null; }
    }
    const embType = (post.embed && post.embed.$type) || (record.embed && record.embed.$type) || '';
    if (embType.includes('app.bsky.embed.record')) {
      const rec2 = (post.embed && post.embed.record) || {};
      const quri = rec2.uri || (rec2.record && rec2.record.uri);
      // Only a quoted POST is a quote. embed.record also wraps lists, feeds and
      // starter packs (their uri is app.bsky.graph.* / app.bsky.feed.generator),
      // which must NOT mark the post as a quote. Gate on the feed.post uri.
      const qm = (typeof quri === 'string')
        ? quri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/) : null;
      if (qm) {
        rec.isQuote = true;
        // recordWithMedia nests the quoted ViewRecord one level deeper
        // (embed.record.record) — read the handle from whichever level has it.
        const qhandle = (rec2.author && rec2.author.handle) ||
          (rec2.record && rec2.record.author && rec2.record.author.handle);
        rec.quotedUrl = `https://bsky.app/profile/${qhandle || qm[1]}/post/${qm[2]}`;
      }
    }
  } catch {
    // keep partial
  }
  return rec;
}

// --- Misskey (instance API) ---
function misskeyMediaType(files) {
  const f = files && files[0];
  const t = f && f.type ? f.type : '';
  if (t.startsWith('video/')) return /gif/i.test(t) ? 'gif' : 'video';
  if (t === 'image/gif') return 'gif';
  if (t.startsWith('image/')) return 'image';
  return null;
}

// Original-resolution still images (skip gifs and non-image files).
function misskeyMedia(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f && typeof f.type === 'string' && f.type.startsWith('image/') && f.type !== 'image/gif' && f.url)
    .map((f) => ({
      url: f.url,
      alt: f.comment || null,
      width: (f.properties && f.properties.width) || null,
      height: (f.properties && f.properties.height) || null
    }));
}

async function fetchMisskeyNote(parsed, url) {
  const rec = emptyRecord(url, 'misskey');
  // Canonical permalink: the saved URL may carry a query/hash; rebuild the bare
  // https://<instance>/notes/<id> form (opens on the instance the user viewed).
  rec.url = `https://${parsed.host}/notes/${parsed.noteId}`;
  try {
    const res = await fetch(`https://${parsed.host}/api/notes/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: parsed.noteId })
    });
    if (!res.ok) return rec;
    const note = await res.json();
    rec.text = note.text || null;
    rec.date = toIso(note.createdAt);
    if (note.user) {
      rec.displayName = note.user.name || null;
      // Federated remote authors carry their home server in user.host — keep it
      // (user@host, like Mastodon's acct) so same-named users on different
      // instances don't collapse into one identity.
      rec.screenName = note.user.username
        ? (note.user.host ? `${note.user.username}@${note.user.host}` : note.user.username)
        : null;
      rec.userId = note.user.id || null;
    }
    if (note.reactions) {
      const total = Object.values(note.reactions).reduce((s, n) => s + n, 0);
      rec.likes = total > 0 ? total : 0;
    }
    rec.reposts = note.renoteCount ?? null;
    rec.replies = note.repliesCount ?? null;
    if (note.lang) rec.lang = note.lang;
    rec.mediaType = misskeyMediaType(note.files);
    rec.media = misskeyMedia(note.files);
    if (note.replyId) {
      rec.isReply = true;
      rec.replyToId = note.replyId;
      if (note.reply && note.reply.userId && note.reply.userId === note.userId) { rec.isThread = true; rec.isReply = null; }
    }
    // A renote counts as a QUOTE when it adds anything of its own — text, CW,
    // files or a poll (misskey-js isPureRenote semantics). Text-only checks
    // missed image-only quotes. (audit 2026-06-11)
    if (note.renoteId && (note.text || note.cw ||
        (Array.isArray(note.files) && note.files.length) ||
        (Array.isArray(note.fileIds) && note.fileIds.length) || note.poll)) {
      rec.isQuote = true;
      // Prefer the quoted note's own canonical URL — a federated remote note
      // exposes url/uri; a note local to this instance has neither, so fall back
      // to the local-host permalink.
      if (note.renote) {
        rec.quotedUrl = note.renote.url || note.renote.uri || `https://${parsed.host}/notes/${note.renoteId}`;
      }
    }
  } catch {
    // keep partial
  }
  return rec;
}

// --- Mastodon (official public REST API) ---
function htmlToText(html) {
  if (!html) return null;
  let s = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<[^>]+>/g, '');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return s.trim() || null;
}

function mastodonMediaType(atts) {
  const t = atts && atts[0] && atts[0].type;
  if (t === 'video') return 'video';
  if (t === 'gifv') return 'gif';
  if (t === 'image') return 'image';
  return null;
}

// Original-resolution still images only.
function mastodonMedia(atts) {
  if (!Array.isArray(atts)) return [];
  return atts
    .filter((a) => a && a.type === 'image' && a.url)
    .map((a) => ({
      url: a.url,
      alt: a.description || null,
      width: (a.meta && a.meta.original && a.meta.original.width) || null,
      height: (a.meta && a.meta.original && a.meta.original.height) || null
    }));
}

// A Mastodon status permalink looks like /@user/<numericId>. Posts that federated
// in from non-Mastodon software (Lemmy/PieFed/Mbin/...) report a canonical s.url
// in that software's own scheme, which doesn't open as a status (404/forbidden).
function isMastodonStatusUrl(u) {
  try { return /^\/@[^/]+\/\d+\/?$/.test(new URL(u).pathname); } catch { return false; }
}

async function fetchMastodonStatus(parsed, url) {
  const rec = emptyRecord(url, 'mastodon');
  try {
    const res = await fetch(`https://${parsed.host}/api/v1/statuses/${parsed.id}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return rec;
    const s = await res.json();
    // Keep the canonical permalink only when it's a real Mastodon status URL;
    // otherwise fall back to the instance URL we captured (always opens in the
    // Mastodon UI), so federated Lemmy/PieFed posts don't become dead links.
    rec.url = (s.url && isMastodonStatusUrl(s.url)) ? s.url : url;
    rec.text = htmlToText(s.content);
    rec.date = toIso(s.created_at);
    if (s.account) {
      rec.displayName = s.account.display_name || s.account.username || null;
      rec.screenName = s.account.acct || s.account.username || null;
      rec.userId = s.account.id || null;
    }
    rec.likes = s.favourites_count ?? null;
    rec.reposts = s.reblogs_count ?? null;
    rec.replies = s.replies_count ?? null;
    rec.lang = s.language || null;
    rec.mediaType = mastodonMediaType(s.media_attachments);
    rec.media = mastodonMedia(s.media_attachments);
    if (s.in_reply_to_id) {
      rec.isReply = true;
      rec.replyToId = String(s.in_reply_to_id);
      if (s.account && s.in_reply_to_account_id && s.in_reply_to_account_id === s.account.id) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    // Quotes: forks (Fedibird/glitch-soc) put a full status directly in
    // `quote`; mainline Mastodon 4.4+ wraps it as { state, quoted_status }
    // (ShallowQuote: { state, quoted_status_id }). Handle all three shapes.
    const q = s.quote;
    if (q && (q.url || q.uri || q.quoted_status || q.quoted_status_id)) {
      rec.isQuote = true;
      rec.quotedUrl = q.url || q.uri ||
        (q.quoted_status && (q.quoted_status.url || q.quoted_status.uri)) || null;
    }
  } catch {
    // keep partial
  }
  return rec;
}

// --- pixiv (undocumented ajax frontend API) ---
// Original-resolution still images. Multi-page works expose page 0 at
// urls.original; the other pages share the same path with _p0 → _pN. Each entry
// carries a Referer because i.pximg.net 403s downloads without it (the native
// host honors media[].referer).
function pixivMedia(il) {
  const original = il && il.urls && il.urls.original;
  if (!original) return [];
  const pageCount = il.pageCount || 1;
  const out = [];
  for (let i = 0; i < pageCount; i++) {
    const url = i === 0 ? original : original.replace(/_p0(\.[a-z]+)$/i, `_p${i}$1`);
    out.push({
      url,
      alt: null,
      width: i === 0 ? (il.width || null) : null,
      height: i === 0 ? (il.height || null) : null,
      referer: 'https://www.pixiv.net/'
    });
  }
  return out;
}

async function fetchPixivIllust(parsed, url) {
  const rec = emptyRecord(url, 'pixiv');
  try {
    // credentials:include so logged-in users can read R-18 / follower-only works.
    const res = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(parsed.id)}`, { credentials: 'include' });
    if (!res.ok) return rec;
    const data = await res.json();
    // pixiv returns 200 + { error:true } for deleted / private / R-18-logged-out.
    if (data.error) return rec;
    const il = data.body || {};
    rec.title = il.illustTitle || null;
    // Caption (HTML) → text, so caption words are searchable in the viewer.
    rec.text = htmlToText(il.illustComment || il.description || '');
    rec.displayName = il.userName || null;
    rec.screenName = il.userId || null;   // pixiv has no @handle; userId is the stable id
    rec.userId = il.userId || null;
    rec.likes = il.likeCount ?? null;
    rec.bookmarks = il.bookmarkCount ?? null;
    rec.views = il.viewCount ?? null;
    rec.replies = il.commentCount ?? null;
    rec.date = toIso(il.createDate || il.uploadDate);
    rec.hashtags = (il.tags && Array.isArray(il.tags.tags) ? il.tags.tags : []).map((t) => t.tag).filter(Boolean);
    rec.mediaType = 'image';   // ugoira (animation) originals are zip — not handled here
    rec.media = pixivMedia(il);
    // Multi-page works can MIX file formats per page (p0=.jpg, p2=.png …), so
    // the _p0→_pN substitution above can 404. Prefer the per-page originals
    // from /ajax/illust/<id>/pages; keep the substitution as the fallback.
    if ((il.pageCount || 1) > 1) {
      try {
        const pres = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(parsed.id)}/pages`, { credentials: 'include' });
        if (pres.ok) {
          const pdata = await pres.json();
          if (!pdata.error && Array.isArray(pdata.body) && pdata.body.length) {
            rec.media = pdata.body
              .map((p) => ({
                url: p.urls && p.urls.original,
                alt: null,
                width: p.width || null,
                height: p.height || null,
                referer: 'https://www.pixiv.net/'
              }))
              .filter((m) => m.url);
          }
        }
      } catch { /* keep the substituted fallback */ }
    }
  } catch {
    // network/parse failure — keep what we have (URL only)
  }
  return rec;
}

async function fetchPostMetadata(url, opts) {
  const parsed = parsePostUrl(url);
  if (!parsed) return emptyRecord(url, null);
  // SSRF / origin-confusion guard. Misskey & Mastodon derive the API host from
  // the post URL (instances are arbitrary hosts), so a postUrl host chosen by a
  // hostile page would aim our privileged background fetch at an attacker-named
  // host. When the caller knows the sender tab's host, require the instance host
  // to match it — content.js only ever extracts a same-instance permalink, so
  // this rejects nothing legitimate. X / Bluesky / pixiv use fixed API hosts and
  // are unaffected (their parse only matches the known hosts).
  const expectedHost = opts && opts.expectedHost;
  if (expectedHost && (parsed.platform === 'misskey' || parsed.platform === 'mastodon') &&
      parsed.host !== expectedHost) {
    return emptyRecord(url, parsed.platform);
  }
  if (parsed.platform === 'x') return fetchXTweet(parsed, url);
  if (parsed.platform === 'bluesky') return fetchBlueskyPost(parsed, url);
  if (parsed.platform === 'misskey') return fetchMisskeyNote(parsed, url);
  if (parsed.platform === 'mastodon') return fetchMastodonStatus(parsed, url);
  if (parsed.platform === 'pixiv') return fetchPixivIllust(parsed, url);
  return emptyRecord(url, parsed.platform);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parsePostUrl, fetchPostMetadata, fetchXTweet, fetchBlueskyPost, fetchMisskeyNote, fetchPixivIllust, xToken,
    xMedia, bskyMedia, misskeyMedia, mastodonMedia, pixivMedia
  };
}
