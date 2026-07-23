# Hologram Test Plan

プラットフォーム × ページ種別のキャプチャ取得マトリクス。`test-select-posts.cts` がこのセル定義を仕様として読む。対応サイトやページ種別を増やしたらセルを追加する。

## 事前準備（毎回）

- Electron アプリ（`cd app && npm start`）で保存先フォルダと拡張IDを設定済みであること（初回起動で Native Messaging host が登録される）。
- 拡張とテスト対象ページをリロード済みであること（`chrome://extensions` でリロード後、対象ページを再読込）。

## テスト後の一括検証（毎回）

```
python scripts/verify-store.py --recent N
```

保存フォルダの `<id>.json` サイドカー（メタデータ）と `<id>.jpg`（ペア画像の存在）を、Bluesky / Misskey の公開APIと自動照合。

---

## 共通確認項目（全キャプチャテスト共通）

各キャプチャ後に以下を確認。verify-store.py が自動チェックする項目は [auto] と記載。

- [auto] サイドカー内の screenName, displayName, userId, text, date（API照合。X は screenName のみ）
- [auto] サイドカー内の likes, reposts, replies（API照合・件数は変動許容）
- [auto] `<captureId>.jpg` と `<captureId>.json` のペアが保存先フォルダに生成
- [ ] サイドカー内の captureId, capturedAt, mediaType, lang, isReply, isQuote, isThread（参考表示・手動確認）

---

## A. プラットフォーム × ページ種別（取得マトリクス）

各セルで1回保存。**選別と検証は自動**（人間は「ページを開いて Alt+S→クリック/ドラッグ」だけ）。

回し方（半自動フロー・全自動の `e2e-capture-test.cts` とも）は `docs/testing.md`「キャプチャテスト手順」。

### A-1. X (Twitter)

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-1a | TL (x.com/home) | いいね・RT・返信が全て1以上 | エンゲージメント取得、カンマ区切り変換（1,234→1234） |
| A-1b | 個別 (x.com/{user}/status/{id}) | A-1a と別の投稿 | 個別ページのDOM構造で permalink・userId が取れるか |
| A-1c | プロフィール (x.com/{user}) | 自分以外のユーザーページの投稿 | フォローボタンからの userId フォールバック |
| A-1d | TL上のRT | リツイート | userId が null（仕様）。screenName は元投稿者 |
| A-1e | TL上の引用 | 引用ツイート | 引用した側の article が対象になるか |
| A-1f | 個別: リプライ | 他ユーザーへの返信 | isReply=true, isThread=null |
| A-1g | 個別: 引用 | 引用ツイート | isQuote=true |
| A-1h | 個別: セルフリプ | 自分への返信 | isThread=true, isReply=null |
| A-1i | 個別: 動画投稿 | 動画付き | mediaType=video |
| A-1j | 個別: 英語投稿 | 英語テキスト | lang=en |
| A-1k | 検索結果 (x.com/search) | 画像付き投稿 | 検索文脈でも本人の投稿が保存される |
| A-1l | 個別: 画像投稿 | 画像付き | media[] が ?name=orig（原寸）でDLされる |
| A-1m | ドラッグ: TL/詳細の画像 | 画像付き投稿 | 画像の属する投稿として保存 |
| A-1n | ドラッグ: ライトボックス★ | /photo/N 表示中に返信欄の画像 | 返信の投稿として保存（ライトボックス投稿に化けない） |
| A-1o | ドラッグ: アバター/バナー★ | プロフィールのバナー等 | ドロップゾーンが出ない（捏造レコードなし） |

**X 固有の確認**: ページ実データと照合（displayName, text, date, likes, reposts, replies, userId）
★ = 2026-06-11 取得監査で修正した項目の検証ポイント

### A-2. Bluesky

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-2a | TL (bsky.app) | いいね・リポスト・返信全て1以上 | セレクタ `feedItem-by-{handle}` |
| A-2b | 個別 (bsky.app/profile/{h}/post/{id}) | A-2a と別の投稿 | `postThreadItem-by-{handle}`。API enrichment 確認 |
| A-2c | プロフィール (bsky.app/profile/{handle}) | 他ユーザーの投稿 | プロフィールページでの検出 |
| A-2d | TL上のリポスト | リポストされた投稿 | 元投稿のメタデータが取れるか |
| A-2e | 個別: リプライ | 返信投稿 | isReply=true |
| A-2f | 個別: 引用★ | 引用投稿の詳細ページ | **引用した側**が保存される（引用元に化けない）。isQuote=true |
| A-2g | 個別: 複数画像 | 画像2枚以上 | media[] が枚数ぶん原寸DL |
| A-2h | 個別: 動画 | 動画付き | mediaType=video |
| A-2i | ドラッグ: 画像 | 画像付き投稿（詳細ページ） | url が canonical（/liked-by 等が付かない） |
| A-2j | 検索結果 (bsky.app/search) | 任意の投稿 | 検索文脈でも本人の投稿が保存される |

**Bluesky 固有の確認**: userId (DID) が取得されている、API経由でエンゲージメント取得

### A-3. Misskey

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-3a | TL ({instance}/) | リアクション・リノート・返信全て1以上 | `div[tabindex="0"]` + article で検出 |
| A-3b | 個別 ({instance}/notes/{id}) | A-3a と別のノート | `location.href` フォールバック |
| A-3c | プロフィール ({instance}/@{user}) | 他ユーザーのノート | プロフィール抽出 |
| A-3d | TL上のリノート | リノートされたノート | renoteCount がAPI経由で取得 |
| A-3e | 個別: リプライ★ | 返信ノート（親プレビュー付き） | **リプライ本人**が保存される（親ノートに化けない）。isReply=true |
| A-3f | 個別: 引用 | 引用リノート（画像のみ引用も） | isQuote=true |
| A-3g | 個別: 複数画像 | 画像2枚以上 | media[] が枚数ぶんDL |
| A-3h | 検索結果 | 任意のノート | 検索文脈でも本人のノートが保存される |

**Misskey 固有の確認**: API補完（screenName=リモートは user@host, displayName, userId, likes=リアクション合計）
**既知の制限**: ノート詳細ページで下部の返信や先祖チェーンをクリックするとメインノートが保存される
（ハイライトで事前に分かる・レコードは自己整合）。ドラッグ保存は対象外（設計）。

### A-4. Mastodon

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-4a | TL (mastodon.social/public/local 等) | 任意の投稿 | .status 検出・同一インスタンスURL |
| A-4b | 個別 (/@user/id) | 画像付き | detailed-status 検出・作者/画像一致 |
| A-4c | プロフィール (/@user) | 他ユーザーの投稿 | プロフィール文脈 |
| A-4d | TL上のブースト | ブースト表示 | 元投稿として保存（ブースト側に化けない） |
| A-4e | 個別: リプライ | 返信投稿 | isReply=true |
| A-4f | 個別: 引用（4.4+）★ | 引用プレビュー内をクリック | **引用した側**が保存される（X/Bluesky/Misskeyと同挙動）。isQuote=true・quotedUrl |
| A-4g | 個別: 複数画像 | 画像2枚以上 | media[] が枚数ぶんDL |
| A-4h | リモート投稿 | 連合で流れてきた投稿 | canonical URL フォールバック（test-mastodon-url.cts の実機版） |

**Mastodon 固有の確認**: screenName=acct（user@host）。ドラッグ保存は対象外（設計）。

### A-5. pixiv

| # | ページ | 選ぶべき作品 | 注目点 |
|---|--------|-------------|--------|
| A-5a | 作品ページ (/artworks/id) | 単ページ作品 | タイトル/作者/タグ/**キャプション(text)** |
| A-5b | 作品ページ: 複数ページ★ | 2ページ以上 | 全ページ原寸DL（pages API・拡張子混在でも404しない） |
| A-5c | 検索/ランキンググリッド | グリッドのサムネ | クリックした作品のIDが保存される（隣に化けない） |
| A-5d | ドラッグ: ページ指定 | 複数ページ作品の2枚目以降 | imageIndex=k/N・そのページの原寸 |
| A-5e | 作品ページ: コメント欄など★ | コメント欄のアバター等をクリック | 作品の figure が保存される（アバターが保存されない） |

**pixiv 固有の確認**: うごイラは対象外（mediaType=image固定・スクショのみ）。R-18はログイン時のみ。

---
