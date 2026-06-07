# Eagle Info+ テストマトリクス

DOM 依存削減 / API ベース移行 (v0.2.0) 後の動作検証用。

## 1. プラットフォーム × シナリオ

### X (Twitter)

| # | 状態 | シナリオ | 操作 | 期待結果 |
|---|---|---|---|---|
| X1 | ✅ | ホームタイムライン・単一画像 | `x.com/home` で画像 1 枚のツイートをドラッグ | Syndication API 呼び出し / annotation に `Platform` / `Display Name` / `Author` / `Hashtags` / `Alt` / `Text`、`Image:` なし |
| X2 | ✅ | ホームタイムライン・複数画像 | 画像 4 枚のツイートで 2 枚目をドラッグ | `Image: 2/4`、alt はその画像のもの |
| X3 | ✅ | プロフィール・メディアグリッド | `x.com/<user>/media` でグリッドから 3 枚目をドラッグ | annotation 完備、`Image: 3/N` |
| ~~X4~~ | — | ~~スレッド詳細・引用ツイート~~ | (実利用しないため検証対象外。引用元の画像保存はユーザー使用範囲外。引用側=外側の画像保存は通常の X1/X2 と同じ経路で動作する) | |
| X5 | 検索結果 (`x.com/search`) | 検索結果の画像をドラッグ | annotation 完備 |
| X6 | 動画ツイート | 動画ポスター画像をドラッグ | annotation 完備 (動画自体の保存可否は Eagle 側次第) |
| X7 | 削除済みツイート | 削除直後のページキャッシュからドラッグ | API 404 → URL 由来情報のみで保存 |
| X8 | 鍵アカウント・ログアウト状態 | シークレットウィンドウでログイン無しにアクセス → 鍵垢の画像をドラッグ | API 401/403 → URL 由来情報のみで保存 |
| X9 | `twitter.com` 旧ドメイン | `twitter.com` でドラッグ | x.com と同等動作 |
| X10 | ✅ | 画像クリック後の**拡大画像 (ライトボックス)** をドラッグ | URL が `…/status/<id>/photo/<n>` のとき content.js が `location` から postId を取る (三段 identity の最優先)。`/analytics` アンカー依存を回避。サムネと同 postId・同画像番号。実機 4/4 検証に内包 |

### Bluesky

| # | 状態 | シナリオ | 操作 | 期待結果 |
|---|---|---|---|---|
| B1 | ✅ | ホームフィード・単一画像 | `bsky.app` でドラッグ | getPostThread API 呼び出し / annotation 完備 (`Author` は `@<handle>` 形式) |
| B2 | ✅ | 複数画像投稿 | 4 枚中 3 枚目をドラッグ | `Image: 3/4`、その画像の alt |
| B3 | | スレッド詳細 | 個別ポスト詳細画面でドラッグ | annotation 完備 |
| B4 | | 検索結果 | `bsky.app/search` 画面でドラッグ | パーマリンクアンカー検出 → API 呼び出し成功 |
| B5 | | プロフィール画面 | `bsky.app/profile/<handle>` でドラッグ | annotation 完備 |
| B6 | | DID 形式 URL | `bsky.app/profile/did:plc:.../post/...` 経由 | `screenName` に DID が入り、API URI も `at://did:.../...` で成立 |
| B7 | ✅ | ハッシュタグ付き投稿 | `#tag` を含む投稿をドラッグ | `Hashtags:` が record.facets から正しく抽出される |
| B8 | ✅ | API 失敗時 | DevTools で `public.api.bsky.app` を Block → ドラッグ | URL 由来情報 (Author handle / link) のみで保存 |

### pixiv

| # | 状態 | シナリオ | 操作 | 期待結果 |
|---|---|---|---|---|
| P1 | ✅ | 単一画像作品 | 個別作品ページで画像ビューアからドラッグ | `/ajax/illust/<id>` 呼び出し / annotation 完備 (`Title` = `illustTitle`、`Author` = `@<numeric userId>`、`Alt` 行なし) |
| P2 | ✅ | 複数ページ作品 | 4 ページ作品で 2 ページ目をドラッグ | `Image: 2/4` |
| ~~P3~~ | — | ~~マンガ (illustType=1)~~ | コード上 illust と挙動が分かれていないため検証意味なし。削除 | |
| P4 | ✅ | ユーザーページサムネ | `/users/<id>` のサムネからドラッグ | 祖先 anchor 経由で identity 取得 |
| P5 | ✅ | 作品ページ画像ビューア | `/artworks/<id>` のビューアからドラッグ | `location.pathname` フォールバックで identity 取得 |
| P6 | | 言語サブパス | `/en/artworks/<id>` 経由 | 同等動作 |
| P7 | ✅ | R-18 作品 (ログイン中) | R-18 作品ドラッグ | credentials が効いて annotation 取得成功 |
| P8 | | R-18 作品 (ログアウト) | シークレットウィンドウで失敗確認 | API エラー、URL 由来情報のみで保存 |

## 2. 横断的シナリオ

| # | 状態 | シナリオ | 期待結果 |
|---|---|---|---|
| C1 | ✅ | **キャッシュ** — 同じ投稿の異なる画像を続けて 2 回ドラッグ | 2 回目は API リクエスト発生せず (Network タブで確認) |
| C2 | | **キャッシュ上限** — 100 投稿超で古いキーが落ちる | 101 件目で先頭エントリが evict (DevTools コンソールで `postCache.size` を確認) |
| C3 | | **拡張機能リロード中のドラッグ** | `chrome.runtime?.id` ガードでエラー無し |
| C4 | ✅ | **Eagle 未起動** | 30 秒タイムアウト、エラー無く終了 |
| C5 | | **Eagle 起動が遅い** | ドラッグ後 10 秒以内に Eagle 起動 → ポーリングで検出され annotation 付与 |
| C6 | | **Eagle へのドロップが極端に遅い** (タイムアウト超過) | 30 秒経過後ドロップ → annotation 無しで Eagle に保存される (既知の挙動) |
| C7 | ✅ | **同時複数ドラッグ** — 同一投稿の複数画像 (or 異なる投稿) を続けてドラッグ | 全枚数が別 item に annotation + 画像番号も各々正しい。`pendingDrags` キュー + `consumed`(tick 内) + `claimedItemIds`(poll 跨ぎ) マッチング。自動テスト `extension/drag-matching.test.mjs` (17 件)。**実機検証済: 4 枚投稿で 4/4・番号 1/4〜4/4 正 (2026-06-06)** |
| C8 | | **Eagle URL マッチ** — Eagle が picture URL ではなく page URL で保存した場合 | `urlMatches` のパス境界一致でマッチする |

---

## 3. 削除した機能の非回帰チェック (旧経路が消えていることの確認)

| # | 状態 | チェック | 期待結果 |
|---|---|---|---|
| R1 | ✅ | `page-context.js` 不在 | manifest にエントリなし、ファイルなし、X ツイート article に `__x-user-id` 属性が付かない |
| R2 | ✅ | DOM scraper 削除 | content.js に `data-testid` が一切登場しない (`grep data-testid content.js` で 0 件) |
| R5 | ✅ | manifest host_permissions | `cdn.syndication.twimg.com` と `public.api.bsky.app` のみ、`page-context.js` 系は無し |

---

## 3.5 自動テスト (machine-checked)

実機ドラッグを要さず `node` で回せる回帰テスト。手動シナリオの前段の安全網。

| ファイル | 対象 | 実行 |
|---|---|---|
| `extension/drag-matching.test.mjs` | ドラッグ↔Eagle item マッチング (`urlMatches` / 2 段マッチ / `consumed`(tick 内) / `claimedItemIds`(poll 跨ぎ cross-tick) / 注釈済みスキップ / マッチ窓)。**C7「同時複数ドラッグで全枚数に付く」を固定** (17 件) | `node extension/drag-matching.test.mjs` |
| `shared/*.test.mjs` | annotation parser / store / SNS client / 同期 (sync-eagle・sync-engagement) | `node shared/<name>.test.mjs` |

> マッチングロジックは `extension/background.js` から `extension/drag-matching.js` (ESM) に切り出してテスト可能にした (service worker は `manifest.json` の `"type": "module"` でモジュール読み込み)。**自動テストが緑でも C7 等の実機検証は別途必要** (DOM ドラッグ・Eagle ポーリング・API 応答の実挙動は対象外)。

## 4. 検証手順テンプレ

各シナリオで毎回踏む手順:

1. `chrome://extensions/` で Eagle Info+ を再読み込み (↻)
2. 拡張カードの **service worker** をクリックして DevTools を開く (Network + Console タブ表示)
3. 対象サイトを開き、対象画像をドラッグ → Eagle ウィンドウへドロップ
4. **Network タブ**: 該当 API (`cdn.syndication.twimg.com` / `public.api.bsky.app` / `pixiv.net/ajax/illust`) のリクエスト/レスポンスを確認
5. **Eagle**: 保存されたアイテムを開き、Notes (annotation) と URL を確認
6. 失敗系は Network タブの右クリック → **Block request URL** で該当 API を遮断後に再試行

---

## 5. 優先度

| 優先度 | テスト |
|---|---|
| 必須 (リリース前) | X1, X2, X3, B1, B2, P1, P2, P5, C1, C4, R1, R2 |
| 推奨 | X7, X8, B7, B8, P4, P7, P8, C5, C7 |
| 余裕があれば | X5, X6, X9, B3, B4, B5, B6, P6, C2, C3, C6, C8, R5 |
