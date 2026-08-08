---
name: merge-hologram
description: hologram で PR をマージする時の、このリポジトリ固有の前提＝マージ方式・main の保護設定・CI がどこで走るか・lockfile が衝突した時の畳み方。「PRをマージ」「マージして」と言われたら skill pr-merge（撤去まで含む汎用手順）と併せて読む。
---

# merge-hologram — このリポジトリでマージする時の前提

**手順の正本は skill `pr-merge`**（`--delete-branch` を付けない理由・worktree 撤去とブランチ削除の順序・squash 済みの判定）。ここは**そこが「リポジトリの作法に合わせる」と書いている穴だけ**を埋める。

## main の保護設定

**PR 必須**（ruleset `main`・`enforcement=active`・rules は `deletion` / `non_fast_forward` / `pull_request`）で、**`bypass_actors` は空**＝人も bot も直 push できない。

- **ローカルでマージして push する経路は存在しない**＝`git merge` して `git push origin main` は必ず弾かれる。worktree 管理ツールのローカルマージ（`wt merge` 等）もここで詰まるので使わない。
- **個人リポジトリの ruleset は bypass に GitHub Actions を指定できない**（organization 限定・API が 422）＝スキーマカナリアの基準更新すら自動 PR ＋ auto-merge で戻している（`docs/testing.md`）。
- **マージ方式は squash**（`gh pr merge <N> --squash`）。ruleset 自体は merge / rebase も許しているが、履歴は `<件名> (#<PR番号>)` の1コミットで揃っている。
- **`delete_branch_on_merge` は true**＝リモートブランチは GitHub が消す。残るのはローカルだけ（確認は `gh api repos/apricot-cake/hologram -q .delete_branch_on_merge`）。

## CI は PR で走るが、必須チェックではない

**`ci.yml` も `app-tests.yml` も PR と `main` への push の両方で走る**（2026-08-08 に `pull_request` トリガーを復活・パスフィルタも撤去した＝理由と実プロダクトの実測は `docs/testing.md`）。**ただし `required_status_checks` は 2026-08-06 に外れたまま**＝PR 上の緑は**マージの技術的な条件ではない**。止めるものが無いだけで、赤が見えているのにマージしてよいという意味ではない。

- **PR の checks が出るまでは見る**＝`gh pr checks <N>` で赤が無いことを確かめてからマージする。ゲートが無い以上、これは手の側の規律。
- **マージしたら `main` を本体チェックアウトへ `git pull` し、`main` 側の CI の結果まで見届ける**。PR で見たのと同じ内容が走るが、squash 後の姿で走るのはこちらだけ。
- ⚠️**CodeQL は PR で走るが必須ではない**（ruleset に `required_status_checks` が無い）＝`gh pr view <N> --json mergeStateStatus` が **`UNSTABLE` のままマージしてよい**。`UNSTABLE` は「必須でないチェックが未完か赤い」であって、止まっているのは **`BLOCKED`** のときだけ。**`CLEAN` を待たない**＝2026-08-08 に CodeQL の完了を80秒待ってからマージした実例があるが、待つ理由は無かった。**`gh pr checks` で ci / app-tests の緑を見るのと、`CLEAN` を待つのは別**。
- **赤い `main` は他の何より先に直す**＝必須チェックが無い以上、これは今も引き換えのまま（正本は `docs/testing.md`）。
- **パスフィルタは無い**＝docs だけの変更でも両方走る。「走らなかったから緑」という読み違いは、もう起きない。

## post-merge フックが走る

`git pull` で `.githooks/post-merge` が動き、拡張に関わる変更が入っていれば**依存を入れ直して日常 Chrome へ release をデプロイする**（#732・#897）。**マージ直後の `git pull` の出力に、拡張のビルドとデプロイのログが出るのは正常**。正本は `docs/build.md`。

## lockfile が衝突した PR

rebase で自動マージが成立しても**それだけでは信用しない**＝ロックファイルは行単位のマージが意味を持たない。

```
npm install --package-lock-only --legacy-peer-deps
```

が**差分ゼロ**を返すことで自己整合を確認する。`--legacy-peer-deps` が要る理由は `docs/build.md`（electron-vite の peer 範囲）。あわせて `scripts/lockfile-dedupe.test.ts` の観点＝root とワークスペースが同じパッケージを二重に持っていないこと、も見る。
