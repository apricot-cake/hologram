# ドキュメント

- 詳細な構成・実装メモ: [docs/architecture.md](docs/architecture.md)
- ビルド/配布・実機検証の手順: [docs/build.md](docs/build.md)
- スクリプト/テストのカタログと手順: [docs/testing.md](docs/testing.md)
- ユーザー向け機能説明: [README.md](README.md)
- 残タスク: [BACKLOG.md](BACKLOG.md)
- 並列開発の運用（オーケストレータ＋worktree隔離ワーカー）: [docs/parallel-ops.md](docs/parallel-ops.md)（進行台帳 [parallel/STATE.md](parallel/STATE.md)）

# 守るルール

- UI 変更時は [DESIGN.md](DESIGN.md) に従う
- アプリのコード変更は確認を取らずに再起動して反映する（停止/起動コマンドは docs/build.md）。
- テスト済みケースを再テストしない（`scripts/test-progress.md` を必ず確認）。手順は `docs/testing.md`。
- 日本語で書く＝ユーザーが読むもの: チャット・docs・コミットメッセージ・UI 文言/i18n（処理中に表示する説明文を含む）。平易な表現で（技術用語・識別子は原語のまま）。
- コード内コメントは英語（ASCII）で書く（ユーザーは読まない＋巨大ブロックの完全一致 Edit が崩れにくい）。既存の日本語コメントブロックを編集するときは無理に英語化せず周囲に合わせる。
- コミットは自己判断でこまめに（意味のある単位で）行ってよい。
- push は作業が一段落したら、またはセッションを終える区切りで行う。未 push を溜め込まない（数コミット単位を目安に）。
- バックログ着手時に一度「並列に向くか」を見る: `viewer.js`/`index.html` を取り合わない実装ペア、または設計・調査・レビューのファンアウトがあれば並列化、無ければ solo（無理に並列化しない）。詳細 [docs/parallel-ops.md](docs/parallel-ops.md)。