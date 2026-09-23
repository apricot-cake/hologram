// 現行SQLiteライブラリの初期化と接続。

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Generated } from 'kysely';
import { CURRENT_SCHEMA_SQL, SCHEMA_VERSION, TAG_CLASSIFICATION_MIGRATION, IMAGE_EDIT_MIGRATION } from './lib-db-schema.ts';
import { reconcilePosterIdentity } from './lib-poster-identity.ts';

class DatabaseCorruptError extends Error {}

// バージョン49・50には、未適用のタグ分類と画像編集の列を追加する。
function initializeSchema(db: Database.Database, readonly = false) {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version === SCHEMA_VERSION) return;
  if ((version === 49 || version === 50) && !readonly) {
    db.transaction(() => {
      if (version === 49) db.exec(TAG_CLASSIFICATION_MIGRATION);
      db.exec(IMAGE_EDIT_MIGRATION);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    return;
  }
  const empty = version === 0 && !db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
  if (!empty || readonly) {
    throw new Error(`Unsupported database schema (user_version=${version}, expected=${SCHEMA_VERSION}); convert the library outside the app before opening it`);
  }
  db.transaction(() => {
    db.exec(CURRENT_SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

// `file` にあるデータベースを開き（無ければ作り）、{ db, sqlite } を返す。`db` は Kysely の
// クエリビルダー、`sqlite` は Kysely が扱わない操作のための生のハンドル（バックアップの
// スナップショット #301、pragma の確認）。
//
// quick_check はスキーマの初期化より先に走る。integrity_check が完全にやることの、安い
// 構造の走査（ページと索引の整合。テーブルをまたぐ検証はしない）。壊れたファイルを開いてそこへ
// 書くと回収が難しくなるので、失敗はあとで分かりにくいクエリのエラーとして現れる前に、ここで
// DatabaseCorruptError を throw する。完全な integrity_check は定期の走査の担当 (#301)。
function openDatabase(file: string, opts: { readonly?: boolean } = {}) {
  const sqlite = new Database(file, { readonly: !!opts.readonly });

  // そもそも SQLite でないファイルは、ここで判定を返すのではなく SQLITE_NOTADB を throw する。
  // だから2つの形を同じエラーへ流し込むしかないし、どちらにせよハンドルを閉じないとファイルが
  // 掴まれたままになる。
  let check: unknown;
  try {
    check = sqlite.pragma('quick_check', { simple: true });
  } catch (err) {
    sqlite.close();
    throw new DatabaseCorruptError(`cannot read ${file} as a database: ${err.message}`);
  }
  if (check !== 'ok') {
    sqlite.close();
    throw new DatabaseCorruptError(`quick_check failed for ${file}: ${check}`);
  }

  // WAL は接続をまたいで残る（ファイルのヘッダに入っている）が、開くたびに設定する。WAL でない
  // バックアップから復元したデータベースにも、これを取り戻させるため。
  if (!opts.readonly) sqlite.pragma('journal_mode = WAL');
  // 他の接続が書き込みロックを持っているときは、throw せずに待つ＝読み取り専用の性能計測の
  // 道具も、バックアップのスナップショットも、普段の利用と重なるため。
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  try {
    initializeSchema(sqlite, !!opts.readonly);
    if (!opts.readonly) sqlite.transaction(() => reconcilePosterIdentity(sqlite))();
  } catch (err) {
    sqlite.close();
    throw err;
  }

  const db = new Kysely<Schema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

// lib-db-schema.ts の現行スキーマに対応する Kysely の型。
interface PostsTable {
  captureId: string;
  isContext: Generated<number>;
  postKey: string | null;
  quotedPostId: string | null;
  saveScope: import('../../../native-host/post-schemas.mts').PostRecordShape['saveScope'];
  mediaType: string | null;
  image: string | null;
  video: string | null; // PostRecordShape.video を参照
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarFile: string | null;
  followers: number | null;
  following: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  // SNS が報告する views とは別の、
  // このライブラリの利用者が画像ビューで投稿を開いた回数。
  localViewCount: Generated<number>;
  date: string | null;
  capturedAt: string;
  updatedAt: string;
  lang: string | null;
  isReply: number | null;
  isQuote: number | null;
  isThread: number | null;
  quotedUrl: string | null;
  replyToId: string | null;
  hashtags: string; // JSON の string[]＝タグでない葉は素のテキストのまま (#5 の 2026-07-18 のコメント)
  eagleName: string | null;
  source: string | null;
  shotW: number | null;
  shotH: number | null;
  trashedAt: string | null;
  userKind: string | null;
  tagReviewed: number | null;
  capturedVia: string | null; // 取り込みの経路。null は普通の保存
  replaces: string | null; // 未処理の置き換えの印。掃かれれば null
  // PostRecordShape.imageIndex を参照
  imageIndex: number | null;
  imageCount: number | null;
  // JSON の string[] で、持ち方は hashtags と
  // 同じ。PostRecordShape.domFilled を参照。これより前に書かれた行では null。
  domFilled: string | null;
  // PostRecordShape.isEdited を参照。
  isEdited: number | null;
  // PostRecordShape.cw/sensitive を参照。
  cw: string | null;
  sensitive: number | null;
  // PostRecordShape の
  // seriesId/seriesTitle/seriesOrder を参照。
  seriesId: string | null;
  seriesTitle: string | null;
  seriesOrder: number | null;
  // JSON の QuotedPostShape で、持ち方の約束事
  // は hashtags/domFilled と同じ。PostRecordShape.quotedPost/replyToPost を参照。
  quotedPost: string | null;
  replyToPost: string | null;
  // PostRecordShape.mediaMaxW/H/Bytes を参照。
  mediaMaxW: number | null;
  mediaMaxH: number | null;
  mediaMaxBytes: number | null;
  // JSON の CustomEmojiShape[] で、持ち方の
  // 約束事は hashtags/domFilled と同じ。PostRecordShape.customEmojis を参照。
  // JSON の PollShape で、持ち方の約束事は
  // quotedPost/replyToPost と同じ。PostRecordShape.poll を参照。
  poll: string | null;
  // JSON の LinkCardShape で、持ち方の約束事は
  // quotedPost/replyToPost/poll と同じ。PostRecordShape.linkCard を参照。
  linkCard: string | null;
  // PostRecordShape.shotAnimated を参照。
  shotAnimated: number | null;
  // JSON の Record<string,string> で、持ち方の
  // 約束事は quotedPost/replyToPost/poll/linkCard と同じ。PostRecordShape.metaSource を参照。
  metaSource: string | null;
}
interface MediaTable {
  id: Generated<number>;
  postId: string;
  seq: number;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type: string | null; // 動画の媒体情報
  posterFile: string | null; // 動画の媒体情報
  frames: string | null; // JSON の [{file,delay}]。うごイラだけ
  cropX: number | null;
  rotation: Generated<number>;
  flipped: Generated<number>;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
}
interface TagsTable {
  id: Generated<number>;
  name: string;
  groupId: string | null;
  reading: string | null; // #164 がこれを埋め戻す。それまではどの行でも空
  category: Generated<'general' | 'work' | 'character'>;
  workId: number | null;
}
interface PostTagsTable {
  postId: string;
  tagId: number;
  implied: Generated<number>;
}
interface FoldersTable {
  id: string;
  name: string;
  kind: string;
  created: number | null;
  parentId: string | null;
  tree: string | null; // JSON の保存済み検索の木。dynamic なフォルダだけ
}
interface FolderItemsTable {
  folderId: string;
  postId: string;
}
interface PosterFoldersTable {
  id: string;
  name: string;
}
interface PosterFolderItemsTable {
  folderId: string;
  posterKey: string;
}
interface PosterTagsTable {
  posterKey: string;
  tagId: number;
}
interface ManualGroupsTable {
  id: Generated<number>;
}
interface ManualGroupItemsTable {
  groupId: number;
  postId: string;
  seq: number;
}
interface UngroupedKeysTable {
  postKey: string;
}
interface TabsTable {
  id: string;
  windowId: string;
  position: number;
  pinned: number;
  title: string | null;
  state: string; // JSON＝履歴とクエリ木。中身を見ない再生用の状態（列で問い合わせない）
}
interface TabWindowsTable {
  windowId: string;
  activeTabId: string | null;
}
interface StoreStateTable {
  key: string;
  value: string;
}
// 取込履歴の受領記録。
interface InboxEventsTable {
  eventId: string;
  captureId: string;
  payloadSha256: string;
  importedAt: string;
  sourceSegment: string | null;
}
interface InboxSegmentsTable {
  segmentId: string;
  payloadSha256: string;
  importedAt: string;
}
// 投稿者の現在の公開プロフィール。links は JSON 文字列。
interface PosterProfilesTable {
  posterKey: string;
  // poster-profile-platform-nullable のマイグレーション (#919) 以降、NULL 可。投稿者を出して
  // いるページのブックマークにはプラットフォームが無く、posterKeyOf は番兵の値ではなく
  // `web:<host>:<id>` という自分のキーをそれに与える。
  platform: string | null;
  userId: string | null;
  displayName: string | null;
  screenName: string | null;
  bio: string | null;
  links: string | null;
  avatar: string | null;
  avatarFile: string | null;
  banner: string | null;
  bannerFile: string | null;
  followers: number | null;
  following: number | null;
  authorCreatedAt: string | null;
  contentHash: string;
  provenance: string;
  firstObservedAt: string;
  lastObservedAt: string;
}
// 閲覧履歴の state は JSON で保持する。
// TabsTable.state が使うのと同じ「中身を見ない再生用の塊」の約束事（列で問い合わせない＝その
// 行の復元の振り分けがどう読むかは kind が決める）。
interface HistoryTable {
  id: Generated<number>;
  ts: number;
  u: string;
  kind: string;
  title: string;
  state: string;
}

interface Schema {
  posts: PostsTable;
  media: MediaTable;
  tags: TagsTable;
  post_tags: PostTagsTable;
  folders: FoldersTable;
  folder_items: FolderItemsTable;
  poster_folders: PosterFoldersTable;
  poster_folder_items: PosterFolderItemsTable;
  poster_tags: PosterTagsTable;
  manual_groups: ManualGroupsTable;
  manual_group_items: ManualGroupItemsTable;
  ungrouped_keys: UngroupedKeysTable;
  tabs: TabsTable;
  tab_windows: TabWindowsTable;
  history: HistoryTable;
  store_state: StoreStateTable;

  inbox_events: InboxEventsTable;
  inbox_segments: InboxSegmentsTable;
  poster_profiles: PosterProfilesTable;
}

export { openDatabase, DatabaseCorruptError };
export type { Schema };
