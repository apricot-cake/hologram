// Tag-kind (Kind) menu row/action builder — extracted from the old viewer.ts
// monolith. The glass popup itself (open/close/get/subscribe) already lives in
// kind-menu.ts — this module is the view-specific glue that used to live inline in
// viewer.ts: building the work/character/general row model from the current
// Kind state and wiring the pick/rename actions to tags.ts's mutators.
// tagKindOf/kindLabel/t are still owned by viewer.ts's own makeTags()/i18n
// wiring, so they're injected as deps — same ctx pattern as query-builder.ts.
import { open as kindMenuOpen } from './kind-menu.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { setTagKind, setKindLabel } from './tags.ts';
import { notify } from './ui.ts';

export interface KindMenuDeps {
  tagKindOf: (tagId: number | null | undefined) => string | null;
  tagKindOfName: (tag: string) => string | null;
  /** name → the tags-table id, over everything loaded (posts + poster tags). */
  tagIdOf: (name: string) => number | undefined;
  kindLabel: (kind: string) => string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
}

export function makeKindMenu(deps: KindMenuDeps) {
  const { tagKindOf, tagKindOfName, tagIdOf, kindLabel, t } = deps;

  // Right-click a tag chip (edit picker / inspector / poster) to classify it
  // Work/Character/General. A tag's Kind is the TAG's own attribute (no post is
  // touched), surfaced as a quiet progressive-disclosure entry inside tag editing.
  // Rendering lives in the dedicated kind-menu React component (a
  // row's pick target and its rename button are two independent click
  // targets, which the generic ContextMenu item shape has no room for); this
  // only builds the row model and runs the pick/rename actions via
  // kind-menu.ts.
  // #810: a Kind hangs off one tags row, and a chip carries only a name — so the
  // caller passes the entity where its own data names one (the inspected post's
  // parallel tagIds), and everything else resolves the name against what is
  // loaded. When two entities share a name and nobody could say which chip this
  // is, the resolver's first hit is the answer; that is the same tag the write
  // path itself would pick for that name (lib-db-write.ts's tagResolver).
  function showKindMenu(tag: string, x: number, y: number, onChanged?: (() => void) | null, entityId?: number | null) {
    const tagId = entityId != null ? entityId : (tagIdOf(tag) ?? null);
    const cur = tagId != null ? tagKindOf(tagId) : tagKindOfName(tag);
    // The work/character pair carries a quiet ✎ to rename the Kind globally
    // (progressive disclosure: only here, in the tag-management kind menu).
    const row = (k: string, label: string) => ({ kind: k, label, dot: !!k, checked: (k || null) === cur, renameable: k === 'work' || k === 'character' });
    kindMenuOpen({
      x,
      y,
      header: t('tagKindHeader'),
      renameTitle: t('tagKindRename'),
      rows: [row('work', kindLabel('work')), row('character', kindLabel('character')), { sep: true }, row('', t('kindGeneral'))],
      async onPick(kind) {
        if ((cur || '') === kind) return; // already that kind — no write
        if (tagId == null) {
          notify(t('tagKindUnknown'));
          return;
        }
        await setTagKind(tagId, kind);
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
