# Corpus ビルド/配布

> CLAUDE.md のスリム化に伴い、ビルド・配布の手順詳細をここへ集約（2026-06-17）。CLAUDE.md 側には「確認なし再起動」「実機CDP検証時は声かけ」という**行動ルールだけ**残し、コマンド実体はここを参照。

## 開発実行

初回の依存導入:

```
cd app && npm install
```

- 手元の実ターミナルから動かすだけなら `npm start`、ワンクリック起動は `restart-app.ps1` を右クリック →「PowerShell で実行」でよい。
- **Claude（MSIX コンテナ内）や CDP 検証を伴う起動は `CorpusLaunch` タスク経由**（下記「コード変更の反映」）。初回／タスク削除後は `restart-app.ps1` を一度実行するとタスクが自己作成される（以後は最小形で再起動可）。

## 開発ルール：コード変更の反映（確認なし再起動）

main プロセス（`main.mts`/`ipc-*`/`lib-*`）の変更を反映するときは、確認を取らずに再起動する（renderer/islands は `npm run build:islands` で再ビルド→アプリのリロードで反映＝再起動不要。Vite dev サーバー `npm run dev:renderer`＋`CORPUS_DEV_SERVER` 使用時のみ自動反映／native-host は `~/.corpus` へコピーで反映＝再起動不要）。preload の変更は `preload.cts` を編集 → `npm run build:islands` で `preload.js` を再生成してから再起動（preload だけビルドを経る＝docs/architecture.md 参照）。

**再起動は「停止 ＋ タスクスケジューラ経由の起動」で行う**。Claude が実行する最小形:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force
Start-ScheduledTask -TaskName 'CorpusLaunch'
```

ユーザーのワンクリックは `restart-app.ps1` を右クリック →「PowerShell で実行」（窓は出るが終了時に自動で閉じる）。`restart-app.ps1` は graceful close ＋ `CorpusLaunch` タスクの自己修復（無ければ作成）＋起動をまとめてある。

- **なぜ直接 `Start-Process electron.exe` を使わないか**: Claude のシェルは MSIX パッケージ（`Claude_pzs8sxrjxfjjc`）内で動くため、そこから直接起動した electron はコンテナの子＝HKCU/FS が仮想化され、ネイティブホスト登録が実 Chrome から見えない私的ハイブに入りキャプチャが壊れる。`CorpusLaunch` タスクは Task Scheduler サービス（コンテナ外）が起動する＝**実 HKCU/実 FS で動く**（2026-06-26 にレジストリ probe で実証）。ユーザーが直接起動した場合と同一になる。
- `CorpusLaunch` タスク定義: `electron.exe "<repo>\app" --remote-debugging-port=9222`（ポートは実機CDP検証用＝下記「検証ルール」）／Interactive（ウィンドウが出る）／Limited（非昇格）／トリガー無し（`Start-ScheduledTask` でのみ起動）。`restart-app.ps1` はアクションのパス/引数が drift したら毎回貼り直す（リポ移動にも追従）。`Start-ScheduledTask` が "task not found" を返したら一度 `restart-app.ps1` を実行して作り直す。
- `npm start` 経由は cmd ウィンドウが出るため使わない（electron.exe はGUIアプリなのでコンソールは出ない）。

## 検証ルール（実機CDP）

見た目/挙動の確認は、`CorpusLaunch` タスクで起動した実機ウィンドウへ CDP 接続して行う（既定。詳細は [[corpus-verify-notes]]）。`CorpusLaunch` のアクションには `--remote-debugging-port=9222` を恒久付与してあるので、タスク経由で起動すれば常に :9222 でデバッグ可能＝**コンテナ外（実 HKCU/実 FS）かつ CDP 可能**を同時に満たす。直接 `Start-Process electron.exe --remote-debugging-port=…` は使わない（コンテナ内＝仮想化でキャプチャが壊れる）。

- **実機の計測・スクショに入る前に必ず「今は触らないでください」とユーザーに一言伝え、終わったら「もう触ってOK」と返す**（操作が混ざると掴んだ状態を誤判定する＝ユーザー要望 2026-06-13。黙って検証を始めない）。
- スクショは画像トークンが重いので、数値で足りる検証（computed style / コントラスト比など）は画像を撮らず JS 計測で済ます。

## 配布物生成

```
cd app && npm run dist
```

electron-builder, win/nsis。

- 出力 `app/dist/win-unpacked/` — スタンドアロン。`Corpus.exe` を直接実行可。ASCIIパスへ置けば native-host のランチャもASCIIになり日本語パス問題が解消。
- **NSIS ワンクリックインストーラ** は winCodeSign 展開時に **symlink 作成権限** が要る。**Windows 設定 → 開発者向け → 開発者モード を ON**（または管理者で実行）してから `npm run dist` で `Corpus Setup x.x.x.exe` が生成される。OFF だと winCodeSign 展開が失敗し `win-unpacked` のみになる（macOS用 dylib symlink でこける／コードの問題ではない）。
- `native-host/` は `extraResources` で `resources/native-host` に同梱。`app/main.mts` が `app.isPackaged` でパス解決（dev=`../native-host`）。

## アイコン（全再生成の単一導線）

ブランドの実体はホログラフィック虹色スクエア（ラスター）。**マスター 1 枚から全アイコンを再生成**する＝差し替えが半端にならない仕組み:

1. `assets/icon-master.png` を差し替える（正方・512px 以上推奨）
2. `app/node_modules/.bin/electron scripts/make-icons.cts` を実行

これで以下が一括更新される（`scripts/make-icons.cts` の `TARGETS`/`BANNERS` が配置先の単一真実源＝増えたらここに足す）:

- `app/assets/icon.png`（512）＝Electron ウィンドウ/タスクバーアイコン。`app/package.json` の `build.win.icon` がこれを指し、electron-builder が配布時に `.ico` 化（PNG→ICO 自動変換）。dev では `main.mts` の `BrowserWindow({icon})`＋`app.setAppUserModelId` で反映。
- `extension/icons/icon{16,32,48,128,256}.png`＝Chrome 拡張（manifest の `icons`/`action.default_icon`）。差し替え後は拡張の再読み込みでツールバーに反映。
- `assets/icon.png`（256）＝汎用ブランドラスター/ファビコン。
- `assets/banner-{light,dark,en-light,en-dark}.svg`＝README バナー。ワードマーク `corpus`＋タグラインは保持し、先頭マークだけ虹色スクエアの埋め込み画像（base64）に差し替え。

Electron 経由で実行するのは nativeImage の高品質リサンプラを使うため（ウィンドウもネットワークも無し・リポへのファイル出力のみ）。ロゴの設計根拠はデザイン規約（メモリ `corpus-design`・旧 DESIGN.md）「ブランド／ロゴ」。
