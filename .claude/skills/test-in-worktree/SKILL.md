---
name: test-in-worktree
description: 隔離 worktree で Hologram のテスト・型検査を回し、そこから拡張機能を実機検証するまでの手順。fresh worktree に node_modules が無い状態で「テストを走らせたい」「typecheck を通したい」「npm install が要るのか判断したい」時、および worktree で直した拡張を Chrome に反映させたい時に読む。
---

# test-in-worktree — 隔離ツリーで検証を回す

`EnterWorktree` / `git worktree add` で作った fresh worktree には **node_modules が無い**（`worktree.baseRef: fresh`＝origin/main のチェックアウトのみ）。Hologram は node_modules を**2層**に持つ: リポジトリ root（`app/` は npm ワークスペースなので root の install に相乗り）／ `extension/`。typecheck は各層の `node_modules/typescript/bin/tsc` を使う（`scripts/typecheck.cts`）。

## install

`npm test` は Vitest＝root の devDependency なので、**install 無しで走るテストはもう無い**。

- `npm run setup` — root と `extension/` の依存・`wxt prepare`・Electron 本体の取得をまとめて面倒を見る（**素の `npm install` は better-sqlite3 の node-gyp で落ちる**＝理由と回避の寿命は `scripts/setup.cts` 冒頭が正本）

**拡張のビルドは手で打たなくてよい**（#130）＝ビルド済みバンドル（`extension/.output/chrome-mv3`）を jsdom で読むスイート（`overlay` / `drag-zone` / `capture-*` / `bulk-capture` / `ext-consistency`）のために、`npm test` が走り出す前に必要なときだけ `build:ext` を1回回す（`scripts/vitest.global-setup.ts`）。

install が済めば `npm test`・`npm run typecheck`・アプリ起動ハーネス（`test-app-*.cts`）がすべて worktree で緑になる。各自 `HOLOGRAM_CONFIG_DIR` の mkdtemp サンドボックスで実 Electron を起動するので、本体アプリにも実ライブラリにも触らない＝**実機 CDP(:9222) を奪わずに実経路を検証したい時の既定手段**（並行セッションが居る時は特に）。部分実行は `node scripts/run-app-tests.cts <suffix>`。

## 効かない手（罠）

- **本体の node_modules を junction で借りると typecheck が壊れる**。`mklink /J` で root/app/extension をリンクしても、本体は **pnpm レイアウト**（各パッケージが `.pnpm` ストアへの symlink）なので junction 越しに react / react-dom / jsx-runtime / sonner 等が解決できず、renderer の `.tsx` が大量の TS2307・TS7026 を吐く。**変更したファイル自体のエラーが 0 でもその中に埋もれる**＝切り分けは `tsc 出力 | grep <対象ファイル>` で対象ファイル起因だけを見る。型検査をちゃんと通したいなら素直に `npm install`（重いが確実）。

## worktree から拡張機能を実機検証する

**自動反映は worktree に届かない。** `npm run build:ext` が更新するのは**自分が実行されたツリーの `.output`** で、日常の Chrome に読み込まれているのは**本体ツリーの `.output/chrome-mv3`**（docs/build.md）。worktree でビルドしても本体の拡張には反映されない。ここで「手で読み込み直してもらおう」はグローバル CLAUDE.md が名指しで禁じている（渡す手順は人でないと不可能な部分まで切り詰める）。

**正しい手順＝本体ツリー自身を対象コミットへ動かしてビルドする**（`build:ext` 一本目的地＝クリック不要。ユーザーの手作業は Alt+S などの検証操作だけになる）:

1. 並行セッションの稼働と本体ツリーが clean かを確認（`list_sessions` / `git -C <本体> status`）。拡張のリロードは worktree で隔離されない共有装置（docs/build.md）。
2. `git -C <本体> checkout --detach <対象コミット>`。**ブランチ名では checkout できない**＝worktree が掴んでいるので必ずコミット SHA を指定する。
3. 本体ツリーで `npm run build:ext`。拡張は次の往復で自分をリロードする（#650・skill `verify-extension`）。
4. ビルドに変更が入ったことを確認してから検証する（**バンドルの grep は識別子で**＝正規表現リテラルは偽の空振りを起こす・下記）。
5. 検証後は同じ順で戻す（`checkout main` → `npm run build:ext`＝#650 以降 production ビルドは拡張が自分で載せるのでクリックは要らない。skill `verify-extension`）。掴んだままにしない。

急ぐ／本体を detach したくない時は、worktree で `npm run build:ext` して出力を本体の `chrome-mv3` へ上書きする代替経路もある（skill `verify-extension`）＝ただし worktree のビルドは識別子を告知しないため、この経路は自己リロードの対象外でユーザーへ手動リロードを1回依頼することになる。

**バンドルの grep は正規表現リテラルのエスケープで偽の空振りを起こす**。ソースの `/^\/i\/bookmarks(\/|$)/` はバンドル上も `i\/bookmarks` と出るため `i/bookmarks` で grep すると 0 件＝「ビルドされていない」と誤読する。空振りはまず自分の検索式を疑う。

## 検証の粒度

pure-logic の増分は「該当 unit が緑＋biome clean＋対象ファイルの tsc 0 件」で1段階の検証として足りる。実機 E2E は UI 増分が溜まった節目でまとめて行う。
