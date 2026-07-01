'use strict';

// Verifies two confirmed 'text' leaves can be combined with a DRAG into an OR group
// (the headline scenario: 猫 Enter → 犬 → drag onto each other → (猫 OR 犬), then the
// connector toggles to AND). Drag is synthesized the same way as _verify-tree.js, so
// this runs in the SMOKE hidden window — no real app needed.
//   seeds: p0 本文「猫がすき」/ p1「犬がすき」/ p2「猫と犬」/ p3「鳥」
//   猫 (confirm)          -> p0,p2          = 2
//   犬 (editing) AND 猫   -> 猫と犬          = 1
//   drag 犬 onto 猫       -> (猫 OR 犬)      = 3
//   click the connector  -> (猫 AND 犬)     = 1
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
  const textChips = () => document.querySelectorAll('#queryChips .qb-pill.qc-text').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const pillByLabel = (t) => [...document.querySelectorAll('#queryChips .qb-pill')].find((p) => (p.querySelector('.qb-pill-label') || {}).textContent === t);
  const dnd = (src, dst) => {
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  };
  await waitFor(() => cards() >= 4);
  const sb = document.getElementById('searchBox');
  const setVal = (v) => { sb.value = v; sb.dispatchEvent(new Event('input', { bubbles: true })); };
  const enter = () => sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const r = {};
  setVal('猫'); await wait(240);
  r.catCards = cards();        // 猫がすき, 猫と犬 = 2
  enter(); await wait(140);    // confirm 猫
  setVal('犬'); await wait(240);
  r.chips = textChips();       // 2 (猫 confirmed + 犬 editing)
  r.andCards = cards();        // 猫 AND 犬 = 猫と犬 = 1
  enter(); await wait(140);    // confirm 犬 too
  const catPill = pillByLabel('猫'), dogPill = pillByLabel('犬');
  r.pills = (!!catPill) + ',' + (!!dogPill);
  dnd(dogPill, catPill); await wait(180);
  r.orCards = cards();         // (猫 OR 犬) = 3
  r.hasGroup = !!document.querySelector('#queryChips .qb-grp .qb-paren');
  const op = document.querySelector('#queryChips .qb-grp .qb-op');
  if (op) op.click();
  await wait(180);
  r.andAfter = cards();        // (猫 AND 犬) = 1
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
  const ok = r.catCards === 2 && r.chips === 2 && r.andCards === 1 && r.pills === 'true,true' && r.orCards === 3 && r.hasGroup === true && r.andAfter === 1;
  console.log(`catCards=${r.catCards} chips=${r.chips} andCards=${r.andCards} pills=${r.pills} orCards=${r.orCards} hasGroup=${r.hasGroup} andAfter=${r.andAfter}`);
  console.log(ok ? 'TEXTLEAF_OR_TEST_PASS' : 'TEXTLEAF_OR_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
