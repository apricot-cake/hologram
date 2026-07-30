import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { AppShell } from '../shell/AppShell.tsx';
import { get as confirmGet, subscribe as confirmSubscribe } from '../services/confirm.ts';
import { isOpen as lightboxIsOpen, subscribe as lightboxSubscribe } from '../services/lightbox.ts';
import { ConfirmHost } from '../confirm/Confirm.tsx';
import { PaletteHost } from '../palette/CommandPalette.tsx';
import { PromptHost } from '../prompt/Prompt.tsx';
import { ContextMenuHost } from '../context-menu/ContextMenu.tsx';
import { FolderManagerHost } from '../folders/FolderManagerModal.tsx';
import { KindMenuHost } from '../kind-menu/KindMenu.tsx';
import { LightboxHost } from '../lightbox/index.tsx';
import { SettingsHost } from '../settings/index.tsx';
import { BulkTagDialogHost } from '../selection/BulkTagDialog.tsx';
import { Toaster } from '@/components/ui/sonner';
import { TooltipHost } from '../tooltip/TooltipHost.tsx';
import { handleShortcutPaletteKey } from '../services/command-registry.ts';
import { handleShortcutPanelsKey } from '../services/panels.ts';
import { handleShortcutZoomKey } from '../services/image-zoom.ts';
import { handleShortcutClipboardKey } from '../services/clipboard-intake.ts';
import { onPostsChanged } from '../services/posts.ts';
import { isManagerOpen as folderManagerIsOpen, onChange as foldersOnChange, subscribeManager as subscribeFolderManager } from '../services/folders.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
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
  handleShortcutArrowNav,
  handleShortcutSearchFocusKey,
  handleShortcutSizeKey,
  handleZoomWheel,
  handleEscDismissDetail,
  handleOutsideClickDismissDetail,
  handleGlobalTabShortcut,
  handleSelectionContextmenu,
  handleViewStoreChange,
  handleBrowseModeStoreChange,
  handlePosterViewStoreChange,
  handleSearchQueryStoreChange,
} from '../services/orchestrator.ts';

// The single React root for the whole renderer — the 最終形B DoD: 島 root 群の1本統合
// (consolidation of the former independent island roots into one). Components used to be
// their own createRoot() calls; they were migrated here in verifiable batches, and each still
// owns only RENDERING and reads its state from a service module (orchestrator.ts keeps the
// logic/state). This component is the source of truth for which components live under the
// unified root. root.tsx gates the mount on initI18n() so t() is synchronous here.
//
// Since #621 there is nothing left to portal into: index.html is the root mount point and
// nothing else (redesign §0-0⑥), so every overlay below either renders in place as a
// fixed-positioned child of this root, or portals onto document.body from its own component
// (the Base UI ones).

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
// these). browse-posters is driven by the hologramStore 'browseMode' key (orchestrator sets the
// store; the class is a pure derivation). useLayoutEffect toggles it before paint = no
// flash. (image-tab-active is owned by ImageTabHost from its model; modal-open stays in
// orchestrator — it observes overlay visibility, a cross-cutting shell concern, not drawing.)
const subBrowseMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getBrowseMode = () => storeGet('browseMode') as string;
function ShellClasses() {
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  useLayoutEffect(() => {
    document.body.classList.toggle('browse-posters', mode === 'posters');
    // browse-trash is the third destination (#268) — same mechanism, so the
    // question "which of the three is on screen" keeps ONE answer.
    document.body.classList.toggle('browse-trash', mode === 'trash');
  }, [mode]);
  return null;
}

// Modal chrome: lock background scroll while any full-screen overlay is up. Observes each
// overlay's visibility so no open/close site can be missed — self-contained (no orchestrator
// state). The inspector is a side panel, not a modal, so it's excluded.
//
// This used to also dim the OS-drawn window-control strip in lockstep with the scrim, because
// a web backdrop cannot cover an OS-painted overlay. The buttons are app-drawn now
// (shell/WindowControls.tsx), so the scrim covers them on its own and that whole mechanism —
// the recolor, the dedupe, the paint-timing deferral — is gone.
function ModalChrome() {
  // Scroll-lock (`.modal-open` = overflow:hidden) is for the overlays that aren't Base UI:
  // the folder-management modal, the confirm AlertDialog and the quick-view peek. The
  // shadcn Dialog/AlertDialog lock their own scroll, so settings isn't in this set.
  //
  // All three are plain subscriptions now (#621): the folder modal used to be a static
  // element whose `hidden` attribute this watched with a MutationObserver, which is
  // exactly the DOM-sniffed open state #153 rules out. It is conditionally rendered and
  // asked through folders.ts like the other two.
  const confirmOpen = useSyncExternalStore(confirmSubscribe, () => !!confirmGet());
  const peekOpen = useSyncExternalStore(lightboxSubscribe, lightboxIsOpen);
  const folderManagerOpen = useSyncExternalStore(subscribeFolderManager, folderManagerIsOpen);
  const scrollLock = confirmOpen || peekOpen || folderManagerOpen;
  useEffect(() => {
    document.documentElement.classList.toggle('modal-open', scrollLock);
    document.body.classList.toggle('modal-open', scrollLock);
  }, [scrollLock]);
  return null;
}

// Global keyboard/mouse shortcuts (tab-history nav, undo/redo, select-all, search
// focus, content-size step). React now owns the DOM listener registration (mounted
// once for the app's lifetime); each handler's guard + action logic is unchanged and
// stays in orchestrator.ts, imported directly as a live binding — "cut out and rewire", not
// reimplemented. No boot-readiness guard needed, same reasoning
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
      handleShortcutArrowNav(e);
      handleShortcutSearchFocusKey(e);
      handleShortcutSizeKey(e);
      // Ctrl/Cmd+K = the command palette (#28). `/` keeps the search-box focus, and
      // this one comes straight off the registry — no orchestrator binding, because
      // opening the palette is pure UI state (guard + action live in
      // services/command-registry.ts, next to the state they read).
      handleShortcutPaletteKey(e);
      // Ctrl/Cmd+Shift+B = hide the sidebar and the inspector together (#245). Same
      // arrangement as the palette key above: guard + action sit next to the state in
      // services/panels.ts, and only the registration is here. Plain Ctrl+B stays with
      // SidebarProvider's own listener — the sidebar alone is its business.
      handleShortcutPanelsKey(e);
      // Ctrl/Cmd+0 = フィット / Ctrl/Cmd+1 = 原寸 while an image view is showing
      // (#150). Same arrangement again: the guard is that a zoomable slide has
      // registered a controller, which only services/image-zoom.ts can know.
      handleShortcutZoomKey(e);
      // Ctrl/Cmd+V = import the clipboard's image (#85). Same arrangement again:
      // only the registration is here. Its guard is the strictest of the set,
      // because this is the ONE shortcut whose key already means something
      // everywhere else — see services/clipboard-intake.ts.
      handleShortcutClipboardKey(e);
      // Ctrl+T / Ctrl+W / Ctrl+Tab — the tab shortcuts act on the window, not on a
      // tab you are pointing at, so they belong here rather than on the strip (#621).
      handleGlobalTabShortcut(e);
    };
    const onMouseup = (e: MouseEvent) => handleShortcutMouseNav(e);
    // Ctrl+wheel = content size (#141). Non-passive on purpose: the handler
    // preventDefaults to keep Chromium's page zoom out of the grid.
    const onWheel = (e: WheelEvent) => handleZoomWheel(e);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('mouseup', onMouseup);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mouseup', onMouseup);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);
  return null;
}

// Esc-priority dismiss for the image-tab detail view. Must run in the CAPTURE phase (ahead
// of the overlays/popovers it checks for) — a different phase than GlobalShortcuts'
// bubble-phase keydown, so this stays a separate effect/component rather than merging into
// it. Handler + guard logic lives in inspector-builder.ts (moved there when that module was
// extracted out of orchestrator.ts), imported directly as a live binding, same "cut out and
// rewire" as GlobalShortcuts.
//
// The outside-click listener shares this effect again (#259): the inspector has a
// slide-over form once more at narrow widths, and waving it away with a click on the
// grid is the whole point of that form. The handler no-ops at wide widths on its own.
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

// Selected-text right-click (#167): コピー / Googleで検索 / ライブラリ内検索 for the
// surfaces that have no context menu of their own — the inspector's body and
// metadata, chiefly. Electron ships no default menu and the window runs
// removeMenu(), so without this a right-click there hits nothing at all.
//
// document, BUBBLE phase, deliberately: every surface that DOES own a menu
// (cards / posters / tabs / folders / tag chips) preventDefault()s its own
// contextmenu first, and the handler bails on defaultPrevented. That keeps this
// a fallback with no list of surfaces to maintain — and leaves "no selection →
// no menu" exactly as it was. Same no-boot-guard reasoning as GlobalShortcuts:
// it only fires on a real right-click.
function SelectionContextMenu() {
  useEffect(() => {
    const onContextmenu = (e: MouseEvent) => handleSelectionContextmenu(e);
    document.addEventListener('contextmenu', onContextmenu);
    return () => document.removeEventListener('contextmenu', onContextmenu);
  }, []);
  return null;
}

// External-store / IPC subscriptions: hologramStore keys (view / browseMode /
// posterView / searchQuery), the search-mode toggle, shared folder changes, and the
// fs-watch posts-changed hint. React owns the subscribe() registration (mounted once
// for the app's lifetime). The store/search-mode handlers are guard+action logic that
// still lives in orchestrator.ts, imported directly as live bindings — "cut out and
// rewire", same as the other App.tsx-level effects and handleFolderChange/
// handlePostsChanged below — no bridge is needed once orchestrator.ts exports them as
// real bindings. hologramStore
// subscriptions return an unsubscribe (useSyncExternalStore-compatible) and get one on
// cleanup; hologramFolders.onChange and hologramPosts.onPostsChanged don't (subs.push / raw
// ipcRenderer.on) — harmless, since this effect never actually unmounts in this
// single-page app.
function StoreSubscriptions() {
  useEffect(() => {
    const unsubView = storeSubscribe('view', () => handleViewStoreChange());
    const unsubBrowseMode = storeSubscribe('browseMode', () => handleBrowseModeStoreChange());
    const unsubPosterView = storeSubscribe('posterView', () => handlePosterViewStoreChange());
    const unsubSearchQuery = storeSubscribe('searchQuery', () => handleSearchQueryStoreChange());
    foldersOnChange((kind) => handleFolderChange(kind));
    onPostsChanged(() => handlePostsChanged());
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
      {/* Right-click on selected text where no other menu claims the click (#167). */}
      <SelectionContextMenu />
      {/* External-store / IPC subscriptions (hologramStore keys, qf-pop, search mode,
          folder changes, posts-changed fs-watch hint). */}
      <StoreSubscriptions />
      {/* The React-owned app shell: tab bar + left nav + content inset + right inspector,
          with the shell-embedded components (tabs / grids / inspector / image-tab / search /
          chips / empty / mirror) rendered in place (redesign §3, P1-2..P1-5). */}
      <AppShell />
      {/* Body-level overlays. Menus / confirm / dialogs / toaster / tooltip / quick-view peek
          self-portal onto document.body; the folder modal is a fixed-positioned child of this
          root. Neither needs a static container in index.html any more (#621). */}
      <ContextMenuHost />
      <KindMenuHost />
      <ConfirmHost />
      {/* Command palette (#28) — Ctrl+K. A shadcn Dialog, so it locks its own scroll
          and needs no ModalChrome entry, same as PromptHost. */}
      <PaletteHost />
      {/* Shared naming dialog (prompt.ts bridge) — window.prompt is unavailable in
          the Electron renderer, so naming flows go through this instead. A shadcn
          Dialog, so it locks its own scroll and needs no ModalChrome entry. */}
      <PromptHost />
      {/* Bulk tagging for the selection (bulk-tag.ts bridge, P2⑦) — the one tagging
          flow that stages before it writes, so it gets a Dialog rather than the
          inspector's inline field. */}
      <BulkTagDialogHost />
      <FolderManagerHost />
      <LightboxHost />
      {/* 設定 — a shadcn Dialog, so it portals onto document.body itself. */}
      <SettingsHost />
      {/* Toast outlet (sonner) — services/ui.ts notify() feeds it. */}
      <Toaster />
      {/* Legacy [data-tip] glass tooltip singleton (retired with the Tip overhaul, P3). */}
      <TooltipHost />
    </>
  );
}
