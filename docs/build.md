# Hologram ビルド/配布

## 開発実行

初回の依存導入（`app/` は npm ワークスペース、`extension/` は別プロジェクト＝両方まとめて入る）:

```
npm run setup
```

**⚠️素の `npm install` は現在このリポジトリでは通らない**（C++ ビルドツールを入れている環境を除く）。`better-sqlite3` v13 は N-API 化でビルド済みバイナリを同梱し、読み込み側もそれを優先するのに、`binding.gyp` を同梱したまま install スクリプトを宣言していない。npm はこの組み合わせを「node-gyp でコンパイルせよ」と解釈する既定を持つ（[npm docs](https://docs.npmjs.com/cli/v11/using-npm/scripts)）ため、**不要なコンパイルが走り、失敗すると install 全体が途中で止まる**（無関係なパッケージが入らないまま終わる）。

`npm run setup` は `--ignore-scripts` で入れ、それが巻き添えで止める Electron 本体の取得だけを戻す。`npm rebuild electron` は成功と表示して**何もダウンロードしない**ので使わない。

**これは上流 [WiseLibs/better-sqlite3#1503](https://github.com/WiseLibs/better-sqlite3/issues/1503) が直るまでの暫定措置。** setup は毎回、インストール済み `better-sqlite3` の `package.json` を読んで条件がまだ成立するか確かめ、解消していれば「回避策を外せる」と表示する。Dependabot（#395）の更新 PR で新バージョンが来たときも、同じ条件（`gypfile: false` か install スクリプトの有無）で判定する。**解消したら `scripts/setup.cts`・`package.json` の `setup`・本節をまとめて消すこと。**

## 拡張機能の開発・配布

依存は `npm run setup` が `extension/` の分もまとめて入れる（`extension/` は独立した npm プロジェクト＝ルートの install では入らない）。**ブラウザは日常の Chrome 1本、読み込む出力も本体ツリーの `extension/.output/chrome-mv3/` 1箇所**（2026-07-26 にこの形へ寄せた＝ホットリロードを普段使いのブラウザで効かせるのが狙い）。dev ビルドも production ビルドも同じフォルダへ書く＝`wxt.config.ts` の `outDirTemplate` で WXT 既定の `-dev` サフィックスを外してある。モードの切り替えはビルド＋リロード1回で済み、**拡張の削除→再追加は発生しない**（削除→再追加は `chrome.storage.local` の設定とショートカット割当を消す）。

| 状態 | 作るコマンド | 入るとき / 出るとき |
| --- | --- | --- |
| **開発中**（ホットリロード有効） | `npm run dev:ext`（開発中だけ常駐） | 起動後に `chrome://extensions` でリロード1回 → 以後は保存すれば勝手に反映 |
| **平常**（production・サーバー非依存） | `npm run build:ext` | dev サーバーを止めたら必ずこれ＋リロード1回で戻す |

- **dev サーバーを止めたら production へ戻すまでが1セット**。開発モードの拡張は manifest に `content_scripts` を持たず、常駐スクリプトを **dev サーバー接続経由で実行時登録**する。dev ビルドを残したままサーバーが居なくなる・繋がらない（Node ≥17 は `::1` のみに bind することがあり Chrome は IPv4 で来る）と**普段使いの拡張が丸ごと沈黙**し、原因は `chrome://extensions` を開かない限り見えない（2026-07-26 被弾＝#362）。
- **dev:ext 起動直後のリロード1回を忘れない**: リロードするまで Chrome に載っているのは前のビルドのまま＝直したはずの挙動が出ない（同型の被弾 2026-07-25＝修正が1時間空振り）。
- **なぜ WXT にブラウザを起動させないか**（`web-ext.config.ts` で無効化）: 自動化スタック（web-ext-run → chrome-launcher）経由の起動は大量の `--disable-*` フラグ＝自動化ツールの指紋が付き、X も Google もボット判定してサインインを弾く（2026-07-26 実測）。ホットリロード自体は拡張⇔dev サーバー間の WebSocket なので、普段どおり起動した Chrome でそのまま効く。
- **デバッグポートは開けない**: TCP のデバッグポートは無認証で、ローカルの任意プロセスがブラウザを乗っ取りサインイン中のセッションを抜けられる（Chrome 136 が既定プロファイルで同スイッチを拒否するのも同じ理由）。

**読み込むのは本体ツリーのパスに限る。**worktree の `.output` を読み込むと、その worktree を撤去した時点で拡張が壊れる。dev サーバーは**自分が起動されたツリーの `.output` だけ**を更新するので、worktree で拡張を直している間はホットリロードが届かない。worktree の変更を実ブラウザで見る手段は2つ:

- 本体ツリーを対象コミットへ detach してから本体で `npm run dev:ext` を回す（手順は skill `test-in-worktree`）
- 急ぐなら worktree で `npm run build:ext` し、本体の `chrome-mv3` へ上書き→リロード1回（手順は skill `verify-extension`）

固定IDを保つ `key` は `extension/wxt.config.ts` にある。移行後もID・Native Messaging 保存・5プラットフォームのクリック/ドラッグ保存は実機確認の対象である。

- 手元の実ターミナルから動かすだけなら `npm start`、ワンクリック起動は `restart-app.ps1` を右クリック →「PowerShell で実行」でよい。
- **Claude（MSIX コンテナ内）や CDP 検証を伴う起動は `HologramLaunch` タスク経由**（下記「コード変更の反映」）。初回／タスク削除後は `restart-app.ps1` を一度実行するとタスクが自己作成される（以後は最小形で再起動可）。

## 開発ルール：コード変更の反映（確認なし再起動）

> **npm スクリプトの置き場**: `build`・`dev`・`typecheck`・`dist`・`start` は `app/package.json`。`app/` は npm ワークスペースなので**リポジトリ直下から** `npm run build --workspace=app`（`-w app` でも可）で実行できる。もちろん `cd app && npm run build` でもよい。リポジトリ直下の package.json が持つ固有のスクリプトは lint 系（`lint`・`lint:fix`・`format`）と `test`・拡張機能の `*:ext` だけ。

main・preload・renderer のどれを変更した場合も、**`npm run build --workspace=app` でビルド → 確認を取らずに再起動**（electron-vite が3面（`src/main`・`src/preload`・`src/renderer`）を `app/out/` へ一括ビルドする。旧来あった「renderer だけは再起動不要」の特例は無い＝`electron-vite dev`（HMR・main 自動再起動）を使わない限り、ビルド出力を読み直すには再起動が要る。Claude 自身の検証は次節のとおり常にビルド→タスク再起動で行い、`electron-vite dev` は使わない）。native-host のブリッジ（Chrome が起動する常駐プロセス）を変更した場合は `npm run build:native-host-bridge --workspace=app` でバンドルを作り直してから `node native-host/install.cts` で `~/.hologram` へ再配備（アプリ再起動は不要）。

**再起動は「停止 ＋ タスクスケジューラ経由の起動」で行う**。Claude が実行する最小形:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*hologram*' } | Stop-Process -Force
Start-ScheduledTask -TaskName 'HologramLaunch'
```

ユーザーのワンクリックは `restart-app.ps1` を右クリック →「PowerShell で実行」（窓は出るが終了時に自動で閉じる）。`restart-app.ps1` は graceful close ＋ `HologramLaunch` タスクの自己修復（無ければ作成）＋起動をまとめてある。

- **なぜ直接 `Start-Process electron.exe` を使わないか**: Claude のシェルは MSIX パッケージ（`Claude_pzs8sxrjxfjjc`）内で動くため、そこから直接起動した electron はコンテナの子＝HKCU/FS が仮想化され、ネイティブホスト登録が実 Chrome から見えない私的ハイブに入りキャプチャが壊れる。`HologramLaunch` タスクは Task Scheduler サービス（コンテナ外）が起動する＝**実 HKCU/実 FS で動く**（2026-06-26 にレジストリ probe で実証）。ユーザーが直接起動した場合と同一になる。
- `HologramLaunch` タスク定義: `electron.exe "<repo>\app" --remote-debugging-port=9222`（ポートは実機CDP検証用＝下記「検証ルール」）／Interactive（ウィンドウが出る）／Limited（非昇格）／トリガー無し（`Start-ScheduledTask` でのみ起動）。`restart-app.ps1` はアクションのパス/引数が drift したら毎回貼り直す（リポ移動にも追従）。`Start-ScheduledTask` が "task not found" を返したら一度 `restart-app.ps1` を実行して作り直す。
- `npm start` 経由は cmd ウィンドウが出るため使わない（electron.exe はGUIアプリなのでコンソールは出ない）。

## 検証ルール（隔離3段構え）

**検証は隔離インスタンスで行う（既定）。実機 :9222 に触るのは「実ライブラリでの最終確認」と「キャプチャ経路（拡張→bridge）」だけ**。

1. **挙動・自動テスト＝SMOKE 隔離**: `HOLOGRAM_SMOKE=1` ＋ `HOLOGRAM_CONFIG_DIR=<tmp>`（雛形は `scripts/test-app-tagtypes.cts`）。隠しウィンドウ・自動終了。別プロセス・別 config なので、**ユーザーが本体アプリを操作していても結果に混ざりようがない**。実機を使う限り、ユーザーの操作が混入したかを事前に防ぐ手段も、事後に検知する手段も無い（2026-07-20 に実測で確認＝CDP `Input.*` で撃ったイベントは人間の操作と同じく `isTrusted: true` になり区別できない。ページ内合成の `el.click()` だけが `false`）。だから防ぐのでなく、混入しても困らない場所へ検証を寄せる。
2. **見た目・モーション＝サンドボックスインスタンス**: `node scripts/sandbox-app.cts` で**可視・常駐の2台目**を起動する（CSS transition や inline 配置は隠しウィンドウでは再現しないため、従来は実機に頼っていた層）。作業ツリー直下 `.sandbox/`（gitignore）に config・シード済みフィクスチャライブラリを永続化し、CDP ポートは 9333 から空きを自動採用（起動時に表示・`.sandbox/instance.json` に記録）。接続は `CDP_PORT=<port> node scripts/cdp-verify.cts`、終了は `node scripts/sandbox-app.cts stop`。`HOLOGRAM_SANDBOX=1` でホスト登録をスキップするため **HKCU・共有 `~/.hologram` に一切触れない**＝実機と安全に共存でき、worktree ごとに独立するので並行セッションの検証が衝突しない。インスタンスロックは（アプリ名, userData）単位で userData は config dir に固定されている＝2台目の起動をロックは妨げない。
3. **実機（:9222）**: `HologramLaunch` タスクで起動したウィンドウへ CDP 接続する。アクションには `--remote-debugging-port=9222` を恒久付与してあるので、タスク経由なら常に :9222 でデバッグ可能＝**コンテナ外（実 HKCU/実 FS）かつ CDP 可能**を同時に満たす。直接 `Start-Process electron.exe --remote-debugging-port=…` は使わない（コンテナ内＝仮想化でキャプチャが壊れる）。実機での検証は短く済ませ、混ざった疑いがあれば撮り直す。

**並行セッションで共有のままの装置**（worktree でもサンドボックスでも隔離されない）: `node native-host/install.cts` の再配備・拡張のリロード・実機の再起動の3つ。並行セッションの実行中にこれらを行う時だけは、相手の検証を壊しうるので重ねない（`ccd_session_mgmt` で実態確認）。**この確認先は並行セッションであって、ユーザーではない**＝重なりが無いと分かったらそのまま実行する（可否を尋ねて止まらない）。「共有資源だから」は他セッションを調べる理由であって、検証を保留する理由ではない。

- **稼働中の実機は確認なく駆動してよい**（リロード・カード選択・ビュー開閉・スクショまで一気に自律で）。ユーザーの作業状態を保存する義務も、事前に声をかける義務も無い（2026-07-19 にユーザーが明示。それ以前は「今は触らないでください」と伝える運用だったが、**チャットの声かけはユーザーが画面を見ている保証が無く警告として機能しない**＝2026-07-20 に撤去）。開いたオーバーレイを閉じる程度の後片付けはする。
- **実機で異常を見たら、まず自分の駆動の残留を疑う**（ユーザー操作のせいにする誤帰属を先に潰す）。1スクリプトに多数のフローを詰めない＝駆動は目的1つに絞る（絡むと解析不能になる）。
- スクショは画像トークンが重いので、数値で足りる検証（computed style / コントラスト比など）は画像を撮らず JS 計測で済ます。

## 配布物生成

```
npm run dist --workspace=app
```

electron-builder, win/nsis。

- 出力 `app/dist/win-unpacked/` — スタンドアロン。`Hologram.exe` を直接実行可。ASCIIパスへ置けば native-host のランチャもASCIIになり日本語パス問題が解消。
- **`npmRebuild: false` を設定してある**（`app/package.json` の `build`）。electron-builder は既定でネイティブモジュールを Electron 向けに再ビルドするが、唯一のネイティブ依存 `better-sqlite3` は N-API（`binding.gyp` の `NAPI_VERSION=10`）でビルド済みバイナリを同梱しており、同じ `.node` が Node と Electron の両方で動く＝再ビルドは不要。既定のままだと node-gyp が走り、C++ ビルドツールが要求される（2026-07-24 実測: 同一バイナリが Node 24 と Electron 43＝`NODE_MODULE_VERSION` 137 と 148 の双方でロード・WAL・FTS5 trigram の日本語部分一致まで動作）。**N-API でないネイティブ依存を足すときはこの設定を見直すこと**（黙って再ビルドが飛ぶ）。better-sqlite3 公式の troubleshooting は今も electron-rebuild を案内しているが、N-API 化前の記述。
- **`asarUnpack` に `better-sqlite3` を入れてある**。`.node` は asar 内から読めないため、これが無いと配布ビルドでのみ DB が開けない。将来コード署名を入れる際は、asar の外に出たこのバイナリも署名対象に含める。
- **NSIS ワンクリックインストーラ** は winCodeSign 展開時に **symlink 作成権限** が要る。**Windows 設定 → 開発者向け → 開発者モード を ON**（または管理者で実行）してから `npm run dist` で `Hologram Setup x.x.x.exe` が生成される。OFF だと winCodeSign 展開が失敗し `win-unpacked` のみになる（macOS用 dylib symlink でこける／コードの問題ではない）。
- `native-host/` は `extraResources` で `resources/native-host` に同梱。`app/src/main/index.ts` が `app.isPackaged` でパス解決（dev=`../../../native-host`＝electron-vite の `out/main/` からの相対）。

## アイコン（全再生成の単一導線）

ブランドの実体はホログラフィック虹色スクエア（ラスター）。**マスター 1 枚から全アイコンを再生成**する＝差し替えが半端にならない仕組み:

1. `assets/icon-master.png` を差し替える（正方・512px 以上推奨）
2. `app/node_modules/.bin/electron scripts/make-icons.cjs` を実行

これで以下が一括更新される（`scripts/make-icons.cjs` の `TARGETS`/`BANNERS` が配置先の単一真実源＝増えたらここに足す）:

- `app/assets/icon.png`（512）＝Electron ウィンドウ/タスクバーアイコン。`app/package.json` の `build.win.icon` がこれを指し、electron-builder が配布時に `.ico` 化（PNG→ICO 自動変換）。dev では `src/main/index.ts` の `BrowserWindow({icon})`＋`app.setAppUserModelId` で反映。
- `extension/public/icons/icon{16,32,48,128,256}.png`＝Chrome 拡張（生成manifest の `icons`/`action.default_icon`）。開発中は WXT が再読み込みしてツールバーへ反映。
- `assets/icon.png`（256）＝汎用ブランドラスター/ファビコン。
- `assets/banner-{light,dark,en-light,en-dark}.svg`＝README バナー。ワードマーク `hologram`＋タグラインは保持し、先頭マークだけ虹色スクエアの埋め込み画像（base64）に差し替え。

**マスターを差し替えたとき以外は実行しない**: 画素は忠実に再現されるが、PNG の圧縮結果が実行環境（Electron のバージョン）で変わるため、マスターが同じでも全派生アイコンに差分が出る。2026-07-22 の実測では 11 成果物すべてがピクセル単位で一致し、**ファイルサイズだけ 8〜11% 増えた**（バナー SVG は埋め込みラスタもマークアップも一致）。差分に中身が無いうえサイズは悪化するので、再生成は差し替え時に限る。過去のフレームへ戻す場合も再生成でなく git のブロブから復元する（前例は c49aa8e）。

Electron 経由で実行するのは nativeImage の高品質リサンプラを使うため（ウィンドウもネットワークも無し・リポへのファイル出力のみ）。拡張子が `.cjs`（周囲の `scripts/*.cts` と異なる）のは、Electron 43／Node 22 が `.cts` エントリを ESM 経由で読み `require('electron')` の注入が効かなくなるため＝classic CommonJS ローダを強制する必要がある（詳細はスクリプト冒頭コメント）。`.cts` へ戻さないこと。
