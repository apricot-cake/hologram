# バックログ（未着手の残タスク・唯一の作業トラッカー）

完了は git が記録するので**完了項目は残さず削除**。実装済み機能・構成・検証手順は CLAUDE.md 他節＋メモリ `corpus-verify-notes` が真実源（重複させない）。

**最優先（次に着手）**: 注力テーマ＝タグ付けの根本解決（WD14 小スパイク）。確定セキュリティ／正しさの High（SSRF H-1・backfill null 破壊 #2）は解消済み。詳細は「タグ付け・整理」節。

## 監査で見つかった残課題（2026-06-27 UltraCode）

2026-06-27 に UltraCode 多エージェント監査をセキュリティ／正しさ・データ整合性／パフォーマンスの3面で実施。いずれも**総評は既に高水準**で確定分は少数。各面とも効き順に並べる。

### セキュリティ

ハードニング済み（制限的CSP `script-src 'self'`・contextIsolation+sandbox+nodeIntegration:false・SSRFガード・captureId allow-list・JPEGマジックバイト検査・zip-slip 二重ガード）。実害のあった H-1（16進 IPv4-mapped SSRF）は解消済み。残りは Low のみ。

- **【Low】ナビゲーションロックダウン未設置**（`app/main.js:1498-1544`）: `will-navigate`／`setWindowOpenHandler`／`web-contents-created` 未設置＋グローバル `dragover`/`drop` の preventDefault なし。ローカル `.html` をドロップするとトップフレームが `file://` へ遷移し、同一 preload を継承して `clearAll()`/`importComplete()` 等の破壊的IPCを実行可能。**修正**＝`web-contents-created` で遷移拒否＋`setWindowOpenHandler({action:'deny'})`＋グローバル drop 抑止（外部オープンは既存 `open-external` IPC に集約）。
- **【Low・脅威モデル次第】SSRFガードがホスト名を解決しない（DNSリバインディング）**（`native-host/media-download.js:76-88`）: コメント（41-45行）で明記の**意図的な受容リスク**。閉じるなら解決アドレスの public 検証＋接続ピン留め。許容なら現状維持（H-1 修正で最も直接的なIPリテラル経路は塞がる）。
- **【予防・任意】`.gitignore` に秘密ファイル除外を追加**: 現状コミット済み秘密はなし（`.pem`・config はリポ外 `~/.corpus`）だが、`*.pem`/`*.key`/`.env`/`config.json` をトリップワイヤとして追加し将来の人的ミスを防ぐ。
- **棄却（ガードが効いている裏取り・再調査しない）**: zip-slip（`isSafeEntryName`+`isWithin` 二重）／captureId トラバーサル（`SAFE_ID`）／プロトタイプ汚染（own プロパティのみ・脆弱マージなし）／trash の未エスケープ `<img src>`（CSP で script 不発）／Referer 注入（undici が CRLF 拒否）／native message 長さ（Chrome allowed_origins＋~1MB）／onMessage の sender 未検証（`externally_connectable` なし）／install・restart スクリプト（固定パス・argv 配列・非昇格）／サイドカーのパスフィールド（常に `path.basename`＋フォルダ内 resolve 検査）／open-external（`/^https?:\/\//i` allowlist）／サプライチェーン（実行時 npm 依存ゼロ・lockfile ピン留め）。

### 正しさ／データ整合性

`config.json`・save-pointer・サイドカー本体（`writeSidecarAtomic`）・`.index.json` は全て tmp+rename でアトミック化済み（torn-read 系 High は commit 9260c81 で解消）。確定分を効き順に。

- **【Low・#5】delete-post が投稿アバター `<base>-avatar.<ext>` を回収せず孤児化**（`app/main.js:863`）: targets が `.json`/VIEWABLE_EXTS/rec.image・media/`-media-`・`-poster.` のみでアバター（`rec.avatarFile`）を拾わず、trash 側の広い `base+'-'` 前方一致と非対称。データ消失でなく孤児累積（可逆）。**修正**＝targets に `path.basename(rec.avatarFile)`＋ディスク走査 `${base}-avatar.` を追加。
- **【Low・#1・任意フォローアップ】組織 JSON 読み側の degraded 化**＝「ファイルは存在するが parse 失敗」を空欠如と区別し degraded 扱いで空 persist を抑止（clear-all の degraded ガードと同思想・外部破損や既存 torn への多重防御）。書き込み側のアトミック化は対応済み＝その上の保険。
- **有力・要追加調査**: **L1**【Med-High】saveFolder 移動中に届いたキャプチャが旧フォルダに取り残され取りこぼし（`main.js:1389` copyLibraryInto のスナップショット→flip→cleanup の並行窓・bridge は別プロセスで非ロック）。対策＝移動中フラグで bridge 保留 or flip 前に src 再 readdir で差分追いコピー、cleanup を「dest 存在確認できたものだけ src 削除」に。 **L2**【Med】import-posts の重複検出が `url` のみ依存＝URL なしレコード（99.6% の Eagle 移行）が再インポートで毎回二重化（`main.js:996`・`.trash` 非走査・BOM 非耐性）。対策＝captureId/画像ハッシュ/eagleName 等にフォールバック。 **L3**【Med】サイドカー/組織 JSON 読みが BOM 非耐性（`lib-index.js:146`・各 get-*・`lib-archive.js` import マージ）＝BOM 付き JSON で投稿が静かに欠落、最悪 record:null→reconcile が collections/clip 恒久 purge。対策＝全 JSON 読みを共通ヘルパに集約し先頭 U+FEFF を剥ぐ。 **L4**【Low】import の `mergeManualGroups`（`lib-archive.js:122`）が集合 dedup のみでメンバー交差を解消せず「1 captureId 1 グループ」不変条件を破る（可逆）。対策＝union-find。
- **次に調べる（網羅性ギャップ・未裏取り）**: ①`lib-index.js:139,190` の mtimeMs 単一信号による「変更なし」誤判定＝タグ付けが tags/userKind/tagReviewed を単一 update-tags で原子的に書くか要確認。②自己リプライ・グルーピングの alias 解決が深さ10で打ち切り（`viewer.js:2458`）＝11投稿超のセルフリプライでグループ分裂。③saveFolder 移動後に renderer の組織ストア（`CF().load()`/getPosterTags 等）を再読込しない（`viewer.js:5945`）。④delete-post の disk-sweep 前方一致（`main.js:881`）が `-N` 接尾辞 base と境界文字で分離できるか（境界テスト無し）。⑤デバウンス persist の最終フラッシュが `before-quit` で保証されるか。
- **棄却（ガードが効いている裏取り・再調査しない）**: update-tags/restore-post の torn-read（`writeSidecarAtomic`＋commit 9260c81・直書きは現存0件＝発見の行番号 stale）／clear-all が delta ベースライン非リセット（added は現在スキャン由来・stale は removed の no-op・captureId は再利用なし）／facetCounts への sticky 混入（件数バッジも同じ getFilteredPosts 由来で一様・~400ms 後 clear）／buildUsers 先勝ちで表示名/アバターが古い（表示のみ・userKey 安定・再起動で自己修復）／config の saveFolder 死パスで空表示（ENOENT→no-op・データ無傷・再接続で復元）／import で未移行 folders.json 孤児化（起動時 `CF().load()` が import 前に必ず移行＝到達不能）／trash 3操作の captureId 前方一致衝突（`Date.now()+rand16` で極小確率）。

### パフォーマンス（UI操作）

確定した残課題を効き順に。**実ライブラリは99.6%が無タグ Eagle 移行・投稿者は数十件**なので、投稿者/コレクション系の窓無し描画や多くのメモ化欠如は現スケールでは体感に出ない（将来 SNS 主体化で効く構造負債）。

- **main 側 I/O**: ①起動時 listPostsDelta が全 ~7600件を1回の IPC structured clone（full:true・`main.js:251`）＝初回ペイント前に同期ブロック。フィールドのスリム化/チャンク化の余地。②psimg の原寸（?w= 無し）を `fs.readFile` で全バッファ（`main.js:366`）＝`stream:true` 特権があるのに非ストリーム。大判の連続オープンで GC 圧。
- **low 群（generation キャッシュ idiom の横展開で消せる衛生案件・現状は体感薄）**: textHaystack の反復 toLowerCase（2550）、buildSuggest のタグ集計未キャッシュ（5616）、getFilteredPosts 前段 filter、date 述語の境界 Date 再生成、snapshotState 二重直列化、lightbox の decode/隣接プリロード欠如（3393）、pf-badge の backdrop-filter（`index.html:871`）。
- **dev限定（未調査）**: 開発中の `reloadIgnoringCache` 反復でレンダラ/GPU リソースが蓄積し激重化（アイドル 2fps）＝再起動でクリア。リスナ累積でなく蓄積系・根本要因未特定。
- **⏸ 保留（再監査しない）**: card(masonry) の仮想化＝深スクロールでカードが溜まり線形劣化（`viewer.js:3061`/`index.html:808`）。リスク>リターンで見送り（既定ビューの根幹・回帰リスク高・効果中）。やるなら「content-visibility:auto を当てて FPS と崩れを測る半日スパイク」から。

## タグ付け・整理（注力テーマ）

booru 型イラストアーカイブ（実測はメモリ `library-composition`＝99.6% Eagle 移行・約7600枚無タグ・既存タグは日本語の作画資料寄り）。**ソースタグ取込（案①）はこのライブラリでは無力**（Eagle 移行は URL/ソースタグ無し）＝実効レバーは **②ローカルML(WD14) か ④手動UX改善**に絞られる（検討中 2026-06-19）。

- **WD14 ローカル推論（調査済み 2026-06-21・本命）**: `SmilingWolf/wd-eva02-large-tagger-v3`（Apache-2.0・onnx 約1.26GB／軽量 wd-vit-v3 は数百MB）を `onnxruntime-node`（Electron 対応・`asarUnpack` 必須・GPU は DirectML/CUDA EP）で。前処理 448²/RGB→BGR/白パディング・閾値カテゴリ別（general 0.35・character 0.85）。**語彙マッピングは既製辞書 `isek-ai/danbooru-wiki-2024`**（CC-BY-SA・`other_names` に日本語別名）で作品/キャラ高カバレッジ（種別=用語帳が流し込み先）。general は対訳不完全＝英タグのまま＋頻出語手動補正、or CLIP 検索に委ねる。確認ゲート付き運用は「不透明・低精度・自動適用」の却下理由を踏まない＝原則の精緻化。
- **確認キューUI（案④）**: 候補を1タップ承認（前例＝Google Photos 顔まとめ）。「N枚が[キャラA]推定→まとめて承認/例外だけ外す」。
- **要判断**: (a) 代表100枚の小スパイク（推論時間/作品キャラ命中率/辞書命中率の実測）実施か (b) Python sidecar 許容か Node 完結か (c) 確認ゲート付きで「自動候補は不採用」原則を見直すか (d) 英日マッピングの不完全さ（作品キャラ自動・general 割り切り）を許容するか。
- **別解**: CLIP意味検索＋OCR＋本文検索で「整理用の検索」が足りればタグ付け自体を減らせる。
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

- **ビュー/レイアウト切替のモード表示＋スライド（着手途中 2026-06-27）**: ①ビューセグメントのアクティブをアイコン（グリフ）表示に戻す＝前回ラベルのみにした `index.html` `.browse-toggle button.active *` 周辺 CSS を撤回し全状態アイコン表示（`.view-toggle` 既定）に。②現在のビュー/レイアウト名を見出しに併記＝「ビュー · ライブラリ」「レイアウト · カード」。`sbViewTitle`/`sbLayoutTitle`/`sbPosterLayoutTitle` を `setBrowseMode`／density 切替で動的更新（i18n は `browsePosts/Posters/Collections`・`viewCard/Tile/List` 既存）。③レイアウトセグメント（`densityToggle`/`posterDensityToggle`）のつまみスライドが効かない＝`startViewTransition(() => renderPosts())` がつまみ(.vt-thumb)を巻き込む疑い（要 CDP 確認・body-class 測定タイミング commit f15ad13 とは別原因）。
- **クエリビルダーがアドレスバーに見える＝初見が「クリックして入力」を試す（未決・要判断 2026-06-21）**: 二択＝**(a)** 「ここには直接入力できません／フィルタは◯◯から」のヒントで現行の追加導線へ誘導（軽い）／**(b)** ブラウザ風にテキスト入力＋候補サジェストで直接フィルタを投入（誤認を機能に変える・既存 `queryTree`/`addFilter` に乗せる）。b は「詳細検索画面」「コマンドパレット」「本文全文検索」と接近＝設計を寄せられるか。
- **コマンドパレット**（Cmd+K 的＝フィルタ/操作/タブ移動の検索式ランチャ）。
- **本文の全文検索の専用UX（残）**: 本文/タイトル/pixivキャプションのマッチは実装済み（クイック検索＝現タブ絞り込み）。**残**＝ライブラリ全体横断の専用全文検索体験（全タブ越え・結果一覧・本文ハイライト/該当箇所ジャンプ）を出すか要設計。コマンドパレットとは別物。
- **複数ウィンドウの許可**: 現状の単一ウィンドウ制約を緩める。

## 保存・取込・メディア

- **重複保存の警告（コピー/置換/スキップ・未実装・設計調査済み 2026-06-21）**: 同じ投稿URLが既にライブラリにある状態で再保存（再キャプチャ/ドラッグ/取込）したら止めて「両方残す/置き換える/スキップ」を選ばせる。現状は captureId 単位で無条件に別ファイル保存＝同じ画像が×Nに増える。判定キーは既存 `postKeyOf(url)`(viewer.js) の正規化プラットフォームキー（x⇄twitter 統合済み）を共有モジュール化して renderer/main 共用。照会先はレンダラ保持の `allPosts`（url→captureId 逆引き Map を1本足すだけ・コンテンツハッシュは不採用＝スクショは毎回バイト差）。**警告はアプリ取込時に寄せる**＝拡張キャプチャは一旦保存（write-once 維持）、アプリが delta 受信フックで同一キーの先客を検出→後追い重複解決ダイアログ（全経路を1箇所でカバー・ブリッジ無改造）。3択は既存 `delete-post` を再利用（置換=旧をソフト削除/スキップ=新を取消/両方=現状）。注: `import-images`(ローカル取込)は url=null＝対象外。**段階**: P0 `postKeyOf` 共有化→P1 `import-posts` を正規化＋3択化→P2 キャプチャ経路の後追い検出→P3 既存重複の遡及掃除UI。**要判断**: 警告タイミング（後追い vs 保存前バナー）／null 同士は重複扱いせず安全側で可か／置換で旧タグ/フォルダを引き継ぐか／遡及掃除をやるか。
- **画像に任意テキストを付与（自由メモ／未着手）**: 各キャプチャにタグとは別の自由記述テキストを入力して紐付けたい。保存先（サイドカー JSON への欄追加）・全文検索の対象に含めるか・UI（インスペクタの入力欄）は要設計。
- **既存ライブラリの補完（個人作業）**: ①リンク→拡張で再キャプチャ（画像/メタ欠損分・backfill はメタのみ）。②アバター backfill＝`backfill-metadata.js --avatars`（未 backfill はモノグラム表示・流すと実画像に）。

## ロゴ・ブランド

- **ロゴ根本見直し（未着手・次は設計から）**: 現行ロゴ `{ ♡ }`（線画）は 16/32px の拡張アイコン/ファビコンで潰れる（横長 viewBox のレターボックス・細ストロークのサブピクセル消失・2色判別不能）。塗りマーク化を試作したが不採用＝前提に縛られず方向を設計から再検討。引き継ぐ要件＝小サイズで読める・正方・面/マス主体（Apple HIG/Material/Fluent の定石）。維持する制約＝意味の三位一体（`{ }`＝サイドカー・♡＝収集動機の分離禁止）とワードマーク（線画 `{ ♡ }`・Plex Mono）。試作 SVG（`assets/icon-mark-*`）と make-icons.js 塗り版はリポ残置（参考・未採用・PNG 未再生成）。**別案（ユーザー発案）**＝意味の三位一体はあえて外し、ペンローズの三角形／AFFiNE のアイコン風の幾何マークで視認性・「らしさ」優先（面/マス主体で小サイズに強い）。意味性とのトレードオフは設計時に判断。

## 実機検証・開発インフラ

- **拡張の実機E2E拡充**: 特に X＝要ログインで未自動化（puppeteer は bot検出で弾かれる）。`e2e-capture-test.js`（全PF PASS・X除外）の延長で X を認証済みプロファイル/Claude in Chrome で。手動X残テスト（A-1系）もここで。
- **実機キャプチャの実ブラウザ経由 最終目視確認（残）**: Chrome 無しの end-to-end は検証済み（メモリ `corpus-library-loss-incident`）。残＝実機 Chrome で1件キャプチャ（Alt+S/ドラッグ）し保存先に `.jpg`+`.json` が落ちるのを目視。リモートでは不可＝実機で。
- **開発共通ルールを親フォルダの CLAUDE.md に集約**→重複削除（上位集約）。

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
- **候補（OSS・無収益前提）**: **SignPath Foundation**（OSS無料・public リポ＋CI 連携が条件＝第一候補・審査あり）／**Azure Trusted Signing**（約$9.99/月・個人開発者の本人検証対応・electron-builder 統合）／**Certum Open Source**（年€70前後＋初回カード/リーダー費・定番安価OV）。
- electron-builder の win.sign / signtool 設定が必要。NSIS の開発者モード要件（winCodeSign symlink）は docs/build.md 記載済み。
