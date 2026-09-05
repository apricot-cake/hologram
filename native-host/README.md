# Hologram のネイティブメッセージングホスト

このディレクトリには、Chrome 拡張機能とローカルライブラリをつなぐネイティブメッセージングホストがあります。Chrome は [`chrome.runtime.connectNative`](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-connectNative) を通じてホストを起動します。デスクトップアプリを閉じている間も投稿を保存できます。

## 保存するデータ

拡張機能は、保存操作ごとに原本メディアの URL とメタデータを含むリクエストを送ります。ホストは利用者が選んだライブラリに、投稿のファイルと取り込みレコードを書き込みます。

```text
items/<captureId>/  投稿の原寸画像、動画、動画のポスターなど
.hologram-inbox/    アプリがデータベースへ反映する取り込みキュー
```

ホストは既存の項目ファイルを変更しません。削除、編集、索引の更新はデスクトップアプリが担当します。

## 主なファイル

| ファイル | 役割 |
| --- | --- |
| `bridge.mts` | 標準入出力でネイティブメッセージングの JSON を読み書きするエントリーポイントです。 |
| `item-storage.mts` | `items/<captureId>/` のディレクトリと安全な相対パスを作ります。 |
| `protocol.mts` | 拡張機能とホストが共有するリクエスト、応答、エラー、プロトコルバージョンを定義します。 |
| `paths.mts` | Electron アプリと共通の設定ディレクトリを解決します。 |
| `media-download.mts` | メディアをダウンロードし、接続先、サイズ、件数、時間を制限します。 |
| `config-recovery.mts` | 保存先を復旧し、破壊的な操作を防ぎます。 |
| `install.mts` | Chrome 用のホストマニフェストを登録または削除します。 |
| `com.hologram.host.json` | `install.mts` が生成するホストマニフェストのひな形です。 |

ソースは ESM の `.mts` ファイルです。Node.js の型除去を使うため、開発時はコンパイルせずに実行できます。`install.mts` は Electron アプリからも読み込みます。Electron 側は CommonJS のバンドルですが、Node.js の `require(esm)` で同期的に読み込みます。詳しい理由は `native-host/tsconfig.json` に記載しています。

## 共有プロトコル

`protocol.mts` は保存、問い合わせ、診断のリクエストと応答、キャプチャ ID の規則、プロトコルバージョンを定義します。拡張機能もこのファイルを直接 import し、Vite が拡張機能のバンドルへ組み込みます。このため、`protocol.mts` は Node.js の組み込みモジュールを利用できません。`post-record.mts` からの import も型だけに限定しています。

ホストはすべての応答にプロトコルバージョンを含めます。拡張機能とデスクトップアプリは別々に更新されるため、両者のバージョンが一時的に異なることがあります。バージョンが異なる場合は、更新が必要な側を利用者へ案内します。バージョンの違いだけを理由に保存を拒否することはありません。

## ビルドと配置

`app/build-native-host-bridge.mjs` は、`bridge.mts` とその依存関係を `native-host/dist/bridge.js` へバンドルします。Node.js の組み込みモジュールは外部依存として残します。`install.mts` はソースではなく、このバンドルと生成したランチャーを設定ディレクトリへ配置します。配置後のホストは、実行時に npm パッケージを解決しません。ホストのソースを変更した場合は、バンドルを作り直して再登録します。

同じビルドスクリプトは、`media-download.mts` を `native-host/dist/media-download.js` へ個別にバンドルします。パッケージ化した Electron アプリは、投稿をインポートするときのメディア取得にこのファイルを使います。パッケージ内には隣接する `node_modules` がないため、依存関係もバンドルへ含めます。開発時のアプリはソースを直接読み込むため、このバンドルを使いません。

## 設定

保存先は `<configDir>/config.json` に記録します。既定の場所は `%APPDATA%\Hologram\config.json` です。

```json
{ "saveFolder": "D:\\Hologram" }
```

デスクトップアプリで選んだフォルダが `saveFolder` に入ります。設定がない場合は `~/Hologram/library` を使います。設定ディレクトリは `HOLOGRAM_CONFIG_DIR` で変更できます。

## 開発環境へ手動で登録する

手動登録には、`PATH` から実行できる Node.js が必要です。先にホストをバンドルしてください。バンドルがない場合、`install.mts` は登録を中止します。

```powershell
npm run build:native-host-bridge --prefix app
node native-host/install.mts <extensionId>
node native-host/install.mts uninstall
```

デスクトップアプリは、初回起動時にホストを自動登録します。`ELECTRON_RUN_AS_NODE` で同梱した実行ファイルを使うため、利用者が Node.js を別途インストールする必要はありません。

## 拡張機能 ID

ホストマニフェストの `allowed_origins` には、接続を許可する拡張機能 ID が必要です。`extension/wxt.config.ts` に署名鍵を保持しているため、展開済み拡張機能を別のディレクトリから読み込んでも ID は変わりません。ID は `chrome://extensions` で確認できます。

デスクトップアプリに ID を設定すると、`config.json` の `extensionId` に保存されます。アプリはホストマニフェストの接続元を `chrome-extension://<id>/` に更新します。ID を設定するまで `allowed_origins` は空で、Chrome は接続を拒否します。
