// API-phase helpers shared by more than one extractor: the normalized record
// every fetchPost() fills in, and the plumbing around reading a response.
//
// Nothing here knows a platform. An endpoint URL, a response shape or a field
// mapping belongs in that site's own module.

import type { PostRecord } from './types.ts';

function emptyRecord(url: string | null | undefined, platform: string | null | undefined): PostRecord {
  return {
    url: url || null,
    platform: platform || null,
    text: null,
    title: null,
    displayName: null,
    screenName: null,
    userId: null,
    // Author profile. avatar: all platforms (X via syndication user). followers /
    // authorCreatedAt: only the platforms that expose them on a public API
    // (Bluesky / Misskey / Mastodon). X and pixiv don't expose either → stay null
    // (graceful hide, the viewer omits absent fields). avatarReferer: only pixiv
    // needs one (i.pximg.net is Referer-gated) — the bridge honors it on download.
    avatar: null,
    avatarReferer: null,
    followers: null,
    authorCreatedAt: null,
    likes: null,
    reposts: null,
    replies: null,
    bookmarks: null,
    views: null,
    date: null,
    mediaType: null,
    media: [],
    lang: null,
    isReply: null,
    isQuote: null,
    isThread: null,
    isEdited: null,
    editedAt: null,
    cw: null,
    sensitive: null,
    quotedUrl: null,
    // Reply parent's platform-local post id (tweet id / rkey / note id / status
    // id). Lets the viewer group a self-reply with its parent when both are in
    // the library.
    replyToId: null,
    // #180: quote/renote and Misskey-reply sidecar sub-records. See
    // types.ts's PostRecord.quotedPost/replyToPost for the per-platform rule.
    quotedPost: null,
    replyToPost: null,
    seriesId: null,
    seriesTitle: null,
    seriesOrder: null,
    hashtags: [],
    tags: [],
    raw: [],
    metaError: null,
  };
}

// Reads a response body ONCE and keeps the received text verbatim before
// parsing it. The push happens BEFORE JSON.parse on purpose: a body that no
// longer parses is exactly the one worth preserving — it is the evidence a
// platform changed its schema (#191's canary reads the same signal), and every
// caller here already runs inside a try/catch that degrades to a partial record.
async function readJsonKeepingRaw(rec: PostRecord, sourceKind: string, res: Response) {
  const body = await res.text();
  rec.raw.push({ sourceKind, acquiredAt: new Date().toISOString(), contentType: res.headers.get('content-type'), body });
  return JSON.parse(body);
}

// One shape for every platform's hashtags (#177). Each site's API names the
// field differently — X's entities.hashtags[].text, Bluesky's tag facets plus
// record.tags[], Misskey's note.tags[], Mastodon's tags[].name, pixiv's
// tags.tags[].tag — but they all mean the same thing, so what lands in the
// record must not differ by site: the BARE tag, no leading '#', deduped in
// first-seen order. A '#' kept on one platform and dropped on another would
// split one tag into two buckets in the viewer's hashtag facet, and a tag
// repeated inside one post would inflate that bucket's count.
//
// Case and character width are left EXACTLY as the platform reports them.
// Misskey and Mastodon hand back server-normalized (lower-cased) tags while
// X / Bluesky / pixiv keep the author's spelling, so the same word can still
// arrive in two spellings across platforms — folding those together is
// glyph normalization and belongs to #197, not here.
function normalizeHashtags(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    // Strip '#' and its full-width twin '＃': the platform fields above carry
    // neither, but a text-derived fallback does, and a client is free to store
    // the prefix in a free-form tag array.
    const tag = v
      .trim()
      .replace(/^[#＃]+/, '')
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function toIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Post bodies arrive as HTML on the platforms whose API serves rendered text
// (Mastodon's status content, pixiv's caption) — flattened here so caption words
// are searchable in the viewer.
function htmlToText(html) {
  if (!html) return null;
  let s = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<[^>]+>/g, '');
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return s.trim() || null;
}

export { emptyRecord, htmlToText, normalizeHashtags, readJsonKeepingRaw, toIso };
