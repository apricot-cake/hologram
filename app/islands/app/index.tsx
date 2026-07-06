// Single-bundle entry — side-effect imports of every React island. islands/build.mjs
// builds this one barrel into renderer/islands/app.js: ONE IIFE for all islands so
// shared code (masonic, react-aria-components, _shared/{VirtualGrid,TagEditor,i18n,tip})
// is bundled ONCE instead of duplicated per island. React stays externalized to
// vendor-react.js.
//
// This file is the source of truth for which islands exist. Each island module is
// side-effect only: on load it assigns its window.corpus* bridge and idempotently
// mounts (mounted-guards make re-entry safe), so importing them here mounts them all
// under one bundle. Dev (vite.config.mjs) serves this same file as a module via the
// island <script> rewrite (islands/app.js → /islands/app/index.tsx).
import '../settings/index.tsx';
import '../sidebar/index.tsx';
import '../selection-bar/index.tsx';
import '../query-chips/index.tsx';
import '../tabs/index.tsx';
import '../searchbox/index.tsx';
import '../posters/index.tsx';
import '../lightbox/index.tsx';
import '../toolbar/index.tsx';
import '../context-menu/index.tsx';
import '../kind-menu/index.tsx';
import '../filter-popover/index.tsx';
import '../qf-pop/index.tsx';
import '../inspector/index.tsx';
import '../edit-overlay/index.tsx';
import '../grid/index.tsx';
import '../image-tab/index.tsx';
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
