# Engagement Browser

Eagle Window Plugin。ライブラリ内のアイテムを SNS API から取得した engagement (likes / views / reposts 等) でフィルタ・ソートして閲覧する。

engagement は各アイテムの `url` (SNS 投稿パーマリンク) を起点に取得する。`url` は [Eagle Info+ Chrome 拡張](../extension) が書き込むほか、公式の Eagle for Chrome で保存したアイテムにも付くので、注釈の有無に関わらず URL さえあれば取得できる。

## ストレージ

サイドカー DB は `<library>/plugin-data/engagement-browser.json` に保存。Eagle のライブラリ自体は触らず、独立した JSON を持つだけ。Phase 2 では 9000 件規模の library で配列スキャンが ms 単位なので index 不要。

## Sort オプション

### `Likes (ranked)` — デフォルト

各 platform 内で likes 順に並べ、percentile (0〜1) を score にして全 platform 横断で混ぜる。各 platform の上位が同じ高さに並ぶので、likes の絶対値文化が違う SNS (X は 10k 当たり前 / Bluesky は 100 でもバズ / pixiv は bookmark 文化) を「自分の platform でどれくらい上位か」基準で比較できる。

計算式 (platform `p` 内で likes 降順に並べた時の `i` 番目 / 0-indexed / `n` 件中):

```
percentile = n > 1 ? 1 - i / (n - 1) : 1
```

各 platform の最上位が `1.0`、最下位が `0`、その間を線形補間。

例: X 3 件 (10k / 5k / 1k likes), pixiv 2 件 (5k / 100 likes) があるとき:

| Item | Platform | Likes | Rank | Percentile |
|---|---|---|---|---|
| A | X | 10000 | 1/3 | 1.0 |
| B | pixiv | 5000 | 1/2 | 1.0 |
| C | X | 5000 | 2/3 | 0.5 |
| D | pixiv | 100 | 2/2 | 0.0 |
| E | X | 1000 | 3/3 | 0.0 |

→ Grid 上では A, B が同列で先頭、その後 C、最後に D と E (順序不定) が並ぶ。

トレードオフ:
- 上位は圧縮される (top 1% も top 0.01% も同じ `1.0`)。バズった作品が突き抜けて見える表現は弱い
- platform 内件数が少ない (~7 件) と percentile が荒い (0.0 / 0.17 / 0.33 / ... の段階的)
- 件数が増えると log 正規化方式の方が表現力高くなる想定だが、現状は shipping 優先

### `Likes (raw)`

Likes 数の絶対値で降順。X の 10k tweet と pixiv の 100 likes 作品を素直に並べるので、各 platform の絶対人気度を見たい時用。`Platform` フィルタと併用するのが実用的。

### `Recently modified`

Eagle の `modifiedAt` 降順。「最近 Eagle に追加 or 編集したアイテム」の確認用。Engagement と別軸。

## Filter

- `Platform`: `x` / `bluesky` / `pixiv` で絞り込み
- `Status`: 下記参照
- `Min likes` / `Min views`: 各値以上の record のみ表示

## Status

各 record は以下のいずれかの status を持つ。Status フィルタで切り替えて確認する。

| Status | 意味 | リトライ |
|---|---|---|
| `synced` | SNS API から engagement (likes 等) を取得済み。**Engagement Browser の主用途** | 再フェッチで最新化可 |
| `parsed` | Info+ の annotation を parse できたが engagement 未取得。同期直後の中間状態 | 「エンゲージメントを取得」で `synced` に昇格 |
| `error` | SNS API が想定外エラー (5xx / ネットワーク / JSON parse 失敗 等) を返した | retry で復活する可能性あり。`errorMessage` がカードの tooltip に出る |
| `deleted` | SNS 側で投稿削除済み (404 等)。最終フェッチ時の engagement は **温存される** (historical snapshot として参照可能) | retry しても無駄 |
| `private` | アクセス権なし (X 鍵垢の 401/403、pixiv R-18 ログアウト時の error body 等) | ログイン直せば retry で復活可能 |
| `no-annotation` | Info+ の annotation がない (Phase 1 以前の保存、対応外サイトドラッグ、公式 Eagle for Chrome の素ドラッグ 等) | SNS の URL を持つものは「エンゲージメントを取得」の対象になる |

`deleted` / `private` でも engagement の数値フィールドは上書きしない (空 object を upsert するため)。「削除前最後のスナップショット」として読める。

## 操作

ツールバーは **「エンゲージメントを取得」ボタン1つ**だけ (UI 簡素化のため。同期・スコープ・バックフィル・再開・キャンセルの個別ボタンは廃止)。

- **同期は起動時に自動実行** — プラグインを開くと、ライブラリ全件と store を差分同期する (getIdsWithModifiedAt → batched 200 getByIds → upsert)。約 9000 件でもミリ秒。手動同期ボタンは無い
- **「エンゲージメントを取得」** — **まだ一度も engagement を取得していない・SNS の URL を持つアイテム**を取得する。対象は status が `parsed` (Info+ 注釈あり) と `no-annotation` (URL のみ) の両方。**取得済み (`synced`) は触らない**ので、押すたびに未取得分が減っていく。取るものが無ければ「取得が必要なアイテムはありません」と表示
- 実行中はボタンが**赤い「中止」**に変わり、もう一度押すと止まる。**中断しても未処理はその status のまま残る**ので、次に押せば自然に続き (再開ボタンは不要)

### レート制限 / 安全装置

X の取得は非公式の Syndication API を叩くため多重に保護している:

- **間隔**: X は 1 並列 / **2.5〜3.5 秒間隔** (2.5 秒 + 最大 1 秒のジッタ)。Bluesky / pixiv は 4 並列。platform 同士は並行
- **429 で即停止**: X (429 / 420)・Bluesky・pixiv のいずれかでレート制限応答が来たら run を止める。その record は `error` にせず未取得のまま残し、時間を置いて再実行すれば続きから
- **日次上限**: 1 日あたりの取得リクエストを platform 別に制限 (既定 X = 500/日)。端末の暦日でリセット。超過分は翌日へ繰り越し。`store.data.dailyFetch` に永続化
- **大量時の確認**: X の対象が 200 件を超えると、取得前に確認ダイアログを出す

> 公式のレート制限値は非公開。上記は保険であり「何秒空ければ安全」という保証は無い。数千件は日を分けるのが無難 (README ルート方針: クロール用途・大量取得には使わない)。

## 表示言語

UI は `eagle.app.locale` を見て日本語 / 英語を自動切替する (`ja` 始まりなら日本語)。文字列は index.html 内のインライン辞書。

## 起動時

`plugin-create` で store を load → キャッシュから即グリッド描画 → 自動同期 → 再描画 (cache-based startup)。
