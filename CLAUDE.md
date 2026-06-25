# プロジェクト概要

**Corpus** = SNS で見かけた投稿を画像とメタデータごと丸ごとローカル保存し、あとから整理・検索できる「自分だけの SNS ライブラリ」。すべて手元の PC に保存し、サーバーへは何も送らない。

対応プラットフォーム: X (Twitter) / Bluesky / Misskey / Mastodon / pixiv

**3 つの構成要素**（データは一方向に流れる）:

1. `extension/` — Chrome 拡張（MV3）。`Alt+S` で投稿をクリック保存、または画像ドラッグ保存。投稿 URL から各 SNS の API でメタデータを取得・正規化。
2. `native-host/` — Native Messaging ブリッジ。保存先フォルダ（既定 `~/Corpus/library`・変更可）に `<captureId>.jpg`（純 JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）+ メディア/アバター画像を書き出す。
3. `app/` — Electron デスクトップアプリ。サイドカーを走査して閲覧・検索・整理（タグ/フォルダ/ワークスペース/投稿者ビュー等）。保存先フォルダを `fs.watch` で監視し新規キャプチャを自動反映。

技術スタック: Electron + 素の JS（フレームワーク無し）/ Chrome MV3 / Node でテスト可能なロジック分離。

# ドキュメント

- 詳細な構成・実装メモ: [docs/architecture.md](docs/architecture.md)
- ビルド/配布・実機検証の手順: [docs/build.md](docs/build.md)
- スクリプト/テストのカタログと手順: [docs/testing.md](docs/testing.md)
- ユーザー向け機能説明: [README.md](README.md)
- 残タスク: [BACKLOG.md](BACKLOG.md)

# 守るルール

- UI 変更時は [DESIGN.md](DESIGN.md) に従う
- ホットリロードで更新されない変更は、確認を取らずに再起動して反映する（停止/起動コマンドは docs/build.md）。
- テスト済みケースを再テストしない（`scripts/test-progress.md` を必ず確認）。手順は `docs/testing.md`。
- コミットは自己判断でこまめに（意味のある単位で）行ってよい。
- push も自己判断で行ってよい（聞かない）。作業が一段落したら、またはセッションを終える区切りで行い、未 push を溜め込まない（数コミット単位を目安に）。