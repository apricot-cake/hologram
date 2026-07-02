# バックログ（未着手の残タスク・唯一の作業トラッカー）

完了は git が記録＝**完了項目は残さず削除**。実装済み機能・構成・検証手順は CLAUDE.md 他節＋メモリ `corpus-verify-notes` が真実源（重複させない）。

**最優先**: 監査の確定セキュリティ／正しさ（L1〜L4 含む）は全て対応済み。次の注力候補＝タグ付けの手動UX改善／各機能設計から選ぶ。

## 監査残課題（2026-06-27 UltraCode）

3面（セキュリティ／正しさ・整合性／パフォーマンス）で多エージェント監査を実施。**総評は既に高水準**・確定分は対応済み。各面とも効き順。

### セキュリティ

ハードニング済み（制限的CSP `script-src 'self'`＋base-uri/form-action 明示／contextIsolation+sandbox+nodeIntegration:false／SSRFガード／captureId allow-list／拡張ID形式検証／JPEGマジックバイト検査／zip-slip 二重ガード）。実害の H-1（16進 IPv4-mapped SSRF）解消済み。Low 3件（extId検証・CSP base-uri/form-action・resolveInFolder sep）は 2026-07-02 対応済み（CSP は実機1点確認が残＝島描画・相対リンク解決の無事）。

- **【Low・脅威モデル次第】SSRFガードがホスト名を解決しない（DNSリバインディング）**（`native-host/media-download.js:76-88`）: コメント(41-45)明記の**意図的な受容リスク**。閉じるなら解決アドレスの public 検証＋接続ピン留め。許容なら現状維持。
- **棄却（再調査しない）**: zip-slip（二重ガード）／captureId トラバーサル（`SAFE_ID`）／プロトタイプ汚染（own のみ）／trash の未エスケープ `<img>`（CSP で script 不発）／Referer 注入（undici が CRLF 拒否）／native message 長さ（allowed_origins＋~1MB）／onMessage sender 未検証（`externally_connectable` なし）／install・restart スクリプト（固定パス・非昇格）／サイドカーのパス（常に basename＋フォルダ内検査）／open-external（`https?://` allowlist）／サプライチェーン（実行時 npm 依存ゼロ・lockfile ピン）／sandbox:true 未設定（Electron 20+ は既定 true・nodeIntegration:false のため冗長）。

### 正しさ／データ整合性

`config.json`・save-pointer・サイドカー本体（`writeSidecarAtomic`）・`.index.json` は tmp+rename でアトミック化済み（torn-read High は 9260c81 で解消）。確定分 #1〜#5・有力 L1〜L4 対応済み（2026-07-02 完了）。残＝下の「次に調べる」のみ。

- **次に調べる（未裏取り）**: ①`lib-index.js:139,190` の mtimeMs 単一信号で「変更なし」誤判定＝タグ付けが tags/userKind/tagReviewed を単一 update-tags で原子書きか要確認。②self-reply グルーピングの alias 解決が深さ10打ち切り（`viewer.js:2458`）＝11超でグループ分裂。③saveFolder 移動後に renderer 組織ストア再読込しない（`viewer.js:5945`）。④delete-post の disk-sweep 前方一致（`main.js:881`）が `-N` 接尾辞 base を境界で分離できるか（境界テスト無）。⑤デバウンス persist の最終フラッシュが `before-quit` で保証されるか。
- **棄却（再調査しない）**: update-tags/restore-post の torn-read（`writeSidecarAtomic`＋9260c81・直書き0件＝行番号 stale）／clear-all の delta 非リセット（added は現スキャン由来・stale は no-op・captureId 再利用なし）／facetCounts への sticky 混入（同 getFilteredPosts 由来で一様・~400ms clear）／buildUsers 先勝ちで表示名古い（表示のみ・userKey 安定・再起動で自己修復）／saveFolder 死パスで空表示（ENOENT→no-op・データ無傷）／import で folders.json 孤児化（起動時 `CF().load()` が import 前に移行＝到達不能）／trash の captureId 前方一致衝突（`Date.now()+rand16` で極小）。

### パフォーマンス（UI操作）

**性能判断は製品目標（数万件・投稿者数千）基準**＝開発者ライブラリの現規模（メモリ`library-composition`）で体感に出るかを条件にしない（2026-07-02 再定義・CLAUDE.md ルール）。投稿者/コレクションの窓無し描画は 2026-07-02 解消（grid 島基盤へ載せ替え＝全グリッド仮想化）。データ層のスケールは「技術スタック候補」節の SQLite 派生インデックス（採用#4）が正本。

- **main 側 I/O**: ①起動時 listPostsDelta が全 ~7600件を1回の IPC structured clone（full:true・`main.js:251`）＝初回ペイント前に同期ブロック。スリム化/チャンク化の余地。②psimg 原寸を `fs.readFile` で全バッファ（`main.js:366`）＝`stream:true` 特権があるのに非ストリーム。
- **low 群（generation キャッシュ idiom の横展開で消せる衛生案件）**: textHaystack 反復 toLowerCase(2550)／buildSuggest 未キャッシュ(5616)／getFilteredPosts 前段 filter／date 述語の境界 Date 再生成／snapshotState 二重直列化／lightbox の decode/隣接プリロード欠如(3393)／pf-badge の backdrop-filter(`index.html:871`)。
- **dev限定（未調査）**: `reloadIgnoringCache` 反復でレンダラ/GPU が蓄積し激重化（アイドル 2fps）＝再起動でクリア。蓄積系・根本未特定。
- **card(masonry) 仮想化＝最終形Bの一部として実施（決定・2026-06-30）**: 深スクロールでカード線形劣化（`viewer.js:3061`/`index.html:808`）。旧「保留」撤回＝グリッドは完全 React 所有とし**仮想化ライブラリ（masonic 第1候補／react-virtuoso は撤回＝可変高マサンリー本領外／TanStack Virtual 保険）**で仮想化。回帰リスク高＝最終形B後半で慎重に。詳細＝メモリ `corpus-react-settings-pilot`。

## タグ付け・整理（注力テーマ）

実効レバーは利用実態で異なる＝**両輪でマッピング**（2026-07-02 に個人事情ゲートを撤廃・CLAUDE.md ルール）: ①**手動タグ付けの効率化（UX）**＝ソースタグの無いライブラリ（ローカル取込中心。開発者の現ライブラリもこれ＝メモリ`library-composition`・個人の利用実態であって Corpus の仕様ではない）に効く。②**ソースタグの取込・活用**（ハッシュタグ/pixiv タグ→タグ化・種別推定・inspector の adopt 動線拡充）＝SNS キャプチャ主体の一般ユーザーに効く。どちらかを個人事情で棚上げしない。

- **関連タグ提案（共起・確認付き／未着手）**: 全タグの同時出現から「X→Y もよく一緒」を**弱いヒント**で出す汎用版。守る条件＝①押し付けない②なぜ出たか説明可（共起回数）③勝手に付けない④信頼度段階化（スコープ付き＝強・全タグ＝弱）⑤薄いうちは出さない。
- **タグの複数グループ所属（未着手）**: 現状は実質1タグ1グループ。多重観点（「構図」かつ「主題」）を許すか。影響＝重複表示・件数二重計上・未分類の定義変化。前例＝danbooru 排他／Eagle・Notion 多重可。判断軸＝柔軟さが UI/集計の複雑化に見合うか。種別（1タグ1種別の排他レイヤー）とは別軸。

## 作者まわり

- **同一投稿者の名寄せ（未実装・設計調査済み 2026-06-21）**: SNS が違うと別グループになる。手動紐づけ＋自動候補提案。`poster-aliases.json` は未存在＝完全未着手。
  - **データモデル**: `<saveFolder>/poster-aliases.json`＝`{groups:[{id,primary,members:[posterKey]}]}`（poster-folders.json と同型＋primary）。別レイヤーで非破壊束ね（保存は個別・表示は実行時合算）。5点セット（get/set IPC・preload・INTERNAL_FILES・clear-all スキップ・`mergePosterAlias`）は poster-tags.json が雛形。マージ＝union-find。
  - **波及の核**: `buildUsers()` の集約キーを alias 解決後 id にする1点改修＋`predOf` user を集合一致化で、集計/フィルタ/ジャンプ/描画がほぼ自動波及。`buildUsers` キャッシュは名寄せ変更で bust。
  - **手動UI**: 投稿者インスペクタ＋カード右クリック「同一人物にする/解除」＋ピッカー（`renderTagPicker` 流用）＋確認＋Undo。D&D不採用（誤操作が破壊的）。
  - **自動候補**: 決定的ルールの重み合算（@ハンドル完全一致＞displayName 正規化一致＞類似）。根拠明示・確認で確定・薄いうちは沈黙。アバター知覚ハッシュ／リンク相互参照は段階③。
  - **段階**: ①基盤＋手動＋全波及→②自動候補→③候補強化/確認キュー。**要判断**: UI 置き場（推奨インスペクタ）／自動の強さ／非破壊合算 vs 物理マージ／primary 決め方／粒度（person 固定推奨）。
- **投稿者モード→投稿一覧を別タブで開く（要設計）**: 現状ダブルクリックで同タブを投稿モードに切替＋`user` フィルタ。別タブ案はスイッチ切替と整合取りにくく要設計。
- **戻る/進むにライブラリ↔投稿者モード切替も含める（要設計）**: 現状の履歴は browseMode 切替を積まない。論点＝履歴に積む単位。
- **ユーザー一覧タブのフォロー数/作成日付与（未実装）**。

## 検索・ナビ・ビューUX

相互依存が強いので実装前に設計を固める（2026-06-20 起点）。

- **ビュー/レイアウト切替のモード表示＋スライド（残 ①③・2026-06-27）**: ①ビューセグメントのアクティブをアイコン表示に戻す（前回ラベルのみにした `.browse-toggle button.active *` 周辺 CSS を撤回し `.view-toggle` 既定へ）。③レイアウトセグメント（`densityToggle`/`posterDensityToggle`）のつまみスライドが効かない＝`startViewTransition(() => renderPosts())` が `.vt-thumb` を巻き込む疑い。**注**: トグルは React 所有化済み（`.vt-thumb` を useLayoutEffect で自前配置）＝旧原因は無効化された可能性大・まず視覚再確認してから判断。（②見出しへのモード名併記は f95dd6a 実装済＝削除）。※セグメント切替の目標挙動イメージ＝Claude デスクトップアプリのセグメント動作を参照（ユーザー言及・2026-07-01）
- **クエリビルダーがアドレスバーに見える＝初見が「クリックして入力」を試す（未決・要判断 2026-06-21）**: 二択＝**(a)** 「直接入力不可・フィルタは◯◯から」ヒントで既存導線へ誘導（軽い）／**(b)** ブラウザ風にテキスト入力＋候補サジェストで直接フィルタ投入（誤認を機能に・既存 `queryTree`/`addFilter` に乗せる）。b は「詳細検索」「コマンドパレット」「本文全文検索」と接近＝設計を寄せられるか。
- **コマンドパレット**（Cmd+K＝フィルタ/操作/タブ移動の検索式ランチャ）。
- **本文の全文検索の専用UX（残）**: 本文/タイトル/pixivキャプションのマッチは実装済（クイック検索＝現タブ絞り込み）。**残**＝全タブ横断の専用全文検索（結果一覧・ハイライト/該当箇所ジャンプ）を出すか要設計。コマンドパレットとは別物。
- **画像を原寸でなく画面フィット表示＋横にインスペクタ（Eagle 風・未着手）**: 現状の拡大表示（原寸ライトボックス/画像ウィンドウ）に代え、選択画像を画面にフィット表示して右にインスペクタを並べる詳細ビュー。Eagle の詳細画面がイメージ。下「インスペクタ操作の一貫性」と同じ画面まわり＝合わせて設計。
- **最大化時とスナップ時でインスペクタ操作の一貫性が無い（設計・要判断）**: 最大化中はコンテンツをクリックしても原寸表示でなくインスペクタ切替に食われ、×を押すまで解除されない。一方スナップ時はコンテンツのどこをクリックしてもインスペクタ解除。挙動を統一したい。ユーザー案＝**スナップ時挙動に寄せる**（別画像への切替は i ボタンで足りる）＋**最大化時は画面が広いのでインスペクタを右ペイン常時表示・無選択時は右ペインを空にして「i で情報表示」ヒントだけ出す**。より良い方式があれば検討。
- **あいまい検索が英語↔カタカナ読みを吸収しない**: 現状 `search.js` は NFKC＋カナ→ひらがな＋小文字化＋サブシーケンス/編集距離まで（`search.js:19-35`）だが、"search"↔"サーチ" のような英語とカタカナ読みの相互一致は無し（音写辞書が要る＝重い・技術スタック節 MiniSearch+BudouX とは別軸）。濁点同一視も無し。要否と手段を検討。
- **検索で投稿URLがヒットしない（検索対象の穴・要点検）**: クイック検索の haystack に投稿URLが含まれていない。他にも検索対象からあぶれているフィールドが無いか棚卸し（本文/タイトル/pixiv キャプションは対象済＝上「本文の全文検索」項目参照）。- **複数ウィンドウの許可**: 単一ウィンドウ制約を緩める（現状＝`main.js:1270` requestSingleInstanceLock で単一強制・2起動目は既存ウィンドウを focus のみ）。下「操作性」の画像ミドルクリック＝新規タブ案とは別軸（タブは既存・ウィンドウ複数化は未）。

## 保存・取込・メディア

- **重複保存の警告（コピー/置換/スキップ・未実装・設計調査済み 2026-06-21）**: 同じ投稿URLが既にある状態で再保存したら止めて3択。現状は captureId 単位で無条件別保存＝同じ画像が×N。判定キー＝既存 `postKeyOf(url)` の正規化キー（x⇄twitter 統合済）＝**P0 済（2026-07-02）**: `app/renderer/records.js` へ抽出済みで CommonJS export あり＝main からは `require('./renderer/records.js').postKeyOf` で共用可。照会先＝`allPosts`（url→captureId 逆引き Map 1本・コンテンツハッシュ不採用＝スクショは毎回バイト差）。**警告はアプリ取込時に寄せる**＝拡張は一旦保存（write-once 維持）、アプリが delta 受信フックで先客検出→後追い解決ダイアログ（全経路1箇所・ブリッジ無改造）。3択は `delete-post` 再利用。`import-images`(url=null) は対象外。**段階**: P0 `postKeyOf` 共有化→P1 import-posts 正規化＋3択→P2 キャプチャ後追い検出→P3 遡及掃除UI。**要判断**: 警告タイミング（後追い vs 保存前バナー）／null 同士は非重複で安全か／置換で旧タグ引継ぎ／遡及掃除をやるか。
- **画像に任意テキスト付与（自由メモ／未着手）**: タグと別の自由記述を紐付け。保存先（サイドカー欄追加）・全文検索対象に含めるか・UI（インスペクタ入力欄）は要設計。
- **本体フォルダ/バックアップ先のパス変更を検知したい**: saveFolder やバックアップ先が（アプリ外での移動・リネーム・ドライブ変化で）実在しなくなった/変わったのを起動時などに検知して知らせる。現状は死パスで静かに空表示になりうる（「正しさ」棄却メモの saveFolder 死パス参照）。
- **バックアップステータスをシンプルに（前回日時は残す）**: 表示を簡素化しつつ「前回バックアップ日時」は見えるように。
- **未対応サイトでも要素キャプチャを使えるように＋対応PFのみメタデータ取得（要調査）**: どのサイトでも要素（画像）キャプチャは可能にし、メタデータ取得は対応プラットフォームのみとする。あわせて「非対応サイトでも取れる汎用メタデータには何があるか」（OGP/ページ title/URL/取得日時 等）を洗い出す。

## コレクション

- **新規作成ボタンを左上に**: 現状は一覧末尾の「＋ 新規」タイル（`Collections.tsx` の NewCard＝これが「＋＋みたいなボタン」の正体・クリックで名前 prompt）。新規作成は一覧の左上に置きたい。
- **コレクションにもクエリビルダー（スマートコレクション）**: 手動メンバー管理だけでなく、クエリ条件で中身が動的に決まるコレクションを作れるように（既存 `query-chips` の条件木を流用）。
- **コレクションにもタグ付け**: コレクション自体にタグを付けて分類できるように。
## 操作性・通知・拡張UI

- **画像のミドルクリックを「新規タブで開く」に統一（ブラウザライク）**: 現状はカード画像のミドルクリックで単一画像ウィンドウを開く（`viewer.js:2997-3011`→`openImageWindow`）。タブ機能は既存（`viewer.js:2495-2514`・タブ strip のミドルクリックは close）＝ミドルクリック＝新規タブで開く、に揃えてブラウザ挙動に統一。
- **右クリックからローカルファイル閲覧**: カード等のコンテキストメニューに「エクスプローラで表示/ファイルの場所を開く」を追加（実ファイルへの導線）。
- **操作の通知をもっと出す**: `window.corpusUI.notify`（`ui.js:12-19`）は在るが、タグの個別編集・検索/ソート変更・フィルタリセット等では出ていない（調査）。無音の操作にもトーストを足して手応えを増やす（出しすぎ注意＝頻発操作は間引き）。
- **拡張機能のエフェクト等をモダンに**: 拡張（`extension/`）のUI/アニメーション・エフェクトを現行アプリのガラス調に寄せて刷新。
- **「Corpus」の頭文字を大文字で固定（低優先・点検のみ）**: UI 文言は既に `Corpus` で大文字統一済み（i18n/About）。かつて「amazon 風に大文字小文字併用にしよう」というやり取りがあり、その名残の小文字表記が UI 表示文字列のどこかに残っていないか念のため点検（`window.corpus*` 等のコード識別子は正当なので対象外）。残骸が無ければ本項目は消してよい。

## 実機検証・開発インフラ

- **純ユニットアグリゲータの自動起動の配線（残り半分）**: `npm test`（`scripts/run-tests.js`・9スイート・CORPUS_CONFIG_DIR サンドボックス付き）は 2026-07-02 設置済み。残り＝**自動で叩く経路の選択**（既存 Windows サインイン時タスクに追加 vs pre-commit フック＝コミットが数秒重くなる）。GitHub Actions は public 化フェーズまで保留可。背景＝Biome 導入時に parity 2件が無音で赤だったのを実証（自動起動が無いと再発する）。
- **⚠️ Electron を EOL(33系)→サポート内(41/42) へ更新（2026-07-01 検出）**: 現固定 `app/package.json` `^33.2.0`。33系は **2025-04-29 EOL**＝内蔵 Chromium が約20か月分パッチ未適用（サポートは 41/42）。直近の Electron 層 CVE（[CVE-2026-34781](https://www.miggo.io/vulnerability-database/cve/CVE-2026-34781) clipboard DoS／[CVE-2026-34774](https://www.sentinelone.com/vulnerability-database/cve-2026-34774/) offscreen UAF）は未使用機能で直接影響なしだが、**実リスクの本体は Chromium 側未修正 CVE**＝任意画像バイトを renderer(psimg)/main(nativeImage) で復号するため画像デコーダ系 RCE が悪意画像経由で悪用され得る（即時性は低い）。**Chromium 本体が上がる重い更新**＝更新後は実機検証必須（キャプチャ/表示/サムネ生成/ウィンドウ挙動を目視）。急がないが放置しない。[Electron EOL 一覧](https://endoflife.date/electron)。
- **拡張の実機E2E拡充**: 特に X＝要ログインで未自動化（puppeteer は bot検出で弾かれる）。`e2e-capture-test.js`（全PF PASS・X除外）の延長で X を認証済みプロファイル/Claude in Chrome で。手動X残テスト（A-1系）もここ。
- **実機キャプチャの実ブラウザ経由 最終目視（残）**: Chrome 無しの end-to-end は検証済（メモリ `corpus-library-loss-incident`）。残＝実機 Chrome で1件キャプチャし `.jpg`+`.json` が落ちるのを目視（リモート不可）。
- **開発共通ルールを親フォルダ CLAUDE.md に集約**→重複削除。
- **React 化（最終形B）＝進行中**（下記専用セクション）。確立パターン/実装知はメモリ `corpus-react-settings-pilot`/`corpus-vite-migration` が真実源。

## React 化（最終形B＝単一Reactアプリ化・進行中）

**方針・実装知の真実源はメモリ**（`corpus-react-settings-pilot`/`corpus-vite-migration`）＝目的（合否基準）・確立パターン（反転パターン/プレゼンテーショナル島/idempotent guard/初期化順の罠）・各スライスの実装知。ここには**残タスクだけ**を置く。

- **依存/UI 方針（確定）**: 全面リライトしない・段階移行／依存は痛みが出た時に keep/replace で判断（bespoke＝フィルタ/グルーピング/正規化/日本語あいまい検索は保つ・コモディティ＝位置決め/窓化/a11y は痛んだら委譲）／UI はガラス維持（styled kit 却下・※Tailwind+shadcn 移行候補との整合は「技術スタック候補＞方針転換候補」参照）／状態は corpusStore 継続／ルーター無し。
- **着地済み**: Vite 移行（esbuild 廃止・段階0-2）／島16個（settings/sidebar-tags/query-chips/tabs/collections/searchbox=react-aria ComboBox/posters/grid=仮想化3ビュー/toolbar/context-menu/kind-menu/filter-popover/qf-pop/lightbox/inspector/edit-overlay。post-card テンプレート島は grid への完全反転で卒業＝PostCard.jsx は _shared の共有部品へ）＋共有ストア window.corpusStore。**グリッド完全React化＋仮想化も完了（2026-07-02・下記）**。フィルタ系（値フライアウト qfPop＋日付/エンゲージ/ポスター日付範囲ポップオーバー）は完了。**詳細/インスペクタパネル（post/poster）と一括タグ追加モーダルも完了＝インライン タグ編集/タグピッカーを共通 `_shared/TagEditor.jsx` へ一本化**（React化=目的1の実例）。Reactランタイムは全島から外部化し共有 vendor-react.js に一本化済み（c3269d4）。**検索ボックス＋サジェストも完了（スライスm・f0b206c）＝react-aria-components 導入・searchbox 島が input DOM を所有・値源は corpusStore searchQuery・旧 suggest 島は吸収削除**（実装知はメモリ `corpus-react-settings-pilot`）。#filterRows のバッジ（`renderFilterBadges`）は純粋な派生テキスト＋クラス切替でドリフトリスクが無く、React化の対象外と判断（現状維持）。
- **残タスク**:
  - ~~グリッド完全React化～~ **完了（2026-07-02・スライス1-3）**: 全3ビュー（list/tile/card）を grid 島＝masonic 仮想化へ反転（9042件→DOM 十数〜数十セル）。旧機構（renderLimit/RENDER_PAGE・sentinel IntersectionObserver・キー付き reconcile/cardSig・手書きマサンリー .mcols/.mcol・fast path・learnCardAspects・タブ永続の `_renderLimit`）を一括削除、post-card テンプレート島も卒業（renderToStaticMarkup/ReactDOMServer を vendor から撤去）。スクロール復元は scrollTop 直復元（リロード跨ぎ実機PASS）。実装知はメモリ `corpus-react-settings-pilot`。
  - viewer.js（~5850行 IIFE）を store/service/hooks へ段階抽出（純ロジック→service・横断状態→store・密着ロジック→hooks＝抽出であって全面リライトでない）。**第1弾完了（2026-07-02）＝クエリエンジン→`app/renderer/query.js`**（window.corpusQuery＝ツリー機構 emptyTree/treeLeaves/opposite/facetTreeFrom/evalNode＋純ヘルパ localDayRange/hostOf/userKey/textHaystackOf＋`makePostPredOf(deps)`＝コレクション/クリップ/fuzzy は viewer が注入）。純ユニット `scripts/test-query-unit.js`（56 assert）を npm test に追加＝getFilteredPosts の核が初めてテスト下に。**第2弾完了（2026-07-02）＝レコード正規化・グルーピング→`app/renderer/records.js`**（window.corpusRecords＝形状ヘルパ/postIdKey/postKeyOf/stampPost/makeGroupRecords(deps)/percentileFn・CommonJS でも export＝重複保存警告の P0「postKeyOf 共有モジュール化」を兼ねる・純ユニット test-records-unit 46 assert）。**第3弾完了（2026-07-02）＝facetCounts/qfValues→`app/renderer/facets.js`**（window.corpusFacets・makeFacets(deps)・test-facets-unit 30 assert）＝**当初の抽出候補3件は完遂**。次のスライスは実装時に痛点から選ぶ（候補メモ: buildUsers/buildSuggest 等の集計系・タブ永続化）。
  - ~~posterGrid/collectionGrid の仮想化~~ **完了（2026-07-02）**: 両グリッドを grid 島基盤へ載せ替え（`_shared/VirtualGrid.tsx` 抽出＋ブリッジ工場化＝corpusPosterGrid/corpusCollectionGrid）。実装知はメモリ `corpus-react-settings-pilot`。※masonic が島3つに各自バンドルされる重複は「単一バンドル化」（下）で自然回収。
  - 単一 root／単一バンドル化（島 IIFE×N を畳む・file:// ESM 制約は最終形B で別途）。※c3269d4 で React ランタイムを全島から外部化し共有 vendor-react.js に一本化＝バンドル畳みの地ならしに着手済み。
  - ポスターのフォルダ割当 toggle を実フォルダ作成で実データ再検証。

## コード地ならし（純リファクタ・2026-07-01 多エージェント調査でトリアージ）

> **位置づけ**: 振る舞い不変の内部改善のみ。**移行期に安全なのは衝突ゾーン外の小物だけ**＝大物（viewer.js 巨大関数分割・オーバーレイ集約）は上の React 化残タスクがリライトで自然消滅させる領域＝別立てにしない。注力テーマ（タグ付け・整理）には効かない純地ならし＝優先度は高くない。検証で複数候補に誇張が判明＝核だけに縮小済み。

- **今やれる（衝突ゾーン外・単独可・挙動不変）**:
  - **日本語コードコメントの全体英語化スイープ（残り・2026-07-02 実測で判明）**: extension/ は英語化完了（2026-07-02）だが、2026-07-01 UltraCode の「content.js が唯一の実質違反」は誤り＝実測で `viewer.js` 142行・`search.js` 21行・`scripts/` 各所ほか計~350行のコメント行に日本語が残存（`git grep -P '^\s*//.*[ぁ-ヶ一-龠]'` で棚卸し可）。viewer.js は React化の段階抽出で移設される領域＝抽出時に英語化するか、一括スイープするかは任意。UI文字列リテラルは対象外。
  - **コールバック搬送ブリッジの重複解消は「単一root/単一バンドル化」に合流**（`app/renderer/qf-pop.js`/`filter-popover.js`・2026-07-01 UltraCode検出）: 2本が完全一致の subscribe/notify 定型を重複実装（kind-menu/menu.jsは挙動差ありのため対象外）。島がまだ流動中のため単独前倒しはせず、上「React化」節の島 IIFE 畳み工程で `makeCallbackBridge({name,useOpenId})` に統合する。
- **見送り（誇張/振る舞い変更が判明・再提案しない）**: generationキャッシュ横展開（束ねた buildUsers は修正済＝real 薄・残りは150msデバウンス背後の O(N) 衛生案件）／getSaveFolder メモ化（毎回ライブ config 読みは消失事故対策の pointer 復旧防御そのもの＝ハード化点を壊す・実益µs級）／IPC集中ラッパーの「全46握り潰し」根治（誤り＝set*/persist系のみ・下「技術スタック候補」節の Zod/IPC集中ラッパー項参照）／テストのアサーション様式3系統混在・DIAG_PREFIX重複定義・`'use strict'`不揃い・空catchバインディング名不統一（いずれも実害なし・Biome導入（下「技術スタック候補」節）の初回スイープで機械的に一掃されるため個別着手は二重手間＝再提案しない）。

## 技術スタック候補（2026-07-01 調査・2026-07-02 に採用価値のあるものだけへ絞り込み）

> 87候補を Corpus 固有制約（file:///厳格CSP/ファイルベース真実源/ガラス維持＝恒久的な設計制約）で採点した多エージェント調査の**生き残りだけ**を残す。フル判断ログ（優先度表16行・ティア表・却下理由表・カテゴリ別勝者/次点）は git 履歴参照（7714592 で導入・c26f3f6 時点が最終版）。**重い機能強化は最終形B後**（本丸は「タグ付け・整理」節＝手動タグUXとソースタグ活用の両輪）。

### 導入済み
- **react-aria-components**（スライスm・検索ボックス／実装知と罠はメモリ `corpus-react-settings-pilot`）: 以後の難所ポップオーバー/コマンドパレットは**追加依存ゼロ**で使い回す。先回り置換はしない＝既存の動く手書き（ContextMenu/GlassSelect 等）は温存。
- **Biome 1.9.4**（2026-07-02・lint+format）: `npm run lint`／設定と 1.9.4 完全固定の理由（本機のアプリ制御ポリシーが 2.x 未署名バイナリをブロック）は biome.jsonc 冒頭。導入スイープで parity テスト2件の無音の赤を発見（下「実機検証」節）。
- **i18nキー網羅スクリプト**（2026-07-02・`scripts/test-i18n-parity.js`）: renderer MESSAGES＋拡張 _locales の キー/値形状/置換スロットのパリティ番人（現状 338/338・4/4 で整合）。

### 採用する（着手順）
1. **TypeScript**（旧「JSDoc + checkJs（.ts化なし）」から方針変更・2026-07-02 ユーザー決定）: 型検査は `tsc --noEmit`（typescript 6.0 は純JS実行＝本機アプリ制御ポリシー無風・Biome 1.9.4 は TS/TSX の lint+format 対応済み）。**段階①完了（2026-07-02）**: islands＋`_shared` 全59ファイルを .tsx/.ts 化（strict・`app/tsconfig.json`）、window ブリッジ契約を `app/islands/types/globals.d.ts` に集約（corpusStore/corpusGrid/corpusQfPop 等＋preload 全面）、`test-typecheck` を npm test へ配線。検証＝ビルド出力ハッシュ比較で 18 バンドル中14がバイト同一・4差分も等価微修正2種のみと特定（実装知はメモリ `corpus-typescript-stage1`）。**残り**: ②素JS層（viewer.js・store.js・query.js 等＝file:// 直ロードでビルド無し）は当面 .d.ts＋checkJs で契約だけ可視化し、「単一バンドル化」（React化節）で Vite 配下に入った時点で .ts 化 ③main プロセス（無ビルド実行が前提）は Electron 41+（Node 24 の type stripping）到達後に .ts 直実行可否を実測して判断（不可なら .d.ts 留め）。
2. **masonic**: ~~グリッド仮想化スライスの一部として~~ **導入済み（2026-07-02・全3ビュー反転完了）**。保険=TanStack Virtual（react-virtuoso は撤回済＝可変高マサンリー本領外）。
3. **配布3点セット**: electron-builder publish/sign → electron-updater → SignPath 事前申請（審査が律速）＋@electron/fuses を署名のついで。時期・手順は下「リリース準備」節が真実源＝ここに重複させない。
4. **SQLite 派生インデックス（DB 移行＝確定・2026-07-02）**（※真実源ごと DB 化する上位案は下「方針転換候補」参照＝本項はその第1段階を兼ねる）: 数万件ライブラリは**製品のスケール目標**（画像メイン利用等でユーザーによっては到達する＝開発者ライブラリの成長を条件にしない・CLAUDE.md ルール）。真実源はサイドカー JSON のまま、`.index.json`＋常駐 Map を**再構築可能な SQLite インデックス**へ置換（起動全量スキャン・IPC 全量 clone・メモリ常駐・検索線形走査に一括で効く／壊れたら再構築＝「ファイルベース真実源」の恒久設計制約と両立）。着手＝最終形B の service 抽出後＋Electron EOL 更新（41+）後。**選定は2層に分解**（2026-07-02 調査）: ①**索引層**（メタデータ・ソート・ファセット）＝Electron 41 同梱 Node 24 の内蔵 `node:sqlite` が第1候補（依存ゼロ・ネイティブ .node 無し＝本機アプリ制御ポリシー無風・ステータスは RC）。②**全文検索層**＝`node:sqlite` は **FTS5 非同梱**（Node 24 時点・upstream 未解決）のため、必要と実測された時点で better-sqlite3（FTS5 同梱・ただし .node の本機ポリシー実行可否の実測が採用関門・Electron ABI リビルド＋asarUnpack）vs WASM sqlite（FTS5 ビルド可・ネイティブ無し）を比較。①だけでも主要ボトルネックは解消＝テキスト検索は正規化 haystack の事前計算＋JS で粘れる見込み（**旧 MiniSearch+BudouX 案はここに統合**・日本語は corpusSearch の正規化資産を FTS5 trigram/BudouX いずれでも前処理として再利用）。

### 方針転換候補（2026-07-02 ユーザー追加・着手前に既存決定との整合を解く）

- **Tailwind CSS 導入（独立軸・2026-07-02 に shadcn と分離）**: 手書き CSS（index.html 内・ガラス調）を Tailwind ユーティリティへ段階置換。shadcn/Radix 非依存で成立し、**react-aria と好相性**（RAC は無スタイル＋className 素通し＋data 属性状態＝公式に Tailwind 向けプラグインあり）。生成物は静的 CSS＝厳格 CSP・file:// 無衝突、ガラストークン（CSS 変数）は v4 テーマがそのまま消費可。既存 CSS と共存の段階移行可。時期＝本格は単一バンドル化と同時が綺麗（islands 限定の先行は可）。コスト＝移行期の2流儀併存＋DESIGN.md 改稿。
- **shadcn/ui**: ガラス維持（2026-06-30 確定）の前提では本体価値（完成スタイル）を捨てて Radix 挙動だけ使う形＝コピーイン部品の全面再スキン保守を抱える一番不利な構図。**推奨＝見送り、難所の挙動は採用済み react-aria-components の拡大で賄う**（追加依存ゼロ・CSP 実証済み・既定路線と整合／Radix 併用は portal/dismiss/focus の2流儀併存）。見た目の転換を決めた時だけ再訪（ユーザー最終確認が取れたら「見送り」節へ移す）。
- **サイドカー JSON をやめ SQLite へ本格移行（真実源の DB 化）**: 「採用#4 SQLite 派生インデックス」（真実源は JSON のまま）を超えて、投稿メタデータの**真実源自体**を SQLite へ。**画像/メディアはファイルのまま＝DB はメタデータのみ（2026-07-02 ユーザー確定）**。**要整合**: ①「ファイルベース真実源」は恒久設計制約として複数決定の前提（採用#4・export/import・バックアップミラー・write-once サイドカー）＝制約自体の撤回になる ②native host（Chrome spawn の別プロセス）が保存先へ直接書く経路＝多プロセス同時書きの再設計（WAL 前提でも要検討・ホストは JSON を書き app が取込む2段構えも選択肢）③2026-06-23 消失事故対策（冗長ポインタ・degraded ガード・「壊れたら再構築」）の防御を DB 前提で再構築（バックアップ形式・破損復旧）。**段階**: まず採用#4（派生インデックス）で SQLite 層を実戦投入→運用知見の上で真実源の移行を最終判断、が安全経路。

### 痛みが出たら（発火条件つき・先回り導入しない。※発火条件は製品基準＝開発者ライブラリでの遭遇を条件にしない）
- **sharp** ← サムネ経路（main.js getThumbnail）の webp/avif 対応可否を**実測してから**判断（webp は SNS 配信で一般的＝一般ユーザーは普通に遭遇する）。サムネ同期ブロッキングも同時に評価（asarUnpack＝「実行時 npm 依存ゼロ」を破る越境コスト込み）。
- **Vitest** ← viewer.js の service 抽出後（最大痛点 getFilteredPosts 等はそれまで IIFE 内で対象外）。
- **lucide-react** ← 最終形B完了時に本体アイコンを一括移行（DESIGN.md 指定と自前35SVGの実測一致は確認済み・島だけの先行導入はしない）。
- **Zod か Valibot（main限定）＋IPC集中ラッパー（自前）** ← IPC 契約破れ・catch{}黙殺が実害を出したら、新Reactストア層の一部として同時に設計（対象は set*/persist系のみ・失敗のログ化/既定値化は振る舞い変更＝純リファクタでない・2026-07-01訂正）。
- ~~better-sqlite3 + FTS5~~ → **「採用する」#4（SQLite 派生インデックス）へ昇格**（2026-07-02＝「ライブラリが数万件に育ったら」という開発者ライブラリ基準のゲートを撤廃・数万件は製品目標）。
- **chokidar v4** ← 自前 fs.watch が実害を出したら（全reconcile が自己修復・2026-06 インシデントの真因は MSIX＝watcher でない）。

### 見送り（再提案しない）
- **現状維持が最適解と確認済み**: 自前corpusStore（Zustand/TanStack Query は最終形B後に実痛が出たときだけ再訪）／自前Date/Intl（Intlキャッシュ+_dateMs 計測済み最適）／自前スモーク+puppeteer（実機=真実の文化）／自前HTML5 DnD／search.js継続／知覚ハッシュ／自前SVGアイコン。
- **固有制約と正面衝突**: kuromoji・lindera-wasm（WASM=`wasm-unsafe-eval` が厳格CSPと非互換＝強化の道は BudouX 系）／Iconify（CDN動的取得が file://・`script-src 'self'` と根本非互換）／Azure Trusted Signing（日本拠点は申請不可・署名は SignPath→Certum の順）。
- **react-aria 導入（スライスm）で理由消滅**: Floating UI（位置決め/衝突回避は RAC Popover が肩代わり・非React残余は最終形Bで消える）／Radix Primitives／cmdk・kbar（パレットは react-aria 自前＋search.js＝二重fuzzy回避）。
- **解く問題が無い/代償過大**: @parcel/watcher（getEventsSince が解く問題は全reconcileで自己修復済＝架空）・graceful-fs／dnd-kit・pragmatic-dnd・SortableJS（現行~80行安定・木構造判定は導入後も手書き＝複雑さが移動するだけ）／Jotai・nanostores・Valtio・XState（独立フラグ集合に強みが刺さらない）／Motion・react-spring・auto-animate（View Transitions+CSS で核心実現済み）／electron-trpc・Comlink（Comlink は Electron 非互換明記／却下理由の一部「TS前提」は TS 採用（上#1）で消滅＝electron-trpc を再訪するなら「痛みが出たら」の IPC 集中ラッパー項の判断に合流）／FlexSearch・Orama／dayjs・Luxon・Temporal／ArkType・superstruct／node:sqlite・sql.js・DuckDB／imghash／Paraglide・FormatJS・LinguiJS／Playwright視覚回帰・node:test／oxlint／Knip／electron-forge。

## リリース準備

- **配布パッケージング**（electron-builder, win/nsis）。
- 初回起動時に**拡張インストールのガイド**（ストア公開後・未インストール/未接続を検知して案内）。
- **デモGIF/スクショの充実**（README・LP 用に主要機能の短尺GIFを整備）。
- **GitHub Pages で LP を作る**（public 化フェーズに合わせて）。
- **About（バージョン情報）に外部リンク**: 現状 About は版数のみでリンク無し（`About.tsx`）＝GitHub リポ/リリースノート/ライセンス等へのリンクを追加。
- **タグラインの文言調整**: `aboutTagline`（`i18n.js:304`）「投稿を丸ごと。あなたの SNS ライブラリに。」の末尾「に。」を落として「…あなたの SNS ライブラリ。」にしたい。

### 0. 公開・署名の方針（2026-06-11 決定済）

リリース時にリポ（apricot-cake/corpus）を **public 化**（それまで private 厳守）。収益化なし。ライセンス未決だが**緩い系でよい**。コード署名は**やる方針**。

### 1. 自動アップデート配信（未着手・リリース準備時に）

- **electron-updater + 本リポの GitHub Releases**。
- 手順: ①`app/package.json` に electron-updater ②builder の `publish:[{provider:'github',owner:'apricot-cake',repo:'corpus'}]` ③`main.js` に `autoUpdater.checkForUpdatesAndNotify()` ④version bump→`npm run dist -- --publish always`（GH_TOKEN 要）。
- NSIS + blockmap で差分更新・latest.yml の sha512 で整合検証。拡張側は Chrome Web Store の自動更新（別系統）。

### 2. ライセンス

- 緩い系→**MIT 推奨**。リリース時に LICENSE ＋ `package.json` の `license` 追加。

### 3. コード署名（やる方針）

- 効果: SmartScreen 初回警告の解消・改ざん耐性・AV誤検知低減。
- **候補（OSS無収益）**: **SignPath Foundation**（OSS無料・public＋CI 連携が条件＝第一候補・審査あり・日本可）／~~Azure Trusted Signing~~（**日本拠点は申請不可**・除外）／**Certum Open Source**（年€70前後＋初回費・SignPath 審査待ちの有償フォールバック）。
- builder の win.sign / signtool 設定が必要。NSIS 開発者モード要件（winCodeSign symlink）は docs/build.md 記載済み。