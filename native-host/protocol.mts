// The Native Messaging contract between the Chrome extension's service worker
// and this directory's bridge (#400): ONE definition of every request, every
// response, the capture-id rule, the request-id rule and the protocol version,
// imported by both sides.
//
// Before this, each side described the same six messages in its own words — the
// extension in `bridgeSend({ type:'save', … })` object literals, the host in
// `handleSave(msg: any)` — so renaming a field, adding a required one or
// changing an ack could only be discovered by a save failing on a user's
// machine. Now the extension builds a `HostRequest` and the host receives what
// `parseHostRequest` returns, and the two are the same declaration.
//
// WHY IT LIVES IN native-host/ AND NOT SOMEWHERE "NEUTRAL"
// native-host/ is a separate deliverable: electron-builder copies this directory
// into the packaged app as a raw extraResource, without app/ and without any
// node_modules, and the bridge that Chrome spawns is a single bundled file built
// from these sources. A shared module under app/src/** would therefore be absent
// from the very artifact that has to read it. This directory already carries the
// cross-boundary modules other layers import — post-key.mts (the renderer
// re-exports it), post-record.mts and inbox.mts (the main process imports them)
// — and this file plays the same role facing the other way: the EXTENSION
// imports it, and WXT/Vite inlines it into the extension bundle at build time,
// so the shipped extension keeps no runtime dependency on this directory.
//
// KEEP IT BROWSER-SAFE. This is the one module here that enters a browser
// bundle, so it must stay free of node builtins and of any VALUE import that
// reaches one. The two imports below are type-only on purpose: post-record.mts
// pulls in node:zlib through raw-payload.mts, and a value import of either would
// drag that into the service worker.
//
// #205 (the protocol-version handshake) owns the number, the wire field every
// reply is stamped with, and the rule for reading a skew off it — all three are
// things the two sides have to agree on, so they are the contract's. What is NOT
// here, and must not be: any branch that behaves differently per version (#205's
// own design forbids it — a handshake that starts adapting stops being a
// handshake), and the wording/surfaces that tell the user which side to update,
// which belong to the extension (utils/i18n.ts, utils/diag.ts).

import type { PostRecordShape } from './post-record.mts';
import type { RawPayloadInput } from './raw-payload.mts';

// Bumped only when the message contract itself changes — never with the app
// version, which moves for reasons the extension cannot see. One integer, so
// #205's check is an integer comparison.
//
// WHEN TO BUMP: a change that an unchanged peer would get WRONG — a renamed or
// newly required request field, a reply field whose meaning changed, a request
// type the extension will now send unconditionally. Adding an OPTIONAL field
// that an older peer simply ignores is not one of those; bumping for it would
// spend the user's attention (a banner on every save) on nothing.
export const PROTOCOL_VERSION = 1;

// A capture id is "<epochMillis>-<hex>", minted by the extension
// (generateCaptureId) and used by the host as a FILENAME base. That is why the
// rule is part of the contract rather than a host-side detail: it is the single
// thing standing between a hostile page and a path separator or ".." in the save
// folder. The host resolves collisions by appending "-<n>", so ids it hands BACK
// (inbox event ids, ack captureIds) can carry that suffix — see
// native-host/inbox.mts's SAFE_EVENT_ID, which is this pattern plus that tail.
export const CAPTURE_ID_PATTERN = /^[0-9]{1,20}-[0-9a-f]{1,8}$/i;

export function isCaptureId(id: unknown): id is string {
  return typeof id === 'string' && CAPTURE_ID_PATTERN.test(id);
}

// The id a reply is echoed under. A one-shot connection (every save route) needs
// none — the port carries one request and closes — but the saved-post badge
// multiplexes many queries over ONE long-lived port and has to match each answer
// to its question, so the rule is the message's rather than any handler's: a
// request that carries an id gets it back on its reply.
export type RequestId = number;

// --- requests (extension -> host) ---------------------------------------------

interface RequestCommon {
  // Optional on the wire — the save routes send none, because a one-shot port
  // has nothing to correlate — and always present (null when it was absent)
  // once parseHostRequest has been through it.
  id?: RequestId | null;
}

// A save's fields as they are read on BOTH routes that carry post info. saveId
// groups this attempt's capture.log lines across all three processes (#519);
// metaOk / metaReason say whether the platform API answered, and why not when it
// did not (#505), so the host's own log line can record a partial save.
interface SaveCommon extends RequestCommon {
  // Well-formed per CAPTURE_ID_PATTERN, or null when the request carried no
  // usable one — the handler answers that with its own typed failure.
  captureId: string | null;
  saveId?: string | null;
  metadata: CaptureMetadata;
  metaOk?: boolean;
  metaReason?: string | null;
}

// Alt+S / hover-button save: a cropped screenshot plus the post's information.
export interface SaveRequest extends SaveCommon {
  type: 'save';
  // base64 JPEG, no data: prefix. '' when absent.
  image: string;
}

// Bulk-intake save (#362): no screenshot — the host downloads the post's own
// media and the first file becomes the record's face.
export interface SavePostRequest extends SaveCommon {
  type: 'savePost';
}

// Image-drag save: the host downloads the one picture that was dragged.
export interface SaveDraggedRequest extends SaveCommon {
  type: 'saveDragged';
  imageUrl: string; // '' when absent
  imageReferer?: string | null;
}

// "Which of these permalinks are already in the library?" (#54) — the only read
// the host answers, and the reason the badge works with the desktop app closed.
export interface QueryRequest extends RequestCommon {
  type: 'query';
  urls: string[];
}

// One capture.log line the extension could not write itself (it has no file
// access), relayed to be appended verbatim.
export interface LogRequest extends RequestCommon {
  type: 'log';
  entry: HostLogEntry;
}

// Liveness check — used by the diagnostics page to prove the host launches.
export interface PingRequest extends RequestCommon {
  type: 'ping';
}

export type HostRequest = SaveRequest | SavePostRequest | SaveDraggedRequest | QueryRequest | LogRequest | PingRequest;

export type HostRequestType = HostRequest['type'];

// The three routes that write a record. Named because the host logs and gates
// them together and the extension picks between them.
export type SaveRequestType = SaveRequest['type'] | SavePostRequest['type'] | SaveDraggedRequest['type'];

// One capture.log line as it crosses the boundary. The VOCABULARY (which stages
// and phases exist) belongs to the extension — extension/utils/capture-log.ts
// owns it — and deliberately does not travel with this contract: the host only
// appends the line to a text log, and a host that refused an unfamiliar stage
// would drop precisely the diagnostics of the version skew it was meant to
// record. Structure is what this boundary owes; meaning stays with the writer.
export interface HostLogEntry {
  [key: string]: unknown;
}

// --- the record as it travels ---------------------------------------------------

// One picture/video the platform ANNOUNCED for a post: a URL to download plus
// how to fetch it. Distinct from the record's saved media (post-record.mts's
// MediaItemShape, which names files on disk) because that is what the HOST
// produces after downloading — this is what it is asked to fetch.
export interface AnnouncedMedia {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  referer?: string;
  // DOWNLOAD transport, not the display label: 'image' (default, omitted by the
  // still-image-only sites) | 'video' | 'gif' | 'ugoira'. Everything but 'image'
  // additionally carries `poster` — a still frame the host saves as
  // <base>-poster.<ext> (#119 St1).
  type?: 'image' | 'video' | 'gif' | 'ugoira';
  poster?: string | null;
  // 'ugoira' only (#119 St3): frame order and per-frame display time inside the
  // saved zip.
  frames?: { file: string; delay: number }[];
}

// One `:shortcode:` custom emoji as the extension announces it (#290): the
// URL to download, no `file` — the same "what it is asked to fetch" vs "what
// the host produced" split AnnouncedMedia/MediaItemShape draws above.
export interface AnnouncedCustomEmoji {
  shortcode: string;
  url: string;
}

// #181: the OGP preview card a link-share post carries, as the extension
// announces it — same "what it is asked to fetch" split as AnnouncedMedia:
// `thumbnail` is a URL to download, and the host fills LinkCardShape's
// `thumbnailFile` after fetching it (native-host/post-record.mts).
export interface AnnouncedLinkCard {
  url: string | null;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
}

// The `metadata` a save request carries: the post record as the EXTENSION
// assembled it, before the host normalizes it (normalizePostRecord) and writes
// the inbox envelope. DERIVED from the shared PostRecordShape (#295 / #299)
// rather than re-listed, so a field added there is a field this wire can carry
// and neither side can drift from the record the database finally stores.
//
// Five fields differ from the stored shape, because they are what the extension
// HAS rather than what the library ends up with:
//   media[]        — announced (URLs to fetch), not saved (files on disk).
//   customEmojis[] — announced (URL to fetch), not saved (#290: the shared
//                    emoji/ store's filename is the host's to name).
//   linkCard       — announced (thumbnail URL to fetch, #181), not saved
//                    (thumbnailFile) — same split as media[].
//   rawPayloads    — #292's originals as plain text; the host compresses, hashes
//                    and caps them into the record's `raw`.
//   avatarFile     — omitted: only the host, having downloaded the avatar, can
//                    name the file.
//   bannerFile     — #289: same split as avatarFile, for the banner image.
export interface CaptureMetadata extends Partial<Omit<PostRecordShape, 'captureId' | 'media' | 'customEmojis' | 'raw' | 'avatarFile' | 'bannerFile' | 'linkCard'>> {
  media?: AnnouncedMedia[];
  customEmojis?: AnnouncedCustomEmoji[];
  // #181: announced (thumbnail URL to fetch), not saved (thumbnailFile) — same
  // split as media[] above.
  linkCard?: AnnouncedLinkCard;
  rawPayloads?: RawPayloadInput[];
  // Referer the avatar has to be fetched with (pixiv rejects fetches without
  // one). Not a stored field — it is fetch instructions, spent by the host.
  avatarReferer?: string | null;
}

// --- responses (host -> extension) ----------------------------------------------

// Stamped onto EVERY reply the host sends — acks, the pong, query answers and
// failures alike (#205). Every reply and not just the ack, because the reply the
// extension is most likely to be holding when something is wrong is a failure,
// and a version that only rides on success would be missing exactly then.
//
// Optional on the wire, and never required by a reader: a host built before this
// existed sends none, and absence is itself an answer (see protocolSkewOf) — not
// a reason to call the reply malformed. The direction only ever travels one way
// (host -> extension) because only the host answers; what the extension expects
// is PROTOCOL_VERSION in its own bundle, which needs no wire field.
export interface VersionStamp {
  protocolVersion?: number;
}

// Which locally built extension is sitting in the build output folder right now
// (#650). NOT a version and not part of the handshake above: it is an opaque
// token that changes exactly once per completed `npm run build:ext`, so that an
// extension loaded from that folder can notice its own bundle is out of date and
// call chrome.runtime.reload() instead of waiting for a human to press the
// button in chrome://extensions.
//
// Rides on the SAME seat as the protocol version, and for the same reason: the
// extension already talks to this host on every save and every badge query, so
// the news reaches it without a second channel, a second process or a port.
// Native messaging cannot be initiated from the host's end (Chrome's rule), so
// the only shape available is riding back on a round trip the extension started
// — which this is.
//
// ABSENT for everyone who did not build the extension themselves: the host
// publishes it only when the build has written the stamp file this reads (see
// bridge.mts's readExtBuild), and a released host on a released install never
// finds one. Optional on the wire and never required by a reader, exactly like
// the version stamp — an older host sends none and the extension then simply has
// nothing to compare against.
export interface DevBuildStamp {
  extBuild?: string;
}

// What the host says about one permalink: the captureId of a record holding it,
// plus WHICH of the post's pictures are in the library (#334) — positional, so
// the index is the picture's number in the record and null marks one the library
// kept no URL for. An empty list means "saved, pictures not known apart", which
// the overlay reads as the whole post.
export interface SavedEntry {
  id: string; // '' when the source could not report one
  media: Array<string | null>;
  // Parallel to media: which captureId holds that picture (#34). `id` names only
  // the FIRST record to claim the post's key, so it cannot answer that. Absent
  // from a saved-index snapshot the app has not rewritten since #34.
  owners?: Array<string | null>;
}

export type SavedResults = Record<string, SavedEntry | null>;

// What the host says about a permalink whose post is in the library's TRASH
// (#158): not saved, but its record and files are still there and a re-save
// would quietly make a second copy of a post the user meant to be rid of.
//
// Deliberately a SEPARATE map from SavedResults rather than a flag on
// SavedEntry: every reader treats "there is an entry" as "the library holds
// this post" (the timeline badge lights, the hover save button hides), and a
// trashed post is not held. Keeping the two answers apart is also what makes
// this addition backward-compatible in both directions — an older extension
// ignores the field, an older host never sends it.
export interface TrashedEntry {
  // The capture the trash record belongs to. Informational: restoring is an
  // app-side operation (the host is read-only over the library), so nothing on
  // the extension side can act on it — it is here so a surface can name the
  // record it is talking about.
  id: string;
  // ISO time the post was moved to the trash, or null when the record carries
  // no stamp (a trash record whose write was interrupted). The notice drops the
  // date rather than inventing one.
  deletedAt: string | null;
}

export type TrashedResults = Record<string, TrashedEntry>;

interface AckCommon {
  ok: true;
  // The uniqueBase-resolved id of the record just written — NOT derivable from
  // `file`, whose bulk-intake form is a media filename (#34).
  captureId: string;
  file: string;
  saveFolder: string;
  // The pictures the host actually RECORDED, positional (see SavedEntry).
  media: Array<string | null>;
}

export interface CaptureAck extends AckCommon {
  mediaCount: number;
}

export interface BulkAck extends AckCommon {
  mediaCount: number;
  // Written to disk, but the library cannot show it until #365 lands.
  deferred: boolean;
}

export type DraggedAck = AckCommon;

export type SaveAck = CaptureAck | BulkAck | DraggedAck;

export interface QueryAck {
  ok: true;
  results: SavedResults;
  // Only the permalinks whose posts are in the trash (#158) — absent keys mean
  // "not in the trash", so this is a sparse map, not a parallel one. Optional
  // because a host built before #158 sends none, and every reader has to treat
  // absence as "no notice" rather than as a malformed reply.
  trashed?: TrashedResults;
}

export interface LogAck {
  ok: true;
}

export interface PongAck {
  ok: true;
  pong: true;
}

export type HostErrorCode =
  // The frame's body was not JSON.
  | 'invalid-json'
  // JSON, but not a request object with a `type` this contract knows how to read.
  | 'malformed-request'
  // A `type` this host does not implement.
  | 'unknown-type'
  // A well-formed request whose handler refused or threw. `error` is that
  // handler's own message, which is what the extension classifies (#492/#505 —
  // extension/utils/native-error.ts).
  | 'save-failed';

export interface HostFailure {
  ok: false;
  error: string;
  code: HostErrorCode;
}

export type HostResponse = SaveAck | QueryAck | LogAck | PongAck | HostFailure;

// Stamp one outgoing reply. Lives here rather than in the host's send loop so
// that "every reply says which contract wrote it" is a property of the contract
// — a second producer (a test double, a future host) cannot forget it and leave
// the extension reading its silence as an out-of-date host.
// `extBuild` rides along on the same call so that "every reply says which
// contract wrote it" and "every reply says which local build is on disk" cannot
// come apart: there is one seam, and a producer that forgets one forgets both.
// Omitted entirely when there is nothing to say, so a reply to an ordinary
// installation is byte-identical to what this sent before #650.
export function stampProtocol<T extends HostResponse>(res: T, extBuild?: string | null): T & VersionStamp & DevBuildStamp {
  const stamped = Object.assign({ protocolVersion: PROTOCOL_VERSION } as VersionStamp & DevBuildStamp, res);
  if (extBuild) stamped.extBuild = extBuild;
  return stamped;
}

// Which side is behind, from one reply's stamp (#205). Integer comparison and
// nothing else: no per-version table, no feature probing.
//
//   'host-old'  — the desktop app (which ships the host) needs updating.
//   'host-new'  — the extension does.
//
// A MISSING stamp reads as 'host-old', deliberately. Every host that carries
// this contract stamps its replies, so silence means a host from before the
// stamp existed — which is precisely the case this check was added for: a
// bridge.js left behind on disk by an install that did not take, still answering
// saves with a contract nobody has looked at in months (#511).
export type ProtocolSkew = 'match' | 'host-old' | 'host-new';

export function protocolSkewOf(hostVersion: number | null): ProtocolSkew {
  if (hostVersion === null || hostVersion < PROTOCOL_VERSION) return 'host-old';
  if (hostVersion > PROTOCOL_VERSION) return 'host-new';
  return 'match';
}

// The stamp on one received reply, or null when it carries none. Non-integers
// and non-numbers are null too — a stamp that cannot be compared is no better
// than an absent one, and treating it as absent keeps the failure on the "tell
// the user to update" path instead of inventing a third one.
export function hostProtocolVersion(raw: unknown): number | null {
  return isObject(raw) && typeof raw.protocolVersion === 'number' && Number.isInteger(raw.protocolVersion) ? raw.protocolVersion : null;
}

// The build stamp on one received reply, or null when it carries none (#650).
// Empty strings read as null too: the build publishes an opaque token or nothing
// at all, and "" is neither — treating it as absent keeps a malformed stamp from
// ever being compared against a real one.
export function hostExtBuild(raw: unknown): string | null {
  return isObject(raw) && typeof raw.extBuild === 'string' && raw.extBuild ? raw.extBuild : null;
}

// What a READER of a reply may assume. Everything optional on purpose: the two
// sides update through completely separate channels (Chrome Web Store vs the
// app's own updater), so an ack can arrive from a host that is older or newer
// than the extension reading it. Requiring a field here would turn a version
// skew into "the save failed", which is the opposite of true — the record is on
// disk either way. Derived from the strict producer types, so it cannot drift
// from them; #205 is where a skew becomes something the user is told about.
export type HostAckView = { ok: true } & VersionStamp & DevBuildStamp & Partial<CaptureAck & BulkAck & QueryAck & PongAck>;

// --- parsing --------------------------------------------------------------------

export type ParsedRequest = { ok: true; request: HostRequest } | { ok: false; id: RequestId | null; failure: HostFailure };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Kept EXACTLY as permissive as the untyped `msg.x` reads these replace: a value
// of the right type passes through (an explicit null included, since that is
// what the extension sends), anything else — an absent field above all — becomes
// undefined, which is what the untyped read already yielded and what
// JSON.stringify already omits from a capture.log line.
function optionalString(v: unknown): string | null | undefined {
  return typeof v === 'string' || v === null ? v : undefined;
}

function optionalBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function requiredString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function requestId(raw: Record<string, unknown>): RequestId | null {
  return typeof raw.id === 'number' ? raw.id : null;
}

function saveCommon(raw: Record<string, unknown>): SaveCommon {
  return {
    id: requestId(raw),
    captureId: isCaptureId(raw.captureId) ? raw.captureId : null,
    saveId: optionalString(raw.saveId),
    metadata: isObject(raw.metadata) ? (raw.metadata as CaptureMetadata) : {},
    metaOk: optionalBoolean(raw.metaOk),
    metaReason: optionalString(raw.metaReason),
  };
}

function failure(id: RequestId | null, code: HostErrorCode, error: string): ParsedRequest {
  return { ok: false, id, failure: { ok: false, error, code } };
}

// Turn one received message into a typed request, or into the failure to reply
// with. Never throws: a host that crashed on a malformed frame would take the
// whole connection — and every request behind it — down with it.
//
// What this DOES check is the envelope: is there an object, does it name a type
// this contract knows, and does each field hold a value of the declared type.
// What it deliberately does NOT check is whether a route's own preconditions are
// met (an image that is present but not a JPEG, a captureId the request omitted)
// — those stay in the handlers, which already answer them with messages the
// extension classifies. Splitting it the other way would have moved those
// messages, and the behaviour that reads them, for no gain.
export function parseHostRequest(raw: unknown): ParsedRequest {
  if (!isObject(raw)) return failure(null, 'malformed-request', 'Malformed message (not an object)');
  const id = requestId(raw);
  const type = raw.type;
  if (typeof type !== 'string') return failure(id, 'malformed-request', 'Malformed message (missing type)');
  switch (type) {
    case 'save':
      return { ok: true, request: { type, ...saveCommon(raw), image: requiredString(raw.image) } };
    case 'savePost':
      return { ok: true, request: { type, ...saveCommon(raw) } };
    case 'saveDragged':
      return { ok: true, request: { type, ...saveCommon(raw), imageUrl: requiredString(raw.imageUrl), imageReferer: optionalString(raw.imageReferer) } };
    case 'query':
      return { ok: true, request: { type, id, urls: Array.isArray(raw.urls) ? raw.urls.filter((u): u is string => typeof u === 'string' && !!u) : [] } };
    case 'log':
      return { ok: true, request: { type, id, entry: isObject(raw.entry) ? raw.entry : {} } };
    case 'ping':
      return { ok: true, request: { type, id } };
    default:
      return failure(id, 'unknown-type', `Unknown message type: ${type}`);
  }
}

// The same, starting from the UTF-8 body of one native-messaging frame — so that
// "the bytes were not JSON" is a case of this contract rather than a case each
// host loop invents for itself.
export function parseHostFrame(body: string): ParsedRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return failure(null, 'invalid-json', 'Invalid JSON message');
  }
  return parseHostRequest(raw);
}

// Which request a reply belongs to, or null for one that belongs to no
// particular request (every save route's port carries a single request, so its
// reply needs no id). The echo rule is the message's, not any handler's — see
// RequestId.
export function responseId(raw: unknown): RequestId | null {
  return isObject(raw) && typeof raw.id === 'number' ? raw.id : null;
}

// `protocolVersion` is on BOTH arms because the handshake is not a question the
// host was asked — it rides on whatever reply happens to come back, and a host
// far enough out of date to be failing saves is the one whose version matters
// most. null = the reply carried no stamp (see protocolSkewOf).
// `extBuild` is on BOTH arms for the same reason `protocolVersion` is: it is not
// an answer to the request, it rides on whatever reply happens to come back —
// and a reply that failed is just as good a carrier for "the build on disk
// changed" as one that succeeded. null = the reply carried no stamp (#650).
export type ReadResponse = { ok: true; ack: HostAckView; protocolVersion: number | null; extBuild: string | null } | { ok: false; error: string; code: HostErrorCode | null; protocolVersion: number | null; extBuild: string | null };

// Read one reply off a port. `ok:true` is the host's own success marker and the
// only thing this can go on — see HostAckView on why an ack is narrowed here and
// not validated. The point of routing every reply through one function is that
// no caller invents its own "did that work?" rule: before #400 each of the three
// save senders and the badge query answered that question in its own words.
export function readHostResponse(raw: unknown): ReadResponse {
  const protocolVersion = hostProtocolVersion(raw);
  const extBuild = hostExtBuild(raw);
  // Through `unknown`: the frame is a bag of `unknown` values and HostAckView
  // declares types for some of them, so the two are not directly comparable.
  // Narrowing rather than validating is the point — see HostAckView.
  if (isObject(raw) && raw.ok === true) return { ok: true, ack: raw as unknown as HostAckView, protocolVersion, extBuild };
  const error = isObject(raw) && typeof raw.error === 'string' && raw.error ? raw.error : 'Native host returned an error';
  const code = isObject(raw) && typeof raw.code === 'string' ? (raw.code as HostErrorCode) : null;
  return { ok: false, error, code, protocolVersion, extBuild };
}
