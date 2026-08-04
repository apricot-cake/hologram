'use strict';

// One-file download-verify-commit for the model manager (#832, parent #98).
// Electron-free (fetch + node:fs/crypto only) so it is unit-testable against a
// stubbed global fetch, the same convention native-host/media-download.cts's
// tests use (vi.stubGlobal('fetch', ...)).
//
// Contract: fetchModelFile never leaves a file at `dest` whose bytes do not
// hash to `sha256` (checked against the FULL file, not just the bytes this
// call added — needed because a resumed download's hash cannot be resumed
// from an in-memory digest across process restarts, only recomputed from
// disk). A mismatch removes the partial download rather than the never-had-a-
// prefix destination, so a caller can retry immediately.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FetchProgress {
  /** Bytes written to the .part file so far, including bytes from a prior run. */
  bytesDone: number;
  /** null when the server did not report a length. */
  bytesTotal: number | null;
}

export class ModelFileVerificationError extends Error {
  constructor(
    public readonly url: string,
    public readonly expectedSha256: string,
    public readonly actualSha256: string,
  ) {
    super(`downloaded file did not match the pinned hash: ${url}`);
    this.name = 'ModelFileVerificationError';
  }
}

function partPathFor(dest: string): string {
  return `${dest}.part`;
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * True iff `dest` exists and its bytes already hash to `sha256` — the
 * already-downloaded / no-work-to-do case, checked before any network call.
 */
export async function fileMatchesHash(dest: string, sha256: string): Promise<boolean> {
  try {
    const actual = await sha256OfFile(dest);
    return actual.toLowerCase() === sha256.toLowerCase();
  } catch {
    return false; // ENOENT or a read error both mean "not a verified copy"
  }
}

/**
 * Fetches one file to `dest`, resuming a `.part` sibling left by an
 * interrupted previous call (HTTP Range) and verifying the completed bytes
 * against `sha256` before the rename that makes it visible at `dest`.
 *
 * Idempotent: called again after success it is a no-op (dest already matches);
 * called again after a verification failure it starts that file over (the
 * failed .part was removed).
 */
export async function fetchModelFile(url: string, dest: string, sha256: string, onProgress?: (p: FetchProgress) => void): Promise<void> {
  if (await fileMatchesHash(dest, sha256)) {
    onProgress?.({ bytesDone: (await fs.promises.stat(dest)).size, bytesTotal: null });
    return;
  }

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const part = partPathFor(dest);
  let resumeFrom = 0;
  try {
    resumeFrom = (await fs.promises.stat(part)).size;
  } catch {
    /* no partial download yet */
  }

  const res = await fetch(url, resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : undefined);
  if (resumeFrom > 0 && res.status === 200) {
    // The server does not support Range (or the resource changed under us):
    // a 200 here is the WHOLE file, not the tail, so restart clean.
    resumeFrom = 0;
    await fs.promises.rm(part, { force: true });
  } else if (!res.ok || (resumeFrom > 0 && res.status !== 206)) {
    throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
  }

  const contentLength = res.headers.get('content-length');
  const bytesTotal = contentLength ? resumeFrom + Number(contentLength) : null;

  const out = fs.createWriteStream(part, { flags: resumeFrom > 0 ? 'r+' : 'w', start: resumeFrom });
  let bytesDone = resumeFrom;
  const body = res.body;
  if (!body) throw new Error(`empty response body for ${url}`);
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    await new Promise<void>((resolve, reject) => out.write(chunk, (err) => (err ? reject(err) : resolve())));
    bytesDone += chunk.length;
    onProgress?.({ bytesDone, bytesTotal });
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));

  const actual = await sha256OfFile(part);
  if (actual.toLowerCase() !== sha256.toLowerCase()) {
    await fs.promises.rm(part, { force: true });
    throw new ModelFileVerificationError(url, sha256, actual);
  }
  await fs.promises.rename(part, dest);
}
