'use strict';

// 投稿1件を書く、共有の DB ライター。1つのレコードについて posts + media + post_tags +
// posts_fts を書く。PostRecordInput を DB の行に変える書き手＝取込キューの消費側
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
import { POSTS_FTS_COLUMNS } from './lib-db-schema.ts';
import { hasPosterIdentity, posterAppearanceHash, posterKeyOf } from './lib-poster-profile.ts';
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
  upsertPost: Database.Statement;
  deleteMedia: Database.Statement;
  selectMediaCrops: Database.Statement;
  insertMedia: Database.Statement;
  deletePostTags: Database.Statement;
  insertPostTag: Database.Statement;
  selectFtsRowid: Database.Statement;
  deleteFts: Database.Statement;
  insertFts: Database.Statement;
  claimFtsRowid: Database.Statement;
  deletePost: Database.Statement;
  selectPosterProfile: Database.Statement;
  insertPosterProfile: Database.Statement;
  updatePosterProfileCurrent: Database.Statement;
}

function preparePostStmts(sqlite: Database.Database): PostStmts {
  return {
    upsertPost: sqlite.prepare(UPSERT_POST_SQL),
    deleteMedia: sqlite.prepare('DELETE FROM media WHERE postId = ?'),
    selectMediaCrops: sqlite.prepare('SELECT seq, cropX, cropY, cropWidth, cropHeight FROM media WHERE postId = ?'),
    insertMedia: sqlite.prepare('INSERT INTO media (postId, seq, url, alt, width, height, file, type, posterFile, frames, cropX, cropY, cropWidth, cropHeight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    deletePostTags: sqlite.prepare('DELETE FROM post_tags WHERE postId = ?'),
    insertPostTag: sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)'),
    // posts_fts の行は ROWID で指す。UNINDEXED の postId の列で指すことは決してしない
    // (#444)＝FTS5 が用意する索引は MATCH と rowid だけなので、postId への WHERE は索引を
    // 丸ごと走査し、投稿1件あたりの書き込みの費用がライブラリの大きさとともに増える。
    // そのキーが posts.ftsRowid＝fts-rowid-addressing のマイグレーションを参照。
    selectFtsRowid: sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?'),
    deleteFts: sqlite.prepare('DELETE FROM posts_fts WHERE rowid = ?'),
    insertFts: sqlite.prepare(`INSERT INTO posts_fts (rowid, ${POSTS_FTS_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
    claimFtsRowid: sqlite.prepare('UPDATE posts SET ftsRowid = ? WHERE captureId = ?'),
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
function writePost(stmts: PostStmts, resolveTagId: (name: string) => number, rec: PostRecordInput): PostRecordShape {
  const n = normalizePostRecord(rec);
  stmts.upsertPost.run(...postParams(n));
  const existingCrops = new Map((stmts.selectMediaCrops.all(n.captureId) as Array<{ seq: number; cropX: number | null; cropY: number | null; cropWidth: number | null; cropHeight: number | null }>).map((row) => [row.seq, row]));
  stmts.deleteMedia.run(n.captureId);
  // media の行で構造を持つ値は frames だけ。JSON のテキストとして持ち (add-media-frames の
  // マイグレーションを参照)、読むときに解析し直す。
  n.media.forEach((m, seq) => {
    const old = existingCrops.get(seq);
    stmts.insertMedia.run(n.captureId, seq, m.url, m.alt, m.width, m.height, m.file, m.type, m.posterFile, m.frames ? JSON.stringify(m.frames) : null, m.crop?.x ?? old?.cropX ?? null, m.crop?.y ?? old?.cropY ?? null, m.crop?.width ?? old?.cropWidth ?? null, m.crop?.height ?? old?.cropHeight ?? null);
  });
  stmts.deletePostTags.run(n.captureId);
  const tagIds = n.tags.map(resolveTagId);
  for (const tagId of tagIds) stmts.insertPostTag.run(n.captureId, tagId);
  // FTS の行はまるごと書き直す。この投稿の既存のキーは保つので、posts.ftsRowid は有効な
  // まま。まだキーを持たない投稿（最初の書き込み）は FTS5 に割り当てさせて、それを記録する。
  // 上の upsert がこの列を消していることはありえない＝ftsRowid は意図して POST_COLUMNS に
  // 入れていない。
  const ftsRowid = (stmts.selectFtsRowid.get(n.captureId) as { ftsRowid: number | null } | undefined)?.ftsRowid ?? null;
  if (ftsRowid != null) stmts.deleteFts.run(ftsRowid);
  const ftsInsert = stmts.insertFts.run(ftsRowid, n.captureId, n.text, n.title, n.displayName, n.screenName, n.eagleName, n.hashtags.join(' '), n.tags.join(' '), null, n.cw);
  if (ftsRowid == null) stmts.claimFtsRowid.run(Number(ftsInsert.lastInsertRowid), n.captureId);
  writePosterProfile(stmts, n);
  return n;
}

// タグは名前で get-or-create し、消し去ることは決してしない。タグを消して入れ直すと
// AUTOINCREMENT の id が新しく発行され、古い方に対して整えた tag_parents/tag_aliases の行が
// CASCADE で消える (#157 の領分と #86＝下を参照)。だから、ある名前がいったん行を持てば、
// ここにいる書き手にとってその行の id は永久のもの。
//
// resolveTagId は検索と挿入のたびに正規化する (NFKC と trim、#197)。normalizePostRecord の
// 後ろにある2つ目のゲートであり（writePost のタグはすでに正規化されて来るので、そこでは何度
// 通しても同じ）、下の importTagParents にとっては唯一のゲートでもある。あちらの
// tag-parents.json の名前は normalizePostRecord を一度も通らない。
//
// #86: 別名に当たったら、名前でキャッシュを引くより前に短絡する＝タグの書き込みが必ず通る
// 「単一のゲート」のうち、保存の流れの側の半分（もう半分は lib-db-write.ts の tagResolver で、
// IPC 由来の書き込みを受け持つ）。ZIP の再取り込みも、旧形式・Eagle からの移行の取り込みも、
// writePost/importTagParents が共有するこの解決器を通る。だから、このライブラリに登録した
// 別名は、取り込みで入って来るタグ名も向け直す。
function makeTagResolver(sqlite: Database.Database) {
  const cache = new Map<string, number>();
  for (const row of sqlite.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>) {
    if (!cache.has(row.name)) cache.set(row.name, row.id);
  }
  const aliasCache = new Map<string, number>();
  for (const row of sqlite.prepare('SELECT alias, tagId FROM tag_aliases').all() as Array<{ alias: string; tagId: number }>) {
    aliasCache.set(row.alias, row.tagId);
  }
  const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return function resolveTagId(rawName: string): number {
    const name = normalizeTagName(rawName) || rawName;
    const aliased = aliasCache.get(name);
    if (aliased != null) return aliased;
    const existing = cache.get(name);
    if (existing != null) return existing;
    const id = Number(insertTag.run(name).lastInsertRowid);
    cache.set(name, id);
    return id;
  };
}

// --- tag_parents の書き込み経路 (#300/St7) -------------------------------------
// tag_parents（タグの親のつながりと、高々1つの表示親の印。DDL のコメントは
// lib-db-schema.ts）には、まだアプリ内の書き込み経路が無い＝#86/#157 のための、眠ったままの
// スキーマ。今のところ唯一の書き手は、完全書き出し ZIP の library/tag-parents.json
// (lib-archive.ts)。#300 のために作った形式で、サイドカー時代の前身は無い。
// 形: { tags: [{ref,name,kind,reading}], parents: [{tagRef,parentRef,isDisplay}] }
// ＝`ref` は書き出した側のデータベース自身の tags.id で、その1回の書き出しの中でしか意味を
// 持たない（ZIP はある時点のスナップショットで、書き出しをまたぐ id の空間は存在しない）。
export interface TagParentsJson {
  tags: Array<{ ref: number; name: string; kind?: string | null; reading?: string | null }>;
  parents: Array<{ tagRef: number; parentRef: number; isDisplay?: boolean }>;
}

// 書き出された各タグを名前で解決し (resolveTagId＝get-or-create で、posts/poster_tags が
// 使うのと同じ解決器)、親のつながりを書く。
//
// 分かっている限界で、v1 では受け入れる。resolveTagId は、名前を共有するが実体としては別の
// 2つのタグを区別できない（tag_parents と isDisplay がまさにその曖昧さを解くために在る）。
// 同名だが別のタグをすでに持つライブラリへ取り込むと、両方が同じ行に解決される。空の
// データベースへの取り込みは影響を受けない（衝突する相手が無い）。同名の実体を分けて整える
// のは DB に直接向かってやること (#21 の領分) で、ここではない。
//
// isDisplay は「タグ1つにつき表示親は高々1つ」の部分ユニーク索引
// (idx_tag_parents_display) を守って書く。着地先のデータベースがそのタグについてすでに別の
// 表示親を持っているなら、入って来るつながり自体は挿入する（親子の関係そのものは往復する）
// が、isDisplay は false に落とす＝ローカルが勝つ。lib-archive.ts の他のどの統合も使って
// いる、同じ約束事。
function importTagParents(sqlite: Database.Database, resolveTagId: (name: string) => number, data: TagParentsJson | null | undefined): void {
  if (!data || !Array.isArray(data.tags) || !Array.isArray(data.parents)) return;

  const refToId = new Map<number, number>();
  for (const t of data.tags) {
    if (!t || typeof t.ref !== 'number' || typeof t.name !== 'string' || !t.name) continue;
    refToId.set(t.ref, resolveTagId(t.name));
  }

  const existingDisplay = new Map<number, number>();
  for (const row of sqlite.prepare('SELECT tagId, parentTagId FROM tag_parents WHERE isDisplay = 1').all() as Array<{ tagId: number; parentTagId: number }>) {
    existingDisplay.set(row.tagId, row.parentTagId);
  }
  const insertEdge = sqlite.prepare('INSERT OR IGNORE INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
  for (const p of data.parents) {
    if (!p || typeof p.tagRef !== 'number' || typeof p.parentRef !== 'number') continue;
    const tagId = refToId.get(p.tagRef);
    const parentTagId = refToId.get(p.parentRef);
    if (tagId == null || parentTagId == null || tagId === parentTagId) continue; // 解決できなかった ref か、自分自身を親として並べているタグ
    const currentDisplay = existingDisplay.get(tagId);
    const setDisplay = !!p.isDisplay && (currentDisplay == null || currentDisplay === parentTagId);
    insertEdge.run(tagId, parentTagId, setDisplay ? 1 : 0);
    if (setDisplay) existingDisplay.set(tagId, parentTagId);
  }
}

export { POST_COLUMNS, UPSERT_POST_SQL, postParams, preparePostStmts, writePost, writePosterProfile, makeTagResolver, toDbBool, importTagParents };
export type { PostStmts };
