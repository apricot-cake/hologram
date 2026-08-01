// The vocabulary of ~/.hologram/capture.log, and the page side's way of writing
// to it (#507, #519).
//
// This log's job is to answer, from disk and long afterwards, "what happened to
// that save?" — and three times running it could not, because it recorded only
// the ENTRY (the extension injected its in-page UI) and the EXIT (the host
// finished writing). Anything that stopped in between added no line at all, so
// "the user opened the UI and saved nothing" and "a save started and never came
// back" left byte-identical records. Twice that silence was read as evidence of
// a failure that had not happened, once reaching the user as a false warning.
//
// #507 gave every wait an end, and made a stall report the stage it stalled in.
// Three things it could not add, because there was nothing to write them on:
//
//   1. A save now ANNOUNCES ITSELF (`save`/`begin`) before it can possibly
//      stall. A `save`/`begin` with no terminal line after it is a stalled
//      save; an `activate` line with no `save`/`begin` after it is someone who
//      opened the UI and stopped. That is the distinction the log lacked.
//   2. Every line of one save carries the same `saveId`, so they can be read as
//      one story. Before this the only way to group them was proximity in time,
//      which is what made a badge query look like a failed save.
//   3. Giving up is WRITTEN DOWN (`cancel`). Esc, a right-click, a second
//      activation, the intake's stop button — all of them used to leave exactly
//      the silence a hang leaves.
//
// `stage` says WHERE in a save's life the line was written, `phase` what
// happened there, `via` which on-page surface was waiting. All three are closed
// sets, defined below; docs/build.md carries the same tables for whoever is
// reading a log rather than this file.
//
// Best-effort by construction: the page has no native connection of its own, so
// its lines travel THROUGH the service worker — the worst version of the failure
// (a worker that is gone rather than wedged) cannot be reported from here at
// all. It still catches the worker that is alive but stuck, and it costs nothing
// when it fails.
import type { LogCaptureMessage } from './messages.ts';

// Where in a save's life the line was written, in the order a save passes
// through them. Not every save visits every stage: the save routes (click
// capture, bookmark intake, dragged picture, hover button) differ in which
// apply.
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

// Which on-page surface was waiting. `stage` says how far the save got; this
// says who was showing a spinner while that happened, which is what tells an
// Alt+S capture apart from a hover press when the log is read afterwards — a
// distinction whose absence sent the first reading of #507 at the wrong surface.
export type SaveSurface = 'capture' | 'hover-save' | 'drop-zone' | 'bulk-intake';

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

// Write one line from a content script. Nothing here is awaited and nothing here
// throws: diagnostics must never be able to break or delay a save.
export function logSaveEvent(entry: SaveLogEntry): void {
  try {
    // Callback form on purpose: the promise form rejects when no receiver is
    // listening (a torn-down worker), and an unhandled rejection in the page is
    // a worse outcome than a lost diagnostic line.
    chrome.runtime.sendMessage({ type: 'logCapture', entry } satisfies LogCaptureMessage, () => void chrome.runtime.lastError);
  } catch {
    /* ignore — diagnostics are non-essential */
  }
}

// The extension's own origin, for attributing shared-window events to our own
// code (uncaught-report.ts); null when chrome.runtime is gone — an orphaned
// content script left behind by a reload (#594's shape).
export function extensionOrigin(): string | null {
  try {
    return chrome.runtime.getURL('');
  } catch {
    return null;
  }
}

// A page-side deadline gave up. The one way that gets written down, shared
// rather than copied because the first version of the deadlines wrote this line
// on the Alt+S path ONLY, and the surface the hang was actually reported from
// turned out to be a different one (the hover save button).
//
// `reached` is what the service worker last reported finishing (#519). It turns
// this line from "nothing came back" into "nothing came back after the crop",
// which is the difference between naming the leg that stalled and guessing:
// a worker killed during the metadata fetch, one killed during the crop round
// trip and one killed on the host all left the same trace before it.
export function reportSaveTimeout(surface: SaveSurface, platform: string, url: string | null, error: string, saveId: string | null = null, reached: SaveStage[] = []): void {
  logSaveEvent({ stage: 'result', phase: 'fail', via: surface, saveId, reached, platform, url, error });
}
