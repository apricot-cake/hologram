# Eagle Info+ TODO

設計メモ: [.claude/engagement-tracking.md](../.claude/engagement-tracking.md)
テストマトリクス: [test-matrix.md](test-matrix.md)

---

## 設計方針

annotation = Eagle 標準検索でヒットさせたい人間情報のみ。
構造化データ + 即時表示は Plugin DB + Inspector Plugin で。

### 確定した責務分離

- **Info+ (Chrome 拡張)** — ドラッグ時に Eagle item の `url` フィールドに post permalink を設定し、annotation に検索可能な人間情報を書く。engagement 取得には一切関わらない
- **Window Plugin** — Eagle ライブラリ全件を SNS API で同期して engagement / 機械情報をサイドカー DB に格納。フィルタ/ソート UI を提供
- **Inspector Plugin** — Eagle 右パネルに engagement / pixiv キャプション / alt 等の即時表示カードを差し込む。Window Plugin と DB 共有

### リポ構成: モノレポ

annotation フォーマットを Info+ が書いて Plugin 側が parse する強結合があるため、3 コンポーネントは同一リポで管理する。配布先 (Chrome Web Store / Eagle Plugin Center) が違っても、サブディレクトリ分割で問題なし。

```
eagle-info-plus/
├── extension/        # Chrome 拡張 (現 root の background.js / content.js / manifest.json / icons をここへ移動)
├── plugin-window/    # Eagle Window Plugin
├── plugin-inspector/ # Eagle Inspector Plugin
├── shared/           # SNS API client + annotation parser (3 つから import)
└── docs/             # 全体共通 (本ファイル等)
```

Phase 2 着手前に restructure すること。Chrome 拡張を unpacked で読み込んでる場合は `extension/` を再選択する必要あり (それだけ)。

### annotation に書く (Eagle 検索可)

- Platform / Display Name / Author / Image / Hashtags
- Text (X/Bluesky の投稿本文) または Title (pixiv の作品タイトル)
- Alt (X/Bluesky のみ — pixiv は仕組み上タグ付けが保証されてるので不要)

### Plugin DB に書く (Window Plugin が API 同期で構築)

- engagement 全種 (likes / reposts / replies / quotes / views / bookmarks)
- 投稿日時 / UID / Post ID
- pixiv の illustComment / alt
- 取得時刻 / 同期管理

---

## annotation 最終仕様

X / Bluesky:
```
Platform: X (Twitter)
Display Name: 表示名
Author: @username
Image: 1/3
Hashtags: #foo #bar
Alt: 画像の説明
Text: 投稿本文 (200字 truncate)
```

pixiv:
```
Platform: Pixiv
Display Name: 表示名
Author: @userId
Image: 1/3
Hashtags: #foo #bar
Title: 作品タイトル
```

### 議論で確定した削除/廃止項目

- annotation 先頭の `@user - <text>` プレフィックス行 — `Author:` `Text:`/`Title:` で完全に表現可能
- `UID:` `Post ID:` `Published:` 行 — 検索しない、Plugin DB へ
- pixiv の `Description:` `Alt:` 行 — Eagle 検索ノイズ。pixiv は Hashtags でキャラ名等が拾える
- pixiv の `Text:` 行を `Title:` にリネーム — X/Bluesky の `Text:` (post body) と意味的に分離
- `Format-Version:` `Captured:` 行は追加しない — 破壊的変更可、バージョニング不要

### Eagle for Chrome の `name` 設定について

実 metadata.json 観察結果:
- X: 2 系統あり (`@handle 投稿文` 形式 と opaque `<media_id>` 形式)。一貫しない
- Bluesky: `(@handle) — Bluesky` 形式 (handle のみ)
- pixiv: `<タグ?> <illustTitle> - <userName>のイラスト` 形式 (タイトル + 表示名)

→ Eagle for Chrome の name 設定が一貫しないため、annotation を統一形 (pixiv で Display Name / Title が filename と冗長気味でも全行書く) にして annotation 単体で完結させる。

---

## API engagement 取れる範囲 (Plugin 側で参照)

| Field | X (Syndication) | Bluesky (getPostThread) | pixiv (ajax/illust) |
|---|---|---|---|
| Likes | ✅ favorite_count | ✅ likeCount | ✅ likeCount |
| Reposts | ❌ (要 GraphQL 認証) | ✅ repostCount | — |
| Replies | ✅ conversation_count | ✅ replyCount | ✅ commentCount |
| Quotes | ❌ | ✅ quoteCount | — |
| Views | ❌ | ❌ (Bluesky 自体が未計測) | ✅ viewCount |
| Bookmarks | ❌ | — | ✅ bookmarkCount |

X の Syndication API は `cdn.syndication.twimg.com/tweet-result?id=20&token=0` を実 fetch して確認済み。retweets/views/bookmarks/quotes は GraphQL 認証が必要で個人利用スコープ外なので非対応。Bluesky / pixiv は実装着手前に再 fetch で確認。

---

## Phase 1: Info+ の annotation を新方針に揃える

### 実装 (background.js)

- [x] `poll` の annotation プレフィックス削除
  - `metadata.title + '\n\n' + ...` を `metadata.annotation` 直渡しに
- [x] `buildMetadata` から `title` フィールド削除 (戻り値は `link` `annotation` のみ)
- [x] `buildAnnotation` 書き換え
  - 旧パラメータ `uid` `postId` `publishedAt` `description` 削除
  - `isPixiv` フラグ追加
  - pixiv のとき `Alt:` 行スキップ、`Text:` の代わりに `Title:` 出力
- [x] `extract{X,Bluesky,Pixiv}Fields` から `uid` `publishedAt` `postId` 返却を削除
- [x] `extractPixivFields` から `description` 返却を削除
- [x] 関数 `stripHtml` 削除 (description 消滅で呼び出しゼロ)
- [x] 関数 `buildTitle` 削除 (annotation プレフィックス廃止で呼び出しゼロ)

### 実装 (README.md)

- [x] 「書き込まれる内容」の annotation 例ブロックを新形式に置換
- [x] UID 言及の段落 (`UID は X なら...`) 削除
- [x] pixiv の場合 `Title:` 行になる旨を一文追加

### 検証

- [x] X: 実投稿ドラッグ → metadata.json で 1 行目から `Platform: X (Twitter)` 開始、`Text:` `Alt:` 残存、`UID:` `Post ID:` `Published:` 消失
- [x] Bluesky: X と同等
- [x] pixiv: 1 行目から `Platform: Pixiv` 開始、`Title:` 行あり、`Alt:` `Description:` 行なし
- [ ] ~~R-18 / 鍵 / 削除済みなどの失敗系で URL 由来情報のみで保存される~~ (Phase 1 で挙動変更なしのためスキップ)

---

## Phase 2: Window Plugin MVP

- [x] モノレポ restructure (現 root 一式を `extension/` へ移動、`plugin-window/` `shared/` ディレクトリ作成)
- [x] Eagle Plugin manifest (type: window) — `plugin-window/manifest.json`
- [x] サイドカー DB セットアップ (JSON file + 配列操作)
- [x] 起動時の増分同期
- [x] annotation parser (新形式 + 旧形式の `Text:` も `Title:` も読めるように)
- [x] 基本 UI (一部残)
  - [x] グリッド (アイテムサムネ + engagement 値オーバーレイ)
  - [x] 数値範囲フィルタ (Min likes / Min views)
  - [x] ソート likes (raw + platform 内 ranked)
  - [ ] ~~ソート reposts / views~~ (platform 固有のため UI 整理で削除)
  - [ ] ソート published_at (engagement と別軸、現状 `modifiedAt` で代用)
  - [ ] ソート engagement 率 (likes/views) — Phase 5 派生指標
  - [x] プラットフォーム別フィルタ
  - [ ] 期間フィルタ
- [x] アイテムクリックで `eagle.item.select([id])` + `eagle.window.show()` でメインウィンドウへジャンプ
- [x] キャッシュベース起動 (DB から即 UI 表示 → 同期は手動)

---

## Phase 3: 運用機能 (Window Plugin)

- [ ] 一括リフレッシュ (一部 done)
  - [x] 進捗テキスト + cancel ボタン (`AbortSignal` + `onProgress`)
  - [x] スコープ選択 (`syncEngagement` の `filter`: `staleDays` / `ids` / `platform` を AND。UI の Scope = all / current filter / stale。プラットフォーム別は「current filter」+ グリッドの Platform フィルタで賄う)
  - [x] レート制限 (`syncEngagement` の `rateLimit` パラメータ。platform ごとに concurrency + minIntervalMs。`DEFAULT_RATE_LIMIT` = X: 1 並列 / 1.5 秒間隔、Bluesky / pixiv: 4 並列。platform 同士は並行)
  - [ ] resume 用フラグ (中断時に最後に処理した item_id を記録)
- [ ] バックフィル機能
  - 既存ライブラリ内の SNS URL 持ちアイテムを順次取得して engagement 埋め
  - cancel + rate limit が前提なので「一括リフレッシュ」の運用機能を先に整える
- [x] エラー状態管理
  - [x] `status` に `deleted` / `private` / `error` を記録してスキップ続行
  - [x] Status フィルタ + status バッジ + ⓘ popover で説明
  - [x] エラー時 `errorMessage` をカード tooltip に表示
  - エラー一覧専用画面ではなく、Status フィルタ で `error` を選ぶ形で代替

---

## Phase 4: Inspector Plugin

- [ ] `plugin-inspector/` ディレクトリで実装 (Window Plugin と独立した Eagle Plugin として配布、DB のみ共有)
- [ ] Eagle Plugin manifest (type: inspector)
- [ ] 右パネルに engagement / 投稿日時 / pixiv キャプション / alt 表示カード
- [ ] `eagle.event.onItemsSelected` で選択追従
- [ ] DB は Window Plugin と共有 (read-only)

---

## Phase 5: 将来検討

- [ ] GitHub Releases ワークフロー (Chrome 拡張 + Eagle plugin の zip 配布)
  - **目的**: clone でなくダウンロード→展開で動かせる経路を提供。リポ内の dev cruft (CLAUDE.md, scripts/, docs/) がエンドユーザに届かない
  - `scripts/build-release.mjs` を Node で書く:
    - `extension/` → `eagle-info-plus-extension-vX.zip` (現状自己完結なのでそのまま zip)
    - `plugin-window/` + `shared/` → `engagement-browser-vY.eagleplugin`
      - shared/ を stage に展開 (test と package.json を除外)
      - index.html の `../shared/` を `./shared/` にリライト
      - README.md は配布物から除外
    - zip 生成は execFile で `zip` コマンド (CI = ubuntu、ローカル = Git Bash)。`exec` は security hook で弾かれるので注意
  - `.github/workflows/release.yml`: tag `v*` push で build → softprops/action-gh-release で `dist/*` を release に upload
  - `.gitignore` に `dist/` 追加
  - README に「Releases から zip を落とす経路」を install 手順に追記
- [ ] Plugin Center 提出 (上のリリースワークフローで生成した `.eagleplugin` を提出物として使う)
  - icon 256×256 PNG, Developer Policies 準拠
  - サポート連絡先用意
  - pixiv R-18 取得部分のポリシー確認 (まずローカル運用で安定化、判断ペンディング)
- [ ] ホットキー対応 (`Ctrl+Shift+E` 等、Window Plugin の manifest.shortcut)
- [ ] 日本語対応 (UI 文字列の i18n)
  - manifest.json に `fallbackLanguage` `languages` を設定
  - plugin-window のラベル (Toolbar / Filter / Status / Sort / Footer) を locale 切り替え対応
  - エラーメッセージ・empty state も対象
  - manifest 自体の `name` `description` も locale 別に
- [ ] 派生指標
  - エンゲージメント率 (likes / views)
  - 期間内増加率
- [x] ルート README をハブ化 (構成図 + 各サブディレクトリの README にリンク)
- [ ] annotation 仕様変更時の互換性管理
  - Window Plugin 側で旧バージョン parser を残す (モノレポなので Info+ 変更と原子的に PR できる)
  - ルート README にフォーマット変更履歴を集約
- [ ] extension/ も shared/ から import するようにリファクタ (現状 extension は自己完結、Phase 1 のロジックが shared/sns-api-client.js と重複してる)

---

## リポジトリ整理 (要手動対応)

- [x] `eagle-info-plus-private` リポを削除する (開発メモは本リポ `docs/` に統合済み)
  - GitHub → 当該リポ → Settings → 一番下 Danger Zone → Delete this repository
  - **前提**: メインリポの統合 PR をマージしてから削除する (マージ前に消すと統合元が失われる)
  - private リポにはサニタイズ**前**の実値 (個人パス・実件数) が残っているので、残したいなら削除前に clone して退避
  - 削除に抵抗があれば Archive (読み取り専用で凍結) でも可
