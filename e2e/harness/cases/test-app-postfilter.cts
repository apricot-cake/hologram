'use strict';

// フィルタバー上での投稿ビューのフィルタフローを検証する（P2③――Activebar／qf-popの
// フライアウト時代は終わった）:
//  - 「+ フィルタ」の値エディタ経由でプラットフォームフィルタを追加すると、チップが
//    表示され、グリッドが絞り込まれ、行にチェックが付き、エディタは開いたままになる
//  - チップの✕がファセットを消す（チップが消え、グリッドが元に戻る）
// （検索語のテキストチップはtest-app-textleaf.ctsがカバーしている。全解除の導線は
// チップ行が予定している「すべて解除」――まだ実装されていない、#154。）
// 投稿ビューが既定モードなので、モード切り替えは不要。
//
//   node e2e/harness/cases/test-app-postfilter.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-pf-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// p0/p1 = x、p2 = bluesky――だからplatform=Xフィルタは実際にグリッドを絞り込む。
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-pf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: i === 2 ? 'https://bsky.app/profile/u2/post/702' : 'https://x.com/u/status/' + (700 + i),
    platform: i === 2 ? 'bluesky' : 'x',
    text: '投稿' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  // フィルタバーの作法（test-app-facetcounts参照）: 「+ フィルタ」のポップオーバー→
  // カテゴリ→ValueEditorの行、チップは[data-slot=filter-chips]の行に。
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
  const rowEl = (name) =>
    edRows().find((el) => {
      const n = el.querySelector('span.truncate');
      return n && n.textContent === name;
    }) || null;
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipCount = () => {
    const row = chipRow();
    return row ? row.querySelectorAll(':scope > span').length : 0;
  };
  await waitFor('the grid to show all 3 seeded posts', () => cards() >= 3);
  const chipsBefore = chipCount(); // 0――何もフィルタされていない間はチップ行が無い
  const rowAbsentBefore = chipRow() === null; // #674――このバンドはunmountされていて、空なだけではない
  // 値エディタ経由でプラットフォームフィルタを追加する
  byText('button', 'フィルタ').click();
  await waitFor('the filter menu to open', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  byText(POP + ' [data-slot="command-item"]', 'サイト').click(); // #253: renamed from プラットフォーム
  await waitFor('the site editor to list the X row', () => !!rowEl('X'));
  // オプショナルチェイニングではなく名前を付ける＝このクリックこそテスト対象の
  // フィルタなので、行が無ければ実行を止める。下の待機にグリッドのせいにさせては
  // いけない。
  const xRow = rowEl('X');
  if (!xRow) throw new Error('the X row is missing from the site editor');
  xRow.click();
  // 「グリッドが2件になった」ではなく「グリッドが3件から動いた」を待つ――チップ行、
  // 件数、下の✓はアサーションであって、それを待機条件と兼用してはいけない。
  await waitFor('the grid to narrow once the site filter is applied', () => cards() < 3);
  const rowPresentAfter = chipRow() !== null; // #674――チップが1つでもあればバンドがマウントされる
  const chipBand = chipRow();
  if (!chipBand) throw new Error('the filter chip band is missing after the site filter was applied');
  const chipShown = chipCount() === 1 && (chipBand.textContent || '').includes('X');
  const cardsFiltered = cards(); // 2 (p0,p1)
  const xRowAfter = rowEl('X');
  const rowChecked = !!(xRowAfter && xRowAfter.querySelector('svg')); // 選んだ行に✓が付く
  const stillOpen = !!document.querySelector(POP); // さらに選べるようエディタは開いたまま
  // ポップオーバーを閉じる（閉じ始めた瞬間に[data-closed]が付くので、間引かれた
  // unmountではなくそれを待つ）。そしてチップの✕経由でクリアする。
  byText('button', 'フィルタ').click();
  await waitFor('the value editor to start closing', () => !document.querySelector(POP));
  // 再クエリする: ポップオーバーが閉じている間にバンドは再描画される。
  const chipBandNow = chipRow();
  const clearBtn = chipBandNow ? chipBandNow.querySelector<HTMLElement>(':scope > span > button[aria-label="削除"]') : null;
  if (!clearBtn) throw new Error('the ✕ button is missing from the filter chip band');
  clearBtn.click();
  await waitFor('the grid to widen again once the chip is cleared', () => cards() > cardsFiltered);
  const chipsAfter = chipCount(); // 0
  const rowAbsentAfter = chipRow() === null; // #674――最後のチップを消すとバンドは再びunmountされる
  const cardsAfter = cards(); // 3
  return { chipsBefore, rowAbsentBefore, rowPresentAfter, chipShown, cardsFiltered, rowChecked, stillOpen, chipsAfter, rowAbsentAfter, cardsAfter };
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* 無視 */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.chipsBefore === 0 && r.rowAbsentBefore === true && r.rowPresentAfter === true && r.chipShown === true && r.cardsFiltered === 2 && r.rowChecked === true && r.stillOpen === true && r.chipsAfter === 0 && r.rowAbsentAfter === true && r.cardsAfter === 3;
  console.log(`chipsBefore=${r.chipsBefore} rowAbsentBefore=${r.rowAbsentBefore} rowPresentAfter=${r.rowPresentAfter} chipShown=${r.chipShown} filtered=${r.cardsFiltered} rowChecked=${r.rowChecked} stillOpen=${r.stillOpen} chipsAfter=${r.chipsAfter} rowAbsentAfter=${r.rowAbsentAfter} cardsAfter=${r.cardsAfter}`);
  console.log(ok ? 'POSTFILTER_TEST_PASS' : 'POSTFILTER_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
