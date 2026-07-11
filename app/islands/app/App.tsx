import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ActivebarHost } from '../activebar/Activebar.tsx';
import { ConfirmHost } from '../confirm/Confirm.tsx';
import { ContextMenuHost } from '../context-menu/ContextMenu.tsx';
import { EditOverlay } from '../edit-overlay/EditOverlay.tsx';
import { EmptyState } from '../empty/EmptyState.tsx';
import { FilterPopoverHost } from '../filter-popover/FilterPopover.tsx';
import { ImageTabHost } from '../image-tab/index.tsx';
import { MirrorStatus } from '../mirror/MirrorStatus.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { KindMenuHost } from '../kind-menu/KindMenu.tsx';
import { LightboxHost } from '../lightbox/index.tsx';
import { PosterGrid } from '../posters/index.tsx';
import { QfPopHost } from '../qf-pop/QfPop.tsx';
import { PostGrid } from '../grid/index.tsx';
import { ChipsHost } from '../query-chips/index.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { SelectionBar } from '../selection-bar/SelectionBar.tsx';
import { SettingsHost } from '../settings/index.tsx';
import { PosterSidebar } from '../sidebar/PosterSidebar.tsx';
import { Sidebar } from '../sidebar/Sidebar.tsx';
import { TabsHost } from '../tabs/index.tsx';
import { Toolbar } from '../toolbar/index.tsx';
import { t } from '../_shared/i18n.ts';
import { subscribe as subscribeQfPop } from '../../renderer/qf-pop.ts';
import { applyTitleBar } from '../../renderer/theme-api.ts';
import { subscribe as subscribeSearch } from '../../renderer/search.ts';
import { onPostsChanged } from '../../renderer/posts.ts';
import { onChange as foldersOnChange } from '../../renderer/folders.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { viewerReady, bootApp, handleFolderChange, handlePostsChanged } from '../../renderer/viewer.ts';

// The single React root for the whole renderer — the 最終形B DoD: 島 root 群の1本統合.
// Islands migrate here from their own createRoot() calls in verifiable batches; each still
// owns only RENDERING and reads its state from a window.corpus* bridge (viewer.js keeps
// the logic/state). Container-mounted islands portal into their existing viewer-owned
// static container (unchanged DOM/CSS contract); body-level overlays render as fixed-
// positioned children of this root. This component is the source of truth for which
// islands live under the unified root. root.tsx gates the mount on initI18n() so t() is
// synchronous here.
//
// Batch 1 (overlays): the four body-level popup hosts.
// Batch 2 (container islands): the sidebar filter-row columns, selection bar, inspector,
//   bulk-edit overlay, and the search box — each portaled into its static container.

// Portal a subtree into an existing viewer-owned container by id. The containers are
// static HTML (present before app.js runs), so getElementById resolves synchronously; the
// wrapper only re-runs the lookup if the App itself re-renders (it doesn't — each child
// subscribes to its own bridge).
function Portal({ id, children }: { id: string; children: ReactNode }) {
  const el = document.getElementById(id);
  return el ? createPortal(children, el) : null;
}

// App bootstrap: the single React root (this component) is the app's one entry point,
// so it also owns triggering the initial data load — rather than viewer.ts self-booting
// in parallel with React's mount. Awaits viewerReady (assigned as viewer.ts's very
// first synchronous statement, so it's already there by the time this effect runs)
// before calling bootApp() once; bootApp itself is only assigned once viewer.ts has
// finished defining everything it closes over, and viewerReady only resolves after
// that assignment — so by the time the promise settles, bootApp is guaranteed to be
// the real function. No cleanup: boot runs exactly once for the app's lifetime, like
// the other App.tsx-level effects that never actually unmount in this single-page app.
function AppBoot() {
  useEffect(() => {
    viewerReady.then(() => bootApp());
  }, []);
  return null;
}

// Shell-level body classes that React owns (viewer no longer touches document.body for
// these). browse-posters is driven by the corpusStore 'browseMode' key (viewer sets the
// store; the class is a pure derivation). useLayoutEffect toggles it before paint = no
// flash. (image-tab-active is owned by ImageTabHost from its model; modal-open stays in
// viewer — it observes overlay visibility, a cross-cutting shell concern, not drawing.)
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => storeGet('browseMode') as string;
function ShellClasses() {
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  useLayoutEffect(() => {
    document.body.classList.toggle('browse-posters', mode === 'posters');
  }, [mode]);
  return null;
}

// Modal chrome: lock background scroll + darken the native titlebar while any full-
// screen overlay is up (the scrim can't cover the OS window controls or the page
// scrollbar, so they'd otherwise stay bright). Observes each overlay's visibility so no
// open/close site can be missed — self-contained (no viewer state), so this is a byte-
// faithful move of the old setupModalChrome IIFE into a React effect. The inspector
// (#postDetail) is a side panel, not a modal, so it's intentionally excluded.
function ModalChrome() {
  useEffect(() => {
    const ids = ['editOverlay', 'confirmOverlay', 'ivFolderModal', 'lightbox'];
    const visible = (el: HTMLElement | null) => !!el && !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none';
    const sync = () => {
      const open = ids.some((id) => visible(document.getElementById(id)));
      document.documentElement.classList.toggle('modal-open', open);
      document.body.classList.toggle('modal-open', open);
      applyTitleBar(open);
    };
    const observers = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el)
      .map((el) => {
        const mo = new MutationObserver(sync);
        mo.observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
        return mo;
      });
    sync();
    return () => observers.forEach((mo) => mo.disconnect());
  }, []);
  return null;
}

// Global keyboard/mouse shortcuts (tab-history nav, undo/redo, select-all, search
// focus, content-size step). React now owns the DOM listener registration (mounted
// once for the app's lifetime); each handler's guard + action logic is unchanged and
// stays in viewer.ts, reached through window.corpusViewer — "cut out and rewire", not
// reimplemented. If viewer hasn't finished booting yet, the optional chain no-ops,
// same as before this slice (the old listeners lived past viewer's own await gate too).
function GlobalShortcuts() {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const v = window.corpusViewer;
      v?.handleShortcutNavKey?.(e);
      v?.handleShortcutUndoKey?.(e);
      v?.handleShortcutSelectAllKey?.(e);
      v?.handleShortcutSearchFocusKey?.(e);
      v?.handleShortcutSizeKey?.(e);
    };
    const onMouseup = (e: MouseEvent) => window.corpusViewer?.handleShortcutMouseNav?.(e);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('mouseup', onMouseup);
    return () => {
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mouseup', onMouseup);
    };
  }, []);
  return null;
}

// Esc-priority inspector close + outside-click slide-over dismiss. Both must run in the
// CAPTURE phase (ahead of the overlays/popovers they check for) — a different phase than
// GlobalShortcuts' bubble-phase keydown, so this stays a separate effect/component rather
// than merging into it. Handler + guard logic lives in inspector-builder.ts (moved there
// in Wave21/V7, ahead of this wave), reached through window.corpusViewer, same
// "cut out and rewire" as GlobalShortcuts.
function DetailDismiss() {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => window.corpusViewer?.handleEscDismissDetail?.(e);
    const onClick = (e: MouseEvent) => window.corpusViewer?.handleOutsideClickDismissDetail?.(e);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  return null;
}

// Tab bar: rename-input commit/cancel, close/new/switch clicks, middle-click close,
// autoscroll suppression, right-click context menu, double-click rename, and the
// Ctrl+T/W/Tab document shortcuts. React owns the listener registration (mounted once
// for the app's lifetime); guard + action logic is unchanged and stays in viewer.ts,
// reached through window.corpusViewer — same "cut out and rewire" as GlobalShortcuts.
// #tabBarInner is TabsHost's static portal container (present before app.js runs), so
// getElementById resolves synchronously, same as the Portal() containers below.
function TabBarEvents() {
  useEffect(() => {
    const bar = document.getElementById('tabBarInner');
    if (!bar) return;
    const onKeydown = (e: KeyboardEvent) => window.corpusViewer?.handleTabBarKeydown?.(e);
    const onFocusout = (e: FocusEvent) => window.corpusViewer?.handleTabBarFocusout?.(e);
    const onClick = (e: MouseEvent) => window.corpusViewer?.handleTabBarClick?.(e);
    const onAuxclick = (e: MouseEvent) => window.corpusViewer?.handleTabBarAuxclick?.(e);
    const onMousedown = (e: MouseEvent) => window.corpusViewer?.handleTabBarMousedown?.(e);
    const onContextmenu = (e: MouseEvent) => window.corpusViewer?.handleTabBarContextmenu?.(e);
    const onDblclick = (e: MouseEvent) => window.corpusViewer?.handleTabBarDblclick?.(e);
    const onDocKeydown = (e: KeyboardEvent) => window.corpusViewer?.handleGlobalTabShortcut?.(e);
    bar.addEventListener('keydown', onKeydown);
    bar.addEventListener('focusout', onFocusout);
    bar.addEventListener('click', onClick);
    bar.addEventListener('auxclick', onAuxclick);
    bar.addEventListener('mousedown', onMousedown);
    bar.addEventListener('contextmenu', onContextmenu);
    bar.addEventListener('dblclick', onDblclick);
    document.addEventListener('keydown', onDocKeydown);
    return () => {
      bar.removeEventListener('keydown', onKeydown);
      bar.removeEventListener('focusout', onFocusout);
      bar.removeEventListener('click', onClick);
      bar.removeEventListener('auxclick', onAuxclick);
      bar.removeEventListener('mousedown', onMousedown);
      bar.removeEventListener('contextmenu', onContextmenu);
      bar.removeEventListener('dblclick', onDblclick);
      document.removeEventListener('keydown', onDocKeydown);
    };
  }, []);
  return null;
}

// External-store / IPC subscriptions: corpusStore keys (view / browseMode /
// posterView / searchQuery), the qf-pop close-echo, the search-mode toggle, shared
// folder changes, and the fs-watch posts-changed hint. React owns the subscribe()
// registration (mounted once for the app's lifetime). The store/qf-pop/search-mode
// handlers are guard+action logic that still lives in viewer.ts, reached through
// window.corpusViewer — "cut out and rewire", same as the other App.tsx-level
// effects. handleFolderChange/handlePostsChanged are imported directly instead
// (Wave31/V17 — no bridge needed once viewer.ts exports them as real bindings).
// corpusStore/qf-pop/search all return an unsubscribe (useSyncExternalStore-
// compatible) and get one on cleanup; corpusFolders.onChange and
// corpusPosts.onPostsChanged don't (subs.push / raw ipcRenderer.on) — harmless,
// since this effect never actually unmounts in this single-page app.
function StoreSubscriptions() {
  useEffect(() => {
    const unsubView = storeSubscribe('view', () => window.corpusViewer?.handleViewStoreChange?.());
    const unsubBrowseMode = storeSubscribe('browseMode', () => window.corpusViewer?.handleBrowseModeStoreChange?.());
    const unsubPosterView = storeSubscribe('posterView', () => window.corpusViewer?.handlePosterViewStoreChange?.());
    const unsubSearchQuery = storeSubscribe('searchQuery', () => window.corpusViewer?.handleSearchQueryStoreChange?.());
    const unsubQfPop = subscribeQfPop(() => window.corpusViewer?.handleQfPopChange?.());
    const unsubSearchMode = subscribeSearch(() => window.corpusViewer?.handleSearchModeChange?.());
    foldersOnChange((kind) => handleFolderChange(kind));
    onPostsChanged((names) => handlePostsChanged(names));
    return () => {
      unsubView();
      unsubBrowseMode();
      unsubPosterView();
      unsubSearchQuery();
      unsubQfPop();
      unsubSearchMode();
    };
  }, []);
  return null;
}

export function App() {
  return (
    <>
      {/* Triggers the app's initial data load once, on mount. */}
      <AppBoot />
      {/* Shell body classes React owns (viewer no longer sets them). */}
      <ShellClasses />
      {/* Modal chrome (body/html .modal-open + native titlebar tint) — observes the
          overlay containers below; must precede them only for readability, not order. */}
      <ModalChrome />
      {/* Global keyboard/mouse shortcuts — React owns the listener registration. */}
      <GlobalShortcuts />
      {/* Esc-priority inspector close + outside-click dismiss — capture phase. */}
      <DetailDismiss />
      {/* Tab bar event wiring (click/keydown/contextmenu/etc + Ctrl+T/W/Tab). */}
      <TabBarEvents />
      {/* External-store / IPC subscriptions (corpusStore keys, qf-pop, search mode,
          folder changes, posts-changed fs-watch hint). */}
      <StoreSubscriptions />
      {/* Body-level overlays (position:fixed, so viewport-relative regardless of parent). */}
      <ContextMenuHost />
      <KindMenuHost />
      <FilterPopoverHost />
      <QfPopHost />
      <ConfirmHost />
      {/* Container-mounted islands — portaled into their viewer-owned static containers. */}
      <Portal id="filterRows">
        <Sidebar />
      </Portal>
      <Portal id="posterFilterRows">
        <PosterSidebar />
      </Portal>
      <Portal id="selectionBar">
        <SelectionBar />
      </Portal>
      <Portal id="postDetailBox">
        <Inspector />
      </Portal>
      <Portal id="editOverlayBox">
        <EditOverlay />
      </Portal>
      {/* Query-builder active bars (post / poster) + the image-tab detail view — each
          was its own createRoot with an imperative render(model); now they store+notify
          and their hosts subscribe here. */}
      <Portal id="queryChips">
        <ChipsHost id="queryChips" />
      </Portal>
      <Portal id="posterQueryChips">
        <ChipsHost id="posterQueryChips" />
      </Portal>
      {/* Query-builder frame (nav / title / count / reset / ⓘ help) around each chips
          container — portals into static sub-mounts BESIDE the chips, so those keep
          viewer's delegated handlers. */}
      <ActivebarHost />
      <Portal id="imageTabView">
        <ImageTabHost />
      </Portal>
      {/* Tab strip + the gallery lightbox — also imperative render/open before, now
          store+subscribe. Lightbox toggles #lightbox's show/multi classes imperatively
          (that element is the portal target, not React-owned content). */}
      <Portal id="tabBarInner">
        <TabsHost />
      </Portal>
      <Portal id="lightbox">
        <LightboxHost />
      </Portal>
      <Portal id="searchWrap">
        {/* Leading magnifier icon + the react-aria ComboBox (input + suggest). */}
        <svg className="search-ico" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <SearchBox placeholder={t('searchPlaceholder')} />
      </Portal>
      {/* Toolbar controls (search mode / density / browse / section titles / sort selects)
          — Toolbar portals each into its own container. */}
      <Toolbar />
      {/* Settings modal (open/closed via window.corpusSettings; the gear in viewer opens it). */}
      <Portal id="settingsRoot">
        <SettingsHost />
      </Portal>
      {/* Empty-state placeholder (grid is empty) + the backup status rail — viewer keeps
          each container's show/hide + state derivation; these render the content. */}
      <Portal id="emptyState">
        <EmptyState />
      </Portal>
      <Portal id="mirrorStatus">
        <MirrorStatus />
      </Portal>
      {/* Virtualized grids — each renders into its OWN host div (portaled into #postGrid /
          #posterGrid) with flushSync + host-attach preserved (GridMount), because viewer
          still blanket-clears the container on the empty push. */}
      <PostGrid />
      <PosterGrid />
    </>
  );
}
