---
name: verify-extension
description: 拡張機能（extension/）の変更を実ブラウザで確かめる手順＝開発専用の Chrome プロファイルで WXT の開発ビルドを動かし、日常の Chrome と実ライブラリには触れずに検証する。「拡張を実機で確認して」「Alt+S を試して」など実ブラウザで拡張の動きを見る依頼で使う。
---

# verify-extension — 拡張の変更を実ブラウザで確かめる

正本は `docs/build.md`「拡張機能の開発・配布」。矛盾があればそちらが勝つ。

**拡張検証の共通罠はユーザースコープの skill `browser-extension-verify`**（注入の生死の見方・背面タブ・X 固有の観測・自動化スタックでのボット判定・ビルド出力の grep）＝**切り分けに入る前にそちらを読む**。ここは Hologram のプロファイル構成と、この拡張の実装に依存する罠だけを持つ。

## 土台: 開発は専用プロファイル、日常の Chrome は触らない

**ブラウザは2本ある**（#732）。日常の Chrome は本体ツリーの `extension/.output/chrome-mv3` を読み、そこには `npm run deploy:ext` を通った検証済み release だけが入る。**検証で日常の Chrome を使わない**＝開いているタブも、載っている拡張も触らない。

開発プロファイルは専用の user-data-dir で、`~/.hologram-dev/chrome-mv3-dev` を一度だけ Load unpacked してある。出力先はツリー外の固定パスなので、**どの worktree から起動しても同じ場所に出る**＝配信元の取り合いも、拡張の削除→再追加も起きない（`chrome.storage.local` の設定とショートカット割当は保たれる）。

**このプロファイルの保存は実ライブラリに入らない**＝開発ビルドは別のネイティブホスト名 `com.hologram.host.dev` に繋ぎ、`~/.hologram-dev/library` へ書く。初回だけ `npm run ext:dev:register`（一度きりのスケジュールタスク経由＝コンテナ内から `reg add` しても実 Chrome には見えないため）。**`reg query` では確認できない**＝確認は保存の成否と `~/.hologram-dev/bridge.log` で取る。保存したものを見るのは `node scripts/sandbox-app.cts`。

**反映はタブのリロードを伴う**＝WXT の開発モードは拡張をリロードし content script を入れ直す（in-place HMR ではない。自前 ShadowRoot の UI は WXT の HMR 対象外）。守るべき日常タブが同じプロファイルに居ないので、これでよくなったのが分離の要点。

**ブラウザを自動化スタックで起動しない**（理由と実測は skill `browser-extension-verify`）＝開発プロファイルは普通に起動する。

## 手順（既定）

1. fresh worktree は `npm run setup` を済ませる。
2. 対象 worktree で `npm run dev:ext`。**そのまま前景で呼ぶ**＝端末のない呼び出しからは `Hologram dev:ext` というタイトルの**コンソールウィンドウが開いてそちらで走り**、コマンド自体はすぐ戻る（docs/build.md「サーバーは可視のコンソールウィンドウで走る」）。**バックグラウンド実行にもログのリダイレクトにも回さない**＝そのウィンドウが唯一の出力先で、走っていることが外から見えるのが要点。止めるのはウィンドウを閉じる（または `cmd /k npm run dev:ext` のプロセスを kill する）。**検証中は動かしたまま**にする＝dev ビルドは自己完結していない（popup.html 等がスクリプトと CSS を `127.0.0.1:51731` から直接読む）。落ちていても拡張は壊れた顔をしない＝ポップアップは開くが、素の HTML が縦一列に潰れて出る（CSS/レイアウトのバグに見えるが原因はサーバー未起動、#861）。止めるのは検証が終わってから。二重起動はポート衝突で落ちる（黙って別ポートへ逃げない）。
3. **開発プロファイルの Chrome は自分で用意する**（規則は共通スキル「起動のしかた」＝頼む前にプロセスを見る）。
   - 状態だけ見るなら `node scripts/open-dev-profile.cts --print`＝`running: yes (pid …)` を出して**何も開かない**。
   - 開いていなければ `npm run ext:dev:browser`。起動済みなら pid を出して終わり、未起動なら一度きりのスケジュールタスク `HologramDevBrowser` 経由でコンテナ外に開く（**開いた時は一行添える**）。
   - 人の手が要るのは**初回の Load unpacked**（`chrome://extensions` → `~/.hologram-dev/chrome-mv3-dev`）と**各 SNS へのログイン**だけ。
   - 保存した変更は拡張リロード＋タブリロードで入るので、**確認直前にそのタブを更新する**。
4. **反映されない時に手でリロードを頼まない**＝dev サーバーのログと、拡張が `~/.hologram-dev/chrome-mv3-dev` を読んでいるかを先に見る。
5. **Claude の自動確認は使い捨て環境で行う**＝`scripts/lib-extension-e2e.cts` 系（同梱 Chromium・一時プロファイル・モック native host。`npm run test:e2e-extension` / 実サイトカナリアは `e2e-capture-test.cts`）。Playwright はポート未指定ならパイプで喋るのでどこにも listen しない。
   **ログイン済みアカウントでの挙動は自動化しない**＝この拡張は「X から自動化に見えないこと」を設計原則に持ち（#362）、同じ制約が検証にもかかる（自動化スタックの指紋については skill `browser-extension-verify`）。ログインが要る確認は人間がブラウザで行い、Claude は結果・スクショを受け取る。
6. 人でないと不可能な操作（ログインが要る確認・実キー入力）だけユーザーへ依頼する。

## 罠（この拡張の実装に依存するもの）

観測手段のない依頼をしない・`chrome://` は開けない・ビルド出力の grep が空振りする、といった共通分は skill `browser-extension-verify`。ページ側で観測できる副作用の実例＝合成 `dragstart` での `#__hologramDropZone` 出現（skill `verify-with-cdp`「拡張を診断する」）。

- **オーバーレイのコントロールは、絵の枠の「中」にあるとは限らない**＝`overlay.ts` の `controlHost` は、絵が `position:absolute` の時（X のタイムラインはこれ）枠を飛び越えて祖先へ mount する。`box.contains(control)` で拾おうとすると**在るのに見つからない**＝「ボタンが出ない」と誤読して原因を探しに行く（2026-07-29 に4往復した）。帰属は**幾何で**判定する＝コントロールは枠の左上から `CONTROL_INSET`（6px）の位置に置かれるので、矩形の左上を突き合わせる。
- 生きたタイムラインでの合成ホバーの空振りと、合成 `click` がサイト側のリンクへ届く件は skill `browser-extension-verify`。この拡張側の事情＝`overlay.ts` は座標だけで判定するので合成イベントをどの要素で発火させても問わない（`PointerEvent` に `clientX/clientY` を載せる）／保存ボタンの `onclick` は `preventDefault`＋`stopPropagation` する（`stopPress`）が押下は `pointerdown` から始まる。
