# プロジェクト概要
Corpus = SNS投稿を画像・メタデータごとローカル保存し検索・整理できる「自分だけのSNSライブラリ」（X/Bluesky/Misskey/Mastodon/pixiv対応、Chrome拡張→Native Messaging→Electronアプリの3構成、サーバー送信なし）。

# ドキュメント
詳細=docs/architecture.md／ビルド・実機検証=docs/build.md／テスト一覧=docs/testing.md／機能説明=README.md／残タスク=BACKLOG.md

# ストレージと実行環境
- 配置は`~/.corpus`(config/ログ)と`saveFolder`(既定`~/Corpus/library`)＝**AppData外必須**（MSIX仮想化でのライブラリ消失事故対策・2026-06-23）
- アプリ起動は必ず`CorpusLaunch`タスク経由（直接起動はHKCU仮想化でNative Messaging登録が実Chromeから見えず破損／詳細docs/build.md）
- **レジストリ確認（`reg query`等）は自分で実行せずユーザーに依頼**＝Claude Code自身がMSIX経由でパッケージ専用ハイブにリダイレクトされ誤診するため
- テストは`CORPUS_CONFIG_DIR=<tmp>`でサンドボックス化（Electronスモークは`CORPUS_SMOKE=1`）

# ルール
- UI変更はDESIGN.md準拠
- 反映: renderer=自動／native-host=`~/.corpus`へコピーで反映（再起動不要）／mainプロセスのみ再起動要（詳細docs/build.md）
- テスト済みケースは再テストしない（`scripts/test-progress.md`確認必須／手順docs/testing.md）
- commit/pushはユーザーに確認せず自由に行ってよい
- 私個人ライブラリの事情に合わせた機能開発はしない。一般ユーザーにも有用な機能、もしくは単なるライブラリの整理や修正ならOK。
