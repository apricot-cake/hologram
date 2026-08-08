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

## CI は PR では走らない

**`ci.yml` も `app-tests.yml` も `main` への push でだけ走る**（#996 で `pull_request` トリガーを撤去）。必須チェックも 2026-08-06 に外れている＝**PR 上の緑はマージの条件ではなく、マージが唯一のゲート**。

- **マージしたら `main` を本体チェックアウトへ `git pull` し、CI の結果まで見届ける**。PR 側で待つものは無い（CodeQL だけが PR で走る）。
- **赤い `main` は他の何より先に直す**＝これが「マージ前に検査しない」ことの引き換え（正本は `docs/testing.md`）。
- `paths-ignore` / `paths` で絞ってあるので、docs だけの変更では `ci.yml` が走らない。**走らなかったことと緑は別**＝受け皿は夜間の `schedule`。

## post-merge フックが走る

`git pull` で `.githooks/post-merge` が動き、拡張に関わる変更が入っていれば**依存を入れ直して日常 Chrome へ release をデプロイする**（#732・#897）。**マージ直後の `git pull` の出力に、拡張のビルドとデプロイのログが出るのは正常**。正本は `docs/build.md`。

## lockfile が衝突した PR

rebase で自動マージが成立しても**それだけでは信用しない**＝ロックファイルは行単位のマージが意味を持たない。

```
npm install --package-lock-only --legacy-peer-deps
```

が**差分ゼロ**を返すことで自己整合を確認する。`--legacy-peer-deps` が要る理由は `docs/build.md`（electron-vite の peer 範囲）。あわせて `scripts/lockfile-dedupe.test.ts` の観点＝root とワークスペースが同じパッケージを二重に持っていないこと、も見る。
