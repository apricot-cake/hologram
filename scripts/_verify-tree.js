'use strict';
// Throwaway: verify the inline drag builder can express a CROSS-TYPE OR —
// (platform=x OR tag=口) — which the flat top level (AND) cannot, by DRAGGING one
// pill onto another to form a parenthesised group (docs/design-query-builder.md 改訂③).
// Seeds: p0 x[], p1 bluesky[口], p2 x[口], p3 misskey[].
//   add platform=x                 -> [x]            -> p0,p2          = 2
//   add tag=口                      -> [x かつ 口]    -> AND = p2       = 1
//   drag 口 onto x                  -> [(x または 口)] -> OR  = p0,p1,p2 = 3   (group op = 親の逆)
//   click the group connector       -> [(x かつ 口)]   -> AND = p2       = 1
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
  { plat: 'x', host: 'x.com', tags: [] },
  { plat: 'bluesky', host: 'bsky.app', tags: ['口'] },
  { plat: 'x', host: 'x.com', tags: ['口'] },
  { plat: 'misskey', host: 'misskey.io', tags: [] },
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
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const pillByLabel = (t) => [...document.querySelectorAll('#queryChips .qb-pill')].find((p) => (p.querySelector('.qb-pill-label') || {}).textContent === t);
  // Synthetic HTML5 drag: dragstart on src, dragover+drop at dst's centre (elementFromPoint).
  const dnd = (src, dst) => {
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  };
  const log = [];
  try {
    await waitFor(() => cards() >= 4);
    // add platform=x via the sidebar flyout
    click(document.querySelector('#filterRows [data-qfrow="platform"]')); await wait(80);
    click(await waitFor(() => document.querySelector('.qf-pop.show [data-qfval="x"]'))); await wait(100);
    const pAlone = cards();                                    // [x] → 2
    // add tag=口
    click(document.querySelector('#filterRows [data-qfrow="tag"]')); await wait(80);
    click(await waitFor(() => document.querySelector('.qf-pop.show [data-qfval="口"]'))); await wait(100);
    const andXTag = cards();                                   // top-level AND → x∧口 → 1
    // drag the 口 pill onto the x(=X) pill → parenthesised pair group, op = 親の逆 = OR
    const tagPill = pillByLabel('口'); const xPill = pillByLabel('X');
    log.push('pills=' + !!tagPill + ',' + !!xPill);
    dnd(tagPill, xPill); await wait(120);
    const orGroup = cards();                                   // (x ∨ 口) → 3
    const hasGrp = !!document.querySelector('#queryChips .qb-grp .qb-paren');
    // flip the group's connector to かつ (AND)
    const gop = document.querySelector('#queryChips .qb-grp .qb-op');
    log.push('gop=' + !!gop);
    if (gop) { click(gop); await wait(100); }
    const andGroup = cards();                                  // (x ∧ 口) → 1
    const noPanel = !document.querySelector('.qb-panel') && !document.querySelector('#queryChips [data-qb-open]');
    return { ok: true, log, pAlone, andXTag, orGroup, hasGrp, andGroup, noPanel };
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
  const ok = r.ok === true && r.pAlone === 2 && r.andXTag === 1 && r.orGroup === 3 &&
    r.hasGrp === true && r.andGroup === 1 && r.noPanel === true;
  console.log(`log=${JSON.stringify(r.log)} err=${r.err || '-'} pAlone=${r.pAlone} andXTag=${r.andXTag}` +
    ` orGroup=${r.orGroup} hasGrp=${r.hasGrp} andGroup=${r.andGroup} noPanel=${r.noPanel}`);
  console.log(ok ? 'TREE_VERIFY_PASS' : 'TREE_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
