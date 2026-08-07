// Guards the one property that makes app/package.json's declared versions mean
// anything: a package the workspace pulls in must exist ONCE in the tree (#891).
//
// The failure this catches, in the shape it actually took: app/ raised vite from
// ^8.1.0 to ^8.2.0, and npm's minimal lockfile edit installed vite 8.2.0 into
// app/node_modules WITHOUT moving the 8.1.5 already sitting at the root. Both
// copies are legitimate npm output, nothing is "invalid", and every test stays
// green — but electron-vite is hoisted to the root, so `require('vite')` from it
// picks the ROOT copy. The build then runs on 8.1.5 while app/package.json says
// ^8.2.0. The declaration and the build had come apart, and the only way anyone
// would have noticed is by reading the version banner in the build log.
//
// Why the root/workspace pair specifically, and not "no package may appear
// twice": 66 names in this lockfile legitimately resolve to several versions
// (transitive dependents with incompatible ranges — semver, minimatch, chalk…),
// and collapsing those is not npm's job or ours. The pair below is different:
// root and workspace are the two places the SAME declaration can land, so two
// copies there means consumers disagree about which one the workspace declared.
//
// A copy that exists only under the workspace (app/node_modules/@vitejs/plugin-react
// today) is fine — one copy, no disagreement possible.
//
// Scope is the ROOT package-lock.json alone, and `extension/` is deliberately not
// in it: the root lockfile declares `workspaces: ["app"]` and carries no entry
// whose path starts with `extension`, because extension/ is a standalone npm
// project with its own lockfile and no workspaces of its own. There is no
// root/workspace pair there for anything to land in twice, so adding a direct
// dependency to extension/package.json cannot make this guard red.
//
// The fix when this goes red is `npm dedupe --legacy-peer-deps` (the flag for the
// same electron-vite peer conflict scripts/setup.cts explains); see docs/build.md.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

type LockEntry = { version?: string; link?: boolean };
type Lock = { packages?: Record<string, LockEntry> };

type Duplicate = { name: string; root: string; workspace: string };

const NM = 'node_modules/';

// Reads the workspace directories out of the lockfile's own keys rather than
// expanding the `workspaces` globs in package.json: the keys are what npm wrote,
// so this stays correct if a second workspace is ever added.
function workspaceDirs(lock: Lock): string[] {
  const dirs = new Set<string>();
  for (const key of Object.keys(lock.packages ?? {})) {
    if (!key || key.startsWith(NM)) continue;
    const at = key.indexOf(`/${NM}`);
    if (at > 0) dirs.add(key.slice(0, at));
  }
  return [...dirs].sort();
}

function duplicatesAcrossWorkspaces(lock: Lock): Duplicate[] {
  const packages = lock.packages ?? {};
  const found: Duplicate[] = [];
  for (const dir of workspaceDirs(lock)) {
    const prefix = `${dir}/${NM}`;
    for (const [key, entry] of Object.entries(packages)) {
      if (!key.startsWith(prefix) || entry.link) continue;
      const name = key.slice(prefix.length);
      // Only a copy nested DIRECTLY under the workspace competes with the root
      // one; anything deeper belongs to that package's own subtree.
      if (name.includes(NM)) continue;
      const rootEntry = packages[`${NM}${name}`];
      if (!rootEntry || rootEntry.link) continue;
      found.push({ name, root: rootEntry.version ?? '?', workspace: entry.version ?? '?' });
    }
  }
  return found;
}

describe('duplicatesAcrossWorkspaces', () => {
  test('#891 の形（root と app に別バージョンの vite）を見つける', () => {
    const lock: Lock = {
      packages: {
        '': {},
        app: {},
        'node_modules/vite': { version: '8.1.5' },
        'app/node_modules/vite': { version: '8.2.0' },
        'node_modules/hologram-app': { link: true },
      },
    };
    expect(duplicatesAcrossWorkspaces(lock).map((d) => `${d.name} ${d.root}/${d.workspace}`)).toEqual(['vite 8.1.5/8.2.0']);
  });

  test('同じバージョンでも二重持ちは二重持ち＝見つける', () => {
    // npm can land identical versions in both places too. It builds no wrong
    // binary, but it is the same tree shape one version bump away from #891.
    const lock: Lock = { packages: { '': {}, app: {}, 'node_modules/vite': { version: '8.2.1' }, 'app/node_modules/vite': { version: '8.2.1' } } };
    expect(duplicatesAcrossWorkspaces(lock)).toHaveLength(1);
  });

  test('ワークスペース側にしか無いものは重複ではない', () => {
    const lock: Lock = { packages: { '': {}, app: {}, 'app/node_modules/@vitejs/plugin-react': { version: '6.0.5' } } };
    expect(duplicatesAcrossWorkspaces(lock)).toEqual([]);
  });

  test('ワークスペース配下の入れ子の入れ子は数えない', () => {
    const lock: Lock = {
      packages: { '': {}, app: {}, 'node_modules/vite': { version: '8.2.1' }, 'app/node_modules/rolldown/node_modules/vite': { version: '8.1.5' } },
    };
    expect(duplicatesAcrossWorkspaces(lock)).toEqual([]);
  });
});

test('package-lock.json が root とワークスペースに同じパッケージを二重に持たない', () => {
  const lock: Lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const dupes = duplicatesAcrossWorkspaces(lock);
  expect(
    dupes.map((d) => `${d.name}: node_modules=${d.root} / ワークスペース=${d.workspace}`),
    '重複解決が残っています。`npm dedupe --legacy-peer-deps` で畳んでください（docs/build.md「重複解決を残さない」）',
  ).toEqual([]);
});
