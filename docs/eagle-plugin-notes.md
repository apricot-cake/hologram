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

### Item の `thumbnailURL` / `fileURL` は絶対パス — ライブラリ移動で stale る
`item.thumbnailURL` `fileURL` `filePath` `thumbnailPath` はすべて**現在のライブラリ位置を含む絶対パス** (`file:///.../<lib>.library/images/<id>.info/<file>`)。これをサイドカー DB にキャッシュすると、PC 移行などでライブラリフォルダが移動した後に**古いパスを指したまま**になり、`<img src>` が `net::ERR_FILE_NOT_FOUND` で表示できない (実機: 約 9000 件中 8983 件が旧パスのまま黙って真っ黒になった)。`modifiedAt` 差分 sync は中身が変わらない item を再取得しないので、移動後も大半が旧パスで残り続ける。

- 対策: 絶対パスをそのまま使わず、相対部分 (`images/<id>.info/<file>` — 移動で不変) を抽出して現在のライブラリパスから組み直す。file URL 化は `require('url').pathToFileURL` が encode 込みで安全 (日本語・スペース・`—` 等を含むファイル名でも壊れない)。
- file:// プロトコル自体は Eagle plugin renderer で問題なく読める (現ライブラリ由来の thumbnail は OK、旧パスのみ FAILED)。CORS や local resource ブロックではない。

### `location.reload()` で `onPluginCreate` が再発火する (hot-reload 可)
プラグイン renderer で `location.reload()` すると、再読込後に `eagle.onPluginCreate` が**もう一度呼ばれる** (実機確認)。これを利用して、nodeIntegration の `fs.watch` で plugin ディレクトリと `shared/` を監視し `.html/.js` 変更で `location.reload()` する dev 用 live-reload が成立する (手動の開き直し不要)。

- 注意: ログ等の書き込み先を監視対象に含めると**リロードループ**になる。出力は監視外 (`.debug/` = repo 直下、plugin-window の外) に置く。
- `eagle.plugin.path` (= onPluginCreate の引数 `plugin.path`) が plugin ディレクトリ。`shared/` はその親の下。
- ただし reload で再発火するのは **plugin-create イベント**であって、API メソッドが即使えるわけではない (下記)。init は必ずイベント駆動にすること。再表示復帰のため `onPluginRun` / `onPluginShow` も bind してよいが、**`onPluginShow` は plugin-create より前に発火することがある** (下記の罠) ので、show から無条件に API を呼んではいけない。

### `eagle.*` API メソッドは `plugin-create` イベント後でないと使えない（最重要・実機で判明）
`eagle.library.info()` `eagle.item.*` などのデータ API は、**`plugin-create` 発火前に呼ぶと reject される**。実機メッセージ:
`This method can only be used after the \`plugin-create\` event is triggered.`
await していても解決せずハングする場合があり、UI は真っ暗のまま残る。

- `eagle` グローバル自体は inline `<script>` 実行時点で**既に注入されている** (`typeof eagle === 'object'`)。**未準備なのは「eagle」ではなく「plugin-create イベント」**。「eagle が undefined だから生えるまでポーリング」という発想は誤り (実際にこれで遠回りした)。
- よって初期化 (`eagle.library.info()` を呼ぶ処理) は**plugin-create 後のイベントから駆動**する。module 読込直後に即 init して API を早撃ちしてはいけない。
- **真っ暗を招いた NG パターン** (実機で再発):
  - スクリプト最上位で `if (typeof eagle === 'undefined') {…} else { 全処理 }` と分岐し、未準備の一瞬に読まれると諦めて二度と復帰しない (リトライ無し)
  - plugin-create を待たず `init()` を即時/ポーリング呼び出しして `eagle.library.info()` を早撃ち → reject/ハング
  - `init()` 内で await (initStore / 描画) 完了**前**に `inited = true` を立てる → 途中で throw すると以降のライフサイクルイベントが `if (inited) return` で全部弾かれ、リロードなしには復帰不能
  - **`onPluginShow` から無条件に init** → show は create に**先行発火しうる** (実機で確認) ので pre-create で `eagle.library.info()` を叩いてハング。さらに `initRunning` が立ったままになり後続の onPluginCreate も弾かれて詰む
- **正しい型**: init はイベント駆動。**`pluginCreated` フラグ (onPluginCreate / onPluginRun でのみ立てる) でゲート**し、未 create のうちは API を叩かず抜ける。onPluginShow は create 済みのときだけ init を通す (再表示復帰用)。多重/同時起動は `inited` + `initRunning` でガードし、**`inited` はグリッド描画成功後に立てる** (それ以前で throw したら false のまま → 後続イベントで再試行できる)。

### プラグインページは `eagleplugin://` スキームで読み込まれる（`file://` ではない）
`window.location.href` の例:
`eagleplugin://<plugin-id>//C:/Users/<name>/…/plugin-window/index.html?theme=DARK&locale=ja_JP`

- pathname が `//C:/…` と**先頭スラッシュ過多**になり、ここから OS パスを組むと `\\C:\…` のような不正パスになって `fs.mkdirSync`/`writeFileSync` が `UNKNOWN` で失敗する。
- **ファイルパスは `window.location` から導出せず、`eagle.plugin.path` を使う**。正しい OS パス (`C:\Users\<name>\…\plugin-window`) を返し、しかも plugin-create 前 (module 読込時点) でも読める — ゲートされた API メソッドではなく単なるプロパティ参照のため。
- この罠でデバッグログが壊れたパスに書かれて出力されず、原因究明が大幅に遅れた。ログ先は `eagle.plugin.path` から `../.debug` を作るのが堅い。

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
