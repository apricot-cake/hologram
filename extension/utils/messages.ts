// Runtime messages exchanged between the content scripts (capture.ts, and the
// resident content script's drag.ts + overlay.ts) and the background service
// worker (background.ts). One discriminated union per direction, keyed by
// `type`, so a handler that narrows on `message.type` gets the rest of the
// payload typed for free — a field rename now shows up as a compile error at
// every call site instead of failing silently at runtime (#225).
//
// BridgeAck is the one exception: it types the native host's ack (a THIRD
// boundary — extension <-> native messaging host, native-host/bridge.cts,
// its own separate TS project) only as far as background.ts reads pieces of
// it back into its own content<->background responses (see SaveResponse).
// The native messaging protocol itself stays untyped on the host side.
import type { CropRect } from './crop.ts';
import type { SaveFailureKind } from './native-error.ts';

// === content script -> background ===

interface CaptureAndSendMessage {
  type: 'captureAndSend';
  rect: CropRect;
  postUrl: string;
  platform: string;
}

interface SavePostMessage {
  type: 'savePost';
  postUrl: string;
  platform: string;
  capturedVia?: string | null;
}

interface ImageDraggedMessage {
  type: 'imageDragged';
  platform: string;
  postUrl: string;
  imageUrls: string[];
}

interface CheckSavedMessage {
  type: 'checkSaved';
  urls: string[];
}

// Diagnostic bag relayed to the native host's capture.log (or, failing that,
// the local fallback ring buffer) essentially as-is — shape varies by
// pipeline stage; see capture.ts's logCaptureFailure and background.ts's own
// logCapture() callers for what actually lands in one.
type LogEntry = Record<string, unknown>;

interface LogCaptureMessage {
  type: 'logCapture';
  entry: LogEntry;
}

interface DumpLogsMessage {
  type: 'dumpLogs';
}

type ContentToBackgroundMessage = CaptureAndSendMessage | SavePostMessage | ImageDraggedMessage | CheckSavedMessage | LogCaptureMessage | DumpLogsMessage;

// === background -> content script ===

interface CropImageMessage {
  type: 'cropImage';
  dataUrl: string;
  rect: CropRect;
}

// A successful capture always carries its meta/grouped fields; a failed one
// always carries errorKind instead — split on `success` so a reader (capture.ts's
// onRuntimeMessage) gets the right fields typed as present, not just optional.
interface NotifySuccessMessage {
  type: 'notify';
  success: true;
  metaOk: boolean;
  metaReason: string | null;
  grouped: number;
}

interface NotifyFailureMessage {
  type: 'notify';
  success: false;
  errorKind?: SaveFailureKind;
}

type NotifyMessage = NotifySuccessMessage | NotifyFailureMessage;

interface SavedUpdateMessage {
  type: 'savedUpdate';
  url: string;
  media: Array<string | null>;
}

type BackgroundToContentMessage = CropImageMessage | NotifyMessage | SavedUpdateMessage;

// === responses ===

interface ErrorResponse {
  ok: false;
  error?: string;
  errorKind?: SaveFailureKind;
}

// captureAndSend's outcome rides back to the tab on a separate {type:'notify'}
// message (see NotifyMessage) — the sendResponse callback only has to say the
// request was accepted; capture.ts never reads it.
type CaptureAndSendResponse = { ok: true } | ErrorResponse;

// What the native host's ack carries for a completed save (see the module
// header for why this lives here despite being a different boundary).
interface BridgeAck {
  file?: string;
  saveFolder?: string;
  mediaCount?: number;
  media?: Array<string | null>;
  // Written to disk, but the library can't show it until #365 lands.
  deferred?: boolean;
}

type SaveResponse =
  | (BridgeAck & {
      ok: true;
      metaOk: boolean;
      metaReason: string | null;
      grouped: number;
    })
  | ErrorResponse;

// What the host says about one permalink: the captureId of a record that
// holds it, plus WHICH of the post's pictures are in the library (#334) —
// positional, so the index is the picture's number in the record and null
// marks one the library kept no URL for. An empty list means the post is
// saved but its pictures are not known apart; the overlay reads that as the
// whole post, exactly as it behaved before per-picture answers existed.
interface SavedEntry {
  id: string;
  media: Array<string | null>;
}

type SavedResults = Record<string, SavedEntry | null>;

type CheckSavedResponse = { ok: true; results: SavedResults } | { ok: false; error?: string; results: SavedResults };

interface LogCaptureResponse {
  ok: true;
}

interface DumpLogsResponse {
  ok: true;
  entries: unknown[];
}

type CropImageResponse = { croppedDataUrl: string } | null;

export type {
  BackgroundToContentMessage,
  BridgeAck,
  CaptureAndSendMessage,
  CaptureAndSendResponse,
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
  SavedEntry,
  SavedResults,
  SavedUpdateMessage,
  SavePostMessage,
  SaveResponse,
};
