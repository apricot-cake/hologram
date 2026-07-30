// The contract every site module implements (#212). One site = one module
// (x.ts, bluesky.ts, misskey.ts, mastodon.ts, pixiv.ts), holding BOTH phases of
// that site's knowledge:
//
//   URL / API phase — recognize a post URL, fetch the post's metadata from the
//                     platform API. Runs in the service worker.
//   DOM phase       — recognize the page, find the post under the pointer, read
//                     its permalink, tell which picture belongs to which post,
//                     say where the timeline overlay's controls go. Runs in the
//                     content scripts.
//
// The two phases used to live in separate files keyed by a platform string that
// nothing checked (a DOM branch answering 'x' and a URL branch answering 'x'
// were related only by spelling). Here they are one object, so the site that
// parses x.com/<user>/status/<id> and the site that recognizes an x.com page
// are the same value by construction.
//
// The ENTRY split is unchanged — content scripts and the service worker are
// still separate bundles; each simply never calls the phase it has no use for.
import type { AnnouncedMedia } from '../../../native-host/protocol.mts';

// Same shape as DOMRect's readable half, but plain data: capture geometry is
// adjusted (Misskey grows the rect to its <article>, pixiv narrows it to the
// image), and a DOMRect cannot be constructed with edited numbers.
interface PostRect {
  x: number;
  y: number;
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

// One acquisition original (#292): a response body exactly as it arrived, with
// enough context to say what produced it. The extension only ever produces this
// plain-text form — compression, hashing and the per-record size cap belong to
// the native host (native-host/raw-payload.mts's packRawPayloads), because the
// browser side has no business deciding what is worth keeping.
//
// Only RESPONSE BODIES for the post being saved get here. Request headers,
// cookies and credentials are never copied in — the boundary #292 draws is "the
// payload that arrived for this record", and that is all this shape can hold.
interface RawAcquisition {
  // 'api:<platform>/<endpoint>' — the endpoint segment is the API's own name for
  // it, so a future reader can tell which schema the body follows.
  sourceKind: string;
  acquiredAt: string;
  contentType: string | null;
  body: string;
}

// What an extractor announces for one picture/video is exactly what crosses the
// native-messaging boundary as `metadata.media[]`, so the shape is declared
// where that boundary is (#400 — native-host/protocol.mts) and this is the name
// the extractors know it by. Distinct from the record's SAVED media, which names
// files on disk and only the host can fill in.
type MediaItem = AnnouncedMedia;

// The normalized sidecar record shape. Declared explicitly (not just inferred
// from the emptyRecord() literal) because every field initializes to `null`
// — under TS strict mode a `return { text: null, ... }` with no explicit
// return type infers each such field as the literal type `null`, not
// `string | null`, so every later `rec.text = j.text || null` (a real value)
// would be a type error. Same pitfall as `let x = null`, just at a
// return-position object literal instead of a variable declaration.
interface PostRecord {
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarReferer: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  date: string | null;
  mediaType: string | null;
  media: MediaItem[];
  lang: string | null;
  isReply: boolean | null;
  isQuote: boolean | null;
  isThread: boolean | null;
  quotedUrl: string | null;
  replyToId: string | null;
  hashtags: string[];
  tags: string[];
  // Every response body this record's acquisition received, in the order it
  // arrived. Grows as the fetch chain runs; buildRecord() forwards it to the
  // native host, which packs it into the record's raw_payloads rows (#292).
  raw: RawAcquisition[];
  // WHY the platform API returned no post info ('protected' | 'ageRestricted'
  // | 'unavailable' | 'fetchFailed'), or null when the fetch succeeded.
  // Transient: read by background.ts to pick the partial-save banner wording
  // (and to not count a URL-derived screenName as "metadata fetched");
  // buildRecord() copies explicit fields only, so it never reaches the sidecar.
  metaError: string | null;
}

// What one extractor's parseUrl() recognized. `platform` is fixed; everything
// else is whatever that site's own API needs to ask for the post (a tweet id, a
// handle + rkey, an instance host + note id …) and is read back only by the same
// extractor's fetchPost().
interface ParsedPost {
  platform: string;
  [key: string]: any;
}

// --- DOM phase ---------------------------------------------------------------

// Alt+S screenshot capture: which element is the post, where to draw the
// highlight, what its permalink is, and how to quiet the page's own hover
// styling while the screenshot is taken.
interface CaptureSite {
  platform: string;
  postSelector?: string;
  captureStyleText?: string;
  findPostElement?(target: EventTarget | null): Element | null;
  isPostElement?(el: Element): boolean;
  getPermalink(post: Element): string;
  getCaptureRect?(post: Element): PostRect;
  prepareForCapture?(post: Element): (() => void) | null;
  // The site has a list page the chase-mode intake (Alt+Shift+S) can walk, and
  // we are on it right now. Absent on every site that has no such page (#362).
  isBulkCapturePage?(): boolean;
}

interface MediaIdentity {
  postId: string;
  link: string;
}

// A post's media as it exists in the page. Usually an <img>, but a video or GIF
// post is a <video>: X replaces the poster <img> with a <video poster="…"> the
// moment the player initialises and never puts the <img> back, even after the
// post scrolls away — so on anything currently hoverable, the poster attribute
// is the only handle the page still offers (#450).
type PostMediaElement = HTMLImageElement | HTMLVideoElement;

// Which post does this picture or video belong to, and may it be saved on its
// own? Read by both on-page save paths — drag.ts (drag an image into the drop
// zone) and overlay.ts's hover save button (#94). They have to agree: a button
// that saved a different post than a drag of the same image would be a silent
// mis-attribution.
interface MediaIdentitySite {
  platform: string;
  // null whenever the media cannot be attributed with certainty — an avatar, a
  // banner, a neighboring post's picture on a grid. Callers treat null as "do
  // nothing", never as "guess".
  extractIdentity(el: PostMediaElement): MediaIdentity | null;
  // The element is a post's OWN media, judged by the CDN path the platform uses
  // for post media. Identity alone is not enough for the hover button: an
  // avatar inside a post resolves to that post's permalink perfectly well, and
  // saving it would file the author's icon as the artwork.
  isPostMedia(el: PostMediaElement): boolean;
}

// Where the timeline overlay hangs its controls (#54 / #94).
interface OverlaySite {
  // Every post-shaped element in the feed. Matched elements are candidates —
  // getPermalink decides whether one really identifies a post.
  unitSelector: string;
  // Every media box in the unit, in document order. The mark states a fact
  // about the POST, but the save button acts on ONE picture, so the overlay
  // tracks each box rather than only the first.
  mediaIn(unit: Element): Element[];
}

// --- The extractor -----------------------------------------------------------

interface Extractor {
  readonly platform: string;

  // === URL phase (both execution contexts) ===

  // Recognize a post URL. null = not this site's URL. Called in registry order,
  // so an extractor must not claim a URL it cannot fetch.
  parseUrl(u: URL): ParsedPost | null;
  // May a tab on this origin ask the service worker to save for this platform?
  // Takes the raw tab URL as well as its hostname: the instance-hosted sites
  // have no fixed host to compare and can only require https.
  isAllowedOrigin(tabUrl: string, hostname: string): boolean;
  // The API host this extractor will contact, when that host comes FROM the
  // post URL rather than being fixed (Misskey / Mastodon instances are
  // arbitrary hosts). Absent on the fixed-host sites, which need no such guard.
  derivedApiHost?(parsed: ParsedPost): string | null;

  // === API phase (service worker) ===

  fetchPost(parsed: any, url: string): Promise<PostRecord>;

  // === Media URLs (both contexts) ===

  // "Are these two URLs the same picture?" — the one rule, per site. The same
  // picture reaches us in several spellings: the page shows a thumbnail, the
  // platform API announces the original, and a save records whichever it
  // downloaded. Comparing the strings would answer "different" every time.
  //
  // Returns null when the URL carries no identity the platform guarantees — an
  // unknown CDN path, a blob:, a video file (X hands over an .mp4 whose
  // page-side counterpart is only a poster frame). Callers treat null as
  // "cannot compare", never as "no match": the saved-picture lookup falls back
  // to the media item's position in the post, which is what the record's seq
  // preserves.
  mediaKey(url: string): string | null;
  // Upgrade a page-side media URL to the original the CDN also serves. null =
  // no rewrite applies (the URL is already original, or not ours to rewrite).
  highResUrl?(url: string): string | null;
  // Referer this site's media downloads need (i.pximg.net 403s without one).
  mediaReferer?: string;
  // The site numbers a post's media in the file name, so a dragged picture says
  // WHICH entry of the post's media[] it is without any URL matching. null =
  // no page number in these URLs. Absent on sites that do not number pages.
  mediaPageIndex?(imageUrls: string[]): number | null;

  // === DOM phase (content scripts) ===

  // Are we on this site right now? A host check on the fixed-host sites, a page
  // sniff on the instance-hosted ones (any host can be a Misskey/Mastodon).
  matchesPage(): boolean;
  capture: CaptureSite;
  // Absent where the site has no rule for attributing a picture to a post, or
  // no timeline the overlay runs on. Marks still work without them.
  mediaIdentity?: MediaIdentitySite;
  overlay?: OverlaySite;

  // === Manifest ===

  // Match patterns for the resident content script (drag save + overlay), and
  // the API hosts whose CORS needs host_permissions. Both are read at build
  // time so that adding a site stays one module plus one registry line.
  residentMatches?: readonly string[];
  apiHostPermissions?: readonly string[];
}

export type { CaptureSite, Extractor, MediaIdentity, MediaIdentitySite, MediaItem, OverlaySite, ParsedPost, PostMediaElement, PostRecord, PostRect, RawAcquisition };
