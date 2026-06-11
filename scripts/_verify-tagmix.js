'use strict';
// Throwaway: verify per-tag-chip AND/OR cycling with mixing.
// Seeds: p1[A], p2[A,B], p3[B,C], p4[C].
//   click A      -> A=OR    -> p1,p2          = 2
//   click A again-> A=AND   -> p1,p2          = 2 (chip shows ＋, class .and)
//   click B      -> +B=OR   -> A必須 ∧ Bいずれか -> p2 = 1  (mixed!)
//   click B again-> B=AND   -> A∧B            -> p2 = 1
//   click A      -> A off   -> B=AND          -> p2,p3 = 2
//   active-bar pill for AND tag carries ＋ prefix.
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
const tagSets = [['A'], ['A', 'B'], ['B', 'C'], ['C']];
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
  await waitFor(() => cards() >= 4);
  localStorage.setItem('corpus.pinnedTags', JSON.stringify(['A', 'B', 'C']));
  document.getElementById('searchBox').dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);   // re-render → pinned chips appear
  const tagChip = (v) => document.querySelector('#sbPinnedTags .sb-chip[data-filter-value="' + v + '"]');
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // チップは単純トグル。「かつ」入りはピルをドラッグして行う（DnDを実打鍵）。
  const dragPillTo = (pillText, zoneName) => {
    const pill = [...document.querySelectorAll('#queryChips .sb-active-chip')].find(c => c.textContent === pillText);
    const zone = document.querySelector('#queryChips .qc-zone[data-zone="' + zoneName + '"]');
    const dt = new DataTransfer();
    pill.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  };
  click(tagChip('A')); await wait(60);
  const orA = cards();                                     // 2（A=または）
  dragPillTo('#A', 'and'); await wait(80);
  const andA = cards();                                    // 2（A=かつ）
  const chipAnd = tagChip('A').classList.contains('and') && tagChip('A').textContent.startsWith('＋');
  const andField = (document.querySelector('#queryChips .qc-zone[data-zone="and"] .qc-zone-label') || {}).textContent === 'かつ' &&
    !!document.querySelector('#queryChips .qc-zone[data-zone="and"] .sb-active-chip');
  click(tagChip('B')); await wait(60);
  const mixed = cards();                                   // 1 (A必須 ∧ Bいずれか)
  dragPillTo('#B', 'and'); await wait(80);
  const bothAnd = cards();                                 // 1 (A∧B)
  click(tagChip('A')); await wait(60);                     // トグル＝解除
  const offA = cards();                                    // 2 (B必須)

  // --- connector pulldown: (AND field) ⟨かつ/または⟩ (OR field) ---
  click(tagChip('C')); await wait(60);                     // B=and, C=or
  const joinAndCount = cards();                            // B必須 ∧ C → p3 = 1
  const joinSel = document.getElementById('qcJoinSel');
  const joinShown = !!joinSel && joinSel.value === 'and';
  joinSel.value = 'or'; joinSel.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
  const joinOrCount = cards();                             // B∨C → p2,p3,p4 = 3
  const joinValAfter = (document.getElementById('qcJoinSel') || {}).value;
  // pills are draggable between the two always-visible zones
  const zones = document.querySelectorAll('#queryChips .qc-zone').length === 2;
  const draggable = !!document.querySelector('#queryChips .sb-active-chip[draggable="true"]');
  return { orA, andA, chipAnd, andField, mixed, bothAnd, offA, joinAndCount, joinShown, joinOrCount, joinValAfter, zones, draggable };
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
  const ok = r.orA === 2 && r.andA === 2 && r.chipAnd === true && r.andField === true &&
    r.mixed === 1 && r.bothAnd === 1 && r.offA === 2 &&
    r.joinAndCount === 1 && r.joinShown === true && r.joinOrCount === 3 && r.joinValAfter === 'or' &&
    r.zones === true && r.draggable === true;
  console.log(`orA=${r.orA} andA=${r.andA} chipAnd=${r.chipAnd} andField=${r.andField} mixed=${r.mixed} bothAnd=${r.bothAnd} offA=${r.offA}` +
    ` joinAnd=${r.joinAndCount} joinShown=${r.joinShown} joinOr=${r.joinOrCount} joinVal=${r.joinValAfter} zones=${r.zones} drag=${r.draggable}`);
  console.log(ok ? 'TAGMIX_VERIFY_PASS' : 'TAGMIX_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
