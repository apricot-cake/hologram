# Corpus スクリプト・テスト

> CLAUDE.md のスリム化に伴い、`scripts/` のカタログとテスト手順をここへ集約（2026-06-17）。CLAUDE.md 側には「再テストしない／test-progress.md を必ず確認」という**行動ルールだけ**残す。

## テストケース定義・進捗

- テストケース定義: `scripts/test-plan.md`
- テスト進捗記録: `scripts/test-progress.md`

## `scripts/` カタログ

### ユーティリティ

- `inject-dummy.js` — 保存先に jpg+サイドカー生成
- `verify-store.py` — サイドカーをAPI照合
- `backfill-metadata.js` — 保存先の欠損メタを保存URLから再取得（再取得時＋`--all` はアバターも未DLなら取得）。`--avatars`＝API無しでアバターのみDL（`avatar` URL有り＆`avatarFile` 無しの既存データ向け）
- `make-icons.js` — アイコン生成（256px基準）

### キャプチャ／メタデータ検証

- `test-select-posts.js` — テスト対象投稿を公開APIから自動選別→セッションシート出力
- `test-watch-verify.js` — 保存先を監視し新規キャプチャをAPI再照合・`--recent N` で一括点検
- `e2e-capture-test.js` — puppeteerで拡張入りChromeを一時起動し、SWの`activateOnTab`直叩き＋クリック/ドラッグでキャプチャを全自動実行→ブリッジ保存→API照合→後始末。pixiv対応済み。ユーザーのChrome・Alt+S不要。`<all_urls>`を足した拡張コピーをロードして captureVisibleTab の activeTab 要件を満たす
- `test-metadata.js` — メタデータAPI取得の実地検証
- `test-mastodon-url.js` — Mastodonの非Mastodon由来canonical URLフォールバックの単体テスト（モックfetch）

### スモークテスト

- `test-bridge.js` / `test-media.js` / `test-app-render.js` / `test-app-ipc.js` / `test-app-hashtags.js` / `test-app-watch.js` / `test-app-media.js` / `test-app-users.js` / `test-app-instances.js` — ブリッジ/原寸メディアDL/アプリ/IPC/ハッシュタグ/自動更新/原寸メディア表示/ユーザータブ/インスタンスフィルタ

### 退行・セキュリティ・正しさ

- `test-archive-zipslip.js` — import ZIP の Zip-Slip 退行テスト（バックスラッシュ/`..`/絶対パスのエントリが save folder 外へ書き込まれないことを検証）
- `test-bridge-ssrf.js` — `media-download.js#fetchStillImage` の SSRF/サイズ上限ガード（IPリテラルの private/予約・localhost系・private へのリダイレクトを fetch 前に拒否、上限超過 body をストリームで中断）
- `test-avatar-fill.js` — `backfill-metadata.js --avatars` の実機実行（fetchスタブを`-r`プリロード）＝`avatar`有り&`avatarFile`無しのサイドカーに `<base>-avatar.<ext>` をDLして `avatarFile` 付与・既にある/avatar無しはスキップ。`pixivRefererFor` の単体も兼ねる
- `test-metadata-origin.js` — `fetchPostMetadata` の `expectedHost` 制約（Misskey/Mastodon のインスタンスhost が sender tab と不一致なら fetch せず空レコード／一致時と固定hostの X は通す）
- `test-metadata-correctness.js` — メタ正しさ3件（X引用の screen_name 欠落時に `.../undefined/` を作らない／Bluesky の引用判定を feed.post 埋込限定＝リスト/フィード/スターターパック埋込を除外／Misskey の `rec.url` を bare permalink 化＝query/hash 除去）
- `test-index.js` — `lib-index.js` の O(changed) 再利用・削除prune・`.index.json` スナップショットからの cold 復元を read計数で検証
- `test-token-parity.js` — design-tokens.css の light/dark テーマ・パリティ（`:root` と `[data-theme=dark]` のセマンティック/影/ガラストークンが両テーマに揃っているかを集合比較。プリミティブ色ランプ・非色構造・dynamic alias は SHARED で除外。片テーマだけ追加すると落ちる＝「白リムがライトで消える」系の片テーマ崩れを構造的に防止）
- `test-contrast-parity.js` — design-tokens.css のテキストロールの WCAG コントラスト比を両テーマで実測比較（CSSの var() を解決して計算。muted系の中間レンジはターゲット帯[min,max]で両テーマを縛り、text/strong の極端レンジは下限のみ。token-parity の一歩先）

## キャプチャテスト手順（半自動フロー）

1. `node scripts/test-select-posts.js` — テスト対象投稿を公開APIから自動選別（セルごとのURL・アクション・期待値のシートを出力）
2. `node scripts/test-watch-verify.js` — 保存先フォルダの監視を開始（キャプチャごとにAPI再照合し PASS/FAIL ＋ test-progress 用の行を自動出力）
3. claude が in chrome でシートのURLを開く → ユーザーが Alt+S → クリック（またはドラッグ）
4. watcher の出力行を `scripts/test-progress.md` に記録
5. 次のセルに進む（過去分の一括点検は `node scripts/test-watch-verify.js --recent N`）

### 注意（行動ルール）

- テスト済みのケースを再テストしない（`test-progress.md` を必ず確認）
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）
