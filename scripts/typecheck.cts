'use strict';
// TypeScript の契約検証（`npm run typecheck`）。Vitest のスイートではない:
// 何かを主張するのではなくプロジェクト全体に tsc を走らせるだけなので、
// これはただのスクリプトのまま — `npm run check` がテストと並べてこれを
// 実行する。
//
// 7つのプロジェクト（すべて no-emit）で、セッションをまたいで型の腐敗が
// 静かに積み上がらないようにする。
//   1. app/tsconfig.web.json      — レンダラー向けの単一の strict プロジェクト
//      （src/renderer/src/* 配下の React コンポーネント + src/renderer/src/
//      services/* 配下のサービス層）。electron-vite のレンダラーターゲットで
//      バンドルされる。
//   2. app/tsconfig.node.json     — Electron のメインプロセス + preload 層
//      （src/main/*.ts + src/preload/*.ts、段階2/3。electron-vite の
//      main/preload ターゲットでバンドルされる — #156 が、これらのファイルが
//      かつて走っていた未ビルドの .mts 型剥がし実行を引退させた）。
//   3. native-host/tsconfig.json  — native-messaging-host 層（bridge.mts +
//      install.mts + paths.mts + media-download.mts + config-recovery.mts、
//      段階2/3。3つ目の独立した Node ランタイム。#1052 以降 ESM、DOM 無し。
//      同じ Node の型剥がしで未ビルドのまま動く）。
//   4. extension/tsconfig.json    — Chrome 拡張機能（MV3）のブラウザ層、
//      段階2/3。4つ目のランタイム（実ブラウザ、型剥がし無し）— この層だけが
//      WXT/Vite でビルドされる。
//   5. scripts/tsconfig.json      — 開発ツール/CLI 層（app-harness の
//      Electron smoke ＋ capture/verify の CLI）、段階2/3。5つ目の独立した
//      Node ランタイム、.cts、ビルド手順無し — 当初の TS スコープ宣言が
//      一度も名指ししていなかったランタイム（2026-07-09 の監査）。
//   6. e2e/tsconfig.json          — Playwright の E2E 層（#14）: スペックと
//      その起動ハーネスを、Playwright 自身のローダーでコンパイルする。
//      6つ目のランタイム、ESM の import 構文を持つ .ts、ビルド手順無し。
//   7. scripts/tsconfig.test.json — Vitest のスイート（scripts/*.test.ts、
//      #635）。7つ目のランタイム: Vitest によって Vite 経由でトランスパイル
//      されるので、Node の下で実行されるにもかかわらずレンダラーと同じ
//      バンドラの形をしている。プロジェクト5とは別にしてあるのは、あちらが
//      nodenext/.cts で、これらのスイートはバンドラ解決向けに書かれた層を
//      横断して import するため。105スイートのうち59は今も `exclude` の中に
//      隔離されている — 理由はそこに書かれている。

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const extDir = path.join(__dirname, '..', 'extension');

// <workspace>/node_modules/<pkg> を決め打ちにするのではなく、fromDir から
// node_modules の連鎖を上へたどって <pkg>/<subPath> を見つける。npm は、
// 競合するバージョンをどのワークスペースも固定していない限り、依存を
// リポジトリのルートへ引き上げる。だから typescript が app/node_modules に
// 着地するかルートに着地するかはインストール順序の詳細であり、リポジトリの
// 制御下には無い — ネストしたパスを決め打ちにしていたせいで、素のルートで
// `npm install` した時だけ `npm test` がレッドになり、他の検証はすべて
// グリーンのままだった。
function resolveBin(pkg: string, subPath: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', pkg, subPath);
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`typecheck: ${fromDir} から ${pkg}/${subPath} が見つからない — npm install を実行すること`);
  }
}

const appTsc = resolveBin('typescript', path.join('bin', 'tsc'), appDir);
const extTsc = resolveBin('typescript', path.join('bin', 'tsc'), extDir);

const PROJECTS = [
  { p: path.join(appDir, 'tsconfig.web.json'), label: 'レンダラー（コンポーネント＋サービス）', tsc: appTsc, cwd: appDir },
  { p: path.join(appDir, 'tsconfig.node.json'), label: 'メインプロセス＋preload', tsc: appTsc, cwd: appDir },
  { p: path.join(__dirname, '..', 'native-host', 'tsconfig.json'), label: 'native-host', tsc: appTsc, cwd: appDir },
  { p: path.join(extDir, 'tsconfig.json'), label: '拡張機能', tsc: extTsc, cwd: extDir },
  { p: path.join(__dirname, 'tsconfig.json'), label: 'scripts', tsc: appTsc, cwd: appDir },
  { p: path.join(__dirname, '..', 'e2e', 'tsconfig.json'), label: 'e2e（Playwright）', tsc: appTsc, cwd: appDir },
  { p: path.join(__dirname, 'tsconfig.test.json'), label: 'vitest スイート', tsc: appTsc, cwd: appDir },
];

let failed = 0;
for (const project of PROJECTS) {
  const { p, label, tsc, cwd } = project;
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', p], { stdio: 'inherit', cwd });
  if (r.status !== 0) {
    console.error(`FAIL typecheck: ${label} がエラーを報告した`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log('PASS typecheck: レンダラー＋メインプロセス＋native-host＋拡張機能＋scripts＋e2e＋vitest スイートの型検証がクリーン');
