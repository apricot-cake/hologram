#!/usr/bin/env node
// SessionStart sweep: delete the empty directory shells left behind under
// `<repo>/.claude/worktrees/` after a worktree is removed.
//
// WHY (measured 2026-08-01). 93 orphan directories had accumulated there in
// three days (07-29: 3, 07-30: 51, 07-31: 39). Every one of them had no `.git`,
// no regular file outside `node_modules`, and 89 of them held exactly one
// entry -- a dangling `node_modules/hologram-app` symlink pointing at their own
// deleted `app/`. The git registration is gone, so `git worktree list` cannot
// see them and `git worktree prune` does not touch them (it removes metadata,
// never directories). That is the blind spot: the nightly "clean up worktrees"
// step in skill `progress-check` looks at `git worktree list`, so it is
// structurally incapable of catching these.
//
// The residue is confined to `.claude/worktrees/` -- the directory the
// EnterWorktree/ExitWorktree tool owns. The other creation path used here
// (subagents running `git worktree add ~/local/dev/hologram-wt-*`, per skill
// `subagent-ground-rules`) produced zero orphans over the same three days.
// WHICH internal step of Enter/Exit leaves the shell behind is UNVERIFIED: the
// tool's implementation is not readable from here, and plain
// `git worktree remove --force` reproduced nothing. Since the cause cannot be
// fixed from this side, sweeping is the only available prevention.
//
// WHY A SessionStart HOOK. Sweeping is cheap, has no output worth reading, and
// wants to happen exactly when nothing is running. SessionStart is that moment.
// It deliberately runs no build and spawns no watcher -- the two retired hooks
// (`stale-bundle`, `ext-hotreload`, memory `hologram-stop-hooks-retired`) died
// from being false-positive machines that fired on Stop; the decision here is a
// path/emptiness comparison with no judgement in it.
//
// WHAT IT WILL NOT DELETE. All three must hold, or the directory is left alone:
//   1. not registered in `git worktree list` (so live worktrees are excluded),
//   2. no `.git` entry (belt and braces for the same thing),
//   3. nothing but empty directories inside, ignoring a top-level
//      `node_modules` (so a single real file, anywhere, saves the directory).
// Anything that cannot be read, or cannot be deleted because a process holds it
// open, is skipped in silence.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const norm = (p) => resolve(p).replace(/\\/g, '/').toLowerCase();

// This script lives at <repo>/.claude/hooks/, and a session may be running from
// inside a worktree copy of it -- so ask git for the main worktree rather than
// trusting the path we were launched from.
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let porcelain = '';
try {
  porcelain = execFileSync('git', ['-C', here, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  process.exit(0); // not a git repo (or no git) -> nothing to reason about
}

const registered = porcelain
  .split('\n')
  .filter((line) => line.startsWith('worktree '))
  .map((line) => line.slice('worktree '.length).trim())
  .filter(Boolean);

const mainWorktree = registered[0];
if (!mainWorktree) process.exit(0);

const registeredSet = new Set(registered.map(norm));
const worktreesDir = join(mainWorktree, '.claude', 'worktrees');
if (!existsSync(worktreesDir)) process.exit(0);

/** True only when `dir` contains nothing but empty directories (top-level node_modules ignored). */
function isEmptyShell(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return false; // unreadable -> assume it holds something and leave it
    }
    for (const entry of entries) {
      // node_modules is regenerable, and the dangling package symlink lives there.
      if (current === dir && entry.name === 'node_modules') continue;
      // isDirectory() does not follow symlinks, so a symlink falls through to false.
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
        continue;
      }
      return false;
    }
  }
  return true;
}

let top;
try {
  top = readdirSync(worktreesDir, { withFileTypes: true });
} catch {
  process.exit(0);
}

const swept = [];
for (const entry of top) {
  if (!entry.isDirectory()) continue;
  const full = join(worktreesDir, entry.name);
  if (registeredSet.has(norm(full))) continue;
  if (existsSync(join(full, '.git'))) continue;
  if (!isEmptyShell(full)) continue;
  try {
    rmSync(full, { recursive: true, force: true });
    swept.push(entry.name);
  } catch {
    // held open by a live process (this happened to one directory on 2026-08-01)
  }
}

if (swept.length > 0) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: `[sweep-orphan-worktrees] .claude/worktrees/ の空の残骸を ${swept.length} 件削除しました。`,
    }),
  );
}
process.exit(0);
