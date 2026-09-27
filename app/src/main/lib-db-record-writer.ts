'use strict';
import { observePosterName } from './lib-poster-names.ts';

// 投稿1件を書く、共有の DB ライター。1つのレコードについて posts + media + post_tags +
// (lib-db-inbox.ts)、アプリ内部の ZIP・メディアの取り込みハンドラ (ipc-transfer.ts)、
// 完全 ZIP の取り込み (lib-archive.ts)、孤児の回収 (lib-db-integrity.ts) が、ずれていく
// 4つの写しではなく、1つの列の並びと1つの書き込み順を共有するため。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）で lib-db.ts に倣うので、素の
// node で単体テストできる。
//
// このモジュールが書くのは投稿レコードのテーブルだけ。自分でトランザクションを開くことも
// しない。post+media+post_tags+FTS（取込キューの消費側なら inbox_events の受領記録も）を
// まとめてコミット・ロールバックしたい呼び出し元が、自分の sqlite.exec('BEGIN')/COMMIT で
// writePost() を包む。

import { normalizePostRecord } from '../../../native-host/post-record.mts';
import { normalizeTagName } from '../../../native-host/tag-normalize.mts';

import { hasPosterIdentity, posterAppearanceHash, posterKeyOf } from './lib-poster-profile.ts';
import { reconcilePosterIdentity } from './lib-poster-identity.ts';
import { postKeyOf } from '../../../native-host/post-key.mts';
import { quotedCaptureId } from '../../../native-host/quoted-id.mts';
import type Database from 'better-sqlite3';
import type { PostRecordInput, PostRecordShape } from '../../../native-host/post-record.mts';

function toDbBool(v: boolean | null): number | null {
  return v == null ? null : v ? 1 : 0;
}

function profileBioWithLinks(bio: string | null, profileLinks: PostRecordShape['profileLinks']): string | null {
  const lines = String(bio || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set(lines.map((line) => line.toLocaleLowerCase()));
  for (const link of profileLinks || []) {
    const value = String(link?.value || '').trim();
    if (!value || seen.has(value.toLocaleLowerCase())) continue;
    lines.push(value);
    seen.add(value.toLocaleLowerCase());
  }
  return lines.length ? lines.join('\n') : null;
}

// captureId を先頭に置くのは、どの書き手も normalizePostRecord の外で自分で渡す、唯一の
// 欄だから。
const POST_COLUMNS = [
  'captureId',
  'saveScope',
  'saveIncomplete',
  'mediaType',
  'image',
  'video',
  'url',
  'platform',
  'text',
  'title',
  'displayName',
  'screenName',
  'userId',
  'avatar',
  'avatarFile',
  'followers',
  'following',
  'authorCreatedAt',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'views',
  'date',
  'capturedAt',
  'updatedAt',
  'lang',
  'isReply',
  'isQuote',
  'isThread',
  'isEdited',
  'cw',
  'sensitive',
  'quotedUrl',
  'replyToId',
  'seriesId',
  'seriesTitle',
  'seriesOrder',
  'hashtags',
  'eagleName',
  'source',
  'shotW',
  'shotH',
  'mediaMaxW',
  'mediaMaxH',
  'mediaMaxBytes',
  'trashedAt',
  'capturedVia',
  'replaces',
  'imageIndex',
  'imageCount',
  'domFilled',
  'quotedPost',
  'replyToPost',
  'poll',
  'linkCard',
  'shotAnimated',
  'metaSource',
] as const;

const UPSERT_POST_SQL = `INSERT INTO posts (${POST_COLUMNS.join(',')}) VALUES (${POST_COLUMNS.map(() => '?').join(',')})
  ON CONFLICT(captureId) DO UPDATE SET ${POST_COLUMNS.filter((c) => c !== 'captureId')
    .map((c) => `${c}=excluded.${c}`)
    .join(',')}`;

// 位置で並べたリテラルではなく、名前を付けた欄から組む。POST_COLUMNS に列を足してここを
// 忘れたとき、黙って位置がずれるのではなく下の .map(...) で落ちるようにするため（束縛する
// 引数が undefined になり → better-sqlite3 が throw する）。
function postParams(n: PostRecordShape): unknown[] {
  const byName: Record<string, unknown> = {
    captureId: n.captureId,
    saveScope: n.saveScope,
    saveIncomplete: n.saveIncomplete ? 1 : 0,
    mediaType: n.mediaType,
    image: n.image,
    video: n.video,
    url: n.url,
    platform: n.platform,
    text: n.text,
    title: n.title,
    displayName: n.displayName,
    screenName: n.screenName,
    userId: n.userId,
    avatar: n.avatar,
    avatarFile: n.avatarFile,
    followers: n.followers,
    following: n.following,
    authorCreatedAt: n.authorCreatedAt,
    likes: n.likes,
    reposts: n.reposts,
    replies: n.replies,
    bookmarks: n.bookmarks,
    views: n.views,
    date: n.date,
    capturedAt: n.capturedAt,
    updatedAt: n.updatedAt,
    lang: n.lang,
    isReply: toDbBool(n.isReply),
    isQuote: toDbBool(n.isQuote),
    isThread: toDbBool(n.isThread),
    isEdited: toDbBool(n.isEdited),
    cw: n.cw,
    sensitive: toDbBool(n.sensitive),
    quotedUrl: n.quotedUrl,
    replyToId: n.replyToId,
    seriesId: n.seriesId,
    seriesTitle: n.seriesTitle,
    seriesOrder: n.seriesOrder,
    hashtags: JSON.stringify(n.hashtags),
    eagleName: n.eagleName,
    source: n.source,
    shotW: n.shotW,
    shotH: n.shotH,
    mediaMaxW: n.mediaMaxW,
    mediaMaxH: n.mediaMaxH,
    mediaMaxBytes: n.mediaMaxBytes,
    trashedAt: n.trashedAt,
    capturedVia: n.capturedVia,
    replaces: n.replaces,
    imageIndex: n.imageIndex,
    imageCount: n.imageCount,
    // 上の hashtags と同じ持ち方＝1つの TEXT の列に JSON の string[] (#202)。
    domFilled: JSON.stringify(n.domFilled),
    // #180: 0個か1個の下位レコード。上の配列と同じく JSON にする。null は文字列の "null"
    // ではなく null のまま置く (JSON.stringify(null) === 'null' は、空でない真の列として
    // 読み戻されてしまう)。lib-db-query.ts の解析側は空の列を「下位レコード無し」として
    // 扱う。parseFrames がフレームの表が無いときに使うのと同じ約束事。
    quotedPost: n.quotedPost ? JSON.stringify(n.quotedPost) : null,
    replyToPost: n.replyToPost ? JSON.stringify(n.replyToPost) : null,
    // #179: 0個か1個の下位構造なので、上の quotedPost/replyToPost と同じ「null は null の
    // まま」の規則を使う。
    poll: n.poll ? JSON.stringify(n.poll) : null,
    // #181: 0個か1個の下位構造で、上の quotedPost/replyToPost/poll と同じ「null は null の
    // まま」の規則。
    linkCard: n.linkCard ? JSON.stringify(n.linkCard) : null,
    // #8: カードの画像がアニメーションする webp なら1＝lib-card-dims.ts の fillCardDims を
    // 参照。
    shotAnimated: toDbBool(n.shotAnimated),
    // #239: 0個か1個の出所のマップで、上の quotedPost/replyToPost/poll/linkCard と同じ
    // 「null は null のまま」の規則。
    metaSource: n.metaSource ? JSON.stringify(n.metaSource) : null,
  };
  return POST_COLUMNS.map((c) => byName[c]);
}

interface PostStmts {
  sqlite: Database.Database;
  upsertPost: Database.Statement;
  deleteMedia: Database.Statement;
  selectMediaCrops: Database.Statement;
  insertMedia: Database.Statement;
  deletePostTags: Database.Statement;
  insertPostTag: Database.Statement;
  deletePost: Database.Statement;
  selectPosterProfile: Database.Statement;
  insertPosterProfile: Database.Statement;
  updatePosterProfileCurrent: Database.Statement;
}

function preparePostStmts(sqlite: Database.Database): PostStmts {
  return {
    sqlite,
    upsertPost: sqlite.prepare(UPSERT_POST_SQL),
    deleteMedia: sqlite.prepare('DELETE FROM media WHERE postId = ?'),
    selectMediaCrops: sqlite.prepare('SELECT file, cropX, cropY, cropWidth, cropHeight, rotation, flipped FROM media WHERE postId = ?'),
    insertMedia: sqlite.prepare('INSERT INTO media (postId, seq, url, alt, width, height, file, type, posterFile, frames, cropX, cropY, cropWidth, cropHeight, rotation, flipped) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    deletePostTags: sqlite.prepare('DELETE FROM post_tags WHERE postId = ?'),
    insertPostTag: sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)'),

    deletePost: sqlite.prepare('DELETE FROM posts WHERE captureId = ?'),
    selectPosterProfile: sqlite.prepare('SELECT lastObservedAt FROM poster_profiles WHERE posterKey = ?'),
    insertPosterProfile: sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, userId, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, following, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    updatePosterProfileCurrent: sqlite.prepare('UPDATE poster_profiles SET displayName=?, screenName=?, bio=?, links=?, avatar=?, avatarFile=?, banner=?, bannerFile=?, followers=?, following=?, authorCreatedAt=?, contentHash=?, provenance=?, lastObservedAt=? WHERE posterKey=?'),
  };
}

// 投稿者の同一性を持たないレコードでは丸ごと飛ばす (hasPosterIdentity)。ブックマークや
// プラットフォームの無いレコードが posterKeyOf のホスト無しの退避キーへ流れ込んでは
// いけない理由は、あの関数のコメントを参照。
function writePosterProfile(stmts: PostStmts, n: PostRecordShape): void {
  if (!hasPosterIdentity(n)) return;
  const posterKey = posterKeyOf(n);
  // links は JSON のテキストとして運ぶ。hashtags/domFilled と同じ持ち方の約束事だが、
  // プラットフォームや投稿が1つも持たないときは '[]' ではなく null にする。こうすると、
  // 欄が無いことと空の並びが混ざらない。
  const bio = profileBioWithLinks(n.bio, n.profileLinks);
  // 外部リンクは重複を除いて bio へ統合する。links 列は旧アーカイブの読み込み互換のため
  // 残るが、新しい観測では独立した値を書かない。
  const links = null;
  const contentHash = posterAppearanceHash({ displayName: n.displayName, screenName: n.screenName, bio, links, avatar: n.avatar, avatarFile: n.avatarFile, banner: n.banner, bannerFile: n.bannerFile, followers: n.followers, following: n.following, authorCreatedAt: n.authorCreatedAt });
  const provenance = `api:${n.platform || 'unknown'}`;
  const observedAt = n.capturedAt;
  // ハンドルだけから同一人物と推測した名前は履歴に追加しない。
  if (n.platform && n.userId) {
    for (const field of ['displayName', 'screenName'] as const) {
      const value = n[field];
      if (value) observePosterName(stmts.sqlite, posterKey, { field, value, firstObservedAt: observedAt, lastObservedAt: observedAt });
    }
  }
  const existing = stmts.selectPosterProfile.get(posterKey) as { lastObservedAt: string } | undefined;

  if (!existing) {
    stmts.insertPosterProfile.run(posterKey, n.platform, n.userId, n.displayName, n.screenName, bio, links, n.avatar, n.avatarFile, n.banner, n.bannerFile, n.followers, n.following, n.authorCreatedAt, contentHash, provenance, observedAt, observedAt);
    return;
  }

  // 厳密により古い観測が現在のプロフィールを巻き戻さないようにする。
  if (observedAt < existing.lastObservedAt) return;
  stmts.updatePosterProfileCurrent.run(n.displayName, n.screenName, bio, links, n.avatar, n.avatarFile, n.banner, n.bannerFile, n.followers, n.following, n.authorCreatedAt, contentHash, provenance, observedAt, posterKey);
}

// 1つのレコードから導かれるものを全部書く（すでにあれば上書きする）＝posts の行、その
// media の行、そのタグの中間テーブルの行、その FTS の行。タグの名前は resolveTagId で id
// に解決する（get-or-create＝makeTagResolver を参照）。
export function writeQuotedReference(stmts: PostStmts, resolveTagId: (name: string) => number, n: PostRecordShape): string | null {
  const sqlite = stmts.sqlite;
  const key = n.url ? postKeyOf(n.url) : null;
  let quotedId: string | null = null;
  if (n.quotedPost?.url && postKeyOf(n.quotedPost.url) !== key) {
    const quote = n.quotedPost;
    const quoteUrl = n.quotedPost.url;
    const quoteKey = postKeyOf(quoteUrl);
    const existing = sqlite.prepare("SELECT captureId, isContext FROM posts WHERE postKey = ? AND saveScope = 'post' ORDER BY isContext, capturedAt DESC LIMIT 1").get(quoteKey) as { captureId: string; isContext: number } | undefined;
    quotedId = existing?.captureId || quotedCaptureId(quoteUrl);
    if (!existing || existing.isContext) {
      // 取得失敗で、前に取得した画像を消さない。
      const previous = sqlite.prepare('SELECT url, file, posterFile, type, alt, width, height FROM media WHERE postId = ? ORDER BY seq').all(quotedId) as PostRecordShape['media'];
      const media = quote.media.length ? quote.media.map((m) => (m.file ? m : previous.find((old) => old.url === m.url && old.file) || m)) : previous;
      writePost(stmts, resolveTagId, { ...quote, media, captureId: quotedId, platform: n.platform, capturedAt: n.capturedAt }, true);
    }
  }
  return quotedId;
}

function writePost(stmts: PostStmts, resolveTagId: (name: string) => number, rec: PostRecordInput, context = false): PostRecordShape {
  const n = normalizePostRecord(rec);
  const sqlite = stmts.sqlite;
  const key = n.url ? postKeyOf(n.url) : null;
  const oldContext = !context && n.saveScope === 'post' && key ? (sqlite.prepare('SELECT captureId FROM posts WHERE postKey = ? AND isContext = 1 AND captureId != ?').get(key, n.captureId) as { captureId: string } | undefined) : undefined;
  if (oldContext && !n.media.some((m) => m.file)) {
    n.media = (sqlite.prepare('SELECT url, alt, width, height, file, type, posterFile FROM media WHERE postId = ? ORDER BY seq').all(oldContext.captureId) as PostRecordShape['media']).map((m) => ({ ...m, crop: null, frames: null }));
  }
  const quotedId = context ? null : writeQuotedReference(stmts, resolveTagId, n);
  stmts.upsertPost.run(...postParams(n));
  sqlite.prepare('UPDATE posts SET isContext = ?, postKey = ?, quotedPostId = ?, quotedPost = CASE WHEN ? IS NOT NULL THEN NULL ELSE quotedPost END WHERE captureId = ?').run(context ? 1 : 0, key, quotedId, quotedId, n.captureId);
  if (oldContext) {
    sqlite.prepare('UPDATE posts SET quotedPostId = ?, updatedAt = ? WHERE quotedPostId = ?').run(n.captureId, n.updatedAt, oldContext.captureId);
    sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(oldContext.captureId);
  }
  const existingCrops = new Map((stmts.selectMediaCrops.all(n.captureId) as Array<{ file: string; cropX: number | null; cropY: number | null; cropWidth: number | null; cropHeight: number | null; rotation: number; flipped: number }>).map((row) => [row.file, row]));
  stmts.deleteMedia.run(n.captureId);
  // media の行で構造を持つ値は frames だけ。JSON のテキストとして持ち (add-media-frames の
  // マイグレーションを参照)、読むときに解析し直す。
  n.media.forEach((m, seq) => {
    const old = existingCrops.get(m.file);
    stmts.insertMedia.run(
      n.captureId,
      seq,
      m.url,
      m.alt,
      m.width,
      m.height,
      m.file,
      m.type,
      m.posterFile,
      m.frames ? JSON.stringify(m.frames) : null,
      m.crop?.x ?? old?.cropX ?? null,
      m.crop?.y ?? old?.cropY ?? null,
      m.crop?.width ?? old?.cropWidth ?? null,
      m.crop?.height ?? old?.cropHeight ?? null,
      m.rotation ?? old?.rotation ?? 0,
      m.flipped === undefined ? (old?.flipped ?? 0) : Number(m.flipped),
    );
  });
  // メタデータの再取得では、IDで付与した作品・キャラと手動/自動の区別を維持する。
  const classified = sqlite.prepare("SELECT pt.tagId,pt.implied,t.name FROM post_tags pt JOIN tags t ON t.id=pt.tagId WHERE pt.postId=? AND t.category!='general'").all(n.captureId) as Array<{ tagId: number; implied: number; name: string }>;
  stmts.deletePostTags.run(n.captureId);
  for (const row of classified) sqlite.prepare('INSERT INTO post_tags(postId,tagId,implied) VALUES(?,?,?)').run(n.captureId, row.tagId, row.implied);
  const tagIds = new Set(n.tags.filter((name) => !classified.some((row) => row.name === name)).map(resolveTagId));
  for (const tagId of tagIds) stmts.insertPostTag.run(n.captureId, tagId);
  if (context) return n;
  writePosterProfile(stmts, n);
  if (n.platform && n.screenName) {
    reconcilePosterIdentity(stmts.sqlite, n.screenName, n.platform);
    n.userId = (stmts.sqlite.prepare('SELECT userId FROM posts WHERE captureId = ?').get(n.captureId) as { userId: string | null }).userId;
  }
  return n;
}

function makeTagResolver(sqlite: Database.Database) {
  const cache = new Map<string, number>();
  for (const row of sqlite.prepare("SELECT id, name FROM tags WHERE category='general'").all() as Array<{ id: number; name: string }>) {
    if (!cache.has(row.name)) cache.set(row.name, row.id);
  }
  const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return function resolveTagId(rawName: string): number {
    const name = normalizeTagName(rawName) || rawName;
    const existing = cache.get(name);
    if (existing != null) return existing;
    const id = Number(insertTag.run(name).lastInsertRowid);
    cache.set(name, id);
    return id;
  };
}

export { POST_COLUMNS, UPSERT_POST_SQL, postParams, preparePostStmts, writePost, writePosterProfile, makeTagResolver, toDbBool };
export type { PostStmts };
