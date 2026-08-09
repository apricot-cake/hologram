'use strict';

// このプロセスが計算したパスで読み込む native-host/ のモジュール（#227）。index.ts から持ち上げて
// あるので、これらを必要とするモジュール（lib-config.ts は configDir / defaultLibraryDir /
// resolveSaveFolder を、lib-thumbnails.ts は configDir を欲しがる）は、組み立ての側から受け取る
// のではなく自分で import できる。
//
// 静的な import ではなく動的な require のままなのは、指定子が実行時に解決される絶対パスだから。
// native-host/ は app/ の外にあり、ビルドごとに置き場所が違う。開発では electron-vite が main の
// 層を丸ごと app/out/main/index.js へ出すので、native-host（リポジトリのルートで app/ と並ぶ）は
// 3階層上。パッケージ済みでは resources/native-host の下に extraResource として配られる。
// バンドラはそのどちらも追えないし、追ってはいけない＝あのファイルはアプリの中へ束ねるのではなく、
// アプリの隣に生のソースとして配るもの。
//
// 対象は ESM（.mts）でこちらのバンドルは CJS だが、require() はどのみち同期。Node の require(esm)
// は、トップレベル await さえ無ければ CommonJS から ES モジュールを読み込み、取り込む途中で型を
// 剥がす。#1052 で native-host/ が CommonJS をやめられたのはそれのおかげ＝動的な `await import()`
// はここでは初めから選べなかった。electron-vite がこの層を CJS として出す（トップレベル await が
// 使えない）し、ensureHostRegistered() は起動の最中に走るため。

import { app } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ESM のために組み直した CJS の require と __dirname。
const nodeRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nativeHostDir = app.isPackaged ? path.join(process.resourcesPath, 'native-host') : path.join(__dirname, '..', '..', '..', 'native-host');

const { configDir, defaultLibraryDir, extensionContactPath } = nodeRequire(path.join(nativeHostDir, 'paths.mts'));
const installer = nodeRequire(path.join(nativeHostDir, 'install.mts'));

// 旧形式の ZIP 取り込みのための、できる範囲でのアバターのダウンロード（保存と同じ SSRF の番人と
// 上限、同じ共有の avatars/ のストア＝downloadAvatar はアバターの URL で重複を取り除く）。
//
// media-download.mts は npm の undici を require する。開発では生のソースを require しても問題
// なく解決する（リポジトリのルートの node_modules）ので、開発では今までどおりソースを直接
// require する＝編集して再起動するのにビルドが要らない。ただし electron-builder は native-host/
// を node_modules 抜きの生の extraResource として写すので、パッケージ済みのビルドは
// app/build-native-host-bridge.mjs が native-host/dist/media-download.js に作る、前もって束ねた
// 複製（undici をインライン化したもの）を require しなければならない＝あちらで生のソースを
// require すると、起動時に "Cannot find module 'undici'" でクラッシュした。
const mediaDownloadPath = app.isPackaged ? path.join(nativeHostDir, 'dist', 'media-download.js') : path.join(nativeHostDir, 'media-download.mts');
const { pixivRefererFor, downloadAvatar } = nodeRequire(mediaDownloadPath);

// 保存先フォルダの解決と、clear-all のゲート。native host（同じ保存先フォルダを解決しなければ
// ならない）と共有するので、native-host/ の paths.mts と並んで置いてある。
const { resolveSaveFolder, clearAllBlockReason } = nodeRequire(path.join(nativeHostDir, 'config-recovery.mts'));

export { configDir, defaultLibraryDir, extensionContactPath, installer, pixivRefererFor, downloadAvatar, resolveSaveFolder, clearAllBlockReason };
