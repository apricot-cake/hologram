'use strict';

// #21 のタグ管理ページの IPC＝語彙の一覧・改名・統合・親の辺・種別・孤児の片付けのチャンネル。
// すべて getDbWriter 経由で DB を裏に持つ（lib-db-write.ts が lib-db-tag-vocab.ts へ転送する）＝
// 書き込みの順序と、循環・衝突の規則はあちらのモジュールを参照。ほかの切り出した ipc-*.ts の
// モジュールと並んで index.ts から登録する（#228）。ここでの書き込みは成功すると必ず下の
// notifyTagVocabChanged() で終わる＝それが #815 の修正であり、このモジュールがそもそも
// resetDelta と send を必要とする理由。
import { ipcMain } from './activity-ipc.ts';
import type { IpcContext } from './ipc-context.ts';
import type { AddTagAliasResult, DeleteOrphanTagsResult, RenameTagResult, SplitTagResult, TagAliasRow, TagParentRowResolved, TagSplitPost, TagVocabRow, TagWriteResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, resetDelta, send } = ctx;

  // #815: 以下の書き込みはどれも、投稿と投稿者が実効的に持つものを変えるのに、`posts` の行に
  // 触れるものが1つも無い。この組み合わせが、このページを再起動まで動かないように見せていた。
  //
  //   - 実効の集合は読むたびに導かれ、どのテーブルにも保存されない（#774）ので、レンダラーが
  //     既に抱えているレコードは、辺が動いた瞬間に古くなる＝気づくためにディスクへ書かれたものが
  //     何も無い。
  //   - list-posts-delta は「前に見てから何が変わったか」に posts.updatedAt で答えるが、
  //     tag_parents / post_tags / tags への書き込みはそれに触れない。だから更新を求めるだけでは
  //     空の差分が返り、何も変わらない。
  //
  // だから基準を先に捨てる。捨てれば次の更新が全件の再送になり、フォルダの切り替えが取るのと
  // 同じ「どちらかの側に基準が無い」経路になる（index.ts の listPostsDelta）。それを求めるのが
  // posts-changed。
  //
  // 2本の org-changed の中継は、投稿のレコードに乗らない派生の状態を覆う。poster_tags の行は
  // #810 以降、同じ実効の配列を持つ（導出は1つ、面は2つ＝一緒に古くなり、一緒に回復しなければ
  // ならない）。種別のストアはタグの実体をキーにしていて、set-tag-kind がそれを書き、splitTag は
  // それを新しい実体へ写す。ipc-organize.ts の中継と違い、これらは送り手を含むすべてのウィンドウ
  // へ行く。このページは語彙を main 越しに編集し、どちらのストアについても先読みの複製を持たない
  // ので、自分を除くと、作業をしたウィンドウだけが古いまま取り残される。
  function notifyTagVocabChanged() {
    resetDelta();
    send('posts-changed', null);
    send('org-changed', 'poster-tags');
    send('org-changed', 'tag-types');
  }

  ipcMain.handle('get-tag-vocab', (): TagVocabRow[] => {
    return getSaveFolder() ? getDbWriter().tagVocabOverview() : [];
  });

  ipcMain.handle('get-tag-parent-edges', (): TagParentRowResolved[] => {
    return getSaveFolder() ? getDbWriter().tagParentEdges() : [];
  });

  ipcMain.handle('rename-tag', (_e, tagId, newName): RenameTagResult => {
    if (!getSaveFolder()) return { ok: false, error: 'empty' };
    try {
      const res = getDbWriter().renameTag(tagId, newName);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'empty' };
    }
  });

  ipcMain.handle('keep-separate-rename-tag', (_e, tagId, newName, displayParentTagId): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().keepSeparateRenameTag(tagId, newName, displayParentTagId);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // keepOldNameAsAlias（#86）: 改名の衝突のダイアログの "旧名を別名として残す" のチェック
  // ボックス＝lib-db-tag-vocab.ts の mergeTags の doc コメントを参照。
  ipcMain.handle('merge-tags', (_e, sourceTagId, targetTagId, keepOldNameAsAlias): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().mergeTags(sourceTagId, targetTagId, !!keepOldNameAsAlias);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('add-tag-parent', (_e, tagId, parentTagId, isDisplay): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().addTagParent(tagId, parentTagId, !!isDisplay);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('remove-tag-parent', (_e, tagId, parentTagId): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().removeTagParent(tagId, parentTagId);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // 行に閉じた種別の書き込み（lib-db-tag-vocab.ts の setTagKind）＝set-tag-types
  // （ipc-organize.ts）ではない。あのチャンネルは名前をキーにした対応表を丸ごと置き換えるので、
  // 同名の対のうち片方の実体を黙って取り違える。こちらは1つの tagId だけを更新するので、管理
  // ページが使い回す種別のメニューは実体について安全。
  ipcMain.handle('set-tag-kind', (_e, tagId, kind): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().setTagKind(tagId, kind);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('delete-orphan-tags', (_e, tagIds): DeleteOrphanTagsResult => {
    if (!getSaveFolder()) return { ok: false, deletedIds: [] };
    try {
      const res = getDbWriter().deleteOrphanTags(tagIds);
      // 孤児は定義からして投稿を持たないが、それが走らせる掃き寄せは、その孤児を名指ししていた
      // クエリの葉やフォルダの規則を落とし得る＝だから同じく読み直す。
      if (res.ok && res.deletedIds.length) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, deletedIds: [] };
    }
  });

  // #777: 分割の確認画面のデータの出所と、その確定の操作。形と、片面だけ（post_tags のみ）の
  // 書き込みについては lib-db-tag-vocab.ts の tagSplitPreview / splitTag を参照。
  ipcMain.handle('get-tag-split-preview', (_e, tagId, candidateParentTagId): TagSplitPost[] => {
    if (!getSaveFolder()) return [];
    try {
      return getDbWriter().tagSplitPreview(tagId, candidateParentTagId);
    } catch {
      return [];
    }
  });

  ipcMain.handle('split-tag', (_e, sourceTagId, displayParentTagId, postIds): SplitTagResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().splitTag(sourceTagId, displayParentTagId, postIds);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // #86: tag_aliases の CRUD＝ここがただ転送するだけの、衝突と循環の番人については
  // lib-db-tag-vocab.ts の addTagAlias を参照。
  ipcMain.handle('get-tag-aliases', (): TagAliasRow[] => {
    return getSaveFolder() ? getDbWriter().listTagAliases() : [];
  });

  ipcMain.handle('add-tag-alias', (_e, tagId, alias): AddTagAliasResult => {
    if (!getSaveFolder()) return { ok: false, error: 'empty' };
    try {
      const res = getDbWriter().addTagAlias(tagId, alias);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'empty' };
    }
  });

  ipcMain.handle('remove-tag-alias', (_e, aliasId): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().removeTagAlias(aliasId);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });
}

export { register };
