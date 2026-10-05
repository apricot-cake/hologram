import { dirname, basename, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { API_HOST_PERMISSIONS, RESIDENT_MATCHES } from './utils/extractor/index.ts';

const explicitOutput = process.env.HOLOGRAM_EXTENSION_OUTPUT || process.env.HOLOGRAM_EXTENSION_TEST_OUTPUT;

export default defineConfig({
  // Chrome Web Storeへ提出するManifest V3の成果物だけを作る。
  manifestVersion: 3,
  // 用途ごとに分ける出力:
  //   test    → .output/chrome-mv3-test。Vitest と使い捨てブラウザだけが読む
  //   release → .output/<browser>-mv3-release。ストア成果物の確認用
  //   local   → .output/chrome-mv3。ext:deploy が直接1回だけビルドし、
  //             開発用と日常用の両プロファイルが同じフォルダを読む
  outDir: explicitOutput ? dirname(explicitOutput) : resolve(import.meta.dirname, '.output'),
  outDirTemplate: explicitOutput ? basename(explicitOutput) : '{{browser}}-mv{{manifestVersion}}-release{{modeSuffix}}',
  // WXT はブラウザを起動してはならない。独立した2つの理由があり、どち
  // らも今なお有効だ:
  //   - 自動化スタック経由で開くものは automation-flag の指紋を帯び
  //     て、X と Google はそれを bot と読んでサインインを拒否する
  //     （2026-07-26 に実際に発生）。開発プロファイルは5つのサイトにサ
  //     インイン済みで、それを失うことはプロファイルが存在する理由その
  //     ものを失うことになる。
  //   - `--load-extension` は Chrome 137以降で無視される（#657、Chrome
  //     151 で実測)ので、管理された起動では拡張機能すら読み込まれな
  //     い。
  // 拡張機能は専用プロファイルへ一度だけ、手で読み込む。ホットリロード
  // は拡張機能と開発サーバーの間で動くもので、誰がブラウザを起動したか
  // は気にしない。ランナーを起動させないことは、WXT 0.21.2 以降オプ
  // ションの peer dependency である `web-ext` が一切インストールされな
  // いことも意味し、その推移的依存もこのツリーには一切入らない
  // （#454）。
  webExt: {
    disabled: true,
  },
  vite: () => ({
    build: {
      // Vite が既定で持つエントリチャンク（popup.html、diag.html）用
      // の modulepreload <link> は、Chrome 拡張機能のページでは使えな
      // い＝ブラウザは拡張機能のリソースを、preload のターゲットとは違
      // う「world」で読み込むため、そのタグを「world をまたぐ拡張機能
      // リソースの不一致」として捨てたうえで、preload が未使用に終わっ
      // たと二重に警告してくる。設定ページや診断ページを開くたびに、
      // チャンクごとに2つの警告が chrome://extensions に積み上がり、本
      // 物のエラーを埋もれさせる。これらのページはローカルの拡張機能
      // ファイルしか fetch しないので、読み込み時間で得られるものは何
      // もなく、手放しても失うものはない（#595）。
      modulePreload: false,
    },
    // このバンドルがどのビルドなのか（#650）。scripts/build-extension.cts
    // がビルドごとに発行し、同じトークンを native host が読む stamp
    // ファイルにも書き込む＝それによって拡張機能は、自分が読み込まれた
    // フォルダが今や別のビルドを保持していることに気付いて自分自身をリ
    // ロードする。そのため昇格したリリースは chrome://extensions での
    // クリックを一切必要としない。
    //
    // ここで生成するのではなく環境から読み込んでいるのは、値がビルドご
    // とに1回だけ、外側で、出力を検証して stamp を公開するのと同じスク
    // リプトによって決まるようにするためだ。素の `wxt build` は何も
    // セットせず、識別子は undefined のままになる＝utils/local-build-reload.ts
    // はそれを「ローカルビルドは存在しない」と読み、これはこのマシンを
    // 出ていくものすべてにとって正しい答えだ。
    define: {
      __EXT_BUILD_ID__: JSON.stringify(process.env.HOLOGRAM_EXT_BUILD_ID || ''),
      // 実ブラウザ E2E が closed shadow 内を拡張機能 world から検査するための
      // 専用境界。release では定数 false になり、listener ごと除去される。
      __EXT_TEST__: JSON.stringify(Boolean(process.env.HOLOGRAM_EXTENSION_TEST_OUTPUT)),
    },
  }),
  manifest: {
    // 固定された署名鍵、それゆえ固定された拡張機能 id。開発用と日常用の
    // Chromeプロファイルで完全に同一に保っている: native messaging は拡張機
    // 能 id ではなく host の名前でルーティングする
    // （utils/native-host.ts）ので、2つ目の id なしに2つのプロファイル
    // を隔離できる。2つ目の id があれば chrome.storage とリリース検証が
    // フォークしてしまう。
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzBGm/kCBitgpMoAkBDv5YrWwfAf74U8Uiy/rEuZgwFP703HT2EIhASBHEfVX7MSBF1a5V3D5IwZzu9mRFQmTzXtjyli8wdvxIjXVy3fqXXCRSmPMfCklL5nZ56ncx2LATi40kP8IiP36b40ZhPCVsq/NExT9gO0TNFpyJchDuAGgefqSBSS/xwp6c25vozxjbSfD3vcD2ohfSqpa75mui4XGwwouvbHl+69I7zXpeM5yYxmU+tTqWSUEblFGM67BsYSaPXGxcP9izInSB8JQ6WbmOyjCd/6az1RbKz9Yud2Yc4cX4z9+qWAx/ldn6vmQ6cjpvEAWTQdngSyHpawP5QIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    // contextMenus（#122）: 画像の右クリックにある保存項目。警告なし
    // （インストール時の permission プロンプトなし、host_permissions なし）で、
    // 対応サイト外の画像も利用者の明示操作で保存する。
    permissions: ['activeTab', 'scripting', 'nativeMessaging', 'storage', 'contextMenus', 'alarms'],
    // API 通信と、更新・起動後に常駐スクリプトを再注入するホストを許可する。
    host_permissions: [...new Set([...API_HOST_PERMISSIONS, ...RESIDENT_MATCHES])],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
});
