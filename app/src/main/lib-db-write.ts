'use strict';

// #298/St5 のための、DB が持つ整理の状態。読み取り経路はすでに SQLite を使っていたが、
// これらの値は正本の反転までは JSON ファイルの中に居た。置き換えの操作をここへ集めるので、
// どの IPC ハンドラも同じトランザクションの境界を共有する。そうしないと、それぞれが違う
// テーブルの部分集合を組み直すことになる。

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { PostFlagsSchema, type PostFlags, type PosterProfileSchema, PosterProfilesSchema } from '../shared/data-schemas.ts';
import { TagPatchSchema } from '../shared/ipc-inputs.ts';
import { IdsSchema, LabelsSchema, TagTypeWriteSchema, TagTypeNamesSchema, FoldersSchema, ManualGroupsSchema, PosterFoldersSchema, PosterTagNamesSchema, TabsSchema, HistoryEntrySchema, HistoryQuerySchema } from '../shared/data-schemas.ts';
import { normalizeCropRect } from '../../../native-host/post-record.mts';
import { normFolders } from './lib-folder-tree.ts';
import { normalizeTagName, normalizeTagNames } from '../../../native-host/tag-normalize.mts';
import { effectiveTagsOf, tagClosureResolver } from './lib-db-query.ts';
import type { PosterTagNamesState, PosterTagRow, PosterTagsState, TagTypeNamesState, TagTypeRow, TagTypesState } from './ipc-payloads.ts';
import {
  addTagAlias as addTagAliasImpl,
  addTagParent as addTagParentImpl,
  deleteOrphanTags as deleteOrphanTagsImpl,
  keepSeparateRename as keepSeparateRenameImpl,
  listTagAliases as listTagAliasesImpl,
  mergeTags as mergeTagsImpl,
  removeTagAlias as removeTagAliasImpl,
  removeTagParent as removeTagParentImpl,
  renameTag as renameTagImpl,
  setTagKind as setTagKindImpl,
  splitTag as splitTagImpl,
  tagParentEdges as tagParentEdgesImpl,
  tagSplitPreview as tagSplitPreviewImpl,
  tagVocabOverview as tagVocabOverviewImpl,
} from './lib-db-tag-vocab.ts';

type Sqlite = Database.Database;

// タグではない値（postId/folderId/postKey の配列）のための、汎用の文字列配列の掃除。グリフの
// 正規化はしない＝それらはタグのテキストではないから。タグの配列は代わりに
// normalizeTagNames を使う（下）＝replacePostTags/replacePosterTags を参照。

function stateGet(sqlite: Sqlite, key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function stateSet(sqlite: Sqlite, key: string, value: string) {
  sqlite.prepare('INSERT INTO store_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** このライブラリの同一性を持つ store_state のキー (#176 / #233)。 */
const LIBRARY_ID_KEY = 'libraryId';

/**
 * このライブラリ自身の id。最初に読んだときに発行する。
 *
 * id が config.json でもマーカーファイルでもなくデータベースに居るのは、ライブラリとは
 * データベースそのものだから (#176:「DB 自体が目印」)。フォルダを写せば写しは同じ同一性を
 * 持ち、アプリを別のフォルダへ向ければ id もそれに従って変わる。
 *
 * CREATE の時点ではなく遅らせて書くので、これより前からあるライブラリは、埋め戻しの
 * マイグレーションを要さずに次の起動で id を得る。
 */
function ensureLibraryId(sqlite: Sqlite): string {
  const existing = stateGet(sqlite, LIBRARY_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  stateSet(sqlite, LIBRARY_ID_KEY, id);
  return id;
}

function existingPostIds(sqlite: Sqlite): Set<string> {
  return new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((row) => row.captureId));
}

// 検索と挿入のたびに正規化する (NFKC と trim、#197)＝下にある IPC 由来のタグの書き込み
// （タグの種別、投稿者タグ、投稿タグ）が全部通る絞り。makeTagResolver が保存の流れで
// 果たしているのと同じ役 (lib-db-record-writer.ts)。
//
// #86: 別名の検査は get-or-create の検索より前に走る＝それらの書き込みが必ず通る単一のゲート
// なので、登録済みの別名を打ち込めば必ず正規のタグの id に着き、その綴りで2つ目の実体が
// 生まれることはない。無条件で安全＝名前空間を共有するという不変条件（lib-db-tag-vocab.ts
// にある、このモジュール自身の addTagAlias/renameTag の防ぎ）が、ある名前が本物のタグの
// 名前でありながら、同時に他の誰かの別名としてそこから他所を指すことは決してないと保証する。
function tagResolver(sqlite: Sqlite) {
  const selectAlias = sqlite.prepare('SELECT tagId FROM tag_aliases WHERE alias = ?');
  const select = sqlite.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id LIMIT 1');
  const insert = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return (rawName: string) => {
    const name = normalizeTagName(rawName) || rawName;
    const aliased = selectAlias.get(name) as { tagId: number } | undefined;
    if (aliased) return aliased.tagId;
    const row = select.get(name) as { id: number } | undefined;
    return row?.id ?? Number(insert.run(name).lastInsertRowid);
  };
}

// #810: 種別のストアはタグの実体をキーにする。レンダラーは readTagTypes が渡したのと同じ行を
// そのまま返してくるので、種別はユーザーが分類した id に着く＝名前の解決が無く、したがって
// 片方を失う同名の畳み込みも無い。
//
// 相変わらずマップ丸ごとの置き換えではある（マップはレンダラーが持ち、変更のたびに送り直す。
// このモジュールの他の setter と同じ形）が、入れ直しはもう安全＝全部の kind を NULL にして
// id で当て直せば、送り手が持っているものがそのまま戻る。名前をキーにしていた版は、名前
// ごとに実体を1つしか当て直さず、もう一方を永久に種別なしのまま残していた。
function replaceTagTypes(sqlite: Sqlite, types: z.output<typeof TagTypeWriteSchema>[], labels: z.output<typeof LabelsSchema>) {
  sqlite.prepare('UPDATE tags SET kind = NULL').run();
  const setKind = sqlite.prepare('UPDATE tags SET kind = ? WHERE id = ?');
  for (const { id, kind } of types) {
    setKind.run(kind, id);
  }
  stateSet(sqlite, 'tagTypeLabels', JSON.stringify(labels));
}

// 名前を変えられる work/character のラベルの表で、下の2つの読み手が共有する。値は DB が持ち、
// このモジュール以外は書かない。だから形の壊れた値は、タグを全部止める理由ではなく、単に
// 権威が無いものとして扱う。ここにオブジェクトが入っていれば、それはレンダラーの種別ラベルの
// マップそのもの (ipc-payloads.ts の TagTypesState.labels)。書き手が replaceTagTypes だけ
// だから。
function readTagTypeLabels(sqlite: Sqlite): Record<string, string> | null {
  let labels: unknown = null;
  try {
    labels = JSON.parse(stateGet(sqlite, 'tagTypeLabels') || 'null');
  } catch {
    /* 上を参照 */
  }
  const parsed = LabelsSchema.safeParse(labels);
  return parsed.success ? parsed.data : null;
}

function readTagTypes(sqlite: Sqlite): TagTypesState {
  // labelOf は #774 の表示名の規則。親のつながりが1つも無いライブラリには解決器そのものが
  // 無く、そのときタグのラベルはただの名前になる。
  const closure = tagClosureResolver(sqlite);
  const rows = sqlite.prepare('SELECT id, name, kind FROM tags WHERE kind IS NOT NULL ORDER BY id').all() as Array<{ id: number; name: string; kind: string }>;
  const types: TagTypeRow[] = rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, label: closure ? closure.labelOf(row.id) : row.name }));
  return { types, labels: readTagTypeLabels(sqlite) };
}

// --- 名前をキーにする対。ZIP のやり取りだけのためのもの (#810) ---------------
// tag-types.json はライブラリ間を渡り、そこではタグの id が何も意味しない。だから書庫は、
// このモジュールがかつてどこにでも出していた、名前をキーにする形を保つ。同名の実体2つは
// ここで必ず1つのエントリに畳まれる（先に来た＝id の小さい方が勝つ）。それは名前をキーに
// する形式の性質であって、その中で直すべきバグではない。
function readTagTypeNames(sqlite: Sqlite): TagTypeNamesState {
  const types: Record<string, string> = {};
  for (const row of sqlite.prepare('SELECT name, kind FROM tags WHERE kind IS NOT NULL ORDER BY id').all() as Array<{ name: string; kind: string }>) {
    if (!(row.name in types)) types[row.name] = row.kind;
  }
  return { types, labels: readTagTypeLabels(sqlite) };
}

// 取り込み側の半分。意図して置き換えにはしていない＝名指された実体が種別を持たないところ
// だけを埋めるので、書庫を取り込んでも、ローカルの同名の実体がすでに持つ種別を消すことは
// 決してない。これは lib-archive.ts の mergeTagTypes の規則（`cur wins`＝今あるものが勝つ）
// を、名前ではなく実体に対して言い直したものでもある。呼び出し元は統合済みのマップを渡す
// ので、ローカル側から来たエントリは、作りからしてここでは何もしない。
function fillTagKindsByName(sqlite: Sqlite, types: z.output<typeof TagTypeNamesSchema>['types'], labels: z.output<typeof LabelsSchema>) {
  const resolve = tagResolver(sqlite);
  const setKind = sqlite.prepare('UPDATE tags SET kind = ? WHERE name = ? AND kind IS NULL');
  for (const [rawName, kind] of Object.entries(types)) {
    const name = normalizeTagName(rawName);
    if (!name) continue;
    resolve(name); // 入って来る種別が、このライブラリの見たことがないタグを指す場合がある
    setKind.run(kind, name);
  }
  stateSet(sqlite, 'tagTypeLabels', JSON.stringify(labels));
}

function replaceUngrouped(sqlite: Sqlite, keys: string[]) {
  sqlite.prepare('DELETE FROM ungrouped_keys').run();
  const insert = sqlite.prepare('INSERT INTO ungrouped_keys (postKey) VALUES (?)');
  for (const key of keys) insert.run(key);
}

function readUngrouped(sqlite: Sqlite) {
  return { keys: (sqlite.prepare('SELECT postKey FROM ungrouped_keys ORDER BY rowid').all() as Array<{ postKey: string }>).map((row) => row.postKey) };
}

function replaceFolders(sqlite: Sqlite, data: z.output<typeof FoldersSchema>) {
  const folders = normFolders(data.folders);
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM folder_items').run();
  sqlite.prepare('DELETE FROM folders').run();

  const insertFolder = sqlite.prepare('INSERT INTO folders (id, name, kind, created, tree) VALUES (?, ?, ?, ?, ?)');
  const setParent = sqlite.prepare('UPDATE folders SET parentId = ? WHERE id = ?');
  const insertItem = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) VALUES (?, ?)');
  const ids = new Set<string>();
  for (const folder of folders) {
    const kind = folder.kind;
    const tree = kind === 'dynamic' && folder.tree ? JSON.stringify(folder.tree) : null;
    insertFolder.run(folder.id, folder.name, kind, folder.created, tree);
    ids.add(folder.id);
    for (const postId of folder.items) if (validPosts.has(postId)) insertItem.run(folder.id, postId);
  }
  // つながりを当てる前に id を全部挿入する。兄弟の順序は配列の順序なので、平らな並びの中で
  // 子が親より前に来ることが正当にありうる。
  for (const folder of folders) if (folder.parentId) setParent.run(folder.parentId, folder.id);
  stateSet(sqlite, 'activeFolderId', data.activeId !== null && ids.has(data.activeId) ? data.activeId : '');
}

function readFolders(sqlite: Sqlite) {
  const itemRows = sqlite.prepare('SELECT folderId, postId FROM folder_items ORDER BY rowid').all() as Array<{ folderId: string; postId: string }>;
  const items = new Map<string, string[]>();
  for (const row of itemRows) {
    let values = items.get(row.folderId);
    if (!values) items.set(row.folderId, (values = []));
    values.push(row.postId);
  }
  const folders = normFolders(
    (sqlite.prepare('SELECT id, name, kind, created, parentId, tree FROM folders ORDER BY rowid').all() as any[]).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      created: row.created,
      parentId: row.parentId,
      items: items.get(row.id) || [],
      ...(row.kind === 'dynamic' && row.tree ? { tree: JSON.parse(row.tree) } : {}),
    })),
  );
  const ids = new Set(folders.map((folder) => folder.id));
  const activeId = stateGet(sqlite, 'activeFolderId');
  return {
    folders,
    activeId: activeId && ids.has(activeId) ? activeId : null,
  };
}

function replaceManualGroups(sqlite: Sqlite, groups: string[][]) {
  const validPosts = existingPostIds(sqlite);
  sqlite.prepare('DELETE FROM manual_group_items').run();
  sqlite.prepare('DELETE FROM manual_groups').run();
  const create = sqlite.prepare('INSERT INTO manual_groups DEFAULT VALUES');
  const insert = sqlite.prepare('INSERT INTO manual_group_items (groupId, postId, seq) VALUES (?, ?, ?)');
  for (const group of groups) {
    const members = group.filter((id) => validPosts.has(id));
    if (members.length < 2) continue;
    const groupId = Number(create.run().lastInsertRowid);
    members.forEach((postId, seq) => insert.run(groupId, postId, seq));
  }
}

function readManualGroups(sqlite: Sqlite) {
  const rows = sqlite.prepare('SELECT groupId, postId FROM manual_group_items ORDER BY groupId, seq').all() as Array<{ groupId: number; postId: string }>;
  const groups = new Map<number, string[]>();
  for (const row of rows) {
    let values = groups.get(row.groupId);
    if (!values) groups.set(row.groupId, (values = []));
    values.push(row.postId);
  }
  return { groups: [...groups.values()] };
}

function replacePosterFolders(sqlite: Sqlite, data: z.output<typeof PosterFoldersSchema>) {
  sqlite.prepare('DELETE FROM poster_folder_items').run();
  sqlite.prepare('DELETE FROM poster_folders').run();
  const folder = sqlite.prepare('INSERT INTO poster_folders (id, name) VALUES (?, ?)');
  const item = sqlite.prepare('INSERT OR IGNORE INTO poster_folder_items (folderId, posterKey) VALUES (?, ?)');
  for (const entry of data.folders) {
    folder.run(entry.id, entry.name);
    for (const key of entry.items) item.run(entry.id, key);
  }
}

function readPosterFolders(sqlite: Sqlite) {
  const items = new Map<string, string[]>();
  for (const row of sqlite.prepare('SELECT folderId, posterKey FROM poster_folder_items ORDER BY rowid').all() as Array<{ folderId: string; posterKey: string }>) {
    let values = items.get(row.folderId);
    if (!values) items.set(row.folderId, (values = []));
    values.push(row.posterKey);
  }
  return { folders: (sqlite.prepare('SELECT id, name FROM poster_folders ORDER BY rowid').all() as Array<{ id: string; name: string }>).map((row) => ({ ...row, items: items.get(row.id) || [] })) };
}

// 読み取りは実体を返すのに、書き込みは名前をキーにしたまま (#810)。投稿者タグの編集欄は
// テキスト入力で、今しがた打ち込まれたタグは、この resolve() が作るまで id を持たない＝
// replacePostTags がすでに抱えているのとまったく同じ非対称。
function replacePosterTags(sqlite: Sqlite, data: z.output<typeof PosterTagNamesSchema>) {
  sqlite.prepare('DELETE FROM poster_tags').run();
  const resolve = tagResolver(sqlite);
  const insert = sqlite.prepare('INSERT OR IGNORE INTO poster_tags (posterKey, tagId) VALUES (?, ?)');
  for (const [key, tags] of Object.entries(data.tags)) {
    for (const name of normalizeTagNames(tags)) insert.run(key, resolve(name));
  }
}

// #810: 投稿者のタグを実体として読む。投稿レコードが持つのと同じ、並ぶ配列の形。あわせて
// #774 の実効の集合＝素のタグと、tag_parents のつながりが含意する祖先を全部返す。id が無い
// と、レンダラーは投稿者を名前でしか照合できない。それは #774 がはっきり退けた方法（名前を
// キーにする閉包は、同名の実体2つのうち片方にしか届かず、表示名も数え損なう）。実効の集合が
// 無いと、親タグで投稿者を絞り込んだとき、その子だけを持つ投稿者が漏れる。投稿の側は同じ
// 条件で見つけているのに。
function readPosterTags(sqlite: Sqlite): PosterTagsState {
  const rowsByPoster = new Map<string, Array<{ id: number; name: string }>>();
  for (const row of sqlite.prepare('SELECT pt.posterKey AS posterKey, t.id AS id, t.name AS name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; id: number; name: string }>) {
    let list = rowsByPoster.get(row.posterKey);
    if (!list) rowsByPoster.set(row.posterKey, (list = []));
    list.push({ id: row.id, name: row.name });
  }
  const closure = tagClosureResolver(sqlite);
  const tags: Record<string, PosterTagRow> = {};
  for (const [posterKey, list] of rowsByPoster) {
    tags[posterKey] = { tags: list.map((t) => t.name), tagIds: list.map((t) => t.id), ...effectiveTagsOf(closure, list) };
  }
  return { tags };
}

// 名前だけに落とした射影で、ZIP のやり取りのためのもの＝理由は上の readTagTypeNames と同じ
// (poster-tags.json はライブラリ間を渡るが、id は渡らない)。
function readPosterTagNames(sqlite: Sqlite): PosterTagNamesState {
  const tags: Record<string, string[]> = {};
  for (const row of sqlite.prepare('SELECT pt.posterKey, t.name FROM poster_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid').all() as Array<{ posterKey: string; name: string }>) {
    (tags[row.posterKey] || (tags[row.posterKey] = [])).push(row.name);
  }
  return { tags };
}

// 完全 ZIP では現在の公開プロフィールだけを運ぶ。履歴は保存しない。
type PosterProfileJson = z.output<typeof PosterProfileSchema>;

function readPosterProfiles(sqlite: Sqlite): { profiles: PosterProfileJson[] } {
  return {
    profiles: sqlite.prepare('SELECT posterKey, platform, userId, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, following, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt FROM poster_profiles ORDER BY posterKey').all() as PosterProfileJson[],
  };
}

function replacePosterProfiles(sqlite: Sqlite, data: z.output<typeof PosterProfilesSchema>): void {
  sqlite.prepare('DELETE FROM poster_profiles').run();
  const profiles = data.profiles;
  const insertProfile = sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, userId, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, following, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const p of profiles) {
    insertProfile.run(p.posterKey, p.platform, p.userId, p.displayName, p.screenName, p.bio, p.links, p.avatar, p.avatarFile, p.banner, p.bannerFile, p.followers, p.following, p.authorCreatedAt, p.contentHash, p.provenance, p.firstObservedAt, p.lastObservedAt);
  }
}

// 投稿単位の編集＝タグの割り当て (post_tags) と、投稿ごとのばらばらの欄へのパッチ。
// userKind/tagReviewed（タグ付けウィザードの印）は、St2 に置き場が無かったからこそ
// add-store-state のマイグレーションが足したもの (lib-db.ts のマイグレーションのコメント)。
// normalizePostRecord の PostRecordShape は意図してこれらを外している
// (native-host/post-record.mts) ので、DB だけのもので、サイドカーを往復することは決してない。
// postId が既知の投稿で
// なければ、何も書かずに false を返す。古いサイドカーのハンドラの
// 「jsonPath が無い → ok:false」に倣う。
function replacePostTags(sqlite: Sqlite, postId: string, tags: string[], patch: z.output<typeof TagPatchSchema> | null): boolean {
  const post = sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(postId) as { ftsRowid: number | null } | undefined;
  if (!post) return false;

  const names = normalizeTagNames(tags);
  sqlite.prepare('DELETE FROM post_tags WHERE postId = ?').run(postId);
  const resolve = tagResolver(sqlite);
  const insertTag = sqlite.prepare('INSERT OR IGNORE INTO post_tags (postId, tagId) VALUES (?, ?)');
  for (const tagId of names.map(resolve)) insertTag.run(postId, tagId);

  const sets = ['updatedAt = ?'];
  const params: unknown[] = [new Date().toISOString()];
  if (patch) {
    if (patch.userKind !== undefined) {
      sets.push('userKind = ?');
      params.push(patch.userKind);
    }
    if (patch.tagReviewed !== undefined) {
      sets.push('tagReviewed = ?');
      params.push(patch.tagReviewed ? 1 : 0);
    }
  }
  sqlite.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE captureId = ?`).run(...params, postId);

  // posts_fts は独立している（content= のつながりを持たない。lib-db-schema.ts のスキーマの
  // コメント）ので、素の列の UPDATE が正当な FTS5 の SQL になる＝他の索引済みの列を保つのに
  // 削除して入れ直す必要は無い。指し方は rowid で、UNINDEXED の postId ではない (#444)＝
  // posts.ftsRowid を参照。null になるのは、他の経路が直に挿入した posts の行だけで、それは
  // 更新すべき FTS の行も持たない。
  if (post.ftsRowid != null) sqlite.prepare('UPDATE posts_fts SET tagsText = ? WHERE rowid = ?').run(names.join(' '), post.ftsRowid);
  return true;
}

// ライブラリの構造の中でその投稿がどこに居るか。ゴミ箱のレコードが運ばなければならない形
// (#593)。どちらも名前ではなく id の参照＝削除から復元までの間にフォルダが改名されても、
// 所属を失ってはいけないから。
interface PostMemberships {
  folders: string[];
  // seq はグループの中でのその投稿の位置。手動グループは順序を持つ入れ物なので保つ＝先頭に
  // 居た投稿をグループの末尾へ戻すのは、「元の場所へ戻した」ことにならない。
  manualGroups: Array<{ groupId: number; seq: number }>;
}

// 1つの投稿について、そのレコードではなく DB に居るもの全部を、行が消える前に読む＝
// ipc-trash.ts の delete-post がこれをゴミ箱のレコードへ運び、restore-post が読み戻す。
//
// ここの欄はどれも、存在する理由を1つ共有している。FK の ON DELETE CASCADE がこれらの行を
// 投稿ごと連れて行き、レコードの中には、それを組み直せるものが何も無い。#593 が2つの所属を
// 足したのは、復元した投稿がタグは持ったままどこにも所属せずに戻ってくると分かったから。
// 一方、#34 の置き換えの経路は、その同じ2つをずっと新しいキャプチャへ運んでいた。
function readPostFlags(sqlite: Sqlite, postId: string): ({ tags: string[]; userKind: string | null; tagReviewed: boolean | null } & PostMemberships) | null {
  const row = sqlite.prepare('SELECT userKind, tagReviewed FROM posts WHERE captureId = ?').get(postId) as { userKind: string | null; tagReviewed: number | null } | undefined;
  if (!row) return null;
  const tags = (sqlite.prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(postId) as Array<{ name: string }>).map((r) => r.name);
  const folders = (sqlite.prepare('SELECT folderId FROM folder_items WHERE postId = ? ORDER BY rowid').all(postId) as Array<{ folderId: string }>).map((r) => r.folderId);
  const manualGroups = sqlite.prepare('SELECT groupId, seq FROM manual_group_items WHERE postId = ? ORDER BY groupId').all(postId) as Array<{ groupId: number; seq: number }>;
  return { tags, userKind: row.userKind, tagReviewed: row.tagReviewed == null ? null : !!row.tagReviewed, folders, manualGroups };
}

// ユーザーが起こした削除のための、DB 側の直接の削除 (ipc-trash.ts の delete-post)。
// #299 (St6)。DB が権威になった以上、「監視しているフォルダからサイドカーが消えた」は
// importAll が動く信号ではなくなった (lib-db-import.ts の dbIsTruth のゲート＝ネイティブの
// 保存が取込キューを通るようになった今、投稿がサイドカーを1つも持たないことは正当)。だから
// ゴミ箱への移動は、次の importAll がファイルの不在に気づいて行を CASCADE で消すのを、もう
// 当てにできない。これがその削除を明示したもの。FK の ON DELETE CASCADE が media/post_tags を
// 連れて行く。posts_fts は独立している（スキーマのコメント）ので、その行は明示的に消す。
// （指し方は rowid で、UNINDEXED の postId ではない＝#444。キーを持つ posts の行が消える前に
// 引いておくしかない。）
function deletePost(sqlite: Sqlite, postId: string): boolean {
  const post = sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(postId) as { ftsRowid: number | null } | undefined;
  if (post?.ftsRowid != null) sqlite.prepare('DELETE FROM posts_fts WHERE rowid = ?').run(post.ftsRowid);
  return sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(postId).changes > 0;
}

// 全消去の DB 側の半分。以前はメディアのファイルを消すだけで足りた。次のフォルダ走査が、
// レコードがファイルを失ったことに気づいて行を落としていたから。走査が無くなった今 (#302)、
// 消去は自分でそう言うしかない。整理（フォルダ、タグ、poster-*）は意図して残す＝全消去は
// 昔から「投稿を取り除く」ことであり、生き残った構造は、ユーザーがそこへ組み直していく先
// だから。
function deleteAllPosts(sqlite: Sqlite): number {
  sqlite.prepare('DELETE FROM posts_fts').run();
  return sqlite.prepare('DELETE FROM posts').run().changes;
}

// SNS が配信する views ではなく、このライブラリで投稿を画像ビューへ出した回数。
// 読み出してから書き戻す形にせず、1文で増やす。別ウィンドウから同時に開いても
// 片方の加算を失わない。行が無ければ null を返し、架空の利用履歴を作らない。
function recordPostView(sqlite: Sqlite, postId: string): number | null {
  if (!postId) return null;
  const row = sqlite.prepare('UPDATE posts SET localViewCount = localViewCount + 1 WHERE captureId = ? RETURNING localViewCount').get(postId) as { localViewCount: number } | undefined;
  return row?.localViewCount ?? null;
}

// サイドカーの形をしたレコードから userKind/tagReviewed/localViewCount を、既存の posts の行へ
// 当て直す。
// ipc-trash.ts の restore-post が使う（delete-post がゴミ箱行きの時点の DB の値を刻んで写した
// サイドカーを読む）。前2つは normalizePostRecord/lib-db-import.ts を往復しない。localViewCount
// も投稿データの書き込みではなく、このライブラリの利用履歴として復元する。レコードが前2つの欄を
// 運んでいないときは、COALESCE が既存の列を NULL で潰さずに保つ。
function applyPostFlagsFromRecord(sqlite: Sqlite, postId: string, rec: PostFlags) {
  const userKind = rec.userKind ?? null;
  const tagReviewed = rec.tagReviewed == null ? null : rec.tagReviewed ? 1 : 0;
  if (userKind != null || tagReviewed != null) {
    sqlite.prepare('UPDATE posts SET userKind = COALESCE(?, userKind), tagReviewed = COALESCE(?, tagReviewed) WHERE captureId = ?').run(userKind, tagReviewed, postId);
  }
  // 完全バックアップの取り込みとゴミ箱からの復元では、writePost が扱わない
  // ライブラリ固有の利用履歴をレコードから戻す。外部入力なので非負の安全な整数だけ。
  if (rec.localViewCount !== undefined) {
    sqlite.prepare('UPDATE posts SET localViewCount = ? WHERE captureId = ?').run(rec.localViewCount, postId);
  }
  restoreMemberships(sqlite, postId, rec);
}

// その投稿を、居たフォルダと手動グループへ戻す (#593)。ただし、今も在るものへだけ。
//
// 投稿がゴミ箱に居る間に入れ物が消されることはあり、どちらのテーブルも自分の入れ物を外部
// キーで参照している＝消えたフォルダを名指す INSERT は失敗し、復元全体を道連れにする。その
// 所属1つだけを落とすのは、#34 の置き換えの経路が実質すでにやっていること（生き残った行だけ
// を写すので、消えたフォルダは何も寄与しない）。所属を守るために投稿を失うのは、引き合わない
// 取り引き。
//
// 黙って落とすのは意図してのこと。他の道は、復元を断るか、ユーザーがわざと消した入れ物を
// 作り直すか。INSERT OR IGNORE は、投稿がすでにメンバーである場合を吸収する（部分的に失敗
// したあとに復元をやり直した場合）。
//
// レコードは外から来る入力＝ゴミ箱のフォルダはアプリの外から書ける (#324)。だから、どの id
// も文へ渡る前に型を検査する。
function restoreMemberships(sqlite: Sqlite, postId: string, rec: PostFlags) {
  const folders = rec.folders ?? [];
  if (folders.length) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM folders WHERE id = ?)');
    for (const folderId of folders) {
      insert.run(folderId, postId, folderId);
    }
  }
  const groups = rec.manualGroups ?? [];
  if (groups.length) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO manual_group_items (groupId, postId, seq) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM manual_groups WHERE id = ?)');
    for (const g of groups) {
      insert.run(g.groupId, postId, g.seq, g.groupId);
    }
  }
}

function replaceTabs(sqlite: Sqlite, data: z.output<typeof TabsSchema>) {
  sqlite.prepare('DELETE FROM tab_windows').run();
  sqlite.prepare('DELETE FROM tabs').run();
  const tabs = data.tabs;
  const insert = sqlite.prepare('INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES (?, ?, ?, ?, ?, ?)');
  const ids = new Set<string>();
  tabs.forEach((tab, position) => {
    ids.add(tab.id);
    insert.run(tab.id, 'main', position, tab.pinned ? 1 : 0, tab.title, JSON.stringify(tab.state));
  });
  sqlite.prepare('INSERT INTO tab_windows (windowId, activeTabId) VALUES (?, ?)').run('main', data.activeTabId !== null && ids.has(data.activeTabId) ? data.activeTabId : null);
}

function readTabs(sqlite: Sqlite) {
  const tabs = (sqlite.prepare("SELECT id, pinned, title, state FROM tabs WHERE windowId = 'main' ORDER BY position").all() as any[]).map((row) => ({ id: row.id, pinned: !!row.pinned, title: row.title, state: JSON.parse(row.state) }));
  if (!tabs.length) return null;
  const active = sqlite.prepare("SELECT activeTabId FROM tab_windows WHERE windowId = 'main'").get() as { activeTabId: string | null } | undefined;
  return { tabs, activeTabId: active?.activeTabId || null };
}

// #145: 全体の履歴ページのストア。#144 の push のエントリ1件につき1行（push か replace かは、
// append を呼ぶ前にレンダラーが決める＝services/history.ts の recordPush を参照）。state は
// そのまま運ぶ（HologramNavEntry の state は選択もスクロール位置も決して運ばない＝それらは
// 履歴のエントリではなくタブのオブジェクトに居る。だからレンダラーがすでに省いている以上に、
// ここで間引くものは無い）。
const HISTORY_PAGE_SIZE = 200;
const HISTORY_MAX_ROWS = 50000;
const HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function appendHistory(sqlite: Sqlite, row: z.output<typeof HistoryEntrySchema>): void {
  const { ts, u, kind, title } = row;
  sqlite.prepare('INSERT INTO history (ts, u, kind, title, state) VALUES (?, ?, ?, ?, ?)').run(ts, u, kind, title, JSON.stringify(row.state ?? null));
}

// キーセットによるページ送り (ts, id) の降順。OFFSET ではないので、スクロールの途中で行が
// 消えても、そのページの残りがずれることは決してない (#145 設計 §5)。`search` は title と u
// に部分文字列で当てる。履歴は上限が5万行なので、この程度の大きさのテーブルに posts_fts の
// trigram の索引は過剰。
function queryHistory(sqlite: Sqlite, opts: z.output<typeof HistoryQuerySchema> = {}): { rows: { id: number; ts: number; u: string; kind: string; title: string; state: unknown }[]; hasMore: boolean } {
  const search = opts.search?.trim() ?? '';
  const before = opts.before;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (search) {
    clauses.push('(title LIKE ? OR u LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  if (before) {
    clauses.push('(ts < ? OR (ts = ? AND id < ?))');
    params.push(before.ts, before.ts, before.id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = sqlite.prepare(`SELECT id, ts, u, kind, title, state FROM history ${where} ORDER BY ts DESC, id DESC LIMIT ?`).all(...params, HISTORY_PAGE_SIZE + 1) as { id: number; ts: number; u: string; kind: string; title: string; state: string }[];
  const hasMore = rows.length > HISTORY_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows;
  return { rows: page.map((r) => ({ id: r.id, ts: r.ts, u: r.u, kind: r.kind, title: r.title, state: JSON.parse(r.state) })), hasMore };
}

function deleteHistoryRow(sqlite: Sqlite, id: unknown): void {
  if (typeof id !== 'number') return;
  sqlite.prepare('DELETE FROM history WHERE id = ?').run(id);
}

function clearHistory(sqlite: Sqlite): void {
  sqlite.prepare('DELETE FROM history').run();
}

// 90日か5万行の上限か、より多く削る方を当てる。DB を開くごとに1回走らせ
// (index.ts の ensurePostsSynced)、append のたびには走らせない＝append の時点で DELETE を
// 走らせると、push のたびに行数に比例する走査になる
// (#145 設計 §5「掃除＝DB を開いた時に1回」)。
function pruneHistory(sqlite: Sqlite): void {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  sqlite.prepare('DELETE FROM history WHERE ts < ?').run(cutoff);
  sqlite.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY ts DESC, id DESC LIMIT ?)').run(HISTORY_MAX_ROWS);
}

function createDbWriter(sqlite: Sqlite) {
  const transaction = <T>(fn: () => T) => sqlite.transaction(fn)();
  return {
    stateGet: (key: string) => stateGet(sqlite, key),
    stateSet: (key: string, value: string) => transaction(() => stateSet(sqlite, key, value)),
    getTagTypes: () => readTagTypes(sqlite),
    setTagTypes: (types: z.input<typeof TagTypeWriteSchema>[], labels: z.input<typeof LabelsSchema>) => transaction(() => replaceTagTypes(sqlite, TagTypeWriteSchema.array().parse(types), LabelsSchema.parse(labels))),
    // #810: 下の名前をキーにする対は lib-archive.ts のもので、lib-archive.ts だけのもの。
    getTagTypeNames: () => readTagTypeNames(sqlite),
    fillTagKindsByName: (types: z.input<typeof TagTypeNamesSchema>['types'], labels: z.input<typeof LabelsSchema>) => transaction(() => fillTagKindsByName(sqlite, TagTypeNamesSchema.shape.types.parse(types), LabelsSchema.parse(labels))),
    getUngrouped: () => readUngrouped(sqlite),
    setUngrouped: (keys: z.input<typeof IdsSchema>) => transaction(() => replaceUngrouped(sqlite, IdsSchema.parse(keys))),
    getFolders: () => readFolders(sqlite),
    setFolders: (data: z.input<typeof FoldersSchema>) => transaction(() => replaceFolders(sqlite, FoldersSchema.parse(data))),
    getManualGroups: () => readManualGroups(sqlite),
    setManualGroups: (groups: z.input<typeof ManualGroupsSchema>['groups']) => transaction(() => replaceManualGroups(sqlite, ManualGroupsSchema.shape.groups.parse(groups))),
    getPosterFolders: () => readPosterFolders(sqlite),
    setPosterFolders: (data: z.input<typeof PosterFoldersSchema>) => transaction(() => replacePosterFolders(sqlite, PosterFoldersSchema.parse(data))),
    getPosterTags: () => readPosterTags(sqlite),
    getPosterTagNames: () => readPosterTagNames(sqlite),
    setPosterTags: (data: z.input<typeof PosterTagNamesSchema>) => transaction(() => replacePosterTags(sqlite, PosterTagNamesSchema.parse(data))),
    getPosterProfiles: () => readPosterProfiles(sqlite),
    setPosterProfiles: (data: z.input<typeof PosterProfilesSchema>) => transaction(() => replacePosterProfiles(sqlite, PosterProfilesSchema.parse(data))),
    getTabs: () => readTabs(sqlite),
    setTabs: (data: z.input<typeof TabsSchema>) => transaction(() => replaceTabs(sqlite, TabsSchema.parse(data))),
    appendHistory: (row: z.input<typeof HistoryEntrySchema>) => transaction(() => appendHistory(sqlite, HistoryEntrySchema.parse(row))),
    queryHistory: (opts: z.input<typeof HistoryQuerySchema>) => queryHistory(sqlite, HistoryQuerySchema.parse(opts)),
    deleteHistoryRow: (id: unknown) => transaction(() => deleteHistoryRow(sqlite, id)),
    clearHistory: () => transaction(() => clearHistory(sqlite)),
    pruneHistory: () => transaction(() => pruneHistory(sqlite)),
    setPostTags: (postId: string, tags: string[], patch: z.input<typeof TagPatchSchema> | null) => transaction(() => replacePostTags(sqlite, postId, z.array(z.string()).parse(tags), TagPatchSchema.nullable().parse(patch))),
    recordPostView: (postId: string) => transaction(() => recordPostView(sqlite, postId)),
    setMediaCrop: (postId: string, seq: number, crop: unknown) =>
      transaction(() => {
        const normalized = normalizeCropRect(crop);
        const result = sqlite.prepare('UPDATE media SET cropX=?, cropY=?, cropWidth=?, cropHeight=? WHERE postId=? AND seq=?').run(normalized?.x ?? null, normalized?.y ?? null, normalized?.width ?? null, normalized?.height ?? null, postId, seq);
        return result.changes === 1;
      }),
    getPostFlags: (postId: string) => readPostFlags(sqlite, postId),
    restorePostFlags: (postId: string, rec: unknown) => transaction(() => applyPostFlagsFromRecord(sqlite, postId, PostFlagsSchema.parse(rec))),
    deletePost: (postId: string) => transaction(() => deletePost(sqlite, postId)),
    deleteAllPosts: () => transaction(() => deleteAllPosts(sqlite)),
    // #21 のタグ語彙の層 (lib-db-tag-vocab.ts)。読み取りはトランザクションの外で走らせる
    // (better-sqlite3 の読み取りの文はトランザクションを要さない)。下の書き込みは、複数の
    // 文にまたがる仕事を lib-db-tag-vocab.ts 自身の中で包んでいる
    // (mergeTags/keepSeparateRename) ので、この層はただ受け渡すだけ。
    tagVocabOverview: () => tagVocabOverviewImpl(sqlite),
    tagParentEdges: () => tagParentEdgesImpl(sqlite),
    renameTag: (tagId: number, newName: string) => renameTagImpl(sqlite, tagId, newName),
    keepSeparateRenameTag: (tagId: number, newName: string, displayParentTagId: number) => keepSeparateRenameImpl(sqlite, tagId, newName, displayParentTagId),
    mergeTags: (sourceTagId: number, targetTagId: number, keepOldNameAsAlias?: boolean) => mergeTagsImpl(sqlite, sourceTagId, targetTagId, keepOldNameAsAlias),
    addTagParent: (tagId: number, parentTagId: number, isDisplay: boolean) => addTagParentImpl(sqlite, tagId, parentTagId, isDisplay),
    removeTagParent: (tagId: number, parentTagId: number) => removeTagParentImpl(sqlite, tagId, parentTagId),
    setTagKind: (tagId: number, kind: string | null) => setTagKindImpl(sqlite, tagId, kind),
    deleteOrphanTags: (tagIds: number[]) => deleteOrphanTagsImpl(sqlite, tagIds),
    tagSplitPreview: (tagId: number, candidateParentTagId: number) => tagSplitPreviewImpl(sqlite, tagId, candidateParentTagId),
    splitTag: (sourceTagId: number, displayParentTagId: number, postIds: string[]) => splitTagImpl(sqlite, sourceTagId, displayParentTagId, postIds),
    listTagAliases: () => listTagAliasesImpl(sqlite),
    addTagAlias: (tagId: number, alias: string) => addTagAliasImpl(sqlite, tagId, alias),
    removeTagAlias: (aliasId: number) => removeTagAliasImpl(sqlite, aliasId),
  };
}

export { createDbWriter, ensureLibraryId, LIBRARY_ID_KEY };
