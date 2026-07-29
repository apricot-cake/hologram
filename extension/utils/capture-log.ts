// Telling capture.log that a save ended without an answer (#507).
//
// The service worker records every stage IT reaches, so a save that stalls
// INSIDE it still leaves a line. What leaves none is a save the worker stopped
// answering for at all — and the page side is the only witness to that. Each
// on-page save surface has a deadline; this is how a deadline gets written down.
//
// Shared rather than copied because the first version of the deadlines wrote
// this line on the Alt+S path ONLY, and the surface the hang was actually
// reported from turned out to be a different one (the hover save button). A
// timeout that is silent on one surface and recorded on another leaves the same
// diagnostic hole the deadlines were added to close.
//
// Best-effort by construction: the relay goes THROUGH the service worker, so the
// worst version of the failure — a worker that is gone rather than wedged —
// cannot be reported this way. It still catches the worker that is alive but
// stuck, and it costs nothing when it fails.
import type { LogCaptureMessage } from './messages.ts';

// Which on-page surface was waiting. `stage` says how far the save got
// ('result' = it was sent and nothing came back); this says who was showing a
// spinner while that happened, which is what tells an Alt+S capture apart from
// a hover press when the log is read afterwards — a distinction whose absence
// sent the first reading of #507 at the wrong surface. Turning the whole
// stage/phase/via vocabulary into documented values belongs to #519.
export type SaveSurface = 'capture' | 'hover-save' | 'drop-zone' | 'bulk-intake';

export function reportSaveTimeout(surface: SaveSurface, platform: string, url: string | null, error: string): void {
  try {
    chrome.runtime.sendMessage({
      type: 'logCapture',
      entry: { stage: 'result', phase: 'fail', via: surface, platform, url, error },
    } satisfies LogCaptureMessage);
  } catch {
    /* ignore — diagnostics are non-essential */
  }
}
