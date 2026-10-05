# 開発に参加する

この文書では、開発環境の準備、アプリと拡張機能の起動、検証、配布物の作成を説明します。構成は [アーキテクチャ.md](アーキテクチャ.md)、表示言語は [ローカライズ.md](ローカライズ.md)、テストの選び方は [テスト.md](テスト.md) を参照してください。

## 準備

Windows、Chrome、Node.js 22.18.0 が必要です。対応するバージョン管理ツールでは、リポジトリ直下の `.node-version` を読みます。手動で設定する場合も同じバージョンを使ってください。

リポジトリのルートで、最初に次を実行します。

```powershell
npm run setup
```

このコマンドはルートと `extension/` の依存関係を準備し、Electron の実行環境も取得します。現在は npm と依存関係の組み合わせに回避策が必要なため、通常の準備には `npm install` ではなく `npm run setup` を使います。新しいワークツリーでも、そのワークツリーごとに実行してください。

アプリを起動したまま依存関係を更新しないでください。使用中のネイティブモジュールを更新すると、インストールが失敗したり依存関係が不完全になったりします。

## 文章とスペルのチェック

Markdown の検査には `markdownlint-cli2`、ソースと文書のスペル検査には `typos` を使います。Markdown の依存関係は `npm run setup` で入ります。typos は [公式リリース](https://github.com/crate-ci/typos/releases/tag/v1.50.3) の v1.50.3 を PATH の通った場所に配置するか、Rust 環境で次を実行してください。

```powershell
cargo install typos-cli --version 1.50.3 --locked
```

```powershell
npm run lint:markdown
npm run lint:typos
```

`npm run lint` と `npm run check` でも両方を実行します。CI では markdownlint を既存のチェックに含め、typos は公式 Action で実行します。検査はファイルを書き換えません。Markdown の自動修正は `npm run lint:markdown:fix` で実行できます。

設定は `.markdownlint-cli2.jsonc` と `_typos.toml` にあります。生成物・依存物は Git の除外設定に従い、第三者ライセンスの原文とロックファイルはスペル検査から除外します。日本語の段落や表を文字数だけで折り返さないため、Markdown の行長制限は無効にしています。意図的な誤字を使う検索テストは、テストファイルに限って例外を設定します。

## 開発・実機検証の進め方

開発と実機検証は main の主作業ツリーで一件ずつ進めます。アプリと拡張機能を変更したら、対象をデプロイしてから既存の開発用アプリと Chrome で確認します。開発用 Chrome のプロファイルとログイン状態は継続して使います。

通常の確認には普段のライブラリを使います。テストデータの保存・削除には下記のサンドボックスと検証専用タブを使います。自動テストや CI の並列実行はそのまま利用できます。

## デスクトップアプリを起動する

普段のライブラリを使う開発版は、リポジトリのルートで起動します。

```powershell
npm start
```

このコマンドは、すでに配備された `app/out/` を起動します。初回、またはソースを変更した後は、先に `npm run app:deploy` を実行してください。`scripts/start-hologram.cmd` も同じ起動を行います。PowerToys のコマンドパレットなどから起動する場合は、この `.cmd` ファイルをそのまま登録してください。すでに開発版が起動している場合は、新しいウィンドウを作らず既存のウィンドウを前面に出します。

開発版を起動して CDP 接続も確認する場合は、次を使います。

```powershell
npm run app:debug
```

このコマンドは普段のライブラリを使い、`http://127.0.0.1:9222` を開発用の CDP 接続先として公開します。実ライブラリを扱うため、検証用データを保存する操作には使わないでください。

CDP で画面を撮る場合は `node scripts/cdp-verify.cts shot` を使います。画像は既定で `%LOCALAPPDATA%\Hologram\verification` に保存されます。リポジトリ内を出力先には指定できません。実ライブラリを表示したキャプチャは、公開物へ添付しないでください。

画面を継続的に調整し、レンダラーの HMR を使う場合だけは次を実行します。

```powershell
npm run app:dev
```

通常の起動に開発サーバーは必要ありません。

### ショートカットで使うアプリへ反映する

チェックアウトの変更を、普段使う開発版へ反映するときは次を実行します。

```powershell
npm run app:deploy
```

成功したビルドだけを `app/out/` に配備します。起動中のアプリは、取り込みやバックアップなどの処理が終わった後に再起動します。アプリを閉じている場合は、次回の起動から新しい出力を使います。`npm run app:build` はビルドだけを行い、起動中のアプリには反映しません。

### 隔離した環境で確認する

実ライブラリを変更したくないときは、サンドボックスを使います。フィクスチャのライブラリと専用の設定ディレクトリで HMR 開発版を一つ起動します。主作業ツリーから実行し、CDP ポートは `9333` を使います。ポートが別のプロセスに使われていれば起動を中止します。

```powershell
node scripts/sandbox-app.cts
```

停止するときは、主作業ツリーで次を実行します。

```powershell
node scripts/sandbox-app.cts stop
```

フィクスチャでは再現しない表示や性能だけを確認したい場合は、実ライブラリの読み取り用コピーから起動できます。

```powershell
node scripts/sandbox-app.cts start --real
```

このモードの画面には実データが含まれます。スクリーンショットを Issue やプルリクエストへ貼らないでください。

## 拡張機能を開発する

拡張機能を変更したら、共有のリリースビルドを配備します。

```powershell
npm run ext:deploy
```

このコマンドは `extension/.output/chrome-mv3/` にビルドを作り、同じ開発用プロファイルを背面で起動して読み込み直します。終了時に開発用 Chrome を通常終了します。日常用 Chrome には、ネイティブメッセージングホスト経由で更新を通知します。

開発用 Chrome の初回準備では、開発用ネイティブメッセージングホストを登録します。

```powershell
npm run ext:dev:register
```

このコマンドは HKCU と開発用設定ディレクトリへ書き込みます。Chrome と同じ Windows ユーザーで実行してください。

開発用プロファイルを開くには、次を実行します。

```powershell
npm run ext:dev:open
```

開発用 Chrome は管理ランチャーが非表示のセッションを pipe 接続で操作し、TCP の CDP 接続口を公開しません。コマンド終了時に Chrome も通常終了します。ログインと保存先を維持し、次の起動で前回のタブを復元しますが、ページ内の一時的な状態は引き継げません。セッションを保持したコマンドがある場合は、Ctrl+C で終了してから次のコマンドを実行してください。

開発用 Chrome の通常タブは普段のライブラリを使います。隔離した保存先が必要な確認では、通常タブの設定を変更せず、検証用のアプリとタブを開く専用スクリプトを使ってください。

```powershell
node scripts/verify-extension-tab.cts <投稿 URL>
```

検証タブを使う間は、このコマンドを実行したままにします。終了時に検証タブと専用の保存先設定を片付けます。通常タブの設定は変更しません。

自動検証では、`node scripts/run-dev-browser.cts <検証モジュール> [引数...]` を使います。検証モジュールは `run({ context, browser, args })` を公開し、渡されたセッション内で操作します。

開発用 Chrome への接続状態とプロファイルの場所は、次で確認できます。

```powershell
npm run ext:dev:status
```

日常用 Chrome や一般的なブラウザ操作用の拡張機能には接続しません。

## 検証する

通常の変更後は、次を実行します。

```powershell
npm run check
```

拡張機能のソース、マニフェスト、またはバンドル方法を変更した場合は、次を実行します。

```powershell
npm run check:ext
```

保存、IPC、ネイティブメッセージング、アプリの起動に関わる変更では、さらに次を実行します。

```powershell
npm run test:integration
```

画面の操作や見た目に影響する変更では、アプリをビルドして画面 E2E も実行します。

```powershell
npm run app:build
npm run test:e2e:ci
```

実機確認に入る前に、変更した対象を配備してください。アプリだけを変更した場合は `npm run app:deploy`、拡張機能だけを変更した場合は `npm run ext:deploy`、両方を変更した場合は両方を実行します。

## 配布物を作る

### Chrome 拡張機能

Chrome ウェブストアへ提出する成果物を作る前に、次を実行します。

```powershell
npm run release:ext:verify
```

出力先は `extension/.output/chrome-mv3-release/` です。ZIP が必要な場合は `npm run ext:package` を実行します。

### デスクトップアプリ

Windows 向けの配布物は Electron Forge で作ります。

```powershell
npm run app:make
```

Squirrel.Windows のインストーラー `HologramSetup.exe` が `app/artifacts/` 以下に出力されます。GitHub Releases の下書きまで作る場合は、次を実行します。

```powershell
npm run app:publish
```

配布前には、クリーンな Windows 環境でアプリの起動、拡張機能からの保存、ライブラリの作成と既存ライブラリの読み込みを確認してください。

## 保存に失敗したとき

まず、拡張機能とアプリが想定した環境を使っていることを確認します。その後、通常版の `%APPDATA%\Hologram` と開発用の `%APPDATA%\Hologram-Dev` のログを確認します。

1. 拡張機能の診断ページでホストへ接続できているかを確認します。
2. アプリのログで取り込みキューと SQLite への取り込みに失敗していないかを確認します。
3. ホストのログで保存先、メディアのダウンロード、メッセージ形式のエラーを確認します。

個人情報や認証情報をログや Issue に含めないでください。

## アイコンを更新する

元画像 `assets/icon-master.png` を差し替えた後、リポジトリのルートで次を実行します。

```powershell
node_modules/.bin/electron scripts/make-icons.cjs
```

正方形で 512 px 以上の元画像を使ってください。
