---
name: verify-extension
description: 拡張機能（extension/）の変更を実ブラウザで確かめる手順＝日常の Chrome が読む本体ツリーの `.output/chrome-mv3` へ dev ビルドを流し、ホットリロードに任せる。開発の入りと出でリロード1回ずつをユーザーに依頼し、終わったら必ず production へ戻す。「拡張を実機で確認して」「Alt+S を試して」など実ブラウザで拡張の動きを見る依頼で使う。
---

# verify-extension — 拡張の変更を実ブラウザで確かめる

正本は `docs/build.md`「拡張機能の開発・配布」。矛盾があればそちらが勝つ。

## 土台: ブラウザは日常の Chrome 1本、出力も1箇所

日常の Chrome が読むのは**本体ツリーの `extension/.output/chrome-mv3` だけ**。dev ビルドも production ビルドも同じフォルダへ書かれる（`wxt.config.ts` の `outDirTemplate`）ので、モードの切り替え＝ビルド＋リロード1回。**拡張の削除→再追加は決してしない**（`chrome.storage.local` の設定とショートカット割当が消える）。

**開発が終わったら production へ戻すまでが1セット。** dev ビルドは manifest に `content_scripts` を持たず、常駐スクリプトを dev サーバー接続経由で実行時登録する＝dev ビルドを残したままサーバーが止まると、普段使いの拡張が丸ごと沈黙する（2026-07-26 被弾＝#362）。

**ブラウザを自動化スタックで起動しない。** web-ext / chrome-launcher / Playwright 経由の起動は自動化フラグの指紋が付き、X・Google がボット判定してサインインを弾く（2026-07-26 実測）。ホットリロードは拡張⇔dev サーバー間の機構＝普段どおり起動した Chrome でそのまま効く。

## 手順（既定）

1. **本体ツリーの** `extension/` で dev サーバーを起動する。dev サーバーが更新するのは自分のツリーの `.output` だけ＝worktree で起動しても日常の Chrome には届かない。worktree の変更を見たい時は skill `test-in-worktree` の手順で本体を対象コミットへ detach してから本体で起動する。

   **Claude が起動する時は標準入力を開いたまま**にする＝WXT は起動後に「Press o + enter」で stdin を待つ対話モードに入り、`npm run dev:ext` を素で背景実行すると **EOF を読んで即終了する**（2026-07-26 実測）。

   ```
   tail -f /dev/null | npm run dev:ext
   ```
2. `chrome://extensions` でのリロード1回をユーザーに依頼する（dev ビルドへの入れ替え。`chrome://` は Claude から触れない）。リロードするまで Chrome に載っているのは前のビルドのまま＝ここを飛ばすと修正が空振りする（2026-07-25 被弾）。
3. **以後ソースを直したらホットリロードに任せる**。手動で拡張もページも再読み込みしない。
4. **Claude の自動確認は使い捨て環境で行う**＝`scripts/lib-extension-e2e.cts` 系（同梱 Chromium・一時プロファイル・モック native host。`npm run test:e2e-extension` / 実サイトカナリアは `e2e-capture-test.cts`）。Playwright はポート未指定ならパイプで喋るのでどこにも listen しない。
   **ログイン済みアカウントでの挙動は自動化しない**＝この拡張は「X から自動化に見えないこと」を設計原則に持ち（#362）、同じ制約が検証にもかかる。自動化スタックからのサインインはボット検知にも当たる（2026-07-26 実測）。ログインが要る確認は人間が日常の Chrome で行い、Claude は結果・スクショを受け取る。
5. 人でないと不可能な操作（リロード・ログインが要る確認・実キー入力）だけユーザーへ依頼する。
6. **終了時: dev サーバーを止め、`npm run build:ext` で production を書き戻し、リロード1回を依頼する**。この戻しまで済ませてから完了報告する。

## Claude から見えないもの（実測 2026-07-26）

- **`chrome://` ページは開けない**（ツールが明示拒否）。**`chrome-extension://` は開けるが読めない**（別拡張のページに JS を差せない）。拡張機能ページのエラー表示・リロードボタン・ショートカット割当画面はユーザーの領分。説明の付かない挙動に当たったら、当てずっぽうの操作依頼を重ねず `chrome://extensions` のエラー画面のスクショを1枚頼む。
- 「押しても何も起きないのが正常」な操作（拡張リロード等）を、成否を観測する手段のないまま依頼して往復しない。ページ側で観測できる副作用（合成 `dragstart` での `#__hologramDropZone` 出現など＝skill `verify-with-cdp`「拡張を診断する」）を先に決めてから依頼する。

## 罠

- **背景実行した wxt はログを一切残さない**＝生死はプロセス一覧、dev サーバーの接続可否は WebSocket を直接叩いて観測する。Node ≥17 は `::1` だけに bind することがあり、Chrome は `localhost` を IPv4 に解決して `ERR_CONNECTION_REFUSED` になる（`--host` で指定可）。
- **ビルド出力の grep は正規表現リテラルのエスケープで偽の空振りを起こす**。ソースの `/^\/i\/bookmarks(\/|$)/` はバンドル上も `i\/bookmarks` のまま＝`i/bookmarks` で grep すると 0 件になり「ビルドされていない」と誤読する。識別子（関数名・定数名）で探す。
- manifest に**後から追加したコマンドは既存インストールにキーが自動割当されないことがある**＝新ショートカットが効かない時は `chrome://extensions/shortcuts` の確認を頼む。
- **x.com は非表示タブで画像を読み込まない**＝背景タブで DOM を見て「画像が無い」と判断しない（2026-07-26 に丸ごと無効な調査をした）。`document.visibilityState` を先に見る。
