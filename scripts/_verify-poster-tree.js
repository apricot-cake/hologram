'use strict';
// Throwaway: verify the POSTER-view facet builder (改訂④ — the same builder factory as
// the post view, evaluated against poster/user objects). Mirrors _verify-tree.js Part 1.
// Seeds 4 posters: Alice(x) Bob(bluesky) Carol(x) Dave(misskey).
//   switch to poster mode          -> 4 cards
//   platform=x                     -> [X]              -> Alice,Carol = 2
//   platform=bluesky               -> (X・Bluesky) auto-OR -> 3  ← 改訂③では恒偽ANDで 0 だった罠
//   structure: 1クラスタ2値・トグル無し・式の語彙/ドラッグ無し・読み下し文表示
//   click リセット                  -> 4
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ptr-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x', host: 'x.com', sn: 'alice', dn: 'Alice' },
  { plat: 'bluesky', host: 'bsky.app', sn: 'bob', dn: 'Bob' },
  { plat: 'x', host: 'x.com', sn: 'carol', dn: 'Carol' },
  { plat: 'misskey', host: 'misskey.io', sn: 'dave', dn: 'Dave' },
];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-pt' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://' + s.host + '/' + s.sn + '/status/' + (500 + i),
    platform: s.plat, text: '本文' + i, displayName: s.dn, screenName: s.sn,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
});
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const cards = () => document.querySelectorAll('#posterGrid .poster-card').length;
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const qfVal = (label) => [...document.querySelectorAll('.qf-pop .fm-row')].find((r) => { const n = r.querySelector('.fm-name'); return n && n.textContent === label; });
  const log = [];
  try {
    // wait for posts to load, then switch to poster mode
    await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 4);
    click(document.querySelector('#browseToggle [data-mode="posters"]')); await wait(150);
    await waitFor(() => cards() >= 4);
    const allFour = cards();                                   // 4 posters
    // platform=x via the poster sidebar flyout
    click(document.querySelector('#posterFilterRows [data-qfrow="poster-platform"]')); await wait(90);
    click(await waitFor(() => qfVal('X'))); await wait(120);
    const pX = cards();                                        // [X] → Alice,Carol = 2
    // platform=bluesky from the same open flyout → クラスタに合流して自動どれか(OR)
    click(await waitFor(() => qfVal('Bluesky'))); await wait(120);
    const orAuto = cards();                                    // (X ∨ Bluesky) → 3
    const clusters = document.querySelectorAll('#posterQueryChips .qb-cluster').length;
    const vals = document.querySelectorAll('#posterQueryChips .qb-cluster .qb-val').length;
    const noOpt = !document.querySelector('#posterQueryChips .qb-opt');
    const noFormula = !document.querySelector('#posterQueryChips .qb-op, #posterQueryChips .qb-paren, #posterQueryChips [draggable="true"]');
    const sentEl = document.getElementById('posterQuerySent');
    const sentence = sentEl && sentEl.style.display !== 'none' ? sentEl.textContent : '';
    // リセット clears the poster tree
    click(document.querySelector('#posterResetBtn')); await wait(120);
    const afterReset = cards();                                // back to 4
    return { ok: true, log, allFour, pX, orAuto, clusters, vals, noOpt, noFormula, sentence, afterReset };
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
  const ok = r.ok === true && r.allFour === 4 && r.pX === 2 && r.orAuto === 3 && r.clusters === 1 && r.vals === 2 &&
    r.noOpt === true && r.noFormula === true && typeof r.sentence === 'string' && r.sentence.length > 0 && r.afterReset === 4;
  console.log(`log=${JSON.stringify(r.log)} err=${r.err || '-'} allFour=${r.allFour} pX=${r.pX} orAuto=${r.orAuto}` +
    ` clusters=${r.clusters} vals=${r.vals} noOpt=${r.noOpt} noFormula=${r.noFormula} sentence=${JSON.stringify(r.sentence)} afterReset=${r.afterReset}`);
  console.log(ok ? 'POSTER_TREE_VERIFY_PASS' : 'POSTER_TREE_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
