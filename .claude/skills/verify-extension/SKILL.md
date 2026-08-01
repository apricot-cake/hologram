---
name: verify-extension
description: 拡張機能（extension/）の変更を実ブラウザで確かめる手順＝対象 worktree を日常 Chrome の HMR 配信元として取得し、固定の `.output/chrome-mv3` と拡張 ID を維持したまま検証する。「拡張を実機で確認して」「Alt+S を試して」など実ブラウザで拡張の動きを見る依頼で使う。
---

# verify-extension — 拡張の変更を実ブラウザで確かめる

正本は `docs/build.md`「拡張機能の開発・配布」。矛盾があればそちらが勝つ。

## 土台: ブラウザは日常の Chrome 1本、出力も1箇所

日常の Chrome が読むのは**本体ツリーの `extension/.output/chrome-mv3` だけ**。**拡張の削除→再追加は決してしない**（`chrome.storage.local` の設定とショートカット割当が消える）。

**リロードのクリックは要らない**（#714・#718）。通常の content 変更は CRXJS HMR、background 更新と server reconnect は `chrome.runtime.reload()` で反映する。**開いている日常タブは再読み込みしない**。実機検証タブだけを検証側から必要時に更新する。

**ブラウザを自動化スタックで起動しない。** web-ext / chrome-launcher / Playwright 経由の起動は自動化フラグの指紋が付き、X・Google がボット判定してサインインを弾く（2026-07-26 実測）。

## 手順（既定）

1. fresh worktree は `npm run setup` を済ませ、対象 worktree で preview 所有を取得する（Claude Code は hook、Codex は `npm run ext:preview:acquire`）。
2. `npm run ext:status` で state が `ready`、`sourceRoot` が対象 worktree であることを確認する。
3. **ページ側を確認する時は、エージェントが対応SNSの検証タブを新規に用意する**。background reload 後、または確認直前に、**その検証タブだけ**を再読み込みして新しい常駐スクリプトを注入する。既に開いている日常タブを列挙・更新してはならない。目視が必要なら、この検証タブだけを対象に依頼する。
4. **反映されない時に手でリロードを頼まない**＝`npm run ext:status` の `sourceRoot`・server PID・ログを確認する。別 worktree が所有していれば横取りしない。
5. **Claude の自動確認は使い捨て環境で行う**＝`scripts/lib-extension-e2e.cts` 系（同梱 Chromium・一時プロファイル・モック native host。`npm run test:e2e-extension` / 実サイトカナリアは `e2e-capture-test.cts`）。Playwright はポート未指定ならパイプで喋るのでどこにも listen しない。
   **ログイン済みアカウントでの挙動は自動化しない**＝この拡張は「X から自動化に見えないこと」を設計原則に持ち（#362）、同じ制約が検証にもかかる。自動化スタックからのサインインはボット検知にも当たる（2026-07-26 実測）。ログインが要る確認は人間が日常の Chrome で行い、Claude は結果・スクショを受け取る。
6. 人でないと不可能な操作（ログインが要る確認・実キー入力）だけユーザーへ依頼する。終了時は preview を解放して main 配信へ戻す。

## Claude から見えないもの（実測 2026-07-26）

- **`chrome://` ページは開けない**（ツールが明示拒否）。**`chrome-extension://` は開けるが読めない**（別拡張のページに JS を差せない）。拡張機能ページのエラー表示・リロードボタン・ショートカット割当画面はユーザーの領分。説明の付かない挙動に当たったら、当てずっぽうの操作依頼を重ねず `chrome://extensions` のエラー画面のスクショを1枚頼む。
- 「押しても何も起きないのが正常」な操作（拡張リロード等）を、成否を観測する手段のないまま依頼して往復しない。ページ側で観測できる副作用（合成 `dragstart` での `#__hologramDropZone` 出現など＝skill `verify-with-cdp`「拡張を診断する」）を先に決めてから依頼する。

## 罠

- **ビルド出力の grep は正規表現リテラルのエスケープで偽の空振りを起こす**。ソースの `/^\/i\/bookmarks(\/|$)/` はバンドル上も `i\/bookmarks` のまま＝`i/bookmarks` で grep すると 0 件になり「ビルドされていない」と誤読する。識別子（関数名・定数名）で探す。
- manifest に**後から追加したコマンドは既存インストールにキーが自動割当されないことがある**＝新ショートカットが効かない時は `chrome://extensions/shortcuts` の確認を頼む。
- **x.com は非表示タブで画像を読み込まない**＝背景タブで DOM を見て「画像が無い」と判断しない（2026-07-26 に丸ごと無効な調査をした）。`document.visibilityState` を先に見る。
- **オーバーレイのコントロールは、絵の枠の「中」にあるとは限らない**＝`overlay.ts` の `controlHost` は、絵が `position:absolute` の時（X のタイムラインはこれ）枠を飛び越えて祖先へ mount する。`box.contains(control)` で拾おうとすると**在るのに見つからない**＝「ボタンが出ない」と誤読して原因を探しに行く（2026-07-29 に4往復した）。帰属は**幾何で**判定する＝コントロールは枠の左上から `CONTROL_INSET`（6px）の位置に置かれるので、矩形の左上を突き合わせる。
- **生きたタイムラインでは合成ホバーが空振りする**＝新しい投稿の挿入や画像の遅延読み込みで枠が動き、ポインタ座標が枠から外れた瞬間にコントロールが消える。1回で決めず、**毎回その場の矩形を読み直して数回試す**。合成イベントは `PointerEvent` に `clientX/clientY` を載せる（`overlay.ts` は座標だけで判定するので、どの要素で発火したかは問わない）。
- **合成 `click` はサイト側のリンクまで届く**＝保存ボタンの `onclick` は `preventDefault`＋`stopPropagation` する（`stopPress`）が、実際の押下は `pointerdown` から始まる。`click` だけを直接 dispatch すると X が写真ビューアを開いて**ページごと遷移し、評価中のスクリプトが落ちる**。押下を模すなら `pointerdown`→`pointerup`→`click` を順に送るか、遷移しうる前提で観測を分ける。
