# バックログ（未着手の残タスク・唯一の作業トラッカー）

完了は git が記録するので**完了項目は残さず削除**。実装済み機能・構成・検証手順は CLAUDE.md 他節＋メモリ `corpus-verify-notes` が真実源（重複させない）。

## 作者まわり（クラスタ）
- **同一投稿者がSNS別にばらける→名寄せ（未実装・設計調査済み 2026-06-21）**: 同じ人でもプラットフォームが違うと別グループになる。手動で紐づける＋自動で同一人物を提案（名寄せ候補）。呼称は「投稿者」確定（DESIGN.md「用語」）。※`poster-aliases.json` はまだ存在しない＝完全未着手。
  - **データモデル**: `<saveFolder>/poster-aliases.json`＝`{groups:[{id,primary,members:[posterKey]}]}`（poster-folders.json と同型＋代表キー primary）。別レイヤーで束ね非破壊（保存は個別キー・表示は実行時合算）。5点セット（get/set-poster-aliases IPC・preload・INTERNAL_FILES・clear-all スキップ・`mergePosterAlias`）は poster-tags.json が雛形。マージは union-find（1キー1グループ・primary ローカル優先）。
  - **波及の核**: `buildUsers()`(viewer.js) の集約キーを alias 解決後 id にする1点改修＋`predOf` user を集合一致化で、投稿数集計/`user` フィルタ/ジャンプ/カード描画がほぼ自動波及。`buildUsers` キャッシュは名寄せ変更で bust。
  - **手動UI**: 投稿者インスペクタ＋カード右クリック「同一人物にする/解除」＋投稿者ピッカー（`renderTagPicker` 流用）＋確認＋Undo。D&D不採用（グリッド並び替えで誤操作が破壊的）。
  - **自動候補**: 決定的・説明可能ルールの重み合算（@ハンドル完全一致＞displayName 正規化一致＞類似）。根拠明示・確認で確定・薄いうちは沈黙。アバター知覚ハッシュ／プロフィールリンク相互参照は段階③。
  - **段階**: ①基盤＋手動＋全波及 → ②自動候補 → ③候補強化/確認キュー。**要判断**: UI 置き場（推奨インスペクタ）／自動候補の強さ／タグ・フォルダは非破壊合算か物理マージか／primary 決め方／粒度（person 固定推奨）。
- **投稿者モード→投稿一覧を別タブで開く選択肢（要設計）**: 現状はダブルクリックで同じタブを投稿モードに切替＋その投稿者の `user` フィルタ。別タブ案はスイッチ切替想定と整合が取りにくく要設計のまま。
- **戻る/進むにライブラリ↔投稿者モード切替も含める（要設計）**: 現状の履歴ナビは browseMode 切替を積まない。論点＝履歴に積む単位（フィルタ変更との粒度整合）。
- **（個人作業）既存ライブラリの補完**: ①リンク→拡張で再キャプチャ（画像/メタ欠損分・backfill はメタのみ）。②アバター backfill＝`backfill-metadata.js --avatars`（未 backfill はモノグラム表示・流すと実画像に）。

## その他
- **複数ウィンドウの許可**: 現状の単一ウィンドウ制約を緩める。
- **重複保存の警告（コピー/置換/スキップ・未実装・設計調査済み 2026-06-21）**: 同じ投稿URLが既にライブラリにある状態で再保存（再キャプチャ/ドラッグ/取込）したら止めて「両方残す/置き換える/スキップ」を選ばせる。現状は captureId 単位で無条件に別ファイル保存＝同じ画像が×Nに増える。判定キーは既存 `postKeyOf(url)`(viewer.js) の正規化プラットフォームキー（x⇄twitter 統合済み）を共有モジュール化して renderer/main 共用。照会先はレンダラ保持の `allPosts`（url→captureId 逆引き Map を1本足すだけ・コンテンツハッシュは不採用＝スクショは毎回バイト差）。**警告はアプリ取込時に寄せる**＝拡張キャプチャは一旦保存（write-once 維持）、アプリが delta 受信フックで同一キーの先客を検出→後追い重複解決ダイアログ（全経路を1箇所でカバー・ブリッジ無改造）。3択は既存 `delete-post` を再利用（置換=旧をソフト削除/スキップ=新を取消/両方=現状）。注: `import-images`(ローカル取込)は url=null＝対象外。**段階**: P0 `postKeyOf` 共有化→P1 `import-posts` を正規化＋3択化→P2 キャプチャ経路の後追い検出→P3 既存重複の遡及掃除UI。**要判断**: 警告タイミング（後追い vs 保存前バナー）／null 同士は重複扱いせず安全側で可か／置換で旧タグ/フォルダを引き継ぐか／遡及掃除をやるか。
- **コマンドパレット**（Cmd+K 的＝フィルタ/操作/タブ移動の検索式ランチャ）。
- **本文の全文検索の専用UX（残）**: 本文/タイトル/pixivキャプションのマッチは実装済み（クイック検索＝現タブ絞り込み）。**残**＝ライブラリ全体横断の専用全文検索体験（全タブ越え・結果一覧・本文ハイライト/該当箇所ジャンプ）を出すか要設計。※コマンドパレットとは別物。
- **開発共通ルールを親フォルダの CLAUDE.md に集約**→重複削除（上位集約）。
- **拡張の実機E2E拡充**: 特に X＝要ログインで未自動化（puppeteer は bot検出で弾かれる）。`e2e-capture-test.js`（全PF PASS・X除外）の延長で X を認証済みプロファイル/Claude in Chrome で。手動X残テスト（A-1系）もここで。
- **実機キャプチャの実ブラウザ経由 最終目視確認（残）**: Chrome 無しの end-to-end は検証済み（メモリ `corpus-library-loss-incident`）。残＝実機 Chrome で1件キャプチャ（Alt+S/ドラッグ）し保存先に `.jpg`+`.json` が落ちるのを目視。リモートでは不可＝実機で。
- **ロゴ根本見直し（未着手・次は設計から）**: 現行ロゴ `{ ♡ }`（線画）は 16/32px の拡張アイコン/ファビコンで潰れる（横長 viewBox のレターボックス・細ストロークのサブピクセル消失・2色判別不能）。塗りマーク化を試作したが不採用＝前提に縛られずブランド/アイコンの方向を設計から再検討。引き継ぐ要件＝小サイズで読める・正方・面/マス主体（Apple HIG/Material/Fluent の定石）。維持する制約＝意味の三位一体（`{ }`＝サイドカー・♡＝収集動機の分離禁止）とワードマーク（線画 `{ ♡ }`・Plex Mono）。試作 SVG（`assets/icon-mark-*`）と make-icons.js 塗り版はリポ残置（参考・未採用・PNG 未再生成）。**別案（ユーザー発案）**＝意味の三位一体はあえて外し、ペンローズの三角形／AFFiNE のアイコン風の幾何マークで視認性・「らしさ」優先という方向も候補（面/マス主体で小サイズに強い）。意味性とのトレードオフは設計時に判断。
- **ユーザー一覧タブのフォロー数/作成日付与（未実装）**。
- **画像に任意テキストを付与（自由メモ／未着手）**: 各キャプチャにタグとは別の自由記述テキストを入力して紐付けたい。保存先（サイドカー JSON への欄追加）・全文検索の対象に含めるか・UI（インスペクタの入力欄）は要設計。

## タグ付け／整理（クラスタ）

- **作品/キャラの第一級カテゴリ＝実装済み**（用語帳方式 `tag-types.json`・サイドバー/パレットの独立セクション格上げ・作品→キャラ共起候補・種別リネーム・同名キャラ衝突の freeform 区別）。真実源＝code＋DESIGN.md＋メモリ `corpus-tag-kinds-state`（現況: 作品種別17/キャラ2・共起0件＝候補未発火）。
- **タグの複数グループ所属を許すか検討（未着手）**: 現状は実質1タグ1グループ（未所属＝未分類）。1タグが複数観点（例「構図」かつ「主題」）に属したいケースに多重所属を許すか。影響＝サイドバーの重複表示・件数二重計上・パレットで同タグが複数セクション・未分類の定義変化。種別（用語帳・1タグ1種別の排他レイヤー）とは別軸。前例＝danbooru は排他／Eagle・Notion は多重可。判断軸＝柔軟さが UI/集計の複雑化に見合うか。
- **関連タグ提案（共起・確認付き／未着手）**: 全タグの同時出現から「X→Y もよく一緒」を**弱いヒント**で出す汎用版（作品/キャラのスコープ付き共起とは別の二次機能）。守る条件＝①押し付けない（候補を上に出すだけ・全語彙は残す）②なぜ出たか説明可能（共起回数）③勝手に付けない④信頼度段階化（スコープ付き＝強・全タグ＝弱）⑤データが薄いうちは出さない。カテゴリ無しの全タグ共起はノイズ＋親方向が推測になるので弱ヒント止まり。
- **タグ付けの手間軽減 or 根本解決（注力テーマ・検討中 2026-06-19）**: booru 型イラストアーカイブ（実測はメモリ `library-composition`＝99.6% Eagle 移行・約7600枚無タグ・既存タグは日本語の作画資料寄り）。**ソースタグ取込（案①）はこのライブラリでは無力**（Eagle 移行は URL/ソースタグ無し）＝実効レバーは **②ローカルML(WD14) か ④手動UX改善**に絞られる。
  - **WD14 ローカル推論（調査済み 2026-06-21・本命）**: `SmilingWolf/wd-eva02-large-tagger-v3`（Apache-2.0・onnx 約1.26GB／軽量 wd-vit-v3 は数百MB）を `onnxruntime-node`（Electron 対応・CPU 依存ゼロ・`asarUnpack` 必須・GPU は DirectML/CUDA EP）で。前処理 448²/RGB→BGR/白パディング・閾値カテゴリ別（general 0.35・character 0.85）。**語彙マッピングは既製辞書 `isek-ai/danbooru-wiki-2024`**（CC-BY-SA・`other_names` に日本語別名）で作品/キャラ高カバレッジ（種別=用語帳が流し込み先）。general は粒度独自で対訳不完全＝英タグのまま＋頻出語手動補正、or CLIP 検索に委ねる。**確認ゲート付き運用は却下理由（不透明・低精度・自動適用）を踏まない**＝原則の精緻化。
  - **確認キューUI（案④）**: 候補を1タップ承認（前例＝Google Photos 顔まとめ）。「N枚が[キャラA]推定→まとめて承認/例外だけ外す」。
  - **要判断**: (a) 代表100枚の小スパイク（推論時間/作品キャラ命中率/辞書命中率の実測）実施か (b) Python sidecar 許容か Node 完結か (c) 確認ゲート付きで「自動候補は不採用」原則を見直すか (d) 英日マッピングの不完全さ（作品キャラ自動・general 割り切り）を許容するか。
  - **別解**: CLIP意味検索＋OCR＋本文検索で「整理用の検索」が足りればタグ付け自体を減らせる。

## UX再設計の指摘（2026-06-20 フィードバック・要整理＝次は設計から）

相互依存が強いので実装前に設計を固める。

### ナビ/検索UI
- **クエリビルダーがアドレスバーに見える＝初見が「クリックして入力」を試す（未決・要判断 2026-06-21）**: 二択＝**(a)** 「ここには直接入力できません／フィルタは◯◯から」のヒントで現行のフィルタ追加導線へ誘導（軽い）／**(b)** ブラウザ風にテキスト入力＋候補サジェストで直接フィルタを投入（誤認を機能に変える＝アドレスバー的オムニ入力・既存 `queryTree`/`addFilter` に乗せる）。bは「詳細検索画面」「コマンドパレット」「本文全文検索」と接近＝設計を寄せられるか。次セッションで方針決め。
- **ビュー/レイアウト切替のモード表示＋スライド（着手途中 2026-06-27）**: ①ビューセグメントのアクティブをアイコン（グリフ）表示に戻す＝前回ラベルのみにした index.html `.browse-toggle button.active *` 周辺 CSS を撤回し全状態アイコン表示（`.view-toggle` 既定）に。②現在のビュー/レイアウト名を見出しに併記＝「ビュー · ライブラリ」「レイアウト · カード」（ユーザー選択済み）。`sbViewTitle`/`sbLayoutTitle`/`sbPosterLayoutTitle` を `setBrowseMode`／density 切替で動的更新（i18n は `browsePosts/Posters/Collections`・`viewCard/Tile/List` 既存）。③レイアウトセグメント（`densityToggle`/`posterDensityToggle`）のつまみスライドが効かない＝`startViewTransition(() => renderPosts())` がつまみ(.vt-thumb)を巻き込む疑い（要 CDP 確認・body-class 測定タイミング commit f15ad13 とは別原因）。

## パフォーマンス（UI操作）

2026-06-27 に UltraCode 多エージェント監査を実施（renderer 描画＋main I/O を7レンズ・発見→敵対的検証→網羅性クリティック）。確定した残課題を効き順に。**実ライブラリは99.6%が無タグ Eagle 移行・投稿者は数十件**なので、投稿者/コレクション系の窓無し描画や多くのメモ化欠如は現スケールでは体感に出ない（将来 SNS 主体化で効く構造負債）。

- **main 側 I/O（gaps）**: ①起動時 listPostsDelta が全 ~7600件を1回の IPC structured clone（full:true・main.js:251）＝初回ペイント前に同期ブロック。フィールドのスリム化/チャンク化の余地。②psimg の原寸（?w= 無し）を `fs.readFile` で全バッファ（main.js:366）＝`stream:true` 特権があるのに非ストリーム。大判の連続オープンで GC 圧。
- **low 群（generation キャッシュ idiom の横展開で消せる衛生案件・現状は体感薄）**: textHaystack の反復 toLowerCase（2550）、buildSuggest のタグ集計未キャッシュ（5616）、getFilteredPosts 前段 filter、date 述語の境界 Date 再生成、snapshotState 二重直列化、lightbox の decode/隣接プリロード欠如（3393）、pf-badge の backdrop-filter（index.html:871）。
- **dev限定（未調査）**: 開発中の `reloadIgnoringCache` 反復でレンダラ/GPU リソースが蓄積し激重化（アイドル 2fps）＝再起動でクリア。リスナ累積でなく蓄積系。根本要因（オブザーバ/GPU レイヤ）未特定。
- ⏸ **保留（再監査しない）**: card(masonry) の仮想化＝深スクロールでカードが溜まり線形劣化（viewer.js:3061 / index.html:808）。リスク>リターンで本実装は見送り（既定ビューの根幹・回帰リスク高／効果は中・体感は要測定）。やるなら「content-visibility:auto を当てて FPS と崩れを測る半日スパイク」から。

## セキュリティ（監査 2026-06-27）

2026-06-27 に UltraCode 多エージェント・セキュリティ監査を実施（攻撃面6レンズ＝Electron main／renderer XSS／native host／拡張／データ・アーカイブ／秘密・デプロイ → 発見26件 → 独立懐疑エージェントの敵対的検証 → 網羅性クリティック・37エージェント）。**総評＝既に高水準でハードニング済み**（制限的CSP `script-src 'self'`・contextIsolation+sandbox+nodeIntegration:false・SSRFガード・captureId allow-list・JPEGマジックバイト検査・zip-slip 二重ガード）で、確定5件中**実害があるのは H-1 のみ**。22件は「ガードが正しく効いている」裏取りで棄却。確定分を効き順に。

- **【High・最優先】SSRFガードのバイパス: 16進形式の IPv4-mapped IPv6 が私的レンジ検査をすり抜ける**（`native-host/media-download.js:61-83`）: `isPrivateIp` の mapped 検出はドット10進（`(\d{1,3}\.){3}\d{1,3}`）専用だが、`checkMediaUrl` が読む `new URL().hostname` を WHATWG パーサが16進（`::ffff:7f00:1`）へ正規化するため正規表現に不一致＝`::ffff:0:0/96` 全域で私的判定が無効化。`https://[::ffff:169.254.169.254]/...`（クラウドメタデータ）・`[::ffff:127.0.0.1]`（ループバック）・`[::ffff:192.168.x.x]`（RFC1918）が ALLOWED になるのを**自環境で再現確認済み**。敵対SNSページ／任意 Misskey・Mastodon インスタンスのメタdata から、capture・import-posts・`backfill-metadata.js` 経由でブラインドSSRF到達。**修正案**＝family6 の `::ffff:x:x`（16進mapped）を検出して埋め込みv4を復元し `isPrivateIPv4` を適用。`scripts/test-bridge-ssrf.js` に mapped 形式の回帰テストを追加（既存は `[::1]`/`[fe80::1]`/`[fc00::1]` は網羅、mapped 未テスト）。
- **【Low】ナビゲーションロックダウン未設置**（`app/main.js:1498-1544`）: `will-navigate`／`setWindowOpenHandler`／`web-contents-created` 未設置、かつグローバルな `dragover`/`drop` の preventDefault なし。ローカル `.html` をウィンドウにドロップするとトップフレームがその `file://` へ遷移し、同一 preload を継承して `window.corpus.clearAll()`/`importComplete()` 等の破壊的IPCを実行可能。**修正案**＝`web-contents-created` で遷移拒否＋`setWindowOpenHandler({action:'deny'})`＋グローバル drop 抑止（外部オープンは既存 `open-external` IPC に集約）。将来クリック可能な攻撃者制御 href が混入した際の増幅器化も防ぐ。
- **【Low】complete-import の zip爆弾／非有界展開**（`app/lib-archive.js:204-230`）: `importCompleteZip` はエントリ毎/合計の展開サイズ・エントリ数に上限なし。悪意ある `corpus-export.zip`（マシン間共有を明示想定）でメインプロセスのメモリ枯渇。**修正案**＝展開前に `uncompressedSize` 合計・エントリ数を上限チェック、大エントリはバイト上限付きでストリーム書き出し。
- **【Low・脅威モデル次第】SSRFガードがホスト名を解決しない（DNSリバインディング／攻撃者ドメイン→私的IP）**（`native-host/media-download.js:76-88`）: コード内コメント（41-45行）で明記された**意図的な受容リスク**。ブラックリスト外のホスト名は解決せず通過する（ただし content-type 制約でブラインド）。脅威モデル上閉じるなら解決アドレスの public 検証＋接続ピン留め。許容なら現状維持（H-1 修正で最も直接的なIPリテラル経路は塞がる）。
- **【予防・任意】`.gitignore` に秘密ファイル除外を追加**: 現状コミット済み秘密はなし（署名 `.pem`・config は設計上リポ外 `~/.corpus`）だが、`*.pem`/`*.key`/`.env`/`config.json` をトリップワイヤとして追加し将来の人的ミスを防ぐ。
- **確認済み・修正不要（再調査しない＝ガードが効いている裏取り）**: zip-slip（`isSafeEntryName`+`isWithin` 二重ガード）／captureId トラバーサル（`SAFE_ID`）／プロトタイプ汚染（`JSON.parse` は own プロパティのみ・脆弱なマージシンクなし）／trash の未エスケープ `<img src>`（CSP で script 不発・表示崩れ止まり）／Referer ヘッダ注入（undici が CRLF を TypeError 拒否）／native message 長さ無制限（Chrome の allowed_origins＋~1MB 上限）／onMessage の sender 未検証（`externally_connectable` なし＝Web から到達不能）／install・restart スクリプト（固定・非汚染パス・argv 配列・`process.execPath`・非昇格）／サイドカーのパスフィールド（`image`/`media[].file`/`avatarFile` は fs/protocol 使用前に常に `path.basename`＋フォルダ内 resolve 検査）／open-external（`/^https?:\/\//i` allowlist）／サプライチェーン（Electron は実行時 npm 依存ゼロ・native host は Node 標準のみ・lockfile ピン留め）。

## 正しさ／データ整合性（監査 2026-06-27）

2026-06-27 に UltraCode 多エージェント・正しさ/データ整合性監査を実施（6レンズ＝watch.delta競合／書き込み原子性／整理レイヤー変更ロジック／移行冪等性／queryTree述語・キャッシュ／Undo・復旧 → 発見22件 → 「到達可能性」「意図挙動か」の2視点で独立敵対的検証 → 網羅性クリティック → 統合・52エージェント）。**総評＝既に高水準**: `config.json`・save-pointer・**サイドカー本体**（`writeSidecarAtomic`）・`.index.json` は全て tmp+rename でアトミック化済みで、torn-read 系の High 懸念は **commit 9260c81 で既に塞がれ全て棄却**。

- **【確定#1】組織 JSON のアトミック化＝✅実装済み（git・`writeJsonAtomicSync`/`writeOrgAtomic` で set-* 等 10 箇所＋import マージを tmp+rename 化）**。**残（任意フォローアップ）**＝読み側で「ファイルは存在するが parse 失敗」を空欠如と区別し degraded 扱いで空 persist を抑止（clear-all の degraded ガードと同思想・外部破損や既存 torn ファイルへの多重防御）。
- **【High・確定#2】backfill `--all` が再取得失敗時に既存メタを null 上書き（X/Bluesky・非冪等・不可逆）**（`scripts/backfill-metadata.js:87-126`・`extension/metadata.js:104`(X)/204(Bluesky)）: スキップガードが `!screenName && !text && !date` のみだが、X/Bluesky は fetch 前に URL 由来 `screenName`/`handle` を必ず立てるため通信失敗レコードでもガードを通過し、本文/著者名/userId/統計/言語が既存値を null 破壊（Misskey/Mastodon/pixiv は失敗時 screenName も null で保護）。**修正**＝成功判定を URL 由来でない API フィールド（text/likes/date の存在）に変える＋統計/本文も `m.X ?? rec.X` 非破壊マージ＋書き込み tmp+rename。
- **【Med-High・確定#3】バックアップが可変な組織 JSON を「不変資産」扱いで初回以降コピーしない（復元で整理が陳腐化）**（`app/main.js:1292`・コメント「assets are immutable — existence check only」・`if (destSet.has(f)) continue;`）: 画像/サイドカーは write-once なので存在チェックで正しいが、組織 JSON は編集毎に上書きされる可変ファイル＝初回後永久 skip でバックアップ側が凍結。復元すると以後の全整理編集が消える。**修正**＝INTERNAL_FILES のうち write-once でないものを `MUTABLE_INTERNAL` 集合化し、可変ファイルは mtime/サイズ比較 or 無条件再コピー（tmp+rename）。`test-app-backup.js` に「組織 JSON 2 回編集→バックアップ→ミラー最新化」ケース追加。
- **【Med・確定#4】日付フィルタ述語のタイムゾーン境界ずれ（ローカル深夜 vs UTC 投稿時刻）**（`app/renderer/viewer.js:1757` `case 'date'`）: `from = new Date(f.from+'T00:00:00')` は**ローカル**深夜なのに `d = new Date(p[field])` は UTC 瞬時。JST 等で境界が数時間ずれ、深夜近傍の投稿が日付絞り込みから黙って漏れる/余分に入る（`captured`/`date` 同型・データは無事）。**修正**＝`from`/`to` を UTC 解釈（`'T00:00:00Z'`）か `p[field]` をローカル暦日に正規化、どちらか片方に統一し終端日包含の exclusive next-day を維持。`test-app-search.js` に非 UTC 境界テスト追加。
- **【Low・確定#5】delete-post が投稿アバター `<base>-avatar.<ext>` を回収せず孤児化**（`app/main.js:863`）: targets が `.json`/VIEWABLE_EXTS/rec.image・media/`-media-`・`-poster.` のみでアバター（`rec.avatarFile`）を拾わず、trash 側 3 操作の広い `base+'-'` 前方一致と非対称。データ消失でなく孤児累積（可逆）。**修正**＝targets に `path.basename(rec.avatarFile)` ＋ディスク走査 `${base}-avatar.` を追加。
- **【有力・要追加調査】**: **L1**【Med-High】saveFolder 移動中に届いたキャプチャが旧フォルダに取り残され新ライブラリから取りこぼし（`main.js:1389` copyLibraryInto のスナップショット→flip→cleanup の並行窓・bridge は別プロセスで非ロック／handleSave は .jpg 先・.json 後の分割窓も）。対策＝移動中フラグで bridge 保留 or flip 前に src 再 readdir で差分追いコピー、最低限 cleanup を「dest 存在確認できたものだけ src 削除」に。 **L2**【Med】import-posts の重複検出が `url` のみ依存＝**URL なしレコード（ライブラリの 99.6% を占める Eagle 移行）が再インポートで毎回二重化**（`main.js:996`・`.trash` も非走査・BOM 非耐性）。対策＝captureId/画像ハッシュ/eagleName 等の安定キーにフォールバック。 **L3**【Med】サイドカー/組織 JSON 読みが **BOM 非耐性**（コードに BOM 除去ゼロ・grep 0 件／`lib-index.js:146`・各 get-*・`lib-archive.js` import マージ）＝外部生成 BOM 付き JSON で投稿が静かに欠落/取込破棄、最悪 record:null→reconcile が collections/clip 恒久 purge。対策＝全 JSON 読みを共通ヘルパに集約し先頭 U+FEFF を剥ぐ。 **L4**【Low】import の `mergeManualGroups`（`lib-archive.js:122`）が集合 dedup のみでメンバー交差を解消せず「1 captureId 1 グループ」不変条件を破る（共有 captureId×部分重複グループの再インポートで誤再編・可逆）。対策＝union-find でメンバー統合。
- **次に調べる（網羅性ギャップ・未裏取り）**: ①`lib-index.js:139,190` の **mtimeMs 単一信号**による「変更なし」誤判定（同一ミリ秒の連続編集や粗い mtime 分解能で更新破棄）＝タグ付けが tags/userKind/tagReviewed を単一 update-tags で原子的に書くか要確認。②自己リプライ・グルーピングの alias 解決が**深さ 10 で打ち切り**（`viewer.js:2458` パス圧縮なし）＝11 投稿超の連続セルフリプライ（X 長文スレッド）でグループ分裂。③saveFolder 移動後に renderer の組織ストア（`CF().load()`/getPosterTags 等）を再読込しない（`viewer.js:5945`）＝移動以外の同時編集で旧フォルダ in-memory を新フォルダへ persist する不整合エッジ。④delete-post の disk-sweep 前方一致（`main.js:881`）が `uniqueBase` の `-N` 接尾辞 base と境界文字で確実に分離できるか（境界テスト無し）。⑤デバウンス persist の最終フラッシュが `before-quit` で保証され終了直前の編集が落ちないか。
- **確認済み・棄却（再調査しない＝ガードが効いている裏取り）**: update-tags/restore-post の torn-read（`writeSidecarAtomic`＋commit 9260c81 で保護・`fs.promises.writeFile(jsonPath,…)` 直書きは現存 0 件＝発見の行番号は stale）／clear-all が delta ベースライン（`_lastSent`/postIndex map）を非リセット（computeDelta の added は現在スキャン由来＝stale は removed の no-op・captureId は時刻+乱数で再利用なし・任意の hint-less 再走査で再同期）／facetCounts への sticky 混入（グリッド本体・件数バッジも同じ getFilteredPosts 由来で一様＝矛盾する瞬間なし・~400ms 後 `stickyRecs.clear()`）／buildUsers の先勝ち採用で表示名/アバターが古い（表示のみ・userKey は安定・集計は順序非依存・再起動で自己修復・low）／config の saveFolder 死パスで空表示（ENOENT→catch で no-op・別ドライブのデータ無傷・再接続で復元・clear-all の誤消去経路なし・low）／import で未移行 folders.json 孤児化（起動時 `CF().load()` が import 前に必ず移行＝到達不能）／trash 3 操作の captureId 前方一致衝突（`Date.now()+rand16` で `-N` 接尾辞共存が極小確率・実害期待値ほぼ 0）。
- **別件（監査中に発見）**: `scripts/test-collections-migrate.js`・`scripts/test-app-folders.js` が clip リファクタ（commit 08a5bf8・workspace→アクティブコレクション移行を廃止・🔖 ボタン除去）後の挙動に未追従で **HEAD でも失敗**（migrate は `a.collections` undefined、app-folders は除去済み要素への `dispatchEvent` で EVAL_ERR）。テストを clip モデルへ更新が要る。

## リリース準備
- **配布パッケージング**（electron-builder, win/nsis）
- アプリ初回起動時に**拡張インストールのガイド**（ストア公開後）。未インストール/未接続を検知して案内。

### 0. Corpus リリース前準備（2026-06-11 時点の決定）

**ユーザー決定済み**: リリース時にリポジトリ（apricot-cake/corpus）を **public 化する**。収益化の予定なし。ライセンスは未決定だが**緩い系でよい**。コード署名は**やる方針**。それまでは private 厳守。

### 1. 自動アップデート配信（実装は未着手・リリース準備時に）

- **electron-updater + 本リポの GitHub Releases**（public化するのでリリース専用リポは不要になる）。
- 実装手順: ①`app/package.json` に electron-updater 追加 ②electron-builder の `publish: [{ provider: 'github', owner: 'apricot-cake', repo: 'corpus' }]` ③`app/main.js` に `autoUpdater.checkForUpdatesAndNotify()`（起動時＋任意で定期）④リリースは version bump → `npm run dist -- --publish always`（GH_TOKEN 必要）。
- NSIS + blockmap で差分アップデート。latest.yml の sha512 で整合検証。
- 拡張側は Chrome Web Store に出せばブラウザが自動更新（アプリとは別系統）。

### 2. ライセンス

- 緩い系 → **MIT 推奨**（収益化なし・依存も問題なし）。リリース時に LICENSE ファイル＋ app/package.json の `license` フィールド追加。

### 3. コード署名（やる方針）

- 効果: SmartScreen 初回警告の解消（評判蓄積）、アップデート改ざん耐性、AV誤検知の低減。
- **候補（OSS・無収益前提）**:
  - **SignPath Foundation（OSS無料）**: public リポ＋CI 連携が条件。リポ public 化と相性が良く第一候補。審査あり。
  - **Azure Trusted Signing**: 約$9.99/月。個人開発者の本人検証に対応（地域条件は申請時要確認）。electron-builder が統合サポート。
  - **Certum Open Source Code Signing**: 年€70前後＋カード/リーダー初回費用。OSS向けの定番安価OV。
- electron-builder の win.sign / signtool 設定が必要。NSIS ビルドの開発者モード要件（winCodeSign symlink）は docs/build.md 記載済み。
