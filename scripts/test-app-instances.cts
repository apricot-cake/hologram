'use strict';

// インスタンスフィルタ（Misskey のホスト）を検証する。今はサイド
// バーの行→フライアウトで提供される: フライアウトはすべてのホストを一覧し、
// 1つを選ぶとグリッドが絞られ（行のバッジも
// 点灯する）、もう一度選ぶと解除される。（旧来のプラットフォームチップが
// サーバーへ展開する UI は引退した。）
//
//   node scripts/test-app-instances.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-inst-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, platform, url, when) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url,
    platform,
    text: id,
    screenName: 'u',
    displayName: 'U',
    tags: [],
    capturedAt: when,
    date: when,
  });
}
addPost('k1', 'misskey', 'https://misskey.io/notes/aaa', '2026-01-05T00:00:00Z');
addPost('k2', 'misskey', 'https://misskey.io/notes/bbb', '2026-01-04T00:00:00Z');
addPost('k3', 'misskey', 'https://nijimiss.moe/notes/ccc', '2026-01-03T00:00:00Z');
addPost('k4', 'misskey', 'https://mi.sabbo.dev/notes/ddd', '2026-01-02T00:00:00Z');
addPost('k5', 'misskey', 'https://mi.sabbo.dev/notes/eee', '2026-01-01T00:00:00Z');
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  await waitFor('グリッドがシードした5件の投稿すべてを表示すること', () => cards() >= 5);

  // プラットフォームエディタ（「+ フィルタ」の流れ）-> インスタンスは
  // Misskey の直下にインデントされたサブ行（pl-6）として一覧される。
  // フィルタバーの流儀: test-app-facetcounts を参照。
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
  const rowName = (r) => {
    const n = r.querySelector('span.truncate');
    return n ? n.textContent : '';
  };
  const rowByName = (name) => edRows().find((r) => rowName(r) === name) || null;
  // クリックごとに再問い合わせする: フィルタを適用するとエディタが再描画
  // されるので、保持した参照は切り離されたノードをクリックしてしまう。
  // 無い行は飛ばすのではなく名指す — 飛ばしたクリックは、下の待ちに
  // 何か別のことを報告させてしまう。
  const clickRow = (name) => {
    const row = rowByName(name);
    if (!row) throw new Error('サイトエディタに ' + name + ' の行が見つからない');
    row.click();
  };
  const subRows = () => edRows().filter((r) => r.className.includes('pl-6'));
  const chipsText = () => {
    const c = document.querySelector('[data-slot="filter-chips"]');
    return c ? c.textContent || '' : '';
  };
  byText('button', 'フィルタ').click();
  await waitFor('フィルタメニューが開くこと', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  byText(POP + ' [data-slot="command-item"]', 'サイト').click(); // #253: プラットフォーム から改名
  await waitFor('サイトエディタがすべてのインスタンスホストを一覧すること', () => subRows().length >= 3);
  const hosts = subRows().map(rowName).sort();
  const subIndented = subRows().some((r) => rowName(r) === 'misskey.io');

  // misskey.io を選ぶ -> 2件、チップが現れ、エディタは開いたまま。
  // 待つのは「グリッドが5から動いた」ことであり「グリッドが2を示す」こと
  // ではないので、件数・チップ・開いたエディタは以下でまとめて検証する。
  clickRow('misskey.io');
  await waitFor('インスタンスを選んだらグリッドが絞られること', () => cards() < 5);
  const socialCount = cards();
  const chipOn = chipsText().includes('misskey.io');
  const stillOpen = !!document.querySelector(POP);

  // もう一度クリックして解除 -> 5件すべて、チップが消える
  clickRow('misskey.io');
  await waitFor('インスタンスが解除されたらグリッドが再び広がること', () => cards() > socialCount);
  const cleared = cards();
  const chipOff = !chipsText().includes('misskey.io');

  return { hosts, subIndented, socialCount, chipOn, stillOpen, cleared, chipOff };
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
  } catch {
    /* ignore */
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };
  check('プラットフォームエディタがすべてのホストをインデントされたサブ行として入れ子にする', eq(r.hosts, ['mi.sabbo.dev', 'misskey.io', 'nijimiss.moe']) && r.subIndented === true);
  check('misskey.io を選ぶと2件に絞られる（チップ点灯、エディタは開いたまま）', r.socialCount === 2 && r.chipOn === true && r.stillOpen === true);
  check('もう一度選ぶとフィルタが解除される（投稿5件、チップ消灯）', r.cleared === 5 && r.chipOff === true);
  console.log('\n' + (ok ? 'INSTANCES_TEST_PASS' : 'INSTANCES_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
