# Eagle Plugin 開発メモ

公式ドキュメント (本文の引き写しはしない、参照だけ残す):
- Plugin API トップ: https://developer.eagle.cool/plugin-api/
- Lifecycle events: https://developer.eagle.cool/plugin-api/api/event
- `eagle.item`: https://developer.eagle.cool/plugin-api/api/item
- 全文: https://developer.eagle.cool/plugin-api/llms-full.txt

---

## 実機で確認した surprising な挙動

### `eagle.item.get({ limit: N })` の `limit` は黙殺される
公式が列挙する受け付けキー (`id` `ids` `keywords` `tags` `folders` `ext` `rating` `shape` `annotation` `url` `isUntagged` `isUnfiled` `fields` `isSelected`) 以外は無視される。`limit: 1` を渡したつもりでライブラリ全件 (約 9000 件規模) が返ってきた。件数制限したいなら `getById` / `getByIds` か、結果配列を `.slice` する。

### Item インスタンスは `JSON.stringify` で `{}` になる
プロパティが non-enumerable。デバッグで `JSON.stringify(item)` するとプロパティが消えるので、`item.id` `item.annotation` のように直接読む。

### `eagle.library.info()` の戻り値はフラット
`info.path` 直下に入る。`info.library.path` の入れ子ではない。

### Item プロパティ名は metadata.json と一致しない
metadata.json (ディスク上の生 JSON) と Item インスタンス (`eagle.item.get()` が返す) でプロパティ名が違うものがある:

| metadata.json | Item インスタンス | 備考 |
|---|---|---|
| `modificationTime` | `modifiedAt` | ms timestamp |
| (なし) | `importedAt` | 取り込み時刻 (ms) |
| (なし) | `metadataFilePath` | metadata.json への絶対パス |
| (なし) | `filePath` `fileURL` `thumbnailURL` | ファイル系の派生パス |

Phase 2 の同期キーには **`modifiedAt`** を使う (todo.md の `last_synced_at` 比較対象)。

### Item インスタンスには getter プロパティ + メソッドが混在
`'star' in item` は true でも値は `undefined` (未設定の場合)。プロパティの `in` チェックだけでは存在判定にならない。Item の主要メソッド: `save()` `moveToTrash()` `addComment()` `refreshThumbnail()` `open()` など。

### `eagle.item.getByIds()` は大量 ID で暗黙に失敗する
約 9000 件の ID を一度に渡すと **空配列がすぐ (~20ms) 返る**。エラーは投げない、警告も出ない。**200 件ずつ batch で投げる**と全件取れる (200×45 batch = 196ms で完了)。Phase 2 の sync で発覚。閾値の正確な値は未確認だが 200 は安全。

### Eagle Plugin の fetch は CORS 制限を受けない
普通の web ページの `fetch` だと CDN や API 側が CORS ヘッダ返さないとブロックされるが、Eagle Plugin (Electron renderer with nodeIntegration) では `cdn.syndication.twimg.com`, `public.api.bsky.app`, `www.pixiv.net/ajax/illust` を素直に呼べる。Phase 2 の engagement 取得で実機確認 (54 件全成功)。

### pixiv non-R-18 は cookie 不要
`/ajax/illust/<id>` はログインなしでも 200 + 実 engagement を返す (実機 7 件で確認)。R-18 のときの挙動は未確認 — 仮説: 非ログインだと `error: true` ボディで `private` 扱いになるはず。

---

## 環境メモ

実機検証はローカル環境で実施。再現の参照値として:

- Eagle バージョン: 4.0.0
- ロケール: ja_JP
- ライブラリ規模: 約 9000 件 (パフォーマンス計測の参照値)
- Eagle の REST API: ローカルの既定ポート (`localhost:41595`)

> 個人パス・実ライブラリ名など、このマシン固有で外部に出したくない値は公開リポであるここには書かない (CLAUDE.md の方針)。

---

## パフォーマンス計測 (実機 約 9000 件規模)

| API | 所要時間 | 戻り値 |
|---|---|---|
| `eagle.item.getIdsWithModifiedAt()` | 11 ms | `{id, modifiedAt}[]` (素の object) |
| `eagle.item.getAll()` | 118 ms | Item インスタンス配列 (約 10x 遅い) |
| `getAll().map(it => [it.id, it.modifiedAt])` | 1 ms (getAll 後) | id + modifiedAt 抽出 |

**Phase 2 の sync diff 検出は `getIdsWithModifiedAt()` を使う**。詳細データが必要な item だけ `getByIds([...changed])` で個別取得。

## カウント不整合

`eagle.item.countAll()` が `getAll().length` より **19 件多い** (約 9000 件規模で確認)。原因未確定 (trashed items? `isDeleted: true` のフィルタ差?)。Phase 2 で sync 対象を判断するときは `getIdsWithModifiedAt()` の length を真と扱うことになる見込み。

## Eagle Plugin の Node 統合 (実機確認)

完全に Node 統合された Electron renderer。`require` `process` `Buffer` がそのまま global で使える:

```
process.versions.node = "18.17.1"
process.versions.electron = "10.8.168.25" ※ 実態は modules: 110 で Electron 22 系
require('fs') / require('path') / require('os') ✓ 動作
```

→ サイドカー DB は **JSON file + fs.writeFileSync** で十分。better-sqlite3 や sql.js は不要 (約 9000 件規模なら配列操作で ms 単位)。ネイティブモジュールは Eagle 同梱の Electron 版に合わせて rebuild が必要なので避けたい。

## 未解決 / 要調査

- countAll vs getAll の 19 件差の正体
