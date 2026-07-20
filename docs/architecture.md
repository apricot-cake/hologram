# Hologram アーキテクチャ・構成

> CLAUDE.md のスリム化に伴い、ファイル別の詳細構成・実装メモをここへ集約（2026-06-17）。CLAUDE.md 側は要約とこのファイルへのリンクのみ。

## 射程の原則（#190 で確定・2026-07-20 名乗り改訂）

Hologram の名乗りは「**ウェブのコンテンツを、出自・エンゲージメントごと保存できる個人ライブラリ**」。一級性は SNS に限らず、プラットフォームに投稿されたコンテンツ全般に及ぶ（改訂の経緯・根拠は #190 コメント）。この汎用側の選択は必然ではなく設計判断＝主要プラットフォーム対応に絞る特化も成立する却下案として #190 に記録済み。個別機能の採否は次の概念モデルで判定する。

### 概念モデル

1. **境界＝キュレーション**: 何がライブラリに入るかはユーザーの収蔵行為が決める。ファイル形式や出自で「コンテンツか否か」を判別しない。
2. **メタデータ＝勾配**: 出自があれば取得時に自動で濃く付き（プラットフォーム投稿＝投稿者・本文・日時・エンゲージメント）、無ければタグ・フォルダが受け持つ（ローカルファイル）。恩恵の差であって身分の差ではない。
3. **表示＝能力の階級**: メディア（画像・動画）はビューア・サムネイル込みのフル体験、描画できない任意ファイル（PDF・配布資料等）は「収蔵品」＝保存・タグ・フォルダ・ファイル名検索・OS 既定アプリで開く＋安価なプレビューまで（#236）。提示能力の差であって価値の宣言ではない。
4. **取込の深さだけを倫理で縛る**（取込の3段構造・2026-07-18 確定）:
   1. **フロー型のプラットフォーム投稿＝丸ごと保存**（SNS 投稿が代表）: 流れて消えるコンテンツ。保存の正当性（消失前の記録）が強く、市場代替の害が小さい。
   2. **ローカルファイル＝実体保存**: ローカル取込・要素キャプチャ等。表示は上記3の2階級で受ける。
   3. **その他あらゆる URL＝カード保存**: ストック型（プラットフォームに据え置かれ再訪される）コンテンツ。丸ごと保存はプラットフォームの客足・投稿者の engagement を代替するため、公式に許された上限形＝OGP カード（タイトル・説明文・サムネ）＋ユーザー注釈（タグ・メモ）まで（#195）。**公式の埋め込みが提供されているものは公式埋め込みで受ける**（#196・動画に限らない＝埋め込みの提供自体が「客足と収益がプラットフォーム側に残る形」の公式な用意である）。実体はプラットフォームに残し、閲覧はリンク先で行う。深さの制限は実体（バイト）の話であり、カードにも出自メタデータは取れる範囲で付す。

テキスト主役コンテンツ（記事・小説）専用の UI（リーダー・本文抽出）は射程外。訴求は**範囲を見出しにせず、能力を見出しにする**＝「なんでも入る」は機能リストの一行に置き、鋭さは具体例の層（作者・本文ごとのファンアート保存、再生リストごとの動画保存、購入コンテンツへの出自付与）が担う。

## 全体フロー

キャプチャは拡張（タブキャプチャ＋API由来メタ）→ **Native Messaging ブリッジ**（`native-host/`・拡張/アプリ未起動でも動作）→ **保存先フォルダ（既定 `~/Hologram/library`・変更可）に `<captureId>.jpg`（純JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）を書き出す**。閲覧は Electron アプリ（`app/`）がサイドカーを走査。旧・拡張内ビューアと EXIF/storage 方式は撤去済み。配布パッケージングの手順は `docs/build.md`。

## 構成

### `extension/` — Chrome拡張一式（MV3）

TypeScript ソース（`.ts`）。ブラウザは TypeScript を直接実行できない唯一のレイヤーなので、`npm run build`（`extension/build.mjs`＝tsc コンパイル＋静的資産コピー）で `extension/dist/` へビルドし、**`extension/dist/` を Load unpacked する**（`extension/` 直下ではない）。`manifest.json` に固定 `key` があるため拡張機能IDはロード元フォルダに依存しない（メモリ `ext-signing-key`）。

- `manifest.json` — 権限（`activeTab`/`scripting`/`nativeMessaging`/`storage` / host_permissions: `cdn.syndication.twimg.com` ＋ pixiv）、content_scripts（`i18n.js`/`glass-ui.js`/`drag.js`＝X/Bluesky/pixiv・document_idle）、`options_ui`（タブで開く）、ショートカット `Alt+S`、`default_locale`/`_locales`
- `background.ts` — Service Worker。タブキャプチャ → クロップ → `metadata.ts` でAPI取得 → Native Messaging 送信。**クリック保存** と **画像ドラッグ保存**(`drag.ts`) の2経路（`pickPrimaryImage` で原寸を選択）。
- `content.ts` — 投稿選択UI・クロップ（キャプチャセッションの IIFE）
- `site-detect.ts` — プラットフォーム検出・投稿要素特定・permalink/rect 抽出（content.ts から分離した副作用なし関数群＝Node+jsdom で単体テスト可・`test-content-fixtures.cts`）
- `drag.ts` — 画像のドラッグ保存（投稿の原寸画像を直接保存）
- `glass-ui.ts` — ページ内UI（キャプチャバナー・ドラッグのドロップゾーン）共通の見た目基盤＝アプリのフローティング面マテリアル/モーション語彙をホストページ用に再構築
- `metadata.ts` — 投稿URLから X（syndication JSON・非公式）/ Bluesky（`public.api.bsky.app`）/ Misskey（`/api/notes/show`）/ Mastodon（`/api/v1/statuses/:id`）/ **pixiv** でメタ取得・正規化。**失敗時は空レコードを返す（throwしない）**。dual export（`module.exports`）＝ビルド後の `dist/metadata.js` を node からも require 可（`scripts/backfill-metadata.cts` 等）。Xはリポスト/ブックマーク/閲覧数を含まない。`fetchPostMetadata(url, {expectedHost})` で Misskey/Mastodon（hostが投稿URL由来＝任意）の API fetch を sender tab の host に固定（SSRF防御。X/Bluesky/pixiv は固定hostなので無関係）
- `i18n.ts` — content.ts のバナー用 i18n（拡張側のみ。アプリは `app/renderer/i18n.ts`）
- `options.ts`/`options.html` — 設定ページ（manifest `options_ui`・タブで開く＝拡張設定の一本化先）
- `diag.ts`/`diag.html` — 内部診断ページ（ホスト不達時に chrome.storage へ退避したイベントの読み出し等・キャプチャフロー外）
- `_locales/`（en/ja）、`icons/`

### `native-host/` — Native Messaging ブリッジ

全ファイル `.cts`（Node 型消去で無ビルド実行・CJS維持＝`bridge.cts` は生ソースを `~/.hologram` へコピー実行するため）。

- `bridge.cts` — 保存先に jpg+サイドカーを書き込み専用で生成。サイドカーの `media[]`（API由来の原寸URL）と著者アバターを**ベストエフォートでDL**し `<id>-media-N.<ext>` / `<id>-avatar.<ext>` に保存
- `media-download.cts` — **静止画DLの共有モジュール**（SSRFガード・25MB/12s/12件上限・https限定・手動リダイレクト・失敗時dropで保存を失敗させない）。`fetchStillImage`/`downloadMedia`/`downloadAvatar`/`pixivRefererFor` を export し、bridge・app(`import-posts`)・`backfill-metadata.cts` で同一ロジックを共有（ガードが経路ごとにズレないように一箇所へ集約）
- `install.cts` — ホスト登録
- `paths.cts` — 共有configパス
- `config-recovery.cts` — 保存先復旧・破壊操作ゲート判定（純関数）

### `app/` — Electron デスクトップアプリ

メインプロセスは`.mts`直実行（`main.mts`＋`ipc-{backup,config,organize,posts,transfer,trash,window}.mts`＋`lib-*.mts`＝Node型消去・無ビルド）。preloadのみビルドを経る＝ソースは`preload.cts`で、`islands/build.mjs`（Vite lib CJS）が`preload.js`へビルド（サンドボックスpreloadローダーが型ストリップ非対応という技術的制約・`tsconfig.main.json`に明記）。公開APIの型は`preload.cts`が実装から`HologramPreload`としてexportし、rendererはそれを型エイリアスで参照（手書き型ミラーなし・Issue #17）。

- `main.mts` — メインプロセス（ウィンドウ生成・`fs.watch`・IPC登録）
- `lib-archive.mts` — ZIP入出力
- `lib-index.mts` — 保存先サイドカーの index＝filename+mtimeMs で記録をキャッシュ。`listPosts` を非同期・O(changed) 化し `.index.json` スナップショットで起動も高速化。更新は差分IPC（list-posts-delta）＋fs.watch の変更ファイル名ヒントで対象サイドカーだけ再走査（applyChanges）＝実測 ~1ms。Electron非依存＝node でテスト可
- `renderer/`（`index.html`・`.ts`群＝`orchestrator.ts`（2026-07-11に`viewer.ts`から改名。boot orchestration層として意図的に独立モジュールのまま残す設計）が状態/オーケストレーション/IPC呼び出しの中核、`store.ts`ほか単機能サービス（`tags.ts`/`selection.ts`/`query.ts`/`records.ts`等）に段階抽出済み・`design-tokens.css`）。描画自体は下記`islands/`のReactコンポーネントが100%所有し、島は`store.ts`をESM importで直接購読して連携（push型のモデル注入・`window.hologramXxx`ブリッジは全廃済み＝Window拡張はpreloadの`window.hologram`のみ）
- `islands/` — React（`.tsx`）コンポーネント群。`islands/build.mjs`（Vite lib-IIFE）で単一バンドル`renderer/islands/app.js`へビルド（React本体・JSZipもこのバンドルへ直接取り込み・`theme.ts`のみ`<script>`直読み・pre-paint実行の制約で別バンドル`renderer/theme.js`）
- 機能: サイドカー走査で閲覧、拡張ID設定・ホスト自動登録、指定フォルダへの定期バックアップ（増分ミラー・`Hologram-mirror`）。画像は `asset://` プロトコルで遅延読込。

## ビューア機能（内部実装メモ）

> ユーザー向けの機能説明は `README.md` を参照。ここは実装に紐づく注記のみ。

- プラットフォームフィルタ（チップボタン）
- インスタンス/サーバーフィルタ（Misskey / Mastodon 選択時にサイドバーへサーバー一覧を展開、URLのホストで絞り込み。プラットフォーム解除で孤立したinstanceフィルタは自動整理）
- 保存先フォルダの自動監視（新規キャプチャ等で一覧を自動更新。main の `fs.watch`→`posts-changed` IPC）
- ハッシュタグ一覧タブ（本文の #タグ を抽出・頻度順表示、クリックで絞り込み。タブ内に絞り込み入力）
- 投稿者ビュー（サイドバー先頭の「ライブラリ / 投稿者」モード切替トグルで投稿グリッド⇄投稿者グリッドを切替＝`browseMode`・起動時に前回モードを復元・前例 Bluesky/Xのプロフィールタブ）。投稿者カードはサイドカーの著者情報を `buildUsers()` が `platform:userId` でグルーピングして導出（追加のAPI取得なし）＝アバター（`avatarFile`・無ければモノグラム）＋投稿者名＋@ユーザー名＋PFドット＋投稿数、投稿数順ソート。カードのホバーはライブラリと同じ3ボタン＝🏷タグ編集（インスペクタのタグ欄へ）・📎クリップ追加（`posterWorkspace` トグル・in でアクセントドット）・ℹインスペクタ。**クリック=インスペクタ**（投稿者プロフィール＝アバター/名前/PF/投稿数、フォロワー/登録日は公開APIに有れば＋**最近の作品サムネ6枚**＝その投稿者の投稿を `groupRecords` で新しい順にグループ化しリード画像を表示、サムネクリックでギャラリー）、**ダブルクリック=投稿モードでその投稿者の `user` フィルタ**。検索ボックスは投稿者名/@で絞り込み（名前もハンドルも無いレコードは投稿者グリッドから除外）。投稿者モードはサイドバーをライブラリと同じ**「行＋フライアウト」方式**（`#posterFilterRows`）に切替＝プラットフォーム/タグ/作品/キャラ/インスタンス/日付/フォルダ/クリップの各行＋件数バッジ（作品/キャラ/タグ/インスタンス行は該当値があるときだけ咲く＝段階的開示）＋並び順(投稿数/名前)＋**レイアウト切替(card/tile/list・タイルはアバター主役の正方＝`posterView`)**＋検索。**日付コントロールは並び替えと範囲フィルタを一本化**＝1つの日付軸(`posterDate.dim`＝投稿日`latest`/取得日`lastCapture`/作成日`authorCreatedAt`、buildUsers が集計) に対し、並び(`dir`＝新しい/古い/なし・なし以外は投稿数/名前 select を上書き)と期間(from/to)を同じポップで指定。絞り込みは投稿側 `activeFilters` に介入せず transient な `posterXxx` 状態（`qfValues`/`renderQfPop`/qfPop クリックに `poster-*` カテゴリを追加・`filteredPosters` で AND 合成）。**名前付きフォルダ**＝投稿者を複数の名前付きフォルダに整理。サイドバーのフォルダ行→フライアウトで絞り込み・管理は `#ivFolderModal` を共用（作成/リネーム/削除/D&D＝`folders.ts` の `openManager({store,onChange})` で対象ストアを差し替え・モーダルUIの実体は React 島 `islands/folders/FolderManagerModal.tsx`）、割当はインスペクタのフォルダチップ＋カード右クリック。`poster-folders.json`（`{folders:[{id,name,items:[posterKey]}]}`・folders.jsonと同形＝import は既存 `mergeFolders` 再利用）。**クリップ**（UI名。ディスク上のフィールド名は旧称 `workspace`/`posterWorkspace` のまま）＝投稿者も放り込める（最小拡張）＝folders.json の `posterWorkspace` 別配列（captureId の workspace と別名前空間・`mergeFolders` 非移送）、追加はカードのホバー📎＋右クリック、サイドバーにクリップ行＋空にする、`filteredPosters` に述語。`get/set-poster-folders`・`get/set-poster-tags` IPC。各ファイルとも `INTERNAL_FILES`（fs.watch無視）/clear-all保持/ORG_MERGE に登録済み（お気に入り機能は削除したが `poster-favorites.json` は旧データ無視のため分類登録だけ残す）。横断制約＝poster-folders/tags/workspace/date 集計は全て集約キー `u.key`（=`userKey(p)`）経由＝将来の名寄せ1点改修と非衝突。**残**: 投稿者グリッドのアバターは既存ライブラリが未backfillだと出ない（新規キャプチャ/`backfill-metadata.cts --avatars` で順次）。SNS横断の名寄せ（同一人物の別PF統合）は未実装（Issue #23）。
- 添付画像の原寸表示（スクショ＋原寸を1つに束ねたギャラリーを開く＝prev/next・矢印キー・カウンタ。原寸はページ送りで閲覧）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- レイアウト切替（card/tile/list・config保存）
- 投稿の個別削除・一括削除（確認スキップ可）
- カード右クリックの操作メニュー（開く/新しいタブで開く/タグ編集/フォルダに追加/クリップに追加/この投稿者を見る/画像をコピー/ファイルの場所を開く/詳細/削除。ホバーは📎クリップ・ℹ詳細・🏷タグの3個）
- **他アプリへの送り出し**（#132）＝カード画像のドラッグアウト（Explorer・PureRef 等へ**原本ファイル**をドロップ。選択中のカードを掴めば選択全体・選択外を掴めばそのカードだけ。複数画像投稿は `g.files` 全部。**ドラッグは選択を読むだけで書き換えない**＝Explorer の「ドラッグで選択が変わる」は mousedown の副産物でドラッグ側の設計ではなく、Hologram の選択はスクロールをまたいで手で作る作業セット＝アプリ外へ出る操作で壊さない。規則の実体は `records.ts` の `dragFilesOf`＝純関数）＋**画像をコピー**（右クリックメニュー／選択1件時の `Ctrl+C`＝クリップボードは1枚しか持てないため複数は不可）。実体＝`dragstart` を `preventDefault` して main の `webContents.startDrag`（`drag-out`＝invoke でなく send＝ドラッグは同期開始が必須）／`clipboard.writeImage`（`copy-image`）。ファイル名→実パスの解決とベースネーム検証は `app/library-files.mts` が単一所有（欠損ファイルは除外＝Windows は不在パスを1つ混ぜるとドラッグ全体が失敗する／svg 等 nativeImage が読めない形式は false を返し**クリップボードを空で上書きしない**）
- 言語切替（auto/ja/en）
- エクスポート: ZIP（画像+JSON）／インポート: ZIP から復元
- 指定フォルダへの定期バックアップ（増分ミラー・`Hologram-mirror`・間隔スケジュール可・起動時の遅れ取り戻し）

## i18n

アプリ（`app/renderer/i18n.ts`）は config.json の `language` で制御（auto/ja/en）。content.ts のバナーは拡張側 `i18n.ts` で日英対応（auto はブラウザ言語に追従）。
