import { hologramIpc } from './ipc.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { open as openConfirm } from './confirm.ts';
import type { Translate } from './translation.ts';
import { open as kindMenuOpen } from './tag-group-menu.ts';
import { createTagGroup } from './tag-group-actions.ts';
import { open as openMenu } from './menu.ts';
import { setTagGroup, getTagLabels } from './tags.ts';
import { notify } from './ui.ts';

export interface TagGroupMenuDeps {
  tagGroupOf: (tagId: number | null | undefined) => string | null;
  tagGroupOfName: (tag: string) => string | null;
  /** name → tags テーブルの id。読み込み済みのすべて（投稿＋ポスタータグ）にわたって。 */
  tagIdOf: (name: string) => number | undefined;
  tagGroupLabel: (kind: string) => string;
  t: Translate;
}

export function makeTagGroupMenu(deps: TagGroupMenuDeps) {
  const { tagGroupOf, tagGroupOfName, tagIdOf, tagGroupLabel, t } = deps;
  function showTagGroupMenu(tag: string, x: number, y: number, onChanged?: (() => void) | null, entityId?: number | null) {
    const tagId = entityId != null ? entityId : (tagIdOf(tag) ?? null);
    const cur = tagId != null ? tagGroupOf(tagId) : tagGroupOfName(tag);
    const row = (k: string, label: string) => ({ kind: k, label, dot: !!k, checked: (k || null) === cur });
    const openMoveMenu = () =>
      kindMenuOpen({
        x,
        y,
        header: t('tagMoveToGroup'),
        createLabel: t('tagGroupCreate'),
        rows: [...Object.entries(getTagLabels()).map(([id, name]) => row(id, name)), { sep: true }, row('', t('kindGeneral'))],
        async onPick(kind) {
          if ((cur || '') === kind) return; // すでにその種別――書き込み不要
          if (tagId == null) {
            notify(t('tagGroupUnknown'));
            return;
          }
          try {
            await setTagGroup(tagId, kind);
          } catch {
            notify(t('tagMgmtErrorGeneric'));
            return;
          }
          if (onChanged) onChanged();
          notify(kind ? t('tagGroupSet', { name: tagGroupLabel(kind) }) : t('tagGroupCleared'));
        },
        onCreate() {
          createTagGroup(async (id) => {
            if (tagId != null) await setTagGroup(tagId, id);
            onChanged?.();
          });
        },
      });
    const reportError = () => notify(t('tagMgmtErrorGeneric'));
    openMenu(
      {
        x,
        y,
        items: [
          { label: t('tagMoveToGroup'), act: 'move', iconName: 'folder-input' },
          { label: t('tagRename'), act: 'rename', iconName: 'pencil' },
          { label: t('tagMgmtDelete'), act: 'delete', iconName: 'trash-2', danger: true },
        ],
      },
      (item) => {
        if (tagId == null) {
          notify(t('tagGroupUnknown'));
          return;
        }
        if (item.act === 'move') {
          openMoveMenu();
          return;
        }
        if (item.act === 'rename') {
          promptName(t('tagRename'), tag, async (name) => {
            try {
              const result = await hologramIpc.renameTag(tagId, name);
              if (result.ok) onChanged?.();
              else if ('collision' in result)
                openConfirm({
                  message: t('tagMgmtRenameCollisionTitle'),
                  description: t('tagMgmtRenameCollisionDesc', { ...result.collision }),
                  okLabel: t('tagMgmtMergeBtn'),
                  cancelLabel: t('tagMgmtCancel'),
                  async onOk() {
                    try {
                      const merged = await hologramIpc.mergeTags(tagId, result.collision.tagId);
                      if (merged.ok) onChanged?.();
                      else reportError();
                    } catch {
                      reportError();
                    }
                  },
                });
              else reportError();
            } catch {
              reportError();
            }
          });
        }
        if (item.act === 'delete')
          openConfirm({
            message: t('tagMgmtDeleteConfirm', { name: tag }),
            okLabel: t('tagMgmtDelete'),
            cancelLabel: t('tagMgmtCancel'),
            async onOk() {
              try {
                const result = await hologramIpc.deleteTags([tagId]);
                if (result.ok) onChanged?.();
                else reportError();
              } catch {
                reportError();
              }
            },
          });
      },
    );
  }

  return { showTagGroupMenu };
}
