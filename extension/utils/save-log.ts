// The vocabulary of ~/.hologram/capture.log, in one place (#519).
//
// This log's job is to answer, from disk and long afterwards, "what happened to
// that save?" — and three times running it could not, because it recorded only
// the ENTRY (the extension injected its in-page UI) and the EXIT (the host
// finished writing). Anything that stopped in between added no line at all, so
// "the user opened the UI and saved nothing" and "a save started and never came
// back" left byte-identical records. Twice that silence was read as evidence of
// a failure that had not happened, once reaching the user as a false warning.
//
// Three properties fix it, and keeping them consistent across the three
// processes that write this log — the page's content scripts, the MV3 service
// worker, and the native host — is what this module is for:
//
//   1. A save ANNOUNCES ITSELF (`save`/`begin`) before it can possibly stall.
//      A `save`/`begin` with no terminal line after it is a stalled save; an
//      `activate` line with no `save`/`begin` after it is someone who opened
//      the UI and stopped. That is the distinction the log could not draw.
//   2. Every line of one save carries the same `saveId`, so they can be read
//      as one story. Before this the only way to group them was proximity in
//      time, which is what made a badge query look like a failed save.
//   3. Giving up is WRITTEN DOWN (`cancel`). Esc, a right-click, a second
//      activation, the intake's stop button — all of them used to leave
//      exactly the silence a hang leaves.
//
// #507 (every wait in the save path has an end) is the other half of this: it
// made a stall report the stage it stalled in. What it could not add was a
// record of a save that is still running, or of one abandoned on purpose —
// there was nothing to write those on.
//
// `stage` says WHERE in a save's life the line was written, `phase` what
// happened there. Both are closed sets, defined below; docs/build.md carries
// the same tables for whoever is reading a log rather than this file.
import type { LogCaptureMessage } from './messages.ts';

// Where in a save's life the line was written, in the order a save passes
// through them. Not every save visits every stage: the three save routes
// (click capture, bookmark intake, dragged picture) differ in which apply.
export type SaveStage =
  // The extension injected its in-page UI. NOT a save — nothing has been
  // written, nothing is in flight, and stopping here is perfectly normal. This
  // is the line that was misread as a failed save, twice.
  | 'activate'
  // Waiting for the user to say WHICH post. `fail` = they clicked something
  // that is not a post (the selector may be broken); `cancel` = they closed
  // the UI without choosing.
  | 'select'
  // Reading the chosen post's permalink. Without one there is no save.
  | 'permalink'
  // Asking the library whether this post is already saved, and waiting for the
  // user's answer to the warning (#34).
  | 'duplicate'
  // The save itself. `begin` the moment the service worker accepts one,
  // `cancel` when the user abandons one already in flight.
  | 'save'
  // Taking the screenshot (click-capture route only).
  | 'capture'
  // Handing the screenshot to the page to be cropped, and waiting.
  | 'crop'
  // Fetching the post's own information from the platform's API.
  | 'metadata'
  // Deciding which picture a dragged save should write.
  | 'image'
  // The native host: from receiving the save to having written it.
  | 'bridge'
  // The page waiting for the outcome. Written ONLY when none arrived (#507) —
  // a save that answers has no line here, because the stages above and the
  // host's own line already say what happened.
  | 'result'
  // A whole bookmark-intake run (#362), which holds many saves.
  | 'bulk'
  // An exception that carried no stage of its own.
  | 'unknown';

// What happened at that stage.
export type SavePhase =
  // Entered the stage. The point of writing this down is the line that never
  // gets a partner.
  | 'begin'
  // Left it having done its job.
  | 'ok'
  // It broke, and the save is over.
  | 'fail'
  // THE USER STOPPED — Esc, a right-click, a second activation, the stop
  // button. Neither a failure nor silence, which is the whole distinction this
  // log was missing.
  | 'cancel'
  // Nothing to do here: a tab that is not http(s), or a duplicate warning
  // answered "don't save".
  | 'skip';

// One line of capture.log. The per-stage detail (url, platform, error, counts)
// varies by stage and stays open — this log is read by people, not parsed by a
// program, and pinning every stage's payload here would buy nothing.
export interface SaveLogEntry {
  stage: SaveStage;
  phase: SavePhase;
  // Groups every line of one save attempt. Absent on lines that belong to no
  // single save: `activate` (no save exists yet — that IS the distinction) and
  // a `bulk` run's own lines (a run holds many saves, each with its own id).
  saveId?: string | null;
  [key: string]: unknown;
}

// Minted by the page, because the page is the first side to know a save is
// being attempted and the last side left to write a line when the service
// worker dies mid-save. An id chosen by the worker could not appear on that
// last line, which is the one that matters most.
//
// Log-only, and deliberately NOT the captureId: that one names the record's
// files on disk and is minted by the worker from a value the page must not be
// able to choose. Lines that know both carry both.
//
// getRandomValues, not randomUUID: the latter needs a secure context and these
// content scripts run in whatever the page is.
export function newSaveId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Write one line from a content script. The page has no native connection of
// its own, so the line travels through the service worker's logCapture relay.
// Best-effort in every direction — diagnostics must never be able to break or
// delay a save, so nothing here is awaited and nothing here throws.
export function logSaveEvent(entry: SaveLogEntry): void {
  try {
    // Callback form on purpose: the promise form rejects when no receiver is
    // listening (a torn-down worker), and an unhandled rejection in the page
    // is a worse outcome than a lost diagnostic line.
    chrome.runtime.sendMessage({ type: 'logCapture', entry } satisfies LogCaptureMessage, () => void chrome.runtime.lastError);
  } catch {
    /* ignore — diagnostics are non-essential */
  }
}
