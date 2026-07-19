import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AppShell } from '../shell/AppShell.tsx';
import { get as confirmGet, subscribe as confirmSubscribe } from '../../renderer/confirm.ts';
import { isOpen as settingsIsOpen, subscribe as settingsSubscribe } from '../../renderer/settings.ts';
import { applyTitleBar } from '../../renderer/theme-api.ts';
import { ConfirmHost } from '../confirm/Confirm.tsx';
import { ContextMenuHost } from '../context-menu/ContextMenu.tsx';
import { FolderManagerHost } from '../folders/FolderManagerModal.tsx';
import { KindMenuHost } from '../kind-menu/KindMenu.tsx';
import { LightboxHost } from '../lightbox/index.tsx';
import { SettingsHost } from '../settings/index.tsx';
import { TagPopHost } from '../tag-pop/TagPop.tsx';
import { Toaster } from '@/components/ui/sonner';
import { TooltipHost } from '../tooltip/TooltipHost.tsx';
import { onPostsChanged } from '../../renderer/posts.ts';
import { onChange as foldersOnChange } from '../../renderer/folders.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import {
  viewerReady,
  bootApp,
  handleFolderChange,
  handlePostsChanged,
  handleShortcutNavKey,
  handleShortcutMouseNav,
  handleShortcutUndoKey,
  handleShortcutSelectAllKey,
  handleShortcutCopyKey,
  handleShortcutQuickView,
  handleShortcutSearchFocusKey,
  handleShortcutSizeKey,
  handleEscDismissDetail,
  handleOutsideClickDismissDetail,
  handleTabBarKeydown,
  handleTabBarFocusout,
  handleTabBarClick,
  handleTabBarAuxclick,
  handleTabBarMousedown,
  handleTabBarContextmenu,
  handleTabBarDblclick,
  handleGlobalTabShortcut,
  handleViewStoreChange,
  handleBrowseModeStoreChange,
  handlePosterViewStoreChange,
  handleSearchQueryStoreChange,
} from '../../renderer/orchestrator.ts';

// The single React root for the whole renderer — the 最終形B DoD: 島 root 群の1本統合.
// Islands migrate here from their own createRoot() calls in verifiable batches; each still
// owns only RENDERING and reads its state from a window.corpus* bridge (orchestrator.ts keeps
// the logic/state). Container-mounted islands portal into their existing orchestrator-owned
// static container (unchanged DOM/CSS contract); body-level overlays render as fixed-
// positioned children of this root. This component is the source of truth for which
// islands live under the unified root. root.tsx gates the mount on initI18n() so t() is
// synchronous here.
//
// Batch 1 (overlays): the four body-level popup hosts.
// Batch 2 (container islands): the sidebar filter-row columns, selection bar, inspector,
//   bulk-edit overlay, and the search box — each portaled into its static container.

// Portal a subtree into an existing orchestrator-owned container by id. The containers are
// static HTML (present before app.js runs), so getElementById resolves synchronously; the
// wrapper only re-runs the lookup if the App itself re-renders (it doesn't — each child
// subscribes to its own bridge).
function Portal({ id, children }: { id: string; children: ReactNode }) {
  const el = document.getElementById(id);
  return el ? createPortal(children, el) : null;
}

// App bootstrap: the single React root (this component) is the app's one entry point,
// so it also owns triggering the initial data load — rather than orchestrator.ts self-booting
// in parallel with React's mount. Awaits viewerReady (assigned as orchestrator.ts's very
// first synchronous statement, so it's already there by the time this effect runs)
// before calling bootApp() once; bootApp itself is only assigned once orchestrator.ts has
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

// Shell-level body classes that React owns (orchestrator no longer touches document.body for
// these). browse-posters is driven by the corpusStore 'browseMode' key (orchestrator sets the
// store; the class is a pure derivation). useLayoutEffect toggles it before paint = no
// flash. (image-tab-active is owned by ImageTabHost from its model; modal-open stays in
// orchestrator — it observes overlay visibility, a cross-cutting shell concern, not drawing.)
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
// open/close site can be missed — self-contained (no orchestrator state), so this is a byte-
// faithful move of the old setupModalChrome IIFE into a React effect. The inspector
// (#postDetail) is a side panel, not a modal, so it's intentionally excluded.
function ModalChrome() {
  // Two shell concerns while a full-screen overlay is up:
  //  1. Background scroll-lock (`.modal-open` = overflow:hidden) for the LEGACY overlays that
  //     aren't Base UI (folder modal + lightbox) + the confirm AlertDialog. The shadcn
  //     Dialog/AlertDialog lock their own scroll, so settings isn't in the scroll-lock set.
  //  2. Dim the OS-drawn window-control strip in lockstep with the page scrim — the WCO can't
  //     be covered by a web backdrop, so theme-api recolors it (applyTitleBar). This set DOES
  //     include settings (it dims the page too). setBar() dedupes, so the observers firing
  //     repeatedly can't flicker the caption (that was the old "recolor flashes" bug).
  const confirmOpen = useSyncExternalStore(confirmSubscribe, () => !!confirmGet());
  const settingsOpen = useSyncExternalStore(settingsSubscribe, settingsIsOpen);
  // useLayoutEffect (not useEffect): this runs in the same commit that flips the scrim, so the
  // recolor is QUEUED off the same state change rather than a frame later. When it actually
  // reaches the OS is theme-api's business — applyTitleBar defers the IPC to just after the
  // paint so the strip can't outrun the scrim (see the comment there).
  useLayoutEffect(() => {
    const ids = ['ivFolderModal', 'lightbox'];
    const visible = (el: HTMLElement | null) => !!el && !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none';
    // NO DOM probe of the shadcn overlay here — it can only lag. The portal outlives the close
    // (card exit animation) and Base UI flips the element's data-open in its own commit, so
    // reading the element while this effect runs can still report "open" one frame after the
    // state said closed; the WCO then held its dim until the portal unmounted ~112ms later,
    // which is exactly the flicker this whole exercise is about. The scrim is now driven by the
    // same state flip (data-closed:opacity-0, see dialog.tsx), so the state IS the truth for
    // both — keep them on one source. Sheet is deliberately not tracked (its scrim fades, and a
    // snap recolor would mismatch — known gap).
    const sync = () => {
      const legacy = ids.some((id) => visible(document.getElementById(id)));
      const scrollLock = confirmOpen || legacy;
      document.documentElement.classList.toggle('modal-open', scrollLock);
      document.body.classList.toggle('modal-open', scrollLock);
      applyTitleBar(settingsOpen || confirmOpen || legacy);
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
  }, [confirmOpen, settingsOpen]);
  return null;
}

// Global keyboard/mouse shortcuts (tab-history nav, undo/redo, select-all, search
// focus, content-size step). React now owns the DOM listener registration (mounted
// once for the app's lifetime); each handler's guard + action logic is unchanged and
// stays in orchestrator.ts, imported directly as a live binding — "cut out and rewire", not
// reimplemented (Wave32/V17 continued). No boot-readiness guard needed, same reasoning
// as handleFolderChange/handlePostsChanged below: these only ever fire on a real
// keydown/mouseup, and orchestrator.ts's IIFE assigns the real functions well before a human
// (or a CDP test) can produce one.
function GlobalShortcuts() {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      handleShortcutNavKey(e);
      handleShortcutUndoKey(e);
      handleShortcutSelectAllKey(e);
      handleShortcutCopyKey(e);
      handleShortcutQuickView(e);
      handleShortcutSearchFocusKey(e);
      handleShortcutSizeKey(e);
    };
    const onMouseup = (e: MouseEvent) => handleShortcutMouseNav(e);
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
// in Wave21/V7, ahead of this wave), imported directly as a live binding, same
// "cut out and rewire" as GlobalShortcuts.
function DetailDismiss() {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => handleEscDismissDetail(e);
    const onClick = (e: MouseEvent) => handleOutsideClickDismissDetail(e);
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
// for the app's lifetime); guard + action logic is unchanged and stays in orchestrator.ts,
// imported directly as a live binding — same "cut out and rewire" as GlobalShortcuts.
// #tabBarInner is TabsHost's static portal container (present before app.js runs), so
// getElementById resolves synchronously, same as the Portal() containers below.
function TabBarEvents() {
  useEffect(() => {
    const bar = document.getElementById('tabBarInner');
    if (!bar) return;
    const onKeydown = (e: KeyboardEvent) => handleTabBarKeydown(e);
    const onFocusout = (e: FocusEvent) => handleTabBarFocusout(e);
    const onClick = (e: MouseEvent) => handleTabBarClick(e);
    const onAuxclick = (e: MouseEvent) => handleTabBarAuxclick(e);
    const onMousedown = (e: MouseEvent) => handleTabBarMousedown(e);
    const onContextmenu = (e: MouseEvent) => handleTabBarContextmenu(e);
    const onDblclick = (e: MouseEvent) => handleTabBarDblclick(e);
    const onDocKeydown = (e: KeyboardEvent) => handleGlobalTabShortcut(e);
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
// posterView / searchQuery), the search-mode toggle, shared folder changes, and the
// fs-watch posts-changed hint. React owns the subscribe() registration (mounted once
// for the app's lifetime). The store/search-mode handlers are guard+action logic that
// still lives in orchestrator.ts, imported directly as live bindings — "cut out and
// rewire", same as the other App.tsx-level effects and handleFolderChange/
// handlePostsChanged below (Wave31/V17, extended to the rest of this effect in Wave32 —
// no bridge needed once orchestrator.ts exports them as real bindings). corpusStore
// subscriptions return an unsubscribe (useSyncExternalStore-compatible) and get one on
// cleanup; corpusFolders.onChange and corpusPosts.onPostsChanged don't (subs.push / raw
// ipcRenderer.on) — harmless, since this effect never actually unmounts in this
// single-page app.
function StoreSubscriptions() {
  useEffect(() => {
    const unsubView = storeSubscribe('view', () => handleViewStoreChange());
    const unsubBrowseMode = storeSubscribe('browseMode', () => handleBrowseModeStoreChange());
    const unsubPosterView = storeSubscribe('posterView', () => handlePosterViewStoreChange());
    const unsubSearchQuery = storeSubscribe('searchQuery', () => handleSearchQueryStoreChange());
    foldersOnChange((kind) => handleFolderChange(kind));
    onPostsChanged((names) => handlePostsChanged(names));
    return () => {
      unsubView();
      unsubBrowseMode();
      unsubPosterView();
      unsubSearchQuery();
    };
  }, []);
  return null;
}

export function App() {
  return (
    <>
      {/* Triggers the app's initial data load once, on mount. */}
      <AppBoot />
      {/* Shell body classes React owns (orchestrator no longer sets them). */}
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
      {/* The React-owned app shell: tab bar + left nav + content inset + right inspector,
          with the shell-embedded islands (tabs / grids / inspector / image-tab / search /
          chips / empty / mirror) rendered in place (redesign §3, P1-2..P1-5). */}
      <AppShell />
      {/* Body-level overlays. Menus / confirm / tag-pop / toaster / tooltip self-portal onto
          document.body; the lightbox / settings / folder-modal still portal into the three
          overlay containers kept static in index.html (folded into the shell when those
          surfaces are reworked — lightbox P2⑦ / settings P2⑩ / folders P2⑧). */}
      <ContextMenuHost />
      <KindMenuHost />
      <TagPopHost />
      <ConfirmHost />
      <FolderManagerHost />
      <Portal id="lightbox">
        <LightboxHost />
      </Portal>
      <Portal id="settingsRoot">
        <SettingsHost />
      </Portal>
      {/* Toast outlet (sonner) — renderer/ui.ts notify() feeds it. */}
      <Toaster />
      {/* Legacy [data-tip] glass tooltip singleton (retired with the Tip overhaul, P3). */}
      <TooltipHost />
    </>
  );
}
