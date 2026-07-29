---
name: run-hologram
description: Hologram アプリを起動して動きを確かめる時の経路と、検証をどのインスタンスで行うかの選び方。「アプリを起動して」「実機で確認して」「画面を見て」「スクショを撮って」など、実際にアプリを動かす依頼で必ず使う。組み込みの汎用 Electron 起動手順は使わない（この開発機では壊れる）。
---

# run-hologram — アプリを起動して確かめる

正本は `docs/build.md`（「コード変更の反映」「検証ルール（隔離4段構え）」）。ここはその選択部分だけを抜いたもので、矛盾があれば `docs/build.md` が勝つ。

**起動した先で CDP を叩くなら skill `verify-with-cdp` を先に読む**（合成マウスでレンダラを固める・スクショが固着/白紙/ハングする・拡張の診断は観測点を間違えると全部 false に見える、といった罠がまとまっている）。worktree からテストや拡張検証を回すなら skill `test-in-worktree`。

## 絶対の制約: Claude のシェルから electron を直接起動しない

Claude のシェルは MSIX パッケージ内で動く。そこから起動した electron はコンテナの子になり、HKCU とファイルシステムが仮想化される＝ネイティブホストの登録が実 Chrome から見えない私的ハイブへ入り、**キャプチャが壊れる**。`Start-Process electron.exe` も `npm start` も使わない。

正しい経路は Task Scheduler（コンテナ外のサービス）経由:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*hologram*' } | Stop-Process -Force
Start-ScheduledTask -TaskName 'HologramLaunch'
```

`"task not found"` が返ったら `restart-app.ps1` を一度実行するとタスクが自己作成される。再起動は確認を取らずに行ってよい。

## 起動の前に: 変更が反映される状態か

`app/` は npm ワークスペース＝リポジトリ直下から `npm run build --workspace=app`（`typecheck`・`dist`・`start` も同様）。

| 直した場所 | 必要な操作 |
| --- | --- |
| main・preload・renderer のいずれか | `npm run build --workspace=app` → **再起動**（electron-vite が3面を`app/out/`へ一括ビルド。`electron-vite dev`を使わない限り「renderer だけは再起動不要」の特例は無い） |
| `native-host/` のブリッジ本体 | `npm run build:native-host-bridge --workspace=app` → `node native-host/install.cts` で再配備（アプリ再起動は不要。ビルドを飛ばすと配備は「バンドル未ビルド」で止まる） |
| 拡張機能 | 開発中は本体で `npm run dev:ext` 常駐＋開始時リロード1回。終わったら `build:ext`＋リロード1回で production へ戻す（skill `verify-extension`） |

## どのインスタンスで検証するか（既定＝隔離）

実機（:9222）に触るのは**実ライブラリでの最終確認とキャプチャ経路の確認だけ**。

1. **挙動・自動テスト → SMOKE 隔離**: `HOLOGRAM_SMOKE=1` ＋ `HOLOGRAM_CONFIG_DIR=<tmp>`。隠しウィンドウ・自動終了。雛形は `scripts/test-app-tagtypes.cts`。ユーザーが本体アプリを触っていても結果に混ざらない。
2. **見た目・モーション → サンドボックス2台目**: `node scripts/sandbox-app.cts` で可視・常駐のインスタンスを起動。CDP ポートは起動時に表示される。接続は `CDP_PORT=<port> node scripts/cdp-verify.cts`、終了は `node scripts/sandbox-app.cts stop`。HKCU も共有 config も触らないので実機と共存でき、worktree ごとに独立する。
3. **実機（:9222）**: `HologramLaunch` で起動したウィンドウへ CDP 接続。短く済ませ、混ざった疑いがあれば撮り直す。

CSS の transition や inline 配置は隠しウィンドウでは再現しないので、見た目の確認を SMOKE で済ませようとしない。

## 実機を触る時

- **稼働中の実機は確認なく駆動してよい**（リロード・カード選択・ビュー開閉・スクショまで）。開いたオーバーレイを閉じる程度の後片付けはする。
- **異常を見たら、まず自分の駆動の残留を疑う**。1つのスクリプトに多数のフローを詰めない。
- スクショは画像トークンが重い。computed style やコントラスト比など数値で足りる検証は JS 計測で済ます。

## 並行セッションと重ねてはいけない3つ

`node native-host/install.cts` の再配備・拡張のリロード・実機の再起動は、worktree でもサンドボックスでも隔離されない。他セッションが動いている時だけ重ねない（`ccd_session_mgmt` で実態を見る）。**確認先は並行セッションであってユーザーではない**＝重なりが無いと分かったらそのまま実行する。
