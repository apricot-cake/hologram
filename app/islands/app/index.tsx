// Single-bundle entry — side-effect imports of every React island. islands/build.mjs
// builds this one barrel into renderer/islands/app.js: ONE IIFE for all islands so
// shared code (React, masonic, react-aria-components, _shared/{VirtualGrid,TagEditor,
// i18n,tip}) is bundled ONCE instead of duplicated per island.
//
// The renderer's single React root (最終形B DoD: 島 root 群の1本統合 — COMPLETE). root.tsx
// creates ONE createRoot(#corpusAppRoot) and renders app/App.tsx, which is the source of
// truth for the island roster: every island renders under that one root (container-mounted
// ones via createPortal into their orchestrator-owned static container; body-level overlays as
// fixed children). Each island still owns only RENDERING and reads its state from a
// renderer/*.ts service module — orchestrator.ts (renderer/orchestrator.ts, renamed from
// viewer.ts — Wave33/V18) keeps the logic/state + all event delegation. Those services'
// module-evaluation-time side effects (subscriptions, initial state) happen as a side
// effect of App.tsx importing each island module; App.tsx's own
// import of orchestrator.ts's exports (bootApp etc.) triggers its module evaluation — no
// separate side-effect import needed at this barrel (see the note near root.tsx below).
//
// Migrated in verifiable batches: 1=overlays, 2=sidebar/selection-bar/inspector/edit-
// overlay/searchbox, 3a=query-chips/image-tab, 3b=tabs/lightbox, 4=settings/toolbar,
// 5=the two virtualized grids (GridMount keeps flushSync + host-attach). Dev
// (vite.config.mjs) serves this same file as a module via the island <script> rewrite
// (islands/app.js → /islands/app/index.tsx).
//
// --- renderer service layer (formerly individual <script> tags in index.html, then a
//     `corpus-svc:NAME` bare-specifier barrel here — aliased to renderer/NAME.ts by
//     build.mjs / vite.config.mjs — while each was converted one wave at a time from a
//     window-IIFE global bridge to a real named export, consumed via a plain relative
//     import; see the corpus-react-purity-execution-map memory). query/listing/format/
//     geometry/posts-data/undo/users/ui/search-editing/bulk-edit/confirm/inspector/
//     kind-menu/menu/edit-overlay/bridge/filter-popover/qf-pop/cooc/facets/about-icon/
//     searchbox/theme/records/tags/tab-state/trash/backup/posts/search/i18n/folders/
//     selection/grid/query-chips/sidebar/tabs are all real ES modules now, imported
//     directly by their consumers — no barrel entry needed, and the corpus-svc alias
//     itself is gone from build.mjs / vite.config.mjs (V18 item 7). shell.ts (below)
//     is the only entry left here, and only because it's a side-effect-only IIFE with
//     nothing to import — now a plain relative import like everything else. ---
import './root.tsx';
// The boot orchestrator (renderer/orchestrator.ts, renamed from viewer.ts — Wave33/V18,
// 2026-07-11) no longer needs a side-effect-only import here: App.tsx (rendered via
// root.tsx above) already imports its exports (bootApp etc.) directly by relative path,
// which is enough to trigger ES module evaluation — the former bare-specifier
// 'corpus-viewer-bundle' alias + @ts-ignore was a leftover from when this file was a
// plain window-IIFE with no imports/exports of its own (removed together with the
// viewer.ts→orchestrator.ts rename; see Wave33 in memory corpus-react-purity-execution-map).
// shell.ts was index.html's LAST <script> (after islands/app.js, so after viewer too) —
// kept last here to preserve that ordering. Its only load-time work is an async IIFE
// that awaits corpusIpc.getPrefs() then calls applyMode(...) (search.ts, imported
// directly by shell.ts now).
import '../../renderer/shell.ts';
