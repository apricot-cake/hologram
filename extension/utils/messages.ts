// Runtime messages exchanged between the content scripts (capture.ts, and the
// resident content script's drag.ts + overlay.ts) and the background service
// worker (background.ts). One discriminated union per direction, keyed by
// `type`, so a handler that narrows on `message.type` gets the rest of the
// payload typed for free — a field rename now shows up as a compile error at
// every call site instead of failing silently at runtime (#225).
//
// The THIRD boundary — extension <-> native messaging host — is NOT defined
// here: since #400 it has one shared declaration that both sides import,
// native-host/protocol.mts. What this file still does is re-export the pieces of
// it that travel onward into content<->background responses (BridgeAck,
// SavedEntry), so a content script reads the host's answer under the same type
// the host wrote it under.
import type { HostAckView, ProtocolSkew, SavedEntry, SavedResults, TrashedEntry, TrashedResults } from '../../native-host/protocol.mts';
import type { CropRect } from './crop.ts';
import type { DomMeta } from './extractor/types.ts';
import type { SaveFailureKind } from './native-error.ts';
import type { SaveLogEntry, SaveStage } from './capture-log.ts';
import type { SaveQueueStats } from './save-queue.ts';

// === content script -> background ===

// Every save request carries the page-minted saveId that groups this attempt's
// capture.log lines (#519 — see capture-log.ts). Required rather than optional on
// all three routes: a route that forgot it would put its save back into the
// undiagnosable state the id exists to end.
interface CaptureAndSendMessage {
  type: 'captureAndSend';
  rect: CropRect;
  postUrl: string;
  platform: string;
  saveId: string;
  // The captureId this save replaces, when the duplicate warning was answered
  // "replace" (#34). null/absent on every ordinary save.
  replaces?: string | null;
  // What the PAGE showed for this post, read off the post element at the
  // moment it was chosen (#202). It rides on the request because this is the
  // only side that has the element: the service worker holds a permalink and a
  // crop rect, and by the time it learns the API answered nothing, the tab may
  // have scrolled the post away or navigated. Absent on the sites with no
  // extraction rule yet, and on any read that came back empty.
  domMeta?: DomMeta | null;
}

interface SavePostMessage {
  type: 'savePost';
  postUrl: string;
  platform: string;
  saveId: string;
  capturedVia?: string | null;
}

interface ImageDraggedMessage {
  type: 'imageDragged';
  platform: string;
  postUrl: string;
  imageUrls: string[];
  saveId: string;
  replaces?: string | null; // see CaptureAndSendMessage
}

interface CheckSavedMessage {
  type: 'checkSaved';
  urls: string[];
}

// "Is saving this post a re-save of something already in the library?" (#34).
// Deliberately a separate question from checkSaved even though both read the
// same index: checkSaved answers per URL for a whole viewport of posts, this
// answers one post and weighs its PICTURES too.
interface CheckDuplicateMessage {
  type: 'checkDuplicate';
  platform: string;
  url: string;
  // The page's own URLs for the pictures about to be saved. Empty when the
  // site has no picture-identity rule — the check then rests on the post URL.
  imageUrls: string[];
}

// One capture.log line, relayed to the native host (or, failing that, the local
// fallback ring buffer) essentially as-is. The stage/phase vocabulary and the
// per-stage payload live in capture-log.ts.
type LogEntry = SaveLogEntry;

interface LogCaptureMessage {
  type: 'logCapture';
  entry: LogEntry;
}

interface DumpLogsMessage {
  type: 'dumpLogs';
}

// diag.ts reads the retry queue's inventory (#203) without side effects —
// separate from ResendQueueMessage below so the page's initial load never
// itself triggers a connectNative attempt.
interface QueueStatsMessage {
  type: 'queueStats';
}

// The diag page's "今すぐ再送" button: run one sweep of the retry queue now,
// then answer with the stats a resend leaves behind (#203).
interface ResendQueueMessage {
  type: 'resendQueue';
}

type ContentToBackgroundMessage = CaptureAndSendMessage | SavePostMessage | ImageDraggedMessage | CheckSavedMessage | CheckDuplicateMessage | LogCaptureMessage | DumpLogsMessage | QueueStatsMessage | ResendQueueMessage;

// === background -> content script ===

interface CropImageMessage {
  type: 'cropImage';
  dataUrl: string;
  rect: CropRect;
}

// A successful capture always carries its meta/grouped fields; a failed one
// always carries errorKind instead — split on `success` so a reader (capture.ts's
// onRuntimeMessage) gets the right fields typed as present, not just optional.
// The save's own outcome, plus one thing that is not about this save at all:
// hostSkew says the extension and the native host were built from different
// versions of their shared contract (#205), which is a standing condition of the
// installation rather than an event. It rides on the save because the save's
// banner is the only surface a person actually looks at — the extension has no
// popup yet (#124) — and it is reported on a SUCCESS because a skew does not
// stop a save: the record is on disk, and the note is about the next one.
interface NotifySuccessMessage {
  type: 'notify';
  success: true;
  metaOk: boolean;
  metaReason: string | null;
  grouped: number;
  // 'host-old' = update the desktop app; 'host-new' = update the extension.
  // null/absent = the halves match, or no host has answered yet.
  hostSkew?: ProtocolSkew | null;
  // Which record fields were filled from what the page showed rather than from
  // the platform API (#202). Read for the banner's WORDING only — a partial
  // save stays partial, because the two sources are not the same quality and
  // hiding that is what the amber state exists to prevent. Empty/absent on
  // every save the API answered in full.
  domFilled?: string[];
}

interface NotifyFailureMessage {
  type: 'notify';
  success: false;
  errorKind?: SaveFailureKind;
  // See ErrorResponse's `queued` — this is the captureAndSend route's own
  // carrier for the same fact (#203), since that route's outcome travels to
  // the tab on this message rather than on the sendResponse.
  queued?: boolean;
}

type NotifyMessage = NotifySuccessMessage | NotifyFailureMessage;

interface SavedUpdateMessage {
  type: 'savedUpdate';
  url: string;
  media: Array<string | null>;
}

// How far this save has got, pushed as each stage completes (#519). Never
// logged on arrival — its only job is to be REMEMBERED, so that if the service
// worker then disappears, the line the page writes when nothing came back can
// name the stage the worker was in. Without it, a worker killed during the
// metadata fetch, one killed during the crop round trip, and one killed on the
// host leave the same trace, which is exactly the ambiguity that left #507's
// investigation unable to say which leg had stalled.
interface SaveProgressMessage {
  type: 'saveProgress';
  saveId: string;
  reached: SaveStage[];
}

type BackgroundToContentMessage = CropImageMessage | NotifyMessage | SavedUpdateMessage | SaveProgressMessage;

// === responses ===

interface ErrorResponse {
  ok: false;
  error?: string;
  errorKind?: SaveFailureKind;
  // Only set alongside errorKind 'post-unavailable': WHY the post info could
  // not be obtained ('ageRestricted' | 'protected' | 'unavailable' |
  // 'fetchFailed'), so the banner can name the cause instead of the family
  // (#505). Absent for every other failure, which is about our own plumbing.
  metaReason?: string | null;
  // #203: whether this failed 'save'/'saveDragged' was stashed in the retry
  // queue (save-queue.ts) — true once it is in storage awaiting a resend,
  // false when the host was unreachable but nothing could be kept (over
  // budget even degraded, or the write itself failed), absent for every
  // failure that never reached the unreachable check at all (busy, a
  // 'savePost' route, an answer the host actually gave). The banner's wording
  // (i18n.ts's saveFailureText) reads this to decide whether it may promise
  // an automatic resend.
  queued?: boolean;
}

// captureAndSend's outcome rides back to the tab on a separate {type:'notify'}
// message (see NotifyMessage) — the sendResponse callback only has to say the
// request was accepted; capture.ts never reads it.
type CaptureAndSendResponse = { ok: true } | ErrorResponse;

// What the native host's ack carries for a completed save, as a READER may
// assume it: native-host/protocol.mts's HostAckView, where every field is
// optional because the two sides update through separate channels (Chrome Web
// Store vs the app's own updater), so an ack can arrive from a host older or
// newer than the extension reading it.
type BridgeAck = HostAckView;

type SaveResponse =
  | (BridgeAck & {
      ok: true;
      metaOk: boolean;
      metaReason: string | null;
      grouped: number;
      // See NotifySuccessMessage — the drag/hover routes answer here instead of
      // through a notify, so the note has to travel on both.
      hostSkew?: ProtocolSkew | null;
    })
  | ErrorResponse;

// SavedEntry / SavedResults — what the host says about one permalink (the
// captureId of a record holding it, plus WHICH of its pictures are in the
// library, #334) — are the HOST's declarations, imported above and re-exported
// below because they travel on to the content scripts unchanged.

type CheckSavedResponse = { ok: true; results: SavedResults } | { ok: false; error?: string; results: SavedResults };

// ok:false = the question could not be answered (no permalink, unreachable
// host). The caller saves anyway — see duplicate-guard.ts on failing open.
//
// `duplicate` and `trashed` are mutually exclusive and both optional: a post can
// be in the library (duplicate), in its trash (trashed, #158), or in neither.
// `trashed` is a separate field rather than a third value of `duplicate` because
// the two lead to different questions — a live duplicate can be REPLACED, a
// trashed one has no live record to replace.
type CheckDuplicateResponse = { ok: true; duplicate: boolean; captureId?: string | null; trashed?: TrashedEntry | null } | { ok: false };

interface LogCaptureResponse {
  ok: true;
}

interface DumpLogsResponse {
  ok: true;
  entries: unknown[];
}

// #203: the retry queue's inventory, as read by save-queue.ts's
// saveQueueStats — shared shape for both the read-only query and the
// resend-then-report round trip, since the two only differ in whether a
// sweep ran first.
interface QueueStatsResponse {
  ok: true;
  stats: SaveQueueStats;
}

interface ResendQueueResponse {
  ok: true;
  stats: SaveQueueStats;
}

type CropImageResponse = { croppedDataUrl: string } | null;

export type {
  BackgroundToContentMessage,
  BridgeAck,
  CaptureAndSendMessage,
  CaptureAndSendResponse,
  CheckDuplicateMessage,
  CheckDuplicateResponse,
  CheckSavedMessage,
  CheckSavedResponse,
  ContentToBackgroundMessage,
  CropImageMessage,
  CropImageResponse,
  DumpLogsMessage,
  DumpLogsResponse,
  ImageDraggedMessage,
  LogCaptureMessage,
  LogCaptureResponse,
  LogEntry,
  NotifyFailureMessage,
  NotifyMessage,
  NotifySuccessMessage,
  ProtocolSkew,
  QueueStatsMessage,
  QueueStatsResponse,
  ResendQueueMessage,
  ResendQueueResponse,
  SavedEntry,
  SavedResults,
  SavedUpdateMessage,
  SavePostMessage,
  SaveProgressMessage,
  SaveResponse,
  TrashedEntry,
  TrashedResults,
};
