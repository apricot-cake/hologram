'use strict';

// #289: この機能より前からあるライブラリに対する、poster_profiles と
// poster_profile_snapshots の1回限りの埋め戻し＝マイグレーション自体（lib-db.ts の
// add-poster-profiles）は空のテーブルを作るだけ。内容のハッシュを計算するには node:crypto が
// 要るが、狭い MigrationDb（exec と pragma だけ。あのファイル自身のモジュールのコメント）は
// そこへ手が届かないため。これはデータベースごとに1回だけ走り（下の store_state のゲート）、
// マイグレーションが当たった直後に index.ts の ensureDb() から呼ばれる＝lib-db-write.ts の
// ensureLibraryId と lib-migrate-poster-key-host.ts の1回限りの書き換えが既に使っている、
// 「マイグレーションを要さず次の起動で獲得する」のと同じ形。
//
// #289 の設計コメント #8: 既存の投稿者を、その最も新しく保存された投稿から種として作る＝
// displayName / screenName / avatar / avatarFile / followers / authorCreatedAt はどれも、その
// posts の行からそのまま来る（値はすべて `posts` から導ける）。bio / profileLinks / banner /
// bannerFile は null のままにする。この機能が存在する前は、それらを取得した生産者が1つも無い
// ため。そして provenance がそれを明示する（'derived:posts'）。API が観測したとは主張しない。
//
// どれか1つのライブラリへの譲歩ではない。これはどのライブラリも受ける派生の索引の作り直しで、
// このマイグレーションが走った瞬間に、投稿者が将来の投稿者向けの表示（#247）から黙って消えて
// しまわないようにするもの。

import type Database from 'better-sqlite3';
import { hasPosterIdentity, posterAppearanceHash, posterKeyOf } from './lib-poster-profile.ts';

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

/** 何度実行しても同じ＝store_state がこの埋め戻しを済みと記録した後は何もしない。 */
export function backfillPosterProfiles(sqlite: Database.Database): void {
  const already = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(BACKFILLED_KEY) as { value: string } | undefined;
  if (already?.value === '1') return;

  // capturedAt の降順。ある posterKey についてこのループが最初に見る行こそ、その投稿者の最も
  // 新しく保存された投稿なので、下の既出の集合に「新しい方を残す」という別の比較は要らない。
  const rows = sqlite.prepare('SELECT platform, userId, screenName, url, displayName, avatar, avatarFile, followers, authorCreatedAt, capturedAt FROM posts ORDER BY capturedAt DESC').all() as PostSeedRow[];

  const insertProfile = sqlite.prepare(
    'INSERT OR IGNORE INTO poster_profiles (posterKey, platform, userId, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,NULL,NULL,?,?,NULL,NULL,?,?,?,?,?,?)',
  );
  // OR IGNORE が守るのは、生きた書き込みの経路との（今のところ理論上の）競合であって、この
  // 単一スレッドの埋め戻しが自分で引き起こせる何かではない。
  const insertSnapshot = sqlite.prepare('INSERT OR IGNORE INTO poster_profile_snapshots (posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance) VALUES (?,?,?,?,NULL,NULL,?,?,NULL,NULL,?,?,?,?)');

  const run = sqlite.transaction(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!hasPosterIdentity(row)) continue; // あの関数のコメントを参照（ブックマークや作者の無い行は飛ばす）
      const posterKey = posterKeyOf(row);
      if (seen.has(posterKey)) continue;
      seen.add(posterKey);
      const contentHash = posterAppearanceHash({ displayName: row.displayName, screenName: row.screenName, bio: null, links: null, avatar: row.avatar, avatarFile: row.avatarFile, banner: null, bannerFile: null, followers: row.followers, authorCreatedAt: row.authorCreatedAt });
      const provenance = 'derived:posts';
      const observedAt = row.capturedAt;
      const inserted = insertProfile.run(posterKey, row.platform, row.userId, row.displayName, row.screenName, row.avatar, row.avatarFile, row.followers, row.authorCreatedAt, contentHash, provenance, observedAt, observedAt);
      if (inserted.changes > 0) insertSnapshot.run(posterKey, observedAt, row.displayName, row.screenName, row.avatar, row.avatarFile, row.followers, row.authorCreatedAt, contentHash, provenance);
    }
    sqlite.prepare("INSERT INTO store_state (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(BACKFILLED_KEY);
  });
  run();
}
