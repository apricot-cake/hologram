---
name: verify-extension
description: 拡張機能（extension/）の変更を実ブラウザで確かめる手順。worktree で作業している時に必ず使う＝ホットリロードは本体ツリーしか見ていないので、worktree のコードは何もしなければ絶対に反映されない。「拡張を実機で確認して」「Alt+S を試して」など、実ブラウザで拡張の動きを見る依頼で使う。
---

# verify-extension — 拡張の変更を実ブラウザで確かめる

正本は `docs/build.md`（「コード変更の反映」「検証ルール」）と `CLAUDE.md`。矛盾があればそちらが勝つ。

## 前提: 反映はホットリロードに任せる（手動で読み込み直さない）

`npm run dev:ext`（WXT）が常駐していれば、拡張機能も対象ページも**手で再読み込みしない**。ユーザーに「`chrome://extensions` で読み込み直して」と頼むのは誤り。**ソースを直す前に**常駐を確認し、止まっていれば起動する。

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'wxt' }
```

通常ビルド（`npm run build:ext`）を打つのは配布物を作る時だけ。

## worktree で作業している場合（重要）

**ホットリロードは worktree に届かない。**`dev:ext` が監視するのは**本体ツリーの `extension/`** で、ブラウザに読み込まれているのも**本体ツリーの `.output/chrome-mv3-dev`**。worktree でいくら直しても反映されない。

ここで「手で読み込み直してもらう」へ逃げない。正しい解き方は **`dev:ext` が見ているツリーへコードを持っていく**＝ユーザーの手作業はゼロになる。

1. **並行セッションと本体ツリーの状態を確認**（拡張のリロードは共有装置＝`docs/build.md`）。

   ```
   git -C <本体> status --short     # clean か
   ```

   セッション一覧も見る（稼働中の相手が居るなら重ねない）。

2. **`dev:ext` を先に止める。**（理由は下）

3. **本体ツリーを対象コミットへ向ける。**

   ```
   git -C <本体> checkout --detach <コミットSHA>
   ```

   **ブランチ名では checkout できない**＝そのブランチは worktree が掴んでいる。必ず SHA を使う。

4. **本体ツリーで `dev:ext` を起動。**

5. **dev バンドルに変更が入ったことを確認してから**ユーザーへ渡す。渡す手順は「人でないと不可能な部分」だけにする（ログイン済みアカウントでの操作・実キー入力）。

6. **検証後は同じ順で戻す**＝停止 → `git -C <本体> checkout main` → 起動。本体に対象コミットを掴ませたままにしない。

### なぜ先に止めるのか

`git checkout` は監視下のファイルを一斉に書き換えるので watcher が壊れる。2026-07-26 の実測では checkout 直後に **wxt のプロセスごと消えていた**（症状＝`.output` の mtime が据え置き・ソースを touch しても再ビルドが起きない）。止めてから切り替えれば、落ちる落ちないに関わらず成立する＝毎回「落ちたか」を判定する手間が消える。起動し直した後は安定。

### dev バンドルの確認で踏む罠

正規表現リテラルはバンドル上もエスケープされたまま出る。ソースの `/^\/i\/bookmarks(\/|$)/` は `i\/bookmarks` として現れるので、`i/bookmarks` で grep すると 0 件になり「ビルドされていない」と誤読する。空振りはまず検索式を疑う。識別子（関数名・定数名）で探すほうが確実。

## 自動テストで先に潰せる範囲

実ブラウザへ行く前に、jsdom スイートが拡張の配線を見ている。ここで落ちる類のものを実機で探さない。

- `node scripts/test-capture-mode-select.cts` — どのジェスチャがどのモードに入るか
- `node scripts/test-bulk-capture-unit.cts` — 自動保存モードの挙動
- `node scripts/test-overlay-unit.cts` — タイムライン上のマーク/保存ボタン
- `node scripts/test-content-fixtures.cts` — DOM 抽出

いずれも `extension/` で `npm run build:ext` 済みのバンドルを読むものがある（`.output/chrome-mv3`）。

実サイトの DOM に今もセレクタが当たるかは jsdom では分からない＝`scripts/e2e-capture-test.cts`（ライブカナリア）と実機確認の領分。
