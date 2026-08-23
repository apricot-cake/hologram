import { homedir } from 'node:os';
import { dirname, basename, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { API_HOST_PERMISSIONS } from './utils/extractor/index.ts';

// 開発ビルドがどこに着地するか。意図して作業ツリーの外に置いていて、ど
// のツリーでも同じにしてある: 専用の開発用 Chrome プロファイル（#732）
// は1つの unpacked フォルダを一度だけ読み込むので、作業が別の worktree
// へ移るたびにそのポインタを付け替えるのは、誰も覚えていられないクリッ
// クになってしまう。この環境変数は `npm run dev:ext` がセットするもの
// で、下の既定値はこのディレクトリで素の `wxt` を実行したときに書き出
// すものだ。だからどちらも、プロファイルが読み込んだフォルダについて一
// 致する。
const developmentOutput = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || resolve(homedir(), '.hologram-dev', 'chrome-mv3-dev');
const testOutput = process.env.HOLOGRAM_EXTENSION_TEST_OUTPUT;
const explicitOutput = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT ? developmentOutput : testOutput;

export default defineConfig({
  // Firefox についても同様。WXT は Firefox を既定で MV2 にするが、この
  // 拡張機能は CRXJS の時代からずっと両方で MV3 であり、Firefox 版が実
  // 際に依存している唯一のもの（native messaging のモデル、#211）はど
  // ちらでも同じだ。マニフェストバージョンを1つに保つことで、リリース
  // チェックの組も1つに保てる。
  manifestVersion: 3,
  // 絶対に混同してはいけない3つの出力:
  //   dev     → 上の固定パスで、開発用プロファイルだけが読む
  //   test    → .output/chrome-mv3-test。Vitest と使い捨てブラウザだけが読む
  //   release → .output/<browser>-mv3-release。何かがそれを
  //             .output/chrome-mv3（日常使いの Chrome が読み込んでいる
  //             フォルダ）へコピーする前に scripts/build-extension.cts
  //             が検証する。だから `wxt build` は日常使いのフォルダへ
  //             絶対に書き込めない。これが要点で、検証済みのビルドだけ
  //             がそこへ届き、それは昇格（scripts/deploy-extension.cts）
  //             によって届く。
  outDir: explicitOutput ? dirname(explicitOutput) : resolve(import.meta.dirname, '.output'),
  outDirTemplate: explicitOutput ? basename(explicitOutput) : '{{browser}}-mv{{manifestVersion}}-release{{modeSuffix}}',
  dev: {
    server: {
      // 固定してあるのは、開発プロファイルの拡張機能が、自分がビルドさ
      // れた対象のサーバーを常に見つけられるようにするため。同時に立ち
      // 上がれる開発サーバーは1つだけで、このポートを取ることが、2つ目
      // がそれを知る手段になる。
      port: 51731,
    },
  },
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
  vite: (env) => ({
    build: {
      // Vite が既定で持つエントリチャンク（options.html、diag.html）用
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
    // セットせず、識別子は undefined のままになる＝utils/dev-reload.ts
    // はそれを「ローカルビルドは存在しない」と読み、これはこのマシンを
    // 出ていくものすべてにとって正しい答えだ。
    define: {
      __EXT_BUILD_ID__: JSON.stringify(process.env.HOLOGRAM_EXT_BUILD_ID || ''),
      // このビルドがどの native messaging host を求めるか（#732 —
      // utils/native-host.ts）。意図してコマンドをキーにしている:
      // `import.meta.env.DEV` は NODE_ENV に従うため、テストランナーか
      // ら作られたリリースビルドは開発用の host とそのサンドボックスラ
      // イブラリを指す形で出来上がってしまう。
      __HOLOGRAM_NATIVE_HOST__: JSON.stringify(env.command === 'serve' ? 'com.hologram.host.dev' : 'com.hologram.host'),
    },
  }),
  manifest: {
    // 固定された署名鍵、それゆえ固定された拡張機能 id。開発ビルドとリ
    // リースビルドで完全に同一に保っている: native messaging は拡張機
    // 能 id ではなく host の名前でルーティングする
    // （utils/native-host.ts）ので、2つ目の id なしに2つのプロファイル
    // を隔離できる。2つ目の id があれば chrome.storage、キーボード
    // ショートカット、リリース検証がフォークしてしまう。
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzBGm/kCBitgpMoAkBDv5YrWwfAf74U8Uiy/rEuZgwFP703HT2EIhASBHEfVX7MSBF1a5V3D5IwZzu9mRFQmTzXtjyli8wdvxIjXVy3fqXXCRSmPMfCklL5nZ56ncx2LATi40kP8IiP36b40ZhPCVsq/NExT9gO0TNFpyJchDuAGgefqSBSS/xwp6c25vozxjbSfD3vcD2ohfSqpa75mui4XGwwouvbHl+69I7zXpeM5yYxmU+tTqWSUEblFGM67BsYSaPXGxcP9izInSB8JQ6WbmOyjCd/6az1RbKz9Yud2Yc4cX4z9+qWAx/ldn6vmQ6cjpvEAWTQdngSyHpawP5QIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    // contextMenus（#195）: ページの右クリックにある「ブックマーク」項
    // 目。警告なし（インストール時の permission プロンプトなし、
    // host_permissions なし）＝この機能が追加する permission がこれだ
    // けである理由は #195 の 2026-08-02 の設計コメント #5 を参照。
    permissions: ['activeTab', 'scripting', 'nativeMessaging', 'storage', 'contextMenus'],
    // background の fetch が必要とする CORS の対象となる API のホスト
    // で、それを呼ぶ extractor 自身が宣言する（#212）＝サイトを追加し
    // てもこのファイルには触れない。
    host_permissions: API_HOST_PERMISSIONS,
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
      },
    },
    commands: {
      activate: {
        suggested_key: { default: 'Alt+S' },
        description: '__MSG_cmdActivate__',
      },
      // #362: 特定のページで Alt+S が切り替わるモードではなく、専用の
      // ジェスチャーにしている＝Alt+S は、ブックマーク一覧を含むどこで
      // も「これからクリックする投稿を保存する」という意味を保ち続けな
      // ければならない。ページ側のボタンだけでなくコマンドにしているの
      // は、自動キャプチャに activeTab が必要で、これはツールバー/コマ
      // ンド/コンテキストメニューのジェスチャーだけが許可を与えるもの
      // だからだ。
      'activate-auto': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdActivateAuto__',
      },
    },
  },
});
