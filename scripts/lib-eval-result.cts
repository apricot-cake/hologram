'use strict';
// Shared decoder for the app-harness "EVAL_RESULT" wire format: the test-app-*
// harnesses spawn a real Electron process with HOLOGRAM_SMOKE_EVAL set to a JS
// expression string, the app JSON.stringifies its result and logs it as
// `EVAL_RESULT "<escaped>"` (double-encoded so newlines/quotes inside the
// payload survive the log line), and this decodes it back. Returns null if the
// process never printed a matching line, or the payload wasn't valid JSON (a
// thrown/hung harness) — callers report that as a failed run rather than
// crashing on a null result's fields.
function readEvalResult(out: string): Record<string, any> | null {
  const m = /EVAL_RESULT "(.+?)"\s*$/m.exec(out);
  let r: Record<string, any> | null = null;
  try {
    r = JSON.parse(JSON.parse('"' + (m ? m[1] : '') + '"'));
  } catch {
    /* fall through to the null report below */
  }
  return r;
}

module.exports = { readEvalResult };
