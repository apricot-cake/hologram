'use strict';

// Builds the small, reconstructable postKey->captureId map the native-host
// bridge reads to answer the "is this already saved" TL badge query while the
// app is closed (#5 St6 / #299). Replaces the old approach of having the
// bridge rebuild its own snapshot straight from every sidecar — the bridge no
// longer writes sidecars at all, so it has nothing left to scan; the DB is the
// one place that still knows every post's URL. See bridge.mts's
// "Saved-post index" comment for the read side (this module only builds the
// map; index.ts owns writing it to configDir/bridge-saved-index.json,
// debounced + atomic).
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in
// plain node, mirroring lib-db-query.ts.

import type Database from 'better-sqlite3';
import { postKeyOf } from '../../../native-host/post-key.mts';

const SAVED_INDEX_FORMAT = 'hologram-bridge-saved-index';
// v2 (#334): an entry is an object carrying the post's saved media URLs, not a
// bare captureId string. v3 (#34) adds `owners`, parallel to media. v4 (#158)
// adds the `trashed` map beside `entries`. The bridge still reads v1 entries (as
// "saved, pictures unknown") and v2 entries (as "saved pictures known, owners
// unknown"), and treats a file with no `trashed` map as "nothing in the trash",
// so an app that has not rewritten the file yet keeps answering.
const SAVED_INDEX_VERSION = 4;
const SAVED_INDEX_FILE = 'bridge-saved-index.json';

// media is positional: the array index IS the media row's seq, and a row whose
// url the library never recorded holds its place as null. That is what lets the
// badge fall back to "which picture of the post" when the URL cannot be
// compared (a video, whose page-side counterpart is only a poster frame).
//
// owners is parallel to media: which captureId holds that picture. An entry's
// `id` is only the FIRST record to claim the postKey, and a post's pictures are
// routinely spread across several records (saving a second picture writes a
// second record), so `id` cannot name the record a given picture came from.
// That is exactly what the duplicate-save warning's "replace" answer needs
// (#34) — replacing the first record when the user re-saved a picture belonging
// to the third would trash the wrong capture.
interface SavedIndexEntry {
  id: string; // captureId — the first record to claim this postKey
  media: Array<string | null>;
  owners: Array<string | null>;
}

// One post sitting in the trash (#158). Deliberately NOT folded into
// SavedIndexEntry: the badge and the hover save button read "there is an entry
// for this postKey" as "the library holds this post", so a trashed post listed
// among `entries` would light the timeline badge and hide the save button for a
// post that is not in the library at all. It is a different answer, so it gets a
// different map.
//
// captureId is what the app addresses a restore by (the trash record's own
// filename), carried so a later surface can name it; deletedAt is the record's
// trashedAt, shown in the notice.
interface TrashedIndexEntry {
  id: string;
  deletedAt: string | null;
}

// A trash record as the caller hands it over: the fields buildSavedIndex needs
// and nothing else. Taken as an argument rather than read here because the trash
// lives on the filesystem, not in the database, and this module is deliberately
// fs-free (see the module comment) — index.ts reads `.trash/` with the same
// listing the trash view uses, which is also what applies the trust boundary to
// records an imported archive may have planted (#324).
interface TrashedInput {
  captureId: string;
  url: string | null;
  trashedAt: string | null;
}

interface SavedIndexFile {
  format: typeof SAVED_INDEX_FORMAT;
  version: typeof SAVED_INDEX_VERSION;
  generatedAt: string;
  entries: Record<string, SavedIndexEntry>; // postKey -> entry
  trashed: Record<string, TrashedIndexEntry>; // postKey -> trash record (#158)
}

// First post to claim a postKey wins the entry's captureId (same
// "informational, not authoritative" tolerance bridge.mts's old sidecar rescan
// already had for two posts that collapse to the same key) — the badge only
// needs SOME captureId to answer "yes, saved".
//
// Its MEDIA, though, is the union across every record sharing the key (#334):
// saving a second picture of a multi-image post writes a second record, so the
// pictures of that post that are in the library are spread across records. Read
// per record, the badge would offer to save a picture already saved.
function buildSavedIndex(sqlite: Database.Database, trash: readonly TrashedInput[] = [], now: () => string = () => new Date().toISOString()): SavedIndexFile {
  const entries: Record<string, SavedIndexEntry> = {};
  // A post the library holds NOTHING of answers nothing (#492): the badge would
  // otherwise tell the user "already saved" about a record carrying only what
  // the permalink itself says, and every later intake would skip the post on
  // that word — the one case where the badge must stay dark so the post can be
  // taken again. This is native-host/post-record.mts's recordHoldsContent
  // expressed in SQL (the same rule the bridge applies when writing); the two
  // are asserted equivalent in saved-index.test.ts. Kept as one query rather
  // than a post-filter so a big library does not carry rows it will discard.
  const rows = sqlite
    .prepare(
      `SELECT p.captureId, p.url FROM posts p
        WHERE p.url IS NOT NULL AND p.trashedAt IS NULL
          AND (IFNULL(p.image, '') <> ''
            OR IFNULL(p.video, '') <> ''
            OR IFNULL(p.text, '') <> ''
            OR IFNULL(p.title, '') <> ''
            OR IFNULL(p.displayName, '') <> ''
            OR IFNULL(p.linkCard, '') <> ''
            OR EXISTS (SELECT 1 FROM media m WHERE m.postId = p.captureId))`,
    )
    .all() as Array<{ captureId: string; url: string }>;
  // One pass over the media of every live post, grouped by its owner. Cheaper
  // than a per-post query (a library's worth of prepared-statement round trips)
  // and the JOIN keeps trashed posts out.
  const mediaByPost = new Map<string, Array<string | null>>();
  const mediaRows = sqlite.prepare('SELECT m.postId, m.seq, m.url FROM media m JOIN posts p ON p.captureId = m.postId WHERE p.trashedAt IS NULL ORDER BY m.postId, m.seq').all() as Array<{
    postId: string;
    seq: number;
    url: string | null;
  }>;
  for (const row of mediaRows) {
    const list = mediaByPost.get(row.postId) || [];
    // Positional by seq, not by arrival: a gap (a media row deleted from the
    // middle) must not shift the pictures after it onto the wrong seq.
    list[row.seq] = row.url || null;
    mediaByPost.set(row.postId, list);
  }
  for (const row of rows) {
    const key = postKeyOf(row.url);
    if (!key) continue;
    const media = mediaByPost.get(row.captureId) || [];
    const entry = entries[key];
    if (!entry) {
      entries[key] = { id: row.captureId, media: Array.from(media, (url) => url ?? null), owners: Array.from(media, () => row.captureId) };
      continue;
    }
    // A url-less picture is kept only from the FIRST record to claim the key
    // (bridge.mts's mergeSavedEntry says the same for its own two sources): its
    // position means something inside its own record and nowhere else.
    for (const url of media) {
      if (!url || entry.media.includes(url)) continue;
      entry.media.push(url);
      entry.owners.push(row.captureId);
    }
  }
  return { format: SAVED_INDEX_FORMAT, version: SAVED_INDEX_VERSION, generatedAt: now(), entries, trashed: buildTrashedMap(trash, entries) };
}

// The trash half of the index (#158). Two rules decide what lands here:
//
//   1. A postKey that `entries` already holds is LEFT OUT. Deleting one capture
//      of a post while another is still in the library is ordinary (a second
//      picture of the same post is its own record), and the live one is the
//      answer that post deserves — "already saved", with the copy/replace/skip
//      question behind it. The trash notice is for a post the library no longer
//      holds at all.
//   2. Two trash records sharing a postKey keep the LATER deletion. The notice
//      names a date; naming the older of two would date the wrong decision.
//      A record with no trashedAt loses to any record that has one (a missing
//      stamp is what a failed record write leaves behind, not a fresh delete).
function buildTrashedMap(trash: readonly TrashedInput[], entries: Record<string, SavedIndexEntry>): Record<string, TrashedIndexEntry> {
  const trashed: Record<string, TrashedIndexEntry> = {};
  for (const rec of trash) {
    const key = postKeyOf(rec.url);
    if (!key || entries[key]) continue;
    const deletedAt = rec.trashedAt || null;
    const existing = trashed[key];
    if (existing && (existing.deletedAt || '') >= (deletedAt || '')) continue;
    trashed[key] = { id: rec.captureId, deletedAt };
  }
  return trashed;
}

export { buildSavedIndex, SAVED_INDEX_FORMAT, SAVED_INDEX_VERSION, SAVED_INDEX_FILE };
export type { SavedIndexFile, TrashedIndexEntry, TrashedInput };
