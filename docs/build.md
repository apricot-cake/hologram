# Corpus ビルド/配布

> CLAUDE.md のスリム化に伴い、ビルド・配布の手順詳細をここへ集約（2026-06-17）。CLAUDE.md 側には「確認なし再起動」「実機CDP検証時は声かけ」という**行動ルールだけ**残し、コマンド実体はここを参照。

## 開発実行

```
cd app && npm install && npm start
```

## 開発ルール：コード変更の反映（確認なし再起動）

アプリのコード変更を反映するときは、確認を取らずにアプリを再起動して反映する。

- 停止:
  ```powershell
  try { Get-Process electron -ErrorAction Stop | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force -Confirm:$false } catch {}
  ```
- 起動:
  ```powershell
  Start-Process -FilePath "C:\Users\apricot\local\dev\corpus\app\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "C:\Users\apricot\local\dev\corpus\app"
  ```
- **`npm start` 経由は cmd ウィンドウが出るため使わない**。electron.exe はGUIアプリなので `-WindowStyle Hidden` 不要・コンソールが一切出ない。

## 検証ルール（実機CDP）

見た目/挙動の確認は、上記の起動引数に `--remote-debugging-port=9222` を足した実機ウィンドウへ CDP 接続して行う（既定。詳細は [[corpus-verify-notes]]）。

- **実機の計測・スクショに入る前に必ず「今は触らないでください」とユーザーに一言伝え、終わったら「もう触ってOK」と返す**（操作が混ざると掴んだ状態を誤判定する＝ユーザー要望 2026-06-13。黙って検証を始めない）。
- スクショは画像トークンが重いので、数値で足りる検証（computed style / コントラスト比など）は画像を撮らず JS 計測で済ます。

## 配布物生成

```
cd app && npm run dist
```

electron-builder, win/nsis。

- 出力 `app/dist/win-unpacked/` — スタンドアロン。`Corpus.exe` を直接実行可。ASCIIパスへ置けば native-host のランチャもASCIIになり日本語パス問題が解消。
- **NSIS ワンクリックインストーラ** は winCodeSign 展開時に **symlink 作成権限** が要る。**Windows 設定 → 開発者向け → 開発者モード を ON**（または管理者で実行）してから `npm run dist` で `Corpus Setup x.x.x.exe` が生成される。OFF だと winCodeSign 展開が失敗し `win-unpacked` のみになる（macOS用 dylib symlink でこける／コードの問題ではない）。
- `native-host/` は `extraResources` で `resources/native-host` に同梱。`app/main.js` が `app.isPackaged` でパス解決（dev=`../native-host`）。
- アイコンは `scripts/make-icons.js`（256px基準で `icons/icon{16,32,48,128,256}.png` 生成。win ビルドは `icon256.png`）。
