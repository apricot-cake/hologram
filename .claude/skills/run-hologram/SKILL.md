---
name: run-hologram
description: Hologram アプリを起動して動きを確かめる時の経路と、検証をどのインスタンスで行うかの選び方。「アプリを起動して」「実機で確認して」「画面を見て」「スクショを撮って」など、実際にアプリを動かす依頼で必ず使う。組み込みの汎用 Electron 起動手順は使わない（この開発機では壊れる）。
---

# run-hologram — アプリを起動して確かめる

正本は `docs/build.md`（「起動経路」「CDP で繋ぐ先の選び方」「コード変更の反映」「検証ルール（隔離4段構え）」）。ここはそこから実際に手を動かすときのコマンドだけを抜いたもので、矛盾があれば `docs/build.md` が勝つ。

**起動した先で CDP を叩くなら skill `verify-with-cdp` を先に読む**（合成マウスでレンダラを固める・スクショが固着/白紙/ハングする・拡張の診断は観測点を間違えると全部 false に見える、といった罠がまとまっている）。worktree からテストや拡張検証を回すなら skill `test-in-worktree`。

## 実機（:9222）は `restart-app.ps1` で起こす

**なぜこの経路を通すか（`HologramLaunch` タスクの去就・環境変数の継承・MSIX の失効を含む）は docs/build.md「起動経路」が正本**＝ここはコマンドだけ。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\apricot\local\dev\hologram\scripts\restart-app.ps1
```

停止（graceful close）と起動が中に入っている＝**別途 kill してから叩かない**。再起動は確認を取らずに行ってよい。

⚠️**手で止める必要がある時も、プロセスを探して殺さない**＝`--hologram-quit` を付けた使い捨ての Electron を起こすと、single-instance ロックの保持者（＝実機）が自分で終了する。⚠️**シェルに `HOLOGRAM_CONFIG_DIR` が残っていると、合図はその config を開いている個体（サンドボックス）へ行く**＝先に落とす。理由と経緯は docs/build.md「起動経路」が正。

```powershell
$electron = 'C:\Users\apricot\local\dev\hologram\node_modules\electron\dist\electron.exe'
(Start-Process $electron -ArgumentList '"C:\Users\apricot\local\dev\hologram\app" --hologram-quit' -Wait -PassThru).ExitCode  # 3=居た（終了を伝えた） / 0=誰も居ない
```

⚠️**下の強制終了は、フリーズして合図に応答しない時だけ**＝実行ファイルパスの一致は**同じツリーから起こしたサンドボックスと、Chrome が起こした native-messaging ブリッジ（同じバイナリで `bridge.js` を走らせている）も巻き添えにする**（2026-08-07 実測）。⚠️**このフィルタは browser と、同じ exe を使う子プロセス全部（renderer・gpu-process・utility）を返す**（Chromium が子へも同じ実行ファイルを使う）＝数が合わないと読まない。

```powershell
$electron = 'C:\Users\apricot\local\dev\hologram\node_modules\electron\dist\electron.exe'
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like "`"$electron`"*" -or $_.CommandLine -like "$electron *" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

⚠️**自分で `electron.exe` を直接起こす時は `HOLOGRAM_CONFIG_DIR` の残りに注意**＝直接 spawn は呼び出したシェルの環境を継承するので、実機がサンドボックス config で上がり空のライブラリが出る（`restart-app.ps1` は spawn 直前に `HOLOGRAM_*` を落としてこれを防いでいる）。

## 起動の前に: 変更が反映される状態か

`app/` は npm ワークスペース＝リポジトリ直下から `npm run build --workspace=app`（`typecheck`・`dist`・`start` も同様）。

| 直した場所 | 必要な操作 |
| --- | --- |
| main・preload・renderer のいずれか | `npm run build --workspace=app` → **再起動**（electron-vite が3面を`app/out/`へ一括ビルド。ビルド出力を読む起動では「renderer だけは再起動不要」の特例は無い）。**`electron-vite dev` で起こしている間はこの往復が要らない**＝renderer は HMR、main は自動再起動 |
| `native-host/` のブリッジ本体 | `npm run build:native-host-bridge --workspace=app` → `node native-host/install.cts` で再配備（アプリ再起動は不要。ビルドを飛ばすと配備は「バンドル未ビルド」で止まる） |
| 拡張機能 | 本体で `npm run build:ext`＝拡張が自分でリロードするのでクリックは要らない（#650・skill `verify-extension`） |

## どのインスタンスで検証するか（既定＝隔離）

**どれを選ぶか（実機／HMR／サンドボックス／テストハーネスの使いどころ）は docs/build.md「CDP で繋ぐ先の選び方」「検証ルール（隔離4段構え）」が正本**＝ここはコマンドだけ。実機（:9222）に触るのは実ライブラリでの最終確認とキャプチャ経路の確認だけ。

1. **挙動・自動テスト → SMOKE 隔離**: `HOLOGRAM_SMOKE=1` ＋ `HOLOGRAM_CONFIG_DIR=<tmp>`。雛形は `scripts/test-app-tagtypes.cts`。
2. **見た目・モーション → サンドボックス2台目**: `node scripts/sandbox-app.cts` で起動。**接続は `CDP_PORT=sandbox node scripts/cdp-verify.cts`**（そのツリーの記録から解決するので番号を持ち回らない）。終了は `node scripts/sandbox-app.cts stop`。
3. **実機（:9222）**: `restart-app.ps1` で起動したウィンドウへ CDP 接続。短く済ませ、混ざった疑いがあれば撮り直す。
4. **UI を作り込む間 → HMR（`electron-vite dev`）**: `REMOTE_DEBUGGING_PORT=9222 npm run dev --workspace=app`。`node scripts/cdp-verify.cts eval …` がそのまま通る。

CSS の transition や inline 配置は隠しウィンドウでは再現しないので、見た目の確認を SMOKE で済ませようとしない。

## 実機を触る時

- **稼働中の実機は確認なく駆動してよい**（リロード・カード選択・ビュー開閉・スクショまで）。開いたオーバーレイを閉じる程度の後片付けはする。
- **異常を見たら、まず自分の駆動の残留を疑う**。1つのスクリプトに多数のフローを詰めない。
- スクショは画像トークンが重い。computed style やコントラスト比など数値で足りる検証は JS 計測で済ます。

## 並行セッションと重ねてはいけない3つ

`node native-host/install.cts` の再配備・拡張のリロード・実機の再起動は、worktree でもサンドボックスでも隔離されない。他セッションが動いている時だけ重ねない（`ccd_session_mgmt` で実態を見る）。**確認先は並行セッションであってユーザーではない**＝重なりが無いと分かったらそのまま実行する。
