// Single-bundle entry — side-effect imports of every React island. islands/build.mjs
// builds this one barrel into renderer/islands/app.js: ONE IIFE for all islands so
// shared code (masonic, react-aria-components, _shared/{VirtualGrid,TagEditor,i18n,tip})
// is bundled ONCE instead of duplicated per island. React stays externalized to
// vendor-react.js.
//
// The renderer's single React root (最終形B DoD: 島 root 群の1本統合 — COMPLETE). root.tsx
// creates ONE createRoot(#corpusAppRoot) and renders app/App.tsx, which is the source of
// truth for the island roster: every island renders under that one root (container-mounted
// ones via createPortal into their viewer-owned static container; body-level overlays as
// fixed children). Each island still owns only RENDERING and reads its state from a
// window.corpus* bridge — viewer.js keeps the logic/state + all event delegation. The
// window.corpus* bridge assignments happen as a side effect of App.tsx importing each
// island module, before viewer.js (imported LAST below) runs.
//
// Migrated in verifiable batches: 1=overlays, 2=sidebar/selection-bar/inspector/edit-
// overlay/searchbox, 3a=query-chips/image-tab, 3b=tabs/lightbox, 4=settings/toolbar,
// 5=the two virtualized grids (GridMount keeps flushSync + host-attach). Dev
// (vite.config.mjs) serves this same file as a module via the island <script> rewrite
// (islands/app.js → /islands/app/index.tsx).
//
// --- renderer service layer (formerly individual <script> tags in index.html; folded
//     into this one bundle so they compile through Vite → .ts). Each is a window-IIFE
//     assigning window.corpusX; viewer + islands read those globals (the bridge
//     dissolution is P4). Imported via `corpus-svc:NAME` bare specifiers (aliased to
//     renderer/NAME.ts by build.mjs / vite.config.mjs) — the same indirection
//     corpus-viewer-bundle uses. Originally this also kept the service layer out of
//     the strict islands tsc program (a separate, looser tsconfig.renderer.json
//     type-checked it); as of 2026-07-09 both are merged into one strict tsconfig.json
//     project, so that reason is gone — the bare specifiers remain only because these
//     are still window-global side-effect imports, not real ES module imports (see
//     「window.corpusXxx → export/import」 in the backlog memory for the pending
//     conversion — query.ts and listing.ts are the first two converted, so they're no
//     longer listed here: they're real ES modules now, pulled in by a plain relative
//     import wherever a consumer (viewer.ts / query-chips.ts / sidebar.ts / tabs.ts)
//     needs them, with no side-effect-only import required at this barrel). Order
//     mirrors the old index.html scripts; these precede root.tsx (islands read the
//     globals at render) and viewer (last). Wave 1 = the logic services. ---
import 'corpus-svc:ipc';
import 'corpus-svc:search';
import 'corpus-svc:records';
import 'corpus-svc:posts-data';
import 'corpus-svc:facets';
import 'corpus-svc:cooc';
import 'corpus-svc:tags';
import 'corpus-svc:users';
import 'corpus-svc:tab-state';
import 'corpus-svc:geometry';
import 'corpus-svc:format';
import 'corpus-svc:undo';
import 'corpus-svc:search-editing';
import 'corpus-svc:query-chips';
import 'corpus-svc:trash';
import 'corpus-svc:backup';
import 'corpus-svc:posts';
// Wave 2 = infra + UI bridges (store/bridge before their consumers menu/kind-menu/
// filter-popover/qf-pop — bridge.ts's makeCallbackBridge is called at qf-pop/filter-
// popover module-load time, so it must precede them; order below mirrors the old
// index.html <script> order, which already satisfied this).
import 'corpus-svc:i18n';
import 'corpus-svc:ui';
import 'corpus-svc:folders';
import 'corpus-svc:store';
import 'corpus-svc:bridge';
import 'corpus-svc:menu';
import 'corpus-svc:kind-menu';
import 'corpus-svc:filter-popover';
import 'corpus-svc:qf-pop';
import 'corpus-svc:inspector';
import 'corpus-svc:edit-overlay';
import 'corpus-svc:searchbox';
import 'corpus-svc:grid';
import 'corpus-svc:image-tab';
import 'corpus-svc:tabs';
import 'corpus-svc:sidebar';
import 'corpus-svc:selection';
import 'corpus-svc:bulk-edit';
import 'corpus-svc:confirm';
import 'corpus-svc:about-icon';
import './root.tsx';
// The viewer orchestrator (renderer/viewer.ts) folds into this single bundle so
// it compiles through Vite. It is a plain window-IIFE (no imports/exports); its
// body `await`s corpusI18n so it stays deferred behind the synchronous island
// mounts above — the pull→push convergence is unchanged from when it loaded as
// its own <script> before app.js. Imported LAST so every island bridge/mount is
// registered first.
//
// It is imported through the bare specifier 'corpus-viewer-bundle', aliased to
// renderer/viewer.ts by BOTH islands/build.mjs (prod) and vite.config.mjs (dev).
// tsc has no path mapping for this literal (Vite's alias is build-only), so the
// import itself still needs @ts-ignore below — but viewer.ts is now type-checked
// as part of THIS SAME tsconfig.json program regardless, via the `renderer/**/*`
// include (merged 2026-07-09; formerly a separate, looser tsconfig.renderer.json).
// The bare specifier is Vite/bundling indirection now, not a type-isolation trick.
// @ts-ignore — resolved by the Vite alias above, not by tsc.
import 'corpus-viewer-bundle';
// shell.ts was index.html's LAST <script> (after islands/app.js, so after viewer too) —
// kept last here to preserve that ordering. Its only load-time work is an async IIFE
// that awaits window.corpus.getPrefs() then calls window.corpusSearch.applyMode(...);
// corpusSearch is already assigned synchronously by the Wave 1 import above.
import 'corpus-svc:shell';
