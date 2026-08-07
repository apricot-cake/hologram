---
name: run-hologram
description: Hologram アプリを起動して動きを確かめる時の経路。「アプリを起動して」「実機で確認して」「画面を見て」「スクショを撮って」など、実際にアプリを動かす依頼で必ず使う。組み込みの汎用 Electron 起動手順は使わない（この開発機では静かに壊れる）。
---

# run-hologram — アプリを起動して確かめる

**正本は `docs/build.md`**＝反映に要るビルド（「コード変更の反映」）・どのインスタンスで検証するか（「CDP で繋ぐ先の選び方」「検証ルール（隔離4段構え）」）・停止の仕組み（「起動経路」）は全部そちら。ここは**起動のコマンドと、経路を外れた時に静かに落ちる2点**だけを持つ。CDP を叩くなら skill `verify-with-cdp` を先に読む。

## 実機（:9222）は `restart-app.ps1` で起こす

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\apricot\local\dev\hologram\scripts\restart-app.ps1
```

停止（single-instance ロックに載せた合図）と起動が中に入っている＝**別途 kill してから叩かない**。再起動は確認を取らずに行ってよい。

## ⚠️ 経路を外れた起動は静かに落ちる

どちらも**アプリは正常に動いて見える**ので、症状から起動経路を疑えない。

- **`electron.exe` を自分で spawn すると `HOLOGRAM_CONFIG_DIR` を継承する**＝実機がサンドボックス config で上がり、**空のライブラリが出る＝データ消失に見える**（`restart-app.ps1` は spawn 直前に `HOLOGRAM_*` を落としてこれを防いでいる）。
- **引数なしで起動された個体は CDP が開かない**（#1004＝スタートメニューのショートカットがこれ）。アプリは動くので、繋がらない原因が起動経路だと気付けない。警告は `main.log` にしか出ない（#1018）。繋ぐには `restart-app.ps1` で起こし直す。
