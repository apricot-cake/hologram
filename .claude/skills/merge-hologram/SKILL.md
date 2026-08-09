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

**`ci.yml` も `app-tests.yml` も PR と `main` への push の両方で走り、PR 側の2本が `required_status_checks` になっている**（2026-08-09 に復活。2026-08-06 の削除から3日で戻した＝根拠の実測は `docs/testing.md`）。指定は **`lint / typecheck / test`** と **`Electron harnesses / extension e2e`**、**strict あり**（"Require branches to be up to date before merging"・同じく 2026-08-09）。

- **緑を人が確かめる手順は要らない**＝赤ければ `gh pr merge` が弾かれる。**`gh pr checks` を眺めてから判断する規律は撤去した**（ゲートが無かった時代の代償で、それ自体が待ちを生んでいた）。
- **マージ後に `main` の CI を見届けない**＝`git pull` はする（post-merge フックが要る）が、結果は待たない。PR 側の必須チェックが同じ内容を**マージ前に**通しており、マージ後に出る結果では**もう止められない**。得られるのは「3分早く知る」だけ。
- **`main` の CI は完全に冗長**＝strict があるので PR のチェックは常に最新の `main` の上で走り、マージ直後の `main` は PR が検査したツリーと**必ず一致する**。`push: main` の実行に新しい情報は無い。**外さないのは実プロダクトが残しているから**（`vitejs/vite`・`wxt-dev/wxt` とも `push: main` + `pull_request`）で、コストがゼロ（誰も待たない・public なので無料）な一方、flaky をもう1回引ける・`main` の各コミットに緑の記録が残る、という副次はある。
- **それでも `main` が赤くなったら拾うのは次のコード PR**＝PR のチェックは `refs/pull/N/merge`＝**`main` と PR の合成**で走るので、`main` のコードが壊れていれば次の PR も赤くなり、必須チェックがマージを止める。**見逃せる経路が無い。**
  - ⚠️**docs だけの PR は素通りする**＝`app-tests` のシャードは allow-list に当たらず skip されるので、`main` がそこで赤でも止まらない。壊れは増えないが、**直るのは次にコードを触る PR まで待つ**ことになる。
  - ⚠️**原因を作ったセッションはもう終わっている**＝次の人が他人の壊れを直す。strict で base ずれを潰した以上ここに来るのは flaky と環境差だけだが、ゼロではない。
  - **受け皿は夜間の `schedule`**（ci 03:17 JST / app-tests 03:37 JST・どちらもフィルタ無しで全部走る）。誰も PR を出さない日でも1日1回は全体が回る。
- ⚠️**「走らなかったことと緑は別」という穴は無くなった**＝トリガーの `paths` を撤去し（`ci.yml`）、allow-list を `changed` ジョブへ移した（`app-tests.yml`）ので、**どちらも必ず走り、必ずチェックを報告する**。docs だけの PR ではシャードが skip され、集約ジョブが `::notice::` で「何を skip したか」を書いたうえで緑を返す。
- **base ずれは GitHub が止める**（strict）＝**マージ直前に手で確かめる手順は要らない**。2026-08-09 の数時間だけ「チェック開始時刻と `main` の最新コミットを比べる2コマンド」を置いていたが、strict を戻したので撤去した。
  - **`BLOCKED` で `mergeStateStatus` が `BEHIND` なら `gh pr update-branch <N>`** → 再実行の緑を待ってマージする。実測（2026-08-01〜09 の200マージ）では**77% の PR は開いている間に他が1本も着地しておらず**、CI 3分の窓に割り込まれるのは**24%**＝4回に1回だけこの1周が入る（期待値 +45秒/マージ）。
  - ⚠️**「連鎖で開発が止まる」は 2026-08-04 の条件下の話**＝当時は CI が12分で、同じ計算が **57%** になっていた（#928 の実測＝docs だけの PR で E2E 11分57秒）。#937 / #968 の並列化で3分になり、前提が変わっている。**外すなら実測を添えて記録する**＝前回は1日だけ運用して外し、その根拠が3日後まで残った。
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
