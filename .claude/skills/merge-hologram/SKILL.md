---
name: merge-hologram
description: hologram で PR をマージする時の、このリポジトリ固有の前提＝マージ方式・main の保護設定・CI がどこで走るか・lockfile が衝突した時の畳み方。「PRをマージ」「マージして」と言われたら skill pr-merge（撤去まで含む汎用手順）と併せて読む。
---

# merge-hologram — このリポジトリでマージする時の前提

**手順の正本は skill `pr-merge`**（`--delete-branch` を付けない理由・worktree 撤去とブランチ削除の順序・squash 済みの判定）。ここは**そこが「リポジトリの作法に合わせる」と書いている穴だけ**を埋める。

## main の保護設定

**PR 必須**（ruleset `main`・`enforcement=active`・rules は `deletion` / `non_fast_forward` / `pull_request` / `required_status_checks`）で、**`bypass_actors` は空**＝人も bot も直 push できない。

- **ローカルでマージして push する経路は存在しない**＝`git merge` して `git push origin main` は必ず弾かれる。worktree 管理ツールのローカルマージ（`wt merge` 等）もここで詰まるので使わない。
- **個人リポジトリの ruleset は bypass に GitHub Actions を指定できない**（organization 限定・API が 422）＝スキーマカナリアの基準更新すら自動 PR ＋ auto-merge で戻している（`docs/testing.md`）。
- **マージ方式は squash**（`gh pr merge <N> --squash`）。ruleset 自体は merge / rebase も許しているが、履歴は `<件名> (#<PR番号>)` の1コミットで揃っている。
- **`delete_branch_on_merge` は true**＝リモートブランチは GitHub が消す。残るのはローカルだけ（確認は `gh api repos/apricot-cake/hologram -q .delete_branch_on_merge`）。

## CI は必須チェック＝GitHub が止める

**`ci.yml` も `app-tests.yml` も PR と `main` への push の両方で走り、PR 側の2本が `required_status_checks` になっている**（2026-08-09 に復活。2026-08-06 の削除から3日で戻した＝根拠の実測は `docs/testing.md`）。指定は **`lint / typecheck / test`** と **`Electron harnesses / extension e2e`**、**strict なし**。

- **緑を人が確かめる手順は要らない**＝赤ければ `gh pr merge` が弾かれる。**`gh pr checks` を眺めてから判断する規律は撤去した**（ゲートが無かった時代の代償で、それ自体が待ちを生んでいた）。
- **マージ後に `main` の CI を見届けない**＝`git pull` はする（post-merge フックが要る）が、結果は待たない。PR 側の必須チェックが同じ内容を**マージ前に**通しており、待っても止められるものは何も無い。
- ⚠️**「走らなかったことと緑は別」という穴は無くなった**＝トリガーの `paths` を撤去し（`ci.yml`）、allow-list を `changed` ジョブへ移した（`app-tests.yml`）ので、**どちらも必ず走り、必ずチェックを報告する**。docs だけの PR ではシャードが skip され、集約ジョブが `::notice::` で「何を skip したか」を書いたうえで緑を返す。
- ⚠️**残る抜け道は「PR 検査後に `main` が進んだ場合」だけ**（strict を有効にしないので GitHub は止めない。並行セッション5〜6本の実態では再実行の連鎖になるため 2026-08-04 に外したまま）。**マージ直前に base が動いていたら rebase して再実行してからマージする**。
- ⚠️**CodeQL は必須ではない**＝`gh pr view <N> --json mergeStateStatus` が **`UNSTABLE` のままマージしてよい**。`UNSTABLE` は「必須でないチェックが未完か赤い」であって、止まっているのは **`BLOCKED`** のときだけ。**`CLEAN` を待たない**＝2026-08-08 に CodeQL の完了を80秒待ってからマージした実例があるが、待つ理由は無かった。
- **赤い `main` は他の何より先に直す**＝ゲートを抜けてくるのは flaky と上の base ずれだけになったが、規律自体は残る（正本は `docs/testing.md`）。

## post-merge フックが走る

`git pull` で `.githooks/post-merge` が動き、拡張に関わる変更が入っていれば**依存を入れ直して日常 Chrome へ release をデプロイする**（#732・#897）。**マージ直後の `git pull` の出力に、拡張のビルドとデプロイのログが出るのは正常**。正本は `docs/build.md`。

## lockfile が衝突した PR

rebase で自動マージが成立しても**それだけでは信用しない**＝ロックファイルは行単位のマージが意味を持たない。

```
npm install --package-lock-only --legacy-peer-deps
```

が**差分ゼロ**を返すことで自己整合を確認する。`--legacy-peer-deps` が要る理由は `docs/build.md`（electron-vite の peer 範囲）。あわせて `scripts/lockfile-dedupe.test.ts` の観点＝root とワークスペースが同じパッケージを二重に持っていないこと、も見る。
