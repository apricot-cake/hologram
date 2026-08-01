// X (formerly Twitter).
//
// API: cdn.syndication.twimg.com (the unofficial embed JSON; needs
// host_permissions because its CORS is restricted). There is no public official
// API — likes/replies/text/author/date/media only, no reposts/bookmarks/views.

import { anySrc, findAncestorContainerLink, hostnameMatches, parseMediaUrlPath, prepareScopedCaptureState } from './dom.ts';
import { parseCount } from './dom-meta.ts';
import { emptyRecord, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { DomMeta, Extractor, MediaIdentity, MediaItem, PostMediaElement, PostRecord } from './types.ts';

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

// The photo viewer ("lightbox"): clicking a picture pushes
// /<user>/status/<id>/photo/<n> into the URL bar and draws that picture in a
// modal layer of its own — a subtree that is NOT inside the timeline's
// article[data-testid="tweet"]. That is the whole of #325: the ancestor walk
// that finds every other X post walked from the picture straight past the
// modal to <body> without meeting an article, so the highlight never appeared
// and a click resolved to no post at all.
//
// The path is also where the post id comes from while the viewer is open, and
// the viewer is the only thing that puts this shape in the URL bar.
const X_PHOTO_VIEWER_PATH = /^\/[^/]+\/status\/\d+\/photo\/\d+/;

function findXPostElement(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
  if (!el) return null;
  // The ordinary shape first, unchanged: a post is its article, wherever
  // inside it the pointer happens to be. This branch is also what keeps the
  // replies rendered behind the open viewer attributed to THEMSELVES — they
  // are ordinary articles, and the fallback below would hand them the post the
  // URL bar names (the mis-attribution A-1n exists to catch).
  const article = el.closest?.('article[data-testid="tweet"]') ?? null;
  if (article) return article;
  return findXViewerMedia(el);
}

// The picture the photo viewer is showing — accepts either the picture itself
// (el IS the <img>/<video>) or a wrapper that contains it. The second shape is
// not hypothetical: X layers its own swipe-down-to-dismiss hit target
// (`div[data-testid="swipe-to-dismiss"]`) over the picture, several ancestors
// above the <img>, and that is what a click or a hover-scan unit actually
// lands on. Accepting only the bare element (the original shape here) meant
// the SELECT click landed on the wrapper and resolved to nothing — the
// highlight drawn by the overlay branch below and the click a person then made
// disagreed about what was under the pointer (#582).
//
// Returned as the resolved picture itself (never the wrapper), which is what
// makes the capture rect the picture's own box: the modal spans the viewport,
// and the navigation arrows, the reply column and the dimmed backdrop are not
// part of the post. The permalink then comes from getPermalink's URL-bar
// fallback, which already strips /photo/<n> down to the post.
//
// Nothing else in the viewer is capturable: the close button and the backdrop
// contain no picture, and the author's avatar IS an <img> the URL bar would
// attribute to the post perfectly well — so the same CDN-path allowlist the
// hover save button gates on (#94) decides here too.
function findXViewerMedia(el: Element): Element | null {
  if (!X_PHOTO_VIEWER_PATH.test(location.pathname)) return null;
  const found = el.tagName === 'IMG' || el.tagName === 'VIDEO' ? el : el.querySelector('img, video');
  return found && x.mediaIdentity?.isPostMedia(found as PostMediaElement) ? found : null;
}

// === DOM: what the page shows about the post (#202) ===
//
// The second source of post information, for the posts the syndication API
// answers nothing for. On X that is a measured 4.7% of a real library — 31
// age-restricted posts and 14 protected ones out of 951, counted 2026-07-29 —
// every one of which is fully rendered on the screen of the person saving it.
// It also fills the three counts syndication has no field for at all (see this
// file's header), which are missing from EVERY X record, successful fetch or
// not.
//
// Everything below queries inside the post element only. A document-wide
// lookup here would attribute a neighbouring post's text to this record, and
// unlike a selector that stops matching (which costs nothing — the field stays
// as the API left it) a wrong caption is silently wrong forever.

// A quote card is a post rendered INSIDE another post: its text, its author and
// its timestamp are all in the quoting article's subtree and all belong to a
// different post. `[data-testid="quoteTweet"]` names it where X emits that
// testid; `div[role="link"]` is the shape it has always had (the card is one
// big link to the quoted post) and is what catches the renders that carry no
// testid. Matching too eagerly is the safe direction: an over-wide rule fills
// nothing, an under-wide one fills the wrong post's words.
const X_QUOTE_CARD = '[data-testid="quoteTweet"], div[role="link"]';

// The first match that belongs to THIS post rather than to a card it embeds.
function xOwn(post: Element, selector: string): Element | null {
  for (const el of post.querySelectorAll(selector)) {
    let inCard = false;
    for (let n: Element | null = el.parentElement; n && n !== post; n = n.parentElement) {
      if (n.matches?.(X_QUOTE_CARD)) {
        inCard = true;
        break;
      }
    }
    if (!inCard) return el;
  }
  return null;
}

// Post text as a person reads it: emoji are <img alt="😀"> and line breaks are
// <br>, so textContent alone would silently drop both. <svg> subtrees are
// skipped whole — the verified badge and the icons live there and their <title>
// text ("Verified account") is decoration, not part of what was written.
function xReadText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === 'svg') continue;
    if (tag === 'img') out += child.getAttribute('alt') || '';
    else if (tag === 'br') out += '\n';
    else out += xReadText(child);
  }
  return out;
}

// One engagement control's number. The rendered digits come first and the
// aria-label second, because the label is a sentence in the browser's UI
// language ("1,234 Likes" / "いいね 1,234件") — the number sits in a different
// place in each, so reading it there is a fallback, not the rule.
//
// A count X does not render at all (it hides zeros) yields null, not 0: this
// cannot tell "nobody liked it" from "the page did not say", and null is the
// answer that leaves the record alone.
function xControlCount(control: Element | null): number | null {
  if (!control) return null;
  const shown = control.querySelector('[data-testid="app-text-transition-container"]');
  // The container holds TWO stacked copies of the figure for the length of X's
  // count-change animation (that animation is what the container is for), and
  // reading the whole of it then would splice "12" and "13" into 1213. The
  // first rendered face is one of the two real values; their concatenation is
  // never one.
  const face = shown?.firstElementChild ?? shown;
  const direct = parseCount(face ? xReadText(face) : '');
  if (direct != null) return direct;
  const label = control.getAttribute('aria-label') || '';
  const run = label.match(/\d[\d.,  ]*[KkMmBb万億兆]?/);
  return run ? parseCount(run[0]) : null;
}

// testid per count, both spellings: X flips the control's testid once the
// viewer has acted on the post (like -> unlike), and a list that knew only the
// un-acted spelling would go blank on exactly the posts a person bookmarks.
const X_COUNT_CONTROLS: ReadonlyArray<readonly ['replies' | 'reposts' | 'likes' | 'bookmarks', readonly string[]]> = [
  ['replies', ['reply']],
  ['reposts', ['retweet', 'unretweet']],
  ['likes', ['like', 'unlike']],
  ['bookmarks', ['bookmark', 'removeBookmark']],
];

function extractXDomMeta(post: Element): DomMeta {
  const meta: DomMeta = {};
  if (!(post instanceof Element)) return meta;

  const textEl = xOwn(post, '[data-testid="tweetText"]');
  // No text node at all is a normal state, not a failure: an image-only post
  // has no caption, and an interstitial can render a post with its body held
  // back. Either way nothing is written — an empty string here would be
  // indistinguishable from a text post whose text was lost.
  if (textEl) meta.text = xReadText(textEl);

  // The author block. Its first link is the display name and the one reading
  // "@handle" is the screen name — the same two anchors X has rendered there
  // since the redesign, and the only place on a timeline row that carries the
  // display name at all.
  const nameEl = xOwn(post, '[data-testid="User-Name"]');
  if (nameEl) {
    for (const link of nameEl.querySelectorAll('a')) {
      const label = xReadText(link).trim();
      if (!label) continue;
      if (label.startsWith('@')) meta.screenName ??= label.slice(1);
      else meta.displayName ??= label;
    }
  }

  // <time datetime> is already ISO — the human-readable face ("10h", "1月2日")
  // is locale-dependent and is never parsed.
  const timeEl = xOwn(post, 'time[datetime]');
  if (timeEl) meta.date = toIso(timeEl.getAttribute('datetime'));

  for (const [field, testids] of X_COUNT_CONTROLS) {
    const control = xOwn(post, testids.map((t) => `[data-testid="${t}"]`).join(','));
    const n = xControlCount(control);
    if (n != null) meta[field] = n;
  }
  // Views hang off the analytics link rather than a testid'd button — it is the
  // one number in the action bar that is not a control the viewer can press.
  const views = xControlCount(xOwn(post, 'a[href*="/analytics"]'));
  if (views != null) meta.views = views;

  return meta;
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

// t.co short links in the body text, swapped for the URL entities.urls
// announces (#189). j.text keeps every link shortened — a search or a URL
// probe run over the SAVED text would only ever see t.co, which resolves to
// nothing once the redirect dies. expanded_url is used, never display_url:
// X truncates the latter for on-screen width ("en.wikipedia.org/wiki/…"),
// which is the one thing that must NOT happen to a value being saved for
// full-text search and URL probing (#189's own wording — original URL / original domain).
//
// A plain split/join on the literal t.co string, not entities.urls[].indices:
// the indices are Twitter's own character offsets into the ORIGINAL text and
// have their own surrogate-pair counting rules, while the short URL itself is
// a unique, unambiguous substring — matching on it needs no offset math and
// cannot desync if an earlier replacement changed the string's length.
function xExpandUrls(text: string, entities): string {
  const urls = entities && Array.isArray(entities.urls) ? entities.urls : [];
  let out = text;
  for (const u of urls) {
    if (!u || typeof u.url !== 'string' || typeof u.expanded_url !== 'string') continue;
    out = out.split(u.url).join(u.expanded_url);
  }
  return out;
}

// Has X's own edit history got more than one entry (#189)? edit_control.edit_
// tweet_ids lists every version's tweet id, oldest first — a never-edited
// tweet's own id is the only entry. Unlike Mastodon there is no "when" field
// anywhere in this object (editable_until_msecs is a future deadline, not a
// past edit time), so this can only ever answer the yes/no half.
function xWasEdited(editControl): boolean {
  const ids = editControl && Array.isArray(editControl.edit_tweet_ids) ? editControl.edit_tweet_ids : null;
  return !!ids && ids.length > 1;
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

// Hashtags a '#' run in the post text would produce, for the one case where
// the syndication payload does not list them itself (see xHashtags). A tag is
// letters/digits/underscore in any script — X's own rule — so a '#' inside a
// URL or a lone '#' yields nothing, and the preceding character must not be
// word-like (a colour like "#fff" written after a letter is not a tag).
const X_HASHTAG_IN_TEXT = /(?<![\p{L}\p{N}_])[#＃]([\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*)/gu;

// entities.hashtags[].text is the tag WITHOUT its '#' (the legacy entities
// shape the syndication endpoint still serves). The key is not guaranteed to
// be there: the acquisition originals of real saves show `entities` carrying
// only urls / user_mentions / media on posts that have no hashtag
// (scripts/canary/snapshots/x.json), and a tombstone has no entities at all.
// So its ABSENCE says nothing, and the post text — which syndication always
// returns verbatim, hashes included — is read instead.
function xHashtags(j): string[] {
  const ents = j && j.entities && Array.isArray(j.entities.hashtags) ? j.entities.hashtags : null;
  if (ents) return normalizeHashtags(ents.map((h) => h && h.text));
  return normalizeHashtags([...String((j && j.text) || '').matchAll(X_HASHTAG_IN_TEXT)].map((m) => m[1]));
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
    // A tombstone means the post exists but the public API won't serve it.
    // X names the reason for a deleted post ("This Post was deleted by the Post
    // author") and for a locked one ("limits who can view their Posts"), and
    // names NOTHING for an age-restricted one — the whole tombstone comes back
    // as {}. So the absence of a reason IS the reason (#505): measured over the
    // 951 X posts in a real library on 2026-07-29, every empty tombstone was a
    // post whose logged-out page reads "Age-restricted adult content … to view
    // this media, you'll need to log in to X", and every non-empty one said
    // which of the other causes it was.
    //
    // No login on our side can lift this: cdn.syndication.twimg.com is the
    // anonymous embed API, and X's Adult Content Policy says viewers with no
    // birth date on their profile cannot view marked content. Telling it apart
    // from a deleted post is the whole point — one is gone for good, the other
    // is alive and simply out of this route's reach.
    if (j && j.__typename === 'TweetTombstone') {
      const t = (j.tombstone && j.tombstone.text && j.tombstone.text.text) || '';
      rec.metaError = /limits who can view/i.test(t) ? 'protected' : !t || /age[ -]?restricted/i.test(t) ? 'ageRestricted' : 'unavailable';
      rec.date = xSnowflakeDate(parsed.id);
      return rec;
    }
    rec.text = j.text ? xExpandUrls(j.text, j.entities) : null;
    if (xWasEdited(j.edit_control)) rec.isEdited = true;
    // #178: possibly_sensitive is a real boolean syndication always answers
    // when the fetch succeeds (same "definite value" treatment as
    // favorite_count, not the null-means-no-signal convention isEdited uses).
    // No free-text CW field exists on this endpoint — rec.cw stays null.
    rec.sensitive = typeof j.possibly_sensitive === 'boolean' ? j.possibly_sensitive : null;
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
    rec.hashtags = xHashtags(j);
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
    findPostElement(target: EventTarget | null) {
      return findXPostElement(target);
    },
    getPermalink(post: Element): string {
      // Fall back to the URL bar on a single-status page (parity with Bluesky/
      // Mastodon/Misskey), so an article whose own permalink anchor isn't
      // rendered still yields a usable URL. The photo viewer's picture (#325)
      // reaches this fallback by the same route — it carries no anchor of its
      // own, and parseXPostLink strips the /photo/<n> the URL bar shows.
      return getXPostLink(post)?.url || parseXPostLink(location.href)?.url || '';
    },
    prepareForCapture(post: Element) {
      return prepareScopedCaptureState('__snsCaptureXNoHover', [post, post.parentElement, post.closest('[data-testid="cellInnerDiv"]')]);
    },
    isBulkCapturePage: isXBookmarksPage,
    extractDomMeta: extractXDomMeta,
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
    // Three shapes: a timeline `article` (permalink anchor and media both
    // live somewhere inside it), a media-tab grid tile — a bare `<li>`
    // several ancestors above its own `/status/` anchor, with no
    // `article`/testid wrapper at all (#349, `:has()` reaches the anchor
    // regardless of the div nesting in between) — and the photo viewer's
    // `div[data-testid="swipe-to-dismiss"]`, which wraps exactly the one
    // slide currently shown and sits outside every article (#659, same
    // modal-layer shape #325 first hit for Alt+S). That testid is X's own
    // internal naming and could vanish silently, so mediaIn double-checks it
    // with findXViewerMedia (URL shape `/photo/<n>` + the same CDN-path
    // allowlist every other branch here uses) before treating it as a unit —
    // this also keeps the scope to the photo viewer only, not the video
    // immersive viewer (`/video/<n>`), matching #325's v1 decision not to
    // guess at a shape nobody has confirmed.
    unitSelector: 'article[data-testid="tweet"], li:has(a[href*="/status/"]), div[data-testid="swipe-to-dismiss"]',
    // querySelectorAll returns document order, so the first entry is the
    // first picture of a multi-image post — where the "saved" mark belongs.
    // A grid tile has no tweetPhoto/videoPlayer testid to key on — its
    // <img> IS the media box — so isPostMedia (the same CDN-path check the
    // save button already gates on) filters it directly here instead, and
    // keeps decorations off images that are not the post's own media.
    // Video and GIF tiles pass that check as of #372, so they are tracked
    // like picture tiles: the media tab must answer the same question the
    // timeline does, which is the inconsistency #349 existed to remove.
    //
    // The viewer branch returns the resolved picture itself, never the
    // `swipe-to-dismiss` wrapper (#704, correcting #659): that wrapper is the
    // swipe-down hit target, sized to the viewer's slide — not to the
    // picture — so treating it as the media box put the "saved" corner
    // (controlHost()'s HTMLElement branch, box's own top-left inset) at the
    // viewer's own top-left, on top of X's close (×) button. Grid tiles
    // already dodge this: they hand back the real <img> directly, letting
    // controlHost()'s IMG branch borrow box.parentElement's position:relative
    // instead of inventing a placement rule. findXViewerMedia already returns
    // that resolved element (its own doc comment: "never the wrapper") — this
    // branch is now shaped exactly like the LI one just below.
    mediaIn: (unit) => {
      if (unit.tagName === 'LI') return [...unit.querySelectorAll('img')].filter((img) => x.mediaIdentity?.isPostMedia(img as HTMLImageElement) ?? false);
      if (unit.getAttribute('data-testid') === 'swipe-to-dismiss') {
        const media = findXViewerMedia(unit);
        return media ? [media] : [];
      }
      return [...unit.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]')];
    },
    // The author avatar (#575) — the only element a text-only tweet still has
    // in common with one that has a picture. A grid tile (the LI shape above)
    // never reaches here: it always has media, or mediaIn returns nothing at
    // all for it and there is no separate "text-only tile" to mark.
    textAnchorIn: (unit) => unit.querySelector('[data-testid="Tweet-User-Avatar"]'),
  },

  residentMatches: ['https://x.com/*', 'https://twitter.com/*'],
  apiHostPermissions: ['https://cdn.syndication.twimg.com/*'],
};

export default x;
export { extractXDomMeta, fetchXTweet, getXPostLink, isXBookmarksPage, parseXPostLink, xMedia, xSnowflakeDate, xToken };
export type { XPostLink };
