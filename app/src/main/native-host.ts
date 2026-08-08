'use strict';

// The native-host/ modules this process loads by COMPUTED path (#227), lifted
// out of index.ts so the modules that need them (lib-config.ts wants configDir /
// defaultLibraryDir / resolveSaveFolder, lib-thumbnails.ts wants configDir) can
// import them instead of receiving them from the assembly.
//
// They stay dynamic requires rather than static imports because the specifier
// is an absolute path resolved at runtime: native-host/ lives OUTSIDE app/ and
// sits in a different place per build. In dev, electron-vite emits the whole
// main layer to app/out/main/index.js, so native-host (a repo-root sibling of
// app/) is three levels up; when packaged it ships as an extraResource under
// resources/native-host. A bundler can follow neither, and must not — those
// files are shipped as raw source beside the app, not bundled into it.
//
// The targets are ESM (.mts) while this bundle is CJS, and the require() is
// SYNCHRONOUS anyway: Node's require(esm) loads an ES module from CommonJS as
// long as it has no top-level await, and type-strips it on the way in. That is
// what let native-host/ stop being CommonJS in #1052 — a dynamic `await import()`
// was never an option here, because electron-vite emits this layer as CJS (no
// top-level await) and ensureHostRegistered() runs during startup.

import { app } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// CJS require + __dirname reconstructed for ESM.
const nodeRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nativeHostDir = app.isPackaged ? path.join(process.resourcesPath, 'native-host') : path.join(__dirname, '..', '..', '..', 'native-host');

const { configDir, defaultLibraryDir, extensionContactPath } = nodeRequire(path.join(nativeHostDir, 'paths.mts'));
const installer = nodeRequire(path.join(nativeHostDir, 'install.mts'));

// Best-effort avatar download for the legacy ZIP import (same SSRF guard/caps as capture,
// same shared avatars/ store — downloadAvatar dedupes by avatar URL).
//
// media-download.mts requires the npm package undici. In dev, requiring the raw
// source resolves it fine (repo-root node_modules), so dev keeps requiring the
// source directly — edit-and-restart needs no rebuild. But electron-builder
// copies native-host/ as a raw extraResource with no node_modules, so a packaged
// build must require the pre-bundled copy (undici inlined) that
// app/build-native-host-bridge.mjs produces at native-host/dist/media-download.js
// — requiring the raw source there crashed on startup with "Cannot find module
// 'undici'".
const mediaDownloadPath = app.isPackaged ? path.join(nativeHostDir, 'dist', 'media-download.js') : path.join(nativeHostDir, 'media-download.mts');
const { pixivRefererFor, downloadAvatar } = nodeRequire(mediaDownloadPath);

// Save-folder resolution + clear-all gating. Shared with the native host (which
// must resolve the SAME save folder), so it lives alongside paths.mts in native-host/.
const { resolveSaveFolder, clearAllBlockReason } = nodeRequire(path.join(nativeHostDir, 'config-recovery.mts'));

export { configDir, defaultLibraryDir, extensionContactPath, installer, pixivRefererFor, downloadAvatar, resolveSaveFolder, clearAllBlockReason };
