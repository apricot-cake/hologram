// The shared post-record shape (#5 St2 / #295) and its normalization builder:
// the single place that fills every missing field with its documented default,
// so a record built by ANY producer ends up with the exact same keys.
//
// Today three places independently assemble what is supposed to be the same
// "illustration record" (bridge.cts's comment name for it):
//   - native-host/bridge.cts's handleSave/handleSaveDragged (captures)
//   - app/src/main/ipc-transfer.ts's import-posts (ZIP import) — its own hand-listed
//     ~30 fields, found (2026-07-18 codebase pass, #5 comment) to already be
//     missing media[] and replyToId that the other two producers carry
//   - the Eagle-migration converter (external tool, not in this repo) that
//     originates eagleName/description
// A field added to one and not the others silently drops on whichever path
// didn't get the memo. normalizePostRecord is that memo, machine-enforced.
//
// #5's confirmed schema (2026-07-18 comment) is the source of truth for the
// field set — this shape is that schema's row shape, not the DB's: tags stay
// plain name strings here (ID-entity resolution — name to tagId, with dedup —
// is a database-write-time concern for whoever wires this into the DB in
// St5/St6, not a capture-time normalization concern).
//
// Kept Electron-free (node builtins and its .mts siblings only) so it
// unit-tests in plain node under both the native-host CJS runtime (via require,
// like bridge.cts requires media-download.cts) and the app's ESM runtime — the
// same cross-boundary role native-host/post-key.mts already plays, and the same
// reason this is .mts while its native-host siblings are .cts (see that
// file's comment for the mechanics).
//
// St2 creates the type + builder only. Rewiring bridge.cts and app/src/main/ipc-transfer.ts
// to build records THROUGH this (instead of their own ad hoc field lists) is
// St5/St6's job (#295) — this file is inert until then.

import { normalizeRawPayloads } from './raw-payload.mts';
import type { RawPayloadShape } from './raw-payload.mts';

export interface MediaItemShape {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  // 'video' | 'gif' | 'ugoira' | null (null/absent = a still image). posterFile
  // is the downloaded poster-frame filename for any of those (#119 St1).
  type: string | null;
  posterFile: string | null;
  // 'ugoira' only (#119 St3): frame order + per-frame display time inside the
  // saved zip. Kept as structured data rather than a second file on disk —
  // the archive alone cannot say how long each frame is shown, and nothing
  // else in the library can re-derive it once pixiv's page is gone.
  frames: { file: string; delay: number }[] | null;
}

export interface PostRecordShape {
  captureId: string;
  assetClass: string;
  mediaType: string | null;
  image: string | null;
  // Downloaded video filename for an image-view video import/drag-save (#299:
  // added alongside the shared DB writer extraction — the app-internal video
  // import path already produced this field ad hoc via an `as any` escape
  // hatch; the DB round-trip silently dropped it because neither the shared
  // type nor the posts table had a column for it). Distinct from media[].file
  // (a post's ATTACHED media) — this is the record's own primary video, the
  // video-equivalent of `image`. The renderer's `image || video` UI contract
  // (records.ts et al.) predates this field; this is that contract's other half.
  video: string | null;
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarFile: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  date: string | null;
  capturedAt: string;
  updatedAt: string;
  // Intake route that produced this record ('x-bookmarks' = bulk bookmark
  // intake, #362; future bulk adapters add their own values). null = ordinary
  // one-at-a-time save. A fact about how the record entered the library, not
  // an organization structure — folders/tags stay user-created (#362 decision).
  capturedVia: string | null;
  lang: string | null;
  isReply: boolean | null;
  isQuote: boolean | null;
  isThread: boolean | null;
  quotedUrl: string | null;
  replyToId: string | null;
  hashtags: string[];
  tags: string[];
  media: MediaItemShape[];
  // Which picture of a multi-image post this record holds, 1-based, and how many
  // the post had (#560). Only a drag save can fill them: it takes ONE picture out
  // of a post and its media[] then holds just that file, so the picture's place
  // in the original post is not recoverable from the record afterwards. Every
  // other route saves the post's pictures together, where media[] order already
  // IS the original order and "which one" has no meaning — those leave both null,
  // as do single-picture posts.
  imageIndex: number | null;
  imageCount: number | null;
  // The acquisition originals (#292): the payloads that arrived FOR this record,
  // kept unmodified and compressed. Not a post column — like media[] and tags[]
  // it fans out into its own table (raw_payloads) on write. Empty for every
  // producer that has no acquisition of its own to preserve (ZIP import,
  // app-internal image import, the one-time legacy migration).
  raw: RawPayloadShape[];
  eagleName: string | null;
  description: string | null;
  source: string | null;
  shotW: number | null;
  shotH: number | null;
  trashedAt: string | null;
  // The captureId this record REPLACES (#34). Written when the user answers the
  // duplicate-save warning with "replace"; null on every ordinary save.
  //
  // It is a marker, not an action: the native host is write-once (it never
  // modifies or deletes an existing file), so a capture made with the desktop
  // app closed cannot trash anything itself. The app consumes the marker —
  // trashing the old capture, merging its tags and re-pointing its folder /
  // manual-group memberships — and clears the field once done
  // (app/src/main/lib-db-replaces.ts). Until then the two records simply
  // coexist, which is the same state the library would be in without the
  // feature at all.
  replaces: string | null;
}

// Every field a producer may hand in, all optional — the builder supplies
// whatever is missing. captureId is the one field every producer computes
// itself (uniqueBase-derived in bridge.cts, stamp+seq-derived in
// app/src/main/ipc-transfer.ts) and is required here for the same reason.
export type PostRecordInput = Partial<Omit<PostRecordShape, 'captureId'>> & { captureId: string };

function normStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
function normNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function normBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function normStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function normMedia(v: unknown): MediaItemShape[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({
      url: typeof m.url === 'string' ? m.url : '',
      alt: normStr(m.alt),
      width: normNum(m.width),
      height: normNum(m.height),
      file: typeof m.file === 'string' ? m.file : '',
      type: normStr(m.type),
      posterFile: normStr(m.posterFile),
      frames: normFrames(m.frames),
    }));
}
// A frame table is all-or-nothing: one malformed entry would desynchronize
// every later frame from its picture, so a bad list becomes null rather than a
// filtered-down one.
function normFrames(v: unknown): { file: string; delay: number }[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: { file: string; delay: number }[] = [];
  for (const f of v) {
    if (!f || typeof f !== 'object') return null;
    const { file, delay } = f as Record<string, unknown>;
    if (typeof file !== 'string' || !file || typeof delay !== 'number' || !Number.isFinite(delay)) return null;
    out.push({ file, delay });
  }
  return out;
}

// Filename extensions the library stores a MOVING picture in — a file no
// <img src> can ever render. The renderer keeps its own copy of this list
// (records.ts's isVideoFile) rather than importing it: this module reaches
// node:crypto/node:zlib through raw-payload.mts and so cannot enter the
// renderer bundle. Both lists must gain a format together.
const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
export function isVideoFileName(name: string | null | undefined): boolean {
  return typeof name === 'string' && VIDEO_FILE.test(name);
}

// Does the library hold anything OF this post, as opposed to what its permalink
// already says? platform, screenName and (on X) the post date are all derivable
// from the URL alone, so a record carrying nothing else is an empty shell: there
// is nothing to show, and nothing a later re-save could not obtain just as well.
//
// This is ONE rule behind two decisions that have to agree (#492): the bridge
// refuses to write such a record, and the "already saved" badge refuses to
// answer for one. Let them drift and a post the library holds nothing of keeps
// its badge, which makes every later intake skip it — the failure becomes
// permanent precisely because it was recorded as a success.
//
// A text-only post is NOT empty (#365): its text is the content. Neither is a
// post whose media all failed to download but whose author and text arrived —
// what was obtained is still worth keeping and re-saving can add the rest.
export function recordHoldsContent(record: Partial<PostRecordShape> | null | undefined): boolean {
  if (!record) return false;
  if (normStr(record.image) || normStr(record.video) || normStr(record.text) || normStr(record.title) || normStr(record.displayName)) return true;
  return Array.isArray(record.media) && record.media.length > 0;
}

// Fills every field of `input` with its documented default. now is injectable
// (tests pass a fixed instant); production callers omit it and get the real
// clock, same as extension/metadata.ts's toIso() callers and app/src/main/ipc-transfer.ts's
// `|| new Date().toISOString()` fallback it replaces.
export function normalizePostRecord(input: PostRecordInput, now: () => string = () => new Date().toISOString()): PostRecordShape {
  const capturedAt = normStr(input.capturedAt) || now();
  // `image` is the STILL slot, and a video filename in it makes the record
  // unshowable from end to end (#496): every reader treats image as a still, so
  // the card and the detail view hand an mp4 to an <img> and draw nothing, while
  // the post's poster frame — downloaded and sitting on disk — is left with no
  // field pointing at it and shows up as orphaned media instead. The pre-#377
  // bulk-intake save wrote exactly this shape.
  //
  // The relocation target is not a guess: `video` is `image`'s moving-picture
  // half (see PostRecordShape.video) and every reader of it already expects a
  // file no <img> can show, so the record stays displayable instead of losing
  // its only pointer to the file. It lives HERE because writePost normalizes
  // every record on its way into the DB — this is the one gate posts.image
  // passes through, whichever producer built the record.
  const rawImage = normStr(input.image);
  const imageIsVideo = isVideoFileName(rawImage);
  return {
    captureId: input.captureId,
    assetClass: normStr(input.assetClass) || 'media',
    mediaType: normStr(input.mediaType),
    image: imageIsVideo ? null : rawImage,
    // An explicit `video` wins: a producer that filled both told us which file
    // it means, and the misplaced one is not a still either way.
    video: normStr(input.video) || (imageIsVideo ? rawImage : null),
    url: normStr(input.url),
    platform: normStr(input.platform),
    text: normStr(input.text),
    title: normStr(input.title),
    displayName: normStr(input.displayName),
    screenName: normStr(input.screenName),
    userId: normStr(input.userId),
    avatar: normStr(input.avatar),
    avatarFile: normStr(input.avatarFile),
    followers: normNum(input.followers),
    authorCreatedAt: normStr(input.authorCreatedAt),
    likes: normNum(input.likes),
    reposts: normNum(input.reposts),
    replies: normNum(input.replies),
    bookmarks: normNum(input.bookmarks),
    views: normNum(input.views),
    date: normStr(input.date),
    capturedAt,
    updatedAt: normStr(input.updatedAt) || capturedAt,
    capturedVia: normStr(input.capturedVia),
    lang: normStr(input.lang),
    isReply: normBool(input.isReply),
    isQuote: normBool(input.isQuote),
    isThread: normBool(input.isThread),
    quotedUrl: normStr(input.quotedUrl),
    replyToId: normStr(input.replyToId),
    hashtags: normStrArray(input.hashtags),
    tags: normStrArray(input.tags),
    media: normMedia(input.media),
    imageIndex: normNum(input.imageIndex),
    imageCount: normNum(input.imageCount),
    raw: normalizeRawPayloads(input.raw),
    eagleName: normStr(input.eagleName),
    description: normStr(input.description),
    source: normStr(input.source),
    shotW: normNum(input.shotW),
    shotH: normNum(input.shotH),
    trashedAt: normStr(input.trashedAt),
    replaces: normStr(input.replaces),
  };
}
