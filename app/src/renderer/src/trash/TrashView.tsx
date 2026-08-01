// Trash view (#268) — the destination the left nav's trash entry opens. It uses the
// ordinary library content area (same scroll root, same cards, same quick-view peek);
// what it adds is the action row above the grid and the empty state.
//
// Why the actions live HERE and not in the toolbar band above: that band is the
// app-wide activebar, shared by every destination, and #150 is rebuilding it. A row
// scoped to this view keeps the trash's own verbs (restore / delete permanently / empty) with
// the thing they act on and out of that rebuild's way.
//
// Card gestures are the cells' own props now (services/grid.ts's cardActions, filled in
// by orchestrator.ts) — this view used to delegate click/dblclick/dragstart off the grid
// container and look the post up by a `data-key` attribute, which is #153 categories 1
// and 2 in one place.
import { MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { registerGridSlot } from '../services/content-area.ts';
import { open as menuOpen } from '../services/menu.ts';
import { clearSelection, getSnapshot, requestDeleteSelected, requestEmptyAll, restoreSelected, selectAll, subscribe } from '../services/trash-view.ts';

const setGridSlot = registerGridSlot('trash');

export function TrashView() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  const selectedCount = snap.selected.size;
  const hasSelection = selectedCount > 0;
  // Anchored to the ⋯ button itself, not to a rect this component measured: the menu
  // hangs under it, right-aligned, and the ui kit owns the gap and the collision flip.
  const overflow = (e: ReactMouseEvent<HTMLButtonElement>) => {
    menuOpen({ anchorEl: e.currentTarget, align: 'end', items: [{ label: t('trashSelectAll'), act: 'selectAll' }, { sep: true }, { label: t('trashEmptyBtn'), act: 'empty', danger: true }] }, (item) => {
      if (item.act === 'selectAll') selectAll();
      else if (item.act === 'empty') requestEmptyAll();
    });
  };

  return (
    // Shown/hidden by AppShell from the browse mode, like the other two destinations —
    // which one is on screen stays ONE decision, taken in React rather than by a body
    // class racing an inline style.
    <div data-slot="trash-view">
      {/* Sticky so the verbs stay reachable down a long trash. -mx-8/-mt-6 undo
          #mode-post's own padding so the row spans the content area edge to edge. */}
      <div className="sticky top-0 z-10 -mx-8 -mt-6 mb-4 flex flex-wrap items-center gap-2 border-b bg-background px-8 py-3">
        {/* Nothing when empty: the empty state below already says so, and the row
            saying it too made the same sentence appear twice on one screen. */}
        <span className="text-muted-foreground text-sm">{snap.count ? t('trashCount', [snap.count]) : ''}</span>
        <span className="flex-1" />
        {hasSelection && (
          <>
            <span className="text-sm font-medium tabular-nums">{t('selectedCount', [selectedCount])}</span>
            <Button variant="ghost" size="sm" aria-label={t('trashClearSelection')} onClick={() => clearSelection()}>
              <X />
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" disabled={!hasSelection || snap.busy} onClick={() => restoreSelected()}>
          <RotateCcw />
          {t('trashRestoreBtn')}
        </Button>
        <Button variant="destructive" size="sm" disabled={!hasSelection || snap.busy} onClick={() => requestDeleteSelected()}>
          <Trash2 />
          {t('trashDeleteBtn')}
        </Button>
        {/* Both overflow rows act on the whole trash, so the button goes dead with it. */}
        <Button variant="ghost" size="icon-sm" aria-label={t('trashMoreActions')} disabled={snap.busy || snap.count === 0} onClick={overflow}>
          <MoreHorizontal />
        </Button>
      </div>
      {/* The grid's slot. TrashGrid (rendered by AppShell alongside the other grid
          mounts) attaches its masonry host in here; the cells lay themselves out from
          the same display shape the library grid uses, so no class says which. */}
      <div ref={setGridSlot} data-slot="trash-grid" />
      {/* An empty trash still shows the entry in the nav (design decision: don't hide it even at 0 items),
          so the "where did it go" question is answered here instead of by a missing
          row — including the 30-day rule, which is the only reason an item can leave
          without anyone pressing anything. */}
      {snap.loaded && snap.count === 0 && (
        // Same anatomy as the library's own empty states (P2⑫) — icon plate, title,
        // description. No action: an empty trash is a finished state, and inventing a
        // button here would only take you somewhere the left nav already goes.
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2 />
            </EmptyMedia>
            <EmptyTitle>{t('trashEmpty')}</EmptyTitle>
            <EmptyDescription>{t('trashEmptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
