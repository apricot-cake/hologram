'use strict';
// 実際にElectronのバイナリがどこにあるか。実際のアプリをspawnするハーネス向けで、
// それら全てが共有する前提条件も併せ持つ: アプリはビルド済みでなければならない。
//
// 全ての呼び出し元は以前require(app/node_modules/electron)をハードコードして
// いた。それはリポジトリが制御できる場所ではない: app/はnpmワークスペースなので、
// 衝突するバージョンを固定するものが何も無い限り、npmはその依存関係をリポジトリの
// ルートへ引き上げる＝それが素のルートでの`npm install`が生むもの。すると、
// ハードコードしたパスはハーネスが検証を1つも実行する前にMODULE_NOT_FOUNDを
// 投げる。
//
// まずapp/から解決し（それがappの宣言済み依存関係だから）、リポジトリのルートへ
// フォールバックする。どちらの配置でも動くように。
//
// ビルド検査が存在するのは、それを省くとコストを払うのが「実行」ではなく
// 「ユーザー」だから: まっさらなworktreeにはapp/outが無い（gitignore対象の
// ビルド成果物）。メインのエントリが無い状態で`electron .`すると、Electron自身が
// その人がしていたことの前面にOSのモーダル（「Error launching app」／
// 「Unable to find Electron app at …」）を出す＝ケースごとに1回ずつ、だから
// 1つ閉じても次が来るだけ。HOLOGRAM_SMOKE=1は、ビルドが「ある」ときはウィンドウを
// 一切描画しないので、このダイアログは常にこの失敗からしか来ない。spawnを
// 拒否することが修正の全て（#460）。

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');

// Electronが探すエントリ。app/package.jsonの`main`から取ることで、パスを
// 複製するのではなくアプリに追従する。フォールバックはその同じフィールドの
// 現在値で、package.json自体が読めない場合に備える。
function appEntryPath(dir: string = appDir): string {
  let main = './out/main/index.js';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (typeof pkg.main === 'string' && pkg.main.trim()) main = pkg.main;
  } catch {
    /* package.jsonが読めない＝それでも従来の場所を報告するのが正しい */
  }
  return path.resolve(dir, main);
}

// アプリがビルド済みならnull。そうでなければ、起動を拒否する前に表示する
// メッセージ。純粋関数（exitもspawnもしない）なので、拒否そのものを単体
// テストできる。
function buildArtifactError(dir: string = appDir): string | null {
  const entry = appEntryPath(dir);
  if (fs.existsSync(entry)) return null;
  return `Electronの起動を拒否します: アプリがビルドされていません。
  無い場所: ${entry}
  直し方:   npm run app:build
これが無いまま起動すると、ElectronはケースごとにOSのエラーダイアログを出し、画面を占有します。`;
}

// electronのmain exportは、実行ファイルへの絶対パスそのもの（文字列）。
function electronPath(): string {
  const problem = buildArtifactError();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  return require(require.resolve('electron', { paths: [appDir, repoRoot] }));
}

module.exports = { electronPath, appEntryPath, buildArtifactError };
