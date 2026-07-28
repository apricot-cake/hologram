// Tag-kind (種別) menu row/action builder — extracted from the old viewer.ts
// monolith. The glass popup itself (open/close/get/subscribe) already lives in
// kind-menu.ts — this module is the view-specific glue that used to live inline in
// viewer.ts: building the work/character/general row model from the current
// 種別 state and wiring the pick/rename actions to tags.ts's mutators.
// tagKindOf/kindLabel/t are still owned by viewer.ts's own makeTags()/i18n
// wiring, so they're injected as deps — same ctx pattern as query-builder.ts.
import { open as kindMenuOpen } from './kind-menu.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { setTagKind, setKindLabel } from './tags.ts';
import { notify } from './ui.ts';

export interface KindMenuDeps {
  tagKindOf: (tag: string) => string | null;
  kindLabel: (kind: string) => string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
}

export function makeKindMenu(deps: KindMenuDeps) {
  const { tagKindOf, kindLabel, t } = deps;

  // Right-click a tag chip (edit picker / inspector / poster) to classify it
  // 作品/キャラ/一般. A tag's 種別 is the TAG's own attribute (no post is
  // touched), surfaced as a quiet 段階的開示 entry inside tag editing.
  // Rendering lives in the dedicated kind-menu React component (a
  // row's pick target and its rename button are two independent click
  // targets, which the generic ContextMenu item shape has no room for); this
  // only builds the row model and runs the pick/rename actions via
  // kind-menu.ts.
  function showKindMenu(tag: string, x: number, y: number, onChanged?: (() => void) | null) {
    const cur = tagKindOf(tag);
    // The work/character pair carries a quiet ✎ to rename the 種別 globally
    // (段階的開示: only here, in the tag-management kind menu).
    const row = (k: string, label: string) => ({ kind: k, label, dot: !!k, checked: (k || null) === cur, renameable: k === 'work' || k === 'character' });
    kindMenuOpen({
      x,
      y,
      header: t('tagKindHeader'),
      renameTitle: t('tagKindRename'),
      rows: [row('work', kindLabel('work')), row('character', kindLabel('character')), { sep: true }, row('', t('kindGeneral'))],
      async onPick(kind) {
        if ((tagKindOf(tag) || '') === kind) return; // already that kind — no write
        await setTagKind(tag, kind);
        if (onChanged) onChanged();
        notify(kind ? t('tagKindSet', [kindLabel(kind)]) : t('tagKindCleared'));
      },
      onRename(kind) {
        promptName(t('tagKindRenamePrompt'), kindLabel(kind), async (next) => {
          await setKindLabel(kind, next);
          if (onChanged) onChanged();
          notify(t('tagKindRenamed'));
        });
      },
    });
  }

  return { showKindMenu };
}
