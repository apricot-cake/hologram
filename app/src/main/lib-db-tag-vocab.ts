'use strict';

// #21: 「タグを管理」の画面の裏にある、タグ語彙の読み書きの層。一覧（並び・使用数・親の
// つながり）、改名（確定した2択の衝突分岐＝統合する／表示に使う親タグを必須にして別の
// タグとして残す）、統合、親子関係の CRUD（循環を検査する）、孤児の掃除、そしてこの画面が
// 使い回している KindMenu が要る、行に限った種別の書き込み。lib-db-write.ts の古い、名前を
// キーにする replaceTagTypes ではない＝あちらのマップ丸ごとの置き換えは、2つのタグが名前を
// 共有すると片方の同名実体の種別を黙って落とす。#21 の実体はそれを起こしうる。この
// モジュールは id で1行だけ更新する。
//
// ここでの書き込みはどれも tags/tag_parents/post_tags/poster_tags のテーブルを変え、同じ
// トランザクションの中で、その変更が孤立させうるクエリの葉の tagId 参照 (folders.tree、
// tabs.state＝lib-tag-tree-sweep.ts) も掃く。順序は 2026-07-19/07-23 の設計コメントで確定
// した書き込み順に従う＝投稿の中間テーブル → 投稿者の中間テーブル → 親のつながり →
// クエリの葉 → 別名の張り替え (#86) → 実体の削除。
//
// #86（タグの別名）。下の addTagAlias/removeTagAlias/listTagAliases が tag_aliases の
// CRUD。実際に適用するときの解決（別名が書き込みを正規のタグへ向け直す）は、このモジュール
// が持っていない2つの get-or-create の解決器にある＝lib-db-write.ts の tagResolver と
// lib-db-record-writer.ts の makeTagResolver。タグの書き込み（投稿・投稿者・取り込み）が
// すでに必ず通る、確定した「単一のゲート」がそこだから。
//
// 優先順位の決定（スキーマの DDL コメントが未決として挙げていた問いを、ここで 2026-08-03
// に決めた）。別名と本物のタグ名は1つの名前空間を共有する。addTagAlias は、すでに本物の
// タグの名前になっている別名の文字列を断る (findCollision の使い回し)。
// renameTag/keepSeparateRename は、すでに他の誰かの別名として登録されている新しい名前を
// 断る (aliasCollision)。対称な防ぎなので、ある文字列があるタグの名前でありながら、同時に
// 別名としてそこから他所を指すことは決してない。この不変条件があるので、書き込み経路が
// tags テーブルより先に tag_aliases を引くのは曖昧さがなく、読み取り時に「どちらが勝つか」
// の規則を別に持つ必要がない。

import type Database from 'better-sqlite3';
import { normalizeTagName } from '../../../native-host/tag-normalize.mts';
import { sweepFoldersAndTabs } from './lib-tag-tree-sweep.ts';

type Sqlite = Database.Database;

export interface TagParentEdge {
  id: number;
  name: string;
  isDisplay: boolean;
}

export interface TagVocabRow {
  id: number;
  name: string;
  kind: string | null;
  reading: string | null;
  postCount: number;
  posterCount: number;
  parents: TagParentEdge[];
  /** name。表示に使う親タグが設定されていれば `name(displayParentName)` (2026-07-18 のコメント)。 */
  displayName: string;
  /** 他のタグの tag_parents の行がこれを指している＝消せばそのつながりが切れる。 */
  isReferencedAsParent: boolean;
  /** postCount === 0 && posterCount === 0 && !isReferencedAsParent (#315: この定義にグループの軸はもう無い)。 */
  isOrphan: boolean;
}

function countsByTag(sqlite: Sqlite, table: string): Map<number, number> {
  const sql = 'SELECT tagId, COUNT(*) AS c FROM ' + table + ' GROUP BY tagId';
  const rows = sqlite.prepare(sql).all() as Array<{ tagId: number; c: number }>;
  return new Map(rows.map((r) => [r.tagId, r.c]));
}

export function tagVocabOverview(sqlite: Sqlite): TagVocabRow[] {
  const tags = sqlite.prepare('SELECT id, name, kind, reading FROM tags ORDER BY id').all() as Array<{ id: number; name: string; kind: string | null; reading: string | null }>;
  const nameById = new Map(tags.map((t) => [t.id, t.name]));
  const postCounts = countsByTag(sqlite, 'post_tags');
  const posterCounts = countsByTag(sqlite, 'poster_tags');
  const parentRows = sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents').all() as Array<{ tagId: number; parentTagId: number; isDisplay: number }>;
  const parentsByTag = new Map<number, TagParentEdge[]>();
  const referencedAsParent = new Set<number>();
  for (const r of parentRows) {
    referencedAsParent.add(r.parentTagId);
    const list = parentsByTag.get(r.tagId) || [];
    list.push({ id: r.parentTagId, name: nameById.get(r.parentTagId) || '', isDisplay: !!r.isDisplay });
    parentsByTag.set(r.tagId, list);
  }
  return tags.map((t) => {
    const postCount = postCounts.get(t.id) || 0;
    const posterCount = posterCounts.get(t.id) || 0;
    const parents = (parentsByTag.get(t.id) || []).slice().sort((a, b) => Number(b.isDisplay) - Number(a.isDisplay) || a.name.localeCompare(b.name));
    const displayParent = parents.find((p) => p.isDisplay);
    const isReferencedAsParent = referencedAsParent.has(t.id);
    const displayName = displayParent ? t.name + '(' + displayParent.name + ')' : t.name;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      reading: t.reading,
      postCount,
      posterCount,
      parents,
      displayName,
      isReferencedAsParent,
      isOrphan: postCount === 0 && posterCount === 0 && !isReferencedAsParent,
    };
  });
}

// (tagId, parentTagId) のつながり全部を、名前まで解決したもの＝左の列の「親子関係」の
// 表示が並べる全件 (2026-07-19 のコメント: 独立した表示と、タグ1行の「親タグを設定…」を
// そのタグで絞ったものの、両方をこの1つの並びが支える)。
export interface TagParentRowResolved {
  tagId: number;
  tagName: string;
  parentTagId: number;
  parentName: string;
  isDisplay: boolean;
}
export function tagParentEdges(sqlite: Sqlite): TagParentRowResolved[] {
  const sql = 'SELECT tp.tagId AS tagId, tc.name AS tagName, tp.parentTagId AS parentTagId, tpar.name AS parentName, tp.isDisplay AS isDisplay ' + 'FROM tag_parents tp JOIN tags tc ON tc.id = tp.tagId JOIN tags tpar ON tpar.id = tp.parentTagId ' + 'ORDER BY tc.name, tpar.name';
  const rows = sqlite.prepare(sql).all() as Array<{ tagId: number; tagName: string; parentTagId: number; parentName: string; isDisplay: number }>;
  return rows.map((r) => ({ tagId: r.tagId, tagName: r.tagName, parentTagId: r.parentTagId, parentName: r.parentName, isDisplay: !!r.isDisplay }));
}

// `fromId` から既存の tag_parents のつながりを上へ辿ったとき、`targetId` に届くか。
// parentTagId（またはその祖先のどれか）がすでに tagId であるとき、つまり新しいつながりが
// 輪を閉じてしまうときに、tagId→parentTagId のつながりを断るのに使う。自分自身への
// つながり（最初の呼び出しで fromId===targetId）は、ここに来る前に呼び出し元が捕まえる。
function ancestorReaches(sqlite: Sqlite, fromId: number, targetId: number): boolean {
  const parentsOf = sqlite.prepare('SELECT parentTagId FROM tag_parents WHERE tagId = ?');
  const seen = new Set<number>();
  let frontier = [fromId];
  while (frontier.length) {
    const next: number[] = [];
    for (const id of frontier) {
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const row of parentsOf.all(id) as Array<{ parentTagId: number }>) next.push(row.parentTagId);
    }
    frontier = next;
  }
  return false;
}

/** tagId → parentTagId が循環を作るなら true（自分自身へのつながりも数える）。 */
export function wouldCreateCycle(sqlite: Sqlite, tagId: number, parentTagId: number): boolean {
  if (tagId === parentTagId) return true;
  return ancestorReaches(sqlite, parentTagId, tagId);
}

function tagExists(sqlite: Sqlite, id: number): boolean {
  return !!sqlite.prepare('SELECT 1 FROM tags WHERE id = ?').get(id);
}

// tag_parents のつながりを1つ upsert する。isDisplay を求められたら、このタグがすでに
// 持っている他の表示用の行を先に消す (idx_tag_parents_display は1つしか許さない)。文を
// 分けているのは、部分ユニーク索引が同じ tagId の isDisplay=1 の行を、一瞬たりとも2つ
// 見ることがないようにするため。
function upsertTagParent(sqlite: Sqlite, tagId: number, parentTagId: number, isDisplay: boolean) {
  if (isDisplay) sqlite.prepare('UPDATE tag_parents SET isDisplay = 0 WHERE tagId = ? AND isDisplay = 1 AND parentTagId != ?').run(tagId, parentTagId);
  sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?) ON CONFLICT(tagId, parentTagId) DO UPDATE SET isDisplay = excluded.isDisplay').run(tagId, parentTagId, isDisplay ? 1 : 0);
}

export type TagWriteResult = { ok: true } | { ok: false; error: string };

export function addTagParent(sqlite: Sqlite, tagId: number, parentTagId: number, isDisplay: boolean): TagWriteResult {
  if (!tagExists(sqlite, tagId) || !tagExists(sqlite, parentTagId)) return { ok: false, error: 'not-found' };
  if (wouldCreateCycle(sqlite, tagId, parentTagId)) return { ok: false, error: 'cycle' };
  upsertTagParent(sqlite, tagId, parentTagId, isDisplay);
  return { ok: true };
}

export function removeTagParent(sqlite: Sqlite, tagId: number, parentTagId: number): TagWriteResult {
  sqlite.prepare('DELETE FROM tag_parents WHERE tagId = ? AND parentTagId = ?').run(tagId, parentTagId);
  return { ok: true };
}

// #157 の先取り (2026-07-19 のコメント)。行に限った種別の書き込みであって、
// lib-db-write.ts の replaceTagTypes ではない（あちらは名前をキーにして、{name: kind} の
// マップから全タグの種別を丸ごと入れ直す＝2つの実体が名前を共有しうるようになった今は形が
// 合わない）。既存の種別メニューの UI を使い回していて、これはその配線にすぎない。
export function setTagKind(sqlite: Sqlite, tagId: number, kind: string | null): TagWriteResult {
  if (!tagExists(sqlite, tagId)) return { ok: false, error: 'not-found' };
  sqlite.prepare('UPDATE tags SET kind = ? WHERE id = ?').run(kind, tagId);
  return { ok: true };
}

function findCollision(sqlite: Sqlite, tagId: number, name: string): number | null {
  const row = sqlite.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(name, tagId) as { id: number } | undefined;
  return row ? row.id : null;
}

// #86: `name` がすでに（どれかのタグの）別名として登録されていれば true。addTagAlias 自身
// の名前衝突の検査が守っている、名前空間を共有するという不変条件のもう半分（冒頭コメント
// の優先順位の注記を参照）。
function aliasCollision(sqlite: Sqlite, name: string): boolean {
  return !!sqlite.prepare('SELECT 1 FROM tag_aliases WHERE alias = ?').get(name);
}

export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
export type RenameResult = { ok: true } | { ok: false; error: 'empty' | 'alias-collision' } | { ok: false; collision: RenameCollision };

// 素の改名＝衝突しない経路。衝突（他のタグ実体がまさにこの名前をすでに持っている）は、
// 適用せずに呼び出し元へ返す。決着を付けるのは呼び出し元で、mergeTags か
// keepSeparateRename を使う (2026-07-18 に確定した2択の分岐＝ID を実体とするモデルの下
// では同名の実体は正当なので、「既存の名前へ改名する」はもう自動的な誤りではない)。
export function renameTag(sqlite: Sqlite, tagId: number, newName: string): RenameResult {
  const name = normalizeTagName(newName) || newName.trim();
  if (!name) return { ok: false, error: 'empty' };
  const collisionId = findCollision(sqlite, tagId, name);
  if (collisionId != null) {
    const p = sqlite.prepare('SELECT COUNT(*) AS c FROM post_tags WHERE tagId = ?').get(collisionId) as { c: number };
    const u = sqlite.prepare('SELECT COUNT(*) AS c FROM poster_tags WHERE tagId = ?').get(collisionId) as { c: number };
    return { ok: false, collision: { tagId: collisionId, name, postCount: p.c, posterCount: u.c } };
  }
  if (aliasCollision(sqlite, name)) return { ok: false, error: 'alias-collision' };
  sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, tagId);
  return { ok: true };
}

// 「別のタグとして残す」の分岐。表示に使う親タグを必須にしたうえで、それでも改名する
// （UI は親の無い同名の対をユーザーに作らせてはいけない＝2026-07-18 のコメントの項目2）。
// 同じ名前の2つのタグが、見ただけで区別できる状態を保つため。
export function keepSeparateRename(sqlite: Sqlite, tagId: number, newName: string, displayParentTagId: number): TagWriteResult {
  const name = normalizeTagName(newName) || newName.trim();
  if (!name) return { ok: false, error: 'empty' };
  if (!displayParentTagId) return { ok: false, error: 'parent-required' };
  if (!tagExists(sqlite, displayParentTagId)) return { ok: false, error: 'not-found' };
  if (wouldCreateCycle(sqlite, tagId, displayParentTagId)) return { ok: false, error: 'cycle' };
  if (aliasCollision(sqlite, name)) return { ok: false, error: 'alias-collision' };
  const tx = sqlite.transaction(() => {
    sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, tagId);
    upsertTagParent(sqlite, tagId, displayParentTagId, true);
  });
  tx();
  return { ok: true };
}

// --- tag_aliases の CRUD (#86) ------------------------------------------------
export interface TagAliasRow {
  id: number;
  alias: string;
  tagId: number;
  canonicalName: string;
}

export function listTagAliases(sqlite: Sqlite): TagAliasRow[] {
  const sql = 'SELECT ta.id AS id, ta.alias AS alias, ta.tagId AS tagId, t.name AS canonicalName FROM tag_aliases ta JOIN tags t ON t.id = ta.tagId ORDER BY ta.alias';
  return sqlite.prepare(sql).all() as TagAliasRow[];
}

export type AddTagAliasResult = { ok: true; id: number } | { ok: false; error: 'empty' | 'not-found' | 'self' | 'name-collision' | 'conflict' };

// `aliasRaw` (NFKC と trim、#197) を tagId の別の綴りとして登録する。防ぎは順に、別名が
// 空でないテキストに解決すること、対象のタグが存在すること、別名が対象自身の現在の名前と
// 等しくないこと（自分への別名は本当の登録ではなく、何もしないのと同じ）、別名がすでに別の
// 本物のタグのちょうどその名前になっていないこと（名前空間を共有するという不変条件＝その
// 場合は、既存の実体を黙って覆い隠すのではなく mergeTags を使う）、そして別名のテキストが
// すでに登録済みなら、それが同じタグを指しているときは何度呼んでも同じ結果になり、そうで
// なければ衝突とすること（同じ別名の綴りを2つのタグが同時に主張することはできない）。
// これ以上に「循環を断る」検査は持たない。別名は1跳びでタグの id に解決する（他の別名の行を
// 経由して連鎖することは決してない）ので、上の2つの衝突の防ぎが成り立てば、多段の輪は構造
// 上できない。
//
// excludeTagId: 内部専用で、mergeTags の keepOldNameAsAlias の段が使う。そこで登録される
// テキストは、まさに元のタグ自身の（まだ削除されていない、トランザクションの途中の）名前
// で、そのままだと毎回必ず自分の行と衝突する。名前衝突の検索からそれを外すことが、あの段が
// 成功しうる唯一の理由。他の呼び出し元は（IPC のハンドラも含めて）これを渡さない。
export function addTagAlias(sqlite: Sqlite, tagId: number, aliasRaw: string, excludeTagId?: number): AddTagAliasResult {
  const alias = normalizeTagName(aliasRaw);
  if (!alias) return { ok: false, error: 'empty' };
  const tag = sqlite.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as { name: string } | undefined;
  if (!tag) return { ok: false, error: 'not-found' };
  if (alias === tag.name) return { ok: false, error: 'self' };
  if (sqlite.prepare('SELECT 1 FROM tags WHERE name = ? AND id != ?').get(alias, excludeTagId ?? -1)) return { ok: false, error: 'name-collision' };
  const existing = sqlite.prepare('SELECT id, tagId FROM tag_aliases WHERE alias = ?').get(alias) as { id: number; tagId: number } | undefined;
  if (existing) return existing.tagId === tagId ? { ok: true, id: existing.id } : { ok: false, error: 'conflict' };
  const id = Number(sqlite.prepare('INSERT INTO tag_aliases (alias, tagId) VALUES (?, ?)').run(alias, tagId).lastInsertRowid);
  return { ok: true, id };
}

export function removeTagAlias(sqlite: Sqlite, aliasId: number): TagWriteResult {
  sqlite.prepare('DELETE FROM tag_aliases WHERE id = ?').run(aliasId);
  return { ok: true };
}

// mergeTags の段5。これから削除される元を指している既存の別名は、必ず先に対象へ移す＝
// tag_aliases.tagId には ON DELETE CASCADE が付いていて、そのままだと元の行が消えた瞬間に
// 黙って落ちる（設計が求める「連鎖の平坦化」＝別名が、統合で消えた実体を経由して二度跳ぶ
// ことは決してない）。残り物（同じ別名のテキストがすでに対象を指しているもの）は、何にも
// 違反しないまま残すのではなく落とす。このテーブルは alias に UNIQUE 制約を持たないが、
// 同じことを言う行が2つある状態も、保つ価値のあるものではない。
function repointAliases(sqlite: Sqlite, sourceTagId: number, targetTagId: number): void {
  for (const row of sqlite.prepare('SELECT id, alias FROM tag_aliases WHERE tagId = ?').all(sourceTagId) as Array<{ id: number; alias: string }>) {
    const dup = sqlite.prepare('SELECT 1 FROM tag_aliases WHERE alias = ? AND tagId = ?').get(row.alias, targetTagId);
    if (dup) sqlite.prepare('DELETE FROM tag_aliases WHERE id = ?').run(row.id);
    else sqlite.prepare('UPDATE tag_aliases SET tagId = ? WHERE id = ?').run(targetTagId, row.id);
  }
}

// sourceTagId を targetTagId へ統合する。確定した書き込み順 (2026-07-19。#315 が退役させた
// グループ所属の面を落とすため 2026-07-23 に、別名の段を入れるため 2026-08-03 に更新)＝
// 投稿の中間テーブル → 投稿者の中間テーブル → 親のつながり → クエリの葉 → 別名の張り替え
// (#86) → 実体の削除。対象が元の持ち物の一部をすでに持っている場合があるので、どの段も
// 重複に強い (UPDATE OR IGNORE / ON CONFLICT)。
//
// keepOldNameAsAlias: 改名衝突のダイアログの「旧名を別名として残す」チェックボックス
// （今のところ mergeTags へは、そのダイアログの統合の分岐からしか来ない＝
// TagManagementPage.tsx に「この2つのタグを統合する」という独立した操作は無い）。true の
// とき、元の現在の名前を対象の別名として登録する。その名前は下で、どの書き込みも触る前に
// 読む＝衝突した改名が新しい名前を元の行へ適用することは決してない (renameTag を参照)。
// できる範囲で行う＝無関係な第三のタグの名前と衝突することはありうるが稀で、ユーザーが
// すでに確定した統合を失敗させるべきではない。addTagAliasImpl の結果は意図して見ない。
export function mergeTags(sqlite: Sqlite, sourceTagId: number, targetTagId: number, keepOldNameAsAlias?: boolean): TagWriteResult {
  if (sourceTagId === targetTagId) return { ok: false, error: 'self' };
  const source = sqlite.prepare('SELECT name FROM tags WHERE id = ?').get(sourceTagId) as { name: string } | undefined;
  if (!source || !tagExists(sqlite, targetTagId)) return { ok: false, error: 'not-found' };
  const tx = sqlite.transaction(() => {
    // 1. post_tags: 元の行を対象へ張り替える。対象がすでに持つ行と重なるものは落とす
    // （複合主キーの衝突 → 無視）。そのあと、まだ元を指したまま残っているものを消す。
    sqlite.prepare('UPDATE OR IGNORE post_tags SET tagId = ? WHERE tagId = ?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM post_tags WHERE tagId = ?').run(sourceTagId);
    // 2. poster_tags も同じ形。
    sqlite.prepare('UPDATE OR IGNORE poster_tags SET tagId = ? WHERE tagId = ?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM poster_tags WHERE tagId = ?').run(sourceTagId);
    // 3. 親のつながり。元が子である行は対象が子である行へ移し、元が親である行は、その子を
    // 対象へ張り替える。自分自身への輪と、新たに含意される循環は、作らずに落とす（統合の
    // 副産物であって、あらかじめ確認を取るユーザーの操作ではない＝2026-07-19 のコメントの
    // 「統合時に循環を検出する」の項目）。
    for (const row of sqlite.prepare('SELECT parentTagId, isDisplay FROM tag_parents WHERE tagId = ?').all(sourceTagId) as Array<{ parentTagId: number; isDisplay: number }>) {
      if (row.parentTagId === targetTagId) continue;
      upsertTagParent(sqlite, targetTagId, row.parentTagId, !!row.isDisplay);
    }
    for (const row of sqlite.prepare('SELECT tagId, isDisplay FROM tag_parents WHERE parentTagId = ?').all(sourceTagId) as Array<{ tagId: number; isDisplay: number }>) {
      if (row.tagId === targetTagId) continue;
      if (wouldCreateCycle(sqlite, row.tagId, targetTagId)) continue;
      upsertTagParent(sqlite, row.tagId, targetTagId, !!row.isDisplay);
    }
    sqlite.prepare('DELETE FROM tag_parents WHERE tagId = ? OR parentTagId = ?').run(sourceTagId, sourceTagId);
    // 4. クエリの葉。元に留められていた保存済み検索・タブのタグの葉は、これで全部対象を
    // 指す (folders.tree と tabs.state＝lib-tag-tree-sweep.ts)。
    sweepFoldersAndTabs(sqlite, (id) => (id === sourceTagId ? targetTagId : id));
    // 5. tag_aliases (#86)。先に張り替える (repointAliases を参照＝下の実体の削除より前に
    // 走らせるしかない。そうでないと ON DELETE CASCADE が落とす)。そのうえで、必要なら
    // 統合前の名前そのものを別名として登録する。
    repointAliases(sqlite, sourceTagId, targetTagId);
    if (keepOldNameAsAlias) addTagAlias(sqlite, targetTagId, source.name, sourceTagId);
    // 6. 元の実体そのもの。この関数が上で明示的に移して空にしたあとの残り物の行は、
    // ON DELETE CASCADE が拭き取る。
    sqlite.prepare('DELETE FROM tags WHERE id = ?').run(sourceTagId);
  });
  tx();
  return { ok: true };
}

// #777: タグ分割の振り分け画面のデータ。sourceTagId が付いた投稿ごとに1行で、サムネイルの
// ファイル（media の最初の行。動画・うごイラのエントリならポスターの静止画。落としてある
// メディアが1つも無ければ、その投稿自身のスクリーンショットを代わりに使う）と、その投稿が
// 候補の表示親タグも併せ持つかどうかを返す＝「共起する表示親タグを持つ投稿が初期選択
// される」という受け入れの線 (2026-08-02 のコメント)。呼び出し元は suggestedToNew から
// 選択の集合を仕込み、ユーザーは例外を反転させるだけで済む。
export interface TagSplitPost {
  postId: string;
  thumbFile: string | null;
  suggestedToNew: boolean;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

export function tagSplitPreview(sqlite: Sqlite, sourceTagId: number, candidateParentTagId: number): TagSplitPost[] {
  const postIds = (sqlite.prepare('SELECT postId FROM post_tags WHERE tagId = ? ORDER BY postId').all(sourceTagId) as Array<{ postId: string }>).map((r) => r.postId);
  if (!postIds.length) return [];
  const placeholders = postIds.map(() => '?').join(',');
  const mediaRows = sqlite.prepare(`SELECT postId, seq, file, posterFile FROM media WHERE postId IN (${placeholders}) ORDER BY postId, seq`).all(...postIds) as Array<{ postId: string; seq: number; file: string | null; posterFile: string | null }>;
  const firstMedia = new Map<string, { file: string | null; posterFile: string | null }>();
  for (const row of mediaRows) if (!firstMedia.has(row.postId)) firstMedia.set(row.postId, row);
  const postRows = sqlite.prepare(`SELECT captureId, image FROM posts WHERE captureId IN (${placeholders})`).all(...postIds) as Array<{ captureId: string; image: string | null }>;
  const imageByPost = new Map(postRows.map((r) => [r.captureId, r.image]));
  const coocRows = sqlite.prepare(`SELECT postId FROM post_tags WHERE tagId = ? AND postId IN (${placeholders})`).all(candidateParentTagId, ...postIds) as Array<{ postId: string }>;
  const coocSet = new Set(coocRows.map((r) => r.postId));
  return postIds.map((postId) => {
    const media = firstMedia.get(postId);
    // まず posterFile（動画・GIF・うごイラの静止画）、次にメディアのファイル自体。ただし
    // 素の動画は除く（<img src> にできない）。records.ts の artworkFile に倣い、振り分けの
    // サムネイルに要るところまで削ったもの（ここにギャラリーやライトボックスの分岐は無い）。
    let thumbFile: string | null = (media && (media.posterFile || (media.file && !VIDEO_EXT.test(media.file) ? media.file : null))) || null;
    if (!thumbFile) {
      const img = imageByPost.get(postId);
      thumbFile = img && !VIDEO_EXT.test(img) ? img : null;
    }
    return { postId, thumbFile, suggestedToNew: coocSet.has(postId) };
  });
}

export type SplitTagResult = { ok: true; newTagId: number } | { ok: false; error: string };

// mergeTags の逆。ただし面は1つ (post_tags) だけで、統合が持つ6段の並びではない。分割が
// 動かすのは、手で振り分けた投稿の部分集合だけ。poster_tags のキーは posterKey
// （アカウント）で投稿ではないから、投稿単位の振り分けが選べるものはそこに無い (#777 の
// 射程の注記＝受け入れ条件も振り分けの画面も投稿だけを見る。poster_tags は元の実体に
// 付いたまま触らない)。
//
// sourceTagId と名前（設計が言う「同名実体」）と種別（概念としては同じ実体の型。あとから
// 使い回しの種別メニューで変えられる）を共有する、新しいタグ実体を作る。それを
// displayParentTagId の下に、表示に使う親として結ぶ（できたばかりのタグは既存のつながりを
// 持たないので、addTagParent と違って循環の検査は一切要らない）。そのうえで、選ばれた
// 投稿の post_tags の行を、元から新しい id へ張り替える。
export function splitTag(sqlite: Sqlite, sourceTagId: number, displayParentTagId: number, postIdsToNew: string[]): SplitTagResult {
  if (!tagExists(sqlite, sourceTagId) || !tagExists(sqlite, displayParentTagId)) return { ok: false, error: 'not-found' };
  const ids = [...new Set(postIdsToNew.filter((id): id is string => typeof id === 'string' && !!id))];
  if (!ids.length) return { ok: false, error: 'empty-selection' };
  const source = sqlite.prepare('SELECT name, kind FROM tags WHERE id = ?').get(sourceTagId) as { name: string; kind: string | null };
  let newTagId = 0;
  const tx = sqlite.transaction(() => {
    newTagId = Number(sqlite.prepare('INSERT INTO tags (name, kind) VALUES (?, ?)').run(source.name, source.kind).lastInsertRowid);
    upsertTagParent(sqlite, newTagId, displayParentTagId, true);
    const move = sqlite.prepare('UPDATE post_tags SET tagId = ? WHERE tagId = ? AND postId = ?');
    for (const postId of ids) move.run(newTagId, sourceTagId, postId);
  });
  tx();
  return { ok: true, newTagId };
}

export interface DeleteOrphansResult {
  ok: true;
  deletedIds: number[];
}
// 孤児の掃除。渡された tagId のうち、これが走る時点でまだ孤児のものを消す（main 側で
// 確認し直す＝呼び出し元の並びは UI のスナップショットで、古くなっているかもしれない）。
// その前に、そのどれかを参照していたクエリの葉を掃く。
export function deleteOrphanTags(sqlite: Sqlite, tagIds: number[]): DeleteOrphansResult {
  const requested = new Set(tagIds.filter((id) => Number.isInteger(id)));
  if (!requested.size) return { ok: true, deletedIds: [] };
  const orphanIds = new Set(
    tagVocabOverview(sqlite)
      .filter((r) => r.isOrphan && requested.has(r.id))
      .map((r) => r.id),
  );
  const toDelete = [...orphanIds];
  if (!toDelete.length) return { ok: true, deletedIds: [] };
  const tx = sqlite.transaction(() => {
    sweepFoldersAndTabs(sqlite, (id) => (orphanIds.has(id) ? 'delete' : id));
    const del = sqlite.prepare('DELETE FROM tags WHERE id = ?');
    for (const id of toDelete) del.run(id);
  });
  tx();
  return { ok: true, deletedIds: toDelete };
}
