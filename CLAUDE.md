# Post Snap

SNS投稿（X / Bluesky / Misskey）をJPEG画像としてキャプチャするChrome拡張（Manifest V3）と、保存・閲覧を担うデスクトップアプリ（Electron）。

> **アーキテクチャ移行中**: EXIF と chrome.storage への保存を廃止し、**ユーザーが選んだ保存先フォルダに `<captureId>.jpg`（純JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）を書き出す方式**へ移行中。キャプチャ→保存は Native Messaging ブリッジ経由（拡張・アプリ未起動でも動作）。閲覧は Electron アプリ。
> - **Phase 1（完了）**: 拡張をキャプチャ専用化（EXIF/storage廃止 → Native Messaging送信）、ブリッジ（`native-host/`）、最小 Electron ビューア（`app/`）。
> - **Phase 2（完了）**: ビューア全機能を Electron（`app/renderer/`）へ移植、拡張内ビューア（`viewer.html/js`）と `vendor/` を撤去、`options_ui`/`open-viewer` 削除、ドキュメント/ストア説明を更新。
> - **残（任意）**: 配布パッケージング（electron-builder 設定済み・下記「アプリのビルド/配布」参照）、スクリーンショット/デモ差し替え、`reload-extension`(Alt+R) のストア版除去。
> 詳細プラン: `~/.claude/plans/playful-kindling-duckling.md`

## 対応プラットフォーム

- X (Twitter)
- Bluesky
- Misskey

## 構成

- `manifest.json` — 拡張設定、権限（`nativeMessaging`）、キーボードショートカット
- `background.js` — Service Worker。タブキャプチャ → クロップ → Native Messaging でブリッジへ送信（EXIF/storage は廃止済み）
- `content.js` — コンテンツスクリプト。投稿選択UI、DOM解析、メタデータ抽出、クロップ
- `native-host/` — Native Messaging ブリッジ。`bridge.js`（保存先に jpg+サイドカーを書き込み専用で生成）、`install.js`（ホスト登録）、`paths.js`（共有configパス）
- `app/` — Electron デスクトップアプリ。`main.js`/`preload.js`/`renderer/`（`index.html`・`viewer.js`・`i18n.js`）、`vendor/jszip.min.js`。サイドカー走査で閲覧、保存先選択・拡張ID設定・ホスト自動登録。画像は `psimg://` プロトコルで遅延読込
- `i18n.js`（ルート）— content.js のバナー用 i18n（拡張側のみ。アプリは `app/renderer/i18n.js` を使用）
- `scripts/` — `inject-dummy.js`（保存先に jpg+サイドカー生成）、`verify-store.py`（サイドカーをAPI照合）、`test-bridge.js`/`test-app-render.js`/`test-app-ipc.js`/`test-app-hashtags.js`/`test-app-watch.js`（ブリッジ/アプリ/IPC/ハッシュタグ/自動更新のスモークテスト）、`make-icons.js`（アイコン生成）

## キーボードショートカット

- `Alt+S` — キャプチャモード開始
- `Alt+V` — ビューアを開く
- `Alt+R` — 拡張リロード（開発用、ストア版では非表示）

## アプリのビルド/配布

- 開発実行: `cd app && npm install && npm start`
- **開発ルール**: アプリのコード変更を反映するときは、確認を取らずにアプリを再起動して反映する（単一インスタンスのため `Get-Process electron | Where Path -like '*post-snap*' | Stop-Process -Force` で停止 → 起動し直す）。
- 配布物生成: `cd app && npm run dist`（electron-builder, win/nsis）
  - 出力 `app/dist/win-unpacked/` — スタンドアロン。`Post Snap.exe` を直接実行可。ASCIIパスへ置けば native-host のランチャもASCIIになり日本語パス問題が解消。
  - **NSIS ワンクリックインストーラ** は winCodeSign 展開時に **symlink 作成権限** が要る。**Windows 設定 → 開発者向け → 開発者モード を ON**（または管理者で実行）してから `npm run dist` で `Post Snap Setup x.x.x.exe` が生成される。OFF だと winCodeSign 展開が失敗し `win-unpacked` のみになる（macOS用 dylib symlink でこける／コードの問題ではない）。
  - `native-host/` は `extraResources` で `resources/native-host` に同梱。`app/main.js` が `app.isPackaged` でパス解決（dev=`../native-host`）。
  - アイコンは `scripts/make-icons.js`（256px基準で `icons/icon{16,32,48,128,256}.png` 生成。win ビルドは `icon256.png`）。

## ストア版リリース時の注意

- `manifest.json` の `reload-extension` コマンドを削除する

## ビューア機能

- プラットフォームフィルタ（チップボタン）
- Misskey インスタンスフィルタ（Misskey 選択時にサイドバーへインスタンス一覧を展開、URLのホストで絞り込み）
- 保存先フォルダの自動監視（新規キャプチャ等で一覧を自動更新。main の `fs.watch`→`posts-changed` IPC）
- ハッシュタグ一覧タブ（本文の #タグ を抽出・頻度順表示、クリックで絞り込み）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- カード/リスト表示切替（config保存）
- 投稿の個別削除・一括削除（確認スキップ可）
- 言語切替（auto/ja/en）
- 保存先フォルダの選択
- エクスポート: ZIP（画像+JSON）、HTML（検索UI付き）
- インポート: エクスポートHTMLから復元

## i18n

アプリ（`app/renderer/i18n.js`）は config.json の `language` で制御（auto/ja/en）。content.js のバナーは拡張側 `i18n.js` で日英対応（auto はブラウザ言語に追従）。

## テスト

- テストケース定義: `scripts/test-plan.md`
- テスト進捗記録: `scripts/test-progress.md`

### 手順（キャプチャテスト）

1. claude が in chrome でテスト対象ページを開く
2. ユーザーが Alt+S → 投稿クリック
3. claude が検証: 保存先フォルダの `<id>.jpg`+`<id>.json` 生成を確認し、`python scripts/verify-store.py --recent N` でAPI照合
4. 結果を `scripts/test-progress.md` に記録
5. 次のテストケースに進む

### 注意

- テスト済みのケースを再テストしない（`test-progress.md` を必ず確認）
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）

## TODO (リリース前)

- [ ] ストア版ビルド: 開発用コードを除去する
  - `manifest.json`: `reload-extension` コマンド削除
  - `background.js`: `reload-extension` の onCommand 分岐、`buildHash`/`getBuildHash`（リロード検出用）を削除
  - （`writeCaptureLog()`・拡張内ビューア・`debugSection` は撤去済み）

## TODO (将来対応)

- [x] デスクトップアプリ（Electron + Native Messaging）— Phase 1/2 完了（上部「アーキテクチャ移行」参照）
  - [x] 拡張をキャプチャ専用化（Native Messaging送信）
  - [x] メタデータはサイドカーJSON（SQLite不採用：Electronでのネイティブ依存回避）+ ファイルシステムに画像保存
  - [x] ビューア全機能の Electron 移植（検索・フィルタ・ソート・タグ編集・削除・エクスポート/インポート）
  - [ ] 配布パッケージング（electron-builder 等）
  - [ ] 添付画像の原寸保存・表示
- [x] ビューア: ハッシュタグ一覧画面（保存済み投稿の text から #タグ を抽出して一覧表示）
- [x] ビューア: Misskey インスタンス指定フィルタ（Misskey チップを押すとインスタンス一覧が展開）
- [ ] Threads 対応（Meta製、日本で1300万ユーザー。X の代替として成長中）
- [ ] Mastodon 対応（ActivityPub 系。Misskey と同じプロトコルだが DOM 構造が異なる）
