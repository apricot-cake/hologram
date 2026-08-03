'use strict';

// #21 tag management page IPC — the vocabulary overview/rename/merge/parent-edge/
// kind/orphan-cleanup channels. All DB-backed via getDbWriter (lib-db-write.ts,
// which forwards to lib-db-tag-vocab.ts) — see that module for the write-order
// and cycle/collision rules. Registered from index.ts alongside the other
// extracted ipc-*.ts modules (#228). Every successful write here ends in
// notifyTagVocabChanged() below — the #815 fix, and the reason this module needs
// resetDelta/send at all.
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { AddTagAliasResult, DeleteOrphanTagsResult, RenameTagResult, SplitTagResult, TagAliasRow, TagParentRowResolved, TagSplitPost, TagVocabRow, TagWriteResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, resetDelta, send } = ctx;

  // #815: every write below changes what posts and posters EFFECTIVELY carry,
  // and not one of them touches a `posts` row. That combination is what made
  // this page look inert until a restart:
  //
  //   - the effective set is derived on every read and stored in no table
  //     (#774), so the records the renderer is already holding go stale the
  //     moment an edge moves — nothing in them was written to disk to notice;
  //   - list-posts-delta answers "what changed since you last looked" from
  //     posts.updatedAt, which a tag_parents / post_tags / tags write leaves
  //     untouched. Asking for a refresh alone would therefore hand back an
  //     EMPTY delta and change nothing.
  //
  // So the baseline has to go first: dropping it makes the next refresh a full
  // resend, the same "either side lacks a baseline" path a folder switch takes
  // (index.ts's listPostsDelta). posts-changed is then what asks for it.
  //
  // The two org-changed relays cover the derived state that does NOT ride on
  // post records: poster_tags rows carry the same effective arrays since #810
  // (one derivation, two faces — they have to go stale and recover together),
  // and the kind store is keyed by tag entity, which set-tag-kind writes and
  // splitTag copies onto a brand-new one. Unlike ipc-organize.ts's relays these
  // go to EVERY window including the sender: this page edits the vocabulary
  // through main and keeps no optimistic copy of either store, so excluding
  // itself would leave the window that did the work as the only stale one.
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
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof newName !== 'string') return { ok: false, error: 'empty' };
    try {
      const res = getDbWriter().renameTag(tagId, newName);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'empty' };
    }
  });

  ipcMain.handle('keep-separate-rename-tag', (_e, tagId, newName, displayParentTagId): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof newName !== 'string' || typeof displayParentTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().keepSeparateRenameTag(tagId, newName, displayParentTagId);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // keepOldNameAsAlias (#86): the rename-collision dialog's "旧名を別名として
  // 残す" checkbox -- see lib-db-tag-vocab.ts's mergeTags doc comment.
  ipcMain.handle('merge-tags', (_e, sourceTagId, targetTagId, keepOldNameAsAlias): TagWriteResult => {
    if (!getSaveFolder() || typeof sourceTagId !== 'number' || typeof targetTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().mergeTags(sourceTagId, targetTagId, !!keepOldNameAsAlias);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('add-tag-parent', (_e, tagId, parentTagId, isDisplay): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof parentTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().addTagParent(tagId, parentTagId, !!isDisplay);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('remove-tag-parent', (_e, tagId, parentTagId): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof parentTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().removeTagParent(tagId, parentTagId);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // Row-scoped kind write (lib-db-tag-vocab.ts's setTagKind) — NOT set-tag-types
  // (ipc-organize.ts): that channel replaces the whole name-keyed map and would
  // silently mis-target one entity of a same-name pair. This one updates a
  // single tagId, so the management page's reused kind-menu is entity-safe.
  ipcMain.handle('set-tag-kind', (_e, tagId, kind): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().setTagKind(tagId, typeof kind === 'string' ? kind : null);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('delete-orphan-tags', (_e, tagIds): DeleteOrphanTagsResult => {
    if (!getSaveFolder() || !Array.isArray(tagIds)) return { ok: false, deletedIds: [] };
    try {
      const res = getDbWriter().deleteOrphanTags(tagIds.filter((id: unknown): id is number => typeof id === 'number'));
      // An orphan carries no post by definition, but the sweep it runs can drop
      // query leaves and folder rules that named one — so the same re-read.
      if (res.ok && res.deletedIds.length) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, deletedIds: [] };
    }
  });

  // #777: the split-review screen's data source and its confirm action. See
  // lib-db-tag-vocab.ts's tagSplitPreview/splitTag for the shape and the
  // one-face (post_tags only) write.
  ipcMain.handle('get-tag-split-preview', (_e, tagId, candidateParentTagId): TagSplitPost[] => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof candidateParentTagId !== 'number') return [];
    try {
      return getDbWriter().tagSplitPreview(tagId, candidateParentTagId);
    } catch {
      return [];
    }
  });

  ipcMain.handle('split-tag', (_e, sourceTagId, displayParentTagId, postIds): SplitTagResult => {
    if (!getSaveFolder() || typeof sourceTagId !== 'number' || typeof displayParentTagId !== 'number' || !Array.isArray(postIds)) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().splitTag(
        sourceTagId,
        displayParentTagId,
        postIds.filter((id: unknown): id is string => typeof id === 'string'),
      );
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // #86: tag_aliases CRUD -- see lib-db-tag-vocab.ts's addTagAlias for the
  // collision/cycle guards this just forwards to.
  ipcMain.handle('get-tag-aliases', (): TagAliasRow[] => {
    return getSaveFolder() ? getDbWriter().listTagAliases() : [];
  });

  ipcMain.handle('add-tag-alias', (_e, tagId, alias): AddTagAliasResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof alias !== 'string') return { ok: false, error: 'empty' };
    try {
      const res = getDbWriter().addTagAlias(tagId, alias);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'empty' };
    }
  });

  ipcMain.handle('remove-tag-alias', (_e, aliasId): TagWriteResult => {
    if (!getSaveFolder() || typeof aliasId !== 'number') return { ok: false, error: 'invalid' };
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
