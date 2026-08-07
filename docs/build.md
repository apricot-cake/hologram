# Hologram ビルド/配布

## 開発実行

初回の依存導入（`app/` は npm ワークスペース、`extension/` は別プロジェクト＝両方まとめて入る）:

```
npm run setup
```

**⚠️素の `npm install` はまだこのリポジトリでは通らない**: 2つの独立した事情でフラグが要る。

1. `electron-vite@5` は `peer vite: ^5 || ^6 || ^7` を宣言しているのに `app/` は vite 8 で組んでいるため、npm の解決器がツリーごと拒否する。vite 8 を受ける安定版の electron-vite はまだ無く（6.0.0 は beta のみ・2026-07-27 確認）、`overrides` では peer の範囲を広げられないので、npm 公式の逃げ道である `--legacy-peer-deps` しかない。**この不整合は前からある**＝lockfile 無しの `npm install` は vite 8 を入れた時点で通らなくなっていて、コミット済みの lockfile が支えていただけ。何かが再解決を促した瞬間に落ちる。
2. `better-sqlite3` は同梱の prebuilt バイナリ（`prebuilds/<platform>-<arch>.node`）を使わせるため `package.json` に `gypfile: false` を宣言しているが、**この宣言は package-lock.json 経由のインストールには一切届かない**。npm の arborist が lockfile へ書き出す package.json フィールドは固定の allowlist（`@npmcli/arborist/lib/shrinkwrap.js` の `pkgMetaKeys`）で、そこに `gypfile` は含まれない。このリポジトリは package-lock.json をコミットしている＝fresh checkout の `npm install` は常にロックファイル駆動になり、better-sqlite3 の解決結果は `gypfile` を持たないまま npm の既定動作（binding.gyp を同梱し install/preinstall スクリプトを持たないパッケージは node-gyp でコンパイルする）に落ちる。node-gyp は Visual Studio の C++ ツールチェインを要求し、無いインストール全体を巻き込んで失敗させる。コンパイル自体そもそも不要（同梱の prebuilt バイナリで動く）なので、`--ignore-scripts` で node-gyp 呼び出しごと止める。

`npm run setup` はこの2つのフラグを（要るものだけ）付けて入れ、あわせて `build:ext` も走らせる＝3本のテストが拡張のビルド出力（`capture.js`・`resident.js`）を直接読むため、これが無いと入れたてのツリーで `npm test` が落ちる。

**あわせて Electron 本体も手動で取得する**（`--legacy-peer-deps` とも `--ignore-scripts` とも無関係の別の事情）: `app/` が固定しているバージョン（現在 43.2.0）の `electron` パッケージには postinstall スクリプトが元々無く、npm がスクリプトを実行できる状態で入れても `~225MB` の本体は自動では降ってこない。`npm run setup` は install 後に `node_modules/electron/dist/electron.exe` の有無を見て、無ければ `node node_modules/electron/install.js` を直接呼ぶ。`npm rebuild electron` は成功と表示して**何もダウンロードしない**ので使わない。

**⚠️Hologram（開発版）を起動したまま install しない**: 実行中の Electron が `node_modules/electron/dist/**` と `better-sqlite3` の `.node` を掴んでいるため、npm がファイルを置き換えられず EBUSY / EPERM で止まる。`npm ci` は先に node_modules を消しにいくので、途中まで消したところで失敗して**依存が欠けたツリーが残る**（2026-07-27 実地被弾）。先にアプリを閉じること。

**上流待ちの暫定措置で、setup が毎回自分で判定する。**フラグはハードコードしておらず、install の前にディスク上の状態から条件を読み、必要なら渡す。上流が直れば**フラグが自動的に付かなくなり、外してよい旨を表示する**。

| フラグ | 解消の条件 | 待っている先 |
| --- | --- | --- |
| `--ignore-scripts`（better-sqlite3） | package-lock.json の better-sqlite3 エントリが `gypfile:false` を持つようになる（＝npm がロックファイルへこのフィールドを書くよう変わる） | [better-sqlite3 #1503](https://github.com/WiseLibs/better-sqlite3/issues/1503) |
| `--legacy-peer-deps` | `electron-vite` の `peerDependencies.vite` が、使用中の vite のメジャーを受け入れる | [electron-vite releases](https://github.com/alex8088/electron-vite/releases) |

判定そのものは `scripts/setup-probes.test.ts` が守る（誤って「もう不要」と答えると次の install が落ち、誤って「まだ必要」と答え続けると回避策が恒久化するため）。範囲の書式を読めない・package-lock.json が無い場合は**安全側＝維持**に倒す。

**⚠️better-sqlite3 側の判定は `node_modules` の展開物でなく package-lock.json のエントリを読む**（`scripts/setup.cts` の `sqliteCheck`）: 展開物の `package.json` は `gypfile:false` を正しく持つが、それは**その展開自体が `--ignore-scripts` で作られたツリーかもしれない**＝プレーンな `npm install` が通る証拠にならない（2026-07-29 #510 の実測。以前の判定は展開物を読んでおり、そのせいで「もう不要」と誤判定して #493 が回避策を撤去し、fresh worktree で再発した）。package-lock.json 自体は npm が自分で書くファイルなので、そこに `gypfile:false` が現れて初めて「npm がロックファイル駆動のインストールでもこのフィールドを読むようになった」と言える。

Dependabot（#395）の更新 PR で新バージョンが来たときも、確認すべき条件は上表と同じ。**解消したら `scripts/setup.cts`・`scripts/setup-probes.test.ts`・`package.json` の `setup`・本節をまとめて消すこと。**

（`extension/` 側は独立した npm プロジェクトで、postinstall が `wxt prepare`（tsconfig が extend する `.wxt/` の型を生成する）を走らせるため、プレーンな `npm install` を別途行う。**Electron 本体の手動取得は上記どちらのフラグとも無関係に今も必要**＝pin している electron@43.2.0 自体に postinstall が無い。）

## commit 前の自動整形（#994）

`.githooks/pre-commit` が、ステージ済みファイルに `biome check --write` を掛けて直し直後の内容を自動で再ステージする（有効化は `npm run setup` の `git config core.hooksPath .githooks`＝post-merge と共通）。Biome が自動修正できない違反（parse エラー等）に当たった時だけ commit を止める。緊急時は `git commit --no-verify` で外せる。

## 拡張機能の開発・配布

依存は `npm run setup` が `extension/` の分もまとめて入れる（`extension/` は独立した npm プロジェクト）。ビルド基盤は **WXT**。

**開発と日常利用は別々の Chrome プロファイルで行う**（#732）。日常の Chrome には検証済み release だけが載り、開発サーバーには依存しない。manifest の `key` は両方で共通なので、拡張 ID `keggmjkemfcekcffohnpaojacdakpejh`・storage・ショートカット・Native Messaging はどちらでも同じ。

| 出力 | 作るコマンド | 読む側 |
| --- | --- | --- |
| **開発** | `npm run dev:ext`（可視のコンソールで走る。検証中は動かしたまま） | 専用プロファイルの Chrome。`~/.hologram-dev/chrome-mv3-dev` を一度だけ Load unpacked する |
| **release** | `npm run build:ext` | 誰も直接は読まない。Chrome／Firefox を `.output/<browser>-mv3-release` へ生成して検証するところまで |
| **日常** | `npm run deploy:ext` | 日常の Chrome。検証済み Chrome release を `.output/chrome-mv3` へ差し替え、拡張へ告知する |

`wxt build` が日常パスへ書くことはない＝日常の Chrome に載るのは必ず `deploy:ext` を通ったものだけ。

### 日常 Chrome への昇格は自動（#650 / #732）

`.githooks/post-merge` が、**本体ツリーへ main を取り込んだ時**に `extension/` 等の変更を見て `npm run deploy:ext` を走らせる（有効化は `npm run setup` の `git config core.hooksPath .githooks`）。常駐プロセスもポーリングも無い。

Chrome は unpacked 拡張のファイルが変わっても自分では読み直さないので、差し替えだけでは `chrome://extensions` のクリックが残る。それを消すのが #650 の自己リロード＝`deploy:ext` が `~/.hologram/extension-build.json` にビルドIDを告知し、ネイティブホストが全ての返信にそれを乗せ、拡張が（保存・一括取込・キャプチャUIが終わるのを待ってから）自分で `chrome.runtime.reload()` を呼ぶ。**リンク worktree は告知しない**＝サブエージェントのビルドが日常の拡張を動かすことはない。

順序は「差し替えてから告知」。まだ disk に無いビルドを告知するのは、`scripts/build-extension.cts` の検証が防いでいる `DISABLE_RELOAD`（不完全な出力を読んだ Chrome が拡張を無効化し、ファイルが揃っても戻らない）そのもの。

### 開発プロファイル

```
npm run ext:dev:browser
```

専用の user-data-dir（既定 `~/.hologram-ext-profile`）で Chrome を普通に起動する。日常の Chrome とは別プロセスなので並べて開いてよい。**初回だけ**、開いた Chrome で `chrome://extensions` → 開発者モード ON → Load unpacked → `~/.hologram-dev/chrome-mv3-dev`。以後はプロファイルが覚えているので、どの worktree から `npm run dev:ext` を起動しても同じ場所へ出力され、読み込み直しは要らない。各 SNS へのログインも初回だけ人が行う。

**このコマンドは Claude 自身が実行する＝ユーザーへ起動を依頼しない**（#857）。人の手が要るのは上の2つ（初回の Load unpacked・各 SNS へのログイン）だけで、**ウィンドウを開くこと自体は自動化できる**。

- **起動済みなら何もしない**＝`scripts/open-dev-profile.cts` が先に `--user-data-dir` を照合してブラウザ本体プロセスを探し、居れば pid を出して終わる（ヘルパープロセスは `--type=` で除外＝窓を閉じた後に居残る crashpad を「起動中」と読まない）。**このプロファイルの窓は長寿命**＝ログインも読み込み済みの拡張も開いたタイムラインもそこに載っているので、「もう開いている」が例外でなく通常。開くか尋ねる前に、まずこれで見る。
- **状態だけ知りたいなら `node scripts/open-dev-profile.cts --print`**＝chrome/profile/build のパスと `running: yes (pid …)` を出して**何も開かない**。
- **起動は `chrome.exe` を直接 spawn する**（detached・stdio なし）。⚠️**かつては一度きりのスケジュールタスク `HologramDevBrowser` を挟んでいたが、その理由（MSIX 仮想化でプロファイルが分岐する）は 2026-08-06 に失効し**（#1003）、**タスク経路は 2026-08-07 に撤去した**（#1006・実機で確認＝直接起動した Chrome が `~/.hologram-ext-profile` をそのまま使い、Load unpacked 済みの拡張も残っていた）。**タスクが唯一買っていたのは「開いた窓が起動元より長生きする」こと**（アクションが `chrome.exe` でなく `cmd /c start` だったのはそのため）＝これは `detached: true` ＋ `stdio: 'ignore'` ＋ `unref()` が引き継ぐ（同日実測＝node は1秒未満で戻り、窓はその後も生きている）。
- **窓を開くのはユーザーの画面を奪う**＝だから「起動済みを見てから」であり、本当に必要な時は開いてよい（開いた事実を一行添える。グローバル CLAUDE.md「Chrome のフォーカスを奪わない」）。

⚠️**日常プロファイルには開発ビルドを読み込まない**＝両方が同じ拡張 ID を持つので衝突する。`--load-extension` は使わない（Chrome 137+ が無視する＝#657）。

**WXT にブラウザを起動させない**（`webExt.disabled`）。理由は2つとも今も生きている＝①自動化スタック経由で開いたブラウザは自動化フラグの指紋を持ち、X と Google がボットと見なしてサインインを拒む（2026-07-26 実測）②`--load-extension` は Chrome 137+ で無視される（#657・Chrome 151 で実測）。ホットリロードは拡張と dev サーバーの間で成立するので、誰がブラウザを起動したかは関係ない。**デバッグポートも開けない**＝TCP のデバッグポートは無認証で、ローカルの任意プロセスがサインイン中のセッションを抜ける（Chrome 136 が既定プロファイルで同スイッチを拒むのと同じ理由）。

反映は **拡張のリロード＋タブのリロード**で、in-place HMR ではない（WXT の Shadow Root UI は HMR 非対応で、この拡張の常駐 UI は自前 ShadowRoot＝#44）。守るべき日常タブが同じプロファイルに居ないので、これが許容できるようになったのが分離の要点。

dev サーバーは `localhost:51731` 固定。二重起動は別 port へ逃げずに落ちる（そもそも `npm run dev:ext` が**既に上がっていれば起こさずに終わる**＝下記）。

⚠️**待ち受けは IPv6 の `::1`**（WXT が Vite の既定でバインドする＝2026-08-04 実測）。**生死を見るコードで `127.0.0.1` を指さない**＝IPv4 では繋がらず、動いているサーバーを「落ちている」と報告する。実際 `open-dev-profile.cts` の `dev server:` 行はこの誤りで、ずっと down と出していた（同日修正・判定は `scripts/lib-dev-server.cts` に集約）。拡張自身は `http://localhost:51731/...` を読むので実害は診断だけに出ていた。

**サーバーは可視のコンソールウィンドウで走る**（2026-08-04。**窓の開き方・止め方の作法そのものは Windows 全般の話＝skill `windows-scripting` が正本**で、ここは Hologram 側の値と事情だけを書く）＝端末を持たない呼び出し（Claude セッション・タスクランナー）から `npm run dev:ext` が起きた時、`scripts/dev-extension.cts` は自分では走らず、`Hologram dev:ext` というタイトルの新しいコンソールを開いてそちらへサーバーを渡し、呼び出した側へは即座に戻る。**人が端末で打った時は分離しない**＝そのまま目の前で走る（Ctrl+C と WXT のキーバインドが効くのはこちら）。`CI` 環境変数がある時と Windows 以外でも分離しない。

- **理由は「走っているかどうかが外から見えること」**＝端末なしで起こすと、出力は呼び出した側が選んだスクラッチファイルへ消え、そのセッションの外からはサーバーが上がっているのかどうかも分からない。見えないサーバーは二重に起こされ、何日も動きっぱなしになる。ウィンドウがあれば、リビルド行・リロード行・ポート衝突がそこに全部出る。
- **窓はタスクバーの状態表示を兼ねる**（2026-08-04）＝**窓の主は node**（`start … node scripts/dev-extension.cts` で開く＝間に `cmd /k` を挟まない）なので、タスクバーのボタンに **Node のアイコン**が出る。**窓がある＝サーバーが生きている**で、止まれば窓ごと消える＝「動いているか」を見るために `open-dev-profile.cts --print` を打つ必要が無い。
  - **`cmd /k` は使わない**＝サーバーが死んだ後もプロンプトを出して居座るので、**止まっているサーバーについて「動いている」と表示し続ける窓**が残る。状態表示として嘘になる。
  - **異常終了の時だけ窓が残る**＝`dev-extension.cts` が非ゼロ終了を捕まえて `pause` で止める（ポート衝突・ビルドエラー・install 漏れの理由がそこに出たまま読める）。**Ctrl+C と正常終了は残さない**＝手で止めたサーバーはタスクバーからも消える。
- **窓の見分けは中身でする＝タイトルは当てにならない**（実測）。開く時は `Hologram dev:ext` を付けるが、**走り出すと npm が実行中のスクリプト名（`npm run tokens` 等）で上書きする**。**先頭に出る `[hologram] development build folder: …` は窓の大きさ次第**＝初回ビルドが出力14個を並べるので、小さい窓では押し出されて見えない（広げれば残っている）。**窓の大きさに依らない識別子は3つ**＝npm のヘッダ `hologram-extension@<version>`、出力一覧の全行に出る `.hologram-dev\chrome-mv3-dev`、ポート `51731`。隣のプロダクトの dev サーバー窓が並んでいてもこれで区別できる。
- **ログファイルは作らない**＝ウィンドウが唯一の出力先。ビルドが入ったかは `~/.hologram-dev/chrome-mv3-dev` の更新時刻で、サーバーの生死は `node scripts/open-dev-profile.cts --print` の `dev server:` 行で分かる。

**サーバーが落ちていても拡張は壊れた顔をしない**（#861）＝popup.html 等は `http://localhost:51731/...` を直接指しており、繋がらなければスクリプトも CSS も読めないまま HTML の骨だけが素のまま縦一列に潰れて出る（CSS・レイアウトのバグに見えるが原因はサーバー未起動）。`node scripts/open-dev-profile.cts --print` の `dev server:` 行、または `npm run ext:dev:browser` 実行時の警告で気付ける。

### 開発プロファイルの保存を実ライブラリから隔離する

開発ビルドは **別のネイティブメッセージングホスト名** `com.hologram.host.dev` に繋ぐ。ネイティブメッセージングの経路を決めるのはホスト名であって拡張 ID ではないので、ID を分けずに config dir とライブラリだけを分けられる。登録は:

```
npm run ext:dev:register
```

これは `node` を直接呼ぶ（解除は `npm run ext:dev:register -- uninstall`）。⚠️**かつては一度きりのスケジュールタスク経由だったが、その理由（コンテナ内の `reg add` は実 Chrome から見えない）は 2026-08-06 に失効し**（#1003・メモリ `sandbox-appdata-registry-divergence`）、**タスク経路は 2026-08-07 に撤去した**（#1006）。**登録の後、スクリプト自身が `reg query` で5つのキーを読み戻して各行の可否を出す**（旧記述「ここから確かめることはできない」は失効＝HKCU への書きも読みも実体）。読み戻しが合わなければ非ゼロ終了する。登録先は `~/.hologram-dev/`（ランチャーが `HOLOGRAM_CONFIG_DIR` を固定するので、Chrome が起動した bridge は実ライブラリを見られない）。

⚠️**読み戻しが緑でも、それは「Chrome がホストを見つけられる」までしか証明しない**＝端から端までの裏取りは開発プロファイルからの保存成否と `~/.hologram-dev/bridge.log`。**人手なしで経路だけ確かめたいなら diag ページ**＝`chrome-extension://<拡張ID>/diag.html` は読み込みだけでネイティブホストへ ping を投げるので、URL を引数に渡して開けば `bridge.log` に `launched argv=[…] saveFolder=C:\…\.hologram-dev\library` と `recv type=ping` が積まれる（2026-08-07 の #1006 の検証はこれで取った）。保存したものを見るのは #283 のサンドボックスアプリ（`node scripts/sandbox-app.cts`）。

どのホスト名を焼くかは**ビルドのコマンド**で決まる（`wxt` = 開発 / `wxt build` = release）。`import.meta.env.DEV` は NODE_ENV に従うので使わない＝テストランナー経由の release ビルドが開発ホストを向く（実際に起きた。`build-extension.cts` の禁止語検査が捕まえた）。

### release 検証

`npm run build:ext` は Chrome と Firefox の自己完結 release を生成し、`scripts/build-extension.cts` が検査する。

1. manifest の全 resource、固定 ID を生む `key`、コードが名指しする `capture.js` と診断ページ、Native Messaging permission、ワーカーがビルドIDを実際に持っていること。
2. localhost・Vite client・source map・**開発用ホスト名**が release に混ざっていないことを、全テキスト生成物で確認する。ZIP はこの検査を通った Chrome release だけを `npm run zip:ext` で梱包する。

読むべき性質:

- **拡張の色はアプリのトークンから生成される**（#270）。各 build は WXT の前に `scripts/gen-extension-tokens.cts` を走らせる。
- resident は global owner を1世代だけ持ち、再注入のたびに前世代の listener・observer・timer・UI を落とす（#727）。
- 固定IDを保つ `key` は `extension/wxt.config.ts` にある。ID・Native Messaging 保存・5プラットフォームのクリック/ドラッグ保存は実機確認の対象である。

- 手元の実ターミナルから動かすだけなら `npm start`、ワンクリック起動は `restart-app.ps1` を右クリック →「PowerShell で実行」でよい。
- **CDP 検証を伴う起動は `restart-app.ps1`**（下記「コード変更の反映」）。⚠️**かつてはここから一度きりのスケジュールタスク `HologramLaunch` を経由していたが、その理由（MSIX 仮想化）は 2026-08-06 に失効し**（#1003）、**タスク経路は 2026-08-07 に撤去した**（#1008・実測は下記）。

## 開発ルール：コード変更の反映（確認なし再起動）

> **npm スクリプトの置き場**: `build`・`dev`・`typecheck`・`dist`・`start` は `app/package.json`。`app/` は npm ワークスペースなので**リポジトリ直下から** `npm run build --workspace=app`（`-w app` でも可）で実行できる。もちろん `cd app && npm run build` でもよい。リポジトリ直下の package.json が持つ固有のスクリプトは lint 系（`lint`・`lint:fix`・`format`）と `test`・拡張機能の `*:ext` だけ。

main・preload・renderer のどれを変更した場合も、**`npm run build --workspace=app` でビルド → 確認を取らずに再起動**（electron-vite が3面（`src/main`・`src/preload`・`src/renderer`）を `app/out/` へ一括ビルドする。旧来あった「renderer だけは再起動不要」の特例は無い＝ビルド出力を読む起動である限り、読み直すには再起動が要る）。

**⚠️ ただし `electron-vite dev`（HMR）を使えば、この往復そのものが要らない**（2026-08-06 解禁・#1003）:

```
REMOTE_DEBUGGING_PORT=9222 npm run dev --workspace=app
```

renderer は HMR、main は保存で自動再起動。**CDP も同時に使える**＝electron-vite の `startElectron()` がこの環境変数を読んで `--remote-debugging-port` を Electron へ渡すので、`node scripts/cdp-verify.cts eval …` がそのまま通る（実測＝`document.title` と実ライブラリ 10.2K 件を取得できた）。任意の引数を足したいなら `ELECTRON_CLI_ARGS`（JSON 配列）も読まれる。

**使い分けは下の「CDP で繋ぐ先の選び方」の表を見る**（実機と HMR、どちらでどこまで確認できるかをそこで一覧にした）。

⚠️**旧記述「`electron-vite dev` は使わない」の理由（MSIX 仮想化）は失効した**＝下の「起動経路」を参照。

native-host のブリッジ（Chrome が起動する常駐プロセス）を変更した場合は `npm run build:native-host-bridge --workspace=app` でバンドルを作り直してから `node native-host/install.cts` で `~/.hologram` へ再配備（アプリ再起動は不要）。native-host のブリッジ（Chrome が起動する常駐プロセス）を変更した場合は `npm run build:native-host-bridge --workspace=app` でバンドルを作り直してから `node native-host/install.cts` で `~/.hologram` へ再配備（アプリ再起動は不要）。

**再起動は `restart-app.ps1` で行う**（停止 ＋ 起動をまとめてある）。Claude が実行する最小形:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <repo>\restart-app.ps1
```

**止める相手は実行ファイルのパスでなくコマンドラインで選ぶ**（2026-08-05 修正）。旧版は `Get-Process electron | Where-Object { $_.Path -like '*hologram*' }` だったが、**worktree の検証で起動した Electron も同じ条件に合う**——ハーネスは自分のツリーの `node_modules/electron` を使い（`scripts/lib-electron-path.cts`）、worktree はリポジトリの内側にあるのでパスに `hologram` が入る。並行セッションが `test-app-*.cts` や `e2e/flows` を回している最中に実機を再起動すると、相手のテストを巻き添えで殺して赤にできてしまう（隔離されているのは config とライブラリであって、プロセスの選び方ではない）。`--remote-debugging-port=9222` を付けるのは `restart-app.ps1` だけなので、これで実機だけを名指しできる。⚠️**フィルタには browser プロセスとその renderer 子プロセスの2つが掛かる**（Chromium が同じフラグを子へも渡す）＝browser を殺せば子も落ちるので実害は無いが、「1個だけ返るはず」と読むと数が合わない。

ユーザーのワンクリックは `restart-app.ps1` を右クリック →「PowerShell で実行」（窓は出るが終了時に自動で閉じる）。`restart-app.ps1` は graceful close ＋ 起動 ＋ 目印の確認をまとめてある。

### 起動経路

**`restart-app.ps1` は `Start-Process` で electron.exe を直接起こす**（スケジュールタスクを経由しない）。

- ⚠️**かつては一度きりの `HologramLaunch` タスクを挟んでいた。理由は2つとも消えた**＝①**MSIX 仮想化は 2026-08-06 に失効**（#1003）＝Claude Code 本体が MSIX パッケージの外（`AppData\Roaming\Claude\claude-code\<version>\claude.exe`）へ移り、そこから起動したシェルはパッケージアイデンティティを持たない。**FS 書き・HKCU 書き・HKCU 読み・dev で起こした Electron の `userData` の4経路すべてで実体を確認済み**（HKCU の書きはユーザーが regedit で目視）＝直接起動が登録を壊すことはもう無い。②**その後タスクが唯一買っていた「起動元シェルの子にならない」も `Start-Process` で得られる**＝2026-08-07 に実測（#1008・下の「実測」）。**タスクの登録・アクションのドリフト検知・自己修復の約40行は撤去した。**
- **撤去で1つ失敗モードが消えた**＝`Start-ScheduledTask` は Execute が実在しなくても成功を返す（過去に踏んで自己修復を足した経緯があった）。`Start-Process` は実行ファイルが無ければ throw する。
- ⚠️**代わりに1つ増えた＝環境変数の継承**（実測）。タスクはユーザープロファイルから環境を組み立てるが、`Start-Process` は**呼び出したシェルの環境をそのまま渡す**。検証ワークフローが `HOLOGRAM_CONFIG_DIR` を export 済みのシェルからこのスクリプトを叩くと、**実機がサンドボックスの config で上がる**（空のライブラリが出る＝データ消失に見える）。`restart-app.ps1` は spawn の直前に `HOLOGRAM_*` と `ELECTRON_RENDERER_URL` を落とし、`APPDATA` を `[Environment]::GetFolderPath('ApplicationData')`（env の上書きを見ないシェルフォルダ）から復元する。
- **実測**（2026-08-07・#1008。実機を止めないよう `:9223` ＋ 隔離 config で実施）: ①`Start-Process` で起こした Electron は、起動元の `powershell.exe` とその上のエージェントシェルの両方が終了した後も生存（親 pid は死んだ番号のまま＝孤児化が正常）②その個体へ `scripts/cdp-verify.cts` が接続でき、`document.title` を取得③`--remote-debugging-port=9223` のコマンドラインフィルタがその個体を選び、同時に `--remote-debugging-port=9222` のフィルタは**空**を返した（別ポートの個体を巻き込まない）。停止→再起動の一往復も新スクリプトで通した。
- ⚠️**`HologramLaunch` タスクはこのマシンに残っている可能性がある**＝スクリプトはもう作らず・直さず・使わない。**削除するかは未決**（ユーザーがショートカットから叩いているかもしれない＝#1008 にコメントで残してある）。残ったまま放置するとリポ移動でアクションが腐り、`Start-ScheduledTask` は成功を返すので**何も起きないのに成功に見える**。
- ⚠️**この目印は `restart-app.ps1` 以外で起動された個体には無い**＝2026-08-06 に実際にそういう個体（`electron.exe "<repo>\app"` だけ）が動いていて停止できなかった＝#1004。**タスクを外しても入口が1本なのは変わらない**（むしろ「タスク経由か否か」という見かけの2系統が消えた）。
- ⚠️**仮想化が復活する可能性は残る**＝#1003 の発見自体が Claude Desktop の構成が変わったことの証明で、逆方向にも変わりうる。判定は `(Get-Item <path>).Target` が `…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\…` を返すかどうか。
- `npm start` 経由は cmd ウィンドウが出るため使わない（electron.exe はGUIアプリなのでコンソールは出ない）。

### CDP で繋ぐ先の選び方（#1010）

`node scripts/cdp-verify.cts eval "…"` / `shot` が繋げる相手は現在4種類ある。**この表が正**＝種類が増減したらここだけ直す（`scripts/cdp-verify.cts` のヘッダーと skill `run-hologram` はここを指すだけで、起こし方・ポートの記述を持たない）。

| 相手 | 起こし方 | ポート | いつ使う |
| --- | --- | --- | --- |
| 実機 | `restart-app.ps1`（`Start-Process` で `electron.exe` を直接起動。旧 `HologramLaunch` タスク経由は2026-08-07に撤去＝#1008。**このマシンにタスク自体が残っている可能性はあるが、起動経路としては使っていない**） | 9222 固定（スクリプトが `--remote-debugging-port=9222` を付与＝実機を名指しする唯一の目印） | 実ライブラリでの最終確認・キャプチャ経路（拡張→bridge）の確認だけ |
| HMR（開発サーバー） | `REMOTE_DEBUGGING_PORT=9222 npm run dev --workspace=app`（#1003） | 9222（`electron-vite` がこの環境変数を読んで Electron へ同じ引数を渡す） | UI を作り込む間（ビルド→再起動の往復が消える）。⚠️`ensureHostRegistered()` を呼ばない設計なのでキャプチャ経路の確認には使わない。実機とは single-instance lock で排他＝同時には起こせない |
| サンドボックス | `node scripts/sandbox-app.cts`（可視・常駐の2台目） | 動的（9333〜9432・作業ツリーのパスから決まり `.sandbox/instance.json` に記録）。接続は `CDP_PORT=sandbox node scripts/cdp-verify.cts …`（そのツリーの記録から解決＝番号を持ち回らない）。終了は `node scripts/sandbox-app.cts stop` | 見た目・モーションの確認（隠しウィンドウでは CSS transition や inline 配置が再現しない）。HKCU・共有 `~/.hologram` に触れないので実機・他 worktree と安全に共存する |
| テストハーネス | `test-app-*.cts` のうち CDP を使うもの（`test-app-asset-csp.cts`・`test-app-renderer-origin.cts` など。大半の `test-app-*.cts` は `HOLOGRAM_SMOKE_EVAL` 経由の結果だけを stdout へ返すので CDP ポート自体を持たない）が `spawn` 時に自前で立てる | 動的（`freePort()` が `net.createServer().listen(0, …)` で OS に空きポートを確保→即 close。サンドボックスの `instance.json` のような記録は無い＝スクリプト自身が同じプロセス内で `cdpList()` / `listeningPid()` を呼んで使い切り、外部への公開はしない） | 通常は外部から `cdp-verify.cts` を繋がない（スクリプトが自己完結）。ハングを外から診るときだけ `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` のコマンドラインから `--remote-debugging-port=NNNN` を読んでポートを特定する |

## 検証ルール（隔離4段構え）

**検証は隔離インスタンスで行う（既定）。実機 :9222 に触るのは「実ライブラリでの最終確認」と「キャプチャ経路（拡張→bridge）」だけ**。

1. **挙動・自動テスト＝SMOKE 隔離**: `HOLOGRAM_SMOKE=1` ＋ `HOLOGRAM_CONFIG_DIR=<tmp>`（雛形は `scripts/test-app-tagtypes.cts`）。隠しウィンドウ・自動終了。別プロセス・別 config なので、**ユーザーが本体アプリを操作していても結果に混ざりようがない**。実機を使う限り、ユーザーの操作が混入したかを事前に防ぐ手段も、事後に検知する手段も無い（2026-07-20 に実測で確認＝CDP `Input.*` で撃ったイベントは人間の操作と同じく `isTrusted: true` になり区別できない。ページ内合成の `el.click()` だけが `false`）。だから防ぐのでなく、混入しても困らない場所へ検証を寄せる。
2. **見た目・モーション＝サンドボックスインスタンス**: `node scripts/sandbox-app.cts` で**可視・常駐の2台目**を起動する（CSS transition や inline 配置は隠しウィンドウでは再現しないため、従来は実機に頼っていた層）。起こし方・接続コマンド・ポートの決まり方は上の「CDP で繋ぐ先の選び方」参照。ここでは安全性だけ＝**cdp-verify はサンドボックスポートに繋ぐ前に、そこで動いているアプリがこのツリーから起動されたものかを突き合わせて、違えば止まる**＝並行 worktree が同じポートを取り合っても、他人のインスタンスを自分のものとして駆動したまま成功する経路が無い（#640。ポートの決定性は「毎回同じ番号へ戻れる」ための便宜で、安全弁は突き合わせの方）。`HOLOGRAM_SANDBOX=1` でホスト登録をスキップするため **HKCU・共有 `~/.hologram` に一切触れない**＝実機と安全に共存でき、worktree ごとに独立するので並行セッションの検証が衝突しない。インスタンスロックは（アプリ名, userData）単位で userData は config dir に固定されている＝2台目の起動をロックは妨げない。**実データでしか出ない問題（実ライブラリの多様性・規模で崩れる表示や性能／特定の実投稿で再現するバグ）は `--real` でシードする**（下記）。
3. **実入力・実ピクセルの自動テスト＝Playwright（`npm run test:e2e`・#14）**: 上の1と2の間を埋める層。ケースごとに使い捨ての config dir とライブラリを作り、`HOLOGRAM_SANDBOX=1` ＋ `HOLOGRAM_START_INACTIVE=1` で**見えるが最背面のウィンドウ**を起こし、実ポインタ・実キーで駆動して要素単位のスクリーンショットを撮る。1と違って合成イベントではないので「クリックが届かない」型が捕まり、2と違って人手も常駐インスタンスも要らない。**ユーザーの前面は奪わない**（フォーカスを取らずに z 順の最背面へ送る＝入力は CDP 経由でフォーカス不要）。詳細は `e2e/README.md`。
4. **実機（:9222）／HMR**: `restart-app.ps1` で起動したウィンドウ、または `REMOTE_DEBUGGING_PORT=9222 npm run dev --workspace=app` の HMR へ CDP 接続する。起こし方・ポート・使い分けは上の「CDP で繋ぐ先の選び方」参照。⚠️**旧記述「直接起動はコンテナ内＝仮想化でキャプチャが壊れる」は失効**（#1003）。実機での検証は短く済ませ、混ざった疑いがあれば撮り直す。

**並行セッションで共有のままの装置**（worktree でもサンドボックスでも隔離されない）: `node native-host/install.cts` の再配備・拡張のリロード・実機の再起動の3つ。並行セッションの実行中にこれらを行う時だけは、相手の検証を壊しうるので重ねない（`ccd_session_mgmt` で実態確認）。**この確認先は並行セッションであって、ユーザーではない**＝重なりが無いと分かったらそのまま実行する（可否を尋ねて止まらない）。「共有資源だから」は他セッションを調べる理由であって、検証を保留する理由ではない。

- **稼働中の実機は確認なく駆動してよい**（リロード・カード選択・ビュー開閉・スクショまで一気に自律で）。ユーザーの作業状態を保存する義務も、事前に声をかける義務も無い（2026-07-19 にユーザーが明示。それ以前は「今は触らないでください」と伝える運用だったが、**チャットの声かけはユーザーが画面を見ている保証が無く警告として機能しない**＝2026-07-20 に撤去）。開いたオーバーレイを閉じる程度の後片付けはする。
- **実機で異常を見たら、まず自分の駆動の残留を疑う**（ユーザー操作のせいにする誤帰属を先に潰す）。1スクリプトに多数のフローを詰めない＝駆動は目的1つに絞る（絡むと解析不能になる）。
- スクショは画像トークンが重いので、数値で足りる検証（computed style / コントラスト比など）は画像を撮らず JS 計測で済ます。

### 保存が失敗した時に見るログ（`~/.hologram/`）

**`capture.log` が保存イベントの正本**＝1行1イベントの JSON。**1つの保存は複数行になり、`saveId` で束ねて読む**（保存を試みたページが振る値で、拡張・サービスワーカー・ネイティブホストの3プロセスを通って同じ値が乗る）。**保存の可否を知りたければここを読む。**

#### まずこの3つを読み分ける

この読み分けを誤って**3回続けて誤診し、うち1回はユーザーへ誤った警告を出して撤回している**（#519）。記録の形が答えを持つようになったのはその後。

| 記録の形 | 意味 |
| --- | --- |
| `activate/ok` があって、その後に `save/begin` が**無い** | **UI を開いただけで保存していない＝正常。** ユーザーが Alt+S を押して画面を見ただけ、はここに来る |
| `save/begin` があって、その `saveId` の終わりの行が**無い** | **保存が始まって終わらなかった＝不具合。** どこまで進んだかは終わりの行の `reached`、それも無ければ `save/begin` の時刻が最後の手がかり |
| `phase` が `cancel` の行 | **ユーザーがやめた**（Esc・右クリック・2回目の起動でのトグル・一括取込の停止ボタン）。沈黙ではない |

⚠️ **1行目は Alt+S の面にしか当てはまらない。** 下の「面ごとに何が出ないか」を先に見ること＝**`activate` が無いことは異常ではない面がある**ので、`activate` を探して見つからないことを手がかりにしてはいけない。**判定に使えるのは `save/begin` の有無**で、これは全4面で出る。

#### 面ごとに何が出ないか

`activate` を書くのは**拡張のアイコンとショートカットだけ**（`chrome.action.onClicked` / `chrome.commands.onCommand`）。画像の角のホバー保存ボタンとドロップゾーンは**常駐スクリプト**で、ユーザーの操作が拡張の起動を経由しない＝**この2面は成功しても失敗しても `activate` を書かない。**

| 面（`via`） | 出る | 出ない |
| --- | --- | --- |
| `capture`（Alt+S） | `activate` → `select` / `permalink` / `duplicate` → `save` → `capture` / `crop` / `metadata` → `bridge`、返らなければ `result` | — |
| `hover-save`（画像の角のボタン） | `save` → `metadata` / `image` → `bridge`、返らなければ `result` | **`activate`・`select`・`permalink`**（押した絵がそのまま対象なので選ぶ段が無い） |
| `drop-zone`（ドラッグ） | `hover-save` と同じ＋`duplicate` | **`activate`・`select`・`permalink`** |
| `bulk-intake`（一括取込） | `activate`（起動時1回）→ `bulk/begin` → 1件ごとに `save` → `metadata` → `bridge`、→ `bulk/ok` または `bulk/cancel` | `select`・`permalink`・`crop`・`capture`（画面を撮らない） |

**この差が #507 の調査を1度外させた**＝ユーザーが実際に固まりを踏んだのは `hover-save` の面で、そこは `activate` も出さないので `capture.log` が完全に無音だった。最初の読みが Alt+S を疑ったのはそのため。今は全4面が `save/begin` と `result` を書くので、無音の面は無い。

#### `stage`＝保存のどの段か

保存が通る順。経路（クリック保存・一括取込・ドラッグ保存）によって通らない段がある。

| 値 | 意味 | 書き手 |
| --- | --- | --- |
| `activate` | 拡張がページ内 UI を注入した。**保存ではない**＝まだ何も書かれておらず、ここで止めるのは普通のこと。`fail`＝注入自体ができなかった（下記） | サービスワーカー |
| `select` | どの投稿を保存するかの待ち。`fail`＝投稿でないものがクリックされた（セレクタが壊れた疑い）／`cancel`＝選ばずに閉じた | ページ |
| `permalink` | 選んだ投稿の URL を読む段。読めなければ保存は成立しない | ページ |
| `duplicate` | 既に保存済みかをライブラリに訊ね、警告への答えを待つ段（#34） | ページ |
| `save` | 保存そのもの。`begin`＝サービスワーカーが受け付けた／`cancel`＝進行中の保存をユーザーがやめた | サービスワーカー・ページ |
| `capture` | スクリーンショットの撮影（クリック保存だけ） | サービスワーカー |
| `crop` | 撮った絵の切り抜きをページへ頼んで待つ往復 | サービスワーカー |
| `metadata` | プラットフォームの API から投稿情報を取る段 | サービスワーカー |
| `image` | ドラッグ保存でどの絵を書くか決める段 | サービスワーカー |
| `bridge` | ネイティブホスト。`begin`＝受け取った／`ok`・`fail`＝書き終えた結果 | サービスワーカー・ホスト |
| `result` | ページが結果を待つ段。**返って来なかった時だけ**出る（#507） | ページ |
| `bulk` | 一括取込の run 全体（#362）。多数の保存を含むので `saveId` は載らない | ページ |
| `unknown` | 段の付いていない例外。未捕捉の例外・未処理の Promise 拒否もここに載り、`uncaught` フィールドが発生元（`background`／`content`／`diag`／`options`）を示す（#727） | サービスワーカー・ページ |

#### `phase`＝その段で何が起きたか

| 値 | 意味 |
| --- | --- |
| `begin` | その段に入った。**対になる行が来ないことが答えになる** |
| `ok` | 通過した・完了した |
| `fail` | そこで失敗し、保存は終わった |
| `cancel` | ユーザーがやめた |
| `skip` | 何もせず抜けた（http(s) でないタブ／重複警告に「やめる」と答えた） |

#### `via`＝どの面が待っていたか

`stage=result`（ページが結果を待って返って来なかった）の行だけが持つ。**同じ「返って来ない」でも、どの面でスピナーが回っていたかは別の話**＝#507 の最初の読みが Alt+S を疑って外したのはこの欄が無かったため。

| 値 | 面 |
| --- | --- |
| `capture` | Alt+S のキャプチャバナー |
| `hover-save` | 画像の角のホバー保存ボタン |
| `drop-zone` | ドラッグのドロップゾーン |
| `bulk-intake` | 一括取込の1件 |

#### `activate/fail`＝押しても何も起きなかった（#269）

**アイコンや Alt+S を押したのに、ページに何も出なかった**時の行。クリック保存は「サービスワーカーが `capture.js` を注入し、注入されたスクリプトがバナーを描く」構造なので、**注入自体が失敗すると失敗を伝える面がページ上に無い**＝完全な無反応になる。ドラッグ保存と画像の角のボタンは常駐スクリプトが自前で描くので影響を受けない＝**「ドラッグは効くのにアイコンだけ死んでいる」は正常な壊れ方ではなく、この行を探す合図**。

その状態は画面にも出る（拡張が持つ唯一の面＝**ツールバーのアイコン**）。

| 見えるもの | 意味 | 直し方 |
| --- | --- | --- |
| アイコンに赤い `!`・ツールチップが「拡張機能のファイルを読めない」 | 拡張の展開先が消えている（フォルダを移した・消した）。**以後どのページでも全部失敗する** | `chrome://extensions` で「再読み込み」。2回目に押すとその画面が自動で開く |
| アイコンに赤い `!`・ツールチップが「このページでは保存を開始できませんでした」 | 拡張は健全で、そのページが注入を断った（Chrome ウェブストア・ポリシーで止められたページ・押した直後に閉じたタブなど）。**直すものは無い** | 無し。2回目に押すと診断ページが開く |

区別しているのは Chrome の例外文言ではなく**拡張が自分のファイルを読めるかの実測**（`fetch(chrome.runtime.getURL(...))`）＝文言は契約ではないので、そちらで分岐すると Chrome の言い回しが変わった日に案内が反転する。⚠️**ファイルが読めない側では診断ページ自体が開けない**（`ERR_FILE_NOT_FOUND`）ので、逃がし先が `chrome://extensions` になっている（実測＝`scripts/e2e-extension-inject-failure.cts` が毎日測り直す）。

印はタブ単位で、そのタブが遷移・クローズすれば消える（Chrome 側が消す）。`activate/fail` の行は**必ず拡張側のリングバッファにも積む**＝保存が1つも始まっていないので、ホストへ届かなかった時に他へ残る記録が無い。

#### 拡張を更新した後、開いたままだったタブ（#594）

拡張をリロードすると（リリース後は Chrome の自動更新でも）、**その時点で開いていたタブの常駐スクリプトは拡張から切り離される**＝「孤児」。新しい版は正常で、取り残されているのはそのタブだけ。

| 見えるもの | 実際に起きていること |
| --- | --- |
| 保存ボタンを押すと「拡張機能が更新されました。このページを再読み込みしてください」 | そのタブが孤児。**そのページを再読み込みすれば直る**（Chrome の再起動も拡張の再インストールも要らない） |
| 写真の角の印・保存ボタンが、スクロールした拍子に消えた | 同じく孤児化。常駐スクリプトが自分の描いたものを撤去した＝ページは拡張を入れる前の状態に戻る |
| Alt+S は効くのに、ホバー保存とドラッグ保存だけ効かない | 同じく孤児化。Alt+S はワーカーが**新しい**スクリプトを注入する経路なので影響を受けない＝**「ドラッグは死んでいるのにアイコンは生きている」は孤児化の合図**（`activate/fail` の逆パターン） |
| Alt+S で投稿を選んだ瞬間に同じ案内が出た | Alt+S を押してから投稿をクリックするまでの数秒の間に拡張が更新された。注入済みのキャプチャスクリプトもその時点で孤児になる |

⚠️**この失敗は `capture.log` に行を残さない。** 記録行もサービスワーカー経由で書かれるので、切れているのと同じ経路を通る（`capture-log.ts` の try/catch に飲まれる）。**画面のバナーが唯一の手がかり**で、ホストもアプリも健全なまま＝`node scripts/self-test.cts` は全項目 PASS になる。

⚠️#594 より前は、この状況が**「保存が終わらないため中止しました（繰り返す場合は Chrome を再起動）」**という顔で出ていた。古いスクリーンショットやログの読み直しでその文言を見たら、ホストの不調ではなくこちらの可能性がある。

#### そのほかの欄

`saveId`（上記）・`captureId`（保存物のファイル名の元。ホストが決める）・`reached`（その保存が通過し終えた段の並び＝**どこまで進んで黙ったか**）・`url`・`metaOk`（投稿情報が取れたか）・`metaReason`（取れなかった理由）・`mediaCount`。`bulk` の行は run の集計（`seen` / `saved` / `skipped` / `deferred` / `unavailable` / `ageRestricted` / `failed`）を持つ。

⚠️ **行の順番はイベントの順とは限らない＝`ts` で並べて読む。** 拡張が出す行はホストのプロセスが起きるのを待つので、同じ保存のあとの行に追い越されることがある（各行の `ts` は作られた時刻）。連続して出た行は**1本の接続にまとめて**送られる（接続1本につきホストのプロセスが1つ起きるため・#323）ので、後続の行は最大1秒ほど遅れて着く。

⚠️ **`bridge/ok` は「ホストが書き終えた」までで、ライブラリに出たことではない。** 取込（`.hologram-inbox` → DB）はアプリの別プロセスで、記録は `logs/main.log` の `inbox applied` 行にある＝`captureId` で突き合わせる。

`metaReason` の値は4つ。`fetchFailed`（こちらの取得が壊れた＝**再試行で直りうる唯一の値**）／`unavailable`（投稿が無い＝削除・アカウント消滅・存在しない id）／`protected`（鍵付き）／`ageRestricted`（年齢制限）。**後ろの3つは何度やり直しても同じ結果になる。** とくに `ageRestricted` は**投稿が生きているのに取れない**状態＝X の埋め込み用 API（`cdn.syndication.twimg.com`）は常に匿名で、X は生年月日を持たない閲覧者に成人向けコンテンツを出さない。ブラウザで開けるのに保存できない、が正常な挙動として起きるのはこの値のときだけ（#505）。

⚠️ **`bridge.log` は「どの投稿の話か」を一切書かない**＝書かれるのは `launched …`（Chrome がホストを見つけて起動できた証拠）と `recv type=…` だけ。**ここに投稿の URL が無いことは、その保存が失敗した証拠にも、ホストへ届かなかった証拠にもならない**（2026-07-29・#492 の調査で2セッションが続けてこれを誤読した。実際はその保存は `capture.log` に記録されており、しかも `phase:"ok"` だったことが不具合の本体だった）。ホストが起動したかを見るのがこのログの唯一の役割。

ホストまで届かなかった分は拡張側の chrome.storage リングバッファにも積まれ、`chrome-extension://<id>/diag.html` で読める。

**同じ診断ページの `protocol` が、拡張とホストの契約版を並べて出す**（#205）＝`extension` はページを開いた拡張の版、`host` は ping に答えたホストが名乗った版、`skew` が `host-old`（アプリ側が古い）／`host-new`（拡張が古い）／`match`。`hostAnswered:false` はホストが起動できていない場合で、その時 `host` が null なのは版が古いからではない（`nativeTest` が理由を持つ）。⚠️**`hostAnswered:true` で `host:null` は「版を名乗らないホスト」＝この仕組みより前のバイナリが `~/.hologram/bridge.js` に残っている**という意味で、`skew` は `host-old` になる。保存が通っていてもこの状態は正常ではない（配備し損ねたホストが動き続けたのが #511）。保存側では、ずれている間は保存のたびにバナーが「Hologram アプリを更新してください」（逆なら拡張）を出す＝**保存は止まらない**。

### サンドボックスへの実データシード（`--real`・#286）

`node scripts/sandbox-app.cts start --real` で、フィクスチャの代わりに**実ライブラリのスナップショット**をサンドボックスへ入れる。DB は backup API の静止コピー（実ライブラリは読むだけ）、メディアは DB が持つ縦横比で生成した**スタンドイン画像**＝レイアウトと件数は実データ相当のまま、実物の画像は1枚も入らない。特定の投稿を実物で再現したい時だけ `--capture <captureId>` でその投稿のファイルだけコピーする。シード済みのサンドボックスを入れ替えるには `--reseed`（起動中は拒否＝先に `stop`）。

- **実ライブラリのある機械でしか動かない**（クラウド実行環境には無い）。そちらは `scripts/gen-dummy-library.cts` の合成ライブラリで代替する。
- **起動前に隔離を機械検査する**＝config がサンドボックスを指すこと・スナップショットに絶対パスが無いこと・全メディア参照がサンドボックス内へ解決すること。1件でも引っかかれば起動しない。
- **実データ入りサンドボックスのスクリーンショットは公開物（PR/Issue/ドキュメント）へ貼らない**。DB のスナップショットには実際の投稿本文・作者が入っており、`--capture` を使えば実画像も入る。窓の中に常時警告が出るので、貼ろうとしている画像が実データかは撮った絵で判別できる。
- 再現しないもの＝動画の再生（動画ファイルはスタンドインを作れない）・画像デコードの実コスト（スタンドインは長辺 `--max-dim`（既定512）へ縮めてある）・ゴミ箱の中身。

## 配布物生成

```
npm run dist --workspace=app
```

electron-builder, win/nsis。

- 出力 `app/dist/win-unpacked/` — スタンドアロン。`Hologram.exe` を直接実行可。ASCIIパスへ置けば native-host のランチャもASCIIになり日本語パス問題が解消。
- **`npmRebuild: false` を設定してある**（`app/package.json` の `build`）。electron-builder は既定でネイティブモジュールを Electron 向けに再ビルドするが、唯一のネイティブ依存 `better-sqlite3` は N-API（`binding.gyp` の `NAPI_VERSION=10`）でビルド済みバイナリを同梱しており、同じ `.node` が Node と Electron の両方で動く＝再ビルドは不要。既定のままだと node-gyp が走り、C++ ビルドツールが要求される（2026-07-24 実測: 同一バイナリが Node 24 と Electron 43＝`NODE_MODULE_VERSION` 137 と 148 の双方でロード・WAL・FTS5 trigram の日本語部分一致まで動作）。**N-API でないネイティブ依存を足すときはこの設定を見直すこと**（黙って再ビルドが飛ぶ）。better-sqlite3 公式の troubleshooting は今も electron-rebuild を案内しているが、N-API 化前の記述。
- **`app/package.json` の `electron` は範囲指定でなく固定版**（`43.2.0`。`^43.0.0` に戻さないこと）。electron-builder は配布するランタイムの実バージョンを知る必要があり、まず `<projectDir>/node_modules/electron` を読む。`app/` は npm ワークスペースなので electron はリポジトリ直下へ巻き上げられて `app/node_modules` には存在せず、electron-builder は `app/package.json` の指定へフォールバックする＝そこが範囲だと解決できず `Cannot compute electron version from installed node modules` で停止する（2026-07-28 実測。25系でも同じ＝バージョン退行ではなく #156 のワークスペース化の影響）。electron-builder 自身が案内する回避は「package.json で固定版にする」か「設定に `electronVersion` を書く」の2つで、後者は同じ版を2箇所に書くことになるため前者を採用（VS Code など実運用の Electron アプリも固定版が通例）。
- **`electronFuses` で `grantFileProtocolExtraPrivileges: false` を焼いてある**（#7・[ADR 0022](decisions/0022-renderer-served-from-app-scheme.md)）。レンダラは `app://bundle` から配るので `file://` の追加特権はもう要らない＝Electron 公式チェックリスト 18 の「`file://` を避けて独自プロトコルを使う」を最後まで満たす。⚠️**fuse はパッケージ済みバイナリにしか効かない**＝`npm run check` でも `node scripts/run-app-tests.cts`（unpackaged Electron）でも何ひとつ確かめられない。この行を触ったら `npm run dist --workspace=app` して `app/dist/win-unpacked/Hologram.exe` を実際に起動すること。焼けたかどうかは `node -e "require('@electron/fuses').getCurrentFuseWire('app/dist/win-unpacked/Hologram.exe').then(w=>console.log(w))"` で読める（`48`=無効・`49`=有効）。他の fuse は Electron の既定のままで、点検は別件。
- **`asarUnpack` に `better-sqlite3` を入れてある**。`.node` は asar 内から読めないため、これが無いと配布ビルドでのみ DB が開けない。将来コード署名を入れる際は、asar の外に出たこのバイナリも署名対象に含める。
- **ローカル推論のランタイム（#831）で `files` / `asarUnpack` が増えた**。`@huggingface/transformers` が引き連れてくる3つ（onnxruntime-node・onnxruntime-web・sharp）はいずれもネイティブか、asar 内から開けないファイルを持つ。
  - `asarUnpack` に `onnxruntime-node/**`・`onnxruntime-web/dist/**`・`sharp/**`・`@img/**`。前2つは `.node` と `.dll`、および **file:// URL で開かれる `.wasm`** のため（asar の中は OS から見えない）。パスの読み替えは `src/main/lib-ml-protocol.ts` の `asarUnpackedPath` が1か所で持つ。
  - `files` の除外3行で **onnxruntime-node のプリビルドを win32-x64 だけに削る**。同梱は全プラットフォーム分あり（2026-08-03 実測＝`bin/napi-v6` 合計 211MB・win32-x64 60MB / win32-arm64 65MB / darwin-arm64 35MB / linux-x64 34MB / linux-arm64 19MB）、残り151MB は Windows 版では死に荷物。
  - `onnxruntime-web/dist` は**丸ごと除外してから2ファイルだけ拾い直す**（125MB → 25MB）。拾うのは `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`＝transformers.js が WebAssembly 環境で選ぶ変種で、**`ml-worker.ts` が名指しするファイル名と一致していないと WASM 経路だけが配布ビルドで落ちる**（2026-08-03 に実際に踏んだ＝jsep 変種を同梱していたが実行時に asyncify を要求された）。ずれの検出は `scripts/ml-runtime.test.ts`（worker のソースと `package.json` を突き合わせる）。
  - **どれも N-API** なので `npmRebuild: false` のままでよい（上記 better-sqlite3 と同じ理由）。
  - インストーラ増分の実測（2026-08-03・同一ツリーで前後2回 `npm run dist`）＝`Hologram Setup 1.1.0.exe` **113,016,723 B → 145,081,850 B（+32,065,127 B / +30.6 MiB / +28.4%）**、`win-unpacked` 415MB → 533MB、`app.asar.unpacked` 27MB → 130MB。
  - ⚠️**`npm run check` はここを1バイトも踏まない**。この節を触ったら `npm run dist --workspace=app` してから `node scripts/test-ml-runtime.cts --exe app/dist/win-unpacked/Hologram.exe` を回すこと（fuse と同じ性質）。
- **NSIS ワンクリックインストーラ** は winCodeSign 展開時に **symlink 作成権限** が要る。**Windows 設定 → 開発者向け → 開発者モード を ON**（または管理者で実行）してから `npm run dist` で `Hologram Setup x.x.x.exe` が生成される。OFF だと winCodeSign 展開が失敗し `win-unpacked` のみになる（macOS用 dylib symlink でこける／コードの問題ではない）。
- `native-host/` は `extraResources` で `resources/native-host` に同梱。`app/src/main/native-host.ts` が `app.isPackaged` でパス解決（dev=`../../../native-host`＝electron-vite の `out/main/` からの相対）。

## アイコン（全再生成の単一導線）

ブランドの実体はホログラフィック虹色スクエア（ラスター）。**マスター 1 枚から全アイコンを再生成**する＝差し替えが半端にならない仕組み:

1. `assets/icon-master.png` を差し替える（正方・512px 以上推奨）
2. リポジトリ直下で `node_modules/.bin/electron scripts/make-icons.cjs` を実行

これで以下が一括更新される（`scripts/make-icons.cjs` の `TARGETS`/`BANNERS` が配置先の単一真実源＝増えたらここに足す）:

- `app/assets/icon.png`（512）＝Electron ウィンドウ/タスクバーアイコン。`app/package.json` の `build.win.icon` がこれを指し、electron-builder が配布時に `.ico` 化（PNG→ICO 自動変換）。dev では `src/main/lib-window.ts` の `BrowserWindow({icon})`＋`src/main/index.ts` の `app.setAppUserModelId` で反映。
- `extension/public/icons/icon{16,32,48,128}.png`＝ブラウザ拡張（生成manifest の `icons`/`action.default_icon`）。開発中は WXT が反映する。128 が manifest の最大サイズ＝256 は Chrome 側で使い道が無く同梱しない（#231 で確認・撤去）。
- `assets/icon.png`（256）＝汎用ブランドラスター/ファビコン。
- `assets/banner-{light,dark}.svg`＝README バナー。ワードマーク `Hologram` は保持し、先頭マークだけ虹色スクエアの埋め込み画像（base64）に差し替え。**日英別の 4 本でなく light/dark の 2 本**＝バナーは文字コピーを持たない（タグラインは README 側のテキスト＝#991）ので、言語で分ける理由が無い。

**マスターを差し替えたとき以外は実行しない**: 画素は忠実に再現されるが、PNG の圧縮結果が実行環境（Electron のバージョン）で変わるため、マスターが同じでも全派生アイコンに差分が出る。2026-07-22 の実測では 11 成果物すべてがピクセル単位で一致し、**ファイルサイズだけ 8〜11% 増えた**（バナー SVG は埋め込みラスタもマークアップも一致）。差分に中身が無いうえサイズは悪化するので、再生成は差し替え時に限る。過去のフレームへ戻す場合も再生成でなく git のブロブから復元する（前例は c49aa8e）。

Electron 経由で実行するのは nativeImage の高品質リサンプラを使うため（ウィンドウもネットワークも無し・リポへのファイル出力のみ）。拡張子が `.cjs`（周囲の `scripts/*.cts` と異なる）のは、Electron 43／Node 22 が `.cts` エントリを ESM 経由で読み `require('electron')` の注入が効かなくなるため＝classic CommonJS ローダを強制する必要がある（詳細はスクリプト冒頭コメント）。`.cts` へ戻さないこと。
