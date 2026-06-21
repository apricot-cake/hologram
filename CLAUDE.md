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
- push は作業が一段落したら、またはセッションを終える区切りで行う。未 push を溜め込まない（数コミット単位を目安に）。