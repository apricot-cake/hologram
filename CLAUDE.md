# Corpus

SNS投稿（X / Bluesky / Misskey / Mastodon / pixiv）をJPEG画像としてキャプチャするChrome拡張（MV3）と、保存・閲覧を担うデスクトップアプリ（Electron）。

- 詳細な構成・実装メモ: [docs/architecture.md](docs/architecture.md)
- ビルド/配布・実機検証の手順: [docs/build.md](docs/build.md)
- スクリプト/テストのカタログと手順: [docs/testing.md](docs/testing.md)
- ユーザー向け機能説明: [README.md](README.md)
- 残タスク・先送り依頼: [BACKLOG.md](BACKLOG.md)

## 守るルール

- **UI 変更時は [DESIGN.md](DESIGN.md) に従う**（形＝意味の対応、モノトーン基調＋機能アクセント一点＝インディゴ淡、却下済みデザイン一覧などを定義）。新しい見た目・操作を足す前に必ず参照。
- **アプリのコード変更は確認を取らずに再起動して反映する**（停止/起動コマンドは docs/build.md）。
- **実機CDP検証に入る前に「今は触らないでください」と伝え、終わったら「もう触ってOK」と返す**（黙って検証を始めない＝2026-06-13 要望）。数値で足りる検証は画像を撮らず JS 計測で済ます。
- **着手前・別タスクへ移る前に [BACKLOG.md](BACKLOG.md) を必ず一読する**（先送り依頼の取りこぼし防止）。機微な項目（git 履歴スクラブ等）だけメモリ `corpus-tasks.md`。
- **テスト済みケースを再テストしない**（`scripts/test-progress.md` を必ず確認）。手順は docs/testing.md。

## アーキテクチャ（要約）

データの流れ＝拡張でキャプチャ → 保存ブリッジ（`native-host/`） → ローカル（`%LOCALAPPDATA%\Corpus\library`）に画像＋メタデータ → Electron アプリ（`app/`）で閲覧。構成・詳細は [docs/architecture.md](docs/architecture.md)。

## データ取得方針・不採用（決定事項）

- **データ取得方針**: メタデータは安定した公式/公開APIからのみ取得し、DOMスクレイピングはしない（壊れやすい）。content.js は投稿の特定とパーマリンク抽出だけ。X は公式APIが無く `cdn.syndication.twimg.com`（非公式・要host_permissions）で代替（リポスト/ブックマーク/閲覧数は取得不可）。
- **不採用: Threads** — 安定した公開APIが無く DOM依存のため、「安定API由来のみ」方針に反するので対応しない（決定済み）。
