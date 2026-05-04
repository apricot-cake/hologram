# Engagement Browser

Eagle Window Plugin。ライブラリ内のアイテムを SNS API から取得した engagement (likes / views / reposts 等) でフィルタ・ソートして閲覧する。

データは [Eagle Info+ Chrome 拡張](../extension) が annotation に書き込んだ post permalink を起点に取得する。

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
- `Min likes` / `Min views`: 各値以上の record のみ表示

## ボタン

- `Sync from Eagle`: ライブラリ全件と store を diff し、変更分の annotation を再 parse。getIdsWithModifiedAt → batched (200) getByIds → upsert
- `Fetch engagement`: status=parsed/synced の record に対して各 SNS API を叩き、likes 等を埋める

## 起動時

`plugin-create` で store を load、即座に grid 描画 (cache-based startup)。Sync は手動。
