// app/package.json の宣言したバージョンに意味を持たせている唯一の性質を守る＝
// ワークスペースが引き込むパッケージは、木の中に1つだけ存在しなければならない（#891）。
//
// ここで捕まえる失敗の、実際に起きた形。app/ が vite を ^8.1.0 から ^8.2.0 へ上げ、npm は
// ロックファイルを最小限だけ書き換えて vite 8.2.0 を app/node_modules へ入れた。root に
// すでに居た 8.1.5 は動かさないまま。どちらのコピーも npm の正当な出力で、「不正」なものは
// 何も無く、テストも全部通る。ところが electron-vite は root へ巻き上げられているので、
// そこからの `require('vite')` は root のコピーを掴む。app/package.json が ^8.2.0 と言って
// いるのに、ビルドは 8.1.5 で走る。宣言とビルドが離れていて、気づく手立てはビルドログの
// バージョン表示を読むことしかない。
//
// なぜ「同じパッケージが二度現れてはいけない」ではなく root とワークスペースの対に限るのか。
// このロックファイルには、複数のバージョンに解決されて当然の名前が 66 ある（互換しない範囲を
// 要求する推移的な依存元＝semver、minimatch、chalk など）。それを畳むのは npm の仕事でも
// こちらの仕事でもない。下で見る対はそれとは違う。root とワークスペースは、同じ1つの宣言が
// 着地しうる2か所で、そこにコピーが2つあるなら、ワークスペースが何を宣言したのかについて
// 使う側の見解が割れているということ。
//
// ワークスペースの下にしか無いコピー（今なら app/node_modules/@vitejs/plugin-react）は
// 問題ない＝コピーは1つで、見解の割れようが無い。
//
// 対象は root の package-lock.json だけで、`extension/` は意図して入れていない。root の
// ロックファイルは `workspaces: ["app"]` を宣言していて、`extension` で始まるパスの
// エントリを1つも持たない。extension/ が自分のロックファイルを持ち、自分のワークスペースを
// 持たない独立した npm プロジェクトだからだ。そこには二重に着地する root とワークスペースの
// 対が無いので、extension/package.json へ直接の依存を足してもこの防ぎが赤くなることはない。
//
// 赤くなったときの直し方は `npm dedupe --legacy-peer-deps`（このフラグは scripts/setup.cts が
// 説明している electron-vite の peer 衝突に対するもの）。docs/開発.md を参照。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

type LockEntry = { version?: string; link?: boolean };
type Lock = { packages?: Record<string, LockEntry> };

type Duplicate = { name: string; root: string; workspace: string };

const NM = 'node_modules/';

// ワークスペースのディレクトリは、package.json の `workspaces` の glob を展開するのではなく
// ロックファイル自身のキーから読む。キーは npm が書いたものなので、ワークスペースが2つ目に
// 増えてもここは正しいままになる。
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
      // root のコピーと競合するのは、ワークスペースの直下に入れ子になったコピーだけ。
      // それより深いものは、そのパッケージ自身の部分木に属する。
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
    // npm は同じバージョンを両方へ着地させることもある。それで間違ったものがビルド
    // されるわけではないが、木の形は #891 とバージョン1つぶんしか違わない。
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
    '重複解決が残っています。`npm dedupe --legacy-peer-deps` で畳んでください（docs/開発.md「準備」）',
  ).toEqual([]);
});
