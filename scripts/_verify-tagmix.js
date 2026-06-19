'use strict';
// Throwaway: verify the inline drag query builder (docs/design-query-builder.md 改訂③).
// The faceted per-type select was removed; conditions are flat at the top level and
// combine with AND by default, the AND/OR connector toggles on click, and ≠ negates.
// Seeds: p1[A], p2[A], p3[A,B], p4[].
//   open tag flyout, click A -> [A]            -> p1,p2,p3      = 3
//   click B                  -> [A かつ B]      -> A∧B = p3      = 1   (top-level AND default)
//   click connector          -> [A または B]    -> A∨B = p1..p3  = 3   (connector is clickable)
//   click connector again    -> [A かつ B]      -> A∧B           = 1
//   ≠ on the B pill          -> [A かつ ≠B]     -> A∧¬B = p1,p2  = 2   (negation)
//   structure: no .qc-op-sel / no .qc-group / pills are draggable / has .qb-op
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tm-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const tagSets = [['A'], ['A'], ['A', 'B'], []];
for (let i = 0; i < 4; i++) {
  const id = '170000000000' + i + '-tm' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (400 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: tagSets[i], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const pillByLabel = (t) => [...document.querySelectorAll('#queryChips .qb-pill')].find((p) => (p.querySelector('.qb-pill-label') || {}).textContent === t);
  await waitFor(() => cards() >= 4);

  // タグ行クリックで全タグフライアウトを開き、A・B を順に選ぶ（フライアウトは開いたまま）
  click(document.querySelector('#filterRows [data-qfrow="tag"]')); await wait(80);
  click(document.querySelector('.qf-pop [data-qfval="A"]')); await wait(80);
  const onlyA = cards();                                 // [A] → 3
  click(document.querySelector('.qf-pop [data-qfval="B"]')); await wait(80);
  const andAB = cards();                                 // top-level AND default → A∧B → 1
  // 連結語（かつ/または）はクリックで一括トグル
  const op = () => document.querySelector('#queryChips .qb-op-root');
  const opShown = !!op();
  click(op()); await wait(80);
  const orAB = cards();                                  // A∨B → 3
  click(op()); await wait(80);
  const andAB2 = cards();                                // back to A∧B → 1
  // ≠ で B を否定（右クリック→メニュー「除外」）。A かつ ≠B
  const rclick = (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  const bPill = pillByLabel('B');
  rclick(bPill); await wait(80);
  click(document.querySelector('.qb-menu [data-act="neg"]')); await wait(80);
  const andNotB = cards();                               // A∧¬B → p1,p2 → 2
  const bNeg = !!pillByLabel('B') && pillByLabel('B').classList.contains('neg');

  const noOpSel = !document.querySelector('#queryChips .qc-op-sel');
  const noGroupCls = !document.querySelector('#queryChips .qc-group');
  const pillsDraggable = [...document.querySelectorAll('#queryChips .qb-pill')].every((p) => p.getAttribute('draggable') === 'true');
  return { onlyA, andAB, opShown, orAB, andAB2, andNotB, bNeg, noOpSel, noGroupCls, pillsDraggable };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.onlyA === 3 && r.andAB === 1 && r.opShown === true && r.orAB === 3 && r.andAB2 === 1 &&
    r.andNotB === 2 && r.bNeg === true && r.noOpSel === true && r.noGroupCls === true && r.pillsDraggable === true;
  console.log(`onlyA=${r.onlyA} andAB=${r.andAB} opShown=${r.opShown} orAB=${r.orAB} andAB2=${r.andAB2}` +
    ` andNotB=${r.andNotB} bNeg=${r.bNeg} noOpSel=${r.noOpSel} noGroupCls=${r.noGroupCls} pillsDraggable=${r.pillsDraggable}`);
  console.log(ok ? 'TAGMIX_VERIFY_PASS' : 'TAGMIX_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
