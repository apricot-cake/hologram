// X (formerly Twitter).
//
// API: cdn.syndication.twimg.com (the unofficial embed JSON; needs
// host_permissions because its CORS is restricted). There is no public official
// API — likes/replies/text/author/date/media only, no reposts/bookmarks/views.

import { anySrc, findAncestorContainerLink, hostnameMatches, parseMediaUrlPath, prepareScopedCaptureState } from './dom.ts';
import { emptyRecord, readJsonKeepingRaw, toIso } from './record.ts';
import type { Extractor, MediaIdentity, MediaItem, PostMediaElement, PostRecord } from './types.ts';

const HOSTS = ['x.com', 'twitter.com'];

// An allowlist of post-media paths, never the host alone: pbs.twimg.com also
// serves avatars (profile_images/) and link-card previews (card_img/), and a
// save button on an avatar is exactly what #94 must not do. Video and GIF
// posts put their poster frame on a *_video_thumb/ path instead of media/,
// which is why the button was missing from most video posts (#372). Every
// entry below was counted on live X before being listed (2026-07-28):
// amplify_video_thumb/ and ext_tw_video_thumb/ on `filter:videos`,
// tweet_video_thumb/ on GIF posts — all three inside the post's own
// videoPlayer box, never on an avatar or a card.
const POST_MEDIA_PATHS = ['media', 'amplify_video_thumb', 'ext_tw_video_thumb', 'tweet_video_thumb'];
const POST_MEDIA_PREFIXES = POST_MEDIA_PATHS.map((p) => `pbs.twimg.com/${p}/`);
// Same allowlist, as the media key's path capture. Built once — mediaKey runs
// per picture per overlay pass.
const POST_MEDIA_KEY = new RegExp(`pbs\\.twimg\\.com/(${POST_MEDIA_PATHS.join('|')})/([^/.?:]+)`);

// === DOM ===

interface XPostLink {
  url: string;
  screenName: string | null;
  postId: string;
}

function getXPostLink(post: Element): XPostLink | null {
  const links = post instanceof Element ? Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) : [];

  // Prefer the timestamp anchor; failing that, a bare /user/status/<id> anchor
  // — the article's first /status/ link can be a /photo/N or /analytics one.
  const preferredLink =
    links.find((link) => link.querySelector('time')) ||
    links.find((link) => {
      try {
        return /^\/[^/]+\/status\/\d+\/?$/.test(new URL(link.href, location.origin).pathname);
      } catch {
        return false;
      }
    }) ||
    links[0];
  return preferredLink ? parseXPostLink(preferredLink.href) : null;
}

function parseXPostLink(href: string): XPostLink | null {
  try {
    const url = new URL(href, location.origin);
    let match = url.pathname.match(/^\/([^/]+)\/status\/([^/?#]+)/);
    if (match) {
      const screenName = match[1];
      const postId = match[2];
      if (screenName === undefined || postId === undefined) return null;
      return {
        // Canonical permalink: strip /photo/N, /analytics, query and hash —
        // the raw href is whatever anchor happened to be picked.
        url: `${url.origin}/${screenName}/status/${postId}`,
        screenName: decodeURIComponent(screenName),
        postId: decodeURIComponent(postId),
      };
    }

    match = url.pathname.match(/^\/i\/web\/status\/([^/?#]+)/);
    if (!match) {
      return null;
    }
    const postId = match[1];
    if (postId === undefined) return null;

    return {
      url: `${url.origin}/i/web/status/${postId}`,
      screenName: null,
      postId: decodeURIComponent(postId),
    };
  } catch {
    return null;
  }
}

// The bookmarks list, and only it: /i/bookmarks and /i/bookmarks/<folderId>.
// Deliberately not the search or any other list page — chase-mode intake (#362)
// walks a list the user curated, not one X assembled.
function isXBookmarksPage(): boolean {
  return /^\/i\/bookmarks(\/|$)/.test(location.pathname);
}

// === API ===

function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// Post date decoded from the tweet id itself (snowflake: ms since the Twitter
// epoch in the bits above 22). Exact, not fabricated — it survives when the
// syndication API returns nothing (protected account / age gate / deleted).
// Pre-snowflake ids (sequential, < ~3e10, before 2010-11-04) don't encode a
// time; the > 4e10 guard rejects them, and the upper bound rejects garbage
// that would decode into the future.
const X_EPOCH_MS = 1288834974657n;
function xSnowflakeDate(id) {
  try {
    const n = BigInt(String(id));
    if (n <= 40000000000n) return null;
    const ms = Number((n >> 22n) + X_EPOCH_MS);
    if (ms > Date.now() + 60000) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function xMediaType(details) {
  const t = details && details[0] && details[0].type;
  if (t === 'video') return 'video';
  if (t === 'animated_gif') return 'gif';
  if (t === 'photo') return 'image';
  return null;
}

// video_info.variants holds several bitrates of the same clip (mp4) plus an
// HLS playlist (application/x-mpegURL) for `video` type — animated_gif has a
// single mp4 variant. Pick the highest-bitrate mp4 (#119 St1: no per-tweet
// quality choice, no HLS support here).
function xVideoVariantUrl(info) {
  const variants = (info && info.variants) || [];
  let best: { bitrate?: number; url: string } | null = null;
  for (const v of variants) {
    if (!v || v.content_type !== 'video/mp4' || !v.url) continue;
    if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
  }
  return best ? best.url : null;
}

// The bare pbs.twimg.com URL serves the MEDIUM variant; ?name=orig is required
// for the actual original (verified empirically — audit 2026-06-11). Used for
// photo originals AND as the poster frame for video/animated_gif (same still
// image X already serves for both).
//
// Distinct from highResUrl() below on purpose: this one upgrades a URL the API
// announced (always a bare media/ URL, no query), highResUrl one the PAGE
// showed (already carrying ?name=<size>, and possibly on a video-thumb path
// that must not be rewritten).
function xOrigUrl(url) {
  return url + (url.includes('?') ? '' : '?name=orig');
}

function xMedia(details) {
  if (!Array.isArray(details)) return [];
  const out: MediaItem[] = [];
  for (const m of details) {
    if (!m || !m.media_url_https) continue;
    const alt = m.ext_alt_text || null;
    const width = (m.original_info && m.original_info.width) || null;
    const height = (m.original_info && m.original_info.height) || null;
    if (m.type === 'photo') {
      out.push({ url: xOrigUrl(m.media_url_https), alt, width, height, type: 'image' });
      continue;
    }
    if (m.type === 'video' || m.type === 'animated_gif') {
      const videoUrl = xVideoVariantUrl(m.video_info);
      if (!videoUrl) continue; // no usable mp4 variant — drop, same as an unfetchable photo
      out.push({ url: videoUrl, alt, width, height, type: m.type === 'animated_gif' ? 'gif' : 'video', poster: xOrigUrl(m.media_url_https) });
    }
  }
  return out;
}

async function fetchXTweet(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'x');
  rec.screenName = parsed.screenName;
  // Canonical permalink: anchors on the page can carry /photo/N, /analytics or
  // query strings, and subdomain hosts (pro.x.com) may not resolve as a status
  // page — rebuild the bare https://x.com/<user>/status/<id> form.
  if (parsed.screenName) rec.url = `https://x.com/${parsed.screenName}/status/${parsed.id}`;
  try {
    const api = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.id}&token=${xToken(parsed.id)}&lang=en`;
    const res = await fetch(api);
    if (!res.ok) {
      rec.metaError = 'unavailable';
      rec.date = xSnowflakeDate(parsed.id);
      return rec;
    }
    const j = await readJsonKeepingRaw(rec, 'api:x/tweet-result', res);
    // A tombstone means the post exists but the public API won't serve it
    // (protected account / age-restricted). Classify from the tombstone text so
    // the partial-save banner can say WHY the post info is missing.
    if (j && j.__typename === 'TweetTombstone') {
      const t = (j.tombstone && j.tombstone.text && j.tombstone.text.text) || '';
      rec.metaError = /limits who can view/i.test(t) ? 'protected' : /age[ -]?restricted/i.test(t) ? 'ageRestricted' : 'unavailable';
      rec.date = xSnowflakeDate(parsed.id);
      return rec;
    }
    rec.text = j.text || null;
    if (j.user) {
      rec.displayName = j.user.name || null;
      rec.screenName = j.user.screen_name || rec.screenName;
      rec.userId = j.user.id_str || null;
      // Avatar: syndication serves the 48px _normal variant; rebuild the 400px one
      // (X has no public follower count / account-creation date — both stay null).
      if (j.user.profile_image_url_https) {
        rec.avatar = j.user.profile_image_url_https.replace(/_normal(\.[a-z]+)(?=$|\?)/i, '_400x400$1');
      }
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
    rec.metaError = 'fetchFailed';
  }
  // The id encodes the post time even when the API gave us nothing.
  if (!rec.date) rec.date = xSnowflakeDate(parsed.id);
  return rec;
}

// === The extractor ===

const x: Extractor = {
  platform: 'x',

  parseUrl(u) {
    // Subdomains (pro.x.com, mobile.twitter.com …) serve the same web UI and
    // are accepted by the resident content script's host match — accept them
    // here too, otherwise the capture saves with platform-only metadata.
    // (audit 2026-06-11)
    const host = u.hostname;
    if (!(host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com'))) return null;
    const m = u.pathname.match(/\/status\/(\d+)/);
    if (!m) return null;
    return { platform: 'x', id: m[1], screenName: (u.pathname.match(/^\/([^/]+)\/status/) || [])[1] || null };
  },
  isAllowedOrigin: (_tabUrl, hostname) => HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  fetchPost: fetchXTweet,

  mediaKey(url) {
    // Both halves of the path: the id alone would let a photo and a video
    // poster of the same post collide on a shared id space we do not control.
    const m = url.match(POST_MEDIA_KEY);
    return m ? `${m[1]}/${m[2]}` : null;
  },
  highResUrl(url) {
    // Only media/ is rewritten: X serves those with a ?name=<size> variant, so
    // name=orig is what upgrades a thumbnail to the full picture. The video/GIF
    // poster paths (see POST_MEDIA_PATHS) carry no name= parameter and are
    // already the original — name=orig on them answers 200 with byte-identical
    // content (measured on live X, 2026-07-28), so rewriting would only add a
    // duplicate candidate URL.
    if (!url.includes('pbs.twimg.com/media/')) return null;
    try {
      const u = new URL(url);
      u.searchParams.set('name', 'orig');
      return u.href;
    } catch {
      return null;
    }
  },

  matchesPage: () => hostnameMatches('x.com') || hostnameMatches('twitter.com'),

  capture: {
    platform: 'x',
    postSelector: 'article[data-testid="tweet"]',
    captureStyleText: `
        .__snsCaptureXNoHover,
        .__snsCaptureXNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureXNoHover,
        .__snsCaptureXNoHover:hover,
        .__snsCaptureXNoHover > div,
        .__snsCaptureXNoHover > div:hover,
        .__snsCaptureXNoHover > article,
        .__snsCaptureXNoHover > article:hover {
          background-color: transparent !important;
        }
      `,
    getPermalink(post: Element): string {
      // Fall back to the URL bar on a single-status page (parity with Bluesky/
      // Mastodon/Misskey), so an article whose own permalink anchor isn't
      // rendered still yields a usable URL.
      return getXPostLink(post)?.url || parseXPostLink(location.href)?.url || '';
    },
    prepareForCapture(post: Element) {
      return prepareScopedCaptureState('__snsCaptureXNoHover', [post, post.parentElement, post.closest('[data-testid="cellInnerDiv"]')]);
    },
    isBulkCapturePage: isXBookmarksPage,
  },

  mediaIdentity: {
    platform: 'x',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      // The image's own enclosing /status/ anchor is ground truth. The URL
      // bar (photo viewer / detail page) only identifies anchor-less images
      // OUTSIDE any post container — with the lightbox open, every image on
      // the page (replies, recommendations) would otherwise be attributed
      // to the lightbox post. (audit 2026-06-11)
      const link = (el.closest('a[href*="/status/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/status/"]', 'article') as HTMLAnchorElement | null);
      const parsedAnchor = link ? parseMediaUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
      const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
      const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      let screenName: string | undefined, postId: string | undefined;
      if (parsedAnchor) {
        [, screenName, postId] = parsedAnchor.match;
      } else if ((viewer || parsedLoc) && !el.closest('article')) {
        [, screenName, postId] = (viewer || parsedLoc) as RegExpMatchArray;
      } else return null;
      if (!screenName || !postId) return null;
      const sn = decodeURIComponent(screenName);
      const pid = decodeURIComponent(postId);
      return { postId: pid, link: `https://x.com/${sn}/status/${pid}` };
    },
    isPostMedia: (el) => anySrc(el, (src) => POST_MEDIA_PREFIXES.some((prefix) => src.includes(prefix))),
  },

  overlay: {
    // Two shapes: a timeline `article` (permalink anchor and media both
    // live somewhere inside it) and a media-tab grid tile — a bare `<li>`
    // several ancestors above its own `/status/` anchor, with no
    // `article`/testid wrapper at all (#349). `:has()` reaches the anchor
    // regardless of the div nesting in between.
    unitSelector: 'article[data-testid="tweet"], li:has(a[href*="/status/"])',
    // querySelectorAll returns document order, so the first entry is the
    // first picture of a multi-image post — where the "saved" mark belongs.
    // A grid tile has no tweetPhoto/videoPlayer testid to key on — its
    // <img> IS the media box — so isPostMedia (the same CDN-path check the
    // save button already gates on) filters it directly here instead, and
    // keeps decorations off images that are not the post's own media.
    // Video and GIF tiles pass that check as of #372, so they are tracked
    // like picture tiles: the media tab must answer the same question the
    // timeline does, which is the inconsistency #349 existed to remove.
    mediaIn: (unit) => {
      if (unit.tagName === 'LI') return [...unit.querySelectorAll('img')].filter((img) => x.mediaIdentity?.isPostMedia(img as HTMLImageElement) ?? false);
      return [...unit.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]')];
    },
  },

  residentMatches: ['https://x.com/*', 'https://twitter.com/*'],
  apiHostPermissions: ['https://cdn.syndication.twimg.com/*'],
};

export default x;
export { fetchXTweet, getXPostLink, isXBookmarksPage, parseXPostLink, xMedia, xSnowflakeDate, xToken };
export type { XPostLink };
