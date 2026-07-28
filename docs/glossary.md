# Hologram 用語集

Hologram 固有の概念を「UI に出す日本語」と「コード・文書で使う英語」の対で引く表。**用語についてはこの文書が正**で、決定に至った経緯は決定記録の Issue / ADR に残っている。

載せるのは Hologram 固有の概念だけ（一般的な技術用語・エコシステムの既存語は載せない）。**新しい語をここで作らない**＝足せるのは、対応する Issue か ADR で用語と意味が確定した語に限る。この表を編集しただけでは命名は成立しない。

改名するときはこの表を検索の出発点にできるが、コード全数照合の代わりにはならない。初名の焼き付き（PostSnap 由来の `psimg://`・#265）のような、表に語として載らない残り方をするものがある。

## 確定した用語

UI に出さない開発用語は日本語の欄を `—` にする。

| UI の日本語 | コード・文書の英語 | 意味 | 決定記録 |
| --- | --- | --- | --- |
| ライブラリ | library | 保存先フォルダ1つ分の保存物の全体（既定 `~/Hologram/library`）。固有語（Obsidian の vault のようなメタファー）は立てず、一般語のまま用語として使う | [#176](https://github.com/apricot-cake/hologram/issues/176#issuecomment-5020571660) |
| — | 原本 / raw payload | 取得の過程で手元に来た応答を、加工せずそのまま保存したもの（DB の `raw_payloads`）。「元データ」「生 JSON」等では呼ばず、UI に出す面はまだ持たない | [ADR 0011](decisions/0011-preserve-acquisition-payloads.md) |
| — | extractor | サイト別のメタデータ抽出モジュールの総称。和訳語（「抽出器」等）は立てず英語のまま書き、和文では初出でだけ「サイト別のメタデータ抽出モジュール」と補う。ユーザーが読む面には出さず「対応サイト」で表す | [#212](https://github.com/apricot-cake/hologram/issues/212#issuecomment-5020507758) |

## 固有名を付けない領域

同ドメインの標準（同種の製品・公式ドキュメント）が固有名を持たない領域には、こちらも付けない。使うのは下表の一般語で、これらは用語ではなく普通名詞として読む。再検討するときは、当時の照合結果を上回る材料を添えて別 Issue で行う。

| 領域 | 使う一般語 | 付けない理由 | 決定記録 |
| --- | --- | --- | --- |
| 保存物に添えるメタデータ JSON | サイドカー / sidecar（`<captureId>.json`） | yt-dlp も `.info.json` と機能語だけで形式名を持たない。名前の付いた交換形式が要る役は XMP 書き出し（#57）が担う。**ライブラリ内の置き場としては #302 で退役**＝メタデータの正本は DB で、この語が指すのは完全ZIP が DB から再生成する `library/<captureId>.json` とゴミ箱の per-item レコードだけ | [#264](https://github.com/apricot-cake/hologram/issues/264) |
| 拡張と保存先をつなぐ常駐プログラム | Native Messaging ブリッジ / bridge（`native-host/`） | Chrome 公式ドキュメントの "native messaging host" が既に総称になっている。その上に固有名を重ねない | [#264](https://github.com/apricot-cake/hologram/issues/264) |
| 検索とファセットの機構 | 検索 / search・ファセット / facet | 機構そのものに固有名を持つ同種製品が見当たらない（照合結果は #264）。将来ユーザー向けの検索構文へ名前を付ける場合の器は、#260 の却下案（LoQL の保留）にある | [#264](https://github.com/apricot-cake/hologram/issues/264) |
| デザイン語彙（面の質感・部品の呼び名） | shadcn / Base UI の語をそのまま | デザイン語彙の公開命名例はプラットフォームや組織の規模のもので、単一アプリの例が見当たらない（照合結果は #264）。素の shadcn ルックを採る決定と揃える | [ADR 0006](decisions/0006-plain-shadcn-look.md) |
