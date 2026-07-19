# プロジェクト概要
Corpus = ウェブのコンテンツ（現対応はSNS投稿）を出自・エンゲージメントごとローカル保存し検索・整理できる「自分だけのコンテンツライブラリ」（X/Bluesky/Misskey/Mastodon/pixiv対応、Chrome拡張→Native Messaging→Electronアプリの3構成、サーバー送信なし。射程の正＝docs/architecture.md「射程の原則」）。

# ドキュメント
詳細=docs/architecture.md／ビルド・実機検証=docs/build.md／テスト一覧=docs/testing.md／機能説明=README.md／残タスク=GitHub Issues＋Project「Corpus Backlog」（apricot-cake/corpus）。実装のhow・私的文脈はメモリ`corpus-backlog`（repo外）

# ストレージと実行環境
- 配置は`~/.corpus`(config/ログ)と`saveFolder`(既定`~/Corpus/library`)＝**AppData外必須**（MSIX仮想化でのライブラリ消失事故対策・2026-06-23）
- アプリ起動は必ず`CorpusLaunch`タスク経由（直接起動はHKCU仮想化でNative Messaging登録が実Chromeから見えず破損／詳細docs/build.md）
- **レジストリ確認（`reg query`等）は自分で実行せずユーザーに依頼**＝Claude Code自身がMSIX経由でパッケージ専用ハイブにリダイレクトされ誤診するため
- テストは`CORPUS_CONFIG_DIR=<tmp>`でサンドボックス化（Electronスモークは`CORPUS_SMOKE=1`）

# ルール
- lint/format＝Biome（`npm run lint`／1.9.4完全固定・設定と固定理由は biome.jsonc）
- 反映: renderer/islands=`npm run build:islands`→リロード（devサーバー時のみ自動）／native-host=`~/.corpus`へコピーで反映（再起動不要）／mainプロセスのみ再起動要（詳細docs/build.md）
- **個人ライブラリと後方互換を製品判断のゲートにしない**（2026-07-11 統合改訂）:
  - 私個人ライブラリの事情（規模・件数・利用実態）に合わせた機能開発・採否・優先度・**据置の発火条件**・性能目標の判断をしない。一般ユーザーにも有用な機能、もしくは単なるライブラリの整理や修正ならOK。
  - 私のライブラリに気を使って（既存データとの互換維持などを理由に）**設計を歪めない**。
  - **リリース前につき「他人のライブラリ」は存在しない**＝既存ユーザーデータとの後方互換・移行コード・旧名の焼き付きを理由に、命名や設計を妥協しない。
  - 手元ライブラリを壊さないための一回きりの移行手順は、設計でなく作業手順として可（リリース前に撤去してよい仮設コード）。
