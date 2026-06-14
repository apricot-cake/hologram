# Corpus

SNS投稿（X / Bluesky / Misskey / Mastodon / pixiv）をJPEG画像としてキャプチャするChrome拡張（Manifest V3）と、保存・閲覧を担うデスクトップアプリ（Electron）。

> **【厳守】ユーザーに見える文章はすべて日本語**（最終応答 ＋ ツール前後の経過説明＝ナレーション）。コードのコメントやツールの `description` は英語のままで可。何度も指摘されているので、ツール連打中でも必ず日本語で書くこと。
> - ナレーション（ツール前後の一文）は加えて**平易に・固有名詞（ファイル名・コマンド名・操作名・API 名）を省略しない**（「設定ファイル」ではなく `config.json`、「レジストリ操作」ではなく `reg add`）。「平易」は語選びを分かりやすくの意で、説明を増やすことではない。分かりにくい用語は短い言い換えを任意で添えてよい。

> **UI 変更時は `DESIGN.md`（デザイン言語）に従うこと**。形＝意味の対応（ピル=値/角丸四角=操作）、**モノトーン基調＋機能アクセント一点**（アクティブ表示は accent tint を撤回しグレーのコントラストへ・ソリッド塗りも禁止・アクセントはインディゴ淡）、23px テキスト軸、22px/6–8px の余白リズム、モーション規約、却下済みデザイン一覧を定義している。新しい見た目・操作を追加する前に必ず参照。

> **【バックログ運用】未完了・先送りの依頼は必ず
> `~/.claude/projects/C--Users-apricot---------corpus/memory/corpus-tasks.md` へ追記する**
> （話題に出たら都度／別タスクに移る前に）。これが**唯一の永続トラッカー**＝忘れると次セッションで
> 蒸発するので厳守。完了したら ✅ か削除で反映。ユーザーが「次」等で未指定なら**バックログの軽い
> ものから消化**。（旧「アクティブ運用ルール」＝`corpus-active.md` は高速反復中に形骸化したため
> 廃止＝2026-06-13。アクティブな作業状態は会話＋ハーネスのタスク一覧で足りる。）

> **【Git運用】push は確認なし・高頻度で**。コミットしたら（または論理的な区切りごとに）
> そのまま `git push` まで実行し、「push しますか？」と確認しない（private リポ・ソロ運用＝
> ユーザー durable 認可 2026-06-13）。複数コミットを溜め込まず小まめに push。
> ただし WIP/壊れた状態は push しない（動く区切りで）。commit メッセージは従来どおり日本語。

> **アーキテクチャ**: キャプチャは拡張（タブキャプチャ＋API由来メタ）→ **Native Messaging ブリッジ**（`native-host/`・拡張/アプリ未起動でも動作）→ **保存先フォルダ（既定 `%LOCALAPPDATA%\Corpus\library`・固定＝保存先選択UIは廃止済み）に `<captureId>.jpg`（純JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）を書き出す**（EXIF/chrome.storage は不使用）。閲覧は Electron アプリ（`app/`）がサイドカーを走査。旧・拡張内ビューアと EXIF/storage 方式は撤去済み。残（任意）: 配布パッケージング（下記「アプリのビルド/配布」）。

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
  - `metadata.js` — 投稿URLから X（syndication JSON・非公式）/ Bluesky（`public.api.bsky.app`）/ Misskey（`/api/notes/show`）/ Mastodon（`/api/v1/statuses/:id`）/ **pixiv** でメタ取得・正規化。**失敗時は空レコードを返す（throwしない）**。node でもテスト可。Xはリポスト/ブックマーク/閲覧数を含まない。`fetchPostMetadata(url, {expectedHost})` で Misskey/Mastodon（hostが投稿URL由来＝任意）の API fetch を sender tab の host に固定（SSRF防御。X/Bluesky/pixiv は固定hostなので無関係）
  - `i18n.js` — content.js のバナー用 i18n（拡張側のみ。アプリは `app/renderer/i18n.js`）
  - `_locales/`（en/ja）、`icons/`
- `native-host/` — Native Messaging ブリッジ。`bridge.js`（保存先に jpg+サイドカーを書き込み専用で生成。サイドカーの `media[]`（API由来の原寸URL）を**ベストエフォートでDLし `<id>-media-N.<ext>` に保存**＝静止画のみ・https限定・25MB/12s/12件上限・失敗時dropで保存自体は失敗させない）、`install.js`（ホスト登録）、`paths.js`（共有configパス）
- `app/` — Electron デスクトップアプリ。`main.js`/`preload.js`/`renderer/`（`index.html`・`viewer.js`・`i18n.js`）、`lib-archive.js`（ZIP入出力）、`lib-index.js`（保存先サイドカーの index＝filename+mtimeMs で記録をキャッシュ。`listPosts` を非同期・O(changed) 化し `.index.json` スナップショットで起動も高速化。更新は差分IPC（list-posts-delta）＋fs.watch の変更ファイル名ヒントで対象サイドカーだけ再走査（applyChanges）＝実測 ~1ms。Electron非依存＝node でテスト可）、`vendor/jszip.min.js`。サイドカー走査で閲覧、拡張ID設定・ホスト自動登録、指定フォルダへの定期バックアップ（増分ミラー・`Corpus-mirror`）。画像は `psimg://` プロトコルで遅延読込。**保存先選択UIは廃止（既定 `%LOCALAPPDATA%\Corpus\library` 固定）＝`saveFolderTitle`/`hintSaveFolder`/`pick-save-folder` は死にコードとして残存（掃除候補）**
- `scripts/` — `inject-dummy.js`（保存先に jpg+サイドカー生成）、`verify-store.py`（サイドカーをAPI照合）、`test-select-posts.js`（テスト対象投稿を公開APIから自動選別→セッションシート出力）、`test-watch-verify.js`（保存先を監視し新規キャプチャをAPI再照合・`--recent N` で一括点検）、`e2e-capture-test.js`（puppeteerで拡張入りChromeを一時起動し、SWの`activateOnTab`直叩き＋クリック/ドラッグでキャプチャを全自動実行→ブリッジ保存→API照合→後始末。pixiv対応済み。ユーザーのChrome・Alt+S不要。`<all_urls>`を足した拡張コピーをロードして captureVisibleTab の activeTab 要件を満たす）、`backfill-metadata.js`（保存先の欠損メタを保存URLから再取得）、`test-metadata.js`（メタデータAPI取得の実地検証）、`test-mastodon-url.js`（Mastodonの非Mastodon由来canonical URLフォールバックの単体テスト＝モックfetch）、`test-bridge.js`/`test-media.js`/`test-app-render.js`/`test-app-ipc.js`/`test-app-hashtags.js`/`test-app-watch.js`/`test-app-media.js`/`test-app-users.js`/`test-app-instances.js`（ブリッジ/原寸メディアDL/アプリ/IPC/ハッシュタグ/自動更新/原寸メディア表示/ユーザータブ/インスタンスフィルタのスモークテスト）、`test-archive-zipslip.js`（import ZIP の Zip-Slip 退行テスト＝バックスラッシュ/`..`/絶対パスのエントリが save folder 外へ書き込まれないことを検証）、`test-bridge-ssrf.js`（bridge の `fetchStillImage` の SSRF/サイズ上限ガード＝IPリテラルの private/予約・localhost系・private へのリダイレクトを fetch 前に拒否、上限超過 body をストリームで中断）、`test-metadata-origin.js`（`fetchPostMetadata` の `expectedHost` 制約＝Misskey/Mastodon のインスタンスhost が sender tab と不一致なら fetch せず空レコード／一致時と固定hostの X は通す）、`test-metadata-correctness.js`（メタ正しさ3件＝X引用の screen_name 欠落時に `.../undefined/` を作らない／Bluesky の引用判定を feed.post 埋込限定＝リスト/フィード/スターターパック埋込を除外／Misskey の `rec.url` を bare permalink 化＝query/hash 除去）、`test-index.js`（`lib-index.js` の O(changed) 再利用・削除prune・`.index.json` スナップショットからの cold 復元を read計数で検証）、`make-icons.js`（アイコン生成）

## キーボードショートカット

- `Alt+S` — キャプチャモード開始

> 旧 `Alt+R`（拡張リロード・開発用）はストア版整理で撤去。旧 `Alt+V`（ビューアを開く）はビューアの Electron アプリ分離時に廃止。拡張側のショートカットは `Alt+S` のみ。

## アプリのビルド/配布

- 開発実行: `cd app && npm install && npm start`
- **開発ルール**: アプリのコード変更を反映するときは、確認を取らずにアプリを再起動して反映する。停止: `try { Get-Process electron -ErrorAction Stop | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force -Confirm:$false } catch {}`。起動: `Start-Process -FilePath "C:\Users\apricot\ローカル\開発\corpus\app\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "C:\Users\apricot\ローカル\開発\corpus\app"`（**`npm start` 経由は cmd ウィンドウが出るため使わない**。electron.exe はGUIアプリなので `-WindowStyle Hidden` 不要・コンソールが一切出ない）。
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
- ユーザー一覧タブ（サイドカーの著者情報を `platform:userId` でグルーピング。投稿数順表示・検索・プラットフォームフィルタ、クリックで投稿タブを `user` フィルタで絞り込み。追加のAPI取得なし。フォロー数/作成日の付与は未実装）
- 添付画像の原寸表示（🔍ボタンでスクショ＋原寸を1つに束ねたギャラリーを開く＝prev/next・矢印キー・カウンタ。原寸はページ送りで閲覧）
- 日付範囲フィルタ（from/to）
- エンゲージメントフィルタ（種類選択+最低値）
- カード/リスト表示切替（config保存）
- 投稿の個別削除・一括削除（確認スキップ可）
- カード右クリックの操作メニュー（開く/タグ編集/フォルダに追加/ワークスペース/詳細/削除。ホバーは⚡ワークスペースとℹ詳細の2個だけ）
- 言語切替（auto/ja/en）
- エクスポート: ZIP（画像+JSON）／インポート: ZIP から復元（**HTML エクスポート/インポートは撤去済み**）
- 指定フォルダへの定期バックアップ（増分ミラー・`Corpus-mirror`・間隔スケジュール可・起動時の遅れ取り戻し）
- ロゴ／ブランド・アクセント（インディゴ淡）・二段構え表記などは `DESIGN.md` の「ブランド／ロゴ」「色」節を参照

## i18n

アプリ（`app/renderer/i18n.js`）は config.json の `language` で制御（auto/ja/en）。content.js のバナーは拡張側 `i18n.js` で日英対応（auto はブラウザ言語に追従）。

## テスト

- テストケース定義: `scripts/test-plan.md`
- テスト進捗記録: `scripts/test-progress.md`

### 手順（キャプチャテスト・半自動フロー）

1. `node scripts/test-select-posts.js` — テスト対象投稿を公開APIから自動選別（セルごとのURL・アクション・期待値のシートを出力）
2. `node scripts/test-watch-verify.js` — 保存先フォルダの監視を開始（キャプチャごとにAPI再照合し PASS/FAIL ＋ test-progress 用の行を自動出力）
3. claude が in chrome でシートのURLを開く → ユーザーが Alt+S → クリック（またはドラッグ）
4. watcher の出力行を `scripts/test-progress.md` に記録
5. 次のセルに進む（過去分の一括点検は `node scripts/test-watch-verify.js --recent N`）

### 注意

- テスト済みのケースを再テストしない（`test-progress.md` を必ず確認）
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）

## 残タスク

- [ ] 配布パッケージング（electron-builder, win/nsis。設定済み＝「アプリのビルド/配布」参照。リリース準備一式の決定はメモリ `corpus-release-prep` に詳細）。

（Electron移行・サイドカー保存・原寸メディアDL/表示・ハッシュタグ/インスタンス/ユーザー一覧タブ・Mastodon対応は実装済み＝「構成」「ビューア機能」を参照。ユーザー一覧タブのフォロー数/作成日付与は未実装。）

## データ取得方針・不採用

> **データ取得方針**: メタデータは安定した公式/公開APIからのみ取得し、DOMスクレイピングはしない（壊れやすいため）。content.js は投稿の特定とパーマリンク抽出だけ。X は公式APIが無く `cdn.syndication.twimg.com`（非公式・要host_permissions）で代替（リポスト/ブックマーク/閲覧数は取得不可）。
> **不採用: Threads** — 安定した公開APIが無く DOM依存のため、「安定API由来のみ」方針に反するので対応しない（決定済み）。
