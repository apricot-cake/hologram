'use strict';

// Verifies multiple confirmed 'text' leaves under the 改訂④ facet builder: text is a
// STANDALONE type (one chip per term, no cluster/toggle), terms combine with the root
// AND, and a term moves to the 除く cluster via the right-click menu ("doesn't contain").
// Runs in the SMOKE hidden window — no real app needed.
//   seeds: p0 本文「猫がすき」/ p1「犬がすき」/ p2「猫と犬」/ p3「鳥」
//   猫 (confirm)            -> p0,p2       = 2
//   犬 (editing) AND 猫     -> 猫と犬       = 1
//   犬 を右クリック→「除く」 -> 猫 ∧ ¬犬     = 猫がすき = 1
//   戻す                    -> 猫 ∧ 犬      = 1
//
//   node scripts/test-app-textleaf-or.js

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tlo-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const texts = ['猫がすき', '犬がすき', '猫と犬', '鳥'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-tlo' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: 'https://x.com/u/status/' + (500 + i),
        platform: 'x',
        text: texts[i],
        displayName: '人' + i,
        screenName: 'u' + i,
        likes: 10 + i,
        capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
        date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
        media: [],
        tags: [],
        hashtags: [],
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const textChips = () => document.querySelectorAll('#queryChips .qb-val.qc-text').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const valByLabel = (t) => [...document.querySelectorAll('#queryChips .qb-val')].find((p) => (p.querySelector('.qb-val-label') || {}).textContent === t);
  const rclick = (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  const menuRow = (txt) => [...document.querySelectorAll('.fold-menu.show .fm-row')].find((r) => ((r.querySelector('.fm-name') || {}).textContent || '').includes(txt));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await waitFor(() => cards() >= 4);
  const sb = document.getElementById('searchBox');
  // React controlled input (searchbox island): write via the prototype setter + 'input'
  const setVal = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const enter = () => sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const r = {};
  setVal('猫'); await wait(240);
  r.catCards = cards();        // 猫がすき, 猫と犬 = 2
  enter(); await wait(140);    // confirm 猫
  setVal('犬'); await wait(240);
  r.chips = textChips();       // 2 (猫 confirmed + 犬 editing)
  r.andCards = cards();        // 猫 AND 犬 = 猫と犬 = 1
  enter(); await wait(140);    // confirm 犬 too
  // text は単独型: クラスタ化もトグルも無し（1語1チップのまま）
  r.textClusters = document.querySelectorAll('#queryChips .qb-cluster.qc-text').length;
  r.noOpt = !document.querySelector('#queryChips .qb-opt');
  // 犬 を右クリック→「除く」へ移す → 猫 ∧ ¬犬 = 猫がすき = 1
  rclick(valByLabel('犬'));
  const exclRow = await waitFor(() => menuRow('移す'));
  click(exclRow); await wait(180);
  r.exclCards = cards();
  r.exclHas = !![...document.querySelectorAll('#queryChips .qb-cluster-excl .qb-val-label')].find((l) => l.textContent === '犬');
  // 戻す → 猫 ∧ 犬 = 1
  rclick(valByLabel('犬'));
  const backRow = await waitFor(() => menuRow('戻す'));
  click(backRow); await wait(180);
  r.backCards = cards();
  return r;
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.catCards === 2 && r.chips === 2 && r.andCards === 1 && r.textClusters === 2 && r.noOpt === true && r.exclCards === 1 && r.exclHas === true && r.backCards === 1;
  console.log(`catCards=${r.catCards} chips=${r.chips} andCards=${r.andCards} textClusters=${r.textClusters} noOpt=${r.noOpt} exclCards=${r.exclCards} exclHas=${r.exclHas} backCards=${r.backCards}`);
  console.log(ok ? 'TEXTLEAF_OR_TEST_PASS' : 'TEXTLEAF_OR_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
