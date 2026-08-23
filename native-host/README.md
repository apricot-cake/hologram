# Hologram — Native Messaging ホスト

Chrome 拡張機能がキャプチャをディスクへ書けるようにするブリッジ。Chrome がキャプチャごと
にこれを起動する（`chrome.runtime.connectNative`）ので、デスクトップアプリを閉じていても
働く。

## 何をするか

キャプチャのたびに、拡張機能が
`{ type:'save', captureId, image:<base64 jpeg>, metadata }` を送る。ブリッジはユーザーの
保存フォルダへ、**1度きりしか書かない**項目ファイルと取込イベントを書く:

```
items/<captureId>/  投稿が所有するスクリーンショット、原本、動画ポスターなど
.hologram-inbox/    アプリがデータベースへ送り出す取込キュー
```

既存のファイルを変更することは一切ないので、同時に走るキャプチャが共有のストアを壊すこと
はない。削除・編集・索引はデスクトップアプリが持つ。

## ファイル

| ファイル | 役割 |
|---|---|
| `bridge.mts` | stdio のホスト（長さを前置した JSON を読み書きする）＝バンドルの入口。 |
| `item-storage.mts` | `items/<captureId>/` の項目フォルダと安全な相対パスを組み立てる。 |
| `protocol.mts` | メッセージの取り決め。拡張機能もこれを import する＝下記を参照。 |
| `paths.mts` | 共有の設定ディレクトリを解決する（Electron アプリと必ず一致させる）。 |
| `media-download.mts` | できる範囲で働く共有の静止画ダウンローダ（SSRF の防ぎ、サイズと時間の上限）＝これもバンドルの入口（下記を参照）。 |
| `config-recovery.mts` | 保存フォルダの復旧と、破壊的な操作の関門（純関数）。 |
| `install.mts` | Chrome 向けにホストのマニフェストを登録・削除する。 |
| `com.hologram.host.json` | 参考用のひな形（本物は `install.mts` が生成する）。 |

ソースは ESM で、Node が実行時に剥がす型を持つ＝ビルドせずにそのまま走り、コンパイルの
工程は無い。`install.mts` は Electron アプリがそのまま読み込む。アプリ自身のバンドルは
CommonJS だが、Node の `require(esm)` がその同期的な読み込みを認めている。#1052 でこの
ディレクトリが CommonJS をやめられたのはそれのおかげだ。理由づけの全体は
`native-host/tsconfig.json` を参照。CJS の形が何を犠牲にしていたかも書いてある（tsc は
`module.exports` から export を読まないので、テストスイート16本が型検査から丸ごと外れて
いた）。

`protocol.mts` はメッセージそのものを宣言する。6つの要求、応答、capture id の規則、
プロトコルバージョンだ。そして**拡張機能はこれをここから import する**（Vite が拡張機能の
バンドルへ埋め込むので、実行時にこのディレクトリへ戻ってくるものは何も無い）。これがこちら
側に在るのは、このディレクトリが `app/` 抜きで出荷されるからだ。配置されるホストが読むもの
は、すべてこの中に無ければならない。そのため、これがここでブラウザのバンドルに入る唯一の
モジュールになる。node の組み込みモジュールを一切含んではならず、`post-record.mts` と
`raw-payload.mts` からの import が type-only なのも、まさにその理由による。

このホストが送る応答にはどれもそのプロトコルバージョンが押され、拡張機能はそれを自分の
バンドルが持つ番号と比べる（#205）。2つの半分は別々の通り道で更新される。拡張機能は
Chrome ウェブストアから、このホストはデスクトップアプリの更新機構から。だから「どちらかが
遅れている」はリリース後のふつうの状態だ。うまくいかなかったインストールが置き去りにした
ホストというのが、#511 の正体だった。食い違いが生むのは、どちら側を更新すべきかをユーザー
に伝えるメッセージだけだ。ここでこの番号によって分岐するものは何も無いし、これを理由に
保存を拒むことも決してない。

`bridge.mts` とそれが require するモジュールは、`app/build-native-host-bridge.mjs` が
`native-host/dist/bridge.js` へ**バンドル**する（1ファイル。node の組み込みモジュールは
外部扱い）。そして `install.mts` が設定ディレクトリ（Windows では `%APPDATA%\Hologram`、
macOS では `~/Library/Application Support/Hologram`。`paths.mts` を参照）へ配置するのは、ソースではなくそのバンドルであり、生成されたランチャー
はそれを走らせる。だから配置されたホストは実行時にモジュールを1つも解決しない。npm の
依存を使えるし、配置の際にホストのソースが取り残されることもない。ホストのソースを編集
したら、ビルドし直し、install をやり直す。

同じビルドスクリプトは `media-download.mts` 単体も `native-host/dist/media-download.js` へ
バンドルする。2つ目の利用者のためだ。**パッケージ化された** Electron のメインプロセスは
これを直接 require する（import-posts でのアバターのダウンロード）が、開発時とは違って隣に
node_modules が無い（electron-builder は `native-host/` を生の `extraResource` として複写
する）。このモジュールが最初に npm の依存（`undici`）を持ったとき、そこでの生ソースの
require は起動時に落ちた。バンドルはそれを埋め込む。開発時は今も生のソースを直接 require
する（`app/src/main/index.ts` を参照）ので、そちらではビルドし直す必要は無い。

## 設定

`<configDir>/config.json`（Windows: `%APPDATA%\Hologram\config.json`、macOS: `~/Library/Application Support/Hologram/config.json`）:

```json
{ "saveFolder": "D:\\Hologram" }
```

デスクトップアプリのフォルダ選択が書く。無ければブリッジは `~/Hologram/library` に退避
する。設定ディレクトリ自体は `HOLOGRAM_CONFIG_DIR` で上書きする。

## 手でインストールする（開発時）

PATH に Node が要る。ランチャーはその Node のバイナリでブリッジを走らせる。先にバンドルを
ビルドすること。バンドルが無ければ install は配置を拒む。

```
npm run build:native-host-bridge --prefix app            # → native-host/dist/bridge.js
node native-host/install.mts <extensionId>    # 登録し、この拡張機能を許可する
node native-host/install.mts uninstall        # 削除する
```

Electron アプリは初回の起動で自動的に登録する（`ELECTRON_RUN_AS_NODE` で自分が同梱する
バイナリを使うので、利用者は Node を入れなくてよい）。

## 拡張機能の ID

ホストの `allowed_origins` には、呼び出してくる拡張機能の ID をそのまま挙げなければ
ならない。`extension/wxt.config.ts` が `key` をコミットしているので、ID はその鍵から導かれ、
パッケージ化していない拡張機能をどのフォルダから読み込んでも同じままになる（ID は
`chrome://extensions` に出る）。その ID をデスクトップアプリに貼り付ける（`config.json` の
`extensionId` として保存される）。するとアプリがホストのマニフェストを
`chrome-extension://<id>/` で書き直す。ID を設定するまで `allowed_origins` は空で、Chrome は
接続を拒む。
