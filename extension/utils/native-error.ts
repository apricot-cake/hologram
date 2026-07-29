export type SaveFailureKind = 'host-missing' | 'host-unavailable' | 'origin-rejected' | 'post-unavailable' | 'unknown';

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

  return 'unknown';
}
