'use strict';

// `replaces` の印を消費する側 (#34)。「キャプチャ X を置き換える」と言っているレコードを、
// 置き換えが実際に起きる形に変える＝X のタグ・フォルダと手動グループの所属・保存してある
// 原本が新しいレコードへ移り、X のファイルは .trash/ へ行き、X の行は落ち、印は消える。
//
// そもそも印がある理由。拡張機能は Native Messaging ブリッジ越しに保存し、そこは一度
// 書いたら終わり＝ファイルを変更も削除もしない。デスクトップアプリを閉じている間に取った
// キャプチャがライブラリを壊すことは決してない、という形にするため。だから削除はアプリ
// だけの特権で、「置き換え」は動作としてではなくデータとして境界を渡るしかない。保存から
// 次にアプリが動くまでの間、2つのレコードはただ共存する。ユーザーが「コピー」と答えた
// ときにライブラリが取る状態と、これはまったく同じ。
//
// 作りからして何度実行しても同じで、だから posts-changed のたびに走らせて安全。印は古い行
// を落とすのと同じトランザクションの中で消える。このデータベースが持っていない captureId
// を指す印（すでに掃除済みのもの、あるいは別のマシンから来た印を運ぶ取込キューの再生）は、
// 何にも触らずに消える。
//
// 意図して張り替えないもの。ungrouped_keys のキーは postKey（URL から導くグループ化の
// キー）で、置き換えても投稿の URL は変わらないから、キーはすでに同じものになっている。
// 張り替えても行を自分自身へ書き直すだけになる。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）なので素の node で単体テスト
// できる。lib-db-inbox.ts に倣う。

import type Database from 'better-sqlite3';
import { postsByIds } from './lib-db-query.ts';
import { trashCapture } from './lib-trash-capture.ts';

export interface ReplacementReport {
  // この回で実施した置き換え＝古いキャプチャはゴミ箱にある。
  applied: Array<{ newId: string; oldId: string }>;
  // このデータベースが持たないものを指していた印。消しただけで、何も動かしていない。
  cleared: string[];
  failed: Array<{ newId: string; oldId: string; error: string }>;
}

// 古いレコードが持っていたもののうち、新しい方が引き継ぐべきものを全部移し、それから
// 古い行を落として印を消す。1トランザクションなので、途中で落ちれば印は立ったまま残り、
// 次の回が半分ではなく全部をやり直す。
//
// 上書きはせず、必ず和を取る。タグは新しいレコードがすでに持っているものに足し、
// userKind/tagReviewed は新しいレコードが値を持たないときだけ埋める（COALESCE）。新しい
// レコードはその投稿についてのユーザーの最も新しい言明で、古い方はその周りにユーザーが
// 整えてきたもの。
export function carryOverOrganization(sqlite: Database.Database, newId: string, oldId: string): void {
  sqlite.prepare('INSERT OR IGNORE INTO post_tags (postId, tagId) SELECT ?, tagId FROM post_tags WHERE postId = ?').run(newId, oldId);
  // posts_fts は独立している（content= のつながりを持たない＝lib-db-schema.ts）ので、
  // タグの列は写し元の中間テーブルから素の UPDATE で更新する。
  const tagsText = (sqlite.prepare('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(newId) as Array<{ name: string }>).map((r) => r.name).join(' ');
  sqlite.prepare('UPDATE posts_fts SET tagsText = ? WHERE postId = ?').run(tagsText, newId);

  const flags = sqlite.prepare('SELECT userKind, tagReviewed FROM posts WHERE captureId = ?').get(oldId) as { userKind: string | null; tagReviewed: number | null } | undefined;
  if (flags) sqlite.prepare('UPDATE posts SET userKind = COALESCE(userKind, ?), tagReviewed = COALESCE(tagReviewed, ?) WHERE captureId = ?').run(flags.userKind, flags.tagReviewed, newId);
  // #34 の設計コメントが注意している captureId 参照。置き換えが1つ取りこぼすと、
  // 「置き換えたらフォルダから消えた」という見え方になる。manual_group_items は
  // 古いメンバーの seq をそのまま持つので、グループの並び順が生き残る。
  sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) SELECT folderId, ? FROM folder_items WHERE postId = ?').run(newId, oldId);
  sqlite.prepare('INSERT OR IGNORE INTO manual_group_items (groupId, postId, seq) SELECT groupId, ?, seq FROM manual_group_items WHERE postId = ?').run(newId, oldId);
}

function carryOverAndDrop(sqlite: Database.Database, newId: string, oldId: string): void {
  sqlite.exec('BEGIN');
  try {
    carryOverOrganization(sqlite, newId, oldId);
    sqlite.prepare('UPDATE posts SET quotedPostId = ? WHERE quotedPostId = ?').run(newId, oldId);

    // FK の ON DELETE CASCADE が media/post_tags/folder_items/
    // manual_group_items を行ごと連れて行く。posts_fts は独立していて、
    // 明示的に消すしかない（lib-db-write.ts の deletePost と同じ）。
    sqlite.prepare('DELETE FROM posts_fts WHERE postId = ?').run(oldId);
    sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(oldId);
    sqlite.prepare('UPDATE posts SET replaces = NULL WHERE captureId = ?').run(newId);
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

function clearMarker(sqlite: Database.Database, newId: string): void {
  sqlite.prepare('UPDATE posts SET replaces = NULL WHERE captureId = ?').run(newId);
}

// 未処理の印を全部、古いキャプチャから順に。繰り返し呼んで安全＝印が1つも溜まって
// いなければ（圧倒的に多いのがこの場合）索引を使った走査が1回あるだけで、あとは何もない。
//
// ファイルの移動をトランザクションより前に置いているのは意図してのこと。その途中で死ぬと、
// 古い行はすでにゴミ箱にあるファイルを指したまま残る。見た目には壊れているが、印はまだ
// 立っているので次の回が仕事を終わらせる。逆の順にすると、古いキャプチャのファイルが、
// それを指す行のないままライブラリに取り残される。そうなると孤児の回収 (#301) が
// レコードを合成して、置き換えを取り消してしまう。
export async function applyPendingReplacements(opts: { sqlite: Database.Database; folder: string; trashDir: string; mediaExts: readonly string[] }): Promise<ReplacementReport> {
  const { sqlite, folder, trashDir, mediaExts } = opts;
  const report: ReplacementReport = { applied: [], cleared: [], failed: [] };
  const pending = sqlite.prepare('SELECT captureId, replaces FROM posts WHERE replaces IS NOT NULL ORDER BY captureId').all() as Array<{ captureId: string; replaces: string }>;
  if (!pending.length) return report;

  for (const { captureId: newId, replaces: oldId } of pending) {
    try {
      if (!oldId || oldId === newId || !sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get(oldId)) {
        clearMarker(sqlite, newId);
        report.cleared.push(newId);
        continue;
      }
      // 何かが動く前に読む。このレコードがゴミ箱側の JSON そのものであり、タグは
      // これから CASCADE で消えていく中間テーブルから来るため。
      const record = (await postsByIds(sqlite, [oldId]))[0] || null;
      const tags = (sqlite.prepare('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid').all(oldId) as Array<{ name: string }>).map((r) => r.name);
      await trashCapture({ folder, trashDir, mediaExts, captureId: oldId, record, flags: record ? { tags, userKind: record.userKind, tagReviewed: record.tagReviewed } : null });
      carryOverAndDrop(sqlite, newId, oldId);
      report.applied.push({ newId, oldId });
    } catch (err: any) {
      report.failed.push({ newId, oldId, error: err?.message || String(err) });
    }
  }
  return report;
}
