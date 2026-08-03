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

// A quoted/replied-to post, saved alongside the parent as a sidecar sub-record
// (#180). Only the platforms whose already-fetched API response bundles the
// other post's full content produce one -- quoting is bundled on all four
// (X quoted_tweet / Bluesky embed.record / Misskey note.renote / Mastodon
// quoted_status when the shape carries it); reply-to content is bundled only
// on Misskey (note.reply). X's in_reply_to_* and Mastodon's in_reply_to_id
// carry no post body, and Bluesky's getPostThread now asks parentHeight=0
// (#292/ADR 0011), so none of the three can fill this without a request this
// Issue's own scope excludes (additional-request fetches are judged
// individually, out of v1) -- those keep the existing id/URL-only fields
// (replyToId/quotedUrl) and never gain this richer sub-record.
//
// v1 is metadata-only (#180 scope): media only ever carries the OTHER post's
// media URLs as already announced by the same response, never downloaded --
// same URL-recorded-not-fetched line #290 draws for every non-owned adjacent
// post.
interface QuotedPost {
  url: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  text: string | null;
  date: string | null;
  cw: string | null;
  media: MediaItem[];
}

// One choice of a poll (#179), in the platform's own order. `votes` is null
// only where the platform withholds the tally: Mastodon documents
// PollOption.votes_count as null while a poll hides its results, which is a
// different fact from zero votes and must not read as one.
interface PollChoice {
  text: string;
  votes: number | null;
}

// The poll (survey) attached to a post (#179). None of the platforms that have
// polls carry a separate QUESTION field -- the post's own text is the question
// -- so this holds the choices and the surrounding conditions only.
//
// Sources, each confirmed against a live response rather than documentation
// alone: Misskey's note.poll ({multiple, expiresAt, choices[{text,votes}]}) and
// Mastodon's status.poll ({multiple, expires_at, options[{title,votes_count}],
// voters_count}) are both registered canary samples
// (scripts/canary/snapshots/{misskey,mastodon}.json's 'poll' label), and X
// delivers one as a legacy CARD on the syndication endpoint -- card.name
// 'poll<N>choice_text_only' with choice<N>_label / choice<N>_count /
// end_datetime_utc binding values (measured 2026-08-02 against
// cdn.syndication.twimg.com; see x.ts's xPoll). Bluesky has NO poll of its own:
// the app.bsky.feed.post lexicon's embed union is images / video / gallery /
// external / record / recordWithMedia and nothing else (bluesky-social/atproto
// lexicons, read 2026-08-02), so that extractor never fills this -- correcting
// this Issue's own opening line, which listed Bluesky among the four.
//
// A vote is never CAST from here and the choices are never rendered as
// controls (#179 scope: the voting UI is not reproduced) -- this is a snapshot
// of what the poll said at save time, the same read-only treatment every other
// engagement number in the record gets.
interface Poll {
  choices: PollChoice[];
  // May a voter pick more than one choice? null where the platform's payload
  // has no such field (X's poll card carries no multi-select flag) -- the same
  // null-means-no-signal convention isReply/isEdited use, never a guessed false.
  multiple: boolean | null;
  // ISO 8601 deadline, or null when the poll has none (Misskey allows an
  // open-ended poll). Whether the poll is CLOSED is deliberately NOT a stored
  // field: it is this timestamp compared against the moment being asked about,
  // and the record's own capturedAt already says whether the saved tallies were
  // still moving when they were taken.
  expiresAt: string | null;
  // Distinct voters, as opposed to votes cast -- the two differ on a
  // multiple-choice poll, and only Mastodon reports it (voters_count). null
  // elsewhere. The number of VOTES is always the sum of choices[].votes, so it
  // is not stored a second time.
  votersCount: number | null;
}

// #181: the OGP preview card a link-share post carries. The platform's own
// API bundles this alongside the post it belongs to (Bluesky's
// app.bsky.embed.external view, Mastodon's status.card, X's link-preview
// card -- see bluesky.ts/mastodon.ts/x.ts for the per-platform sourcing), so
// -- like QuotedPost -- no extra request is spent building it.
//
// Distinct from a #195 bookmark record: a bookmark's OWN og:image/title/
// description ARE the record (rec.title/rec.text/rec.media[0]), because the
// record itself IS the bookmarked page. Here the card describes something
// OTHER than the post (an external article), so it needs a slot of its own
// rather than overwriting the post's own title/text.
//
// v1 scope (#181): unlike QuotedPost.media (URL-recorded, never fetched),
// `thumbnail` IS downloaded -- see native-host/post-record.mts's
// LinkCardShape.thumbnailFile, the field the host fills in after fetching it.
interface LinkCard {
  // The external page's own URL -- the destination, so a search for the
  // shared article's URL surfaces the post that shared it (#181's Why).
  url: string | null;
  title: string | null;
  description: string | null;
  // Already absolutized (mirrors bookmark.ts's extractOgp) where a platform
  // could conceivably hand back a relative one; every platform observed here
  // always serves an absolute CDN URL already. null when the platform's card
  // carried no image.
  thumbnail: string | null;
}

// #289: one entry of a poster's profile link field (Mastodon/Misskey
// `fields[]`, pixiv `webpage`/`social.*.url`). verifiedAt is Mastodon's own
// `verified_at` (the instance checked the link back-references the account) --
// null on every platform/field with no such signal (Misskey's fields[] has no
// verification concept; pixiv's webpage/social entries are plain URLs).
interface ProfileLink {
  name: string;
  value: string;
  verifiedAt: string | null;
}

// One `:shortcode:` custom emoji the post's own text uses (#290), as announced
// by the platform's API response -- Misskey's note.emojis (shortcode -> URL
// map) and Mastodon's status.emojis[] ({shortcode, url, static_url}) are the
// only two sources (confirmed against a live instance of each, 2026-08-02);
// X/Bluesky/pixiv have no custom-emoji concept and never produce one. `url` is
// always the ANIMATED original where the platform has one (Mastodon's `url`,
// never `static_url`) -- an animated emoji is meant to move, same as #119's
// video/gif media never downgrading to its poster by default.
//
// Scoped to the SAVED post's own text only: a quoted/replied-to sub-record's
// text may itself carry :shortcode: strings, but QuotedPost above has no
// customEmojis field -- the same "URL-recorded metadata only, nothing of an
// adjacent post fetched" line #180's own QuotedPost.media comment draws.
interface CustomEmoji {
  shortcode: string;
  url: string;
}

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
  // #289: the poster's own profile bio, link-field entries and banner image --
  // read straight off the SAME already-fetched profile/status response that
  // supplies avatar/followers/authorCreatedAt above (no extra request on any
  // platform, per #289's 2026-08-02 design comment). null on every platform
  // whose response has no such concept (Bluesky: no link field. pixiv: no
  // banner. X: none of the three -- its syndication endpoint carries only
  // displayName/screenName/avatar).
  bio: string | null;
  profileLinks: ProfileLink[] | null;
  banner: string | null;
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
  // Whether the platform's own API says this post was edited after it was
  // first published (#189). true only when a site positively confirms it —
  // Mastodon's edited_at and X's edit_control.edit_tweet_ids are the only two
  // sources today. Same convention as isReply/isQuote/isThread above: a site
  // with no edit signal in its API (or a fetch that failed) leaves this null
  // rather than guessing false.
  isEdited: boolean | null;
  // ISO 8601 timestamp of the last edit, when the platform names one.
  // Mastodon's edited_at gives an exact time; X's edit_control carries no
  // "when" field at all, so isEdited can be true there with editedAt staying
  // null — the two fields are independent, not a pair that both fill together.
  editedAt: string | null;
  // Content-warning text the AUTHOR attached to the post (#178) — Misskey's
  // note.cw and Mastodon's spoiler_text are free-text fields the poster wrote,
  // so this is effectively part of the post's own words (kept in posts_fts
  // alongside text/title). null means the platform has no such field (X,
  // Bluesky — see `sensitive` below) or the author left it empty; never
  // guessed from the text itself.
  cw: string | null;
  // Whether the platform's own API marks the post as sensitive/adult content
  // (#178). Mastodon's `sensitive` and X's `possibly_sensitive` are booleans
  // the API always answers (true/false is a real value, same convention as
  // likes/reposts — NOT the null-means-no-signal convention isReply/isEdited
  // use), so a successful fetch on those two platforms never leaves this
  // null. Bluesky has no boolean field at all — derived from whether the
  // post's self-labels (com.atproto.label.defs#selfLabels) include one of
  // the adult-content values (porn/sexual/nudity/graphic-media); a
  // successfully fetched post with no matching label is false, same
  // definite-answer treatment. Misskey exposes no note-level sensitivity
  // signal (only a per-FILE isSensitive on individual attachments, a
  // different fact from "is this post sensitive") — stays null there.
  sensitive: boolean | null;
  quotedUrl: string | null;
  replyToId: string | null;
  // #180: the full sidecar sub-record when this post is a quote/renote (all
  // four platforms) or a Misskey reply (the only reply-to bundled with its
  // full content). null on every other reply-to, and on a quote/renote whose
  // API response gave no usable target (deleted, shallow ShallowQuote, ...).
  quotedPost: QuotedPost | null;
  replyToPost: QuotedPost | null;
  // #179: the post's poll, when it has one. See Poll above for the per-platform
  // sourcing. null on every post without a poll and on every pixiv/Bluesky
  // record (neither platform has the concept).
  poll: Poll | null;
  // #181: the OGP preview card of a link-share post -- see LinkCard above.
  // null on every post that isn't sharing a link (the overwhelming majority)
  // and, in v1, on every Misskey/pixiv post (out of #181's scope -- Misskey's
  // API bundles no card, and pixiv posts have no link-card concept).
  linkCard: LinkCard | null;
  // pixiv series membership (#188): which series this work belongs to and its
  // 1-based position in it, from the illust payload's seriesNavData. All three
  // stay null on a work that isn't part of a series (seriesNavData itself is
  // null there) and on every non-pixiv platform, which has no series concept.
  seriesId: string | null;
  seriesTitle: string | null;
  seriesOrder: number | null;
  hashtags: string[];
  tags: string[];
  // The post's own :shortcode: custom emoji (#290) -- see CustomEmoji above
  // for sourcing and scope. Empty on every non-Misskey/Mastodon platform and
  // on any Misskey/Mastodon post that used none.
  customEmojis: CustomEmoji[];
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

// What the PAGE shows about a post, read off the post element at the moment
// the user chooses it (#202). Every field is optional and every one of them is
// a gap-filler: the platform API's answer wins wherever it has one, and the
// merge rule that enforces that lives in ONE place (dom-meta.ts's
// mergeDomMeta) rather than in each site's extractor.
//
// Counts are APPROXIMATE where the page abbreviates them ("1.2万" reads back
// as 12000) — see dom-meta.ts's parseCount for why that is the specification
// and not a defect.
//
// This shape crosses the content-script -> service-worker boundary as part of
// the save request (messages.ts's CaptureAndSendMessage.domMeta), so it holds
// plain data only.
interface DomMeta {
  text?: string | null;
  displayName?: string | null;
  screenName?: string | null;
  // ISO 8601. Every site that renders a post time renders it in a <time
  // datetime> whose attribute is already ISO, so nothing here parses a
  // human-readable date — a locale-dependent "10h" is not recoverable and is
  // left absent rather than guessed at.
  date?: string | null;
  likes?: number | null;
  reposts?: number | null;
  replies?: number | null;
  bookmarks?: number | null;
  views?: number | null;
}

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
  // May resolve asynchronously (#280): confirming "this is OUR OWN list" can
  // take a network round trip on a page whose own DOM does not carry the
  // viewer's identity (pixiv's bookmark list is one such page).
  isBulkCapturePage?(): boolean | Promise<boolean>;
  // The intake route stamped on every post this mode saves, so a bulk-imported
  // post can be told apart from an ordinary one-at-a-time save
  // (native-host/post-record's capturedVia). Every site that implements
  // isBulkCapturePage must also set this (#280 split it off x-bookmarks, the
  // only value that existed before).
  capturedVia?: string;
  // Whether the list this mode walks is fully present in the DOM from the
  // start, so a run can show a total against it (#280). Absent (X's bookmark
  // list is a virtual list) means no total can ever be known.
  bulkKnowsTotal?: boolean;
  // An extra "has the run reached the end of the list" condition, checked
  // alongside "nothing left queued and the DOM has been quiet for a while".
  // Absent means that quiet-and-empty condition is enough on its own (true
  // for a list that is not virtualized, like pixiv's). X sets this to require
  // having scrolled to the bottom too, since its virtual list only mounts
  // rows as they are scrolled to (#280 split this off bulk-capture.ts, which
  // used to assume every site needed it).
  bulkAtBottom?(): boolean;
  // Read what the page is showing for this post, so the fields the platform
  // API could not answer can still be saved (#202). Absent on the sites this
  // has not been written for yet — the save is unchanged where it is.
  //
  // CALLED THROUGH dom-meta.ts's readDomMeta, never directly: that wrapper is
  // what keeps a thrown selector error out of the save. An implementation is
  // still expected not to throw, but it is not what stands between a page
  // redesign and a lost post.
  //
  // MUST QUERY WITHIN `post` ONLY. A document-wide lookup is the one way this
  // feature can do real damage: it would fill this record with the neighbouring
  // post's text, and a wrong caption is worse than a missing one because
  // nothing later reveals it as wrong.
  extractDomMeta?(post: Element): DomMeta | null;
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
  // Where to anchor the "saved" mark on a post mediaIn found no picture on
  // (#575) — the post's own author avatar, the one element every post shape
  // carries regardless of media. Only consulted when mediaIn returns nothing;
  // null (or no implementation) leaves the post unmarked, same as before this
  // existed. Never a save target: a text-only post gets no save button, only
  // the answer to "is this already in the library".
  textAnchorIn?(unit: Element): Element | null;
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

export type { CaptureSite, CustomEmoji, DomMeta, Extractor, LinkCard, MediaIdentity, MediaIdentitySite, MediaItem, OverlaySite, ParsedPost, Poll, PollChoice, PostMediaElement, PostRecord, PostRect, ProfileLink, QuotedPost, RawAcquisition };
