# バックログ（未着手の残タスク・唯一の作業トラッカー）

完了は git が記録＝**完了項目は残さず削除**。実装済み機能・構成・検証手順は CLAUDE.md 他節＋メモリ `corpus-verify-notes` が真実源（重複させない）。

**最優先**: 監査の確定セキュリティ／正しさは全て対応済み。次の注力候補＝要追加調査（L1〜L4）／タグ付けの手動UX改善／各機能設計から選ぶ。

## 監査残課題（2026-06-27 UltraCode）

3面（セキュリティ／正しさ・整合性／パフォーマンス）で多エージェント監査を実施。**総評は既に高水準**・確定分は対応済み。各面とも効き順。

### セキュリティ

ハードニング済み（制限的CSP `script-src 'self'`／contextIsolation+sandbox+nodeIntegration:false／SSRFガード／captureId allow-list／JPEGマジックバイト検査／zip-slip 二重ガード）。実害の H-1（16進 IPv4-mapped SSRF）解消済み。残りは Low のみ。

- **【Low・脅威モデル次第】SSRFガードがホスト名を解決しない（DNSリバインディング）**（`native-host/media-download.js:76-88`）: コメント(41-45)明記の**意図的な受容リスク**。閉じるなら解決アドレスの public 検証＋接続ピン留め。許容なら現状維持。
- **【Low】set-extension-id が拡張ID形式を検証せず allowed_origins に流し込む**（`app/main.js:434` / `native-host/install.js`）: 入力源はアプリ自身の設定UIで外部経路は無いが、信頼境界を跨ぐ IPC 引数の形式検証が無い。対策＝`VALID_EXT_ID = /^[a-p]{32}$/` ガードを install.js と main.js trim 直後に追加、不正なら `allowed_origins:[]`（既存の空/不正時挙動と同じ）。
- **【Low】CSP に base-uri / form-action の明示が無い**（`app/renderer/index.html:5`／`app/vite.config.mjs:30-33` DEV_CSP）: `default-src` にフォールバックしないため未指定。`base-uri 'none'; form-action 'none';` を両方に追記（object-src は default-src フォールバックあり追加不要）。実機で島描画・相対リンク解決の無事を1点確認。
- **【Low】resolveInFolder のフォルダ封じ込め判定に `path.sep` が無い**（`app/main.js:794`）: 同ファイル内の psimg(404行)・1267行は `startsWith(path.resolve(folder) + path.sep)` で正しく実装済みだがここだけ sep 無し startsWith＝理論上兄弟ディレクトリを誤って受理しうる（実exploitは basename で不成立）。1行修正で既存パターンに揃える。
- **棄却（再調査しない）**: zip-slip（二重ガード）／captureId トラバーサル（`SAFE_ID`）／プロトタイプ汚染（own のみ）／trash の未エスケープ `<img>`（CSP で script 不発）／Referer 注入（undici が CRLF 拒否）／native message 長さ（allowed_origins＋~1MB）／onMessage sender 未検証（`externally_connectable` なし）／install・restart スクリプト（固定パス・非昇格）／サイドカーのパス（常に basename＋フォルダ内検査）／open-external（`https?://` allowlist）／サプライチェーン（実行時 npm 依存ゼロ・lockfile ピン）／sandbox:true 未設定（Electron 20+ は既定 true・nodeIntegration:false のため冗長）。

### 正しさ／データ整合性

`config.json`・save-pointer・サイドカー本体（`writeSidecarAtomic`）・`.index.json` は tmp+rename でアトミック化済み（torn-read High は 9260c81 で解消）。確定分 #1〜#5 対応済み。残＝要追加調査。

- **有力・要追加調査**:
  - **L1【Med-High】** saveFolder 移動中のキャプチャが旧フォルダに取り残される（`main.js:1389` copyLibraryInto の snapshot→flip→cleanup 並行窓・bridge 非ロック）。対策＝移動中フラグで bridge 保留 or flip 前に src 再 readdir で差分追いコピー、cleanup は「dest 存在確認できたものだけ src 削除」。
  - **L2【Med】** import-posts の重複検出が `url` のみ＝URL なし（99.6% の Eagle 移行）が再インポートで二重化（`main.js:996`・`.trash` 非走査・BOM 非耐性）。対策＝captureId/画像ハッシュ/eagleName にフォールバック。
  - **L3【Med】** サイドカー/組織 JSON 読みが BOM 非耐性（`lib-index.js:146`・各 get-*・`lib-archive.js`）＝投稿が静かに欠落・最悪 record:null→reconcile が collections/clip 恒久 purge。対策＝各裸 parse に BOM剥ぎ一行差し（`parseJsonLoose`）。※共通ヘルパへの reader 二系統統合は degraded 追跡セマンティクスが別物で誇張＝見送り（2026-07-01調査・下「コード地ならし」節）。
  - **L4【Low】** import の `mergeManualGroups`（`lib-archive.js:122`）が集合 dedup のみでメンバー交差を解消せず「1 captureId 1 グループ」不変条件を破る（可逆）。対策＝union-find。
- **次に調べる（未裏取り）**: ①`lib-index.js:139,190` の mtimeMs 単一信号で「変更なし」誤判定＝タグ付けが tags/userKind/tagReviewed を単一 update-tags で原子書きか要確認。②self-reply グルーピングの alias 解決が深さ10打ち切り（`viewer.js:2458`）＝11超でグループ分裂。③saveFolder 移動後に renderer 組織ストア再読込しない（`viewer.js:5945`）。④delete-post の disk-sweep 前方一致（`main.js:881`）が `-N` 接尾辞 base を境界で分離できるか（境界テスト無）。⑤デバウンス persist の最終フラッシュが `before-quit` で保証されるか。
- **棄却（再調査しない）**: update-tags/restore-post の torn-read（`writeSidecarAtomic`＋9260c81・直書き0件＝行番号 stale）／clear-all の delta 非リセット（added は現スキャン由来・stale は no-op・captureId 再利用なし）／facetCounts への sticky 混入（同 getFilteredPosts 由来で一様・~400ms clear）／buildUsers 先勝ちで表示名古い（表示のみ・userKey 安定・再起動で自己修復）／saveFolder 死パスで空表示（ENOENT→no-op・データ無傷）／import で folders.json 孤児化（起動時 `CF().load()` が import 前に移行＝到達不能）／trash の captureId 前方一致衝突（`Date.now()+rand16` で極小）。

### パフォーマンス（UI操作）

**個人ライブラリの現状**（メモリ`library-composition`＝無タグ中心・投稿者数十件。Corpus自体の制約でなく開発者個人の現在の利用規模）＝投稿者/コレクション系の窓無し描画やメモ化欠如は現スケールで体感に出ない（将来 SNS 主体化で効く構造負債）。

- **main 側 I/O**: ①起動時 listPostsDelta が全 ~7600件を1回の IPC structured clone（full:true・`main.js:251`）＝初回ペイント前に同期ブロック。スリム化/チャンク化の余地。②psimg 原寸を `fs.readFile` で全バッファ（`main.js:366`）＝`stream:true` 特権があるのに非ストリーム。
- **low 群（generation キャッシュ idiom の横展開で消せる衛生案件）**: textHaystack 反復 toLowerCase(2550)／buildSuggest 未キャッシュ(5616)／getFilteredPosts 前段 filter／date 述語の境界 Date 再生成／snapshotState 二重直列化／lightbox の decode/隣接プリロード欠如(3393)／pf-badge の backdrop-filter(`index.html:871`)。
- **dev限定（未調査）**: `reloadIgnoringCache` 反復でレンダラ/GPU が蓄積し激重化（アイドル 2fps）＝再起動でクリア。蓄積系・根本未特定。
- **card(masonry) 仮想化＝最終形Bの一部として実施（決定・2026-06-30）**: 深スクロールでカード線形劣化（`viewer.js:3061`/`index.html:808`）。旧「保留」撤回＝グリッドは完全 React 所有とし**仮想化ライブラリ（masonic 第1候補／react-virtuoso は撤回＝可変高マサンリー本領外／TanStack Virtual 保険）**で仮想化。回帰リスク高＝最終形B後半で慎重に。詳細＝メモリ `corpus-react-settings-pilot`。

## タグ付け・整理（注力テーマ）

開発者個人のライブラリはbooru型イラストアーカイブとして運用中（現状はメモリ`library-composition`参照＝Corpus自体の仕様でなく個人の利用実態）。**ソースタグ取込はこのライブラリでは無力**（URL/ソースタグ無し）＝実効レバーは**手動タグ付けの効率化（UX）**。

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

- **重複保存の警告（コピー/置換/スキップ・未実装・設計調査済み 2026-06-21）**: 同じ投稿URLが既にある状態で再保存したら止めて3択。現状は captureId 単位で無条件別保存＝同じ画像が×N。判定キー＝既存 `postKeyOf(url)` の正規化キー（x⇄twitter 統合済）を共有モジュール化して renderer/main 共用。照会先＝`allPosts`（url→captureId 逆引き Map 1本・コンテンツハッシュ不採用＝スクショは毎回バイト差）。**警告はアプリ取込時に寄せる**＝拡張は一旦保存（write-once 維持）、アプリが delta 受信フックで先客検出→後追い解決ダイアログ（全経路1箇所・ブリッジ無改造）。3択は `delete-post` 再利用。`import-images`(url=null) は対象外。**段階**: P0 `postKeyOf` 共有化→P1 import-posts 正規化＋3択→P2 キャプチャ後追い検出→P3 遡及掃除UI。**要判断**: 警告タイミング（後追い vs 保存前バナー）／null 同士は非重複で安全か／置換で旧タグ引継ぎ／遡及掃除をやるか。
- **画像に任意テキスト付与（自由メモ／未着手）**: タグと別の自由記述を紐付け。保存先（サイドカー欄追加）・全文検索対象に含めるか・UI（インスペクタ入力欄）は要設計。
- **saveFolder 移行の整合チェックが無い（要追加）**: 現状コピーは collision 回避（`errorOnExist`）だけで、移行後に件数/サイズ照合をせず旧を消す（`main.js:1010-1029`＝cp.ok の bool のみ）。移行元削除の前に「dest の件数/合計サイズが src と一致」を検証してから cleanup したい（上「正しさ」L1 の取り残し窓とも関連）。
- **移行元の空フォルダ（殻）が残る**: cleanup は `cp.entries` を1件ずつ rm するだけで、空になった src ディレクトリ自体は rmdir しない（`main.js:1026-1029`）＝旧 saveFolder が空フォルダとして残る。中身が空になったら src 自体も削除（誤指定した親フォルダを巻き込まない安全弁付きで）。
- **移行ログの「コピー中… N%」行は要らない**: 進捗ログ（`Data.jsx:74-102`・i18n `logCopying`）の「コピー中… 20%/40%/60%」の羅列が冗長。進捗バーがあるのでログはフェーズ節目（開始/切替/削除/完了）だけで十分＝逐次%行を落とす。
- **本体フォルダ/バックアップ先のパス変更を検知したい**: saveFolder やバックアップ先が（アプリ外での移動・リネーム・ドライブ変化で）実在しなくなった/変わったのを起動時などに検知して知らせる。現状は死パスで静かに空表示になりうる（「正しさ」棄却メモの saveFolder 死パス参照）。
- **バックアップステータスをシンプルに（前回日時は残す）**: 表示を簡素化しつつ「前回バックアップ日時」は見えるように。
- **未対応サイトでも要素キャプチャを使えるように＋対応PFのみメタデータ取得（要調査）**: どのサイトでも要素（画像）キャプチャは可能にし、メタデータ取得は対応プラットフォームのみとする。あわせて「非対応サイトでも取れる汎用メタデータには何があるか」（OGP/ページ title/URL/取得日時 等）を洗い出す。

## コレクション

- **新規作成ボタンを左上に**: 現状は一覧末尾の「＋ 新規」タイル（`Collections.jsx:52-59`＝これが「＋＋みたいなボタン」の正体・クリックで名前 prompt）。新規作成は一覧の左上に置きたい。
- **コレクションにもクエリビルダー（スマートコレクション）**: 手動メンバー管理だけでなく、クエリ条件で中身が動的に決まるコレクションを作れるように（既存 `query-chips` の条件木を流用）。
- **コレクションにもタグ付け**: コレクション自体にタグを付けて分類できるように。
## 操作性・通知・拡張UI

- **画像のミドルクリックを「新規タブで開く」に統一（ブラウザライク）**: 現状はカード画像のミドルクリックで単一画像ウィンドウを開く（`viewer.js:2997-3011`→`openImageWindow`）。タブ機能は既存（`viewer.js:2495-2514`・タブ strip のミドルクリックは close）＝ミドルクリック＝新規タブで開く、に揃えてブラウザ挙動に統一。
- **右クリックからローカルファイル閲覧**: カード等のコンテキストメニューに「エクスプローラで表示/ファイルの場所を開く」を追加（実ファイルへの導線）。
- **操作の通知をもっと出す**: `window.corpusUI.notify`（`ui.js:12-19`）は在るが、タグの個別編集・検索/ソート変更・フィルタリセット等では出ていない（調査）。無音の操作にもトーストを足して手応えを増やす（出しすぎ注意＝頻発操作は間引き）。
- **拡張機能のエフェクト等をモダンに**: 拡張（`extension/`）のUI/アニメーション・エフェクトを現行アプリのガラス調に寄せて刷新。
- **「Corpus」の頭文字を大文字で固定（低優先・点検のみ）**: UI 文言は既に `Corpus` で大文字統一済み（i18n/About）。かつて「amazon 風に大文字小文字併用にしよう」というやり取りがあり、その名残の小文字表記が UI 表示文字列のどこかに残っていないか念のため点検（`window.corpus*` 等のコード識別子は正当なので対象外）。残骸が無ければ本項目は消してよい。

## 実機検証・開発インフラ

- **純ユニット群の npm test アグリゲータ（2026-07-01 UltraCode検出）**: CI 全体不採用は妥当だが、ネットワーク・Electron 不要の純ユニット系（test-index/test-search-unit/test-token-parity/test-contrast-parity/test-bridge-ssrf/test-archive-zipslip/test-archive-zipbomb/test-parse-url 等）は自動束ねのコストが極小。`npm test` で順次実行し1つでも fail で非0終了するスクリプトを用意し、既存 Windows サインイン時タスクか pre-commit フックで叩く。GitHub Actions は public 化フェーズまで保留可。
- **⚠️ Electron を EOL(33系)→サポート内(41/42) へ更新（2026-07-01 検出）**: 現固定 `app/package.json` `^33.2.0`。33系は **2025-04-29 EOL**＝内蔵 Chromium が約20か月分パッチ未適用（サポートは 41/42）。直近の Electron 層 CVE（[CVE-2026-34781](https://www.miggo.io/vulnerability-database/cve/CVE-2026-34781) clipboard DoS／[CVE-2026-34774](https://www.sentinelone.com/vulnerability-database/cve-2026-34774/) offscreen UAF）は未使用機能で直接影響なしだが、**実リスクの本体は Chromium 側未修正 CVE**＝任意画像バイトを renderer(psimg)/main(nativeImage) で復号するため画像デコーダ系 RCE が悪意画像経由で悪用され得る（即時性は低い）。**Chromium 本体が上がる重い更新**＝更新後は実機検証必須（キャプチャ/表示/サムネ生成/ウィンドウ挙動を目視）。急がないが放置しない。[Electron EOL 一覧](https://endoflife.date/electron)。
- **拡張の実機E2E拡充**: 特に X＝要ログインで未自動化（puppeteer は bot検出で弾かれる）。`e2e-capture-test.js`（全PF PASS・X除外）の延長で X を認証済みプロファイル/Claude in Chrome で。手動X残テスト（A-1系）もここ。
- **実機キャプチャの実ブラウザ経由 最終目視（残）**: Chrome 無しの end-to-end は検証済（メモリ `corpus-library-loss-incident`）。残＝実機 Chrome で1件キャプチャし `.jpg`+`.json` が落ちるのを目視（リモート不可）。
- **開発共通ルールを親フォルダ CLAUDE.md に集約**→重複削除。
- **React 化（最終形B）＝進行中**（下記専用セクション）。確立パターン/実装知はメモリ `corpus-react-settings-pilot`/`corpus-vite-migration` が真実源。

## React 化（最終形B＝単一Reactアプリ化・進行中）

**方針・実装知の真実源はメモリ**（`corpus-react-settings-pilot`/`corpus-vite-migration`）＝目的（合否基準）・確立パターン（反転パターン/プレゼンテーショナル島/idempotent guard/初期化順の罠）・各スライスの実装知。ここには**残タスクだけ**を置く。

- **依存/UI 方針（確定）**: 全面リライトしない・段階移行／依存は痛みが出た時に keep/replace で判断（bespoke＝フィルタ/グルーピング/正規化/日本語あいまい検索は保つ・コモディティ＝位置決め/窓化/a11y は痛んだら委譲）／UI はガラス維持（styled kit 却下）／状態は corpusStore 継続／ルーター無し。
- **着地済み**: Vite 移行（esbuild 廃止・段階0-2）／島16個（settings/sidebar-tags/query-chips/tabs/collections/searchbox=react-aria ComboBox/posters/post-card=テンプレート島/toolbar/context-menu/kind-menu/filter-popover/qf-pop/lightbox/inspector/edit-overlay）＋共有ストア window.corpusStore。フィルタ系（値フライアウト qfPop＋日付/エンゲージ/ポスター日付範囲ポップオーバー）は完了。**詳細/インスペクタパネル（post/poster）と一括タグ追加モーダルも完了＝インライン タグ編集/タグピッカーを共通 `_shared/TagEditor.jsx` へ一本化**（React化=目的1の実例）。Reactランタイムは全島から外部化し共有 vendor-react.js に一本化済み（c3269d4）。**検索ボックス＋サジェストも完了（スライスm・f0b206c）＝react-aria-components 導入・searchbox 島が input DOM を所有・値源は corpusStore searchQuery・旧 suggest 島は吸収削除**（実装知はメモリ `corpus-react-settings-pilot`）。#filterRows のバッジ（`renderFilterBadges`）は純粋な派生テキスト＋クラス切替でドリフトリスクが無く、React化の対象外と判断（現状維持）。
- **残タスク**:
  - グリッド完全React化＝#postGrid を viewer.js→React 所有＋仮想化（`viewer.js:3061`/`index.html:808` の線形劣化解消・下記「技術スタック候補」。回帰リスク最大＝後半スライスで慎重に）。
  - viewer.js（5724行 IIFE）を store/service/hooks へ段階抽出（純ロジック→service・横断状態→store・密着ロジック→hooks＝抽出であって全面リライトでない）。
  - 単一 root／単一バンドル化（島 IIFE×N を畳む・file:// ESM 制約は最終形B で別途）。※c3269d4 で React ランタイムを全島から外部化し共有 vendor-react.js に一本化＝バンドル畳みの地ならしに着手済み。
  - ポスターのフォルダ割当 toggle を実フォルダ作成で実データ再検証。

## コード地ならし（純リファクタ・2026-07-01 多エージェント調査でトリアージ）

> **位置づけ**: 振る舞い不変の内部改善のみ。**移行期に安全なのは衝突ゾーン外の小物だけ**＝大物（viewer.js 巨大関数分割・オーバーレイ集約）は上の React 化残タスクがリライトで自然消滅させる領域＝別立てにしない。実効レバー（手動タグUX）には効かない純地ならし＝優先度は高くない。検証で複数候補に誇張が判明＝核だけに縮小済み。

- **今やれる（衝突ゾーン外・単独可・挙動不変）**:
  - **clear-all の内部JSON誤全消去 footgun**（`main.js`）: 除外リストが or 鎖ハードコードで `import-posts` 側と分裂＝内部JSONを1つ足すと clear-all が誤全消去しうる予防案件。`INTERNAL_FILES.has()` 一本化が現行チェーンと集合一致を実確認済＝S・検証は「clear-all 1回で組織JSON残存」1点。
  - **lib-archive の collectFiles 抽出＋2関数 unionById**（`lib-archive.js`）: build*Zip 走査2箇所を collectFiles に括る／mergeFolders・mergeTagGroups を union-by-id 化（下 L4 と同系）。純関数・既存 test で固まる・S。※mergeCollections は構造別物で畳まない・zip-slip ガード同居で慎重に。
  - **JSON 裸 parse の BOM 剥ぎ**＝上「正しさ」節 **L3 の実装縮小版**（`parseJsonLoose` 一行差しに留める・reader 二系統統合は誇張で見送り）。
  - **theme.js の死んだ DOM 配線を除去**（`app/renderer/theme.js`・2026-07-01 UltraCode検出）: `apply()`(38-39行) と `init()`(72-76行) が削除済み `#themeSelect` を掴む到達不能コード（リポ全体で他に存在しない要素id）。React 版 Appearance.jsx は `window.corpusTheme` 駆動で DOM id 非依存＝React化で自然消滅しない移行取り残し。`init()` の `getPrefs()` 照合(77-82)は生きた IPC 同期経路なので残す。除去後は外観 select 切替でテーマ即反映を実機1点確認。
  - **content.js の日本語コードコメントを英語化**（`extension/content.js` 22箇所＋`extension/i18n.js:27-28`・2026-07-01 UltraCode検出）: `feedback-comment-language`規約（コード内コメントは英語）への唯一の実質違反。同ディレクトリの他4ファイルは全て英語。UI文字列リテラル（banner等）は日本語のまま据え置く。機械的翻訳で解消可。
  - **corpusSearch の購読APIを subscribe に統一**（`app/renderer/search.js`・2026-07-01 UltraCode検出）: store.js は `subscribe` を購読契約の基準とするが corpusSearch だけ `onChange`。`subscribe` エイリアスを追加し `QfPop.jsx`/`viewer.js` の呼び出しを寄せる（`onChange` は既存 vanilla 呼び出し互換で残置）。挙動不変の命名統一。
  - **コールバック搬送ブリッジの重複解消は「単一root/単一バンドル化」に合流**（`app/renderer/qf-pop.js`/`filter-popover.js`・2026-07-01 UltraCode検出）: 2本が完全一致の subscribe/notify 定型を重複実装（kind-menu/menu.jsは挙動差ありのため対象外）。島がまだ流動中のため単独前倒しはせず、上「React化」節の島 IIFE 畳み工程で `makeCallbackBridge({name,useOpenId})` に統合する。
- **見送り（誇張/振る舞い変更が判明・再提案しない）**: generationキャッシュ横展開（束ねた buildUsers は修正済＝real 薄・残りは150msデバウンス背後の O(N) 衛生案件）／getSaveFolder メモ化（毎回ライブ config 読みは消失事故対策の pointer 復旧防御そのもの＝ハード化点を壊す・実益µs級）／IPC集中ラッパーの「全46握り潰し」根治（誤り＝set*/persist系のみ・下技術スタック#2参照）／テストのアサーション様式3系統混在・DIAG_PREFIX重複定義・`'use strict'`不揃い・空catchバインディング名不統一（いずれも実害なし・Biome導入(#1)の初回スイープで機械的に一掃されるため個別着手は二重手間＝再提案しない）。

## 技術スタック候補（2026-07-01 多エージェント調査）

> **位置づけ**: 87候補を Corpus 固有制約（file:///厳格CSP/ファイルベース真実源/ガラス維持＝恒久的な設計制約）と開発者個人のライブラリの現状（現行約7600枚・メモリ`library-composition`＝変わりうる利用規模）の両方で採点した**採否の判断ログ**。版数/DL数など鮮度依存は割愛。**実効レバーはライブラリ機能でなく手動タグ付けUX**＝現状の無タグ規模ではどのエンジンを選んでも無タグは解消しない（本丸は「タグ付け・整理」節）。
> **通し方針**: 先に効くのは横断レバー（Biome/IPCラッパー/checkJs/配布整備＝検証表面積を下げる）。重い機能強化は最終形B 地ならし後。

### 優先度順（横断・上位16）

| # | 候補 | カテゴリ | 採否 | 根拠 |
|---|---|---|---|---|
| 1 | **Biome**（lint+format） | 品質 | adopt-now | lint/format ゼロを単一バイナリで一掃。CSP/build 無関係・全カテゴリ最速の即効レバー |
| 2 | **IPC集中ラッパー（自前）** | IPC | 最終形B後 | `catch{}` 黙殺を1経由で集約。~~全46波及~~＝実際は set*/persist系のみ・失敗のログ化/既定値化は**振る舞い変更**で純リファクタでない・viewer.js 外すと集中の実益消失＝新Reactストア層の一部として設計（2026-07-01訂正） |
| 3 | **electron-builder + publish/sign** | 配布 | adopt-now | v25.1.8 稼働中・dist 実績。乗り換えゼロで配布の穴を埋める唯一の現実解 |
| 4 | **JSDoc + checkJs**（.ts化なし） | 品質 | when-pain | 単一 IIFE ゆえ構造を壊さず型を載せる唯一の経路。契約破れを静的検出。JSDoc 人手が律速 |
| 5 | **Floating UI** | Headless UI | when-pain | 衝突回避5箇所コピーを1API化。位置決め専用でガラス無干渉・inline style で CSP 適合 |
| 6 | **masonic** | グリッド仮想化 | when-pain | 不定高マサンリー専用が Eagle 風と1:1。#postGrid の React 所有化が前提＝最終形B後半 |
| 7 | **Zod（main限定）** | スキーマ/IPC | when-pain | preload ~50 の契約破れを main 側 require（CSP 対象外）で実行時検出。L3 にも転用 |
| 8 | **electron-updater + GH Releases** | 自動更新 | adopt-now | 決定済・public化前提に合致・追加インフラ不要。builder と同一作者 |
| 9 | **i18nキー網羅スクリプト（自前）** | i18n | adopt-now | 片側欠落/キーズレの無音失敗を15〜30行で潰す。i18next は 342キー2言語に過剰 |
| 10 | **lucide-react** | アイコン | evaluate | DESIGN.md:76 指定と自前35SVGが実測一致。ただし島のみ・本体は最終形B完了時に一括移行 |
| 11 | **MiniSearch + BudouX** | 検索 | evaluate | 全文/haystack/ファセット/サジェストを一括・WASM不使用で CSP 適合最高。日本語境界に BudouX 必須 |
| 12 | **SignPath Foundation** | 署名 | when-pain | 無料OSS・日本拠点でも申請可。private では申請不可＝public化と順序合わせ |
| 13 | **better-sqlite3 + FTS5** | DB | evaluate | SQL で複数痛点を解く潜在力。ただしボトルネックは IPC直列化・ネイティブ配布コスト見合わず |
| 14 | **sharp**（libvips） | 画像 | evaluate | サムネ同期ブロッキング＋webp/avif 非対応を別スレッドで一掃。asarUnpack＝実行時依存ゼロを破る越境 |
| 15 | **Vitest** | テスト | evaluate | 島ロジック用。最大痛点 getFilteredPosts 等は IIFE で対象外＝service 抽出後に本領 |
| 16 | **react-aria 自前パレット** | Cmd+K | when-pain | react-aria-components はスライスm（検索ボックス）で導入済＝パレットは追加依存ゼロ。search.js を通せば日本語あいまい検索の二重実装も回避。最終形B後に1ツリーで |

### ティア早見表

- **adopt-now**: Biome／electron-builder(publish/sign)／electron-updater／i18nキー網羅スクリプト／**「現状維持が最適解」と確認**: 自前 corpusStore・自前 Date/Intl・自前スモーク+puppeteer・自前 fs.watch・自前 HTML5 DnD・自前 .index.json+Map・search.js継続・知覚ハッシュ見送り・自前SVGアイコン本体。
- **adopt-when-pain**: JSDoc+checkJs／Floating UI／masonic／Zod(main)／Valibot(main)／SignPath／chokidar v4／@electron/fuses／react-aria自前パレット／位置決め共通フック化／IPC集中ラッパー(最終形B後・新Reactストア層で)。
- **evaluate（要PoC）**: lucide-react／MiniSearch+BudouX／better-sqlite3+FTS5／sharp／Vitest／Knip／TanStack Query(最終形B後)／cmdk／Radix UI／Certum／Zustand(最終形B後)。
- **reject**: oxlint／kbar／dnd-kit・pragmatic-dnd・SortableJS／Jotai・nanostores・Valtio・XState／FlexSearch・Orama／kuromoji・lindera-wasm／node:sqlite・sql.js・DuckDB／imghash／@parcel/watcher・graceful-fs／dayjs・Luxon・Temporal／ArkType・superstruct／Motion・react-spring・auto-animate／Iconify／Paraglide・FormatJS・LinguiJS／Playwright視覚回帰・node:test／electron-forge・Azure Trusted Signing／electron-trpc・Comlink。

### 却下理由（固有制約に正面衝突・再提案しない）

| 候補 | 却下理由 |
|---|---|
| kuromoji / lindera-wasm | WASM に `wasm-unsafe-eval` 必須＝厳格CSP方針の変更そのもの。強化の道は BudouX 系 |
| Iconify | CDN/API 動的取得が file://・`script-src 'self'` と根本非互換 |
| Azure Trusted Signing | Identity Validation 対象国が US/CA/EU/UK のみ＝日本拠点は申請不可 |
| @parcel/watcher | 目玉 getEventsSince が解く問題は `_deltaFolder=null` 全reconcile で自己修復済＝架空 |
| Motion / react-spring | View Transitions+CSS で核心実現済み、11島IIFE悪化の代償が痛点(sev2)を上回る |
| electron-trpc / Comlink | TS前提が未導入と噛み合わず、Comlink は公式に Electron 非互換明記 |
| dnd-kit ほか | 現行~80行が安定、4種木構造判定は導入後も手書き＝複雑さが移動するだけ |
| Jotai/Valtio/XState | 独立フラグ集合に派生atom/Proxy検知/状態機械の強みが刺さらない |

### カテゴリ別 勝者/次点

| カテゴリ | 勝者 | 次点 | 理由 |
|---|---|---|---|
| グリッド仮想化 | masonic | @virtuoso.dev/masonry | 不定高専用が Eagle 風と1:1。react-virtuoso は本領外で撤回 |
| Headless UI | Floating UI | Radix Primitives | 位置決め専用でガラス無干渉。Radix は WorkOS移管後の更新鈍化 |
| コマンドパレット | react-aria自前 | cmdk | search.js を通せて二重fuzzy回避。kbar は Fuse.js間接依存で却下 |
| 状態管理 | 自前corpusStore | Zustand(最終形B後) | 34行7-8キーに全ライブラリ過剰。型なしキーは checkJs で解く |
| 検索 | MiniSearch+BudouX | search.js+haystack事前計算 | まず次点で着手、日本語境界が痛んだら勝者へ |
| 埋め込みDB | 現状.index.json+Map | better-sqlite3+FTS5 | ボトルネックは IPC直列化。7600件は Map+JSON で十分 |
| 画像 | 現状維持 | sharp | 知覚ハッシュは段階③で時期尚早。webp/avif が顕在化したら sharp |
| ファイル監視 | 自前fs.watch | chokidar v4 | 全reconcile が自己修復・2026-06 インシデントは MSIX仮想化が真因 |
| 日付 | 自前Date/Intl | date-fns | Intlキャッシュ+_dateMs で計測済み最適・痛点に日付なし |
| スキーマ検証 | 自前BOM剥ぎヘルパ | Valibot/Zod(main) | L3 は BOM剥がし15行で足り厳密型の実ケースなし |
| アニメ | View Transitions+CSS | （なし） | viewer.js:4316 稼働・残る穴は Lightbox reflow(sev2)のみ |
| アイコン | lucide-react(島)/本体は最終形B後 | 自前SVG | DESIGN.md指定と実測一致。Iconify は CDN前提で file:// 非互換 |
| i18n | キー網羅スクリプト | 自前corpusI18n | 342/341パリティ・恒久2言語で FW は過剰 |
| テスト | 自前スモーク+puppeteer | Vitest | 実機=真実の文化と一致。Vitest は viewer.js 抽出後に本領 |
| 署名 | SignPath Foundation | Certum(有償) | 無料OSS・日本可。Azure は日本対象外で却下 |
| IPC | IPC集中ラッパー(自前・最終形B後) | Zod(main) | catch{}集約だが set*/persist系のみ＆ログ化/既定値化は振る舞い変更＝新Reactストア層で。electron-trpc/Comlink は TS前提 |

### 効く順

1. **今すぐ（独立・低リスク）**: Biome→i18nキー網羅スクリプト。（IPC集中ラッパーは「今すぐ」から降格＝最終形B後・技術スタック#2訂正参照）
2. **配布フェーズ**: electron-builder に publish/sign→electron-updater 配線→SignPath を public化に合わせ事前申請（審査が律速）→@electron/fuses を署名のついでに。
3. **段階的に型**: JSDoc+checkJs を preload/store/i18n の .d.ts から。React 大物導入の前提「契約の見える化」。
4. **最終形B 地ならし後**: masonic／Floating UI／lucide-react／react-aria自前パレット を1ツリーで。
5. **痛みが顕在化したら**: MiniSearch+BudouX（検索が線形劣化）／sharp（webp/avif で欠ける）／better-sqlite3（数万件に育つ）。

## リリース準備

- **配布パッケージング**（electron-builder, win/nsis）。
- 初回起動時に**拡張インストールのガイド**（ストア公開後・未インストール/未接続を検知して案内）。
- **デモGIF/スクショの充実**（README・LP 用に主要機能の短尺GIFを整備）。
- **GitHub Pages で LP を作る**（public 化フェーズに合わせて）。
- **About（バージョン情報）に外部リンク**: 現状 About は版数のみでリンク無し（`About.jsx`）＝GitHub リポ/リリースノート/ライセンス等へのリンクを追加。
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