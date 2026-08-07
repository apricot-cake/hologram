'use strict';

// #1009: detects whether a directory this app depends on (configDir, the effective
// save folder) is being silently redirected by OS-level storage virtualization,
// rather than landing where this process resolved it to be.
//
// Why this exists: #1003 confirmed (2026-08-06) that MSIX storage virtualization is
// NOT happening in this environment right now — but that was true because the HOST
// process (Claude Code) happened to move outside its package, not because the
// mechanism itself went away. paths.cts's header explains why Windows' configDir
// still avoids %APPDATA% on principle: the 2026-06-23 incident (~9082 saved items
// diverging into a per-package LocalCache nobody looked at) surfaced only as
// "I saved it but it's not in the library" — a silent failure mode, not a crash.
// #232 wants to move configDir back to %APPDATA%, which re-enters virtualization's
// scope; this guard is the thing #232 is blocked on.
//
// Detection method is #1003's own measurement technique, promoted to product code:
// write a throwaway probe file and ask the OS for ITS real path via
// fs.realpathSync.native (Windows' GetFinalPathNameByHandle under the hood, which
// reports the post-redirection target). Reading the probe back through the SAME
// process proves nothing — the process's own view is exactly what virtualization
// substitutes, so it always agrees with itself. Two more alternatives were rejected
// for the same reason (#1009's "却下案"):
//   - GetCurrentPackageFullName (needs a native addon): package identity and
//     "is THIS directory being redirected" are different questions — a packaged
//     app can still have an unvirtualized directory.
//   - inspecting the %APPDATA% string: unchanged by virtualization, which is
//     exactly the silent-failure property this guard exists to catch.

import fs from 'node:fs';
import path from 'node:path';

export type RedirectCheck = { status: 'ok' } | { status: 'redirected'; realPath: string } | { status: 'check-failed'; error: string };

/**
 * Pure classifier over a realpath STRING — the only input #1009's acceptance test
 * exercises ("realpath の戻り値を差し替えたユニットテストで...検出が発火する"): a
 * unit test fakes what fs.realpathSync.native would return and asserts this fires,
 * with no filesystem or Electron involved.
 *
 * `\Packages\<pkg>\LocalCache\` is MSIX's per-package virtual store layout — the one
 * concrete shape the 2026-06-23 divergence took (paths.cts's header) — so both
 * segments must be present; a path that merely mentions "Packages" or "LocalCache"
 * on its own (a folder literally named that, a copy under a backup drive) is not
 * this failure mode and must not false-positive into it.
 */
export function classifyRealPath(realPath: string): 'ok' | 'redirected' {
  return /\\Packages\\[^\\]+\\LocalCache\\/i.test(realPath) ? 'redirected' : 'ok';
}

export interface RedirectCheckDeps {
  mkdirSync?: (dir: string) => void;
  writeFileSync?: (file: string, data: string) => void;
  unlinkSync?: (file: string) => void;
  realpathNative?: (file: string) => string;
}

/**
 * Writes a throwaway probe into `dir`, resolves the probe's real path, deletes it,
 * and classifies the result. `dir` is mkdir'd first (recursive, idempotent) so a
 * fresh install's not-yet-created configDir does not read as a false "check
 * failed" — but ONLY configDir should be passed a directory that is fine to
 * create: the caller must NOT do this for the user's save folder (index.ts's
 * `#37` comment on why a missing save folder is never recreated implicitly still
 * applies — passing a missing save folder here is expected to land in
 * 'check-failed', not conjure the directory back).
 *
 * Any failure along the way — mkdir, write, or realpath itself throwing (missing
 * dir, no permission, a locked-down sandbox) — resolves to 'check-failed', never
 * 'redirected'. #1009's 3rd acceptance criterion: a check that could not run must
 * never be treated the same as a check that ran and found the problem. Cleanup
 * (unlink) is best-effort and never turns a completed check into a failure — a
 * leftover probe file is harmless.
 */
export function checkForRedirect(dir: string, deps: RedirectCheckDeps = {}): RedirectCheck {
  const mkdirSync = deps.mkdirSync ?? ((d: string) => fs.mkdirSync(d, { recursive: true }));
  const writeFileSync = deps.writeFileSync ?? ((f: string, data: string) => fs.writeFileSync(f, data));
  const unlinkSync = deps.unlinkSync ?? ((f: string) => fs.unlinkSync(f));
  const realpathNative = deps.realpathNative ?? ((f: string) => fs.realpathSync.native(f));

  const probePath = path.join(dir, `.hologram-realpath-probe-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(dir);
    writeFileSync(probePath, '');
  } catch (err) {
    return { status: 'check-failed', error: (err as Error).message };
  }
  try {
    const real = realpathNative(probePath);
    return classifyRealPath(real) === 'redirected' ? { status: 'redirected', realPath: real } : { status: 'ok' };
  } catch (err) {
    return { status: 'check-failed', error: (err as Error).message };
  } finally {
    try {
      unlinkSync(probePath);
    } catch {
      /* best-effort cleanup — a leftover probe file changes nothing */
    }
  }
}
