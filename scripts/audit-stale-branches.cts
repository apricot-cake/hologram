'use strict';

// mainから遅れて合流の負債になるほど長く放置されたブランチを表に出す。取り込みが
// 救出作業になってしまう前に気付けるように。#41（2026-07-25）に促された:
// worktreeのブランチがpushしただけの状態で4日座っており、mainから86コミット
// 遅れ、その間にフォルダ保存の正本がその足元で動いていたため、取り込みには
// 予定外のDBマイグレーションが必要になった。しきい値を誰も超えていなければ
// 何も言わない。
//
// 実行: node scripts/audit-stale-branches.cts
// 終了コードは常に0（情報提供のみ）。出力は素の日本語のテキストで、人間が
// 直接読むためのものであり、機械でパースするものではない。マシンごとの個人用
// ログオンタスクからこれを呼んで出力を表に出すことはできるが、その配線は
// このリポジトリの外（~/.claude）にあり、ここには無い。

const { execFileSync } = require('node:child_process');

const STALE_DAYS = 2;
const BEHIND_LIMIT = 20;

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function ghOpenPRs(): { number: number; headRefName: string; isDraft: boolean }[] {
  try {
    const out = execFileSync('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,isDraft'], { encoding: 'utf8' }).trim();
    return out ? JSON.parse(out) : [];
  } catch {
    // ghが使えない/未認証: 失敗するのではなく、PRの文脈無しでブランチを報告する。
    return [];
  }
}

function main() {
  git('fetch', '--prune', '-q', 'origin');
  const base = 'origin/main';
  const worktrees = git('worktree', 'list', '--porcelain');
  const prs = ghOpenPRs();

  const refs = git('for-each-ref', '--format=%(refname:short)|%(committerdate:iso8601)', 'refs/heads', 'refs/remotes/origin')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('|') as [string, string])
    .filter(([ref]) => ref && ref !== 'main' && ref !== base && ref !== 'origin');

  type Row = {
    ref: string;
    ageDays: number;
    ahead: number;
    behind: number;
    pushed: boolean;
    pr: string;
    held: boolean;
  };
  const rows: Row[] = [];

  for (const [ref, date] of refs) {
    const ahead = Number(git('rev-list', '--count', `${base}..${ref}`));
    const behind = Number(git('rev-list', '--count', `${ref}..${base}`));
    if (ahead === 0 && behind === 0) continue; // mainと完全に同期している

    const ageDays = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
    if (ageDays < STALE_DAYS && behind < BEHIND_LIMIT) continue;

    const pushed = ref.startsWith('origin/') || git('ls-remote', '--heads', 'origin', ref).length > 0;
    const pr = prs.find((p) => p.headRefName === ref.replace(/^origin\//, ''));
    const held = worktrees.includes(`branch refs/heads/${ref}`);

    rows.push({
      ref,
      ageDays,
      ahead,
      behind,
      pushed,
      pr: pr ? `#${pr.number}${pr.isDraft ? '（下書き）' : ''}` : 'なし',
      held,
    });
  }

  if (!rows.length) {
    console.log('本体に合流していない古い作業はありません。');
    return;
  }

  console.log(`本体にまだ合流していない作業が ${rows.length} 件あります` + `（${STALE_DAYS}日以上動いていない、または本体から ${BEHIND_LIMIT} 回分以上遅れているもの）\n`);
  for (const r of rows) {
    console.log(`- ${r.ref}`);
    console.log(`    最後に手を入れたのは ${r.ageDays}日前。この作業だけにある変更が ${r.ahead}件、` + `その間に本体へ入った変更 ${r.behind}件をまだ取り込んでいません。`);
    const where = r.pushed ? 'GitHub には送信済み' : 'GitHub に送っていないのでこの PC にしかありません';
    const review = r.pr === 'なし' ? '取り込み依頼（プルリクエスト）も未作成' : `取り込み依頼は ${r.pr}`;
    const inUse = r.held ? '作業フォルダを使用中のセッションがあります（進行中かもしれません）。' : '';
    console.log(`    ${where}。${review}。${inUse}`);
    console.log('    → 放置するほど合流の手間が増えます。合流させるか、不要なら消してください。');
  }
}

main();
