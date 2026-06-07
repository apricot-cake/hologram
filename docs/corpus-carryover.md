# 旧リポTODOの引き継ぎ（Corpus 向けに選別）

post-snap / eagle-info-plus の TODO はサブツリーマージで履歴ごと保持されている
（`eagle-info-plus/docs/todo.md`、`scripts/test-progress.md`、`scripts/test-plan.md`）。
本ファイルは、その中から **Corpus に引き継ぐ価値のある項目だけ**を抽出し、対応フェーズに
紐付けたもの。Eagle 固有で陳腐化した項目（下記「対象外」）は引き継がない。

## Phase C（エンゲージメント → サイドカー）に引き継ぐ
- **API 取得範囲（eagle todo の表）**: X (syndication) = likes / replies(conversation_count) のみ
  （reposts/views/bookmarks/quotes は GraphQL 認証要・個人スコープ外）。Bluesky = likes / reposts /
  replies / quotes（views は Bluesky 未計測）。pixiv = likes / replies(comment) / views / bookmarks。
  → **Misskey / Mastodon はこの表に無い**。Corpus Phase C で両者の engagement fetcher を追加する。
- **同期運用機構**（`shared/sync-engagement.js` に実装済み・移植対象）: レート制限（X は 2.5–3.5s
  jitter・429/420 で run 停止）、日次上限（`DEFAULT_DAILY_LIMIT = {x:500}`・暦日リセット）、
  resume（残り id 集合を永続化）、`FETCH_SCHEMA_VERSION` による段階的再取得、status（deleted/private/error）、
  UI は「メタデータ補完」1ボタンに集約。
- **annotation parser/builder**（`shared/annotation-*.js`）: 旧 Eagle annotation を読む用途は移行時のみ
  （Phase F）。Corpus 通常運用では API から直接サイドカーに書くため annotation 文字列は不要。

## Phase D（画像閲覧モード）に引き継ぐ
- **ranked-likes percentile ソート**（platform 内順位・規模非依存）はプラグイン viewer に実装済み → 移植。
- **X 複数画像の扱い**: 素 permalink `<origin>/<user>/status/<id>` に正規化し、`postKey`
  (`parsePostUrl` の platform:postId) でグループ化。image-view の ×N グルーピングはこれに準拠。

## 将来（タグ / 指標。Corpus の「タグは今後」に対応）
- **対話的タグ付与ウィザード**: タググループごとに「(グループ名) のタグを付けますか?」と順に質問 →
  選んで付与。選択画像に対して実行。Corpus ではサイドカー `tags[]` に対して行う。
- **派生品質スコア**: 規模非依存の質指標 = likes / followers（フォロワー数取得が要る：Bluesky
  `followersCount`、pixiv `ajax/user`、X は syndication で取得不可）。pixiv は likes/views 中央値
  ~3.86% も補助指標になりうる。保留・将来検討。

## テストログ（継続利用）
- `scripts/test-progress.md` … 手動キャプチャ検証マトリクス（X/Bluesky/Misskey が一部記入済み）。
  Corpus では **pixiv / Mastodon の行を追加**して使う。
- `scripts/test-plan.md` … 手動テスト計画（同上）。

## 対象外（Eagle 固有・陳腐化。引き継がない）
- Inspector Plugin（Eagle 右パネル差し込み）→ Corpus では image-view の右インスペクタが相当。
- `eagle.tag` / `eagle.tagGroup` API 調査、`.eagleplugin` パッケージング、Plugin Center 提出。
- `eagle-info-plus-private` リポ整理（Eagle 側リポの話）。
- Eagle for Chrome の `name` 設定差異の吸収（Eagle 保存に依存した話）。
- thumbnail のライブラリ相対パス保存（Eagle ライブラリ前提。Corpus は `psimg://` 配信で無関係）。
