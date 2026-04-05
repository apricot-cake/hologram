# Post Snap

Chrome拡張（Manifest V3）。SNS投稿をJPEG画像としてキャプチャし、EXIFメタデータ（JSON）付きで保存。ビルトインビューアで検索・フィルタ・エクスポート。

## 対応プラットフォーム

- X (Twitter)
- Bluesky
- Misskey

## 構成

- `manifest.json` — 拡張設定、権限、キーボードショートカット
- `background.js` — Service Worker。キャプチャ処理、EXIF書き込み、storage管理
- `content.js` — コンテンツスクリプト。投稿選択UI、DOM解析、メタデータ抽出
- `viewer.html` / `viewer.js` — ビューア（検索・ソート・フィルタ・エクスポートZIP/HTML・インポート・設定）
- `vendor/jszip.min.js` — ZIPエクスポート用ライブラリ
- `scripts/inject-dummy.js` — 開発用ダミーデータ

## キーボードショートカット

- `Alt+S` — キャプチャモード開始
- `Alt+V` — ビューアを開く
- `Alt+R` — 拡張リロード（開発用、ストア版では非表示）

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

## TODO (将来対応)

- [ ] デスクトップアプリ（Electron + Native Messaging）
  - 拡張機能はデータ取得・送信のみに軽量化
  - アプリ側でローカルDB（SQLite）+ ファイルシステムに画像保存
  - 添付画像の原寸保存・表示
  - ビューアUIは現行viewer.html/jsを流用
- [ ] ビューア: ハッシュタグ一覧画面（保存済み投稿の text から #タグ を抽出して一覧表示）
- [ ] ビューア: Misskey インスタンス指定フィルタ（Misskey チップを押すとインスタンス一覧が展開）
- [ ] Threads 対応（Meta製、日本で1300万ユーザー。X の代替として成長中）
- [ ] Mastodon 対応（ActivityPub 系。Misskey と同じプロトコルだが DOM 構造が異なる）
