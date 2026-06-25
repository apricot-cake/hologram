# プロジェクト概要

**Corpus** = SNS で見かけた投稿を画像とメタデータごと丸ごとローカル保存し、あとから整理・検索できる「自分だけの SNS ライブラリ」。すべて手元の PC に保存し、サーバーへは何も送らない。

対応プラットフォーム: X (Twitter) / Bluesky / Misskey / Mastodon / pixiv

**3 つの構成要素**（データは一方向に流れる）:

1. `extension/` — Chrome 拡張（MV3）。`Alt+S` で投稿をクリック保存、または画像ドラッグ保存。投稿 URL から各 SNS の API でメタデータを取得・正規化。
2. `native-host/` — Native Messaging ブリッジ。保存先フォルダ（既定 `~/Corpus/library`・変更可）に `<captureId>.jpg`（純 JPEG）+ `<captureId>.json`（サイドカー＝メタデータ）+ メディア/アバター画像を書き出す。
3. `app/` — Electron デスクトップアプリ。サイドカーを走査して閲覧・検索・整理（タグ/フォルダ/ワークスペース/投稿者ビュー等）。保存先フォルダを `fs.watch` で監視し新規キャプチャを自動反映。

技術スタック: Electron + 素の JS（フレームワーク無し）/ Chrome MV3 / Node でテスト可能なロジック分離。

# ドキュメント

- 詳細な構成・実装メモ: [docs/architecture.md](docs/architecture.md)
- ビルド/配布・実機検証の手順: [docs/build.md](docs/build.md)
- スクリプト/テストのカタログと手順: [docs/testing.md](docs/testing.md)
- ユーザー向け機能説明: [README.md](README.md)
- 残タスク: [BACKLOG.md](BACKLOG.md)

# ストレージと実行環境（重要）

- **配置**: 設定・native-host デプロイ・ログ＝`~/.corpus`（`configDir`、`native-host/paths.js`。上書きは `CORPUS_CONFIG_DIR`）／ライブラリ＝config の `saveFolder`（既定 `~/Corpus/library`・変更可）。**いずれも AppData の外**に置く。
- **なぜ AppData 外か**: 開発を Claude（MSIX パッケージのデスクトップアプリ `Claude_pzs8sxrjxfjjc`）内から行うと、その子プロセス（Claude のシェル／そこから起動したアプリ）の `%APPDATA%`・`%LOCALAPPDATA%`・HKCU が仮想化され `…\Packages\…\LocalCache\…` へ転送され、実環境（実 Chrome のネイティブホスト・実アプリ）と乖離する。AppData 外なら全プロセスが同一の実体を見て食い違いが消える（2026-06-23 ライブラリ消失・2026-06-24 保存先食い違いの真因がこれ）。
- **今も仮想化が残る唯一の対象＝HKCU のネイティブホスト登録**（`HKCU\…\NativeMessagingHosts\com.corpus.host`、Chrome 仕様でレジストリ必須＝移動不可・HKLM も admin要＋仮想化で不可）。Claude の `reg` 読みは仮想ハイブで当てにならない（`HKU\<SID>` 直読みも迂回不可・テスト済）。だが**実害はほぼ無い**: 登録は実アプリ起動の `ensureHostRegistered` が毎回書き直す自己修復型で、効果の検証は ① 実 Chrome のキャプチャ成否、② `~/.corpus\bridge.log`／`capture.log`（実体なので Claude も読める）でホスト起動を確認、で取れる。レジストリ値そのものを見たければユーザーが実ターミナルで `reg query`。
- **テスト隔離**: テストは `CORPUS_CONFIG_DIR=<tmp>` で configDir をサンドボックス化する（Electron スモークは加えて `CORPUS_SMOKE=1`／`CORPUS_SMOKE_EVAL`）。新規テストもこの規約に従う。

# 守るルール

- UI 変更時は [DESIGN.md](DESIGN.md) に従う
- 変更の反映: renderer（`app/renderer/*`）は自動ホットリロード＝操作不要。native-host（`bridge.js`/`paths.js` 等）は更新版を `~/.corpus` へコピーで反映＝**再起動不要**（Chrome がキャプチャ毎に bridge を spawn する）。**実アプリ再起動が要るのは main プロセス（`main.js`/`preload`/`lib-*`）変更の反映だけ**（停止/起動は docs/build.md）。
- テスト済みケースを再テストしない（`scripts/test-progress.md` を必ず確認）。手順は `docs/testing.md`。
- コミットは自己判断でこまめに（意味のある単位で）行ってよい。
- push も自己判断で行ってよい（聞かない）。作業が一段落したら、またはセッションを終える区切りで行い、未 push を溜め込まない（数コミット単位を目安に）。