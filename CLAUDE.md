# Corpus

SNS投稿（X / Bluesky / Misskey）をJPEG画像としてキャプチャするChrome拡張（Manifest V3）と、保存・閲覧を担うデスクトップアプリ（Electron）。

> **【厳守】ユーザーに見える文章はすべて日本語**（最終応答 ＋ ツール呼び出し前の一文＝プログレス narration を含む）。コードのコメントやツールの `description` フィールドは英語のままで可。これは何度も指摘されているので、ツールを連打している最中でも必ず日本語で書くこと。

> **アーキテクチャ移行中**: EXIF と chrome.storage への保存を廃止し、**ユーザーが選んだ保存先フォルダに `<captureId>.jpg`（純JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）を書き出す方式**へ移行中。キャプチャ→保存は Native Messaging ブリッジ経由（拡張・アプリ未起動でも動作）。閲覧は Electron アプリ。
> - **Phase 1（完了）**: 拡張をキャプチャ専用化（EXIF/storage廃止 → Native Messaging送信）、ブリッジ（`native-host/`）、最小 Electron ビューア（`app/`）。
> - **Phase 2（完了）**: ビューア全機能を Electron（`app/renderer/`）へ移植、拡張内ビューア（`viewer.html/js`）と `vendor/` を撤去、`options_ui`/`open-viewer` 削除、ドキュメント/ストア説明を更新。
> - **残（任意）**: 配布パッケージング（electron-builder 設定済み・下記「アプリのビルド/配布」参照）、スクリーンショット/デモ差し替え。
> 詳細プラン: `~/.claude/plans/playful-kindling-duckling.md`

## 対応プラットフォーム

- X (Twitter)
- Bluesky
- Misskey
- Mastodon
- pixiv

## 構成

- `extension/` — Chrome拡張一式（MV3。**以前はリポジトリ直下だったが `extension/` 配下へ移動済み**）:
  - `manifest.json` — 権限（`nativeMessaging` / host_permissions: `cdn.syndication.twimg.com` ＋ pixiv）、ショートカット `Alt+S`、`default_locale`/`_locales`
  - `background.js` — Service Worker。タブキャプチャ → クロップ → `metadata.js` でAPI取得 → Native Messaging 送信。**クリック保存** と **画像ドラッグ保存**(`drag.js`) の2経路（`pickPrimaryImage` で原寸を選択）。EXIF/storage廃止・DOMスクレイピング廃止＝安定API由来のみ
  - `content.js` — 投稿選択UI・要素特定・パーマリンク抽出・クロップ（メタのDOM抽出は廃止しAPIへ）
  - `drag.js` — 画像のドラッグ保存（投稿の原寸画像を直接保存）
  - `metadata.js` — 投稿URLから X（syndication JSON・非公式）/ Bluesky（`public.api.bsky.app`）/ Misskey（`/api/notes/show`）/ Mastodon（`/api/v1/statuses/:id`）/ **pixiv** でメタ取得・正規化。**失敗時は空レコードを返す（throwしない）**。node でもテスト可。Xはリポスト/ブックマーク/閲覧数を含まない
  - `i18n.js` — content.js のバナー用 i18n（拡張側のみ。アプリは `app/renderer/i18n.js`）
  - `_locales/`（en/ja）、`icons/`
- `native-host/` — Native Messaging ブリッジ。`bridge.js`（保存先に jpg+サイドカーを書き込み専用で生成。サイドカーの `media[]`（API由来の原寸URL）を**ベストエフォートでDLし `<id>-media-N.<ext>` に保存**＝静止画のみ・https限定・25MB/12s/12件上限・失敗時dropで保存自体は失敗させない）、`install.js`（ホスト登録）、`paths.js`（共有configパス）
- `app/` — Electron デスクトップアプリ。`main.js`/`preload.js`/`renderer/`（`index.html`・`viewer.js`・`i18n.js`）、`vendor/jszip.min.js`。サイドカー走査で閲覧、保存先選択・拡張ID設定・ホスト自動登録。画像は `psimg://` プロトコルで遅延読込
- `scripts/` — `inject-dummy.js`（保存先に jpg+サイドカー生成）、`verify-store.py`（サイドカーをAPI照合）、`backfill-metadata.js`（保存先の欠損メタを保存URLから再取得）、`test-metadata.js`（メタデータAPI取得の実地検証）、`test-mastodon-url.js`（Mastodonの非Mastodon由来canonical URLフォールバックの単体テスト＝モックfetch）、`test-bridge.js`/`test-media.js`/`test-app-render.js`/`test-app-ipc.js`/`test-app-hashtags.js`/`test-app-watch.js`/`test-app-media.js`/`test-app-users.js`/`test-app-instances.js`（ブリッジ/原寸メディアDL/アプリ/IPC/ハッシュタグ/自動更新/原寸メディア表示/ユーザータブ/インスタンスフィルタのスモークテスト）、`make-icons.js`（アイコン生成）

## キーボードショートカット

- `Alt+S` — キャプチャモード開始

> 旧 `Alt+R`（拡張リロード・開発用）はストア版整理で撤去。旧 `Alt+V`（ビューアを開く）は Phase 2 で廃止。ビューアは独立した Electron アプリに分離したため、拡張側のショートカットは `Alt+S` のみ。

## アプリのビルド/配布

- 開発実行: `cd app && npm install && npm start`
- **開発ルール**: アプリのコード変更を反映するときは、確認を取らずにアプリを再起動して反映する（単一インスタンスのため `Get-Process electron | Where Path -like '*corpus*' | Stop-Process -Force` で停止 → 起動し直す）。
- 配布物生成: `cd app && npm run dist`（electron-builder, win/nsis）
  - 出力 `app/dist/win-unpacked/` — スタンドアロン。`Corpus.exe` を直接実行可。ASCIIパスへ置けば native-host のランチャもASCIIになり日本語パス問題が解消。
  - **NSIS ワンクリックインストーラ** は winCodeSign 展開時に **symlink 作成権限** が要る。**Windows 設定 → 開発者向け → 開発者モード を ON**（または管理者で実行）してから `npm run dist` で `Corpus Setup x.x.x.exe` が生成される。OFF だと winCodeSign 展開が失敗し `win-unpacked` のみになる（macOS用 dylib symlink でこける／コードの問題ではない）。
  - `native-host/` は `extraResources` で `resources/native-host` に同梱。`app/main.js` が `app.isPackaged` でパス解決（dev=`../native-host`）。
  - アイコンは `scripts/make-icons.js`（256px基準で `icons/icon{16,32,48,128,256}.png` 生成。win ビルドは `icon256.png`）。

## ビューア機能

- プラットフォームフィルタ（チップボタン）
- インスタンス/サーバーフィルタ（Misskey / Mastodon 選択時にサイドバーへサーバー一覧を展開、URLのホストで絞り込み。プラットフォーム解除で孤立したinstanceフィルタは自動整理）
- 保存先フォルダの自動監視（新規キャプチャ等で一覧を自動更新。main の `fs.watch`→`posts-changed` IPC）
- ハッシュタグ一覧タブ（本文の #タグ を抽出・頻度順表示、クリックで絞り込み。タブ内に絞り込み入力）
- ユーザー一覧タブ（Phase 1: サイドカーの著者情報を `platform:userId` でグルーピング。投稿数順表示・検索・プラットフォームフィルタ、クリックで投稿タブを `user` フィルタで絞り込み。追加のAPI取得なし。Phase 2 のフォロー数/作成日付与は未実装）
- 添付画像の原寸表示（🔍ボタンでスクショ＋原寸を1つに束ねたギャラリーを開く＝prev/next・矢印キー・カウンタ。原寸はページ送りで閲覧）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- カード/リスト表示切替（config保存）
- 投稿の個別削除・一括削除（確認スキップ可）
- 言語切替（auto/ja/en）
- 保存先フォルダの選択
- エクスポート: ZIP（画像+JSON）、HTML（検索UI付き）
- インポート: エクスポートHTMLから復元

## i18n

アプリ（`app/renderer/i18n.js`）は config.json の `language` で制御（auto/ja/en）。content.js のバナーは拡張側 `i18n.js` で日英対応（auto はブラウザ言語に追従）。

## テスト

- テストケース定義: `scripts/test-plan.md`
- テスト進捗記録: `scripts/test-progress.md`

### 手順（キャプチャテスト）

1. claude が in chrome でテスト対象ページを開く
2. ユーザーが Alt+S → 投稿クリック
3. claude が検証: 保存先フォルダの `<id>.jpg`+`<id>.json` 生成を確認し、`python scripts/verify-store.py --recent N` でAPI照合
4. 結果を `scripts/test-progress.md` に記録
5. 次のテストケースに進む

### 注意

- テスト済みのケースを再テストしない（`test-progress.md` を必ず確認）
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）

## TODO (リリース前)

- [x] ストア版ビルド: 開発用コードを除去する（完了 — `reload-extension` コマンド/onCommand分岐、`buildHash`/`getBuildHash`、`getBuildHash` のDOM埋め込み[content.js]、`cmdReloadExtension`/`cmdOpenViewer` ロケール、`scripts/check-reload.py` を撤去。`writeCaptureLog()`・拡張内ビューア・`debugSection` も撤去済み）

## TODO (将来対応)

- [x] デスクトップアプリ（Electron + Native Messaging）— Phase 1/2 完了（上部「アーキテクチャ移行」参照）
  - [x] 拡張をキャプチャ専用化（Native Messaging送信）
  - [x] メタデータはサイドカーJSON（SQLite不採用：Electronでのネイティブ依存回避）+ ファイルシステムに画像保存
  - [x] ビューア全機能の Electron 移植（検索・フィルタ・ソート・タグ編集・削除・エクスポート/インポート）
  - [ ] 配布パッケージング（electron-builder 等）
  - [x] 添付画像の原寸保存・表示（静止画。metadata.js が `media[]`（原寸URL）抽出 → bridge が DL して `<id>-media-N.<ext>` 保存 → ビューアで🔍ボタンからギャラリー表示（スクショ＋原寸を1つに束ねる）。動画/GIFは対象外、新規キャプチャのみ。検証: `scripts/test-media.js`/`test-app-media.js`、`test-metadata.js` の media アサーション）
- [x] ビューア: ハッシュタグ一覧画面（保存済み投稿の text から #タグ を抽出して一覧表示）
- [x] ビューア: Misskey インスタンス指定フィルタ（Misskey チップを押すとインスタンス一覧が展開）
- [x] Mastodon 対応（公開REST API `/api/v1/statuses/:id`＝**安定API方針に合致**。metadata.js に追加、content.js は標準Web UIの投稿特定＋URL抽出のみ。CORSは Origin付きで `*`）

> **不採用: Threads** — 安定した公開APIが無く DOM依存のため、「安定API由来のみ」方針に反するので対応しない（決定済み）。
> **データ取得方針**: メタデータは安定した公式/公開APIからのみ取得し、DOMスクレイピングはしない（壊れやすいため）。content.js は投稿の特定とパーマリンク抽出だけ。X は公式APIが無く `cdn.syndication.twimg.com`（非公式・要host_permissions）で代替（リポスト/ブックマーク/閲覧数は取得不可）。
