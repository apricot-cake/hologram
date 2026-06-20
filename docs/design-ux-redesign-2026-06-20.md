# Corpus UX再設計 — 設計確定メモ（2026-06-20）

**状態: 設計確定**（DQ1–DQ8 全確定・2026-06-20）。実装は手で or worktree 分離（corpus は viewer.js/index.html 集中＋実機CDP1本ゆえ実装の並列化は限定的）。

## 背景

BACKLOG「UX再設計の指摘（2026-06-20）」のタグ付けUX＋ナビ/検索を、ultracode（多角設計→判定→統合→批評）で設計確定する作業。2本のワークフローを実施:

- **A=設計**（現状調査→複数案→判定→統合→批評）。run `wf_36c08bf6-44c`。批評の総合判定は needs-revision（下の「実装前に解く論点」で解消）。
- **B=viewer.js 健全性レビュー**（5レンズ→敵対的裏取り→優先度化）。run `wf_68bac9c6-660`。確定27件→17項目（P0=1/P1=6/P2=10）。

本メモは**ユーザーが確定した決定**を記録（設計案そのものは A、コード健全性は B が真実源。temp 出力は揮発するため要点を本書に保全）。

---

## 確定した決定（DQ1–DQ6）

### DQ1 スタンプ軸の廃止 — 確定: **全廃して2本に集約**
- タグ付けを **①インスペクタでのカード編集（実装済み）＋②複数選択→一括付与** の2本に集約。スタンプ軸（1タグ装填→連続クリック付与）と軸トグルを撤去。
- 前例: Finder/写真.app の選択モデル（クリック選択・Shift範囲・Cmd+A 全選択→まとめて属性適用）。Lightroom の Painter は補助で本道ではない。
- 失う価値「絞り込み→部分集合にまとめて付与」は **Shift範囲選択・全選択・一括追加（いずれも実装済み）** で回収＝新規実装ほぼ不要。
- 撤去対象（A 調査より）: viewer.js の loaded/loadTag/stampCard/refreshMarks/clearMarks/renderPalette/setAxis/applyAxis/AXIS_KEY と参照、index.html の `#tagAxisToggle`/`#tagStampZone`/`#tagLoadedLabel`、CSS `.tag-pal-*`/`.stamp-on`/`.tag-axis-toggle`・`body.tagging-stamp` 分岐・カード `cursor:copy`・サイドバー差し替えCSS。refreshMarks 呼び出し残骸（viewer.js 2870/2992）も外す。

### DQ2 軸トグル廃止＋タグ編集の導線 — 確定: **ホバー3個目にタグ編集ボタン（原則撤回）**
- **DESIGN.md「ホバーは⚡ℹ の2個まで・3個目却下」を撤回**し、カードホバーに**タグ編集グリフ**を追加（⚡ℹ＋タグ＝3個）。**「最頻3個まで」を新しい上限**として明記。
- 撤回の根拠: 却下の元理由 L133「タグ付けは“モード”で解くから足さない」が、DQ1 でモードを廃止する以上**前提ごと消える**。かつタグ付けはこのライブラリの最頻操作（[library-composition] 参照・約7600枚が無タグ）＝原則の頻度基準に素直に従えばホバーに乗る資格がある。
- 前例: Google フォト／Pinterest のホバー・クイックアクション（2〜3個が定石）。**3を天井とし4個目以降への漸進は禁止**。
- **A synthesis の上書き点**: A は「2個死守・tagStartBtn 昇格 or モードレス」を前提にしていたが、ユーザー判断でホバー3個目を採用。→ **tagStartBtn 昇格は不採用**（サイドバー先頭スロットの取り合いも自動解消＝下の論点1）。
- 帰結: タグ付けは**完全モードレス**化（ホバーのタググリフ→そのカードのインスペクタでタグ編集／複数選択→一括モーダル）。`body.tagging` 系の常設モード機構は大幅縮小/撤去できる可能性（実装時に精査）。

### DQ3 一括モーダルの作品/キャラ種別の視覚区別 — 確定: **フル（集約＋バグ2件修正）**
- 種別ドット（作品=紫/キャラ=緑）を**共有 `renderTagPicker` の chip()（viewer.js 4054）に1か所移植**→ インスペクタ編集と一括モーダルの両方で一貫。共起候補（4065）・ソース行（4072）も同じ chip() を通す。
- **同時修正の潜在バグ2件**（A が実機確認済み）:
  - 共有ピッカー自体に種別ドットが無い（インスペクタ編集でも実は未表示）。
  - 一括モーダルのボタン（tagSelectedBtn 4270–4281）が `renderEditPicker()` を呼ばず**ピッカー未描画**＋ `editPickQuery` 未リセット。
- 前例: danbooru/Eagle のカテゴリ色分け（DESIGN.md L58 が `--tint-*` を許可済み）。CSS は `.edit-pick-chip{display:inline-flex;align-items:center;gap:5px}` の1行追加のみ（`.tag-pal-kind`/`.tk-*` は既存）。

### DQ4 タグのピン留めセクション — 確定: **全部消す（UI＋データ即時削除）**
- ピンの**描画・入口UI・データ（PIN_KEY/PIN_KEY_LEGACY）をすべて削除**。スマートフォルダへの移行素材は残さない（ユーザー判断＝付け直しでよい）。
- **A synthesis の上書き点**: A は「段階撤去＝データ温存」を推したが、ユーザーは完全削除を選択。
- 撤去対象: index.html `#pinnedSection`（1763）・`body.browse-posters #pinnedSection` 非表示CSS（674）、viewer.js のピン描画ブロック・`sbPinnedTags` ハンドラ・`renderQfPop` の `qf-pin` スパン/クリック分岐・`PIN_KEY`/`PIN_KEY_LEGACY`/`loadPins`/`togglePin`/`isPinned`、i18n の `pinnedTags`/`tipPin` と `sbPinTitle` 参照。
- DESIGN.md「ピン＝ユーザー制御の常駐化・頻度ベース自動表示は不採用」は、撤去後も**頻度自動表示は復活させない**点だけ維持（スマートフォルダ実装時に常駐化の文言を更新）。

### DQ5 投稿/投稿者切替をサイドバーへ — 確定: **テキスト2行（スコープ行）**
- コンテンツ上部の browseMode トグルを、**サイドバー上部の「スコープ行」2択**（枠なしテキスト行＋行頭アイコン・選択は `--accent-subtle` 地のモノトーン・件数バッジ無し＝状態であって件数でない）へ移設。セグメント（つまみ）丸ごと移設は不採用。
- 前例: Things3／メール.app／Finder のサイドバー上部スコープ行（DESIGN.md 色節が Things を「ナビ選択はグレー」前例として明示）。既存 `.pf-row.active`/`.sb-row`/`.ws-row.active` が枠なし行＋ホバー塗り＋行頭アイコン＋モノトーン選択を実装済み。
- 機構: `#controls-posts .sb-scroll` 先頭の単一 `.sb-section` に `.sb-row` を2本（`data-mode=posts/posters`・行頭は現 browseBar の lucide アイコン流用）。browse 専用 `positionViewThumb`/`.vt-thumb`/ResizeObserver は browse 限定で撤去（**共有機構は壊さない**＝下の論点2）。段階的開示: 投稿者0なら「投稿者」行ごと隠す（`buildUsers().length>0` ガードを移植）。区切り線・追加見出しは引かない（`.sb-section` 律動22–26px だけで分離）。

### DQ6 「投稿」「投稿者」の改名 — 確定: **「投稿」側を「ライブラリ」へ**
- 「**投稿者**」は確定語で不変。**「投稿」側を「ライブラリ」に改名**し、`ライブラリ ↔ 投稿者` の二分にする。
- 前例: **写真.app の「ライブラリ ↔ ピープル」**と同じ二分。一字も被らず「似すぎ」を最も確実に解消・サブコピー「手元のアーカイブ」とも一致。
- 機構: i18n の browse ラベルを「ライブラリ」へ（英語は Library/Posters か Posts/Posters は実装時に確定）。波及文言（posterPosts/searchPlaceholder 等）と DQ5 スコープ行の行頭アイコンを同時更新。`browseModeTitle` の title 属性は DQ5 でセグメント自体が消えるので併せて撤去。

---

## 確定した決定（DQ7–DQ8・2026-06-20 追補）

### DQ7 検索の通常/あいまい切替の発見性 — 確定: **囲い内セグメント＋平易ラベル「ぴったり/おおまか」＋投稿者もあいまい対応**
- **形状**: **常設セグメンテッドコントロール**（両モードを名前付きで常時表示＋つまみで選択中を可視化）。既存 `.view-toggle`/`.vt-thumb`（密度トグル）部品を流用。前例＝VS Code 検索の常設モード切替（モードは常時インライン・詳細条件はエクスパンダ）／macOS スコープバー。**スイッチ（ON/OFF）は不採用**＝片方しか名前が出ず「OFF＝何になる?」が読めない。N択を表す部品としてセグメントが意味的に合う。
- **配置（確定）＝検索の"囲い"内に縦積み**: `.search-wrap`（検索の囲い）を横並び→**縦積み**に変える。入力欄を上に全幅、その**直下に同じ枠の中で**セグメントを密着配置（入力下端に hairline で連結）。「素の独立行」で下に置くと**すぐ下のソート（`sbSortTitle`）と並んで独立コントロールに見え**、検索の付帯オプションと読めない穴があるため独立行は不採用。同枠＋近接（入力↔セグメントは密着／ソートとはセクション律動22pxで離す）で「検索の一部」と読ませる。前例＝Finder/Mail の「フィールドに貼り付いたスコープ帯」。**現状 `#searchModeBtn`（wrap内の単一トグルボタン・[index.html:1704]）は撤去**。
- **ラベル＝平易語**（[DESIGN.md「声と語り口」]）: 「通常／あいまい」→**「ぴったり／おおまか」**（EN: Exact / Loose）。非技術者に「通常って何?」「あいまい＝結果がいいかげん?」と誤読されるため、動作を語る日常語へ。おおまか側に1行ヒント／ホバー title「タイプミスや言い回しの違いも拾う」。i18n `searchExact`/`searchFuzzy`/`searchModeTitle` を差し替え。
- **検索サーフェスの層**: 検索ボックスをアンカーに、**モード=常設レイヤー（このセグメント・常に見える）**と**詳細検索=オンデマンドレイヤー（フィールド指定/条件・将来）**を分ける。モードは“持続するレンズ”で高頻度＝常設、詳細は“クエリ組み立て”で低頻度＝畳む。**モードを詳細パネルに沈めない**（発見性が逆行）。前例＝VS Code（モードはインライン常設・ファイル指定はエクスパンダ）。詳細検索の中身は BACKLOG「検索バーの対象コントロール（詳細検索画面）」＝クエリビルダー整合とあわせ別途設計＝**この囲いがその器の土台**になる。
- **設置面**: 検索欄は既にサイドバー（Mica接地面）にあり glass-on-glass 非該当。`.vt-thumb` は接地面の glass-relief ビーズで規範通り。
- **投稿者モード（旧・技術論点5の解消）**: `filteredPosters()`（[viewer.js:4545]）の `name.includes(q)` を `corpusSearch.compile(q)` 化し投稿者の絞り込みもあいまい対応。→ セグメントは全モードで意味を持ち、モード依存の無効化が不要。短語は errBudget で実質 exact＝ノイズ限定的。
- **フライアウト `qfModeBtn`**: 既に `corpusSearch.onChange(syncQfMode)` 購読済み（commit `530b5ae`）。任意で同セグメント部品へ寄せる（polish・別途）。ラベルは同じ平易語に追従。

### DQ8 同期ステータスアイコン — 確定: **A案どおり（グリフ差し替え＋時刻テキスト維持）**
- 既存 `#mirrorStatus`（[index.html:1830]・サイドバーフッタ）の絵文字記号を **lucide系モノトーン同期グリフ**へ差し替え、ステータスで stroke 色のみ切替（完了=cloud-check `--text-muted`／エラー=alert-triangle `--danger`／未設定=非表示）。**最終同期時刻テキストとホバー title は据え置き**。回転 refresh-cw は取り込み同期の進行可視化を実装する時まで保留。
- 前例: 写真.app/Dropbox の「グリフ＋最終同期テキスト」。

---

## DESIGN.md に反映すべき改訂（実装と同梱）

1. **L123–124/L133 改訂**: 「ホバーは最頻**3個**まで（⚡ℹ＋タグ編集）。前例＝Google フォト/Pinterest のホバー・クイックアクション。**3を天井**とし4個目以降は却下」。「3個目却下」「タグ用アイコンを足さない」は撤回として記録。
2. **L130–133 改訂**: 「タグ付け＝カード編集インスペクタ＋複数選択→一括モーダルの2本、スタンプ軸は退役」。サイドバーパレット/`.stamp-on` 記述を退役へ。前例＝Finder/写真.app の選択→属性適用。
3. **DQ5**: スコープ行（ライブラリ/投稿者）を「母集団切替＝枠なしテキスト行（L43–44）、セグメントは表示切替に限定（L48）」と明記。前例＝Things/Mail/Finder。
4. **DQ7**: L51 を「検索方式はセグメンテッドコントロール＝**検索の囲い内に縦積み**（入力と同枠・モードレイヤー）で常設。スイッチは不採用。前例 VS Code/Finder/Mail」に更新。ラベルは平易語「ぴったり／おおまか」（[声と語り口]）。単一トグルボタンは退役。
5. **L29 用語ログ**: 「投稿側＝ライブラリ」のラベル決定を追記（「投稿者」は不変・用語決定の変更ではない旨）。
6. **L128**: ピンは描画ごと撤去（DQ4）。頻度ベース自動表示の不採用だけ維持。
7. **声と語り口（追加済み）**: `### 声と語り口` を新設（DESIGN.md・用語の隣）＝平易・温かい語り口を方針化。第一適用が DQ7 ラベル。マイクロコピーの不統一は別途「声の棚卸し」（下記）で詰める。

## 声の棚卸し（マイクロコピー・[DESIGN.md 声と語り口] の適用）

現状の i18n は既に平易・温かい声をかなり持つ（`wsEmptyConfirm`/`foldDeleteConfirm` 等の括弧の安心、`qbHelp*` の平たい口語）。揃える対象は少数:

- **(確定・DQ7同梱)** 検索モード `searchExact`「通常」→「ぴったり」／`searchFuzzy`「あいまい」→「おおまか」／`searchModeTitle`「探し方を切替（ぴったり＝入力どおり ／ おおまか＝タイプミスや言い回しも）」。EN: Exact / Loose。おおまか側に1行ヒント（新キー例 `searchLooseHint`「タイプミスや言い回しの違いも拾う」）。
- **(整合・即)✅適用済み** `qfEngagement`「エンゲージメント」→「反応」（カードの `detailEngagement` が既に「反応」＝1概念1語に統一。EN は Engagement で既に一致）。
- **(任意・低)** `postCount`「$1 件ヒット」の「ヒット」は軽いジャーゴン＝「$1 件」へ寄せるか検討（影響小）。
- **据え置き（原語・ドメイン語）**: プラットフォーム名／`インスタンス`／`セルフリプ`／`キャプチャ`／import・export 等は原語のまま（CLAUDE.md 識別子方針）。`危険な操作`/Danger Zone も安全UIの定番として維持。
- **規範の手本（変更なし）**: `wsEmptyConfirm`/`foldDeleteConfirm`/`posterFolderDeleteConfirm`/`qbHelp*` は声の見本＝崩さない。

## 実装前に解く技術論点（B 批評→本決定で更新）

1. **tagStartBtn のスロット衝突 → 解消済み**: DQ2 がホバー案になったため tagStartBtn 昇格は不採用。サイドバー先頭は DQ5 スコープ行が無競合で占有。
2. **DQ5/DQ7 の共有 `positionViewThumb`/ResizeObserver 結合**: 共有関数/RO は全 `.view-toggle` を走査する。**共有機構は壊さず要素だけ差し替える**＝DQ7 で search-scope セグメントを追加（RO が拾う）、DQ5 で browse トグル要素を撤去。実装順は DQ7 追加→DQ5 撤去の干渉に注意。
3. **タグ付け2導線の排他 → 解消**: DQ2 ホバー案でタグ編集は**完全モードレス**（ホバーのタググリフ→そのカードのインスペクタ／複数選択→一括モーダル）。常設編集モードを持たないので「編集モード vs 選択→一括」の排他ルールは不要。
4. **DQ7 セグメントの面**: サイドバー（Mica 接地面）に置く前提を厳守（メイン content 側のガラス帯に置くと glass-on-glass でハード制約抵触）。`.vt-thumb` は接地面の glass-relief ビーズで規範通り。
5. **投稿者モードでの検索あいまい非対応 → 解消（DQ7 確定）**: `filteredPosters()`（[viewer.js:4545]）の `name.includes(q)` を `corpusSearch.compile(q)` 化し投稿者の絞り込みもあいまい対応。セグメントは全モードで有効＝モード依存の無効化/非表示は不要。

## 実装順（目安・B のクイックウィン先行を反映）

1. DQ3 openIssue1（共有 chip() に種別ドット移植）→ 実機確認
2. DQ3 openIssue2（一括モーダルの renderEditPicker 呼び＋query リセット）→ 実機確認
3. DQ8 同期グリフ昇格（独立・回帰面が狭い）
4. DQ1 スタンプ機構の削除（本体）→ タグ付けが2本で回ることを実機確認
5. DQ2 ホバー3個目（タグ編集グリフ追加・DESIGN.md 改訂・モードレス化）
6. DQ4 ピン完全削除（UI＋データ）
7. DQ5 スコープ行（共有 RO を壊さず browse トグル撤去）
8. DQ7 検索スコープバー（qfModeBtn は購読済み）
9. DQ6 「ライブラリ」改名＋波及文言＋browseModeTitle 撤去

---

## 関連: コード健全性レビュー（方針B）の要点 — temp 揮発前に保全

全文は run `wf_68bac9c6-660` 出力。以下は確定（敵対的裏取り済み）の高優先項目:

- **P0（データ破損・要優先）✅修正済み（commit `3e63e36`・値で削除へ変更）** `viewer.js`: **インスペクタのタグ削除がインデックス基準で別レコードの誤タグを消す**。チップが `data-remove-tag` に rep 相対 index `i` を埋め、削除時に同じ `i` を全レコードへ positional 適用。グループ結合で各レコードのタグ配列の並びが異なると**無言で別タグが消える**。`refreshInspectorTags`(3755-3762)/クリックハンドラ(4184-4185)/`applyInspectorTagChange`(3775-3794)。**修正＝値で削除**（`prev.filter(t => t !== tagValue)`・チップは `data-tag` を既に持つ）。インライン編集（commit 830f382）で実発火・再設計対象外。
- **P1** `viewer.js`: in-place なタグ編集/単体削除が `_allPostsGeneration` を更新せず**サイドバーのタグ/著者キャッシュが陳腐化**（`_rebuildSidebarSets`/`buildUsers` が early-return）。各変更パスの `renderPosts(true)` 直前で世代をインクリメント。
- **P1** `viewer.js`: **HTMLエクスポート残骸 約110行が完全未呼び出し**（`buildExportHtml`/`formatExportDate`/`pad`/`buildFilename`/`formatFilenameDate`/`readFileAsText`・5312-5458）。現役は ZIP 経路。一括削除（`formatCount`/`formatDate`/`escapeHtml` は残す）。
- **P1** `viewer.js`: **userKind フィルタ一式が UI 到達不能な死コード**（`qfValues` case 792/`predOf` 2216/`filterLabel` 519/glyph・icon/PINNABLE/i18n）。入口の `data-qfrow="userKind"` 行が無い。削除＋DESIGN.md L151 の文言更新。
- **P1** `viewer.js`: 未呼び出しヘルパ `openEditOverlay`(4003-4015)/`toggleTagFilter`(1334-1339) 削除（editOverlay 共有部・loadPins は温存）。
- **P1** `index.html`: 孤立CSS 11クラス＋未適用トグルスイッチCSS（`.switch`/`.app-layout`/`.app-sidebar`/`.qf-add`/`.sb-tag-filter` 断片 等）削除。
- **P1** `viewer.js`: フォルダチップの tooltip が**撤去済み「3状態サイクル」の古い文言**（`tipTagCycle`・3297）。実挙動の文言へ。
- **P2（磨き）**: `escapeAttr` が `corpusUI.escapeHtml` と完全重複（`const escapeAttr = escapeHtml;` へ）／プラットフォーム名マップが `PF_NAME` と重複（520/795）／トースト窓口の不統一（4513 を showToast へ）等。一部は UX 再設計で除去予定（redesignOverlap）ゆえ単独着手不要。

> 注: P0 は再設計と独立の実バグ。設計確定を待たず単独修正してよい（quickWin）。
