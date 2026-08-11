---
name: hologram-development-verification
description: Hologram の拡張機能または Electron アプリを変更した後、開発サーバー、専用 Chrome プロファイル、または HMR 実機で検証する。拡張機能の UI、挙動、manifest、content script、service worker、開発ビルド、Electron の UI、main process、preload を変更するときに使う。
---

# Hologram の開発環境で検証する

リポジトリ直下で実行する。変更範囲に応じて拡張機能、Electron、または両方の経路を検証する。

## 事前条件

`node_modules/` または `extension/node_modules/` が無ければ、実行中の開発版を閉じてから `npm run setup` を実行する。完了後に検証を始める。

セットアップの理由と手順の詳細は `docs/build.md` を参照する。

## 拡張機能

1. `npm run dev:ext` を実行して開発サーバーを起動または再利用する。
2. `npm run ext:dev:browser` を実行して専用 Chrome プロファイルを起動する。ユーザーにブラウザ起動を依頼しない。
3. 専用プロファイルで変更した機能を確認する。開発ビルドだけを使い、日常用プロファイルへは読み込まない。
4. 初回のパッケージ化していない拡張機能の読み込み、またはサービスへのログインが未完了なら、必要なユーザー操作を報告してそこで止める。

`docs/build.md` の「拡張機能の開発・配布」と「開発プロファイル」を、操作前に必要な範囲だけ読む。WXT にブラウザを起動させず、デバッグポートも開かない。

## Electron

1. PowerShell の専用端末で `$env:REMOTE_DEBUGGING_PORT = "9222"; npm run dev --workspace=app` を実行して HMR を起動する。
2. 変更した UI、main process、または preload の実経路を確認する。
3. `docs/build.md` の「開発実行」と「CDP で繋ぐ先の選び方」を必要な範囲だけ読む。実機確認に失敗したら、原因と試した確認を報告する。

## 報告

実行したコマンド、確認した経路、結果、未確認の理由を完了報告に残す。
