import { useMemo, useSyncExternalStore } from 'react';
import { get, subscribe } from '../../renderer/tag-pop.ts';
import { TagEditor } from '../_shared/TagEditor.tsx';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent } from '@/components/ui/popover';

// Tag-picker pop host — ONE always-mounted instance that renders whatever
// tag-pop.ts's bridge currently holds (or nothing), now on the shadcn Popover.
// The orchestrator side owns every business rule (persistence, undo, homonym
// detection, bulk staging); this island only draws the popup. The popup has no
// trigger element (it opens programmatically beside a card's 🏷 / the
// inspector's ✎ / the selection bar's "タグを追加"), so the content anchors to
// a virtual element wrapping the bridge's anchorRect — Base UI positions and
// viewport-flips it (the old hand-rolled usePlaceTagPop is gone).
//
// Dismissal: outside-press / Escape arrive via onOpenChange; the caller's
// onDismiss decides what closing means (single: just close; bulk: also discard
// the staging list) and calls tag-pop.ts's close() itself. Presses on the
// buttons that open this same pop are exempted: their own click handlers
// already do open-or-close-if-already-open (a same-card 🏷 re-click toggles
// shut), so letting the outside-press close first would leave that handler
// reading a closed bridge and reopening — same exemption the old capture-phase
// listener carried.
const TOGGLE_BUTTONS = '.tag-btn, .poster-tag, [data-slot="inspector-tag-edit"], [data-act="tag"]';

function TagPopBody({ model }: { model: HologramTagPopModel }) {
  return (
    <>
      <TagEditor
        idPrefix="tp"
        className={null}
        showLabel={false}
        chipsClass="edit-current"
        addrowClass="edit-addrow"
        pickerClass="edit-picker"
        tags={model.tags}
        vocabGroups={model.vocabGroups}
        coocGroups={model.coocGroups}
        srcTags={model.srcTagsForPicker}
        labels={model.tagLabels}
        onAdd={model.onTagAdd}
        onRemove={model.onTagRemove}
        onToggle={model.onTagToggle}
        onContextMenu={model.onTagContextMenu}
        autoFocus
      />
      {model.mode === 'bulk' ? (
        <div className="flex items-center justify-between gap-2.5 border-t pt-2.5">
          <span className="text-xs text-muted-foreground">{model.additiveHint}</span>
          <Button size="sm" className="shrink-0" onClick={model.onApply}>
            {model.applyLabel}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function TagPopHost() {
  const model = useSyncExternalStore(subscribe, get);

  // Virtual anchor over the bridge's anchorRect (recreated whenever the model
  // changes, so a different card repositions in place without remounting the root).
  const anchor = useMemo(() => {
    if (!model) return null;
    const r = model.anchorRect;
    return { getBoundingClientRect: () => new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top) };
  }, [model]);

  if (!model) return null;
  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === 'outside-press') {
          const t = details.event.target as Element | null;
          if (t && t.closest(TOGGLE_BUTTONS)) return; // that button's own handler decides close-vs-reopen
        }
        model.onDismiss();
      }}
    >
      {/* Key the BODY on openId (bumped on open(), stable across refresh()): a fresh
          card/selection remounts the TagEditor (resets + refocuses its input) while a
          tag mutation re-renders in place — input text and picker scroll survive. */}
      <PopoverContent anchor={anchor} side="right" align="start" sideOffset={8} collisionPadding={8} className="w-80 max-h-(--available-height) overflow-y-auto">
        <TagPopBody key={model.openId} model={model} />
      </PopoverContent>
    </Popover>
  );
}
