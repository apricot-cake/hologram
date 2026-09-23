'use strict';

// タグ と ハッシュタグ の値エディタ（「+ フィルタ」の流れ — サイドバー行の
// フライアウトは P2③以降無くなった）を検証する:
// - タグ エディタはすべての利用者タグを一覧する
// - ハッシュタグ エディタは投稿本文からハッシュタグを一覧する。選ぶとグリッドが絞られる
//
//   node e2e/harness/cases/test-app-hashtags.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ht-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, text, tags, hashtags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u/status/${id}`,
    platform: 'x',
    text,
    tags: tags || [],
    hashtags: hashtags || [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  });
}
// 一意な利用者タグを8個にして、タグのフライアウトの検索欄が表示されるように
// する（8件を超えると表示される）。
addPost('p1', 'TypeScript最高', ['alpha', 'beta', 'gamma'], ['typescript', 'プログラミング']);
addPost('p2', '別記事の続き', ['delta', 'epsilon'], ['typescript']);
addPost('p3', 'タグなし投稿', ['zeta', 'eta', 'theta'], ['rust']);
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => cards() >= 3);

  // フィルタバーは Base UI の入れ子メニュー。カテゴリ間の移動は、ルートを
  // 閉じて開き直すことで行う。値のメニューは別のポータルに出る。
  const POP = '[data-slot="dropdown-menu-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' [role="menuitemcheckbox"]')];
  const rowEl = (name) =>
    edRows().find((el) => {
      const n = el.querySelector('span.min-w-0');
      return n?.childNodes[0]?.textContent?.trim() === name;
    }) || null;
  const openMenu = async () => {
    byText('button', 'フィルタ').click();
    await waitFor('フィルタメニューが開くこと', () => !!document.querySelector(POP + ' [data-slot="filter-panel"]'));
  };
  const pickCat = async (label) => {
    const trigger = byText(POP + ' [data-slot="dropdown-menu-sub-trigger"]', label);
    if (!trigger) throw new Error('フィルタメニューに ' + label + ' カテゴリが見つからない');
    trigger.click();
    await waitFor(label + ' の値エディタが値を一覧すること', () => edRows().length > 0);
    // 下の行数の検証こそが主張なので、このテストが確かめるべき数値を待つの
    // ではなく、一覧が伸びなくなるのを待つ。
    await waitStable(label + ' の値の一覧が伸びなくなること', () => edRows().length);
  };
  const goBack = async () => {
    const trigger = byText('button', 'フィルタ');
    if (!trigger) throw new Error('ツールバーに フィルタ ボタンが見つからない');
    trigger.click();
    await waitFor('値メニューが閉じること', () => !document.querySelector(POP));
    await openMenu();
  };

  // --- タグ エディタ: 8個の利用者タグすべてを一覧する ---
  await openMenu();
  await pickCat('タグ');
  const tagFlyCount = edRows().length;

  // --- ハッシュタグ エディタ: 3つの異なるハッシュタグを一覧する。'#typescript' を選ぶ ---
  await goBack();
  await pickCat('ハッシュタグ');
  const htFlyCount = edRows().length;
  const tsRow = rowEl('#typescript');
  // 飛ばすのではなく名指す: `if (tsRow)` にすると、行が無い場合クリックが
  // 行われないまま次の待ちがタイムアウトし、「グリッドが一度も絞られな
  // かった」と言うことになる。それでは無かった行ではなくフィルタの方を
  // 指してしまう。
  if (!tsRow) throw new Error('ハッシュタグエディタに #typescript の行が見つからない');
  tsRow.click();
  await waitFor('#typescript を選んだらグリッドが絞られること', () => cards() < 3);
  const htCards = cards();

  return { tagFlyCount, htFlyCount, htCards };
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
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('タグ行のフライアウトが8個の利用者タグを一覧する', r.tagFlyCount === 8);
  check('ハッシュタグ行のフライアウトが3つの異なるハッシュタグを一覧する', r.htFlyCount === 3);
  check('#typescript を選ぶとグリッドが2件に絞られる', r.htCards === 2);
  console.log('\n' + (ok ? 'HASHTAG_TEST_PASS' : 'HASHTAG_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
