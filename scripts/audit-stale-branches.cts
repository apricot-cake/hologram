'use strict';

// Surfaces branches that have fallen behind main long enough to become a
// merge liability, so they get noticed before landing them turns into a
// rescue job. Prompted by #41 (2026-07-25): a worktree branch sat pushed-only
// for 4 days, drifted 86 commits behind main, and its integration required an
// unplanned DB migration because the folder-save source of truth had moved
// underneath it in the meantime. Silent when nothing crosses the threshold.
//
// Run: node scripts/audit-stale-branches.cts
// Exit code is always 0 (informational only); output is plain Japanese text
// meant for a human to read directly, not machine-parsed. A personal
// per-machine logon task can call this and surface the output; that wiring
// lives outside this repo (~/.claude), not here.

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
    // gh unavailable/unauthenticated: report branches without PR context rather than failing.
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
    if (ahead === 0 && behind === 0) continue; // fully in sync with main

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
