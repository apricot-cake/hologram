// Single-bundle entry — side-effect imports of every React island. islands/build.mjs
// builds this one barrel into renderer/islands/app.js: ONE IIFE for all islands so
// shared code (masonic, react-aria-components, _shared/{VirtualGrid,TagEditor,i18n,tip})
// is bundled ONCE instead of duplicated per island. React stays externalized to
// vendor-react.js.
//
// The renderer's single React root (最終形B DoD: 島 root 群の1本統合 — COMPLETE). root.tsx
// creates ONE createRoot(#corpusAppRoot) and renders app/App.tsx, which is the source of
// truth for the island roster: every island renders under that one root (container-mounted
// ones via createPortal into their orchestrator-owned static container; body-level overlays as
// fixed children). Each island still owns only RENDERING and reads its state from a
// window.corpus* bridge — orchestrator.ts (renderer/orchestrator.ts, renamed from viewer.ts
// — Wave33/V18) keeps the logic/state + all event delegation. The window.corpus* bridge
// assignments happen as a side effect of App.tsx importing each island module; App.tsx's own
// import of orchestrator.ts's exports (bootApp etc.) triggers its module evaluation — no
// separate side-effect import needed at this barrel (see the note near root.tsx below).
//
// Migrated in verifiable batches: 1=overlays, 2=sidebar/selection-bar/inspector/edit-
// overlay/searchbox, 3a=query-chips/image-tab, 3b=tabs/lightbox, 4=settings/toolbar,
// 5=the two virtualized grids (GridMount keeps flushSync + host-attach). Dev
// (vite.config.mjs) serves this same file as a module via the island <script> rewrite
// (islands/app.js → /islands/app/index.tsx).
//
// --- renderer service layer (formerly individual <script> tags in index.html; folded
//     into this one bundle so they compile through Vite → .ts). Each is a window-IIFE
//     assigning window.corpusX; orchestrator.ts + islands read those globals (the bridge
//     dissolution is P4). Imported via `corpus-svc:NAME` bare specifiers (aliased to
//     renderer/NAME.ts by build.mjs / vite.config.mjs). Originally this also kept the
//     service layer out of the strict islands tsc program (a separate, looser
//     tsconfig.renderer.json type-checked it); as of 2026-07-09 both are merged into one
//     strict tsconfig.json project, so that reason is gone — the bare specifiers remain
//     only because these are still window-global side-effect imports, not real ES module
//     imports (see 「window.corpusXxx → export/import」 in the backlog memory for the
//     pending conversion — query.ts and listing.ts are the first two converted, so
//     they're no longer listed here: they're real ES modules now, pulled in by a plain
//     relative import wherever a consumer (orchestrator.ts / query-chips.ts / sidebar.ts /
//     tabs.ts) needs them, with no side-effect-only import required at this barrel).
//     Order mirrors the old index.html scripts; these precede root.tsx (islands read the
//     globals at render). Wave 1 = the logic services. ---
// Wave 2 = the remaining infra bridge. ipc/store/bridge/menu/kind-menu/inspector/
// edit-overlay/confirm/search/backup/posts/i18n/grid/selection/records/tags/
// tab-state/trash/image-tab are real ES modules now, imported directly by their
// consumers (no barrel entry needed) — shell.ts (below) is the only entry left
// here, and only because it's a side-effect-only IIFE with nothing to import.
import './root.tsx';
// The boot orchestrator (renderer/orchestrator.ts, renamed from viewer.ts — Wave33/V18,
// 2026-07-11) no longer needs a side-effect-only import here: App.tsx (rendered via
// root.tsx above) already imports its exports (bootApp etc.) directly by relative path,
// which is enough to trigger ES module evaluation — the former bare-specifier
// 'corpus-viewer-bundle' alias + @ts-ignore was a leftover from when this file was a
// plain window-IIFE with no imports/exports of its own (removed together with the rename;
// see V18節7 in memory corpus-react-purity-execution-map).
// shell.ts was index.html's LAST <script> (after islands/app.js, so after viewer too) —
// kept last here to preserve that ordering. Its only load-time work is an async IIFE
// that awaits corpusIpc.getPrefs() then calls applyMode(...) (search.ts, imported
// directly by shell.ts now).
import 'corpus-svc:shell';
