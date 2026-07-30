// `busy` is the one kind that never comes from the host: the service worker
// refused to start this save because the tab already had its share of them in
// flight (#323 — host-budget.ts). Nothing is broken and nothing was written, so
// it is neither a malfunction to diagnose nor a post that cannot be had — the
// advice is to wait, which is why it needs a kind of its own.
export type SaveFailureKind = 'host-missing' | 'host-unavailable' | 'origin-rejected' | 'post-unavailable' | 'timeout' | 'busy' | 'unknown';

// Native Messaging exposes failures as human-readable runtime.lastError text,
// not stable error codes. Keep the known matches deliberately narrow: a Chrome
// wording change must fall back to a safe generic message instead of silently
// turning into the wrong recovery advice.
export function classifySaveFailure(message: unknown): SaveFailureKind {
  const text = String(message || '');

  // Not a malfunction and not Chrome's wording but our own host's (#492): the
  // post itself could not be obtained (deleted, suspended, protected, age
  // gated), so nothing was written. Separated from the failures above because
  // the advice is opposite — there is nothing here for the user to repair.
  if (/^post unavailable/i.test(text)) {
    return 'post-unavailable';
  }

  if (/access to the specified native messaging host is forbidden|allowed[_ -]origins|origin.+(?:forbidden|not allowed|denied)/i.test(text)) {
    return 'origin-rejected';
  }

  if (/specified native messaging host.+not found|native messaging host.+not found|is it installed/i.test(text)) {
    return 'host-missing';
  }

  if (/error (?:when|while) communicating with the native messaging host|native (?:messaging )?host (?:disconnected|exited|timed out)|host has exited|failed to start (?:the )?native messaging host|access is denied|permission denied/i.test(text)) {
    return 'host-unavailable';
  }

  // A leg that was abandoned rather than answered (#507 — utils/deadline.ts).
  // Deliberately AFTER the host matches above: "Native host timed out" is a
  // timeout too, but the user can act on knowing it was the saver that went
  // quiet, and that advice is already written.
  if (/timed out/i.test(text)) {
    return 'timeout';
  }

  return 'unknown';
}
