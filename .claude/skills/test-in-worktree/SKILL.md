---
name: test-in-worktree
description: 隔離 worktree で Hologram のテスト・型検査を回し、そこから拡張機能を実機検証するまでの手順。fresh worktree に node_modules が無い状態で「テストを走らせたい」「typecheck を通したい」「npm install が要るのか判断したい」時、および worktree で直した拡張を Chrome に反映させたい時に読む。
---

# test-in-worktree — 隔離ツリーで検証を回す

`EnterWorktree` / `git worktree add` で作った fresh worktree には **node_modules が無い**（`worktree.baseRef: fresh`＝origin/main のチェックアウトのみ）。Hologram は node_modules を**2層**に持つ: リポジトリ root（`app/` は npm ワークスペースなので root の install に相乗り）／ `extension/`。typecheck は各層の `node_modules/typescript/bin/tsc` を使う（`scripts/typecheck.cts`）。

## install（この順に1回ずつ）

`npm test` は Vitest＝root の devDependency なので、**install 無しで走るテストはもう無い**。

1. `npm run setup` — root と `extension/` の依存・`wxt prepare`・Electron 本体の取得をまとめて面倒を見る（**素の `npm install` は better-sqlite3 の node-gyp で落ちる**＝理由と回避の寿命は `scripts/setup.cts` 冒頭が正本）
2. `npm run build:ext` — `overlay.test.ts`／`bulk-capture.test.ts`／`capture-mode-select.test.ts` はビルド済みバンドル（`extension/.output/chrome-mv3`）を jsdom で評価するので、これが無いと ENOENT で落ちる

2 まで済ませれば `npm test`（52スイート）・`npm run typecheck`・アプリ起動ハーネス（`test-app-*.cts`）がすべて worktree で緑になる。各自 `HOLOGRAM_CONFIG_DIR` の mkdtemp サンドボックスで実 Electron を起動するので、本体アプリにも実ライブラリにも触らない＝**実機 CDP(:9222) を奪わずに実経路を検証したい時の既定手段**（並行セッションが居る時は特に）。部分実行は `node scripts/run-app-tests.cts <suffix>`。

## 効かない手（罠）

- **本体の node_modules を junction で借りると typecheck が壊れる**。`mklink /J` で root/app/extension をリンクしても、本体は **pnpm レイアウト**（各パッケージが `.pnpm` ストアへの symlink）なので junction 越しに react / react-dom / jsx-runtime / sonner 等が解決できず、renderer の `.tsx` が大量の TS2307・TS7026 を吐く。**変更したファイル自体のエラーが 0 でもその中に埋もれる**＝切り分けは `tsc 出力 | grep <対象ファイル>` で対象ファイル起因だけを見る。型検査をちゃんと通したいなら素直に `npm install`（重いが確実）。

## worktree から拡張機能を実機検証する

**ホットリロードは worktree に届かない。** `npm run dev:ext` が監視しているのは**本体ツリーの `extension/`** で、日常の Chrome に読み込まれているのも**本体ツリーの `.output/chrome-mv3`**（dev/production 共用＝docs/build.md）。worktree でいくら直しても反映されない。ここで「手で読み込み直してもらおう」はグローバル CLAUDE.md が名指しで禁じている（渡す手順は人でないと不可能な部分まで切り詰める）。

**正しい手順＝`dev:ext` が見ているツリーへコードを持っていく**（ユーザーの手作業は Alt+S だけになる）:

1. 並行セッションの稼働と本体ツリーが clean かを確認（`list_sessions` / `git -C <本体> status`）。拡張のリロードは worktree で隔離されない共有装置（docs/build.md）。
2. **`dev:ext` を先に停止する**（理由は下）。
3. `git -C <本体> checkout --detach <対象コミット>`。**ブランチ名では checkout できない**＝worktree が掴んでいるので必ずコミット SHA を指定する。
4. 本体ツリーで `dev:ext` を起動。
5. dev バンドルに変更が入ったことを確認してからユーザーへ渡す。
6. 検証後は同じ順で戻す（停止 → `checkout main` → 開発を続けるなら `dev:ext` 再起動、終わりなら `build:ext`＋リロード1回で production へ＝skill `verify-extension`）。掴んだままにしない。

**なぜ先に止めるか**＝`git checkout` は監視下のファイルを一斉に書き換えるので watcher が壊れる。2026-07-26 の実測では checkout 直後に **wxt のプロセスごと消えていた**（症状＝`.output` の mtime が据え置き・ソースを touch しても再ビルドが起きない）。crash の因果は再現で確かめていないが、**止めてから切り替えれば因果がどちらでも成立する**＝「落ちたか」を毎回判定する手間ごと消える。起動し直した後は安定（20分以上生存を確認）。

**dev バンドルの grep は正規表現リテラルのエスケープで偽の空振りを起こす**。ソースの `/^\/i\/bookmarks(\/|$)/` はバンドル上も `i\/bookmarks` と出るため `i/bookmarks` で grep すると 0 件＝「ビルドされていない」と誤読する。空振りはまず自分の検索式を疑う。

## 検証の粒度

pure-logic の増分は「該当 unit が緑＋biome clean＋対象ファイルの tsc 0 件」で1段階の検証として足りる。実機 E2E は UI 増分が溜まった節目でまとめて行う。
