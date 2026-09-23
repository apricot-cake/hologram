'use strict';

// サイドバーの投稿者セクション（投稿の投稿者フィールドから導出、追加の取得は
// 無い。旧Usersタブを置き換えた）を検証する: 複数の投稿者ぶんの投稿をシードし、
// 投稿者チップが投稿数でグループ化・順位付けされること、投稿者検索がそれらを
// 絞り込む（先頭の「@」を無視する）こと、投稿者チップのクリックが`user`
// フィルタを適用する（ピル＋絞り込まれたグリッド）ことを確認する。
//
//   node e2e/harness/cases/test-app-users.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-users-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, platform, userId, screenName, displayName, when) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://example.com/${id}`,
    platform,
    userId,
    screenName,
    displayName,
    text: id,
    tags: [],
    capturedAt: when,
    date: when,
  });
}
// Alice（x）は投稿2件、Bob（bluesky）とCarol（pixiv）はそれぞれ1件。
addPost('a1', 'x', '111', 'alice', 'Alice', '2026-01-04T00:00:00.000Z');
addPost('a2', 'x', '111', 'alice', 'Alice', '2026-01-03T00:00:00.000Z');
addPost('b1', 'bluesky', 'did:plc:bob', 'bob.bsky.social', 'Bob', '2026-01-02T00:00:00.000Z');
addPost('c1', 'pixiv', '104', '104', 'Carol', '2026-01-01T00:00:00.000Z');
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  await waitFor('the grid to show all 4 seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 4);

  // 投稿者エディタ（「+ フィルタ」フロー＝旧来の投稿者行フライアウトはP2③以降
  // 無くなった）＝投稿者は投稿数順に並ぶ。filterbarの作法はtest-app-facetcounts
  // 参照。
  const POP = '[data-slot="dropdown-menu-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' [role="menuitemcheckbox"]')];
  const nameOf = (r) => {
    const n = r.querySelector('span.min-w-0');
    return n?.childNodes[0]?.textContent?.trim() || '';
  };
  byText('button', 'フィルタ').click();
  await waitFor('the filter menu to open', () => !!document.querySelector(POP + ' [data-slot="filter-panel"]'));
  const authorTrigger = byText(POP + ' [data-slot="dropdown-menu-sub-trigger"]', '投稿者');
  if (!authorTrigger) throw new Error('フィルタメニューに 投稿者 カテゴリが見つからない');
  authorTrigger.click();
  await waitFor('the author submenu to open', () => document.querySelectorAll(POP).length > 1);
  await waitFor('the author editor to list its 3 authors', () => edRows().length >= 3);
  const allNames = edRows().map(nameOf); // Alice(2), Bob, Carol

  // Aliceをクリック → userフィルタが適用される（エディタは開いたまま、行に✓）
  // オプショナルチェーンではなく名前を付ける: この行こそがこのテストの対象
  // そのものなので、無ければ実行を止めてそう言わなければならない。`?.`だと
  // クリックがスキップされ、後の検証に別のことを報告させてしまう。
  const aliceRow = edRows().find((r) => nameOf(r) === 'Alice');
  if (!aliceRow) throw new Error('投稿者エディタにAliceの行がありません');
  aliceRow.click();
  // チップが現れることが、このクリックの観測可能な事後条件。カード数はその後
  // 読むが別途検証するので、グリッドを絞り込まないまま着地したフィルタも
  // ちゃんと失敗する。
  await waitFor('the filter chip bar to show the applied user filter', () => {
    const bar = document.querySelector('[data-slot="filter-chips"]');
    return !!bar && (bar.textContent || '').includes('Alice');
  });
  const chips = document.querySelector('[data-slot="filter-chips"]');
  const chipText = chips ? [chips.textContent] : [];
  const cardCount = document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const aliceActive = await waitFor('the Alice row to show its ✓', () => !!edRows().find((r) => nameOf(r) === 'Alice' && r.querySelector('svg')));
  const stillOpen = !!document.querySelector(POP);

  return { allNames, chipText, cardCount, aliceActive, stillOpen };
});

const shot = path.join(appDir, '.smoke-shot.png');
try {
  fs.unlinkSync(shot);
} catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
  HOLOGRAM_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {}
  try {
    fs.unlinkSync(shot);
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('エディタ内で投稿者が投稿数順に並ぶ（Alice、Bob、Carol）', eq(r.allNames, ['Alice', 'Bob', 'Carol']));
  check('有効なフィルタチップがユーザー（Alice）を表示する', Array.isArray(r.chipText) && String(r.chipText[0] || '').includes('Alice'));
  check('そのユーザーの投稿2件に絞り込まれる', r.cardCount === 2);
  check('選んだ投稿者の行に✓が付き、エディタは開いたまま', r.aliceActive === true && r.stillOpen === true);
  console.log('\n' + (ok ? 'USERS_TEST_PASS' : 'USERS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
