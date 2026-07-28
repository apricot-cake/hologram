# Hologram アーキテクチャ・構成

射程（名乗り・概念モデル・取込の3段構造）は `scope.md`。個別機能の採否はそちらで判定する。

## 設計方針（この構成を選んだ理由）

判断とその理由は `decisions/` に1決定1ファイルで置く（一覧は `decisions/README.md`）。この文書は「今どうなっているか」を書く。

- [0001](decisions/0001-react-for-component-discipline.md) React 化の目的は部品化の強制とドリフト防止
- [0002](decisions/0002-dependency-adoption-criteria.md) 依存を入れる基準＝少数・信頼できる・固定・推移依存が薄い／痛みが出てから
- [0003](decisions/0003-build-vs-borrow-boundary.md) 自前で持つものと委ねるものの線引き
- [0005](decisions/0005-no-visual-change-during-migration.md) 移行作業では見た目を意図的に変えない
- [0006](decisions/0006-plain-shadcn-look.md) 素の shadcn ルックを採る（[0004](decisions/0004-own-styling-headless-behaviour.md)「見た目は自前」を置き換え）
- [0010](decisions/0010-sqlite-as-the-metadata-truth-source.md) メタデータの正本を SQLite に置き、ファイルは実体だけを持つ
- [0011](decisions/0011-preserve-acquisition-payloads.md) 取得したペイロードを原本として残し、正規化フィールドへの昇格だけを実需で絞る

## 全体フロー

キャプチャは拡張（タブキャプチャ＋API由来メタ）→ **Native Messaging ブリッジ**（`native-host/`・拡張/アプリ未起動でも動作）→ **保存先フォルダ（既定 `~/Hologram/library`・変更可）に `<captureId>.jpg`（純JPEG）と原寸メディアを置き、レコードは取込キュー `.hologram-inbox/` へ追記する**（#299）。アプリ（`app/`）がキューを取り込み、**メタデータの正本は SQLite（`~/.hologram/hologram.db`）**＝閲覧はそこへのクエリ（#5）。保存先フォルダに投稿ごとの JSON は無い（#302 で撤去。人が読める形が要る場面＝完全ZIPの書き出しでは DB から再生成する）。旧・拡張内ビューアと EXIF/storage 方式は撤去済み。配布パッケージングの手順は `docs/build.md`。

逆向き（ライブラリ→拡張）の経路は1本だけ＝**「この投稿は保存済みか」の問い合わせ**（`{type:'query'}`・#54 のTLバッジ）。ブリッジがライブラリ側の索引を読んで答えるため**アプリ未起動でも判定できる**。保存先には何も書かない読み取り専用経路。

## 構成

### `extension/` — Chrome拡張一式（MV3）

WXT（Vite ベース）でビルドする TypeScript ソース。`npm run build:ext` は `extension/.output/chrome-mv3/` を生成し、**このディレクトリを Load unpacked する**。開発時は `npm run dev:ext` を常駐させ、WXT がビルドと拡張再読み込みを担う。`wxt.config.ts` の `key` が固定IDを保つため、Native Messaging の許可元は変わらない。

- `wxt.config.ts` — 固定 `key`、権限、action、commands を含む生成 manifest の共通設定
- `entrypoints/background.ts` — Service Worker。タブキャプチャ → クロップ → `utils/metadata.ts` でAPI取得 → Native Messaging 送信。動的なクリック保存は固定名の `capture.js` を `scripting.executeScript` で注入し、`activeTab` のモデルを維持する
- `entrypoints/resident.content.ts` — X/Bluesky/pixiv に常駐する統合コンテンツスクリプト（ドラッグ保存とTLオーバーレイ）
- `entrypoints/options.html` / `diag.html` — 設定・内部診断ページ。`options.html` はタブで開く
- `utils/` — 通常の ESM 共有モジュール。`site-detect.ts`（投稿要素・permalink/rect抽出）、`media-identity.ts`（画像→投稿の帰属と取得候補URL）、`drag.ts`、`overlay.ts`、`glass-ui.ts`、`i18n.ts`、`metadata.ts` を置く。`metadata.ts` は失敗時に空レコードを返し、Misskey/Mastodon のAPI取得は sender tab のhostに固定する。応答は**本文として1度だけ読んでから解析**し、受け取ったままの本文をレコードに添えてブリッジへ渡す（[ADR 0011](decisions/0011-preserve-acquisition-payloads.md) の原本層。圧縮・ハッシュ・上限はブリッジ側の担当＝ブラウザ側は「何を残す価値があるか」を決めない）
- `public/` — `_locales/` と `icons/`

### `native-host/` — Native Messaging ブリッジ

`post-key.mts` を除き全ファイル `.cts`（CJS維持）。`install.cts` はアプリが生ソースのまま require（Node 型消去）。`bridge.cts` とその依存は **`dist/bridge.js` へバンドル**され（`app/build-native-host-bridge.mjs`・node 組み込みのみ external）、`install.cts` が `~/.hologram` へ配備するのはこのバンドル1ファイル＝配備物に実行時のモジュール解決が残らない（配備漏れが起きえない・host 側で npm 依存を使える）。

- `bridge.cts` — 保存先に jpg と原寸メディアを書き込み専用で生成し、レコードは取込キュー（`.hologram-inbox/new`）へ追記する（#299）。`media[]`（API由来の原寸URL）と著者アバターを**ベストエフォートでDL**し `<id>-media-N.<ext>` / `<id>-avatar.<ext>` に保存。加えて「保存済みか」の照会（`{type:'query'}`）に答える＝アプリが DB から書き出す `~/.hologram/bridge-saved-index.json`（postKey→captureId の表）を常駐させ、**スナップショットが取りこぼす分を2枚で補う**（①自分が保存した分を `~/.hologram/bridge-journal.jsonl` に追記＝アプリ未起動中の保存をカバー ②まだ取り込まれていないキューの分を見る）
- `raw-payload.mts` — 取得原本の詰め込みと検証（[ADR 0011](decisions/0011-preserve-acquisition-payloads.md)）。拡張が渡した応答本文を gzip・sha256 し、レコード単位の上限を当てて封筒へ載せる。`post-key.mts` と同じくアプリ側も ES import する共有モジュール
- `post-key.mts` — URL→投稿の同一性キー（`postKeyOf`）の**唯一の実装**。レンダラのグループ化（`app/src/renderer/src/services/records.ts` が再exportして使用）とバッジ判定が同じ規則でなければ、アプリが同一視する投稿をバッジが取りこぼす。拡張側は正規化せず permalink を渡すだけ。ここだけ ESM（`.mts`）＝レンダラが ES import する唯一のファイルで、`.cts` では tsc から export が見えないため（理由は `tsconfig.json` 冒頭）
- `media-download.cts` — **メディアDLの共有モジュール**（SSRFガード・静止画25MB/12s・動画200MB/60s・12件上限・https限定・手動リダイレクト・失敗時dropで保存を失敗させない）。応答本文は**同じフォルダの一時ファイルへストリームしてから rename で確定**＝上限は `Content-Length` の申告でなく**実受信バイト**で強制し、失敗した取得は完成扱いのファイルも一時ファイルも残さない。加えて**1回の保存全体で 512MB の合計バイト予算**を持ち（`createByteBudget` を保存操作ごとに1つ作り、その保存の全DLへ渡す）、**同時取得は2件まで**＝メモリ・ソケット・ディスクのどれも添付点数に比例しない（#389）。`saveStillImage`/`downloadMedia`/`downloadAvatar`/`createByteBudget`/`pixivRefererFor` を export し、bridge・app(`import-posts`)・`backfill-metadata.cts` で同一ロジックを共有（ガードが経路ごとにズレないように一箇所へ集約）
- `install.cts` — ホスト登録
- `paths.cts` — 共有configパス
- `config-recovery.cts` — 保存先復旧・破壊操作ゲート判定（純関数）

### `app/` — Electron デスクトップアプリ

electron-vite で main・preload・renderer の3面をバンドルする標準構成（#156・2026-07。それ以前は main プロセスを `.mts` 直実行する build-less 構成だった＝過去の設計判断は Issue #156 参照）。ソースは `src/main/`・`src/preload/`・`src/renderer/`、ビルド出力は `out/`（gitignore・`electron.vite.config.ts` が3面の設定を持つ）。

- `src/main/index.ts` — メインプロセス（ウィンドウ生成・取込キューの `fs.watch`・IPC登録）
- `src/main/lib-archive.ts` — ZIP入出力
- `src/main/lib-db*.ts` — SQLite 層（エンジン/スキーマ/クエリ/書き込み/取込キュー/整合チェック）。取得原本（`raw_payloads`・[ADR 0011](decisions/0011-preserve-acquisition-payloads.md)）は共有 writer が投稿と同じトランザクションで書き、追記のみで消さない。いずれも Electron 非依存＝node でテスト可。`listPosts` は DB への1クエリで、更新は差分IPC（list-posts-delta）＝`lib-post-delta.ts` が「前回配った分」と突き合わせて追加/削除だけ返す（#302 でファイル走査は消え、ヒントの受け渡しも不要になった）
- `src/main/lib-card-dims.ts` — カード画像の実寸（`shotW`/`shotH`）をヘッダだけ読んで測る。masonry のカード高さを画像ロード前に確保するため、**レコードを書く時に**測って DB に入れる
- `src/main/lib-legacy-import.ts` — **リリース前に撤去する仮設コード**（#441）＝#5 以前のライブラリに残る投稿ごと JSON と整理層 JSON を1回だけ DB へ移す
- `src/preload/index.ts` — contextBridge の実装。公開APIの型は実装から`HologramPreload`としてexportし、rendererはそれを型エイリアスで参照（手書き型ミラーなし・Issue #17）
- `src/renderer/index.html`＋`src/renderer/public/`（`theme.js`＝pre-paint、`<script>`で直読み。`app/build-theme-boot.mjs`が`theme.ts`から再生成＝バンドル外の同期スクリプトという制約は変わらない）
- `src/renderer/src/services/`（旧 `renderer/*.ts`）＝`orchestrator.ts`（2026-07-11に`viewer.ts`から改名。boot orchestration層として意図的に独立モジュールのまま残す設計）が状態/オーケストレーション/IPC呼び出しの中核、`store.ts`ほか単機能サービス（`tags.ts`/`selection.ts`/`query.ts`/`records.ts`等）に段階抽出済み。`design-tokens.css`は`src/renderer/`直下（index.htmlの`<link>`が参照）
- `src/renderer/src/`直下 — React（`.tsx`）コンポーネント群（旧 `islands/`）。`services/store.ts`をESM importで直接購読して連携（push型のモデル注入・`window.hologramXxx`ブリッジは全廃済み＝Window拡張はpreloadの`window.hologram`のみ）
- 機能: DB クエリで閲覧、拡張ID設定・ホスト自動登録、指定フォルダへの定期バックアップ（増分ミラー・`Hologram-mirror`＋DBのスナップショット）。画像は `asset://` プロトコルで遅延読込。

## ビューア機能（内部実装メモ）

> ユーザー向けの機能説明は `README.md` を参照。ここは実装に紐づく注記のみ。

- プラットフォームフィルタ（チップボタン）
- インスタンス/サーバーフィルタ（Misskey / Mastodon 選択時にサイドバーへサーバー一覧を展開、URLのホストで絞り込み。プラットフォーム解除で孤立したinstanceフィルタは自動整理）
- 保存先フォルダの自動監視（新規キャプチャ等で一覧を自動更新。main の `fs.watch`→`posts-changed` IPC）
- ハッシュタグ一覧タブ（本文の #タグ を抽出・頻度順表示、クリックで絞り込み。タブ内に絞り込み入力）
- 投稿者ビュー（サイドバー先頭の「ライブラリ / 投稿者」モード切替トグルで投稿グリッド⇄投稿者グリッドを切替＝`browseMode`・起動時に前回モードを復元・前例 Bluesky/Xのプロフィールタブ）。投稿者カードはレコードの著者情報を `buildUsers()` が `platform:userId` でグルーピングして導出（追加のAPI取得なし）＝アバター（`avatarFile`・無ければモノグラム）＋投稿者名＋@ユーザー名＋PFドット＋投稿数、投稿数順ソート。カードにホバーボタンは無い（#143 でホバー部品ゼロへ統一）。**クリック=インスペクタ**（投稿者プロフィール＝アバター/名前/PF/投稿数、フォロワー/登録日は公開APIに有れば＋**最近の作品サムネ6枚**＝その投稿者の投稿を `groupRecords` で新しい順にグループ化しリード画像を表示、サムネクリックでギャラリー）、**ダブルクリック=投稿モードでその投稿者の `user` フィルタ**。検索ボックスは投稿者名/@で絞り込み（名前もハンドルも無いレコードは投稿者グリッドから除外）。投稿者モードはサイドバーをライブラリと同じ**「行＋フライアウト」方式**（`#posterFilterRows`）に切替＝プラットフォーム/タグ/作品/キャラ/インスタンス/日付/フォルダの各行＋件数バッジ（作品/キャラ/タグ/インスタンス行は該当値があるときだけ咲く＝段階的開示）＋並び順(投稿数/名前)＋**レイアウト切替(card/tile/list・タイルはアバター主役の正方＝`posterView`)**＋検索。**日付コントロールは並び替えと範囲フィルタを一本化**＝1つの日付軸(`posterDate.dim`＝投稿日`latest`/取得日`lastCapture`/作成日`authorCreatedAt`、buildUsers が集計) に対し、並び(`dir`＝新しい/古い/なし・なし以外は投稿数/名前 select を上書き)と期間(from/to)を同じポップで指定。絞り込みは投稿側 `activeFilters` に介入せず transient な `posterXxx` 状態（`qfValues`/`renderQfPop`/qfPop クリックに `poster-*` カテゴリを追加・`filteredPosters` で AND 合成）。**名前付きフォルダ**＝投稿者を複数の名前付きフォルダに整理。サイドバーのフォルダ行→フライアウトで絞り込み・管理は `#ivFolderModal` を共用（作成/リネーム/削除/D&D＝`folders.ts` の `openManager({store,onChange})` で対象ストアを差し替え・モーダルUIの実体は React 島 `src/renderer/src/folders/FolderManagerModal.tsx`）、割当はインスペクタのフォルダチップ＋カード右クリック。保存は DB（`poster_folders`/`poster_folder_items`）。`get/set-poster-folders`・`get/set-poster-tags` IPC。完全ZIP には `poster-folders.json`（`{folders:[{id,name,items:[posterKey]}]}`・folders.jsonと同形＝import は既存 `mergeFolders` 再利用）として出入りする（`ORG_MERGE` に登録済み。お気に入り機能は削除したが `poster-favorites.json` は旧ZIPを取り込むための分類登録だけ残す）。横断制約＝poster-folders/tags/date 集計は全て集約キー `u.key`（=`userKey(p)`）経由＝将来の名寄せ1点改修と非衝突。**残**: 投稿者グリッドのアバターは既存ライブラリが未backfillだと出ない（新規キャプチャ/`backfill-metadata.cts --avatars` で順次）。SNS横断の名寄せ（同一人物の別PF統合）は未実装（Issue #23）。
- 添付画像の原寸表示（スクショ＋原寸を1つに束ねたギャラリーを開く＝prev/next・矢印キー・カウンタ。原寸はページ送りで閲覧）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- レイアウト切替（card/tile/list・config保存）
- 投稿の個別削除・一括削除（確認スキップ可）
- カード右クリックの操作メニュー（開く/新しいタブで開く/タグ編集/フォルダに追加/この投稿者を見る/画像をコピー/ファイルの場所を開く/詳細/削除）
- **他アプリへの送り出し**（#132）＝カード画像のドラッグアウト（Explorer・PureRef 等へ**原本ファイル**をドロップ。選択中のカードを掴めば選択全体・選択外を掴めばそのカードだけ。複数画像投稿は `g.files` 全部。**ドラッグは選択を読むだけで書き換えない**＝Explorer の「ドラッグで選択が変わる」は mousedown の副産物でドラッグ側の設計ではなく、Hologram の選択はスクロールをまたいで手で作る作業セット＝アプリ外へ出る操作で壊さない。規則の実体は `records.ts` の `dragFilesOf`＝純関数）＋**画像をコピー**（右クリックメニュー／選択1件時の `Ctrl+C`＝クリップボードは1枚しか持てないため複数は不可）。実体＝`dragstart` を `preventDefault` して main の `webContents.startDrag`（`drag-out`＝invoke でなく send＝ドラッグは同期開始が必須）／`clipboard.writeImage`（`copy-image`）。ファイル名→実パスの解決とベースネーム検証は `app/src/main/library-files.ts` が単一所有（欠損ファイルは除外＝Windows は不在パスを1つ混ぜるとドラッグ全体が失敗する／svg 等 nativeImage が読めない形式は false を返し**クリップボードを空で上書きしない**）
- 言語切替（auto/ja/en）
- エクスポート: ZIP（画像+JSON）／インポート: ZIP から復元
- 指定フォルダへの定期バックアップ（増分ミラー・`Hologram-mirror`・間隔スケジュール可・起動時の遅れ取り戻し）

## i18n

アプリ（`app/src/renderer/src/services/i18n.ts`）は config.json の `language` で制御（auto/ja/en）。content.ts のバナーは拡張側 `i18n.ts` で日英対応（auto はブラウザ言語に追従）。
