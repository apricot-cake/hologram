import type Database from 'better-sqlite3';

// 同じサービスのハンドルに一意な ID があるとき、ID が欠けた投稿を補う。
// 大文字・小文字を区別しないサービスだけ正規化し、その他は完全一致で照合する。
const handleSql = "CASE WHEN platform IN ('x', 'bluesky') THEN lower(screenName) ELSE screenName END";
export function reconcilePosterIdentity(sqlite: Database.Database, screenName?: string | null, platform?: string): void {
  const known = sqlite
    .prepare(`
    SELECT platform, ${handleSql} AS handle, min(userId) AS userId FROM (
      SELECT platform, screenName, userId FROM posts WHERE platform IS NOT NULL AND platform <> ''
      UNION ALL SELECT platform, screenName, userId FROM poster_profiles WHERE platform IS NOT NULL AND platform <> ''
    ) WHERE screenName IS NOT NULL AND screenName <> '' AND userId IS NOT NULL AND userId <> ''
      AND (? IS NULL OR ${handleSql} = CASE WHEN platform IN ('x', 'bluesky') THEN lower(?) ELSE ? END)
    AND (? IS NULL OR platform = ?)
    GROUP BY platform, ${handleSql} HAVING count(DISTINCT userId) = 1
  `)
    .all(screenName ?? null, screenName ?? null, screenName ?? null, platform ?? null, platform ?? null) as Array<{ platform: string; handle: string; userId: string }>;
  const now = new Date().toISOString();
  for (const { platform: service, handle, userId } of known) {
    const oldNames = sqlite
      .prepare(`SELECT DISTINCT screenName FROM posts WHERE platform = ? AND ${handleSql} = ? AND (userId IS NULL OR userId = '')
      UNION SELECT screenName FROM poster_profiles WHERE platform = ? AND ${handleSql} = ? AND (userId IS NULL OR userId = '')`)
      .all(service, handle, service, handle) as Array<{ screenName: string }>;
    const target = `${service}:${userId}`;
    for (const row of oldNames) {
      const source = `${service}:@${row.screenName}`;
      if (source === target) {
        sqlite.prepare('UPDATE poster_profiles SET userId = ? WHERE posterKey = ?').run(userId, target);
        continue;
      }
      sqlite.prepare('INSERT OR IGNORE INTO poster_tags (posterKey, tagId) SELECT ?, tagId FROM poster_tags WHERE posterKey = ?').run(target, source);
      sqlite.prepare('DELETE FROM poster_tags WHERE posterKey = ?').run(source);
      sqlite.prepare('INSERT OR IGNORE INTO poster_folder_items (folderId, posterKey) SELECT folderId, ? FROM poster_folder_items WHERE posterKey = ?').run(target, source);
      sqlite.prepare('DELETE FROM poster_folder_items WHERE posterKey = ?').run(source);
      const oldProfile = sqlite.prepare('SELECT * FROM poster_profiles WHERE posterKey = ?').get(source) as Record<string, unknown> | undefined;
      if (!oldProfile) continue;
      const current = sqlite.prepare('SELECT * FROM poster_profiles WHERE posterKey = ?').get(target) as Record<string, unknown> | undefined;
      if (!current) {
        sqlite.prepare('UPDATE poster_profiles SET posterKey = ?, userId = ? WHERE posterKey = ?').run(target, userId, source);
      } else {
        for (const field of ['displayName', 'screenName', 'bio', 'links', 'avatar', 'avatarFile', 'banner', 'bannerFile', 'followers', 'following', 'authorCreatedAt']) {
          if ((current[field] == null || current[field] === '') && oldProfile[field] != null) sqlite.prepare(`UPDATE poster_profiles SET ${field} = ? WHERE posterKey = ?`).run(oldProfile[field], target);
        }
        sqlite.prepare('DELETE FROM poster_profiles WHERE posterKey = ?').run(source);
      }
    }
    sqlite.prepare(`UPDATE posts SET userId = ?, updatedAt = ? WHERE platform = ? AND ${handleSql} = ? AND (userId IS NULL OR userId = '')`).run(userId, now, service, handle);
  }
}
