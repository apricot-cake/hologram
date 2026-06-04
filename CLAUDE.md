# Post Snap

SNS投稿（X / Bluesky / Misskey）をJPEG画像としてキャプチャするChrome拡張（Manifest V3）と、保存・閲覧を担うデスクトップアプリ（Electron）。

> **アーキテクチャ移行中**: EXIF と chrome.storage への保存を廃止し、**ユーザーが選んだ保存先フォルダに `<captureId>.jpg`（純JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）を書き出す方式**へ移行中。キャプチャ→保存は Native Messaging ブリッジ経由（拡張・アプリ未起動でも動作）。閲覧は Electron アプリ。
> - **Phase 1（完了）**: 拡張をキャプチャ専用化（EXIF/storage廃止 → Native Messaging送信）、ブリッジ（`native-host/`）、最小 Electron ビューア（`app/`）。
> - **Phase 2（未着手）**: ビューア全機能を Electron へ移植、拡張内ビューア（`viewer.html/js`）撤去、`vendor/piexif.js` 削除、ドキュメント/ストア説明の全面更新。
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
- `app/` — Electron デスクトップアプリ。`main.js`/`preload.js`/`renderer/`。サイドカー走査で閲覧、保存先選択・拡張ID設定・ホスト自動登録
- `viewer.html` / `viewer.js` — 旧ビューア（拡張オプションページ）。**Phase 2 で `app/` へ移管予定の残置物**
- `vendor/jszip.min.js` — ZIPエクスポート用（Phase 2 で `app/` へ）。`vendor/piexif.js` は EXIF廃止により Phase 2 で削除
- `scripts/` — `inject-dummy.js`（保存先に jpg+サイドカー生成）、`verify-store.py`（サイドカーをAPI照合）、`test-bridge.js` / `test-app-render.js`（ブリッジ/アプリのスモークテスト）

## キーボードショートカット

- `Alt+S` — キャプチャモード開始
- `Alt+V` — ビューアを開く
- `Alt+R` — 拡張リロード（開発用、ストア版では非表示）

## ストア版リリース時の注意

- `manifest.json` の `reload-extension` コマンドを削除する

## ビューア機能

- プラットフォームフィルタ（チップボタン）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- カード/リスト表示切替（storage保存）
- 投稿の個別削除（確認スキップ可）
- 言語切替（auto/ja/en）
- エクスポート: ZIP（画像+JSON）、HTML（検索UI付き）
- インポート: 画像ファイル、フォルダ、HTMLから復元

## i18n

ビューアとコンテンツバナーは日英対応。`chrome.storage.local` の `language` キーで制御（auto/ja/en）。

## テスト

- テストケース定義: `scripts/test-plan.md`
- テスト進捗記録: `scripts/test-progress.md`

### 手順（キャプチャテスト）

1. claude が in chrome でテスト対象ページを開く
2. ユーザーが Alt+S → 投稿クリック
3. claude が検証: 保存先フォルダの `<id>.jpg`+`<id>.json` 生成を確認し、`python scripts/verify-store.py --recent N` でAPI照合（補助で `~/Downloads/post-snap-capture-log.txt` も参照可）
4. 結果を `scripts/test-progress.md` に記録
5. 次のテストケースに進む

### 注意

- テスト済みのケースを再テストしない（`test-progress.md` を必ず確認）
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）

## TODO (リリース前)

- [ ] ストア版ビルド: 開発用コードを除去する
  - `manifest.json`: `reload-extension` コマンド削除
  - `background.js`: `writeCaptureLog()`, `reload-extension` の onCommand 分岐を削除
  - `viewer.html`: `debugSection` 全体を削除
  - `viewer.js`: DEBUG セクション（inject-dummy, verify）のコードを削除

## TODO (将来対応)

- [~] デスクトップアプリ（Electron + Native Messaging）← **進行中**（上部「アーキテクチャ移行」参照）
  - [x] 拡張をキャプチャ専用化（Native Messaging送信）
  - [x] メタデータはサイドカーJSON（SQLite不採用：Electronでのネイティブ依存回避）+ ファイルシステムに画像保存
  - [x] 最小ビューア（Electron）
  - [ ] ビューア全機能の移植（検索・フィルタ・ソート・タグ編集・削除・エクスポート/インポート）
  - [ ] 添付画像の原寸保存・表示
- [ ] ビューア: ハッシュタグ一覧画面（保存済み投稿の text から #タグ を抽出して一覧表示）
- [ ] ビューア: Misskey インスタンス指定フィルタ（Misskey チップを押すとインスタンス一覧が展開）
- [ ] Threads 対応（Meta製、日本で1300万ユーザー。X の代替として成長中）
- [ ] Mastodon 対応（ActivityPub 系。Misskey と同じプロトコルだが DOM 構造が異なる）
