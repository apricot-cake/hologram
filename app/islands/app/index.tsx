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
//     renderer/NAME.ts by build.mjs / vite.config.mjs) so the strict islands tsc leaves
//     them to tsconfig.renderer.json — the same isolation corpus-viewer-bundle uses.
//     Order mirrors the old index.html scripts; these precede root.tsx (islands read the
//     globals at render) and viewer (last). Wave 1 = the logic services. ---
import 'corpus-svc:ipc';
import 'corpus-svc:search';
import 'corpus-svc:query';
import 'corpus-svc:records';
import 'corpus-svc:posts-data';
import 'corpus-svc:facets';
import 'corpus-svc:cooc';
import 'corpus-svc:tags';
import 'corpus-svc:users';
import 'corpus-svc:tab-state';
import 'corpus-svc:listing';
import 'corpus-svc:geometry';
import 'corpus-svc:format';
import 'corpus-svc:undo';
import 'corpus-svc:search-editing';
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
import 'corpus-svc:sidebar';
import 'corpus-svc:selection-bar';
import 'corpus-svc:confirm';
import 'corpus-svc:activebar';
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
// The indirection keeps viewer.ts OUT of this strict islands tsc program: tsc
// can't resolve the bare specifier (so it never pulls viewer.ts in), while Vite's
// alias resolves it to the exact same file — identical module graph, so the bundle
// is byte-for-byte the same as a direct import. viewer.ts is type-checked ONLY by
// tsconfig.renderer.json (loose + renderer-globals), where it lives in `files`.
// @ts-ignore — resolved by the Vite alias above, not by tsc.
import 'corpus-viewer-bundle';
// shell.ts was index.html's LAST <script> (after islands/app.js, so after viewer too) —
// kept last here to preserve that ordering. Its only load-time work is an async IIFE
// that awaits window.corpus.getPrefs() then calls window.corpusSearch.applyMode(...);
// corpusSearch is already assigned synchronously by the Wave 1 import above.
import 'corpus-svc:shell';
