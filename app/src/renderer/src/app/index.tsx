// Single-bundle entry — side-effect imports of every React component. electron-vite's
// renderer build (see electron.vite.config.ts) bundles this one barrel via Rollup/Vite so
// shared code (React, masonic, @base-ui/react, _shared/{VirtualGrid,
// i18n,tip}) is bundled ONCE instead of duplicated per component. (Formerly a hand-rolled
// islands/build.mjs producing ONE IIFE for all islands — retired when the renderer moved
// to electron-vite; see #156.)
//
// The renderer's single React root (Final shape B DoD: consolidate the island root group into one — COMPLETE, i.e. the
// former independent island roots were consolidated into one). root.tsx
// creates ONE createRoot(#hologramAppRoot) and renders app/App.tsx, which is the source of
// truth for the component roster: every component renders under that one root (container-mounted
// ones via createPortal into their orchestrator-owned static container; body-level overlays as
// fixed children). Each component still owns only RENDERING and reads its state from a
// renderer/services/*.ts service module — orchestrator.ts (renamed from
// viewer.ts) keeps the logic/state + all event delegation. Those services'
// module-evaluation-time side effects (subscriptions, initial state) happen as a side
// effect of App.tsx importing each component module; App.tsx's own
// import of orchestrator.ts's exports (bootApp etc.) triggers its module evaluation — no
// separate side-effect import needed at this barrel (see the note near root.tsx below).
//
// Migrated in verifiable batches: 1=overlays, 2=sidebar/selection-bar/inspector/edit-
// overlay/searchbox, 3a=query-chips/image-tab, 3b=tabs/lightbox, 4=settings/toolbar,
// 5=the two virtualized grids (GridMount keeps flushSync + host-attach). electron-vite's
// dev server now serves this same file directly as an ES module (referenced from
// index.html's <script type="module" src="./src/app/index.tsx">) — no separate build step
// or rewrite needed.
//
// --- renderer service layer (formerly individual <script> tags in index.html, then a
//     `hologram-svc:NAME` bare-specifier barrel here — aliased to renderer/NAME.ts by the
//     old islands/build.mjs / vite.config.mjs — while each was converted one wave at a time
//     from a window-IIFE global bridge to a real named export, consumed via a plain relative
//     import). query/listing/format/geometry/posts-data/undo/users/ui/search-editing/
//     confirm/inspector/kind-menu/menu/edit-overlay/bridge/filter-popover/
//     qf-pop/cooc/facets/about-icon/searchbox/theme/records/tags/tab-state/trash/backup/
//     posts/search/i18n/folders/selection/grid/query-chips/sidebar/tabs are all real ES
//     modules now, imported directly by their consumers — no barrel entry needed, and
//     the hologram-svc alias itself is long gone.
//     shell.ts — the last side-effect-only entry (searchMode pref
//     restore) — was deleted with the search-mode toggle itself (P2④ single smart search). ---
// Tailwind v4 + shadcn/ui theme (globals.css) — imported FIRST so the
// generated stylesheet precedes any component-level CSS in cascade order.
import '../globals.css';
import './root.tsx';
// The boot orchestrator (services/orchestrator.ts, renamed from viewer.ts on 2026-07-11)
// no longer needs a side-effect-only import here: App.tsx (rendered via
// root.tsx above) already imports its exports (bootApp etc.) directly by relative path,
// which is enough to trigger ES module evaluation — the former bare-specifier
// 'hologram-viewer-bundle' alias + a TS-ignore directive was a leftover from when this file was a
// plain window-IIFE with no imports/exports of its own (removed together with the
// viewer.ts→orchestrator.ts rename).
