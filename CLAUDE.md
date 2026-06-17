# ドキュメント

- 詳細な構成・実装メモ: [docs/architecture.md](docs/architecture.md)
- ビルド/配布・実機検証の手順: [docs/build.md](docs/build.md)
- スクリプト/テストのカタログと手順: [docs/testing.md](docs/testing.md)
- ユーザー向け機能説明: [README.md](README.md)
- 残タスク: [BACKLOG.md](BACKLOG.md)

# 守るルール

- UI 変更時は [DESIGN.md](DESIGN.md) に従う
- アプリのコード変更は確認を取らずに再起動して反映する（停止/起動コマンドは docs/build.md）。
- 実機CDP検証に入る前に「今は触らないでください」と伝え、終わったら「もう触ってOK」と返す。数値で足りる検証は画像を撮らず JS 計測で済ます。
- テスト済みケースを再テストしない（`scripts/test-progress.md` を必ず確認）。手順は docs/testing.md。
- ユーザーに確認を取らずコミット・プッシュしてよい
- 処理中にチャットへ出力する説明文は、日本語で平易な表現で書く