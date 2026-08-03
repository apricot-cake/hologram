'use strict';

// #289: one-time backfill of poster_profiles/poster_profile_snapshots for a
// library that predates this feature — the migration itself (lib-db.ts's
// add-poster-profiles) only creates the empty tables, because computing a
// content hash needs node:crypto, which the narrow MigrationDb (exec/pragma
// only, that file's own module comment) cannot reach. This runs once per
// database (the store_state gate below), called from index.ts's ensureDb()
// right after the migration has applied — the same "acquires it on the next
// launch rather than needing a migration" shape lib-db-write.ts's
// ensureLibraryId and lib-migrate-poster-key-host.ts's one-time rewrite both
// already use.
//
// #289 design comment #8: seed every existing poster from its
// most-recently-captured post — displayName/screenName/avatar/avatarFile/
// followers/authorCreatedAt all come straight off that posts row (every value
// is derivable from `posts`); bio/profileLinks/banner/bannerFile stay null,
// since no producer captured them before this feature existed, and
// provenance says so explicitly ('derived:posts') rather than claiming an
// API observed them.
//
// Not a concession to any one library: this is a derived-index rebuild every
// library gets, so a poster does not silently disappear from a future
// poster-facing view (#247) the moment this migration runs.

import type Database from 'better-sqlite3';
import { hasPosterIdentity, posterAppearanceHash, posterInstanceOf, posterKeyOf } from './lib-poster-profile.ts';

const BACKFILLED_KEY = 'posterProfilesBackfilled';

interface PostSeedRow {
  platform: string | null;
  userId: string | null;
  screenName: string | null;
  url: string | null;
  displayName: string | null;
  avatar: string | null;
  avatarFile: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  capturedAt: string;
}

/** Idempotent — no-ops once store_state records the backfill as done. */
export function backfillPosterProfiles(sqlite: Database.Database): void {
  const already = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(BACKFILLED_KEY) as { value: string } | undefined;
  if (already?.value === '1') return;

  // DESC by capturedAt: the first row this loop sees for a given posterKey IS
  // that poster's most-recently-captured post, so the seen-set below needs no
  // separate "keep the newest" comparison.
  const rows = sqlite.prepare('SELECT platform, userId, screenName, url, displayName, avatar, avatarFile, followers, authorCreatedAt, capturedAt FROM posts ORDER BY capturedAt DESC').all() as PostSeedRow[];

  const insertProfile = sqlite.prepare(
    'INSERT OR IGNORE INTO poster_profiles (posterKey, platform, userId, instance, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,?,NULL,NULL,?,?,NULL,NULL,?,?,?,?,?,?)',
  );
  // OR IGNORE guards a (currently theoretical) race with the live write path
  // rather than something this single-threaded backfill can trigger itself.
  const insertSnapshot = sqlite.prepare('INSERT OR IGNORE INTO poster_profile_snapshots (posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance) VALUES (?,?,?,?,NULL,NULL,?,?,NULL,NULL,?,?,?,?)');

  const run = sqlite.transaction(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!hasPosterIdentity(row)) continue; // see that function's comment (skip bookmark/no-author rows)
      const posterKey = posterKeyOf(row);
      if (seen.has(posterKey)) continue;
      seen.add(posterKey);
      const contentHash = posterAppearanceHash({ displayName: row.displayName, screenName: row.screenName, bio: null, links: null, avatar: row.avatar, avatarFile: row.avatarFile, banner: null, bannerFile: null });
      const provenance = 'derived:posts';
      const observedAt = row.capturedAt;
      const inserted = insertProfile.run(posterKey, row.platform, row.userId, posterInstanceOf(row), row.displayName, row.screenName, row.avatar, row.avatarFile, row.followers, row.authorCreatedAt, contentHash, provenance, observedAt, observedAt);
      if (inserted.changes > 0) insertSnapshot.run(posterKey, observedAt, row.displayName, row.screenName, row.avatar, row.avatarFile, row.followers, row.authorCreatedAt, contentHash, provenance);
    }
    sqlite.prepare("INSERT INTO store_state (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(BACKFILLED_KEY);
  });
  run();
}
