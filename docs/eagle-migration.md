# Eagle → Corpus データ移行 設計（確定版）

> 多エージェント解析（実データ・安全設計・敵対的検証）の結論を補正して確定したもの。
> 実装は **Phase F**（Phase C スキーマ＋Phase D 目視検証の後）。ただし「イラストレコード形」と
> 非JPEG主画像サポートは**ドラッグ保存（§4b）と共通の基盤**なので先に入る。

## 0. 大前提（安全性・絶対条件）
- **Eagle ライブラリは読み取り専用**。画像は**コピー**（move/削除しない）。`C:\Users\apricot\ローカル\絵\資料.library`。
- **ドライラン既定**（`--apply` なしは1ファイルも書かない）。**冪等**（再実行で重複なし）。**既存サイドカー上書き禁止**。**照合監査**で取りこぼし検出。

## 1. 実データの現実（検証済み）
- `engagement-browser.json` 9009件中 **url 保有 942件** が移行候補。レコードキー = Eagle item id。
- **`platform` フィールドは 839/942 が空** → **URLから `parsePostUrl` で判定必須**（storeを信用しない）。
  - parse内訳: x:845, bluesky:23, pixiv:14, misskey:2, **parse不可:58**（プロフィール/検索/生CDN/動画/非対応サイト）。
- **rich data は 103件のみ**（synced90 + parsed13）。残り **839件(no-annotation) は url とファイル情報だけ**で、
  **Eagle側 .info/metadata.json の annotation も空** → author/text/engagement は **store からもEagleからも取れない**。
- 画像実体: `<lib>/images/<id>.info/<name>.<ext>`（`name`+`ext` は store record 由来。`name` 埋め込み拡張子は信用せず **record.ext を採用**）。
- **ファイル名衝突**: 多ページ投稿は各ページが同名（例「画像.jpg」）。最悪は1ツイートに9 item 全部「画像.jpg」。
  → **コピー先は Eagle item id でキー付け**（名前で名付けない）。
- svg(4)+mp4(3)=**7件は psimg が描画不可** → 除外。

## 2. イラストレコード形（ドラッグ保存と共通・確定）
スクショの無いイラストを表すレコード。**ドラッグ保存（§4b）も Eagle 移行もこの形**：
- `captureId` = `eagle-<eagleItemId>`（移行）／`drag-<epochish>`（ドラッグ）。live capture の `epochMillis-hex` と衝突しない。
- `image` = **`<captureId>.<ext>`**（原画の拡張子を保持：png/webp/jpg/gif）。`<lib>/images/<id>.info/<name>.<ext>` をコピー。
- **`media` = `[]`**（空）。画像自体が本体。`image===media[0].file` にするとライトボックス二重表示になるため入れない。
- `mediaType` = `'image'`。

### 必須の Corpus 基盤修正（非JPEG主画像サポート）
post-snap は「`image` は常に `<captureId>.jpg`（スクショ）」前提。イラストは png/webp 等なので：
- `app/main.js` `delete-post`／`update-tags` の base 導出を **`.jpe?g` 限定 → 任意の画像拡張子除去**に
  （`/\.(jpe?g|png|webp|gif)$/i`）。さもないと delete がサイドカーを孤児化、tag編集が幽霊ファイルへ向かう（**サイレントデータ損失**）。
- `delete-post` は主画像を**拡張子問わず**削除対象に含める。
- これは**ドラッグ保存にも必須**なので、ドラッグ保存実装時に同時に入れる。

## 3. フィールドマッピング（store record → Corpus サイドカー）
| Corpus | 由来・ルール |
|---|---|
| platform | `source.platform` があれば優先、無ければ `parsePostUrl(url)`。parse不可58件は `null`（旗立て） |
| url | `source.url` をそのまま |
| text / title | `source.text`（X/Bsky本文）／`source.title`（pixiv作品名） |
| displayName | `source.displayName` |
| screenName | `source.author`（pixivはuserId、X/Bskyは@除去済みhandle） |
| userId | pixiv=`source.author`、X/Bskyは store に無く `null`（捏造しない） |
| likes/replies/views/bookmarks/reposts | `source.*` をそのまま（無ければ null。0に丸めない） |
| hashtags / tags | `source.hashtags`（#除去済）／`source.tags`（Eagleユーザータグ。56件のみ非空） |
| date | `source.publishedAt`(epoch ms)→ISO。無ければ capturedAt |
| capturedAt | `source.modifiedAt`(epoch ms)→ISO。**item毎にユニーク化**（同値だと viewer 選択キー `url\|capturedAt` で兄弟が巻き込み削除される）。例: modifiedAt + (item id ハッシュ %1000)ms |
| lang / isReply/isQuote/isThread/quotedUrl | store に無し → null |
| status/engagementSyncedAt/quotes/fetchSchemaVersion | Phase C スキーマ採用後のみ pass-through。未採用なら defer |

**enrich 方針（重要）**: 103件は store の rich を使う。**781件の no-annotation は移行時にAPI再取得しない**
（X 845件は日次上限500を超える）。最小サイドカー（url+image+platform+tags）で作り、author/text/engagement は
**Phase C のレート制限付きバックフィルに委ねる**（移行とenrichを分離）。

**多ページ**: 1 Eagle item = 1 サイドカー（マージしない。各 .info は独自id・独自Eagleタグ。image-viewはurlでグループ化）。

## 4. CLI / 手順
- `node scripts/migrate-eagle.js`（**ドライラン**）: 候補数・platform別・画像解決可否・skip予定（既存）・サンプル5件・書込予定ファイル名一覧を表示、**書込なし**。
- `--apply`: 実コピー＋サイドカー書込。**書込先 = `%APPDATA%/Corpus/config.json` の saveFolder**（未設定なら**中断**。既定`~/Corpus`に黙って書かない）。
- `--verify`: 監査。`942 == 103(rich) + 781(parse可no-anno) + 58(parse不可)` を assert。各 item で画像バイトサイズ一致・`platform === parsePostUrl(url)` を検証。eligible == migrated+skipped+failed(理由付き)。不一致で非0終了。
- 書込順: 画像コピー → temp サイドカー → rename（クラッシュ耐性）。EEXIST はサイズ検証 or temp-then-rename。

## 5. 残課題
- 58件の non-post URL: `platform:null` の画像レコードとして移行（旗立て）か、フラグでゲートか → 実装時に確認。
- `--apply` 前に Corpus save フォルダのバックアップ推奨。
