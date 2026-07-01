# バックログ（未着手の残タスク・唯一の作業トラッカー）

完了は git が記録するので**完了項目は残さず削除**。実装済み機能・構成・検証手順は CLAUDE.md 他節＋メモリ `corpus-verify-notes` が真実源（重複させない）。

**最優先（次に着手）**: 監査の確定セキュリティ／正しさは全て対応済み。次の注力候補は要追加調査（L1〜L4）・タグ付けの手動UX改善・各機能設計から選ぶ。

## 監査で見つかった残課題（2026-06-27 UltraCode）

2026-06-27 に UltraCode 多エージェント監査をセキュリティ／正しさ・データ整合性／パフォーマンスの3面で実施。いずれも**総評は既に高水準**で確定分は少数。各面とも効き順に並べる。

### セキュリティ

ハードニング済み（制限的CSP `script-src 'self'`・contextIsolation+sandbox+nodeIntegration:false・SSRFガード・captureId allow-list・JPEGマジックバイト検査・zip-slip 二重ガード）。実害のあった H-1（16進 IPv4-mapped SSRF）は解消済み。残りは Low のみ。

- **【Low・脅威モデル次第】SSRFガードがホスト名を解決しない（DNSリバインディング）**（`native-host/media-download.js:76-88`）: コメント（41-45行）で明記の**意図的な受容リスク**。閉じるなら解決アドレスの public 検証＋接続ピン留め。許容なら現状維持（H-1 修正で最も直接的なIPリテラル経路は塞がる）。
- **棄却（ガードが効いている裏取り・再調査しない）**: zip-slip（`isSafeEntryName`+`isWithin` 二重）／captureId トラバーサル（`SAFE_ID`）／プロトタイプ汚染（own プロパティのみ・脆弱マージなし）／trash の未エスケープ `<img src>`（CSP で script 不発）／Referer 注入（undici が CRLF 拒否）／native message 長さ（Chrome allowed_origins＋~1MB）／onMessage の sender 未検証（`externally_connectable` なし）／install・restart スクリプト（固定パス・argv 配列・非昇格）／サイドカーのパスフィールド（常に `path.basename`＋フォルダ内 resolve 検査）／open-external（`/^https?:\/\//i` allowlist）／サプライチェーン（実行時 npm 依存ゼロ・lockfile ピン留め）。

### 正しさ／データ整合性

`config.json`・save-pointer・サイドカー本体（`writeSidecarAtomic`）・`.index.json` は全て tmp+rename でアトミック化済み（torn-read 系 High は commit 9260c81 で解消）。確定分（#1〜#5）は全て対応済み。残るは要追加調査の候補。

- **有力・要追加調査**: **L1**【Med-High】saveFolder 移動中に届いたキャプチャが旧フォルダに取り残され取りこぼし（`main.js:1389` copyLibraryInto のスナップショット→flip→cleanup の並行窓・bridge は別プロセスで非ロック）。対策＝移動中フラグで bridge 保留 or flip 前に src 再 readdir で差分追いコピー、cleanup を「dest 存在確認できたものだけ src 削除」に。 **L2**【Med】import-posts の重複検出が `url` のみ依存＝URL なしレコード（99.6% の Eagle 移行）が再インポートで毎回二重化（`main.js:996`・`.trash` 非走査・BOM 非耐性）。対策＝captureId/画像ハッシュ/eagleName 等にフォールバック。 **L3**【Med】サイドカー/組織 JSON 読みが BOM 非耐性（`lib-index.js:146`・各 get-*・`lib-archive.js` import マージ）＝BOM 付き JSON で投稿が静かに欠落、最悪 record:null→reconcile が collections/clip 恒久 purge。対策＝全 JSON 読みを共通ヘルパに集約し先頭 U+FEFF を剥ぐ。 **L4**【Low】import の `mergeManualGroups`（`lib-archive.js:122`）が集合 dedup のみでメンバー交差を解消せず「1 captureId 1 グループ」不変条件を破る（可逆）。対策＝union-find。
- **次に調べる（網羅性ギャップ・未裏取り）**: ①`lib-index.js:139,190` の mtimeMs 単一信号による「変更なし」誤判定＝タグ付けが tags/userKind/tagReviewed を単一 update-tags で原子的に書くか要確認。②自己リプライ・グルーピングの alias 解決が深さ10で打ち切り（`viewer.js:2458`）＝11投稿超のセルフリプライでグループ分裂。③saveFolder 移動後に renderer の組織ストア（`CF().load()`/getPosterTags 等）を再読込しない（`viewer.js:5945`）。④delete-post の disk-sweep 前方一致（`main.js:881`）が `-N` 接尾辞 base と境界文字で分離できるか（境界テスト無し）。⑤デバウンス persist の最終フラッシュが `before-quit` で保証されるか。
- **棄却（ガードが効いている裏取り・再調査しない）**: update-tags/restore-post の torn-read（`writeSidecarAtomic`＋commit 9260c81・直書きは現存0件＝発見の行番号 stale）／clear-all が delta ベースライン非リセット（added は現在スキャン由来・stale は removed の no-op・captureId は再利用なし）／facetCounts への sticky 混入（件数バッジも同じ getFilteredPosts 由来で一様・~400ms 後 clear）／buildUsers 先勝ちで表示名/アバターが古い（表示のみ・userKey 安定・再起動で自己修復）／config の saveFolder 死パスで空表示（ENOENT→no-op・データ無傷・再接続で復元）／import で未移行 folders.json 孤児化（起動時 `CF().load()` が import 前に必ず移行＝到達不能）／trash 3操作の captureId 前方一致衝突（`Date.now()+rand16` で極小確率）。

### パフォーマンス（UI操作）

確定した残課題を効き順に。**実ライブラリは99.6%が無タグ Eagle 移行・投稿者は数十件**なので、投稿者/コレクション系の窓無し描画や多くのメモ化欠如は現スケールでは体感に出ない（将来 SNS 主体化で効く構造負債）。

- **main 側 I/O**: ①起動時 listPostsDelta が全 ~7600件を1回の IPC structured clone（full:true・`main.js:251`）＝初回ペイント前に同期ブロック。フィールドのスリム化/チャンク化の余地。②psimg の原寸（?w= 無し）を `fs.readFile` で全バッファ（`main.js:366`）＝`stream:true` 特権があるのに非ストリーム。大判の連続オープンで GC 圧。
- **low 群（generation キャッシュ idiom の横展開で消せる衛生案件・現状は体感薄）**: textHaystack の反復 toLowerCase（2550）、buildSuggest のタグ集計未キャッシュ（5616）、getFilteredPosts 前段 filter、date 述語の境界 Date 再生成、snapshotState 二重直列化、lightbox の decode/隣接プリロード欠如（3393）、pf-badge の backdrop-filter（`index.html:871`）。
- **dev限定（未調査）**: 開発中の `reloadIgnoringCache` 反復でレンダラ/GPU リソースが蓄積し激重化（アイドル 2fps）＝再起動でクリア。リスナ累積でなく蓄積系・根本要因未特定。
- **card(masonry) の仮想化＝最終形Bの一部として実施（決定・2026-06-30）**: 深スクロールでカードが溜まり線形劣化（`viewer.js:3061`/`index.html:808`）。旧「⏸保留・再監査しない」は撤回＝グリッドは完全 React 所有とし**仮想化ライブラリ（masonic 第1候補／react-virtuoso は撤回＝可変高マサンリーの本領外／TanStack Virtual 保険）**で仮想化（masonry+窓化+スクロール復元）。回帰リスクは高い（既定ビューの根幹）ので最終形Bの後半スライスで慎重に。方針詳細はメモリ `corpus-react-settings-pilot`。

## タグ付け・整理（注力テーマ）

booru 型イラストアーカイブ（実測はメモリ `library-composition`＝99.6% Eagle 移行・約7600枚無タグ・既存タグは日本語の作画資料寄り）。**ソースタグ取込はこのライブラリでは無力**（Eagle 移行は URL/ソースタグ無し）＝実効レバーは**手動でのタグ付け効率化（UX 改善）**。

- **関連タグ提案（共起・確認付き／未着手）**: 全タグの同時出現から「X→Y もよく一緒」を**弱いヒント**で出す汎用版（作品/キャラのスコープ付き共起とは別の二次機能）。守る条件＝①押し付けない（候補を上に出すだけ・全語彙は残す）②なぜ出たか説明可能（共起回数）③勝手に付けない④信頼度段階化（スコープ付き＝強・全タグ＝弱）⑤データが薄いうちは出さない。カテゴリ無しの全タグ共起はノイズ＋親方向が推測になるので弱ヒント止まり。
- **タグの複数グループ所属を許すか検討（未着手）**: 現状は実質1タグ1グループ（未所属＝未分類）。1タグが複数観点（例「構図」かつ「主題」）に属したいケースに多重所属を許すか。影響＝サイドバーの重複表示・件数二重計上・パレットで同タグが複数セクション・未分類の定義変化。種別（用語帳・1タグ1種別の排他レイヤー）とは別軸。前例＝danbooru は排他／Eagle・Notion は多重可。判断軸＝柔軟さが UI/集計の複雑化に見合うか。

## 作者まわり

- **同一投稿者がSNS別にばらける→名寄せ（未実装・設計調査済み 2026-06-21）**: 同じ人でもプラットフォームが違うと別グループになる。手動で紐づける＋自動で同一人物を提案（名寄せ候補）。呼称は「投稿者」確定（DESIGN.md「用語」）。`poster-aliases.json` はまだ存在しない＝完全未着手。
  - **データモデル**: `<saveFolder>/poster-aliases.json`＝`{groups:[{id,primary,members:[posterKey]}]}`（poster-folders.json と同型＋代表キー primary）。別レイヤーで束ね非破壊（保存は個別キー・表示は実行時合算）。5点セット（get/set-poster-aliases IPC・preload・INTERNAL_FILES・clear-all スキップ・`mergePosterAlias`）は poster-tags.json が雛形。マージは union-find（1キー1グループ・primary ローカル優先）。
  - **波及の核**: `buildUsers()`(viewer.js) の集約キーを alias 解決後 id にする1点改修＋`predOf` user を集合一致化で、投稿数集計/`user` フィルタ/ジャンプ/カード描画がほぼ自動波及。`buildUsers` キャッシュは名寄せ変更で bust。
  - **手動UI**: 投稿者インスペクタ＋カード右クリック「同一人物にする/解除」＋投稿者ピッカー（`renderTagPicker` 流用）＋確認＋Undo。D&D不採用（グリッド並び替えで誤操作が破壊的）。
  - **自動候補**: 決定的・説明可能ルールの重み合算（@ハンドル完全一致＞displayName 正規化一致＞類似）。根拠明示・確認で確定・薄いうちは沈黙。アバター知覚ハッシュ／プロフィールリンク相互参照は段階③。
  - **段階**: ①基盤＋手動＋全波及 → ②自動候補 → ③候補強化/確認キュー。**要判断**: UI 置き場（推奨インスペクタ）／自動候補の強さ／タグ・フォルダは非破壊合算か物理マージか／primary 決め方／粒度（person 固定推奨）。
- **投稿者モード→投稿一覧を別タブで開く選択肢（要設計）**: 現状はダブルクリックで同じタブを投稿モードに切替＋その投稿者の `user` フィルタ。別タブ案はスイッチ切替想定と整合が取りにくく要設計のまま。
- **戻る/進むにライブラリ↔投稿者モード切替も含める（要設計）**: 現状の履歴ナビは browseMode 切替を積まない。論点＝履歴に積む単位（フィルタ変更との粒度整合）。
- **ユーザー一覧タブのフォロー数/作成日付与（未実装）**。

## 検索・ナビ・ビューUX

相互依存が強いので実装前に設計を固める（2026-06-20 フィードバック起点）。

- **ビュー/レイアウト切替のモード表示＋スライド（残 ①③・2026-06-27）**: ①ビューセグメントのアクティブをアイコン（グリフ）表示に戻す＝前回ラベルのみにした `index.html` `.browse-toggle button.active *` 周辺 CSS を撤回し全状態アイコン表示（`.view-toggle` 既定）に。③レイアウトセグメント（`densityToggle`/`posterDensityToggle`）のつまみスライドが効かない＝`startViewTransition(() => renderPosts())` がつまみ(.vt-thumb)を巻き込む疑い。**注**: トグルは React 所有化済み（`DensityToggle`/`BrowseToggle` が `.vt-thumb` を useLayoutEffect で自前配置・`positionViewThumb` から除外）＝旧原因はおそらく無効化されたので、まず現状を視覚再確認してから判断。（② 見出しへのモード名併記は f95dd6a で実装済＝削除）
- **クエリビルダーがアドレスバーに見える＝初見が「クリックして入力」を試す（未決・要判断 2026-06-21）**: 二択＝**(a)** 「ここには直接入力できません／フィルタは◯◯から」のヒントで現行の追加導線へ誘導（軽い）／**(b)** ブラウザ風にテキスト入力＋候補サジェストで直接フィルタを投入（誤認を機能に変える・既存 `queryTree`/`addFilter` に乗せる）。b は「詳細検索画面」「コマンドパレット」「本文全文検索」と接近＝設計を寄せられるか。
- **コマンドパレット**（Cmd+K 的＝フィルタ/操作/タブ移動の検索式ランチャ）。
- **本文の全文検索の専用UX（残）**: 本文/タイトル/pixivキャプションのマッチは実装済み（クイック検索＝現タブ絞り込み）。**残**＝ライブラリ全体横断の専用全文検索体験（全タブ越え・結果一覧・本文ハイライト/該当箇所ジャンプ）を出すか要設計。コマンドパレットとは別物。
- **複数ウィンドウの許可**: 現状の単一ウィンドウ制約を緩める。

## 保存・取込・メディア

- **重複保存の警告（コピー/置換/スキップ・未実装・設計調査済み 2026-06-21）**: 同じ投稿URLが既にライブラリにある状態で再保存（再キャプチャ/ドラッグ/取込）したら止めて「両方残す/置き換える/スキップ」を選ばせる。現状は captureId 単位で無条件に別ファイル保存＝同じ画像が×Nに増える。判定キーは既存 `postKeyOf(url)`(viewer.js) の正規化プラットフォームキー（x⇄twitter 統合済み）を共有モジュール化して renderer/main 共用。照会先はレンダラ保持の `allPosts`（url→captureId 逆引き Map を1本足すだけ・コンテンツハッシュは不採用＝スクショは毎回バイト差）。**警告はアプリ取込時に寄せる**＝拡張キャプチャは一旦保存（write-once 維持）、アプリが delta 受信フックで同一キーの先客を検出→後追い重複解決ダイアログ（全経路を1箇所でカバー・ブリッジ無改造）。3択は既存 `delete-post` を再利用（置換=旧をソフト削除/スキップ=新を取消/両方=現状）。注: `import-images`(ローカル取込)は url=null＝対象外。**段階**: P0 `postKeyOf` 共有化→P1 `import-posts` を正規化＋3択化→P2 キャプチャ経路の後追い検出→P3 既存重複の遡及掃除UI。**要判断**: 警告タイミング（後追い vs 保存前バナー）／null 同士は重複扱いせず安全側で可か／置換で旧タグ/フォルダを引き継ぐか／遡及掃除をやるか。
- **画像に任意テキストを付与（自由メモ／未着手）**: 各キャプチャにタグとは別の自由記述テキストを入力して紐付けたい。保存先（サイドカー JSON への欄追加）・全文検索の対象に含めるか・UI（インスペクタの入力欄）は要設計。
- **既存ライブラリの補完（個人作業）**: ①リンク→拡張で再キャプチャ（画像/メタ欠損分・backfill はメタのみ）。②アバター backfill＝`backfill-metadata.js --avatars`（未 backfill はモノグラム表示・流すと実画像に）。

## 実機検証・開発インフラ

- **⚠️ Electron を EOL(33系) からサポート内(41/42) へ更新（2026-07-01 月次セキュリティ点検で検出）**: 現固定は `app/package.json` の `^33.2.0`。33系は **2025-04-29 に EOL**＝セキュリティバックポート対象外で、内蔵 Chromium が約20か月分パッチ未適用（現行最新は 42・サポートは 41/42）。直近の Electron 層 CVE（[CVE-2026-34781](https://www.miggo.io/vulnerability-database/cve/CVE-2026-34781) clipboard DoS／[CVE-2026-34774](https://www.sentinelone.com/vulnerability-database/cve-2026-34774/) offscreen UAF）は Corpus が該当機能未使用で直接影響なしだが、**実リスクの本体は Chromium 側の未修正 CVE**＝SNS/インスタンスから取得した任意画像バイトをレンダラ(psimg)/メイン(nativeImage)で復号・表示するため画像デコーダ系 RCE がライブラリの悪意画像経由で悪用され得る（実在するが即時性は低い）。**⚠️ Chromium 本体が上がる重い更新**で、更新後は実機検証必須＝キャプチャ(Alt+S/ドラッグ)・投稿/画像表示・サムネイル生成(psimg?w=)・ウィンドウ挙動(titleBarOverlay/分離設定)を一通り目視。急がないが放置しないカテゴリ。[Electron EOL 一覧](https://endoflife.date/electron)。
- **拡張の実機E2E拡充**: 特に X＝要ログインで未自動化（puppeteer は bot検出で弾かれる）。`e2e-capture-test.js`（全PF PASS・X除外）の延長で X を認証済みプロファイル/Claude in Chrome で。手動X残テスト（A-1系）もここで。
- **実機キャプチャの実ブラウザ経由 最終目視確認（残）**: Chrome 無しの end-to-end は検証済み（メモリ `corpus-library-loss-incident`）。残＝実機 Chrome で1件キャプチャ（Alt+S/ドラッグ）し保存先に `.jpg`+`.json` が落ちるのを目視。リモートでは不可＝実機で。
- **開発共通ルールを親フォルダの CLAUDE.md に集約**→重複削除（上位集約）。
- **React 化（最終形B）＝進行中**: 残タスクと技術スタックの採否は独立セクション「React 化（最終形B）」「技術スタック候補」に集約（下記）。確立パターン/実装知はメモリ `corpus-react-settings-pilot`/`corpus-vite-migration` が真実源（重複させない）。

## React 化（最終形B＝単一Reactアプリ化・進行中）

**方針・実装知の真実源はメモリ**（`corpus-react-settings-pilot` / `corpus-vite-migration`）＝目的（合否基準）・確立パターン（反転パターン/プレゼンテーショナル島/idempotent guard/初期化順の罠）・各スライスの実装知。ここには**残タスク（やること）だけ**を置く。

- **依存/UI 方針（確定）**: 全面リライトしない・段階移行／依存は先回りせず痛みが出た時に keep/replace 物差しで判断（bespoke＝フィルタ/グルーピング/正規化/日本語あいまい検索は保つ／コモディティ＝位置決め/窓化/a11y は痛んだら委譲）／UI はガラス維持（styled kit 却下）／状態は corpusStore 継続／ルーター無し。
- **着地済み**: Vite 移行（esbuild 廃止・段階0-2）／島12個（settings/sidebar-tags/query-chips/tabs/collections/suggest/posters/post-card=テンプレート島/toolbar/context-menu/lightbox）＋共有ストア window.corpusStore。
- **残タスク**:
  - 詳細/インスペクタパネルの React 化（大物・島未）。
  - フィルタ系一式: #filterRows/バッジ／値フライアウト `renderQfPop`（find入力＋その場絞り込み＝ハイブリッド境界でこじれ候補）／日付・エンゲージメント ポップオーバー。
  - 編集オーバーレイ＋タグピッカー。
  - 検索ボックス＋サジェスト（タブ状態結合＋サジェスト絡みで重い）。
  - kindMenu（種別メニュー・専用要素で汎用部品に不向き＝専用 React 化 or 命令的据え置き）。
  - グリッド完全React化＝#postGrid を viewer.js→React 所有へ＋仮想化（`viewer.js:3061`/`index.html:808` の深スクロール線形劣化を解消・下記「技術スタック候補」参照。回帰リスク最大＝後半スライスで慎重に）。
  - viewer.js（5724行 IIFE）を store/service/hooks へ段階抽出（純ロジック buildGroups/フィルタ/正規化/IPC→service・横断状態→store・密着ロジック→hooks＝抽出であって全面リライトでない）。
  - 単一 root／単一バンドル化（島 IIFE×N を畳む・file:// ESM 制約の解消は最終形B で別途）。
  - ポスターのフォルダ割当 toggle を実フォルダ作成で実データ再検証（部品単体は検証済）。

## 技術スタック候補（ライブラリ/ツール・2026-07-01 多エージェント調査）

> **位置づけ**: 87候補を Corpus 固有制約（file:///厳格CSP/ファイルベース真実源/ガラス維持/7600枚個人利用）で痛点接地採点した**採否の判断ログ**（"買い物リスト"でなく keep/replace 物差しの具体化）。版数/DL数など鮮度依存の詳細は割愛（腐るため）。**実効レバーはライブラリでなく手動タグ付けUX**＝どのエンジンを入れても無タグ7600枚は無タグのまま（本丸はこのカタログの外＝「タグ付け・整理」節）。
> **通し方針**: 先に効くのは横断レバー（Biome/IPCラッパー/checkJs/配布整備＝検証表面積を下げる）。グリッド仮想化・検索DB等の重い機能強化は最終形B の地ならし後。

### 優先度順（横断・上位16）

| # | 候補 | カテゴリ | 採否 | 一言（根拠） |
|---|---|---|---|---|
| 1 | **Biome**（lint+format） | 品質 | adopt-now | lint/format 完全ゼロ（severity 5）を単一バイナリ・単一設定で一掃。ビルド/CSP/file:// 無関係で導入コスト最小・全カテゴリ最速の即効レバー |
| 2 | **IPC集中ラッパー（自前）** | IPC | adopt-now | viewer.js の `catch{}` 黙殺（UI が固まる/古い結果）を `corpusIpc.call()` 1経由で根治。依存ゼロ・数十行で全46メソッドに波及・将来の差し込み点 |
| 3 | **electron-builder + publish/sign** | 配布 | adopt-now | 既に v25.1.8 稼働中・dist 実績あり。乗り換えゼロで配布の穴を埋める唯一の現実解 |
| 4 | **JSDoc + checkJs**（.ts化なし） | 品質 | when-pain | viewer.js が単一 IIFE ゆえ**構造を壊さず型を載せる唯一の経路**。契約破れ（island⇄viewer/裸ストアキー/i18nキー/IPC）を静的検出。JSDoc 人手が律速 |
| 5 | **Floating UI**（@floating-ui/dom） | Headless UI | when-pain | 衝突回避が5箇所コピー（drift 自認）を1API化。位置決め専用でガラスCSS無干渉・inline style のみで CSP 無条件適合。Headless UI の勝者 |
| 6 | **masonic** | グリッド仮想化 | when-pain | 不定高マサンリー専用設計が Eagle 風と1:1。深スクロール線形劣化を構造解消。ただし #postGrid 所有権を React へ移す大改修が前提＝最終形B 後半。3候補の勝者（次点 @virtuoso.dev/masonry） |
| 7 | **Zod（main限定）** | スキーマ/IPC | when-pain | preload ~50 の契約破れを main 側 require だけ（CSP 対象外）で実行時検出。L3（サイドカーJSON の BOM/形）にも転用。TS 導入の前段 |
| 8 | **electron-updater + GH Releases** | 自動更新 | adopt-now | BACKLOG 決定済み・public化前提に合致・追加インフラ不要。builder と同一作者で設定齟齬が起きにくい |
| 9 | **i18nキー網羅スクリプト（自前）** | i18n | adopt-now | ja/en 片側欠落・キー名ズレの無音失敗だけを15〜30行で潰す。i18next 等は 342キー2言語に過剰 |
| 10 | **lucide-react** | アイコン | evaluate | DESIGN.md:76 指定と自前35SVGが実測一致＝「真似た自前」を本物に。ただし島のみ・本体は最終形B完了時の一括移行が筋 |
| 11 | **MiniSearch + BudouX** | 検索 | evaluate | 全文線形走査/haystack再構築/ファセット/サジェストを一括。依存ゼロ・WASM不使用で CSP 適合最高。ただし日本語境界に BudouX 必須・体感変化リスク |
| 12 | **SignPath Foundation** | 署名 | when-pain | 無料OSS・**日本拠点でも申請可**（Azure は日本対象外）。private リポでは申請不可＝public化と順序合わせ・審査が律速 |
| 13 | **better-sqlite3 + FTS5** | DB | evaluate | SQL で複数痛点を解く潜在力。ただしボトルネックは IPC直列化でDB不在ではない・ネイティブ配布コスト新設に今は見合わない |
| 14 | **sharp**（libvips） | 画像 | evaluate | サムネ同期ブロッキング（main.js:366 自認）＋webp/avif 非対応を別スレッドで一掃。asarUnpack 新設＝実行時依存ゼロを初めて破る越境 |
| 15 | **Vitest** | テスト | evaluate | 島ロジック用。ただし最大の痛点 getFilteredPosts 等は viewer.js IIFE で対象外＝service 抽出後に本領 |
| 16 | **react-aria 自前パレット** | Cmd+K | when-pain | 既存最有力依存を使い回し search.js を通せば日本語あいまい検索の二重実装を回避。最終形B後に1ツリーで（次点 cmdk） |

### ティア早見表

- **adopt-now（今すぐ／現状追認）**: Biome ／ IPC集中ラッパー ／ electron-builder(publish/sign) ／ electron-updater ／ i18nキー網羅スクリプト ／ **「現状維持が最適解」と確認**: 自前 corpusStore(状態)・自前 Date/Intl(日付=計測済み最適)・自前スモーク+puppeteer(テスト)・自前 fs.watch+pick-save-folder修正・自前 HTML5 DnD・自前 .index.json+Map索引(DB)・search.js継続+haystack事前計算・知覚ハッシュ見送り(画像)・自前SVGアイコン本体。
- **adopt-when-pain（痛みが出たら）**: JSDoc+checkJs ／ Floating UI ／ masonic ／ Zod(main限定) ／ Valibot(main限定) ／ SignPath ／ chokidar v4 ／ @electron/fuses ／ react-aria自前パレット ／ 位置決め共通フック化。
- **evaluate（条件付き・要PoC）**: lucide-react ／ MiniSearch+BudouX ／ better-sqlite3+FTS5 ／ sharp ／ Vitest ／ Knip(未使用検出) ／ TanStack Query(最終形B後) ／ cmdk ／ Radix UI Primitives ／ Certum ／ Zustand(最終形B後)。
- **reject（不採用）**: oxlint ／ kbar ／ dnd-kit・pragmatic-dnd・SortableJS ／ Jotai・nanostores・Valtio・XState ／ FlexSearch・Orama ／ kuromoji・lindera-wasm ／ node:sqlite・sql.js・DuckDB ／ imghash ／ @parcel/watcher・graceful-fs ／ dayjs・Luxon・Temporal ／ ArkType・superstruct ／ Motion・react-spring・auto-animate ／ Iconify ／ Paraglide・FormatJS・LinguiJS ／ Playwright視覚回帰・node:test ／ electron-forge・Azure Trusted Signing ／ electron-trpc・Comlink。

### カテゴリ別 勝者/次点（比較根拠）

| カテゴリ | 勝者 | 次点 | 理由 |
|---|---|---|---|
| グリッド仮想化 | masonic | @virtuoso.dev/masonry | 不定高マサンリー専用が Eagle 風と1:1。react-virtuoso は可変高が本領外で撤回 |
| Headless UI | Floating UI | Radix UI Primitives | 位置決め専用でガラス無干渉・CSP無条件適合。Radix は WorkOS移管後の更新鈍化 |
| コマンドパレット | react-aria自前 | cmdk | search.js を通せて二重fuzzy回避。kbar は Fuse.js間接依存で却下 |
| 状態管理 | 自前corpusStore維持 | Zustand(最終形B後) | 34行7-8キーに全ライブラリ過剰。型なしキーは checkJs で解く |
| 検索 | MiniSearch+BudouX | search.js継続+haystack事前計算 | まず次点で今すぐ着手、日本語境界が痛んだら勝者へ |
| 埋め込みDB | 現状.index.json+Map維持 | better-sqlite3+FTS5 | ボトルネックは IPC直列化。7600件は Map+JSON で実用十分 |
| 画像 | 現状維持(サムネ据置) | sharp | 知覚ハッシュは段階③で時期尚早。webp/avif の穴が顕在化したら sharp |
| ファイル監視 | 自前fs.watch維持 | chokidar v4 | 全reconcile が自己修復・2026-06 インシデントは MSIX仮想化が真因 |
| 日付 | 自前Date/Intl維持 | date-fns | Intlキャッシュ+_dateMs で計測済み最適・痛点に日付が無い |
| スキーマ検証 | 自前BOM剥ぎヘルパ | Valibot/Zod(main限定) | L3 は BOM剥がし15行で足り厳密型検証の実ケースが無い |
| アニメ | View Transitions+CSS維持 | （なし） | viewer.js:4316 稼働済み・残る穴は Lightbox reflow(sev2)のみ |
| アイコン | lucide-react(島)/本体は最終形B後 | 自前SVG維持 | DESIGN.md指定と実測一致。Iconify は CDN前提で file:// 非互換 |
| i18n | キー網羅スクリプト(自前) | 自前corpusI18n維持 | 342/341パリティ・恒久2言語で FW は設備過剰 |
| テスト | 自前スモーク+puppeteer維持 | Vitest | 実機=真実の文化と一致。Vitest は viewer.js 抽出後に本領 |
| 署名 | SignPath Foundation | Certum(有償) | 無料OSS・日本可。Azure は日本対象外で却下 |
| IPC | IPC集中ラッパー(自前) | Zod(main限定) | catch{}黙殺を数十行で根治。electron-trpc/Comlink は TS前提・非互換 |

### 却下理由（固有制約に正面衝突した代表）

| 候補 | 却下理由 |
|---|---|
| kuromoji / lindera-wasm | WASM実行に `wasm-unsafe-eval` 必須＝厳格CSP方針の変更そのもの。日本語検索強化の道は WASM 形態素でなく BudouX 系 |
| Iconify | CDN/API 動的取得が file://・`script-src 'self'` と根本非互換 |
| Azure Trusted Signing | 2026-07 時点で Identity Validation 対象国が US/CA/EU/UK のみ＝日本拠点は申請自体が不可能 |
| @parcel/watcher | 目玉 getEventsSince が解く問題は `_deltaFolder=null` 全reconcile で既に自己修復＝架空の問題 |
| Motion / react-spring | View Transitions+CSS で核心は実現済み、11島IIFE悪化の代償が痛点(sev2)を上回る |
| electron-trpc / Comlink | TS前提が TS未導入と噛み合わず、Comlink は公式に Electron 非互換明記 |
| dnd-kit ほか | 現行~80行が安定稼働、4種木構造判定は導入後も手書きのまま＝複雑さが移動するだけ |
| Jotai/Valtio/XState | 独立フラグ集合の状態に派生atom/Proxy検知/状態機械の強みが刺さらない |

### 効く順（横断ロードマップでなく"効く順"）

1. **今すぐ（独立・低リスク）**: Biome → IPC集中ラッパーで `catch{}` 一掃 → i18nキー網羅スクリプト。依存/CSP/ビルド無関係で検証表面積を即下げる。
2. **配布フェーズ**: electron-builder に publish/sign 追記 → electron-updater 配線 → SignPath を public化に合わせ事前申請（審査が律速＝早め）→ @electron/fuses を署名のついでに。
3. **段階的に型を載せる**: JSDoc+checkJs を preload/store/i18n の .d.ts から。masonic/lucide-react/TanStack Query 等 React 大物導入の前提「契約の見える化」。
4. **最終形B の地ならし後**: masonic ／ Floating UI ／ lucide-react ／ react-aria自前パレット を島 IIFE 重複を避け1ツリーで。
5. **痛みが顕在化したら**: MiniSearch+BudouX（タグ増で検索が線形劣化）／ sharp（webp/avif でサムネが無言で欠ける）／ better-sqlite3（数万件に育つ）。

## リリース準備

- **配布パッケージング**（electron-builder, win/nsis）。
- アプリ初回起動時に**拡張インストールのガイド**（ストア公開後）。未インストール/未接続を検知して案内。

### 0. 公開・署名の方針（2026-06-11 決定済み）

リリース時にリポジトリ（apricot-cake/corpus）を **public 化**（それまで private 厳守）。収益化なし。ライセンスは未決だが**緩い系でよい**。コード署名は**やる方針**。

### 1. 自動アップデート配信（実装は未着手・リリース準備時に）

- **electron-updater + 本リポの GitHub Releases**（public 化でリリース専用リポ不要）。
- 手順: ①`app/package.json` に electron-updater 追加 ②electron-builder の `publish: [{ provider:'github', owner:'apricot-cake', repo:'corpus' }]` ③`app/main.js` に `autoUpdater.checkForUpdatesAndNotify()`（起動時＋任意で定期）④リリースは version bump → `npm run dist -- --publish always`（GH_TOKEN 必要）。
- NSIS + blockmap で差分アップデート・latest.yml の sha512 で整合検証。拡張側は Chrome Web Store の自動更新（別系統）。

### 2. ライセンス

- 緩い系 → **MIT 推奨**（収益化なし・依存も問題なし）。リリース時に LICENSE ＋ app/package.json の `license` フィールド追加。

### 3. コード署名（やる方針）

- 効果: SmartScreen 初回警告の解消（評判蓄積）、アップデート改ざん耐性、AV誤検知の低減。
- **候補（OSS・無収益前提）**: **SignPath Foundation**（OSS無料・public リポ＋CI 連携が条件＝第一候補・審査あり・日本拠点でも申請可）／~~Azure Trusted Signing~~（**2026-07 時点で Identity Validation 対象国が US/CA/EU/UK のみ＝日本拠点は申請不可**・除外）／**Certum Open Source**（年€70前後＋初回カード/リーダー費・定番安価OV＝SignPath 審査待ちの有償フォールバック）。
- electron-builder の win.sign / signtool 設定が必要。NSIS の開発者モード要件（winCodeSign symlink）は docs/build.md 記載済み。
