import { useEffect } from 'react';
import { AppShell } from '../shell/AppShell.tsx';
import { ConfirmHost } from '../confirm/Confirm.tsx';
import { PaletteHost } from '../palette/CommandPalette.tsx';
import { PromptHost } from '../prompt/Prompt.tsx';
import { ContextMenuHost } from '../context-menu/ContextMenu.tsx';
import { KindMenuHost } from '../kind-menu/KindMenu.tsx';
import { LightboxHost } from '../lightbox/index.tsx';
import { CompareHost } from '../compare/index.tsx';
import { SettingsHost } from '../settings/index.tsx';
import { BulkTagDialogHost } from '../selection/BulkTagDialog.tsx';
import { TriageHost } from '../triage/index.tsx';
import { AliasPickerHost } from '../posters/AliasPicker.tsx';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { handleShortcutFullTextKey, handleShortcutPaletteKey } from '../services/command-registry.ts';
import { handleShortcutPanelsKey } from '../services/panels.ts';
import { handleShortcutZoomKey } from '../services/image-zoom.ts';
import { handleShortcutClipboardKey } from '../services/clipboard-intake.ts';
import { handleShortcutPrivacyKey } from '../services/privacy-mode.ts';
import { onPostsChanged } from '../services/posts.ts';
import { getLibraryStatus } from '../services/library-path.ts';
import { subscribePosterShape as subscribePosterDisplay, subscribeShape as subscribeDisplay } from '../services/display.ts';
import { onChange as foldersOnChange } from '../services/folders.ts';
import { set as storeSet, subscribe as storeSubscribe } from '../services/store.ts';
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
  handleDisplayStoreChange,
  handleBrowseModeStoreChange,
  handlePosterDisplayStoreChange,
  handleSearchQueryStoreChange,
} from '../services/orchestrator.ts';

// The single React root for the whole renderer — the Final shape B DoD: consolidate the
// island root group into one (i.e. the former independent island roots into one). Components used to be
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

// #37: seeds hologramStore's 'libraryMissing'/'libraryMissingPath' once on mount, so
// AppShell/LibraryMissingState know whether to show the library or explain why it is
// unreachable. A one-shot fetch, not a subscription — get-library-status is a fresh
// statSync every call and there is no push channel (see main/index.ts's
// refreshLibraryStatus comment); empty/LibraryMissingState.tsx re-fetches itself after
// Retry/repoint. Independent of AppBoot/bootApp: the DB-backed post list loads either
// way (the DB does not know or care whether the save folder exists), this effect only
// decides whether AppShell shows it.
function LibraryStatusGate() {
  useEffect(() => {
    getLibraryStatus()
      .then((status) => {
        storeSet('libraryMissing', !!(status && status.missing));
        storeSet('libraryMissingPath', (status && status.path) || null);
      })
      .catch(() => {
        /* leave the default (not missing) — the normal grid still tries to load */
      });
  }, []);
  return null;
}

// (ShellClasses lived here: it mirrored the browse mode onto <body> as .browse-posters
// for the legacy sheet to select on. Its twin .browse-trash had already gone once its
// reader started asking the store instead (P2⑬); .browse-posters' last reader was the
// legacy sheet itself, so the class went with it — P3 #6.)

// (ModalChrome lived here: while the folder modal or the confirm dialog was up it put a
// .modal-open class on <html> and <body> to lock background scroll. Nothing was ever
// unlocked by it — the page has not been scrollable since the shell became a fixed-height
// column, and body's own overflow:hidden (globals.css) propagates to the viewport. It went
// with the class it existed to write, P3 #6. Its earlier job, dimming the OS-drawn window
// strip in lockstep with the scrim, had already gone when the buttons became app-drawn.)

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
      // Ctrl/Cmd+Shift+F = the palette's full-text search mode (#29) — the design's
      // second entry point next to the palette's own footer row. Same arrangement
      // as the palette key above (guard + action live next to the state they read).
      handleShortcutFullTextKey(e);
      // Ctrl/Cmd+Shift+B = hide the sidebar and the inspector together (#245). Same
      // arrangement as the palette key above: guard + action sit next to the state in
      // services/panels.ts, and only the registration is here. Plain Ctrl+B stays with
      // SidebarProvider's own listener — the sidebar alone is its business.
      handleShortcutPanelsKey(e);
      // Ctrl/Cmd+0 = fit / Ctrl/Cmd+1 = actual size while an image view is showing
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
      // P (no modifier) = privacy mode (#88). Deliberately last and deliberately NOT
      // guarded by confirmGet()/lightboxIsOpen()/settingsIsOpen()/paletteIsOpen() the
      // way every handler above it is — see services/privacy-mode.ts's handler
      // comment for why a "hide everything right now" reflex key has to keep working
      // no matter what else is on screen.
      handleShortcutPrivacyKey(e);
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

// Selected-text right-click (#167): Copy / Search with Google / Search in library for the
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

// External-store / IPC subscriptions: hologramStore keys (both grids' display axes /
// browseMode / searchQuery), the search-mode toggle, shared folder changes, and the
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
    const unsubDisplay = subscribeDisplay(() => handleDisplayStoreChange());
    const unsubBrowseMode = storeSubscribe('browseMode', () => handleBrowseModeStoreChange());
    const unsubPosterDisplay = subscribePosterDisplay(() => handlePosterDisplayStoreChange());
    const unsubSearchQuery = storeSubscribe('searchQuery', () => handleSearchQueryStoreChange());
    foldersOnChange((kind) => handleFolderChange(kind));
    onPostsChanged(() => handlePostsChanged());
    return () => {
      unsubDisplay();
      unsubBrowseMode();
      unsubPosterDisplay();
      unsubSearchQuery();
    };
  }, []);
  return null;
}

export function App() {
  return (
    // One TooltipProvider for the whole app: every hover hint is its own Base UI
    // Tooltip now (the singleton .ui-tip host + its document-level [data-tip]
    // delegation are gone, #62), and the provider is what keeps them sharing one
    // delay and one open-at-a-time group. It has to sit above the body-level
    // overlays too — the kind menu's rename button carries a tooltip.
    <TooltipProvider delay={0}>
      {/* Triggers the app's initial data load once, on mount. */}
      <AppBoot />
      {/* #37: seeds the libraryMissing store keys once, on mount. */}
      <LibraryStatusGate />
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
      {/* Command palette (#28) — Ctrl+K. */}
      <PaletteHost />
      {/* Shared naming dialog (prompt.ts bridge) — window.prompt is unavailable in
          the Electron renderer, so naming flows go through this instead. */}
      <PromptHost />
      {/* Bulk tagging for the selection (bulk-tag.ts bridge, P2⑦) — the one tagging
          flow that stages before it writes, so it gets a Dialog rather than the
          inspector's inline field. */}
      {/* "同一人物にする" poster picker (#23 St1) — the inspector/card-menu merge flow's search dialog. */}
      <AliasPickerHost />
      <BulkTagDialogHost />
      {/* Fast triage mode (#46) — a full-screen dialog like the ones above, not part
          of the shell's content-column swap (AppShell), so it composes cleanly with
          whatever mode/tab was showing underneath when it closes. */}
      <TriageHost />
      <LightboxHost />
      <CompareHost />
      {/* Settings — a shadcn Dialog, so it portals onto document.body itself. */}
      <SettingsHost />
      {/* Toast outlet (sonner) — services/ui.ts notify() feeds it. */}
      <Toaster />
    </TooltipProvider>
  );
}
