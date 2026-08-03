'use strict';

// ⚠️ Scaffolding — remove before release (#791 tracks the removal).
//
// One-time rewrite of every stored posterKey for the two instance-scoped
// platforms (misskey/mastodon) from the pre-#791 host-less form
// (`<platform>:<id>`) to the host-qualified form query.ts's userKey() now
// produces (`<platform>:<host>:<id>`) — see that function's header comment for
// why an actor id needs the host at all. Runs once per database (the
// store_state gate below), called from index.ts's ensureDb() right after
// opening the handle.
//
// Only touches the tables that persist a posterKey as DATA rather than
// deriving it live from a post: poster_tags, poster_folder_items,
// poster_alias_group_members, plus poster_alias_groups.primaryKey (always one
// of its group's member keys per aliases.ts's merge(), so it has to move in
// lockstep with poster_alias_group_members or the group's "primary is a
// member" invariant breaks).
//
// The host for an old key is read back off the SAME posts row userKey() would
// compute it from today (platform + userId, or platform + screenName when
// userId is empty) — the identical id rule query.ts's userKey uses. A key
// with no resolvable host (every matching post already deleted, or none of
// them carry a URL) is left as-is: userKey() falls back to the SAME hostless
// form for exactly that case, so an unmigrated old-form row still matches the
// live key nothing currently produces without a host, never an orphaned one.
//
// Already-collided data (two different instances' same-named posters that
// were, before #791, indistinguishable under one old-form key) cannot be
// un-collided by this migration — there is only one stored row to rewrite,
// and it moves to whichever instance the key map resolves to (the first
// matching post found). That is a pre-existing data-loss the bug already
// caused, not something this migration introduces; #791's fix is that it
// cannot happen again going forward.

import type Database from 'better-sqlite3';

const MIGRATED_KEY = 'posterKeyHostMigrated';
const INSTANCE_PLATFORMS = ['misskey', 'mastodon'] as const;

function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Every old-form posterKey this database's OWN posts can resolve a host for,
// mapped to its new-form replacement. First post found for a given old key
// wins (posts have no defined iteration order here — any one instance's post
// under that key is as good as another for picking the host).
function buildKeyMap(sqlite: Database.Database): Map<string, string> {
  const map = new Map<string, string>();
  for (const platform of INSTANCE_PLATFORMS) {
    const rows = sqlite.prepare('SELECT userId, screenName, url FROM posts WHERE platform = ?').all(platform) as Array<{ userId: string | null; screenName: string | null; url: string | null }>;
    for (const row of rows) {
      const id = row.userId || '@' + (row.screenName || '');
      const oldKey = `${platform}:${id}`;
      if (map.has(oldKey)) continue;
      const host = hostOf(row.url);
      if (host) map.set(oldKey, `${platform}:${host}:${id}`);
    }
  }
  return map;
}

function rewriteColumn(sqlite: Database.Database, table: string, column: string, keyMap: Map<string, string>) {
  const update = sqlite.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`);
  for (const [oldKey, newKey] of keyMap) update.run(newKey, oldKey);
}

/** Idempotent — no-ops once store_state records the migration as done. */
export function migratePosterKeyHost(sqlite: Database.Database): void {
  const already = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(MIGRATED_KEY) as { value: string } | undefined;
  if (already?.value === '1') return;
  const keyMap = buildKeyMap(sqlite);
  const run = sqlite.transaction(() => {
    if (keyMap.size) {
      rewriteColumn(sqlite, 'poster_tags', 'posterKey', keyMap);
      rewriteColumn(sqlite, 'poster_folder_items', 'posterKey', keyMap);
      rewriteColumn(sqlite, 'poster_alias_group_members', 'posterKey', keyMap);
      rewriteColumn(sqlite, 'poster_alias_groups', 'primaryKey', keyMap);
    }
    sqlite.prepare("INSERT INTO store_state (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MIGRATED_KEY);
  });
  run();
}
