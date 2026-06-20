# viewer.js 多角レビュー報告（ultracode・2026-06-20）

> 出典: セッション `c015e887` で実行した ultracode workflow 2本。
> - `wf_36c08bf6`（Phase1・現状調査）= タグ付けUX / ナビ・検索・ピン・同期 の実装マップ＋DESIGN制約の抽出
> - `wf_68bac9c6`（Phase2・多角レビュー）= 5レンズ（陳腐化BACKLOG / 重複 / 簡素化 / バグ / デッドコード）で finding を出し、各々を adversarial verify
>
> 31 findings を検証 → **採用28 / 却下3 / うち修正済み1**。本ファイルは「報告の精査用に整形した確定リスト」。**修正の実行はこれから**（redesignOverlap と却下を除く採用分が対象）。
> 行番号はレビュー時点（viewer.js 5504行時点）のもの。実装時は前後にズレうるので識別子で確認すること。

## 凡例
- severity: high / med / low（verify 調整後）
- conf: 確信度（verify 調整後）
- redesignOverlap: A（タグ/ナビ UX 再設計）で扱う領域＝**B では触らない**

## 承認状況（2026-06-20・ユーザー承認済み）
- **修正する（20件）**: C1, C3 ／ A1–A6 ／ B1–B7（大物 B1・B2 含む）／ D1, D2 ／ E1, E2, E3
- **保留（F・redesignOverlap）**: スタンプ軸 / ピン留め / browse切替 / 検索モード / bulk種別ドット＝A（UX再設計）の実装時にまとめて処理
- **対象外**: C2 は修正済み（`3e63e36`）／却下3件（clear-all ガード・スタンプ軸=死コード・UX指摘二重保全）
- **進め方**: 着手順は C1 → A → B → D/E。B1/B2 は影響が広いので手作業＋実機CDP確認

## 実装状況（2026-06-20 実装セッション）
- **完了（19件＋B1一部）**: C1, C3 ／ A1–A6 ／ B2, B3, B4, B5, B6, B7（B7 は A1 で同時解消）／ D1, D2 ／ E1, E2, E3。各コミット参照（fix/chore/refactor/docs(viewer)）。実機 CDP で初期化健全・フォルダストアの非破壊ロジック検証・コンテキストメニュー開閉まで確認済み。
- **残（B1 本体のみ）**: 完全一致の4カーソル配置メニュー（qb/fold/card/種別）は共有 `clampIntoView` に集約済み。未了は **配置戦略がドリフトしている分の統一**（tab-menu=カーソル上フリップ／cs-pop=ドロップダウン上フリップ／qf=maxHeight）と **外側クリック/Esc の document リスナーを1組へ集約**。いずれも可視挙動が変わるため、7ポップを画面端で開く実機検証とセットで対話セッション時に実施する。

---

## C. バグ修正（最優先）

| # | 件名 | 場所 | sev | conf | 状態 |
|---|------|------|-----|------|------|
| C1 | **in-place なタグ編集/単体削除が `_allPostsGeneration` を bump せず、サイドバーのタグ/投稿者キャッシュが stale 化**。新規タグがサイドバー（タグ小行・「すべて」件数・作品/キャラ行）に出ないのにフライアウトには即出る＝内部不整合。削除でも投稿者/インスタンスが居残る | bump は loadPos の `L2158` のみ／mutator: applyInspectorTagChange `L3775`, adoptSourceTag `L3896`, stampCard `L3560`, editSave `L4222`, executeDeleteGroup `L3418`／consumer: `_rebuildSidebarSets L1356`, buildUsers `L1976` | med | 0.95 | **要修正** |
| C2 | Inspector のタグ削除が rep 相対 index を全レコードに適用→タグ配列が異なるグループで誤タグ削除 | refreshInspectorTags `L3755`, handler `L4184`, applyInspectorTagChange `L3775` | med | 0.85 | **修正済み `3e63e36`** |
| C3 | タグ付けモードの Esc ハンドラが foldMenu/qfフライアウト/日付・エンゲージpopover を考慮せず、ポップを閉じる Esc でモードごと終了 | setupTagging Esc `L3703`（cf. インスペクタ側ガード `L3919`） | low | 0.85 | 要修正（redesignOverlap 一部） |
| — | （却下）clear-all キーワードガードが hide→validate の順。記述は正確だが confirmOk は一致まで disabled で実害なし | confirmOk `L5263` | low | 0.8(false) | 却下 |

C1 の最小修正: 各 mutator の `renderPosts(true)` 直前で `_allPostsGeneration++`（またはキャッシュ無効化ヘルパ経由）。

---

## A. デッドコード除去（再設計と無関係・確信度高・すぐ消せる）

| # | 件名 | 場所 | sev | conf |
|---|------|------|-----|------|
| A1 | **HTMLエクスポート残骸一式**（旧「単一HTMLにエクスポート」。現行は ZIP 経路に置換済み）。`buildExportHtml`＋`formatExportDate`＋`buildFilename`＋`formatFilenameDate`＋`readFileAsText`＋専用 `pad` の死チェーン ≈110行 | buildExportHtml `L5311-5401`, formatExportDate `L5422`, buildFilename `L5429`, formatFilenameDate `L5434`, readFileAsText `L5451` | med | 0.95–0.97 |
| A2 | **userKind フィルタ一式が UI 到達不能な死コード**（index.html に `data-qfrow="userKind"` 行が無い／書き込み経路も無い）。述語・ラベル・グリフ・アイコン・PINNABLE・i18n が居残り。`main.js` の update-tags patch 許可リスト（userKind/tagReviewed）も別タスクで撤去候補 | 述語 `L2216`, filterLabel `L519`, QC_GLYPH `L580`, TYPE_IC `L1350`, PINNABLE `L884`, MSG `21-22` | med | 0.90–0.92 |
| A3 | 未呼び出しの旧カード編集オープナ `openEditOverlay`（#editOverlay 自体は bulk で現役＝関数だけ削除） | `L4003` | low | 0.97 |
| A4 | 未呼び出しヘルパ `toggleTagFilter` / `isPinned`（loadPins/togglePin は現役） | `L1334` / `L700` | low | 0.95 |
| A5 | 設定『外観』のトグルスイッチ CSS `.switch`/`.switch-track`（::after・:checked 派生含む7ルール）が未適用 | index.html `256-262` | low | 0.97 |
| A6 | 孤立 CSS クラス11個（app-layout, app-sidebar[+input,select], qf-add[+:hover], sb-tag-filter, sb-taggroup, sb-subtitle, sb-sublabel, toolbar-row, link-row, status-msg, iv-check） | index.html 各所 | low | 0.95 |

---

## B. 重複の解消（reuse・効果大）

| # | 件名 | 場所 | sev | conf |
|---|------|------|-----|------|
| B1 | **フライアウトメニューの生成・位置クランプ・外側クリック/Esc 閉じの雛形が7箇所コピペ**＋クランプ式がドリフト。共有 `popup(el,x,y,{onClose})` コントローラへ集約（document リスナーも1組に） | cs-pop `454`, qf-pop `778`, qb-menu `1767`, tab-menu `2575`, foldMenu `3171`, cardMenu `3214`, kindMenu `3634` | med | 0.9 |
| B2 | **`posterFolders` が `folders.js` の corpusFolders をほぼ丸ごと再実装**（genId/persist/byId/has/create/delete/toggle＋行レンダ＋rename/delete モーダル）。`createFolderStore({get,set,idPrefix})` ファクトリ化で2インスタンスに | posterFolders `L4490-4533, 4649-4733` | med | 0.85 |
| B3 | `escapeAttr` が `corpusUI.escapeHtml` と完全同一（現 escapeHtml はクォートもエスケープ＝コメントが陳腐化）。委譲に置換 | `L5445`（呼び出し35箇所） | med | 0.95 |
| B4 | プラットフォーム表示名マップが3箇所重複→ `PF_NAME` 一本化 | filterLabel `520`, PF_NAME `683`, qfValues `795` | low | 0.95 |
| B5 | トースト窓口が `showToast` ラッパと `corpusUI.notify` 直呼びで不統一（1箇所だけ直呼び） | `L4513`（cf. showToast `L5462`） | low | 0.95 |
| B6 | ゴミ箱削除 SVG パスが複数箇所インライン重複→共有定数 | viewer.js `4526` / index.html `1776` | low | 0.9 |
| B7 | 日付フォーマッタ（YYYY-MM-DD）重複（※A1 のエクスポート削除で多くは消える） | `5422` / `5434` | low | 0.9 |

---

## D. 簡素化（micro）

| # | 件名 | 場所 | sev | conf |
|---|------|------|-----|------|
| D1 | `KIND_LABEL` が呼び出し毎にオブジェクト再生成（MSG は確定済み＝定数で十分） | `L1323` | low | 0.95 |
| D2 | `renderPosts` 内で `JSON.stringify(snapshotState())` を2回評価→1変数に束ねる | `L2789` / `L2854` | low | 0.9 |

---

## E. 陳腐化した BACKLOG / docs の是正

| # | 件名 | 場所 | sev | conf |
|---|------|------|-----|------|
| E1 | DESIGN.md「userKind は読まれない残骸」記述 vs 実装（実際は読まれるが到達不能）。A2 の死コード除去で「読まれない」を真にして整合 | DESIGN.md `151` | low | 0.8 |
| E2 | perf残「card の content-visibility 再有効化」記述が現状取り違え。base `.post-card` は有効化済みで、off は masonry 限定（採寸との両立不可という既知トレードオフ） | BACKLOG `14`／index.html `715,724` | low | 0.9 |
| E3 | フォルダチップの tooltip が撤去済み「3状態サイクル」を説明する `tipTagCycle`（フォルダは単純トグル＝文言不一致） | renderPostFolders `L3297` | low | 0.9 |
| — | （却下）UX再設計指摘の BACKLOG/git 二重保全＝ルール違反、は実体として成立せず | BACKLOG `63` | low | 0.7(false) |

---

## F. 再設計（A）と重複＝B では触らない（redesignOverlap）

A（タグ/ナビ UX 再設計）の確定設計で作り直し/撤去される領域。B のデッドコード掃除では手を付けず、再設計の実装時にまとめて処理する。

- **スタンプ軸**（loaded/stampCard/refreshMarks/.stamp-on/軸トグル）＝廃止方向（※「死コード」判定は却下＝今は生きている）
- **ピン留め一式**（PIN_KEY/loadPins/togglePin/#pinnedSection/qf-pin）＝スマートフォルダで代替予定
- **browse 切替トグル**（#browseToggle/syncBrowseBar）＝サイドバーへ移設予定
- **検索モード切替 UI**（searchModeBtn/qfModeBtn）＝発見性改善で刷新予定
- **bulk タグ付与モーダルの種別ドット非対称**（renderTagPicker の chip にドット無し）＝再設計で共有ピッカーに種別ドットを追加。なお bulk 起動時に `renderEditPicker()` 未呼び出し（`L4270`）でピッカーが初回空/古いまま、という潜在バグもここで一緒に直す

---

## 次アクション
1. 本リストを精査（採用分の最終確認）。
2. 着手順の目安: **C1（実害バグ）→ A（dead-code 一括除去）→ B1/B2（重複の大物）→ B3-B7/D/E（小粒）**。F は A（UX再設計）の実装時に回す。
3. dead-code 除去（A）と陳腐化是正（E）は低リスクで一気に片付けやすい。重複の大物（B1/B2）は共有化で行数も減るが影響範囲広め＝テスト併用。
