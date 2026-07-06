import { ContextMenuHost } from '../context-menu/ContextMenu.tsx';
import { FilterPopoverHost } from '../filter-popover/FilterPopover.tsx';
import { KindMenuHost } from '../kind-menu/KindMenu.tsx';
import { QfPopHost } from '../qf-pop/QfPop.tsx';

// The single React root for the whole renderer — the 最終形B DoD: 島 root 群の1本統合.
// Islands migrate here from their own createRoot() calls in verifiable batches; each
// still owns only RENDERING and reads its state from a window.corpus* bridge (viewer.js
// keeps the logic/state). Container-mounted islands portal into their existing viewer-
// owned container; body-level overlays render as fixed-positioned children of this root.
// This component is the source of truth for which islands live under the unified root.
//
// Batch 1 (overlays): the four body-level popup hosts. They were each their own
// body-appended root before; now they render as siblings under this one root
// (position:fixed, so layout is viewport-relative regardless of parent). Each subscribes
// to its bridge (window.corpusContextMenu / …) internally, so nothing else changes.
export function App() {
  return (
    <>
      <ContextMenuHost />
      <KindMenuHost />
      <FilterPopoverHost />
      <QfPopHost />
    </>
  );
}
