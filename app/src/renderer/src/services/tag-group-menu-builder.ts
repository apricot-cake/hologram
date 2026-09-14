import type { Translate } from './translation.ts';
import { open as kindMenuOpen } from './tag-group-menu.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { setTagGroup, setTagGroupLabel, getTagLabels } from './tags.ts';
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
    const row = (k: string, label: string) => ({ kind: k, label, dot: !!k, checked: (k || null) === cur, renameable: !!k });
    kindMenuOpen({
      x,
      y,
      header: t('tagGroupHeader'),
      renameTitle: t('tagGroupRename'),
      rows: [...Object.entries(getTagLabels()).map(([id, name]) => row(id, name)), { sep: true }, row('', t('kindGeneral'))],
      async onPick(kind) {
        if ((cur || '') === kind) return; // すでにその種別――書き込み不要
        if (tagId == null) {
          notify(t('tagGroupUnknown'));
          return;
        }
        await setTagGroup(tagId, kind);
        if (onChanged) onChanged();
        notify(kind ? t('tagGroupSet', { name: tagGroupLabel(kind) }) : t('tagGroupCleared'));
      },
      onRename(kind) {
        promptName(t('tagGroupRenamePrompt'), tagGroupLabel(kind), async (next) => {
          await setTagGroupLabel(kind, next);
          if (onChanged) onChanged();
          notify(t('tagGroupRenamed'));
        });
      },
    });
  }

  return { showTagGroupMenu };
}
