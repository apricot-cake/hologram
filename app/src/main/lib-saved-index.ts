'use strict';

// Builds the small, reconstructable postKey->captureId map the native-host
// bridge reads to answer the "is this already saved" TL badge query while the
// app is closed (#5 St6 / #299). Replaces the old approach of having the
// bridge rebuild its own snapshot straight from every sidecar — the bridge no
// longer writes sidecars at all, so it has nothing left to scan; the DB is the
// one place that still knows every post's URL. See bridge.cts's
// "Saved-post index" comment for the read side (this module only builds the
// map; index.ts owns writing it to configDir/bridge-saved-index.json,
// debounced + atomic).
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in
// plain node, mirroring lib-db-query.ts.

import type Database from 'better-sqlite3';
import { postKeyOf } from '../../../native-host/post-key.mts';

const SAVED_INDEX_FORMAT = 'hologram-bridge-saved-index';
const SAVED_INDEX_VERSION = 1;
const SAVED_INDEX_FILE = 'bridge-saved-index.json';

interface SavedIndexFile {
  format: typeof SAVED_INDEX_FORMAT;
  version: typeof SAVED_INDEX_VERSION;
  generatedAt: string;
  entries: Record<string, string>; // postKey -> captureId
}

// First post to claim a postKey wins the entry (same "informational, not
// authoritative" tolerance bridge.cts's old sidecar rescan already had for
// two posts that collapse to the same key) — the badge only needs SOME
// captureId to answer "yes, saved".
function buildSavedIndex(sqlite: Database.Database, now: () => string = () => new Date().toISOString()): SavedIndexFile {
  const entries: Record<string, string> = {};
  const rows = sqlite.prepare('SELECT captureId, url FROM posts WHERE url IS NOT NULL AND trashedAt IS NULL').all() as Array<{ captureId: string; url: string }>;
  for (const row of rows) {
    const key = postKeyOf(row.url);
    if (key && !(key in entries)) entries[key] = row.captureId;
  }
  return { format: SAVED_INDEX_FORMAT, version: SAVED_INDEX_VERSION, generatedAt: now(), entries };
}

export { buildSavedIndex, SAVED_INDEX_FORMAT, SAVED_INDEX_VERSION, SAVED_INDEX_FILE };
export type { SavedIndexFile };
