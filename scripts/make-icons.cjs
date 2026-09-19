'use strict';

// マスター画像1枚から、ブランドアイコンをすべて作り直す。
//
//   1. マスターを差し替える: assets/icon-master.png（正方形、512px以上）
//   2. 実行する（リポジトリのルートから）: node_modules/.bin/electron scripts/make-icons.cjs
//
// この1回の実行が、下のTARGETSに列挙された派生アイコンをすべて書き直すので、アイコンの
// 差し替えが中途半端に終わることは決してない（このスクリプトができる前は繰り返し起きて
// いた痛みだ）。Electron下で走らせているのは、純粋にnativeImageの高品質なリサンプラーの
// ためだけ――ウィンドウもネットワークも無く、リポジトリへのファイルI/Oだけがある。
// アイコンの置き場所を新しく増やしたい？TARGETS（ラスター）かBANNERS（svg）に加えれば、
// この一括再生成に加わる。
//
// なぜ.cts（他のスクリプトと同じ）ではなく.cjsなのか: これはELECTRONのエントリで、
// Electron 43 / Node 22は.ts/.ctsのエントリをESMのCommonJS変換器経由で読み込むが、
// そこではElectronのrequire('electron')注入（古典的なCommonJSローダーへのパッチ）が
// 効かない――だからrequire('electron')はERR_MODULE_NOT_FOUNDで死ぬ。.cjsエントリは
// 古典的なローダーを強制し、注入を復活させる。このファイルはプレーンなJS（型注釈なし）
// なので、.cjsにしても型カバレッジは失わない。.ctsへ戻して改名しないこと。
//
// ブランドマークはホログラフィックな虹色の正方形（アプリアイコン。
// シェーダーがapp/src/renderer/src/services/about-icon.tsで生成する）。これは本質的に
// ラスターなので、ベクターのマスターは存在しない――assets/icon-master.pngが正本だ。

const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MASTER = path.join(ROOT, 'assets', 'icon-master.png');

// このプロジェクトが出荷するすべてのラスターアイコンと、その正方形サイズ。この一覧は
// 完全に保つこと――「アイコンがどこに住んでいるか」のマニフェストだ。
const TARGETS = [
  { file: 'app/assets/icon.png', size: 512 }, // Electronウィンドウ/タスクバー + electron-builderのソース（→.ico）
  { file: 'assets/icon.png', size: 256 }, // 一般的なブランド用ラスター/favicon
  { file: 'extension/public/icons/icon128.png', size: 128 }, // manifestの最大値――Chromeはそれより大きいものを無視する（Chromeの拡張機能アイコンのドキュメントで確認済み）
  { file: 'extension/public/icons/icon48.png', size: 48 },
  { file: 'extension/public/icons/icon32.png', size: 32 },
  { file: 'extension/public/icons/icon16.png', size: 16 },
];

// READMEのバナーはアイコンだけ。<img>で描画すると外部参照をブロックするため、
// 正方形はbase64のdata URIとしてインラインにする。
const BANNERS = ['banner-light.svg', 'banner-dark.svg'];
const BANNER_ICON = { x: 110.5, y: 0, size: 96, render: 200 }; // 317x96のviewBox中央

function fail(msg) {
  console.error('make-icons: ' + msg);
  app && app.exit(1);
  process.exit(1);
}

function run() {
  if (!fs.existsSync(MASTER)) fail('マスターが無い ' + MASTER + ' ――まずそこに正方形のアイコンを置くこと。');
  const master = nativeImage.createFromPath(MASTER);
  if (master.isEmpty()) fail('デコードできない ' + MASTER);
  const { width, height } = master.getSize();
  if (width !== height) console.warn(`make-icons: マスターが${width}x${height}で正方形ではない――出力が歪む可能性がある。`);
  if (width < 256) console.warn(`make-icons: マスターがわずか${width}pxしかない――小さいターゲットには十分だが、512px以上を推奨する。`);

  for (const t of TARGETS) {
    const out = master.resize({ width: t.size, height: t.size, quality: 'best' });
    const abs = path.join(ROOT, t.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out.toPNG());
    console.log('書き込み: ' + t.file);
  }

  // バナー: 共有の正方形data URIを1つ作り、各バリアントのSVGへ落とし込む。
  const b64 = master.resize({ width: BANNER_ICON.render, height: BANNER_ICON.render, quality: 'best' }).toPNG().toString('base64');
  const { x, y, size } = BANNER_ICON;
  const imageTag = `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${b64}"/>`;
  for (const name of BANNERS) {
    const abs = path.join(ROOT, 'assets', name);
    if (!fs.existsSync(abs)) {
      console.warn('スキップ ' + name + '（見つからない）');
      continue;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 317 96" role="img" aria-label="Hologram">\n  ${imageTag}\n</svg>\n`;
    fs.writeFileSync(abs, svg);
    console.log('書き込み: assets/' + name);
  }

  console.log('完了――assets/icon-master.pngから' + (TARGETS.length + BANNERS.length) + '件のアーティファクトを再生成した');
}

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  try {
    run();
  } catch (e) {
    fail((e && e.message) || String(e));
  }
  app.quit();
});
