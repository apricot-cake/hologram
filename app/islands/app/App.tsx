import type { ReactNode } from 'react';
import { useLayoutEffect, useSyncExternalStore } from 'react';
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

// Shell-level body classes that React owns (viewer no longer touches document.body for
// these). browse-posters is driven by the corpusStore 'browseMode' key (viewer sets the
// store; the class is a pure derivation). useLayoutEffect toggles it before paint = no
// flash. (image-tab-active is owned by ImageTabHost from its model; modal-open stays in
// viewer — it observes overlay visibility, a cross-cutting shell concern, not drawing.)
const subBrowseMode = (cb: () => void) => window.corpusStore.subscribe('browseMode', cb);
const getBrowseMode = () => window.corpusStore.get('browseMode') as string;
function ShellClasses() {
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  useLayoutEffect(() => {
    document.body.classList.toggle('browse-posters', mode === 'posters');
  }, [mode]);
  return null;
}

export function App() {
  return (
    <>
      {/* Shell body classes React owns (viewer no longer sets them). */}
      <ShellClasses />
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
