'use strict';
// Throwaway: verify the facet-chip query builder (docs/design-query-builder.md 改訂④).
// Values cluster per attribute (tags default すべて=AND); the すべて/どれか toggle is
// the ONLY operator surface; exclusion moves a value into the 除く cluster via the
// right-click menu; the bar carries no boolean vocabulary (no parens/connector/drag)
// and the 読み下し文 line guarantees the semantics.
// Seeds: p1[A], p2[A], p3[A,B], p4[].
//   tag A                       -> [A]                     -> 3
//   tag B                       -> tag cluster A・B(すべて) -> A∧B = 1
//   click すべて/どれか          -> どれか                   -> A∨B = 3
//   click again                 -> すべて                   -> 1
//   right-click B →「除く」へ移す -> A ∧ ¬B                  -> 2 (B は除くクラスタ)
//   right-click B → 戻す         -> A・B(すべて)             -> 1
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
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const rclick = (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  const valByLabel = (t) => [...document.querySelectorAll('#queryChips .qb-val')].find((p) => (p.querySelector('.qb-val-label') || {}).textContent === t);
  const menuRow = (txt) => [...document.querySelectorAll('.fold-menu.show .fm-row')].find((r) => ((r.querySelector('.fm-name') || {}).textContent || '').includes(txt));
  const qfVal = (label) => [...document.querySelectorAll('.qf-pop .fm-row')].find((r) => { const n = r.querySelector('.fm-name'); return n && n.textContent === label; });
  const opt = () => document.querySelector('#queryChips .qb-opt');
  const log = [];
  try {
    await waitFor(() => cards() >= 4);
    // タグ行→フライアウトで A・B を順に選ぶ（フライアウトは開いたまま）
    click(document.querySelector('#filterRows [data-qfrow="tag"]')); await wait(80);
    click(await waitFor(() => qfVal('A'))); await wait(100);
    const onlyA = cards();                                   // [A] → 3
    click(await waitFor(() => qfVal('B'))); await wait(100);
    const andAB = cards();                                   // タグ既定すべて(AND) → 1
    const clusters = document.querySelectorAll('#queryChips .qb-cluster').length; // ひとまとまり
    const optAll = opt() ? opt().textContent.trim() : '';
    click(opt()); await wait(100);
    const orAB = cards();                                    // どれか(OR) → 3
    const optAny = opt() ? opt().textContent.trim() : '';
    click(opt()); await wait(100);
    const andAB2 = cards();                                  // すべて → 1
    // 右クリック→「除く」へ移す → A ∧ ¬B → 2
    rclick(valByLabel('B'));
    const exclRow = await waitFor(() => menuRow('移す'));
    log.push('exclRow=' + !!exclRow);
    click(exclRow); await wait(120);
    const andNotB = cards();
    const exclHasB = !![...document.querySelectorAll('#queryChips .qb-cluster-excl .qb-val-label')].find((l) => l.textContent === 'B');
    // 右クリック→戻す → A・B(すべて) → 1
    rclick(valByLabel('B'));
    const backRow = await waitFor(() => menuRow('戻す'));
    log.push('backRow=' + !!backRow);
    click(backRow); await wait(120);
    const restored = cards();
    const optRestored = opt() ? opt().textContent.trim() : '';
    // 構造: 式の語彙・ドラッグの不在＋読み下し文
    const noFormula = !document.querySelector('#queryChips .qb-op, #queryChips .qb-paren, #queryChips .qb-group-add');
    const noDrag = !document.querySelector('#queryChips [draggable="true"]');
    const sentEl = document.getElementById('querySent');
    const sentence = sentEl && sentEl.style.display !== 'none' ? sentEl.textContent : '';
    return { ok: true, log, onlyA, andAB, clusters, optAll, orAB, optAny, andAB2, andNotB, exclHasB, restored, optRestored, noFormula, noDrag, sentence };
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
  const ok = r.ok === true && r.onlyA === 3 && r.andAB === 1 && r.clusters === 1 && r.optAll === 'すべて' &&
    r.orAB === 3 && r.optAny === 'どれか' && r.andAB2 === 1 && r.andNotB === 2 && r.exclHasB === true &&
    r.restored === 1 && r.optRestored === 'すべて' && r.noFormula === true && r.noDrag === true &&
    typeof r.sentence === 'string' && r.sentence.includes('すべて含む');
  console.log(`log=${JSON.stringify(r.log)} err=${r.err || '-'} onlyA=${r.onlyA} andAB=${r.andAB} clusters=${r.clusters}` +
    ` optAll=${r.optAll} orAB=${r.orAB} optAny=${r.optAny} andAB2=${r.andAB2} andNotB=${r.andNotB} exclHasB=${r.exclHasB}` +
    ` restored=${r.restored} optRestored=${r.optRestored} noFormula=${r.noFormula} noDrag=${r.noDrag} sentence=${JSON.stringify(r.sentence)}`);
  console.log(ok ? 'TAGMIX_VERIFY_PASS' : 'TAGMIX_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
