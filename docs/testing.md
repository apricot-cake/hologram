# Hologram スクリプト・テスト

## テストケース定義・進捗

- テストケース定義: `scripts/test-plan.md`（プラットフォーム × ページ種別の取得マトリクス）

## `scripts/` カタログ（俯瞰）

スクリプトの正本は `scripts/` 内の実ファイル（`node scripts/<name>.cts` で実行）。ここは逐一列挙でなく**種別の地図**に徹する＝何がどこにあるかだけ示し、各テストが具体的に何を検証するかは当該ファイル冒頭コメントを正本とする（網羅列挙は記載漏れで陳腐化するため置かない）。

### ユーティリティ

- `inject-dummy.cjs` — `dummy-` 始まりの条件網羅フィクスチャ（jpg＋サイドカー＋色付きアバター）を既定保存先に生成。常設の検証フィクスチャとして残してよい（下の「行動ルール」参照）。electron 直起動なので拡張子は `.cjs`（理由はファイル冒頭・下記 make-icons と同じ）
- `verify-store.py`（サイドカーをAPI照合）／`backfill-metadata.cts`（欠損メタを保存URLから再取得・`--all`＝アバターも・`--avatars`＝アバターのみ）／`make-icons.cjs`（`assets/icon-master.png` から全アイコンを再生成・手順は docs/build.md。electron 直起動のため `.cjs`＝`.cts` だと `require('electron')` が壊れる）

### キャプチャ／メタデータ検証

- 半自動フローの土台＝`test-select-posts.cts`（対象投稿の自動選別）→ `test-watch-verify.cts`（保存先監視＋API再照合・`--recent N` で一括点検）。`e2e-capture-test.cts` は WXT の本番出力を Playwright Chromium へ読み込む実サイトカナリア（ユーザーChrome・Alt+S 不要）。ブラウザE2Eの初回実行前にリポジトリ直下で `npx playwright install chromium` を実行する。`npm run test:e2e-extension` は固定fixture・モックAPI・一時Native Messagingホスト・一時ライブラリで `content → background → native-host → ファイル着地` をネットワークなしに確認する。API取得の単体は `test-metadata*.cts`／`test-mastodon-url.cts`。Native Messaging の失敗分類と日英の案内文は `test-save-error-i18n.cts`、`extension/utils/site-detect.ts` のDOM抽出は `test-content-fixtures.cts`（fixture=`scripts/fixtures/content/`・jsdom・`npm test` 常時）で確認する。TL上のオーバーレイ（#54/#94/#309）は `test-overlay-unit.cts`（WXTの生成した resident bundle をjsdomで実行）と `test-bridge-query.cts` に分かれる。前者は照会のバッチ化・マークの3値設定・ホバー保存ボタンの表示・`imageDragged` 経路の再利用・失敗の表示と復帰・投稿DOM非変更を確認する。各PFの実DOMにセレクタが今も当たるかはe2eカナリアと実機確認の領分。

### スモーク／退行・セキュリティ・正しさ

- 実Electron main は `HOLOGRAM_SMOKE` harness で起動。`scripts/test-*.cts` 群がカバーする領域＝ブリッジ・原寸メディア・IPC・ハッシュタグ・自動更新・ユーザー/インスタンス・タグ用語帳・クエリビルダー（text 葉化／保存検索）・クエリエンジン純ユニット（`test-query-unit`＝`renderer/query.ts` の述語/ツリー評価/日付境界/ファセット・ドメイン＝改訂④）・保存先移行エンジン純ユニット（`test-migrate-unit`＝`lib-migrate.mts` の差分追いコピー/検証付き削除/落ち穂拾いスイープ/crash-safe順序）・import 重複検出（`test-app-import-dedup`＝URL＋eagleName/capturedAt/サイズ複合キー・.trash 復活防止）・タブ・カード脚注ゲート（`test-app-cardfoot`＝エンゲージメント数/取込日はソート・フィルタが関係するときだけ表示）・クリック操作モデル（`test-app-click-model`＝#143 の統一ジェスチャを実レンダラで検証: プレーンクリック=単一選択+インスペクタ・Ctrl/Shift 選択・インスペクタサムネ→クイックビュー・投稿者ダブルクリック=ドリルイン・ℹ/○ホバー部品の撤去・矢印キーでの選択移動とインスペクタ追従・端でのクランプ）・インスペクタ内インラインタグ編集（`test-app-inspector-tags`＝P2⑦ でタグ編集がポップオーバーからインスペクタへ移った後の契約: 自由入力+Enter で追加・チップの✕で削除・どちらもサイドカー json まで反映・候補popupが未取込のソースタグとライブラリ語彙を出す・タグpopup を開いたままの Esc でパネルごと閉じない・タグ入力中の矢印キーはキャレット操作で選択を動かさない）・俯瞰ズーム（`test-app-overview-zoom`＝#141 の Ctrl+ホイール1ノッチ・下限48pxまでのズームアウト・96px 未満での情報オーバーレイ自動 OFF（「タイルに情報を表示」の pref は書き換えない）・停止後の確定と永続化）・コレクション/フォルダ移行・自動バックアップ・Zip-Slip/zip爆弾(展開上限)/SSRF・メタ正しさ・index 再利用・テーマトークン/コントラストのパリティ・送り出し（#132＝3層に分けて検証: `test-library-files`＝main のファイル名ガード/欠損除外の純ユニット／`test-records-unit` の `dragFilesOf`＝「選択内を掴めば選択全体・選択外なら単一」の Explorer 規則の純ユニット／`test-app-drag-out`＝実レンダラでの dragstart 配線＝カード画像で preventDefault・選択の置換・本文からのドラッグは素通し／`test-app-copy-image`＝実 Electron で nativeImage が読めない形式を拒否しクリップボードを空で潰さないこと）。**OS ドラッグそのもの（startDrag→Explorer の handshake）だけは自動化対象外**＝`window.hologram` は contextBridge が deep-freeze していて IPC をスパイできず、ドロップ先も OS の領分。実マウス確認に残す。
- **復旧系は 2026-06-23 ライブラリ消失対策の多重防御**＝`test-app-recovery`（冗長ポインタ→config 復元）・`test-backup-guard`（prune 安全弁）・`test-config-recovery`（degraded 時の clear-all 拒否）。安全弁の意図はこの3本を正本とする。
- **一括実行**: `npm test`（`run-tests.cts`）＝Electron 不要の純ユニットのみ（TS 型検査 `test-typecheck`＝app(islands+renderer)・main・native-host・extension・scripts の5プロジェクトの `tsc --noEmit` を含む）。アプリ実起動系（`test-app-*.cts`）は含まれないので `node scripts/run-app-tests.cts` で一括実行する（1本≈10秒と重い＝節目で回す。renderer 再構築後の「npm test では見えない無音の赤」をここで検出する。引数でサフィックス指定のサブセット実行可）。
- **ホバー保存の描画回帰**: `npm run test:overlay-visual`＝使い捨てPlaywright Chromiumへ本番ビルドの拡張を読み込み、X形式の画面で失敗バナーの上中央配置・角の再試行表示との併存、ボタンと画像のスクロール位置、固定ヘッダー/モーダルの重なりを実ブラウザで検査する（重なりの判定点は**ポインタ**＝画像の上端がヘッダーに潜ってもカーソルが画像上ならボタンは残り、カーソル自体がヘッダーへ乗ったら消える）。ホバー配置や重なりを変えたら必ず実行する。
- **ホバー保存のちらつき回帰**: `npm run test:overlay-flicker`＝X/Bluesky/pixiv 形状の fixture（`scripts/fixtures/overlay/`・#338 の「画像を覆う兄弟オーバーレイ」込み）上で、ホバー表示・同じ画像上での往復ホイール（jiggle-scroll＝カーソルが画像上にある間はボタンを外さない）・ホバー中の要素差し替え（re-render＝仮想スクロールの作り直しでもボタンを新要素へ引き継ぐ）・静止ポインタのホイールスクロール・ポインタ微動つきスクロールを駆動し、オーバーレイの付け外しと ページ要素への style 書き込みをタイムライン記録（`lib-overlay-e2e.cts` のレコーダー）で閾値判定する。ちらつき＝時間軸上の再マウント反復なので before/after 検査（overlay-visual）では見えない領域を受け持つ。オーバーレイのホバー・スクロール挙動を触ったら必ず実行。修正ループ中は `node scripts/e2e-overlay-flicker.cts x --verbose` のように単一PF指定＋タイムライン出力で回すと速い（ビルド済み拡張が前提）。ブラウザ起動は全E2E共通の `lib-extension-e2e.cts`、fixture配信とレコーダーは `lib-overlay-e2e.cts` が受け持つ。

## キャプチャテスト手順（半自動フロー）

1. `node scripts/test-select-posts.cts` — テスト対象投稿を公開APIから自動選別（セルごとのURL・アクション・期待値のシートを出力）
2. `node scripts/test-watch-verify.cts` — 保存先フォルダの監視を開始（キャプチャごとにAPI再照合し PASS/FAIL を出力）
3. claude が in chrome でシートのURLを開く → ユーザーが Alt+S → クリック（またはドラッグ）
4. 次のセルに進む（過去分の一括点検は `node scripts/test-watch-verify.cts --recent N`）

### 注意（行動ルール）

- 同じセルを手で繰り返し叩かない。どこまでカバー済みかは `e2e-capture-test.cts` の実行結果で確かめる
- 1つの投稿で複数のケースをカバーできる場合はまとめて記録（例: A-1b と A-1h）
- **手元にないデータはダミーで補ってよい（区別必須）**: 既存ライブラリに無いデータ（例: アバター画像の無い投稿者）を実機検証したいときは、**区別がつくダミーを保存先に追加してよい**。区別の規約＝captureId とコンパニオン（画像/アバター）のファイル名を `dummy-` で始める（検索・一括掃除で実データと確実に分離できる）。`inject-dummy.cjs` がこの規約のダミー（アバター付き・条件網羅）を生成する。**常設の検証フィクスチャとして残してよい**＝再注入の手間が省け、全PF/種別/メディア/反応域/アバターを常に網羅するので普段使い中の退行にも気づける（ユーザー方針 2026-06-21）。データモデルが変わって古びたら `inject-dummy.cjs` を再実行して入れ替える。不要になれば保存先の `dummy-*` を削除すれば fs-watch が一覧から落とす。
