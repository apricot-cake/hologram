# プロジェクト概要

Corpus = SNS投稿を画像・メタデータごとローカル保存し検索・整理できる「自分だけのSNSライブラリ」（X/Bluesky/Misskey/Mastodon/pixiv対応、Chrome拡張→Native Messaging→Electronアプリの3構成、サーバー送信なし）。

# ドキュメント
詳細=docs/architecture.md／ビルド・実機検証=docs/build.md／テスト一覧=docs/testing.md／機能説明=README.md／残タスク=BACKLOG.md

# 私個人のライブラリ事情は開発対象にしない
Corpusは汎用ソフトウェアとして開発中（将来public化予定）。**開発者個人のライブラリの中身を直す・整える作業**（例＝既存データのbackfill、個人の手作業での整理）は、それが一般ユーザーにも有用な**Corpusの機能**として実装するのでない限り、BACKLOGの開発対象にしない。
判断根拠として個人ライブラリの現状（枚数・タグ付け率等）を引用するのは構わないが、それはあくまで参考情報（実データはメモリ`library-composition`参照・数値を転記・重複させない）であり、Corpus自体の恒久的な設計制約（file:///厳格CSP／ファイルベース真実源／ガラスUI等）と同列に書かない。

# ストレージと実行環境（重要）
- 配置は`~/.corpus`(config/ログ)と`saveFolder`(既定`~/Corpus/library`)＝**AppData外必須**（MSIX仮想化でのライブラリ消失事故対策・2026-06-23）
- アプリ起動は必ず`CorpusLaunch`タスク経由（直接起動はHKCU仮想化でNative Messaging登録が実Chromeから見えず破損／詳細docs/build.md）
- **レジストリ確認（`reg query`等）は自分で実行せずユーザーに依頼**＝Claude Code自身がMSIX経由でパッケージ専用ハイブにリダイレクトされ誤診するため
- テストは`CORPUS_CONFIG_DIR=<tmp>`でサンドボックス化（Electronスモークは`CORPUS_SMOKE=1`）

# 守るルール
- UI変更はDESIGN.md準拠
- 反映: renderer=自動／native-host=`~/.corpus`へコピーで反映（再起動不要）／mainプロセスのみ再起動要（詳細docs/build.md）
- テスト済みケースは再テストしない（`scripts/test-progress.md`確認必須／手順docs/testing.md）
- commit/pushは自己判断でOK
