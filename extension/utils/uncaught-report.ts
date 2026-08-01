// Uncaught exceptions and unhandled rejections (#727). Chrome gives these
// exactly one home — the chrome://extensions error console — and that page is
// readable only by a human looking at it: extensions cannot touch chrome://,
// the API behind the page is internal-only, and Chrome 136 closed CDP against
// the default profile. So they are caught at the source and written into
// capture.log's existing `unknown` stage ("an exception that carried no stage
// of its own"), with `uncaught` naming the context they escaped in.
//
// `target`/`write` are parameters because the callers have nothing else in
// common: the service worker owns logCapture and listens on `self`, everything
// page-side goes through logSaveEvent and listens on `window`. Nothing in here
// touches chrome.* (even by import) — the one chrome-derived input, the
// extension's origin, comes in through opts. That is what keeps this module
// importable by the Node-side test project, which has no chrome types.

// Structurally a SaveLogEntry (capture-log.ts) pinned to the `unknown` stage,
// declared here rather than imported for the chrome-freedom above.
export interface UncaughtLogEntry {
  stage: 'unknown';
  phase: 'fail';
  [key: string]: unknown;
}

export interface UncaughtEventTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
}

export interface UncaughtReportOptions {
  // Which context the report line names: background / content / diag / options.
  context: string;
  // Absent: every event on the target is the extension's own (worker, extension
  // pages). A string: the target is a SHARED window, and only events
  // attributable to that origin (in the filename or the stack) are recorded —
  // the page's own errors are not ours to log. Null: attribution is required
  // but there is no origin to attribute to (an orphaned content script), so
  // nothing is recorded at all.
  ownOrigin?: string | null;
}

// One listener pair per JS realm: every content script of one extension shares
// the page's isolated world, so the resident script and an injected Alt+S
// capture would otherwise both report the same event.
const UNCAUGHT_INSTALLED = Symbol.for('hologram.uncaught-reporting');

// Stacks are for pointing at the crash site, not for carrying the whole call
// history into a log line.
function trimStack(stack: unknown): string | null {
  if (typeof stack !== 'string' || !stack) return null;
  return stack.split('\n').slice(0, 8).join('\n');
}

export function installUncaughtReporting(target: UncaughtEventTarget, write: (entry: UncaughtLogEntry) => void, opts: UncaughtReportOptions): void {
  const flagged = target as UncaughtEventTarget & { [UNCAUGHT_INSTALLED]?: boolean };
  if (flagged[UNCAUGHT_INSTALLED]) return;
  flagged[UNCAUGHT_INSTALLED] = true;

  if (opts.ownOrigin === null) return;
  const origin = opts.ownOrigin ?? null;
  const attributable = (filename: string | null | undefined, stack: string | null | undefined) => !origin || Boolean(filename?.startsWith(origin) || stack?.includes(origin));

  target.addEventListener('error', (event: ErrorEvent) => {
    try {
      const stack = trimStack((event.error as Error | undefined)?.stack);
      if (!attributable(event.filename, stack)) return;
      write({
        stage: 'unknown',
        phase: 'fail',
        uncaught: opts.context,
        error: String(event.message || event.error || 'unknown error'),
        stack,
        source: event.filename ? `${event.filename}:${event.lineno ?? 0}` : null,
      });
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  });

  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      // A rejection carries no filename, so in a shared window the stack is
      // the only way to claim it as ours; a bare (stackless) rejection there
      // stays unattributable and is dropped.
      const reason = event.reason as { message?: unknown; stack?: unknown } | null | undefined;
      const stack = trimStack(reason?.stack);
      if (!attributable(null, stack)) return;
      write({
        stage: 'unknown',
        phase: 'fail',
        uncaught: opts.context,
        error: String((reason && (reason.message ?? reason)) || 'unhandled rejection'),
        stack,
      });
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  });
}
