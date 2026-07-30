'use strict';

// The one tmp+rename primitive for main-process writes (#229).
//
// A durable write lands through here: put the bytes in a sibling tmp file, then
// rename that file over the destination. rename() is atomic within a filesystem,
// so a reader — the native host, a backup restore, the next launch after a
// forced kill — only ever sees the complete old file or the complete new one,
// never a truncated middle. A plain write is what truncated config.json on a
// forced kill and cost a library (index.ts's readConfig comment, the 2026-06-23
// incident).
//
// Before this module the same five lines were retyped at every call site, kept
// in step by comments ("Mirrors lib-index's snapshot write") rather than by
// code, and had already drifted: only the backup loop removed its tmp file after
// a failure, only writeConfig fsynced. Cleanup is now one policy — a failed
// write never leaves its tmp file behind — and fsync is the one option a caller
// states out loud.
//
// Two shapes, because callers produce their bytes in two ways:
//   writeFileAtomicSync            the caller already holds the whole payload.
//   commitFileAtomic(Sync)         the caller fills the tmp file itself (a
//                                  capped stream extraction, a copyFile +
//                                  utimes) and needs only the naming, the
//                                  commit and the cleanup.
//
// The destination's directory must exist: every call site already creates its
// own directory once, outside its write loop, and a helper that conjured
// directories into being would turn a typo'd path into a silent success.
//
// Electron-free (node builtins only), so the suites can exercise it directly.

import fs from 'node:fs';

type AtomicWriteOptions = {
  // Appended to the destination path to name the tmp file. Callers that write
  // into a directory scanned by something else override it so the artifact is
  // recognizable there (the backup mirror's '.tmp-<epoch>', the ZIP importer's
  // '.tmp-import'). Whatever it is, it must keep matching the tmp patterns the
  // scanners skip — lib-migrate.ts's TMP_RE, lib-archive.ts's isTransientName,
  // lib-db-integrity.ts, and index.ts's backup collectors.
  tmpSuffix?: string;
  // fsync the tmp file before the rename, so a power loss after the rename
  // cannot leave the directory entry pointing at unwritten data. Costs a disk
  // round-trip per write; on by default nowhere, on for config.json because
  // losing that file loses the save folder itself.
  fsync?: boolean;
};

const DEFAULT_TMP_SUFFIX = '.tmp';

function tmpPathFor(file: string, opts: AtomicWriteOptions): string {
  return `${file}${opts.tmpSuffix ?? DEFAULT_TMP_SUFFIX}`;
}

// Runs `fill` against a tmp path, then commits it to `file`. Anything thrown by
// `fill` or by the rename propagates unchanged — the only thing this adds is
// that the tmp file is gone by the time it does.
async function commitFileAtomic(file: string, fill: (tmpPath: string) => Promise<void>, opts: AtomicWriteOptions = {}): Promise<void> {
  const tmp = tmpPathFor(file, opts);
  try {
    await fill(tmp);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      /* nothing to clean up (fill never got as far as creating it) */
    }
    throw err;
  }
}

// Synchronous commitFileAtomic. Same contract.
function commitFileAtomicSync(file: string, fill: (tmpPath: string) => void, opts: AtomicWriteOptions = {}): void {
  const tmp = tmpPathFor(file, opts);
  try {
    fill(tmp);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean up (fill never got as far as creating it) */
    }
    throw err;
  }
}

// Writes `data` to `file` atomically. Strings are written as UTF-8 (the
// encoding every caller here used); a Buffer is written as-is.
function writeFileAtomicSync(file: string, data: string | NodeJS.ArrayBufferView, opts: AtomicWriteOptions = {}): void {
  commitFileAtomicSync(
    file,
    (tmp) => {
      // flush:true fsyncs the fd before close (Node >= 21.0 / 20.10), which is
      // the openSync + writeSync + fsyncSync + closeSync dance writeConfig used
      // to spell out by hand.
      fs.writeFileSync(tmp, data, { encoding: 'utf8', flush: opts.fsync === true });
    },
    opts,
  );
}

export { commitFileAtomic, commitFileAtomicSync, writeFileAtomicSync };
export type { AtomicWriteOptions };
