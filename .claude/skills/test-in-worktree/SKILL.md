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

日常の Chrome が読むのは本体ツリーの固定出力だが、#718 以降は supervisor の Vite cwd を対象 worktree へ切り替え、開発出力だけを固定パスへ書く。**本体ツリーの detach、手動コピー、Chrome の再読み込み、先行マージは不要。**

1. fresh worktree は `npm run setup` を済ませる。選択した worktree 自身の `extension/node_modules` が Vite に必要。
2. Claude Code は SessionStart hook が自動取得する。Codex は対象 worktree で `npm run ext:preview:acquire`。別セッションが所有中なら横取りせず止まる。
3. `npm run ext:preview:check` または `npm run ext:status` で、`sourceRoot` が対象 worktree、state が `ready` であることを確認する。
4. 以後は対象 worktree の保存が CRXJS HMR へ直接届く。background 更新時も拡張自身の runtime reload に任せ、日常タブは reload しない。
5. 終了時は Claude Code の SessionEnd hook、Codex は `npm run ext:preview:release` で main へ戻す。クラッシュ後の復旧だけ `npm run ext:preview:main`。

**バンドルの grep は正規表現リテラルのエスケープで偽の空振りを起こす**。ソースの `/^\/i\/bookmarks(\/|$)/` はバンドル上も `i\/bookmarks` と出るため `i/bookmarks` で grep すると 0 件＝「ビルドされていない」と誤読する。空振りはまず自分の検索式を疑う。

## 検証の粒度

pure-logic の増分は「該当 unit が緑＋biome clean＋対象ファイルの tsc 0 件」で1段階の検証として足りる。実機 E2E は UI 増分が溜まった節目でまとめて行う。
