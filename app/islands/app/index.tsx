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
// The viewer orchestrator (renderer/viewer.js) folds into this single bundle so
// it compiles through Vite (enabling checkJs → .ts). It is a plain window-IIFE
// (no imports/exports); its body `await`s corpusI18n so it stays deferred behind
// the synchronous island mounts above — the pull→push convergence is unchanged
// from when it loaded as its own <script> before app.js. Imported LAST so every
// island bridge/mount is registered first. @ts-ignore: viewer.js is untyped here
// (it is checkJs'd in the renderer tsconfig project, not this islands project);
// Vite/rollup resolve the path at build/dev time regardless.
// @ts-ignore
import '../../renderer/viewer.js';
