'use strict';
// Throwaway: verify the 改訂④ facet builder's schema-driven behaviour + legacy fallback.
//   Part 1 — platform は自動どれか(OR): 2値目のクリックで恒偽AND(改訂③の罠)にならず
//            クラスタに合流して OR で効く。演算子トグルは出ない（スキーマが答える）。
//   Part 2 — 旧・非ファセット形の保存木（改訂③の入れ子）は読み取り要約(.qb-summary)で
//            表示され評価はそのまま効く。リセットで作り直せる。
// Seeds: p0 x[A], p1 x[B], p2 misskey[B], p3 x[], p4 bluesky[].
//   platform=x                 -> 3 (p0,p1,p3)
//   platform=misskey           -> (x・misskey) auto-OR -> 4 (bluesky だけ除外)
//   tab2 (legacy tree A ∨ (B∧x)) -> summary 表示・2件 (p0,p1)
//   リセット                    -> 5件・要約消滅・タグ A 追加でクラスタ復帰 -> 1
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tr-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x', host: 'x.com', tags: ['A'] },
  { plat: 'x', host: 'x.com', tags: ['B'] },
  { plat: 'misskey', host: 'misskey.io', tags: ['B'] },
  { plat: 'x', host: 'x.com', tags: [] },
  { plat: 'bluesky', host: 'bsky.app', tags: [] },
];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-tr' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://' + s.host + '/u/status/' + (500 + i),
    platform: s.plat, text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: s.tags, hashtags: []
  }, null, 2));
});
// Legacy 改訂③ nesting the facet UI can't build: A ∨ (B ∧ platform:x) → p0,p1 = 2件.
const legacyTree = {
  kind: 'group', op: 'and', neg: false, children: [
    { kind: 'group', op: 'or', neg: false, children: [
      { kind: 'cond', type: 'tag', value: 'A' },
      { kind: 'group', op: 'and', neg: false, children: [
        { kind: 'cond', type: 'tag', value: 'B' },
        { kind: 'cond', type: 'platform', value: 'x' },
      ] },
    ] },
  ],
};
fs.writeFileSync(path.join(saveFolder, 'tabs.json'), JSON.stringify({
  activeTabId: 't1',
  tabs: [
    { id: 't1', pinned: false, title: null, state: null, scrollTop: 0 },
    { id: 't2', pinned: false, title: '旧式', state: { f: [], tree: legacyTree, search: '', sort: 'date-desc', multi: false }, scrollTop: 0 },
  ],
}));
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const qfVal = (label) => [...document.querySelectorAll('.qf-pop .fm-row')].find((r) => { const n = r.querySelector('.fm-name'); return n && n.textContent === label; });
  const log = [];
  try {
    await waitFor(() => cards() >= 5);
    // Part 1: platform 2値 → 自動どれか(OR)
    click(document.querySelector('#filterRows [data-qfrow="platform"]')); await wait(80);
    click(await waitFor(() => qfVal('X'))); await wait(100);
    const pX = cards();                                        // x → 3
    click(await waitFor(() => qfVal('Misskey'))); await wait(100);
    const orAuto = cards();                                    // (x・misskey) auto-OR → 4
    const clusters = document.querySelectorAll('#queryChips .qb-cluster').length;
    const vals = document.querySelectorAll('#queryChips .qb-cluster .qb-val').length;
    const noOpt = !document.querySelector('#queryChips .qb-opt'); // 単一値型にトグルは出ない
    click(document.querySelector('#postResetBtn')); await wait(120);
    // Part 2: 旧・非ファセット木のタブ → 読み取り要約＋評価維持
    const tabItems = document.querySelectorAll('#tabBar .tab-item');
    log.push('tabs=' + tabItems.length);
    click(tabItems[1]); await wait(200);
    const legacyCards = cards();                               // A ∨ (B∧x) → 2
    const summaryShown = !!document.querySelector('#queryChips .qb-summary');
    const summaryText = summaryShown ? document.querySelector('#queryChips .qb-summary').textContent : '';
    const noVals = !document.querySelector('#queryChips .qb-val');
    // リセットで作り直し → 通常のファセット編集へ復帰
    click(document.querySelector('#postResetBtn')); await wait(150);
    const afterReset = cards();                                // 5
    const summaryGone = !document.querySelector('#queryChips .qb-summary');
    click(document.querySelector('#filterRows [data-qfrow="tag"]')); await wait(80);
    click(await waitFor(() => qfVal('A'))); await wait(100);
    const rebuilt = cards();                                   // tag A → 1
    const hasCluster = !!document.querySelector('#queryChips .qb-cluster');
    return { ok: true, log, pX, orAuto, clusters, vals, noOpt, legacyCards, summaryShown, summaryText, noVals, afterReset, summaryGone, rebuilt, hasCluster };
  } catch (e) { return { ok: false, log, err: e.message }; }
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.ok === true && r.pX === 3 && r.orAuto === 4 && r.clusters === 1 && r.vals === 2 && r.noOpt === true &&
    r.legacyCards === 2 && r.summaryShown === true && r.noVals === true &&
    r.afterReset === 5 && r.summaryGone === true && r.rebuilt === 1 && r.hasCluster === true;
  console.log(`log=${JSON.stringify(r.log)} err=${r.err || '-'} pX=${r.pX} orAuto=${r.orAuto} clusters=${r.clusters} vals=${r.vals}` +
    ` noOpt=${r.noOpt} legacyCards=${r.legacyCards} summaryShown=${r.summaryShown} summaryText=${JSON.stringify(r.summaryText)}` +
    ` noVals=${r.noVals} afterReset=${r.afterReset} summaryGone=${r.summaryGone} rebuilt=${r.rebuilt} hasCluster=${r.hasCluster}`);
  console.log(ok ? 'TREE_VERIFY_PASS' : 'TREE_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
