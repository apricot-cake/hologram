'use strict';

// The full "開く" gate (#236, 2026-07-27 security review): the extension
// allowlist, plus a magic-byte check for the formats that carry one (native-
// host/open-allowlist.mts), evaluated at the moment "開く" is clicked — not at
// import time, since a file on disk can be swapped after collection. The pure
// half (allowlist, extension normalizer, signature matchers) lives in
// native-host/open-allowlist.mts, shared with the renderer's button-label
// judgment; this file is just the fs.readFile main needs to actually run it.
//
// Electron-free (fs only) so it unit-tests in plain node, like lib-card-dims.ts.

import fs from 'node:fs';
import { MAGIC_REQUIRED_EXTS, extensionAllowed, matchesMagicBytes, normalizeFinalExt } from '../../../native-host/open-allowlist.mts';

const HEAD_BYTES = 64;

/**
 * Reads just enough of `filePath` to check its signature. Any read failure
 * (gone, permission denied) fails closed — the same "unreadable → refuse"
 * convention as lib-card-dims.ts's readImageDims.
 */
export async function isOpenAllowed(filePath: string): Promise<boolean> {
  if (!extensionAllowed(filePath)) return false;
  const ext = normalizeFinalExt(filePath);
  if (!MAGIC_REQUIRED_EXTS.has(ext)) return true;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return matchesMagicBytes(ext, buf.subarray(0, n));
  } catch {
    return false;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

export { extensionAllowed };
