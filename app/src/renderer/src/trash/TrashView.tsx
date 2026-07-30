// ゴミ箱ビュー (#268) — the destination the left nav's trash entry opens. It uses the
// ordinary library content area (same scroll root, same cards, same quick-view peek);
// what it adds is the action row above the grid and the empty state.
//
// Why the actions live HERE and not in the toolbar band above: that band is the
// app-wide activebar, shared by every destination, and #150 is rebuilding it. A row
// scoped to this view keeps the trash's own verbs (復元 / 完全に削除 / 空にする) with
// the thing they act on and out of that rebuild's way.
//
// Card gestures are wired as real DOM listeners on #trashGrid, not React handlers:
// the cells are PORTALED into that element by TrashGrid, and a React portal's events
// bubble through the React tree (TrashGrid's parent), never through this component.
// The post grid delegates from #postGrid for the same reason.
import { MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '../_shared/i18n.ts';
import { open as menuOpen } from '../services/menu.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { clearSelection, clickCard, getSnapshot, preview, requestDeleteSelected, requestEmptyAll, restoreSelected, selectAll, subscribe } from '../services/trash-view.ts';

// The grid density is the library's own ('view'), so the trash follows whatever the
// display popover is set to — the container classes it drives are what style the
// cards at each density (post-grid-builder toggles the same three on #postGrid).
const subView = (cb: () => void) => storeSubscribe('view', cb);
const getView = () => (storeGet('view') as string | undefined) || 'card';

// The card a pointer event landed on, as the key trash-view.ts selects by (PostCard
// stamps it on data-key — the same attribute the post grid's delegation reads).
function cardKeyOf(e: Event): string | null {
  const target = e.target;
  if (!(target instanceof Element)) return null;
  const card = target.closest('.post-card');
  return card instanceof HTMLElement ? card.dataset.key || null : null;
}

export function TrashView() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const view = useSyncExternalStore(subView, getView);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const key = cardKeyOf(e);
      if (!key) return;
      clickCard(key, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    };
    // Double-click peeks at the deleted post — the one thing you want before
    // deciding whether to restore it, and the same gesture-to-peek pairing the
    // inspector thumbnail already has (#143).
    const onDblClick = (e: MouseEvent) => {
      const key = cardKeyOf(e);
      if (key) preview(key);
    };
    // A trashed card does not leave the app (#132). The post grid answers dragstart
    // by starting an OS drag of the ORIGINALS; here the gesture is only CANCELLED,
    // for two separate reasons:
    //  - it must not export. Dragging out of a trash means "restore it here" in
    //    every file manager that teaches the gesture, and a drag that hands over a
    //    path can't mean that (main refuses `.trash/` names for the same reason —
    //    library-files.ts's libraryFilePath). 復元 first, then drag.
    //  - left alone, the browser's own drag still runs and carries the card's
    //    asset:// thumbnail URL into whatever it is dropped on — an internal URL
    //    landing in someone's chat window, and nothing the user asked for.
    const onDragStart = (e: Event) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.card-img')) e.preventDefault();
    };
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, []);

  const selectedCount = snap.selected.size;
  const hasSelection = selectedCount > 0;
  const overflow = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    menuOpen({ x: r.left, y: r.bottom + 4, items: [{ label: t('trashSelectAll'), act: 'selectAll' }, { sep: true }, { label: t('trashEmptyBtn'), act: 'empty', danger: true }] }, (item) => {
      if (item.act === 'selectAll') selectAll();
      else if (item.act === 'empty') requestEmptyAll();
    });
  };

  return (
    // Hidden by the same body class that hides the other grids (index.html's mode
    // visibility block), so which destination is on screen stays ONE decision.
    <div id="trashPanel">
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
      {/* The grid's container. TrashGrid (rendered by AppShell alongside the other
          grid mounts) attaches its masonry host in here. It wears #postGrid's own
          classes so the cards are styled by the same rules at every density. */}
      <div id="trashGrid" ref={gridRef} className={`post-grid${view === 'list' ? ' list-view' : view === 'tile' ? ' tile-view' : ' masonry'}`} />
      {/* An empty trash still shows the entry in the nav (設計確定: 0件でも隠さない),
          so the "where did it go" question is answered here instead of by a missing
          row — including the 30-day rule, which is the only reason an item can leave
          without anyone pressing anything. */}
      {snap.loaded && snap.count === 0 && (
        <div className="empty-state">
          <p>
            <strong>{t('trashEmpty')}</strong>
          </p>
          <p>{t('trashEmptyDesc')}</p>
        </div>
      )}
    </div>
  );
}
