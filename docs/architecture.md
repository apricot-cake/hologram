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
- `entrypoints/background.ts` — Service Worker。タブキャプチャ → クロップ → `utils/extractor/` でAPI取得 → Native Messaging 送信。動的なクリック保存は固定名の `capture.js` を `scripting.executeScript` で注入し、`activeTab` のモデルを維持する
- `entrypoints/resident.content.ts` — X/Bluesky/pixiv に常駐する統合コンテンツスクリプト（ドラッグ保存とTLオーバーレイ）
- `entrypoints/options.html` / `diag.html` — 設定・内部診断ページ。`options.html` はタブで開く
- `utils/` — 通常の ESM 共有モジュール。`drag.ts`、`overlay.ts`、`capture.ts`、`bulk-capture.ts`、`glass-ui.ts`、`i18n.ts` など**サイトに依らない**層を置く。
- `utils/extractor/` — **サイト別の抽出（extractor）＝1サイト1モジュール**（`x.ts`／`bluesky.ts`／`misskey.ts`／`mastodon.ts`／`pixiv.ts`）。1つのモジュールが DOM 相（ページ判定・投稿要素・permalink・画像の帰属・オーバーレイの取り付け先）と API 相（投稿URLの解析・メタデータ取得）の両方を持ち、共通の `Extractor` 契約（`types.ts`）で束ねる。`index.ts` の登録簿（配列）が**サイトの唯一の真実源**で、manifest の match とhost_permissions もここから引く＝対応サイトを増やす編集は「モジュール1本＋登録簿1行」（#212）。取得は失敗時に空レコードを返し、Misskey/Mastodon のAPI取得は sender tab のhostに固定する。応答は**本文として1度だけ読んでから解析**し、受け取ったままの本文をレコードに添えてブリッジへ渡す（[ADR 0011](decisions/0011-preserve-acquisition-payloads.md) の原本層。圧縮・ハッシュ・上限はブリッジ側の担当＝ブラウザ側は「何を残す価値があるか」を決めない）
- `public/` — `_locales/` と `icons/`

### `native-host/` — Native Messaging ブリッジ

`post-key.mts` / `post-record.mts` / `inbox.mts` / `raw-payload.mts` / `protocol.mts` を除き全ファイル `.cts`（CJS維持）＝ESM なのはディレクトリの外から ES import される共有モジュールだけ。`install.cts` はアプリが生ソースのまま require（Node 型消去）。`bridge.cts` とその依存は **`dist/bridge.js` へバンドル**され（`app/build-native-host-bridge.mjs`・node 組み込みのみ external）、`install.cts` が `~/.hologram` へ配備するのはこのバンドル1ファイル＝配備物に実行時のモジュール解決が残らない（配備漏れが起きえない・host 側で npm 依存を使える）。

- `bridge.cts` — 保存先に jpg と原寸メディアを書き込み専用で生成し、レコードは取込キュー（`.hologram-inbox/new`）へ追記する（#299）。`media[]`（API由来の原寸URL）と著者アバターを**ベストエフォートでDL**し `<id>-media-N.<ext>` / `<id>-avatar.<ext>` に保存。加えて「保存済みか」の照会（`{type:'query'}`）に答える＝アプリが DB から書き出す `~/.hologram/bridge-saved-index.json`（postKey→captureId の表）を常駐させ、**スナップショットが取りこぼす分を2枚で補う**（①自分が保存した分を `~/.hologram/bridge-journal.jsonl` に追記＝アプリ未起動中の保存をカバー ②まだ取り込まれていないキューの分を見る）
- `protocol.mts` — **拡張⇄ホストのメッセージ契約の唯一の宣言**（#400）。リクエスト6種（`save`/`savePost`/`saveDragged`/`query`/`log`/`ping`）・応答・エラーコード・captureId の形（保存フォルダから出られない規則）・リクエストid の折り返し規則・プロトコル版番号を持ち、`parseHostFrame` が受信フレームを型の付いたリクエストか返答すべき失敗に変える。**拡張側がこのファイルを import する**（WXT/Vite がバンドル時に取り込む＝配布される拡張にこのディレクトリへの実行時依存は残らない）＝逆向きに置けない理由は、`native-host/` が `app/` 抜きで配られる別デリバラブルだから（electron-builder が生のまま extraResource で運ぶ）。**ブラウザのバンドルに入る唯一のファイル**なので node 組み込みに触れてはならず、`post-record.mts` / `raw-payload.mts` からの import は型だけ。**プロトコル版のハンドシェイク**（#205）もここが持つ＝ホストは**全ての返信**に自分の版を刻み（`stampProtocol`・成功も失敗も。保存を断るほど古いホストこそ版が要る）、拡張は `protocolSkewOf` で自分の版と整数比較して `host-old`（アプリを更新）／`host-new`（拡張を更新）を出す。⚠️**版を名乗らない返信は `host-old`**＝この仕組みより前のホストが残っている印（#511 の真因）。⚠️**版で挙動を変える分岐は書かない**＝検知して案内するだけで、ずれていても保存は最後まで試す（データを捨てない・#203 と同じ方針）。案内の文言は `extension/utils/i18n.ts`、両者の版を並べるのは `diag.html`
- `raw-payload.mts` — 取得原本の詰め込みと検証（[ADR 0011](decisions/0011-preserve-acquisition-payloads.md)）。拡張が渡した応答本文を gzip・sha256 し、レコード単位の上限を当てて封筒へ載せる。`post-key.mts` と同じくアプリ側も ES import する共有モジュール
- `post-key.mts` — URL→投稿の同一性キー（`postKeyOf`）の**唯一の実装**。レンダラのグループ化（`app/src/renderer/src/services/records.ts` が再exportして使用）とバッジ判定が同じ規則でなければ、アプリが同一視する投稿をバッジが取りこぼす。拡張側は正規化せず permalink を渡すだけ。ここだけ ESM（`.mts`）＝レンダラが ES import する唯一のファイルで、`.cts` では tsc から export が見えないため（理由は `tsconfig.json` 冒頭）
- `media-download.cts` — **メディアDLの共有モジュール**（SSRFガード・静止画25MB/12s・動画200MB/60s・12件上限・https限定・手動リダイレクト・失敗時dropで保存を失敗させない）。応答本文は**同じフォルダの一時ファイルへストリームしてから rename で確定**＝上限は `Content-Length` の申告でなく**実受信バイト**で強制し、失敗した取得は完成扱いのファイルも一時ファイルも残さない。加えて**1回の保存全体で 512MB の合計バイト予算**を持ち（`createByteBudget` を保存操作ごとに1つ作り、その保存の全DLへ渡す）、**同時取得は2件まで**＝メモリ・ソケット・ディスクのどれも添付点数に比例しない（#389）。`saveStillImage`/`downloadMedia`/`downloadAvatar`/`createByteBudget`/`pixivRefererFor` を export し、bridge・app（旧形式ZIPの取り込み）・`backfill-metadata.cts` で同一ロジックを共有（ガードが経路ごとにズレないように一箇所へ集約）
- `install.cts` — ホスト登録
- `paths.cts` — 共有configパス
- `config-recovery.cts` — 保存先復旧・破壊操作ゲート判定（純関数）

### `app/` — Electron デスクトップアプリ

electron-vite で main・preload・renderer の3面をバンドルする標準構成（#156・2026-07。それ以前は main プロセスを `.mts` 直実行する build-less 構成だった＝過去の設計判断は Issue #156 参照）。ソースは `src/main/`・`src/preload/`・`src/renderer/`、ビルド出力は `out/`（gitignore・`electron.vite.config.ts` が3面の設定を持つ）。

- `src/main/index.ts` — メインプロセスの組み立て（起動シーケンス・レコード配給の中核＝DBを開いて取込キューを流し renderer へ配る・取込キューの `fs.watch`・IPC登録）。自己完結するサブシステムは `lib-*.ts` へ出してあり（#227）、境界は「機能が近いか」でなく**元ファイルのどのブロックに住んでいたか**で引いた
- `src/main/native-host.ts` — `native-host/` の CJS モジュールを**実行時に組み立てたパス**で require する唯一の場所（dev は `out/main/` からの相対、配布時は `resources/native-host`）。バンドラが追えない＝追ってはいけない読み込みをここに閉じ込める
- `src/main/lib-config.ts` — `config.json` の読み書きと保存先フォルダの解決。原子的書き込みと**冗長な保存先ポインタ**（`saveFolder.path`）を1か所に持つ＝2026-06-23 のライブラリ消失は config 1本に保存先が乗っていたことが原因で、復旧経路を書き込み規律と同じ場所に置くのが対策
- `src/main/lib-backup.ts` — 増分ミラーのエンジンと定期実行、出力先の検証、#301 の整合チェック。整合チェックが同居するのは同じ走査結果を使い回すため（二重実装しない）。DBを同期してからでないと写しも孤児検出も成立しないので、その部分だけ index.ts から注入で受け取る
- `src/main/lib-window.ts` — メインウィンドウ（生成・位置とサイズの永続化・ナビゲーション封じ）。`win` を所有するのはこのモジュールだけで、他は `getWin()` / `sendToWin()` 経由
- `src/main/lib-thumbnails.ts` — `asset://` ハンドラと、その `?w=N` が使うサムネイル生成プール・ディスクキャッシュ
- `src/main/ipc-*.ts` — チャンネル別のハンドラ群。IPC境界の型は2つに分かれる（#228）＝`ipc-context.ts` の `IpcContext` が index.ts から各 `register(ctx)` へ渡す依存の契約（main専用。BrowserWindow や DB writer を名前で持つ）、`ipc-payloads.ts` が**実際にIPCを渡るペイロードの形**。後者は import を1つも持たない＝renderer 側の DOM-only プログラムが `HologramPreload` 経由で辿り着くため。ハンドラ側の戻り値にも同じ型を注釈してあるので、片端だけの変更はビルドで落ちる（チャンネル名で両端を突き合わせる仕組みは #10 の集中ラッパーの担当で、まだ無い）
- `src/main/lib-archive.ts` — ZIP入出力
- `src/main/lib-db*.ts` — SQLite 層（エンジン/スキーマ/クエリ/書き込み/取込キュー/整合チェック）。取得原本（`raw_payloads`・[ADR 0011](decisions/0011-preserve-acquisition-payloads.md)）は共有 writer が投稿と同じトランザクションで書き、追記のみで消さない。いずれも Electron 非依存＝node でテスト可。`listPosts` は DB への1クエリで、更新は差分IPC（list-posts-delta）＝`lib-post-delta.ts` が「前回配った分」と突き合わせて追加/削除だけ返す（#302 でファイル走査は消え、ヒントの受け渡しも不要になった）
- `src/main/lib-card-dims.ts` — カード画像の実寸（`shotW`/`shotH`）をヘッダだけ読んで測る。masonry のカード高さを画像ロード前に確保するため、**レコードを書く時に**測って DB に入れる
- `src/preload/index.ts` — contextBridge の実装。公開APIの型は実装から`HologramPreload`としてexportし、rendererはそれを型エイリアスで参照（手書き型ミラーなし・Issue #17）
- `src/renderer/index.html`＋`src/renderer/public/`（`theme.js`＝pre-paint、`<script>`で直読み。`app/build-theme-boot.mjs`が`theme.ts`から再生成＝バンドル外の同期スクリプトという制約は変わらない）
- `src/renderer/src/services/`（旧 `renderer/*.ts`）＝`orchestrator.ts`（2026-07-11に`viewer.ts`から改名。boot orchestration層として意図的に独立モジュールのまま残す設計）が状態/オーケストレーション/IPC呼び出しの中核、`store.ts`ほか単機能サービス（`tags.ts`/`selection.ts`/`query.ts`/`records.ts`等）に段階抽出済み。`design-tokens.css`は`src/renderer/`直下（index.htmlの`<link>`が参照）
- `src/renderer/src/`直下 — React（`.tsx`）コンポーネント群（旧 `islands/`）。`services/store.ts`をESM importで直接購読して連携（push型のモデル注入・`window.hologramXxx`ブリッジは全廃済み＝Window拡張はpreloadの`window.hologram`のみ）
- 機能: DB クエリで閲覧、拡張ID設定・ホスト自動登録、指定フォルダへの定期バックアップ（増分ミラー・`Hologram-mirror`＋DBのスナップショット）。画像は `asset://` プロトコルで遅延読込＝応答は必ず CSP（`default-src 'none'` 基底）と `nosniff` を載せ、この スキームのトップレベル文書になれるのはラスタ画像だけ（窓を開く経路と `will-navigate` が `library-files.ts` の同じ述語を通る。理由は [ADR 0012](decisions/0012-asset-documents-are-raster-only.md)）。

## ビューア機能（内部実装メモ）

> ユーザー向けの機能説明は `README.md` を参照。ここは実装に紐づく注記のみ。

- プラットフォームフィルタ（チップボタン）
- インスタンス/サーバーフィルタ（Misskey / Mastodon 選択時にサイドバーへサーバー一覧を展開、URLのホストで絞り込み。プラットフォーム解除で孤立したinstanceフィルタは自動整理）
- 保存先フォルダの自動監視（新規キャプチャ等で一覧を自動更新。main の `fs.watch`→`posts-changed` IPC）
- ハッシュタグ一覧タブ（本文の #タグ を抽出・頻度順表示、クリックで絞り込み。タブ内に絞り込み入力）
- 投稿者ビュー（サイドバー先頭の「ライブラリ / 投稿者」モード切替トグルで投稿グリッド⇄投稿者グリッドを切替＝`browseMode`・起動時に前回モードを復元・前例 Bluesky/Xのプロフィールタブ）。投稿者カードはレコードの著者情報を `buildUsers()` が `platform:userId` でグルーピングして導出（追加のAPI取得なし）＝アバター（`avatarFile`・無ければモノグラム）＋投稿者名＋@ユーザー名＋PFドット＋投稿数、投稿数順ソート。カードにホバーボタンは無い（#143 でホバー部品ゼロへ統一）。**クリック=インスペクタ**（投稿者プロフィール＝アバター/名前/PF/投稿数、フォロワー/登録日は公開APIに有れば＋**最近の作品サムネ6枚**＝その投稿者の投稿を `groupRecords` で新しい順にグループ化しリード画像を表示、サムネクリックでギャラリー）、**ダブルクリック=投稿モードでその投稿者の `user` フィルタ**。検索ボックスは投稿者名/@で絞り込み（名前もハンドルも無いレコードは投稿者グリッドから除外）。投稿者モードはサイドバーをライブラリと同じ**「行＋フライアウト」方式**（`#posterFilterRows`）に切替＝プラットフォーム/タグ/作品/キャラ/インスタンス/日付/フォルダの各行＋件数バッジ（作品/キャラ/タグ/インスタンス行は該当値があるときだけ咲く＝段階的開示）＋並び順(投稿数/名前)＋**レイアウト切替(card/tile/list・タイルはアバター主役の正方＝`posterView`)**＋検索。**日付コントロールは並び替えと範囲フィルタを一本化**＝1つの日付軸(`posterDate.dim`＝投稿日`latest`/取得日`lastCapture`/作成日`authorCreatedAt`、buildUsers が集計) に対し、並び(`dir`＝新しい/古い/なし・なし以外は投稿数/名前 select を上書き)と期間(from/to)を同じポップで指定。絞り込みは投稿側 `activeFilters` に介入せず transient な `posterXxx` 状態（`qfValues`/`renderQfPop`/qfPop クリックに `poster-*` カテゴリを追加・`filteredPosters` で AND 合成）。**名前付きフォルダ**＝投稿者を複数の名前付きフォルダに整理。サイドバーのフォルダ行→フライアウトで絞り込み・管理は `#ivFolderModal` を共用（作成/リネーム/削除/D&D＝`folders.ts` の `openManager({store,onChange})` で対象ストアを差し替え・モーダルUIの実体は React 島 `src/renderer/src/folders/FolderManagerModal.tsx`）、割当はインスペクタのフォルダチップ＋カード右クリック。保存は DB（`poster_folders`/`poster_folder_items`）。`get/set-poster-folders`・`get/set-poster-tags` IPC。完全ZIP には `poster-folders.json`（`{folders:[{id,name,items:[posterKey]}]}`・folders.jsonと同形＝import は既存 `mergeFolders` 再利用）として出入りする（`ORG_MERGE` に登録済み。お気に入り機能は削除したが `poster-favorites.json` は旧ZIPを取り込むための分類登録だけ残す）。横断制約＝poster-folders/tags/date 集計は全て集約キー `u.key`（=`userKey(p)`）経由＝将来の名寄せ1点改修と非衝突。**残**: 投稿者グリッドのアバターは既存ライブラリが未backfillだと出ない（新規キャプチャ/`backfill-metadata.cts --avatars` で順次）。SNS横断の名寄せ（同一人物の別PF統合）は未実装（Issue #23）。
- 添付画像の原寸表示（スクショ＋原寸を1つに束ねたギャラリーを開く＝prev/next・矢印キー・カウンタ。原寸はページ送りで閲覧）。**ビューア操作は常設ツールバー**（#150）＝ズーム − / 表示% / ＋ とフィット⇄原寸トグルが、画像ビュー中だけトップの帯（`shell/AppToolbar.tsx`）へ入れ替わりで出る（グリッドの述語＝検索・フィルタ・表示は同じ間だけ引っ込む）。ホイールズーム・ダブルクリックのフィット切替は**同じ関数のショートカット**として併存し、`Ctrl+0`＝フィット／`Ctrl+1`＝原寸。表示% は `scale × offsetWidth ÷ naturalWidth` で**原寸=100%** に正規化する（react-zoom-pan-pinch の scale はフィット=1 基準なので、素の scale は画像ごとに意味が違う）。ズームできる面が今あるかは `services/image-zoom.ts` へのコントローラ登録が唯一の情報源＝Zoomable を描かない動画・うごイラのスライドではズーム系が自動的に disabled になる（クラスタごと消えるのではない）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- レイアウト切替（card/tile/list・config保存）
- 投稿の個別削除・一括削除（確認スキップ可）
- カード右クリックの操作メニュー（開く/新しいタブで開く/タグ編集/フォルダに追加/この投稿者を見る/画像をコピー/ファイルの場所を開く/詳細/削除）
- **他アプリへの送り出し**（#132）＝カード画像のドラッグアウト（Explorer・PureRef 等へ**原本ファイル**をドロップ。選択中のカードを掴めば選択全体・選択外を掴めばそのカードだけ。複数画像投稿は `g.files` 全部。**ドラッグは選択を読むだけで書き換えない**＝Explorer の「ドラッグで選択が変わる」は mousedown の副産物でドラッグ側の設計ではなく、Hologram の選択はスクロールをまたいで手で作る作業セット＝アプリ外へ出る操作で壊さない。規則の実体は `records.ts` の `dragFilesOf`＝純関数）＋**画像をコピー**（右クリックメニュー／選択1件時の `Ctrl+C`＝クリップボードは1枚しか持てないため複数は不可）。実体＝`dragstart` を `preventDefault` して main の `webContents.startDrag`（`drag-out`＝invoke でなく send＝ドラッグは同期開始が必須）／`clipboard.writeImage`（`copy-image`）。ファイル名→実パスの解決とベースネーム検証は `app/src/main/library-files.ts` が単一所有（欠損ファイルは除外＝Windows は不在パスを1つ混ぜるとドラッグ全体が失敗する／svg 等 nativeImage が読めない形式は false を返し**クリップボードを空で上書きしない**）
- **コマンドパレット `Ctrl/Cmd+K`**（#28・[ADR 0016](decisions/0016-one-candidate-engine-three-faces.md)）＝操作（設定・新規タブ・タブ切替・フィルタ全解除・表示切替）とジャンプ（タグ・投稿者・フォルダ）を1つの入力から引く。候補の供給源は `services/command-registry.ts` の1本で、検索ボックス直下のサジェストも同じレジストリから引く（面ごとに違うのは見せるセクションと件数、そして確定したときの動作だけ）。エントリの中身と perform クロージャは `services/command-builder.ts`、器は `palette/CommandPalette.tsx`（shadcn Dialog ＋ Base UI Autocomplete の `inline`）。`/` は検索ボックスへのフォーカスで、Ctrl+K とは役割が分かれている。見える入口はサイドバーのフッター項目と検索ボックス右端の `Ctrl+K` バッジの2つ
- 言語切替（auto/ja/en）
- エクスポート: ZIP（画像+JSON）／インポート: ZIP から復元
- 指定フォルダへの定期バックアップ（増分ミラー・`Hologram-mirror`・間隔スケジュール可・起動時の遅れ取り戻し）

## i18n

アプリ（`app/src/renderer/src/services/i18n.ts`）は config.json の `language` で制御（auto/ja/en）。content.ts のバナーは拡張側 `i18n.ts` で日英対応（auto はブラウザ言語に追従）。
