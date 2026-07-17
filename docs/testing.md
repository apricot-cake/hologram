# Corpus スクリプト・テスト

> CLAUDE.md のスリム化に伴い、`scripts/` のカタログとテスト手順をここへ集約（2026-06-17）。CLAUDE.md 側には「再テストしない／test-progress.md を必ず確認」という**行動ルールだけ**残す。

## テストケース定義・進捗

- テストケース定義: `scripts/test-plan.md`
- テスト進捗記録: `scripts/test-progress.md`

## `scripts/` カタログ（俯瞰）

スクリプトの正本は `scripts/` 内の実ファイル（`node scripts/<name>.cts` で実行）。ここは逐一列挙でなく**種別の地図**に徹する＝何がどこにあるかだけ示し、各テストが具体的に何を検証するかは当該ファイル冒頭コメントを正本とする（網羅列挙は記載漏れで陳腐化するため置かない）。

### ユーティリティ

- `inject-dummy.cjs` — `dummy-` 始まりの条件網羅フィクスチャ（jpg＋サイドカー＋色付きアバター）を既定保存先に生成。常設の検証フィクスチャとして残してよい（下の「行動ルール」参照）。electron 直起動なので拡張子は `.cjs`（理由はファイル冒頭・下記 make-icons と同じ）
- `verify-store.py`（サイドカーをAPI照合）／`backfill-metadata.cts`（欠損メタを保存URLから再取得・`--all`＝アバターも・`--avatars`＝アバターのみ）／`make-icons.cjs`（`assets/icon-master.png` から全アイコンを再生成・手順は docs/build.md。electron 直起動のため `.cjs`＝`.cts` だと `require('electron')` が壊れる）

### キャプチャ／メタデータ検証

- 半自動フローの土台＝`test-select-posts.cts`（対象投稿の自動選別）→ `test-watch-verify.cts`（保存先監視＋API再照合・`--recent N` で一括点検）。`e2e-capture-test.cts` は puppeteer で拡張入りChromeを一時起動し全自動（ユーザーChrome・Alt+S 不要）。API取得の単体は `test-metadata*.cts`／`test-mastodon-url.cts`。`extension/content.ts` の DOM 抽出（プラットフォーム検出・投稿要素特定・permalink抽出＝`extension/site-detect.ts`）の単体は `test-content-fixtures.cts`（fixture=`scripts/fixtures/content/`・jsdom・`npm test` 常時）＝コード変更のたび自動で回る。この単体を含む `npm test` 全体が緑ならDOM抽出ロジックの回帰は無い＝`e2e-capture-test.cts` の役割は「サイト側DOM変化の定期カナリア」（`extension/` 変更のたびの再走は不要）

### スモーク／退行・セキュリティ・正しさ

- 実Electron main は `CORPUS_SMOKE` harness で起動。`scripts/test-*.cts` 群がカバーする領域＝ブリッジ・原寸メディア・IPC・ハッシュタグ・自動更新・ユーザー/インスタンス・タグ用語帳・クエリビルダー（text 葉化／保存検索）・クエリエンジン純ユニット（`test-query-unit`＝`renderer/query.ts` の述語/ツリー評価/日付境界/ファセット・ドメイン＝改訂④）・保存先移行エンジン純ユニット（`test-migrate-unit`＝`lib-migrate.mts` の差分追いコピー/検証付き削除/落ち穂拾いスイープ/crash-safe順序）・import 重複検出（`test-app-import-dedup`＝URL＋eagleName/capturedAt/サイズ複合キー・.trash 復活防止）・タブ・カード脚注ゲート（`test-app-cardfoot`＝エンゲージメント数/取込日はソート・フィルタが関係するときだけ表示）・コレクション/フォルダ移行・自動バックアップ・Zip-Slip/zip爆弾(展開上限)/SSRF・メタ正しさ・index 再利用・テーマトークン/コントラストのパリティ・送り出し（`test-library-files`＝drag-out のファイル名ガード/欠損除外の純ユニット、`test-app-copy-image`＝実 Electron で nativeImage が読めない形式を拒否しクリップボードを空で潰さないこと）。
- **復旧系は 2026-06-23 ライブラリ消失対策の多重防御**＝`test-app-recovery`（冗長ポインタ→config 復元）・`test-backup-guard`（prune 安全弁）・`test-config-recovery`（degraded 時の clear-all 拒否）。安全弁の意図はこの3本を正本とする。
- **一括実行**: `npm test`（`run-tests.cts`）＝Electron 不要の純ユニットのみ（TS 型検査 `test-typecheck`＝app(islands+renderer)・main・native-host・extension・scripts の5プロジェクトの `tsc --noEmit` を含む）。アプリ実起動系（`test-app-*.cts`）は含まれないので `node scripts/run-app-tests.cts` で一括実行する（1本≈10秒と重い＝節目で回す。renderer 再構築後の「npm test では見えない無音の赤」をここで検出する。引数でサフィックス指定のサブセット実行可）。

## キャプチャテスト手順（半自動フロー）

1. `node scripts/test-select-posts.cts` — テスト対象投稿を公開APIから自動選別（セルごとのURL・アクション・期待値のシートを出力）
2. `node scripts/test-watch-verify.cts` — 保存先フォルダの監視を開始（キャプチャごとにAPI再照合し PASS/FAIL ＋ test-progress 用の行を自動出力）
3. claude が in chrome でシートのURLを開く → ユーザーが Alt+S → クリック（またはドラッグ）
4. watcher の出力行を `scripts/test-progress.md` に記録
5. 次のセルに進む（過去分の一括点検は `node scripts/test-watch-verify.cts --recent N`）

### 注意（行動ルール）

- テスト済みのケースを再テストしない（`test-progress.md` を必ず確認）
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）
- **手元にないデータはダミーで補ってよい（区別必須）**: 既存ライブラリに無いデータ（例: アバター画像の無い投稿者）を実機検証したいときは、**区別がつくダミーを保存先に追加してよい**。区別の規約＝captureId とコンパニオン（画像/アバター）のファイル名を `dummy-` で始める（検索・一括掃除で実データと確実に分離できる）。`inject-dummy.cjs` がこの規約のダミー（アバター付き・条件網羅）を生成する。**常設の検証フィクスチャとして残してよい**＝再注入の手間が省け、全PF/種別/メディア/反応域/アバターを常に網羅するので普段使い中の退行にも気づける（ユーザー方針 2026-06-21）。データモデルが変わって古びたら `inject-dummy.cjs` を再実行して入れ替える。不要になれば保存先の `dummy-*` を削除すれば fs-watch が一覧から落とす。
