---
name: run-hologram
description: Hologram アプリを起動して動きを確かめる時の経路と、検証をどのインスタンスで行うかの選び方。「アプリを起動して」「実機で確認して」「画面を見て」「スクショを撮って」など、実際にアプリを動かす依頼で必ず使う。組み込みの汎用 Electron 起動手順は使わない（この開発機では壊れる）。
---

# run-hologram — アプリを起動して確かめる

正本は `docs/build.md`（「コード変更の反映」「検証ルール（隔離4段構え）」）。ここはその選択部分だけを抜いたもので、矛盾があれば `docs/build.md` が勝つ。

**起動した先で CDP を叩くなら skill `verify-with-cdp` を先に読む**（合成マウスでレンダラを固める・スクショが固着/白紙/ハングする・拡張の診断は観測点を間違えると全部 false に見える、といった罠がまとまっている）。worktree からテストや拡張検証を回すなら skill `test-in-worktree`。

## 実機（:9222）は `HologramLaunch` タスクで起こす

⚠️**旧理由（MSIX 仮想化）は 2026-08-06 に失効した**＝Claude Code 本体がパッケージ外へ移り、FS も HKCU も読み書きとも実体になった（#1003・4経路を実測。うち HKCU 書きはユーザーが regedit で目視）。**直接起動が登録を壊すことはもう無い**＝メモリ `sandbox-appdata-registry-divergence` が正。

いま**タスクを使う理由は2つだけ**＝①アクションに `--remote-debugging-port=9222` が固定で入っている ②起動経路が1本に揃い、下のコマンドがその引数を目印に実機だけを名指しできる。⚠️**タスク以外で起動された個体はこの目印を持たないので選べない**（2026-08-06 に実際に遭遇＝#1004）。

**HMR で足りるなら `electron-vite dev` を使ってよい**（下の「どのインスタンスで検証するか」4番）。

```powershell
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=9222*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'HologramLaunch'
```

`"task not found"` が返ったら `restart-app.ps1` を一度実行するとタスクが自己作成される。再起動は確認を取らずに行ってよい。

⚠️**止める相手はパスでなくコマンドラインで選ぶ**＝`Path -like '*hologram*'`（旧版）は **worktree の検証で走っている Electron も巻き添えにする**。ハーネスは自分のツリーの `node_modules/electron` を使い（`scripts/lib-electron-path.cts`）、worktree はリポジトリの内側にあるので同じ条件に合う＝並行セッションのテストを黙って赤にできてしまう。`--remote-debugging-port=9222` を付けるのは `HologramLaunch` タスクだけなので、これが実機を名指しする唯一の目印（2026-08-05・docs/build.md が正）。

## 起動の前に: 変更が反映される状態か

`app/` は npm ワークスペース＝リポジトリ直下から `npm run build --workspace=app`（`typecheck`・`dist`・`start` も同様）。

| 直した場所 | 必要な操作 |
| --- | --- |
| main・preload・renderer のいずれか | `npm run build --workspace=app` → **再起動**（electron-vite が3面を`app/out/`へ一括ビルド。ビルド出力を読む起動では「renderer だけは再起動不要」の特例は無い）。**`electron-vite dev` で起こしている間はこの往復が要らない**＝renderer は HMR、main は自動再起動 |
| `native-host/` のブリッジ本体 | `npm run build:native-host-bridge --workspace=app` → `node native-host/install.cts` で再配備（アプリ再起動は不要。ビルドを飛ばすと配備は「バンドル未ビルド」で止まる） |
| 拡張機能 | 本体で `npm run build:ext`＝拡張が自分でリロードするのでクリックは要らない（#650・skill `verify-extension`） |

## どのインスタンスで検証するか（既定＝隔離）

実機（:9222）に触るのは**実ライブラリでの最終確認とキャプチャ経路の確認だけ**。

1. **挙動・自動テスト → SMOKE 隔離**: `HOLOGRAM_SMOKE=1` ＋ `HOLOGRAM_CONFIG_DIR=<tmp>`。隠しウィンドウ・自動終了。雛形は `scripts/test-app-tagtypes.cts`。ユーザーが本体アプリを触っていても結果に混ざらない。
2. **見た目・モーション → サンドボックス2台目**: `node scripts/sandbox-app.cts` で可視・常駐のインスタンスを起動。CDP ポートはツリーのパスから決まる（起動時に表示・`.sandbox/instance.json`）。**接続は `CDP_PORT=sandbox node scripts/cdp-verify.cts`**＝そのツリーの記録から解決するので番号を持ち回らない。終了は `node scripts/sandbox-app.cts stop`。HKCU も共有 config も触らないので実機と共存でき、worktree ごとに独立する。**他ツリーのサンドボックスへ番号で繋ごうとすると止まる**（#640＝繋がったまま成功するのが唯一の失敗の顔だった）。
3. **実機（:9222）**: `HologramLaunch` で起動したウィンドウへ CDP 接続。短く済ませ、混ざった疑いがあれば撮り直す。
4. **UI を作り込む間 → HMR（`electron-vite dev`）**（2026-08-06 解禁・#1003）: `REMOTE_DEBUGGING_PORT=9222 npm run dev --workspace=app`。**CDP も同時に使える**＝electron-vite がこの環境変数を読んで `--remote-debugging-port` を Electron へ渡す（`node scripts/cdp-verify.cts eval …` がそのまま通る・実測で `document.title` と実ライブラリ 10.2K 件を取得）。renderer は HMR、main は保存で自動再起動＝**ビルド→再起動の往復が消える**。⚠️**キャプチャ経路の確認には使わない**＝dev は `ensureHostRegistered()` を呼ばない設計（`app/src/main/index.ts` が `DEV_SERVER_URL` のとき除外）なので、ホスト登録の自己修復が働かない。⚠️実機と同時には起こせない（single-instance lock）。

CSS の transition や inline 配置は隠しウィンドウでは再現しないので、見た目の確認を SMOKE で済ませようとしない。

## 実機を触る時

- **稼働中の実機は確認なく駆動してよい**（リロード・カード選択・ビュー開閉・スクショまで）。開いたオーバーレイを閉じる程度の後片付けはする。
- **異常を見たら、まず自分の駆動の残留を疑う**。1つのスクリプトに多数のフローを詰めない。
- スクショは画像トークンが重い。computed style やコントラスト比など数値で足りる検証は JS 計測で済ます。

## 並行セッションと重ねてはいけない3つ

`node native-host/install.cts` の再配備・拡張のリロード・実機の再起動は、worktree でもサンドボックスでも隔離されない。他セッションが動いている時だけ重ねない（`ccd_session_mgmt` で実態を見る）。**確認先は並行セッションであってユーザーではない**＝重なりが無いと分かったらそのまま実行する。
